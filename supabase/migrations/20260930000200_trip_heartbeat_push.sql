-- =============================================================================
-- NomadCare v2 — 20260930000200 Buddy heartbeat + contact_lost, Web Push for the
-- pre-dead-zone reminders (round 2, R6). Owner: backend (W6). Idempotent; runs
-- after 20260930000100 and replaces app_private.apply_device_op,
-- app_private.alert_payload, public.v_buddy_sessions and public.nc_deadman_tick
-- (same signatures / columns first, grants are kept).
--   Heartbeat (only during an open Buddy session)
--   * buddy_sessions.last_heartbeat_at (receive time), heartbeat_state
--     'live' | 'paused', silence_until (the app's predicted end of the current /
--     next known dead zone + 15 min, or null).
--   * device op buddy.heartbeat {session_id, state, lat, lng, accuracy_m,
--     silence_until, client_ts} (app_private.op_buddy_heartbeat): every 5 min
--     while the app is visible and online ('live'); 'paused' when it is hidden /
--     closed. No event row (it would fill the log); a closed session is ignored;
--     'invalid_state' (22023) for anything but live / paused; silence_until is
--     capped at 24 h ahead; the fix updates the last location when it is newer.
--   * alert_reason adds 'contact_lost'. public.nc_mark_contact_lost() (called by
--     nc_deadman_tick every minute): an 'active' session whose app said 'live'
--     and that has been silent — no heartbeat and no check-in — for more than
--     app_private.settings 'contact_lost_after_min' (default 15) minutes, with
--     silence_until null or past, becomes 'overdue' with alert_reason
--     'contact_lost' + event overdue {source:'server', reason:'contact_lost',
--     last_heartbeat_at, silence_until}. The normal alert path then e-mails the
--     recipient ONLY when the session has an e-mail (alert_due; same quota
--     ledger as every alert); the dashboard always shows it (v_buddy_sessions
--     adds last_heartbeat_at, heartbeat_state, silence_until). 'paused' sessions
--     are protected by the normal dead-man switch only.
--   * alert_payload: reason 'contact_lost' (+ last_heartbeat_at, heartbeat_state,
--     silence_until) — the deadman-alert Edge Function words that e-mail as an
--     abnormal loss of contact, not a predicted dead zone.
--   Web Push (Supabase mode, app config vapidPublicKey)
--   * public.push_subscriptions (endpoint unique, p256dh, auth, lang; ≤ 5 per
--     device) and public.push_schedule (fire_at, kind 'deadzone_ahead',
--     minutes_before, zone_km): RLS on, no API privilege for anon, admins may
--     only read; written only by the SECURITY DEFINER device ops. Both cascade
--     with the device (device.erase).
--   * device ops push.subscribe {endpoint, p256dh, auth, lang}
--     ('invalid_push_endpoint' unless the endpoint is on a browser push service:
--     fcm.googleapis.com, *.push.services.mozilla.com, *.push.apple.com,
--     *.notify.windows.com — the Edge Function POSTs to it; 'invalid_push_keys'),
--     push.unsubscribe {endpoint?} and push.schedule {items} (replace-all per
--     device; ≤ 20 items 'too_many_items'; each {fire_at, kind 'deadzone_ahead',
--     minutes_before 0–120, zone_km 0–10000} else 'invalid_push_schedule';
--     items in the past or more than 48 h ahead are skipped). Same rules as
--     NC.backend.shared.validPushEndpoint / validPushKeys / pushScheduleItems.
--   * public.nc_push_tick() (cron 'nomadcare-push' every minute) → pg_net POST
--     {functions_url}/push-dispatch (x-nc-cron-secret) when something is due;
--     public.nc_push_claim(limit) / nc_push_result(id, ok, error, gone[])
--     (service_role only) are the Edge Function's API. The push payload is
--     generic (title, body, tag, url): no coordinates.
-- Deploy push: set the function secrets VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
-- VAPID_SUBJECT (mailto:… or https://…) and CRON_SECRET, deploy
-- supabase/functions/push-dispatch with JWT verification OFF, put the public key
-- in assets/js/config.js vapidPublicKey. Without it the app keeps in-app timers.
-- =============================================================================
set search_path = public, extensions;

-- =============================================================================
-- 1. Schema
-- =============================================================================
alter table public.buddy_sessions add column if not exists last_heartbeat_at timestamptz;
alter table public.buddy_sessions add column if not exists heartbeat_state text;
alter table public.buddy_sessions add column if not exists silence_until timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'buddy_sessions_heartbeat_state_check'
                   and conrelid = 'public.buddy_sessions'::regclass) then
    alter table public.buddy_sessions add constraint buddy_sessions_heartbeat_state_check
      check (heartbeat_state is null or heartbeat_state in ('live', 'paused'));
  end if;
end $$;
alter table public.buddy_sessions drop constraint if exists buddy_sessions_alert_reason_check;
alter table public.buddy_sessions add constraint buddy_sessions_alert_reason_check
  check (alert_reason is null or alert_reason in ('overdue', 'sos', 'contact_lost'));
comment on column public.buddy_sessions.alert_reason is
  'Why the session is overdue/alerted: overdue (missed check-in) | sos (SOS pressed) | contact_lost (the live app went silent). Null while active or closed.';
comment on column public.buddy_sessions.last_heartbeat_at is 'Server time of the last buddy.heartbeat op (round 2 R6).';
comment on column public.buddy_sessions.heartbeat_state is 'live (app visible and online) | paused (app hidden / closed) | null (no heartbeat yet).';
comment on column public.buddy_sessions.silence_until is
  'Predicted end of the current / next known dead zone + 15 min sent by the app: no contact_lost before it. Null = none.';
create index if not exists buddy_sessions_heartbeat_idx on public.buddy_sessions (last_heartbeat_at)
  where status = 'active' and heartbeat_state = 'live';

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  device_id     uuid not null references public.devices (id) on delete cascade,
  endpoint      text not null unique check (length(endpoint) <= 1024),
  p256dh        text not null,
  auth          text not null,
  lang          text not null default 'vi' check (lang in ('vi', 'en')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_sent_at  timestamptz
);
comment on table public.push_subscriptions is
  'Web Push subscriptions of devices (pre-dead-zone reminders). Written only by device op push.subscribe; pruned on 404/410.';
create index if not exists push_subscriptions_device_idx on public.push_subscriptions (device_id, updated_at desc);

create table if not exists public.push_schedule (
  id              bigint generated always as identity primary key,
  device_id       uuid not null references public.devices (id) on delete cascade,
  fire_at         timestamptz not null,
  kind            text not null default 'deadzone_ahead' check (kind in ('deadzone_ahead')),
  minutes_before  int not null check (minutes_before between 0 and 120),
  zone_km         numeric(9, 3) check (zone_km is null or zone_km between 0 and 10000),
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz,
  sent_at         timestamptz,
  attempts        int not null default 0,
  last_error      text
);
comment on table public.push_schedule is
  'Reminders of the active trip of a device (op push.schedule, replace-all). Sent by the push-dispatch Edge Function; no coordinates.';
create index if not exists push_schedule_due_idx on public.push_schedule (fire_at) where sent_at is null;
create index if not exists push_schedule_device_idx on public.push_schedule (device_id);

-- RLS like the other device tables: no API access for anon, admins read, the
-- SECURITY DEFINER ops / service_role write.
alter table public.push_subscriptions enable row level security;
alter table public.push_schedule enable row level security;
revoke all on public.push_subscriptions, public.push_schedule from public;
drop policy if exists push_subscriptions_admin_select on public.push_subscriptions;
create policy push_subscriptions_admin_select on public.push_subscriptions for select to authenticated
  using ((select public.is_admin()));
drop policy if exists push_schedule_admin_select on public.push_schedule;
create policy push_schedule_admin_select on public.push_schedule for select to authenticated
  using ((select public.is_admin()));
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.push_subscriptions, public.push_schedule from anon, authenticated';
    execute 'grant select on public.push_subscriptions, public.push_schedule to authenticated';
    execute 'grant all on public.push_subscriptions, public.push_schedule to service_role';
    execute 'revoke all on sequence public.push_schedule_id_seq from anon, authenticated';
    execute 'grant usage, select on sequence public.push_schedule_id_seq to service_role';
  end if;
end $$;

-- =============================================================================
-- 2. Helpers
-- =============================================================================
-- Browser push services only (= validPushEndpoint in backend-local.js): the Edge
-- Function POSTs to the endpoint, so an arbitrary URL would make it a relay.
create or replace function app_private.valid_push_endpoint(p text)
returns boolean
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select coalesce(length(p) <= 1024
     and p ~* '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)(/|$)',
     false)
$$;

-- base64url keys of a PushSubscription (p256dh 65 bytes, auth 16 bytes).
create or replace function app_private.valid_push_keys(p_p256dh text, p_auth text)
returns boolean
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select coalesce(p_p256dh ~ '^[A-Za-z0-9_-]{80,100}={0,2}$' and p_auth ~ '^[A-Za-z0-9_-]{16,32}={0,2}$', false)
$$;

-- Fire-and-forget POST to an Edge Function (like notify_deadman, any name).
-- Returns the pg_net request id or null; never raises.
create or replace function app_private.notify_function(p_name text, p_body jsonb)
returns bigint
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_url     text := app_private.setting('functions_url');
  v_secret  text := app_private.setting('cron_secret');
  v_anon    text := app_private.setting('anon_key');
  v_headers jsonb;
  v_req     bigint;
begin
  if v_url is null or not app_private.has_pg_net() or p_name !~ '^[a-z0-9-]{1,40}$' then
    return null;
  end if;
  v_headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-nc-cron-secret', coalesce(v_secret, ''));
  if v_anon is not null then
    v_headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_anon, 'apikey', v_anon);
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
     into v_req
    using rtrim(v_url, '/') || '/' || p_name, coalesce(p_body, '{}'::jsonb), v_headers, 15000;
  return v_req;
exception when others then
  raise warning 'notify_function(%) failed: %', p_name, sqlerrm;
  return null;
end $$;

-- =============================================================================
-- 3. Device ops
-- =============================================================================
-- ---- op: buddy.heartbeat -------------------------------------------------------
create or replace function app_private.op_buddy_heartbeat(p_device public.devices, p_data jsonb, p_op_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_state text := coalesce(nullif(p_data ->> 'state', ''), 'live');
  v_ts    timestamptz := least(coalesce(app_private.try_ts(p_data ->> 'client_ts'), now()), now());
  v_lat   double precision := app_private.try_num(p_data ->> 'lat');
  v_lng   double precision := app_private.try_num(p_data ->> 'lng');
  v_su    timestamptz := app_private.try_ts(p_data ->> 'silence_until');
  v_fix   boolean;
  s       public.buddy_sessions%rowtype;
begin
  if v_state not in ('live', 'paused') then
    raise exception 'invalid_state' using errcode = '22023', detail = v_state;
  end if;
  if not (v_lat between -90 and 90 and v_lng between -180 and 180) then
    v_lat := null; v_lng := null;
  end if;
  if v_su is not null then
    v_su := least(v_su, now() + interval '24 hours');
  end if;
  s := app_private.op_session(p_device, app_private.try_uuid(p_data ->> 'session_id'));
  if s.status = 'closed' then
    return jsonb_build_object('session_id', s.id, 'status', s.status, 'received_at', now(), 'ignored', 'session_closed');
  end if;
  v_fix := v_lat is not null and (s.last_location_at is null or v_ts >= s.last_location_at);
  update public.buddy_sessions set
    last_heartbeat_at = now(),
    heartbeat_state   = v_state,
    silence_until     = v_su,
    last_lat          = case when v_fix then v_lat else last_lat end,
    last_lng          = case when v_fix then v_lng else last_lng end,
    last_location_at  = case when v_fix then v_ts else last_location_at end
  where id = s.id
  returning * into s;
  return jsonb_build_object('session_id', s.id, 'status', s.status, 'alert_reason', s.alert_reason,
                            'heartbeat_state', s.heartbeat_state, 'silence_until', s.silence_until, 'received_at', now());
end $$;

-- ---- op: push.subscribe (upsert by endpoint, ≤ 5 per device) ---------------------
create or replace function app_private.op_push_subscribe(p_device public.devices, p_data jsonb, p_op_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_ep   text := p_data ->> 'endpoint';
  v_lang text := case when p_data ->> 'lang' = 'en' then 'en' else 'vi' end;
  v_n    int;
begin
  if not app_private.valid_push_endpoint(v_ep) then
    raise exception 'invalid_push_endpoint' using errcode = '22023';
  end if;
  if not app_private.valid_push_keys(p_data ->> 'p256dh', p_data ->> 'auth') then
    raise exception 'invalid_push_keys' using errcode = '22023';
  end if;
  -- clock_timestamp(): several subscribes in one batch keep their order (the ≤ 5 trim keeps the newest)
  insert into public.push_subscriptions (device_id, endpoint, p256dh, auth, lang, created_at, updated_at)
  values (p_device.id, v_ep, p_data ->> 'p256dh', p_data ->> 'auth', v_lang, clock_timestamp(), clock_timestamp())
  on conflict (endpoint) do update set
    device_id = excluded.device_id, p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang,
    updated_at = clock_timestamp();
  delete from public.push_subscriptions x
   where x.id in (select y.id from public.push_subscriptions y where y.device_id = p_device.id
                  order by y.updated_at desc, y.created_at desc offset 5);
  select count(*)::int into v_n from public.push_subscriptions where device_id = p_device.id;
  return jsonb_build_object('subscribed', true, 'subscriptions', v_n, 'received_at', now());
end $$;

-- ---- op: push.unsubscribe {endpoint?} ------------------------------------------------
create or replace function app_private.op_push_unsubscribe(p_device public.devices, p_data jsonb, p_op_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_n int;
begin
  delete from public.push_subscriptions
   where device_id = p_device.id
     and (nullif(p_data ->> 'endpoint', '') is null or endpoint = p_data ->> 'endpoint');
  get diagnostics v_n = row_count;
  return jsonb_build_object('deleted', v_n, 'received_at', now());
end $$;

-- ---- op: push.schedule {items} (replace-all per device) -----------------------------
create or replace function app_private.op_push_schedule(p_device public.devices, p_data jsonb, p_op_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_items jsonb := p_data -> 'items';
  x       jsonb;
  v_at    timestamptz;
  v_mb    numeric;
  v_zk    numeric;
  v_n     int := 0;
  v_skip  int := 0;
begin
  if v_items is null or jsonb_typeof(v_items) <> 'array' then
    raise exception 'invalid_push_schedule' using errcode = '22023';
  end if;
  if jsonb_array_length(v_items) > 20 then
    raise exception 'too_many_items' using errcode = '22023', detail = jsonb_array_length(v_items)::text;
  end if;
  for x in select value from jsonb_array_elements(v_items) loop
    v_at := case when jsonb_typeof(x) = 'object' and jsonb_typeof(x -> 'fire_at') = 'string' then app_private.try_ts(x ->> 'fire_at') end;
    v_mb := case when jsonb_typeof(x) = 'object' and jsonb_typeof(x -> 'minutes_before') = 'number' then (x ->> 'minutes_before')::numeric end;
    v_zk := case when jsonb_typeof(x) = 'object' and jsonb_typeof(x -> 'zone_km') = 'number' then (x ->> 'zone_km')::numeric end;
    if v_at is null or x ->> 'kind' is distinct from 'deadzone_ahead'
       or v_mb is null or v_mb < 0 or v_mb > 120 or v_mb <> trunc(v_mb)
       or v_zk is null or v_zk < 0 or v_zk > 10000 then
      raise exception 'invalid_push_schedule' using errcode = '22023';
    end if;
  end loop;
  delete from public.push_schedule where device_id = p_device.id and sent_at is null;
  for x in select value from jsonb_array_elements(v_items) loop
    v_at := app_private.try_ts(x ->> 'fire_at');
    if v_at < now() - interval '1 minute' or v_at > now() + interval '48 hours' then
      v_skip := v_skip + 1;
      continue;
    end if;
    insert into public.push_schedule (device_id, fire_at, kind, minutes_before, zone_km)
    values (p_device.id, v_at, 'deadzone_ahead', (x ->> 'minutes_before')::numeric::int, round((x ->> 'zone_km')::numeric, 3));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('scheduled', v_n, 'skipped', v_skip, 'received_at', now());
end $$;

-- ---- dispatcher (+ buddy.heartbeat, push.*) ------------------------------------------
create or replace function app_private.apply_device_op(p_device public.devices, p_op text, p_data jsonb, p_op_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_data is null or jsonb_typeof(p_data) not in ('object', 'array') then
    p_data := '{}'::jsonb;
  end if;
  case p_op
    when 'device.register' then
      update public.devices set
        carrier     = coalesce((select c.id from public.carriers c where c.id = p_data ->> 'carrier'), carrier),
        app_version = coalesce(app_private.clean_text(p_data ->> 'app_version', 40), app_version)
      where id = p_device.id;
      return jsonb_build_object('device_id', p_device.id);
    when 'buddy.start'      then return app_private.op_buddy_start(p_device, p_data, p_op_id);
    when 'buddy.checkin'    then return app_private.op_buddy_checkin(p_device, p_data, p_op_id);
    when 'buddy.stop'       then return app_private.op_buddy_stop(p_device, p_data, p_op_id);
    when 'buddy.resolve'    then return app_private.op_buddy_resolve(p_device, p_data, p_op_id);
    when 'buddy.update'     then return app_private.op_buddy_update(p_device, p_data, p_op_id);
    when 'buddy.heartbeat'  then return app_private.op_buddy_heartbeat(p_device, p_data, p_op_id);
    when 'push.subscribe'   then return app_private.op_push_subscribe(p_device, p_data, p_op_id);
    when 'push.unsubscribe' then return app_private.op_push_unsubscribe(p_device, p_data, p_op_id);
    when 'push.schedule'    then return app_private.op_push_schedule(p_device, p_data, p_op_id);
    when 'report.submit'    then return app_private.op_report_submit(p_device, p_data, p_op_id);
    when 'signal.log'       then return app_private.op_signal_log(p_device, p_data, p_op_id);
    when 'device.erase'     then return app_private.op_device_erase(p_device, p_data, p_op_id);
    else
      raise exception 'unknown_op' using errcode = '22023', detail = coalesce(p_op, 'null');
  end case;
end $$;

-- =============================================================================
-- 4. contact_lost detection + alert payload
-- =============================================================================
create or replace function public.nc_mark_contact_lost()
returns int
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_n     int;
  v_limit int := app_private.limit_value('contact_lost_after_min', 15);
begin
  if not (app_private.is_trusted_caller() or public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  with due as (
    select s.id
    from public.buddy_sessions s
    where s.status = 'active'
      and s.heartbeat_state = 'live'
      and s.last_heartbeat_at is not null
      and s.last_heartbeat_at < now() - make_interval(mins => v_limit)            -- index-friendly prefilter
      and greatest(s.last_heartbeat_at, coalesce(s.last_checkin_at, '-infinity'::timestamptz)) < now() - make_interval(mins => v_limit)
      and (s.silence_until is null or s.silence_until < now())
    for update skip locked
  ), upd as (
    update public.buddy_sessions s
       set status = 'overdue', alerted_at = null, alert_reason = 'contact_lost'
      from due
     where s.id = due.id
    returning s.id, s.device_id, s.last_lat, s.last_lng, s.last_heartbeat_at, s.silence_until
  ), ev as (
    insert into public.checkin_events (session_id, device_id, kind, lat, lng, client_ts, received_at, queued, meta)
    select u.id, u.device_id, 'overdue', u.last_lat, u.last_lng, now(), now(), false,
           jsonb_build_object('source', 'server', 'reason', 'contact_lost',
                              'last_heartbeat_at', u.last_heartbeat_at, 'silence_until', u.silence_until)
    from upd u
    returning 1
  )
  select count(*)::int into v_n from ev;
  return v_n;
end $$;

-- E-mail payload (as 20260928000100) + reason 'contact_lost' and the heartbeat.
create or replace function app_private.alert_payload(s public.buddy_sessions, p_type text, p_claim_at timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'id',                   s.id,
    'type',                 p_type,
    'reason', case
                when p_type = 'resolved' then 'resolved'
                when s.alert_reason = 'sos' or x.sos_at is not null then 'sos'
                when s.alert_reason = 'contact_lost' and s.status <> 'active' then 'contact_lost'
                when s.status = 'active' then 'manual'
                else 'overdue'
              end,
    'alert_reason',         s.alert_reason,
    'sos_at',               x.sos_at,
    'traveler_name',        app_private.clean_name(s.traveler_name, 60),
    'recipient_name',       app_private.clean_name(s.recipient_name, 60),
    'recipient_email',      s.recipient_email,
    'recipient_phone',      s.recipient_phone,
    'route_id',             s.route_id,
    'route_name',           r.name,
    'route_name_en',        r.name_en,
    'travel_mode',          s.travel_mode,
    'interval_min',         s.interval_min,
    'grace_min',            s.grace_min,
    'status',               s.status,
    'started_at',           s.started_at,
    'last_checkin_at',      s.last_checkin_at,
    'next_due_at',          s.next_due_at,
    'last_lat',             s.last_lat,
    'last_lng',             s.last_lng,
    'last_location_at',     s.last_location_at,
    'last_heartbeat_at',    s.last_heartbeat_at,
    'heartbeat_state',      s.heartbeat_state,
    'silence_until',        s.silence_until,
    'overdue_by_min', case when s.next_due_at is not null and now() > s.next_due_at
                           then floor(extract(epoch from now() - s.next_due_at) / 60)::int else 0 end,
    'share_public_medical', s.share_public_medical,
    'public_medical',       case when s.share_public_medical then s.public_medical end,
    'resolved_note', app_private.clean_name((select e.note from public.checkin_events e
                                              where e.session_id = s.id and e.kind = 'resolved'
                                              order by e.received_at desc limit 1), 300),
    'claim_at',             p_claim_at,
    'server_time',          now())
  from (select (select max(coalesce(e.client_ts, e.received_at)) from public.checkin_events e
                 where e.session_id = s.id and e.kind = 'sos'
                   and coalesce(e.client_ts, e.received_at) >= coalesce(s.last_checkin_at, s.started_at)) as sos_at) x
  left join public.routes r on r.id = s.route_id
$$;

-- Dashboard view (as 20260928000100) + the heartbeat columns (appended).
create or replace view public.v_buddy_sessions
with (security_invoker = true) as
select
  s.id,
  s.device_id,
  s.traveler_name,
  s.recipient_name,
  s.recipient_email,
  s.recipient_phone,
  s.interval_min,
  s.grace_min,
  s.route_id,
  s.travel_mode,
  s.share_public_medical,
  s.public_medical,
  s.status,
  s.started_at,
  s.last_checkin_at,
  s.next_due_at,
  s.last_lat,
  s.last_lng,
  s.last_location_at,
  s.alerted_at,
  s.closed_at,
  s.created_at,
  s.updated_at,
  s.last_lat                                                  as lat,
  s.last_lng                                                  as lng,
  case
    when s.status <> 'closed' and s.next_due_at is not null and now() > s.next_due_at
      then floor(extract(epoch from (now() - s.next_due_at)) / 60)::int
    else 0
  end                                                         as overdue_by_min,
  (select count(*)::int from public.checkin_events e where e.session_id = s.id)
                                                              as event_count,
  (select e.kind from public.checkin_events e
    where e.session_id = s.id
    order by coalesce(e.client_ts, e.received_at) desc nulls last, e.received_at desc nulls last
    limit 1)                                                  as last_event_kind,
  s.alert_reason,
  (select max(coalesce(e.client_ts, e.received_at)) from public.checkin_events e
    where e.session_id = s.id and e.kind = 'sos'
      and coalesce(e.client_ts, e.received_at) >= coalesce(s.last_checkin_at, s.started_at))
                                                              as sos_at,
  s.last_heartbeat_at,
  s.heartbeat_state,
  s.silence_until
from public.buddy_sessions s;

-- Cron tick (as 0800) + contact_lost between overdue marking and dispatch.
create or replace function public.nc_deadman_tick()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_marked int;
  v_lost   int;
  v_sent   int;
begin
  v_marked := public.nc_mark_overdue();
  v_lost := public.nc_mark_contact_lost();
  v_sent := public.nc_dispatch_alerts();
  return jsonb_build_object('marked_overdue', v_marked, 'contact_lost', v_lost, 'dispatched', v_sent, 'at', now());
end $$;

-- =============================================================================
-- 5. Web Push dispatch (Edge Function push-dispatch)
-- =============================================================================
-- Due reminders (+ the device's subscriptions), claimed for 5 min; a reminder
-- more than 30 min late is useless and is never sent; at most 3 attempts.
-- Housekeeping on every call: sent > 2 days, unsent > 1 hour late → deleted.
create or replace function public.nc_push_claim(p_limit int default 100)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  r     public.push_schedule%rowtype;
  v_out jsonb := '[]'::jsonb;
begin
  if not app_private.is_trusted_caller() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.push_schedule
   where (sent_at is not null and sent_at < now() - interval '2 days')
      or (sent_at is null and fire_at < now() - interval '1 hour');
  for r in
    select * from public.push_schedule q
    where q.sent_at is null and q.fire_at <= now() and q.fire_at > now() - interval '30 minutes'
      and (q.claimed_at is null or q.claimed_at < now() - interval '5 minutes') and q.attempts < 3
    order by q.fire_at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update skip locked
  loop
    update public.push_schedule set claimed_at = now(), attempts = attempts + 1 where id = r.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'kind', r.kind, 'minutes_before', r.minutes_before, 'zone_km', r.zone_km, 'fire_at', r.fire_at,
      'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('endpoint', p.endpoint, 'p256dh', p.p256dh,
                                                                    'auth', p.auth, 'lang', p.lang) order by p.updated_at desc)
                                 from public.push_subscriptions p where p.device_id = r.device_id), '[]'::jsonb)));
  end loop;
  return v_out;
end $$;

-- Outcome of one reminder: sent (ok), or failed (claim released → retried next
-- minute, ≤ 3 attempts). Endpoints the push service answered 404 / 410 for are
-- deleted (the browser dropped the subscription).
create or replace function public.nc_push_result(p_id bigint, p_ok boolean, p_error text default null,
                                                 p_gone text[] default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_gone int := 0;
  v_dev  uuid;
begin
  if not app_private.is_trusted_caller() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.push_schedule set
    sent_at    = case when coalesce(p_ok, false) then now() end,
    claimed_at = case when coalesce(p_ok, false) then claimed_at end,
    last_error = case when coalesce(p_ok, false) then null else left(p_error, 300) end
  where id = p_id
  returning device_id into v_dev;
  if coalesce(p_ok, false) and v_dev is not null then
    update public.push_subscriptions set last_sent_at = now() where device_id = v_dev;
  end if;
  if p_gone is not null and cardinality(p_gone) > 0 then
    delete from public.push_subscriptions where endpoint = any (p_gone);
    get diagnostics v_gone = row_count;
  end if;
  return jsonb_build_object('id', p_id, 'ok', coalesce(p_ok, false), 'gone', v_gone);
end $$;

-- Cron: invoke push-dispatch when a reminder is due. Returns the due count.
create or replace function public.nc_push_tick()
returns int
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_n   int;
  v_req bigint;
begin
  if not (app_private.is_trusted_caller() or public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select count(*)::int into v_n from public.push_schedule q
  where q.sent_at is null and q.fire_at <= now() and q.fire_at > now() - interval '30 minutes'
    and (q.claimed_at is null or q.claimed_at < now() - interval '5 minutes') and q.attempts < 3;
  if v_n = 0 then
    return 0;
  end if;
  if app_private.setting('functions_url') is null then
    raise notice 'nc_push_tick: % reminder(s) due but app_private.settings.functions_url is not set', v_n;
    return 0;
  end if;
  if not app_private.has_pg_net() then
    raise notice 'nc_push_tick: % reminder(s) due but pg_net is not installed', v_n;
    return 0;
  end if;
  v_req := app_private.notify_function('push-dispatch', jsonb_build_object('source', 'cron'));
  return case when v_req is null then 0 else v_n end;
end $$;

-- =============================================================================
-- 6. Privileges (as the earlier sweeps) + schedule
-- =============================================================================
revoke all on function public.nc_mark_contact_lost() from public;
revoke all on function public.nc_push_tick() from public;
revoke all on function public.nc_push_claim(int) from public;
revoke all on function public.nc_push_result(bigint, boolean, text, text[]) from public;
revoke all on all functions in schema app_private from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.nc_mark_contact_lost() from anon';
    execute 'grant execute on function public.nc_mark_contact_lost() to authenticated, service_role';   -- guarded inside
    execute 'revoke all on function public.nc_push_tick() from anon';
    execute 'grant execute on function public.nc_push_tick() to authenticated, service_role';           -- guarded inside
    execute 'revoke all on function public.nc_push_claim(int) from anon, authenticated';
    execute 'grant execute on function public.nc_push_claim(int) to service_role';
    execute 'revoke all on function public.nc_push_result(bigint, boolean, text, text[]) from anon, authenticated';
    execute 'grant execute on function public.nc_push_result(bigint, boolean, text, text[]) to service_role';
    execute 'revoke all on all functions in schema app_private from anon, authenticated';
    execute 'grant execute on all functions in schema app_private to service_role';
    execute 'grant execute on function app_private.has_admin_role(text) to authenticated';
    execute 'grant execute on function app_private.level_from_rsrp(int, text) to authenticated';
    execute 'grant execute on function app_private.touch_updated_at() to authenticated';
    execute 'grant execute on function app_private.route_defaults() to authenticated';
    execute 'grant execute on function app_private.signal_sample_defaults() to authenticated';
    execute 'grant execute on function app_private.buddy_session_defaults() to authenticated';
    execute 'grant execute on function app_private.today_vn() to authenticated';
  end if;
end $$;

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname in ('public', 'app_private')
      and p.proname in ('valid_push_endpoint', 'valid_push_keys', 'notify_function', 'op_buddy_heartbeat', 'op_push_subscribe',
                        'op_push_unsubscribe', 'op_push_schedule', 'apply_device_op', 'nc_mark_contact_lost', 'alert_payload',
                        'nc_deadman_tick', 'nc_push_claim', 'nc_push_result', 'nc_push_tick')
      and p.prokind = 'f'
      and l.lanname in ('sql', 'plpgsql')
      and p.proowner = (select oid from pg_roles where rolname = current_user)
      and not exists (select 1 from pg_depend d
                       where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s set jit = off', f);
  end loop;
end $$;

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'cron' and p.proname = 'schedule') then
    raise notice 'pg_cron not installed: push job not scheduled. Run "select public.nc_push_tick();" every minute, or enable pg_cron then create the cron jobs (supabase/README.md, Bước 5) or re-run the whole setup_all.sql — never 0800_cron.sql alone.';
    return;
  end if;
  begin
    perform cron.schedule('nomadcare-push', '* * * * *', 'select public.nc_push_tick()');
  exception when others then
    raise notice 'pg_cron scheduling failed (%): schedule nomadcare-push from Dashboard > Integrations > Cron', sqlerrm;
  end;
end $$;

comment on function public.nc_mark_contact_lost() is
  'Cron: live sessions silent (no heartbeat, no check-in) > contact_lost_after_min (15) outside silence_until → overdue / contact_lost.';
comment on function public.nc_push_claim(int) is
  'push-dispatch Edge Function: claims due reminders (≤ 30 min late, ≤ 3 attempts) with the device subscriptions.';
comment on function public.nc_push_result(bigint, boolean, text, text[]) is
  'push-dispatch Edge Function: records the outcome of one reminder and deletes endpoints answered 404 / 410.';
comment on function app_private.op_buddy_heartbeat(public.devices, jsonb, uuid) is
  'buddy.heartbeat: last_heartbeat_at = now(), heartbeat_state live|paused, silence_until (≤ 24 h), newer fix → last location.';
