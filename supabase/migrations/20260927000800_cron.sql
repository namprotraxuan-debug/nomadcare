-- =============================================================================
-- NomadCare v2 — 0800 dead-man switch: overdue detection, alert dispatch, cron
-- Owner: P1 database.
--   nc_mark_overdue()    active & now() > next_due_at + grace → 'overdue' + event
--   nc_dispatch_alerts() POST {functions_url}/deadman-alert (pg_net) when alerts are due
--   nc_deadman_tick()    both of the above (scheduled every minute via pg_cron)
--   nc_cleanup()         purge old idempotency records (daily)
--   nc_alert_claim() / nc_alert_result()  service_role API used by the Edge Function
-- Configuration (SQL Editor, once):
--   insert into app_private.settings(key, value) values
--     ('functions_url', 'https://<project-ref>.supabase.co/functions/v1'),
--     ('cron_secret',   '<same value as the CRON_SECRET function secret>')
--   on conflict (key) do update set value = excluded.value;
-- If pg_net / pg_cron are missing, everything here still installs; dispatch and
-- scheduling are skipped with a NOTICE (alerts can be sent from the dashboard).
-- =============================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------- helpers ----
create or replace function app_private.setting(p_key text)
returns text
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select nullif(btrim(s.value), '') from app_private.settings s where s.key = p_key
$$;

create or replace function app_private.has_pg_net()
returns boolean
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'net' and p.proname = 'http_post')
$$;

-- Fire-and-forget POST to the deadman-alert Edge Function. Returns the pg_net
-- request id, or null when not configured / unavailable. Never raises, so a
-- notification problem can never break a device sync or an admin action.
create or replace function app_private.notify_deadman(p_body jsonb)
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
  if v_url is null or not app_private.has_pg_net() then
    return null;
  end if;
  v_headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-nc-cron-secret', coalesce(v_secret, ''));
  if v_anon is not null then
    -- only needed when the function was deployed WITH JWT verification
    v_headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_anon, 'apikey', v_anon);
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
     into v_req
    using rtrim(v_url, '/') || '/deadman-alert', coalesce(p_body, '{}'::jsonb), v_headers, 15000;
  return v_req;
exception when others then
  raise warning 'notify_deadman failed: %', sqlerrm;
  return null;
end $$;

-- Retry policy after failed sends: wait 2, 4, 8, 16, 32 min; stop after 6
-- failures within an hour (an admin can still trigger manually).
create or replace function app_private.alert_backoff_ok(p_session_id uuid)
returns boolean
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select case
           when x.n = 0 then true
           when x.n >= 6 then false
           else x.last_at < now() - make_interval(mins => power(2, x.n)::int)
         end
  from (
    select count(*)::int as n, max(e.received_at) as last_at
    from public.checkin_events e
    where e.session_id = p_session_id
      and e.kind = 'alert_failed'
      and coalesce(e.meta ->> 'type', 'overdue') <> 'resolved'
      and e.received_at > now() - interval '1 hour'
  ) x
$$;

-- A session needs an alert email now (cron path). alerted_at doubles as a
-- claim marker while sending; a claim older than 10 min is considered stuck.
create or replace function app_private.alert_due(s public.buddy_sessions)
returns boolean
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select s.status = 'overdue'
     and s.recipient_email is not null
     and (s.alerted_at is null or s.alerted_at < now() - interval '10 minutes')
     and app_private.alert_backoff_ok(s.id)
$$;

-- Email payload for one session (only consented medical data). reason = 'sos'
-- when the traveller pressed SOS since the last check-in (wording of the e-mail).
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
                when exists (select 1 from public.checkin_events e
                              where e.session_id = s.id and e.kind = 'sos'
                                and coalesce(e.client_ts, e.received_at) >= coalesce(s.last_checkin_at, s.started_at))
                  then 'sos'
                when s.status = 'active' then 'manual'
                else 'overdue'
              end,
    'traveler_name',        s.traveler_name,
    'recipient_name',       s.recipient_name,
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
    'overdue_by_min', case when s.next_due_at is not null and now() > s.next_due_at
                           then floor(extract(epoch from now() - s.next_due_at) / 60)::int else 0 end,
    'share_public_medical', s.share_public_medical,
    'public_medical',       case when s.share_public_medical then s.public_medical end,
    'resolved_note', (select e.note from public.checkin_events e
                       where e.session_id = s.id and e.kind = 'resolved'
                       order by e.received_at desc limit 1),
    'claim_at',             p_claim_at,
    'server_time',          now())
  from (select 1) one
  left join public.routes r on r.id = s.route_id
$$;

-- ----------------------------------------------------- overdue detection ----
create or replace function public.nc_mark_overdue()
returns int
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_n int;
begin
  if not (app_private.is_trusted_caller() or public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  with due as (
    select s.id
    from public.buddy_sessions s
    where s.status = 'active'
      and s.next_due_at < now()                                   -- index-friendly prefilter
      and now() > s.next_due_at + make_interval(mins => s.grace_min)
    for update skip locked
  ), upd as (
    update public.buddy_sessions s
       set status = 'overdue', alerted_at = null
      from due
     where s.id = due.id
    returning s.id, s.device_id, s.last_lat, s.last_lng, s.next_due_at, s.grace_min
  ), ev as (
    insert into public.checkin_events (session_id, device_id, kind, lat, lng, client_ts, received_at, queued, meta)
    select u.id, u.device_id, 'overdue', u.last_lat, u.last_lng, now(), now(), false,
           jsonb_build_object('source', 'server', 'next_due_at', u.next_due_at, 'grace_min', u.grace_min)
    from upd u
    returning 1
  )
  select count(*)::int into v_n from ev;
  return v_n;
end $$;

-- ------------------------------------------------------- alert dispatch ----
-- Returns the number of sessions due for an alert when the Edge Function was
-- invoked (0 when nothing is due or dispatch is not configured).
create or replace function public.nc_dispatch_alerts()
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
  select count(*)::int into v_n from public.buddy_sessions s where app_private.alert_due(s);
  if v_n = 0 then
    return 0;
  end if;
  if app_private.setting('functions_url') is null then
    raise notice 'nc_dispatch_alerts: % alert(s) due but app_private.settings.functions_url is not set', v_n;
    return 0;
  end if;
  if not app_private.has_pg_net() then
    raise notice 'nc_dispatch_alerts: % alert(s) due but pg_net is not installed', v_n;
    return 0;
  end if;
  v_req := app_private.notify_deadman(jsonb_build_object('source', 'cron', 'type', 'overdue'));
  return case when v_req is null then 0 else v_n end;
end $$;

create or replace function public.nc_deadman_tick()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_marked int;
  v_sent   int;
begin
  v_marked := public.nc_mark_overdue();
  v_sent := public.nc_dispatch_alerts();
  return jsonb_build_object('marked_overdue', v_marked, 'dispatched', v_sent, 'at', now());
end $$;

create or replace function public.nc_cleanup()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_ops int;
begin
  if not (app_private.is_trusted_caller() or public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.device_ops where received_at < now() - interval '30 days';
  get diagnostics v_ops = row_count;
  return jsonb_build_object('device_ops_deleted', v_ops, 'at', now());
end $$;

-- --------------------------------------- Edge Function API (service_role) ----
-- Claims sessions to alert and returns their email payloads.
--   type 'overdue' (default): cron → every due session (alert_due), up to p_limit;
--       p_session_id + p_force (admin trigger) → that session if not closed
--   type 'resolved': the "all clear" for p_session_id, only when an alert was
--       sent and no all-clear has been sent since (p_force skips that check)
create or replace function public.nc_alert_claim(p_session_id uuid default null, p_type text default 'overdue',
                                                 p_force boolean default false, p_limit int default 25)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  s        public.buddy_sessions%rowtype;
  v_out    jsonb := '[]'::jsonb;
  v_now    timestamptz := now();
  v_alert  timestamptz;
  v_clear  timestamptz;
begin
  if not app_private.is_trusted_caller() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_type not in ('overdue', 'resolved') then
    raise exception 'invalid_type' using errcode = '22023', detail = coalesce(p_type, 'null');
  end if;

  if p_type = 'resolved' then
    select * into s from public.buddy_sessions where id = p_session_id;
    if not found or s.recipient_email is null or s.status not in ('active', 'closed') then
      return v_out;
    end if;
    select max(e.received_at) filter (where coalesce(e.meta ->> 'type', 'overdue') <> 'resolved'),
           max(e.received_at) filter (where e.meta ->> 'type' = 'resolved')
      into v_alert, v_clear
    from public.checkin_events e
    where e.session_id = s.id and e.kind = 'alert_sent';
    if p_force or (v_alert is not null and (v_clear is null or v_clear < v_alert)) then
      v_out := jsonb_build_array(app_private.alert_payload(s, 'resolved', v_now));
    end if;
    return v_out;
  end if;

  if p_session_id is not null and p_force then
    select * into s from public.buddy_sessions where id = p_session_id for update;
    if not found or s.status = 'closed' or s.recipient_email is null then
      return v_out;
    end if;
    if s.status in ('overdue', 'active') then
      update public.buddy_sessions set alerted_at = v_now where id = s.id returning * into s;
    end if;
    return jsonb_build_array(app_private.alert_payload(s, 'overdue', v_now));
  end if;

  for s in
    select * from public.buddy_sessions b
    where app_private.alert_due(b) and (p_session_id is null or b.id = p_session_id)
    order by b.next_due_at nulls last
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    for update skip locked
  loop
    update public.buddy_sessions set alerted_at = v_now where id = s.id returning * into s;
    v_out := v_out || jsonb_build_array(app_private.alert_payload(s, 'overdue', v_now));
  end loop;
  return v_out;
end $$;

-- Records the outcome of one email. On success an overdue session becomes
-- 'alerted'; on failure the claim is released so the cron retries (backoff).
create or replace function public.nc_alert_result(p_session_id uuid, p_ok boolean, p_type text default 'overdue',
                                                  p_provider text default 'resend', p_provider_id text default null,
                                                  p_error text default null, p_trigger text default 'cron')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  s           public.buddy_sessions%rowtype;
  v_meta      jsonb;
  v_all_clear boolean := false;
begin
  if not app_private.is_trusted_caller() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into s from public.buddy_sessions where id = p_session_id for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  v_meta := jsonb_strip_nulls(jsonb_build_object(
    'type', coalesce(p_type, 'overdue'), 'provider', p_provider, 'id', p_provider_id,
    'error', left(p_error, 500), 'trigger', p_trigger));

  if coalesce(p_type, 'overdue') = 'overdue' then
    if p_ok then
      if s.status = 'overdue' or (p_trigger = 'manual' and s.status in ('active', 'alerted')) then
        update public.buddy_sessions set status = 'alerted', alerted_at = now()
         where id = s.id returning * into s;
      elsif s.status = 'active' then
        -- the traveller checked in while the email was being sent → follow up with "all clear"
        update public.buddy_sessions set alerted_at = null where id = s.id returning * into s;
        v_all_clear := true;
      end if;
    elsif s.status in ('overdue', 'active') then
      update public.buddy_sessions set alerted_at = null where id = s.id returning * into s;
    end if;
  end if;

  perform app_private.insert_event(s, case when p_ok then 'alert_sent' else 'alert_failed' end,
                                   null, null, null, null, now(), false, null, v_meta);
  if v_all_clear then
    perform app_private.notify_deadman(jsonb_build_object('session_id', s.id, 'type', 'resolved'));
  end if;
  return jsonb_build_object('session_id', s.id, 'status', s.status, 'alerted_at', s.alerted_at);
end $$;

-- ------------------------------------------------------------ privileges ----
do $$
declare
  f text;
  has_roles boolean := exists (select 1 from pg_roles where rolname = 'anon');
begin
  foreach f in array array['public.nc_mark_overdue()', 'public.nc_dispatch_alerts()',
                           'public.nc_deadman_tick()', 'public.nc_cleanup()'] loop
    execute format('revoke all on function %s from public', f);
    if has_roles then
      execute format('revoke all on function %s from anon', f);
      execute format('grant execute on function %s to authenticated, service_role', f);  -- guarded inside
    end if;
  end loop;
  foreach f in array array['public.nc_alert_claim(uuid, text, boolean, int)',
                           'public.nc_alert_result(uuid, boolean, text, text, text, text, text)'] loop
    execute format('revoke all on function %s from public', f);
    if has_roles then
      execute format('revoke all on function %s from anon, authenticated', f);
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

-- -------------------------------------------------------------- schedule ----
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'cron' and p.proname = 'schedule') then
    raise notice 'pg_cron not installed: jobs not scheduled. Run "select public.nc_deadman_tick();" manually, or enable pg_cron then create the cron jobs (supabase/README.md, Bước 5) or re-run the whole setup_all.sql — never 0800_cron.sql alone.';
    return;
  end if;
  begin
    perform cron.schedule('nomadcare-deadman', '* * * * *', 'select public.nc_deadman_tick()');
    perform cron.schedule('nomadcare-cleanup', '17 3 * * *', 'select public.nc_cleanup()');
  exception when others then
    raise notice 'pg_cron scheduling failed (%): schedule the jobs from Dashboard > Integrations > Cron', sqlerrm;
  end;
end $$;
