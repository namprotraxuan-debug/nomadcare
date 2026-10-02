-- =============================================================================
-- NomadCare v2 — 20260928000100 hardening (wave 3): privacy, abuse limits, SOS,
-- admin data quality. Owner: backend. Idempotent; runs after 0100–0900 and
-- replaces some of their functions (old signatures are dropped first).
--   Buddy / devices
--   * buddy_sessions.alert_reason 'overdue' | 'sos' | null (null while active or
--     closed; kept while overdue/alerted). SOS on an alerted session re-arms the
--     alert so the recipient gets an SOS e-mail. v_buddy_sessions adds
--     alert_reason + sos_at.
--   * buddy.start requires a valid recipient e-mail ('recipient_email_required');
--     traveller / recipient names are cleaned (≤ 60 chars, no URLs, e-mails,
--     control characters); started_at is capped to the last 24 h.
--   * new device ops: buddy.update {session_id, share_public_medical,
--     public_medical} and device.erase (erases the device and everything it
--     owns; an unknown device + device.erase is a no-op success).
--   * rate limits (app_private.settings can override the defaults):
--       limit_buddy_start_device_24h  5   new sessions per device / 24 h
--       limit_alert_recipient_24h     3   alert e-mails per recipient / 24 h
--       limit_alert_global_1h        50   alert e-mails for all recipients / h
--       limit_register_ip_1h         30   register_device per client IP / h
--     Recipients on reserved domains (example.com, *.test, …) never receive a
--     real e-mail and are exempt. A session over the alert limit stays
--     'overdue' and gets one 'alert_failed' event {reason:'rate_limited'}.
--     Manual alerts sent by an admin are never limited.
--   * retention: public_medical is dropped as soon as a session closes;
--     nc_cleanup() deletes sessions closed > 30 days ago (and open sessions idle
--     > 90 days) with their events, and clears registration IP hashes > 24 h.
--   * manual alerts are attributed to the admin (nc_alert_claim / nc_alert_result
--     take p_actor; audit_row reads nc.actor_id).
--   Admin
--   * admin_publish_pack(route, carrier, notes, force=false) returns the current
--     version with unchanged:true when the live build has the same content.
--   * admin_pack_changes(route?, carrier?) — per route × carrier: changed flag
--     + facilities/services added/removed(reason)/updated since the current pack.
--   * admin_review_submission: re-approving a reopened 'new' report reuses the
--     facility created the first time.
--   * admin_review_samples writes one audit row per call (changed rows only).
--   * admin_upsert_facility: 'invalid_date' for a verification date in the
--     future; 'invalid_coordinates' (detail outside_vietnam) for a verified
--     facility outside lat 8.1–23.5 / lng 102.1–109.6.
--   * realtime publication + data_packs (without payload where supported),
--     content_releases, services, audit_log.
-- =============================================================================
set search_path = public, extensions;

-- =============================================================================
-- 1. Schema
-- =============================================================================
alter table public.buddy_sessions add column if not exists alert_reason text;
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'buddy_sessions_alert_reason_check'
                   and conrelid = 'public.buddy_sessions'::regclass) then
    alter table public.buddy_sessions add constraint buddy_sessions_alert_reason_check
      check (alert_reason is null or alert_reason in ('overdue', 'sos'));
  end if;
end $$;
comment on column public.buddy_sessions.alert_reason is
  'Why the session is overdue/alerted: overdue (missed check-in) | sos (SOS pressed). Null while active or closed.';

alter table public.devices add column if not exists reg_ip_hash text;
comment on column public.devices.reg_ip_hash is
  'sha256(ip_salt | client IP) of the registration request, only for the register_device rate limit; cleared after 24 h by nc_cleanup().';

create index if not exists buddy_sessions_device_created_idx on public.buddy_sessions (device_id, created_at desc);
create index if not exists buddy_sessions_recipient_idx      on public.buddy_sessions (lower(recipient_email))
  where recipient_email is not null;
create index if not exists buddy_sessions_closed_at_idx      on public.buddy_sessions (closed_at) where status = 'closed';
create index if not exists checkin_events_alert_idx          on public.checkin_events (received_at desc)
  where kind in ('alert_sent', 'alert_failed');
create index if not exists devices_reg_ip_idx                on public.devices (reg_ip_hash, created_at desc)
  where reg_ip_hash is not null;

-- per-project salt for the IP hashes (never exposed)
insert into app_private.settings (key, value)
values ('ip_salt', encode(gen_random_bytes(16), 'hex'))
on conflict (key) do nothing;

-- =============================================================================
-- 2. Small helpers
-- =============================================================================

-- Integer limit from app_private.settings (key) or the default.
create or replace function app_private.limit_value(p_key text, p_default int)
returns int
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select coalesce((select case when s.value ~ '^\s*\d+\s*$' then btrim(s.value)::int end
                   from app_private.settings s where s.key = p_key), p_default)
$$;

-- RFC 2606 / 6761 reserved domains (demo seed): never e-mailed for real (same
-- rule as the Edge Function), so they are exempt from the abuse limits.
create or replace function app_private.is_reserved_email(p text)
returns boolean
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select p is not null
     and lower(btrim(p)) ~ '@([^@]*\.)?(example\.(com|net|org)|example|test|invalid|localhost)$'
$$;

-- Display name for e-mails / dashboards: control characters, URLs, "http",
-- "www.", e-mail addresses and bare domains (common TLDs) are removed, spaces
-- collapsed, max p_max characters; empty → null. Mirrors cleanName() in
-- assets/js/services/backend-local.js.
create or replace function app_private.clean_name(p text, p_max int default 60)
returns text
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select nullif(btrim(left(btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(coalesce(p, ''), '[[:cntrl:]]+', ' ', 'g'),
            '[^[:space:]]*(https?|://|www\.)[^[:space:]]*', ' ', 'gi'),
          '[^[:space:]@]+@[^[:space:]@]+', ' ', 'g'),
        '[^[:space:]]+\.(com|net|org|info|biz|io|co|me|app|dev|xyz|top|site|online|link|click|shop|store|live|'
          || 'vn|ru|cn|uk|de|fr|us|tk|ml|ga|cf|gq|ly|to|gl|gg|cc|tv|ws|pw|su|in|eu|asia|ai|sh|page|lol|icu|'
          || 'cyou|buzz|rest|work|support|help|email|bank|finance|money|pro|cloud|tech|space|website|fun|'
          || 'club|vip|win|bid|loan|zip|mov)\M[^[:space:]]*', ' ', 'gi'),
      '[[:space:]]+', ' ', 'g')), greatest(coalesce(p_max, 60), 1))), '')
$$;

-- Client IP of the current PostgREST request (Cloudflare / proxy headers), or
-- null outside the Data API (SQL editor, tests, cron).
create or replace function app_private.client_ip()
returns text
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
declare
  h jsonb;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  if h is null or jsonb_typeof(h) <> 'object' then
    return null;
  end if;
  return left(coalesce(nullif(btrim(h ->> 'cf-connecting-ip'), ''),
                       nullif(btrim(h ->> 'x-real-ip'), ''),
                       nullif(btrim(split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1)), '')), 64);
end $$;

-- Acting admin for trusted callers (the Edge Function uses the service key):
-- audit_row() and actor_label() pick it up for the rest of the transaction.
create or replace function app_private.set_actor(p_actor uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_label text;
begin
  if p_actor is null then
    return null;
  end if;
  select coalesce(a.display_name, u.email, 'admin') into v_label
  from public.admin_users a left join auth.users u on u.id = a.user_id
  where a.user_id = p_actor;
  if not found then
    return null;                      -- not an admin: keep the default attribution
  end if;
  perform set_config('nc.actor_id', p_actor::text, true);
  perform set_config('nc.actor', v_label, true);
  return v_label;
end $$;

-- =============================================================================
-- 3. Audit: trusted callers may act for an admin (nc.actor_id)
-- =============================================================================
create or replace function app_private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor   uuid := coalesce(auth.uid(), app_private.try_uuid(current_setting('nc.actor_id', true)));
  v_old     jsonb;
  v_new     jsonb;
  v_changed jsonb := '{}'::jsonb;
  v_action  text := lower(tg_op);
  v_details jsonb;
  v_id      text;
  k         text;
begin
  if coalesce(current_setting('nc.audit', true), 'on') = 'off' then
    return null;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old);
    v_old := app_private.audit_clean(v_old, case when v_old ? 'geom' then (v_old ->> 'geom')::geography end);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new);
    v_new := app_private.audit_clean(v_new, case when v_new ? 'geom' then (v_new ->> 'geom')::geography end);
  end if;
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id');

  if tg_table_name = 'buddy_sessions' then
    -- status transitions only; never copy personal data into the audit trail
    if tg_op <> 'UPDATE' or (v_old ->> 'status') is not distinct from (v_new ->> 'status') then
      return null;
    end if;
    v_action := 'status';
    v_details := jsonb_build_object('from', v_old ->> 'status', 'to', v_new ->> 'status');
  elsif tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      if (v_new -> k) is distinct from (v_old -> k) then
        v_changed := v_changed || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k));
      end if;
    end loop;
    if v_changed = '{}'::jsonb then
      return null;
    end if;
    if tg_table_name = 'data_packs' and v_changed - 'is_current' = '{}'::jsonb then
      return null;
    end if;
    if v_changed ? 'status' then
      v_action := 'status';
    end if;
    v_details := jsonb_build_object('changed', v_changed);
  elsif tg_op = 'INSERT' then
    if tg_table_name = 'data_packs' then
      v_action := 'publish';
    end if;
    v_details := jsonb_build_object('row', v_new);
  else
    v_details := jsonb_build_object('row', v_old);
  end if;

  insert into public.audit_log (actor, actor_label, action, entity, entity_id, details)
  values (v_actor, app_private.actor_label(v_actor), v_action, tg_table_name, v_id, v_details);
  return null;
end $$;

-- =============================================================================
-- 4. Buddy session invariants (one place for every write path)
-- =============================================================================
--   active / closed      → alert_reason null
--   overdue / alerted    → alert_reason defaults to 'overdue'
--   closed               → public_medical dropped (retention)
--   not shared           → public_medical null
create or replace function app_private.buddy_session_defaults()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  if new.status in ('active', 'closed') then
    new.alert_reason := null;
  elsif new.alert_reason is null then
    new.alert_reason := 'overdue';
  end if;
  if new.status = 'closed' or not coalesce(new.share_public_medical, false) then
    new.public_medical := null;
  end if;
  return new;
end $$;

-- backfill before the trigger exists (explicit values, then the trigger keeps them)
update public.buddy_sessions s
   set alert_reason = case when exists (select 1 from public.checkin_events e
                                         where e.session_id = s.id and e.kind = 'sos'
                                           and coalesce(e.client_ts, e.received_at) >= coalesce(s.last_checkin_at, s.started_at))
                           then 'sos' else 'overdue' end
 where s.status in ('overdue', 'alerted') and s.alert_reason is null;
update public.buddy_sessions set public_medical = null
 where public_medical is not null and (status = 'closed' or not share_public_medical);

drop trigger if exists buddy_sessions_defaults on public.buddy_sessions;
create trigger buddy_sessions_defaults before insert or update on public.buddy_sessions
  for each row execute function app_private.buddy_session_defaults();

-- Session object for the device (+ alert_reason).
create or replace function app_private.session_json(s public.buddy_sessions)
returns jsonb
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select case when s.id is null then null else jsonb_build_object(
    'id',                   s.id,
    'traveler_name',        s.traveler_name,
    'recipient_name',       s.recipient_name,
    'recipient_email',      s.recipient_email,
    'recipient_phone',      s.recipient_phone,
    'interval_min',         s.interval_min,
    'grace_min',            s.grace_min,
    'route_id',             s.route_id,
    'travel_mode',          s.travel_mode,
    'share_public_medical', s.share_public_medical,
    'status',               s.status,
    'alert_reason',         s.alert_reason,
    'started_at',           s.started_at,
    'last_checkin_at',      s.last_checkin_at,
    'next_due_at',          s.next_due_at,
    'last_lat',             s.last_lat,
    'last_lng',             s.last_lng,
    'last_location_at',     s.last_location_at,
    'alerted_at',           s.alerted_at,
    'closed_at',            s.closed_at,
    'synced',               true) end
$$;

-- Dashboard view (+ alert_reason, sos_at = latest SOS since the last check-in).
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
                                                              as sos_at
from public.buddy_sessions s;

-- =============================================================================
-- 5. Alert quota (abuse limits) + backoff + due
-- =============================================================================

-- Why an alert e-mail to p_email must not go out now: 'recipient_24h' |
-- 'global_1h' | null. Counts sent overdue/SOS alerts plus claims in flight.
create or replace function app_private.alert_quota_block(p_email text)
returns text
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with a as (
    select b.recipient_email as email, e.received_at as at
    from public.checkin_events e
    join public.buddy_sessions b on b.id = e.session_id
    where e.kind = 'alert_sent'
      and coalesce(e.meta ->> 'type', 'overdue') = 'overdue'
      and coalesce(e.meta ->> 'provider', '') <> 'demo'
      and e.received_at > now() - interval '24 hours'
    union all
    select b.recipient_email, b.alerted_at             -- claimed, e-mail in flight
    from public.buddy_sessions b
    where b.status = 'overdue' and b.alerted_at > now() - interval '10 minutes'
  )
  select case
    when p_email is null or app_private.is_reserved_email(p_email) then null
    when (select count(*) from a where lower(a.email) = lower(p_email))
         >= app_private.limit_value('limit_alert_recipient_24h', 3) then 'recipient_24h'
    when (select count(*) from a where a.at > now() - interval '1 hour' and not app_private.is_reserved_email(a.email))
         >= app_private.limit_value('limit_alert_global_1h', 50) then 'global_1h'
  end
$$;

-- Retry policy after failed sends (rate-limit markers are not send failures).
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
      and coalesce(e.meta ->> 'reason', '') <> 'rate_limited'
      and e.received_at > now() - interval '1 hour'
  ) x
$$;

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
     and app_private.alert_quota_block(s.recipient_email) is null
$$;

-- One 'alert_failed' {reason:'rate_limited'} per overdue episode for sessions
-- held back by the quota (visible in the dashboard timeline). Returns the count.
create or replace function app_private.flag_rate_limited(p_session_id uuid default null)
returns int
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  s       public.buddy_sessions%rowtype;
  v_block text;
  v_n     int := 0;
begin
  for s in
    select * from public.buddy_sessions b
    where b.status = 'overdue'
      and b.recipient_email is not null
      and (p_session_id is null or b.id = p_session_id)
      and (b.alerted_at is null or b.alerted_at < now() - interval '10 minutes')
      and not app_private.is_reserved_email(b.recipient_email)
      and not exists (select 1 from public.checkin_events e
                       where e.session_id = b.id and e.kind = 'alert_failed'
                         and e.meta ->> 'reason' = 'rate_limited'
                         and e.received_at >= coalesce(b.last_checkin_at, b.started_at))
  loop
    v_block := app_private.alert_quota_block(s.recipient_email);
    continue when v_block is null;
    perform app_private.insert_event(s, 'alert_failed', null, null, null, null, now(), false, null,
      jsonb_build_object('type', 'overdue', 'reason', 'rate_limited', 'limit', v_block,
                         'max', case v_block when 'recipient_24h' then app_private.limit_value('limit_alert_recipient_24h', 3)
                                             else app_private.limit_value('limit_alert_global_1h', 50) end,
                         'trigger', 'cron', 'provider', 'none'));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- An alert e-mail went out and no all-clear followed it yet.
create or replace function app_private.all_clear_pending(p_session_id uuid)
returns boolean
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select coalesce(max(e.received_at) filter (where coalesce(e.meta ->> 'type', 'overdue') <> 'resolved'), '-infinity')
       > coalesce(max(e.received_at) filter (where e.meta ->> 'type' = 'resolved'), '-infinity')
  from public.checkin_events e
  where e.session_id = p_session_id and e.kind = 'alert_sent'
$$;

-- E-mail payload (names cleaned again for legacy rows; SOS wording from
-- alert_reason, else from an SOS event since the last check-in).
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

-- =============================================================================
-- 6. Devices: registration throttle
-- =============================================================================
create or replace function public.register_device(p_carrier text default null, p_app_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_secret  text := encode(gen_random_bytes(32), 'hex');
  v_id      uuid;
  v_carrier text := case when exists (select 1 from public.carriers c where c.id = p_carrier) then p_carrier end;
  v_ip      text := app_private.client_ip();
  v_hash    text;
begin
  if v_ip is not null then
    v_hash := encode(digest(coalesce(app_private.setting('ip_salt'), '') || '|' || v_ip, 'sha256'), 'hex');
    if (select count(*) from public.devices d
         where d.reg_ip_hash = v_hash and d.created_at > now() - interval '1 hour')
       >= app_private.limit_value('limit_register_ip_1h', 30) then
      raise exception 'rate_limited' using errcode = '54000', detail = 'register_ip_1h',
        hint = 'Too many new devices from this network in the last hour; try again later.';
    end if;
  end if;
  insert into public.devices (secret_hash, carrier, app_version, last_seen_at, reg_ip_hash)
  values (encode(digest(v_secret, 'sha256'), 'hex'), v_carrier, app_private.clean_text(p_app_version, 40), now(), v_hash)
  returning id into v_id;
  return jsonb_build_object('device_id', v_id, 'secret', v_secret);
end $$;

-- =============================================================================
-- 7. Device ops
-- =============================================================================

-- ---- op: buddy.start (e-mail required, names cleaned, per-device limit) ----------
create or replace function app_private.op_buddy_start(p_device public.devices, p_data jsonb, p_op_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v        jsonb := case when jsonb_typeof(p_data -> 'session') = 'object' then p_data -> 'session' else p_data end;
  v_id     uuid := coalesce(app_private.try_uuid(v ->> 'id'), app_private.try_uuid(v ->> 'session_id'),
                            app_private.try_uuid(p_data ->> 'session_id'), gen_random_uuid());
  v_email  text := lower(app_private.clean_text(coalesce(v -> 'recipient' ->> 'email', v ->> 'recipient_email'), 254));
  v_raw    text := app_private.clean_text(v ->> 'traveler_name', 200);
  v_name   text := app_private.clean_name(v ->> 'traveler_name', 60);
  -- offline-first: a start queued on the phone keeps its time, but never more than 24 h back
  v_start  timestamptz := greatest(least(coalesce(app_private.try_ts(v ->> 'started_at'),
                                                  app_private.try_ts(p_data ->> 'client_ts'), now()), now()),
                                   now() - interval '24 hours');
  v_int    int := greatest(1, least(coalesce(app_private.try_num(v ->> 'interval_min'), 60)::int, 10080));
  v_grace  int := greatest(0, least(coalesce(app_private.try_num(v ->> 'grace_min'), 15)::int, 1440));
  v_share  boolean := coalesce(app_private.try_bool(v ->> 'share_public_medical'), false);
  v_lat    double precision := coalesce(app_private.try_num(v ->> 'lat'), app_private.try_num(v ->> 'last_lat'));
  v_lng    double precision := coalesce(app_private.try_num(v ->> 'lng'), app_private.try_num(v ->> 'last_lng'));
  v_warn   jsonb := '[]'::jsonb;
  v_recent int;
  v_prev   public.buddy_sessions%rowtype;
  s        public.buddy_sessions%rowtype;
  v_old    public.buddy_sessions%rowtype;
begin
  if not (v_lat between -90 and 90 and v_lng between -180 and 180) then
    v_lat := null; v_lng := null;
  end if;
  -- e-mail is the only automatic alert channel: a session without it would never alert anyone
  if v_email is null or not app_private.valid_email(v_email) then
    raise exception 'recipient_email_required' using errcode = '22023',
      detail = case when v_email is null then 'missing' else 'invalid' end,
      hint = 'buddy.start needs a valid recipient e-mail (the phone number is only for the SMS fallback on the device).';
  end if;
  if v_raw is distinct from v_name then
    v_warn := v_warn || '"traveler_name_sanitized"'::jsonb;
  end if;

  select * into v_prev from public.buddy_sessions where id = v_id for update;
  if found and v_prev.device_id is distinct from p_device.id then
    raise exception 'session_conflict' using errcode = '42501', detail = 'session id belongs to another device';
  end if;

  if v_prev.id is null and not app_private.is_reserved_email(v_email) then
    select count(*)::int into v_recent
    from public.buddy_sessions b
    where b.device_id = p_device.id
      and b.created_at > now() - interval '24 hours'
      and b.recipient_email is not null
      and not app_private.is_reserved_email(b.recipient_email);
    if v_recent >= app_private.limit_value('limit_buddy_start_device_24h', 5) then
      raise exception 'rate_limited' using errcode = '54000', detail = 'buddy_start_device_24h',
        hint = 'Too many Buddy sessions from this device in 24 h; the on-device alert still works.';
    end if;
  end if;

  -- one open session per device: close older open sessions (a late re-send of an
  -- already closed session must not close the session that replaced it)
  for v_old in
    select * from public.buddy_sessions
    where device_id = p_device.id and status <> 'closed' and id <> v_id
      and (v_prev.id is null or v_prev.status <> 'closed')
    for update
  loop
    update public.buddy_sessions set status = 'closed', closed_at = now() where id = v_old.id;
    perform app_private.insert_event(v_old, 'stop', null, null, null, null, now(), false,
                                     null, jsonb_build_object('reason', 'superseded', 'by', v_id));
  end loop;

  insert into public.buddy_sessions as b (
    id, device_id, traveler_name, recipient_name, recipient_email, recipient_phone,
    interval_min, grace_min, route_id, travel_mode, share_public_medical, public_medical,
    status, started_at, last_checkin_at, next_due_at, last_lat, last_lng, last_location_at)
  values (
    v_id, p_device.id,
    v_name,
    app_private.clean_name(coalesce(v -> 'recipient' ->> 'name', v ->> 'recipient_name'), 60),
    v_email,
    app_private.clean_text(coalesce(v -> 'recipient' ->> 'phone', v ->> 'recipient_phone'), 32),
    v_int, v_grace,
    app_private.clean_text(v ->> 'route_id', 64),
    app_private.clean_text(v ->> 'travel_mode', 20),
    v_share,
    case when v_share then app_private.sanitize_public_medical(v -> 'public_medical') end,
    'active', v_start, v_start, v_start + make_interval(mins => v_int),
    v_lat, v_lng, case when v_lat is not null then v_start end)
  on conflict (id) do update set          -- re-sent start of the same device: refresh settings
    traveler_name        = excluded.traveler_name,
    recipient_name       = excluded.recipient_name,
    recipient_email      = excluded.recipient_email,
    recipient_phone      = excluded.recipient_phone,
    interval_min         = excluded.interval_min,
    grace_min            = excluded.grace_min,
    route_id             = excluded.route_id,
    travel_mode          = excluded.travel_mode,
    share_public_medical = excluded.share_public_medical,
    public_medical       = excluded.public_medical
  returning * into s;

  if v_prev.id is null then
    perform app_private.insert_event(
      s, 'start',
      coalesce(app_private.try_uuid(p_data ->> 'event_id'), app_private.try_uuid(p_data -> 'event' ->> 'id')),
      v_lat, v_lng, app_private.try_num(v ->> 'accuracy_m')::numeric, v_start,
      coalesce(app_private.try_bool(v ->> 'queued'), false) or now() - v_start > interval '2 minutes', null,
      jsonb_build_object('interval_min', v_int, 'grace_min', v_grace));
  end if;
  return jsonb_build_object('session_id', s.id, 'status', s.status, 'next_due_at', s.next_due_at,
                            'received_at', now(), 'warnings', v_warn);
end $$;

-- ---- op: buddy.checkin (SOS sets alert_reason 'sos'; SOS after an overdue alert re-alerts) ----
create or replace function app_private.op_buddy_checkin(p_device public.devices, p_data jsonb, p_op_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v        jsonb := case when jsonb_typeof(p_data -> 'event') = 'object' then p_data -> 'event' else p_data end;
  v_kind   text := coalesce(nullif(v ->> 'kind', ''), 'checkin');
  v_ts     timestamptz := least(coalesce(app_private.try_ts(v ->> 'client_ts'), now()), now());
  v_lat    double precision := app_private.try_num(v ->> 'lat');
  v_lng    double precision := app_private.try_num(v ->> 'lng');
  v_queued boolean := coalesce(app_private.try_bool(v ->> 'queued'), now() - v_ts > interval '2 minutes');
  v_meta   jsonb := case when jsonb_typeof(v -> 'meta') = 'object' then v -> 'meta' end;
  s        public.buddy_sessions%rowtype;
  v_prev   text;
  v_last   timestamptz;
  v_event  uuid;
  v_notify boolean := false;   -- send the "all clear" (alerted → active)
  v_escalate boolean := false; -- send the alert now
begin
  if v_kind not in ('checkin', 'location', 'pre_deadzone', 'sos', 'overdue') then
    raise exception 'invalid_kind' using errcode = '22023', detail = v_kind;
  end if;
  if not (v_lat between -90 and 90 and v_lng between -180 and 180) then
    v_lat := null; v_lng := null;
  end if;
  if v_meta is not null and octet_length(v_meta::text) > 4000 then
    v_meta := jsonb_build_object('truncated', true);
  end if;

  s := app_private.op_session(p_device, coalesce(app_private.try_uuid(v ->> 'session_id'),
                                                 app_private.try_uuid(p_data ->> 'session_id')));
  v_prev := s.status;

  v_event := app_private.insert_event(
    s, v_kind,
    coalesce(app_private.try_uuid(v ->> 'event_id'), app_private.try_uuid(v ->> 'id')),
    v_lat, v_lng, app_private.try_num(v ->> 'accuracy_m')::numeric, v_ts, v_queued,
    v ->> 'note', v_meta);

  if s.status = 'closed' then
    return jsonb_build_object('event_id', v_event, 'received_at', now(), 'status', s.status,
                              'ignored', 'session_closed');
  end if;

  if v_lat is not null and (s.last_location_at is null or v_ts >= s.last_location_at) then
    s.last_lat := v_lat; s.last_lng := v_lng; s.last_location_at := v_ts;
  end if;

  if v_kind = 'checkin' then
    v_last := greatest(coalesce(s.last_checkin_at, v_ts), v_ts);
    s.last_checkin_at := v_last;
    s.next_due_at := v_last + make_interval(mins => s.interval_min);
    if s.status in ('overdue', 'alerted') then
      v_notify := (s.status = 'alerted');
      s.status := 'active';
      s.alerted_at := null;
      s.alert_reason := null;
      perform app_private.insert_event(s, 'resolved', null, v_lat, v_lng, null, now(), false, null,
                                       jsonb_build_object('reason', 'checkin', 'previous_status', v_prev));
    end if;
  elsif v_kind = 'sos' then
    -- SOS is an emergency: escalate an active session, and re-alert when the recipient was only
    -- told about a missed check-in (the next e-mail is worded as SOS). Same rule as backend-local.js.
    if s.status = 'active' or (s.status = 'alerted' and s.alert_reason is distinct from 'sos') then
      s.status := 'overdue';
      s.alerted_at := null;
      v_escalate := true;
    elsif s.status = 'overdue' and s.alert_reason is distinct from 'sos' then
      v_escalate := true;
    end if;
    if s.status in ('overdue', 'alerted') then
      s.alert_reason := 'sos';
    end if;
  elsif v_kind = 'overdue' and s.status = 'active' then
    -- overdue detected on the device while offline
    s.status := 'overdue';
    s.alerted_at := null;
    s.alert_reason := 'overdue';
    v_escalate := true;
  end if;

  update public.buddy_sessions set
    status           = s.status,
    alert_reason     = s.alert_reason,
    last_checkin_at  = s.last_checkin_at,
    next_due_at      = s.next_due_at,
    last_lat         = s.last_lat,
    last_lng         = s.last_lng,
    last_location_at = s.last_location_at,
    alerted_at       = s.alerted_at
  where id = s.id;

  if v_notify then
    perform app_private.notify_deadman(jsonb_build_object('session_id', s.id, 'type', 'resolved'));
  elsif v_escalate and s.recipient_email is not null then
    -- do not wait for the next cron tick (pg_net sends after this transaction commits)
    perform app_private.notify_deadman(jsonb_build_object('source', v_kind, 'type', 'overdue'));
  end if;
  return jsonb_build_object('event_id', v_event, 'received_at', now(), 'status', s.status,
                            'alert_reason', s.alert_reason, 'next_due_at', s.next_due_at);
end $$;

-- ---- op: buddy.update (consent withdrawn / given: medical layer of the open session) ----
create or replace function app_private.op_buddy_update(p_device public.devices, p_data jsonb, p_op_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  s       public.buddy_sessions%rowtype;
  v_share boolean;
begin
  s := app_private.op_session(p_device, coalesce(app_private.try_uuid(p_data ->> 'session_id'),
                                                 app_private.try_uuid(p_data ->> 'id')));
  if s.status = 'closed' then
    return jsonb_build_object('session_id', s.id, 'status', s.status, 'received_at', now(), 'ignored', 'session_closed');
  end if;
  v_share := coalesce(app_private.try_bool(p_data ->> 'share_public_medical'), s.share_public_medical);
  update public.buddy_sessions set
    share_public_medical = v_share,
    public_medical = case when not v_share then null
                          when p_data ? 'public_medical' then app_private.sanitize_public_medical(p_data -> 'public_medical')
                          else public_medical end
  where id = s.id
  returning * into s;
  return jsonb_build_object('session_id', s.id, 'status', s.status, 'share_public_medical', s.share_public_medical,
                            'has_public_medical', s.public_medical is not null, 'received_at', now());
end $$;

-- ---- op: device.erase (delete everything this device owns on the server) ----------
-- Open sessions are closed WITHOUT an alert and deleted with their events;
-- community reports stay but lose the device link; device_ops and the device
-- row go. If a recipient was alerted and never got the all-clear, it is sent
-- from an inline payload (the Edge Function cannot read the deleted row).
create or replace function app_private.op_device_erase(p_device public.devices, p_data jsonb, p_op_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  s          public.buddy_sessions%rowtype;
  v_sessions int := 0;
  v_events   int := 0;
  v_subs     int := 0;
  v_clear    int := 0;
  v_audit    text := current_setting('nc.audit', true);
begin
  for s in select * from public.buddy_sessions where device_id = p_device.id order by started_at for update loop
    if s.recipient_email is not null and app_private.all_clear_pending(s.id) then
      perform app_private.notify_deadman(jsonb_build_object(
        'type', 'resolved', 'session_id', s.id, 'source', 'erase',
        'inline', app_private.alert_payload(s, 'resolved', now())));
      v_clear := v_clear + 1;
    end if;
    if s.status <> 'closed' then
      update public.buddy_sessions set status = 'closed', closed_at = now() where id = s.id;
    end if;
  end loop;
  select count(*)::int into v_events
  from public.checkin_events e join public.buddy_sessions b on b.id = e.session_id
  where b.device_id = p_device.id;
  delete from public.buddy_sessions where device_id = p_device.id;          -- events cascade
  get diagnostics v_sessions = row_count;
  -- unlink community reports without copying the device id into the audit trail,
  -- and drop it from the snapshots the trail already holds
  perform set_config('nc.audit', 'off', true);
  update public.facility_submissions set device_id = null where device_id = p_device.id;
  get diagnostics v_subs = row_count;
  perform set_config('nc.audit', coalesce(nullif(v_audit, ''), 'on'), true);
  update public.audit_log set details = jsonb_set(details, '{row,device_id}', 'null'::jsonb)
   where entity = 'facility_submissions' and details -> 'row' ->> 'device_id' = p_device.id::text;
  delete from public.devices where id = p_device.id;                         -- device_ops cascade
  return jsonb_build_object('erased', true, 'sessions_deleted', v_sessions, 'events_deleted', v_events,
                            'submissions_unlinked', v_subs, 'all_clear_sent', v_clear, 'received_at', now());
end $$;

-- ---- dispatcher (+ buddy.update, device.erase) ---------------------------------------
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
    when 'buddy.start'   then return app_private.op_buddy_start(p_device, p_data, p_op_id);
    when 'buddy.checkin' then return app_private.op_buddy_checkin(p_device, p_data, p_op_id);
    when 'buddy.stop'    then return app_private.op_buddy_stop(p_device, p_data, p_op_id);
    when 'buddy.resolve' then return app_private.op_buddy_resolve(p_device, p_data, p_op_id);
    when 'buddy.update'  then return app_private.op_buddy_update(p_device, p_data, p_op_id);
    when 'report.submit' then return app_private.op_report_submit(p_device, p_data, p_op_id);
    when 'signal.log'    then return app_private.op_signal_log(p_device, p_data, p_op_id);
    when 'device.erase'  then return app_private.op_device_erase(p_device, p_data, p_op_id);
    else
      raise exception 'unknown_op' using errcode = '22023', detail = coalesce(p_op, 'null');
  end case;
end $$;

-- Batch sync (as 0500) + device.erase: ops after an erase in the same batch get
-- 'device_erased'; a batch with device.erase for a device that no longer exists
-- (tombstone replay) succeeds without touching anything.
create or replace function public.sync_device_ops(p_device_id uuid, p_secret text, p_ops jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  d        public.devices%rowtype;
  v_ops    jsonb := coalesce(p_ops, '[]'::jsonb);
  v_op     jsonb;
  v_id     uuid;
  v_kind   text;
  v_data   jsonb;
  v_prev   jsonb;
  v_res    jsonb := '[]'::jsonb;
  v_msg    text;
  v_state  text;
  v_erased boolean := false;
  v_tomb   boolean := false;
begin
  -- nested tests: AND does not guarantee evaluation order (jsonb_array_length raises on a non-array)
  if jsonb_typeof(v_ops) = 'array' then
    if jsonb_array_length(v_ops) <= 200 then
      v_tomb := exists (select 1 from jsonb_array_elements(v_ops) o where o ->> 'op' = 'device.erase')
                and not exists (select 1 from public.devices x where x.id = p_device_id);
    end if;
  end if;
  if v_tomb then
    return jsonb_build_object(
      'results', coalesce((
        select jsonb_agg(case when o ->> 'op' = 'device.erase'
                              then jsonb_build_object('id', o -> 'id', 'status', 'ok',
                                                      'data', jsonb_build_object('erased', true, 'already_erased', true))
                              else jsonb_build_object('id', o -> 'id', 'status', 'error', 'error', 'device_erased',
                                                      'retryable', false) end order by n)
        from jsonb_array_elements(v_ops) with ordinality as x(o, n)), '[]'::jsonb),
      'server_time', now(),
      'session', null);
  end if;

  d := app_private.verify_device(p_device_id, p_secret);
  if jsonb_typeof(v_ops) <> 'array' then
    raise exception 'invalid_ops' using errcode = '22023';
  end if;
  if jsonb_array_length(v_ops) > 200 then
    raise exception 'too_many_ops' using errcode = '22023', hint = 'Send at most 200 ops per call.';
  end if;
  update public.devices set last_seen_at = now() where id = d.id;

  for v_op in select e.value from jsonb_array_elements(v_ops) with ordinality as e(value, n) order by e.n loop
    v_id := app_private.try_uuid(v_op ->> 'id');
    v_kind := v_op ->> 'op';
    if v_erased then
      v_res := v_res || jsonb_build_array(jsonb_build_object(
        'id', v_op -> 'id', 'status', 'error', 'error', 'device_erased', 'retryable', false));
      continue;
    end if;
    if v_id is null then
      v_res := v_res || jsonb_build_array(jsonb_build_object(
        'id', v_op -> 'id', 'status', 'error', 'error', 'invalid_op_id', 'retryable', false));
      continue;
    end if;
    begin
      insert into public.device_ops (id, device_id, op) values (v_id, d.id, coalesce(v_kind, '?'))
      on conflict (id) do nothing;
      if not found then
        select o.result into v_prev from public.device_ops o where o.id = v_id;
        v_res := v_res || jsonb_build_array(jsonb_build_object(
          'id', v_id, 'status', 'duplicate', 'data', v_prev -> 'data'));
        continue;
      end if;
      v_data := app_private.apply_device_op(d, v_kind, v_op -> 'data', v_id);
      if v_kind = 'device.erase' then
        v_erased := true;                 -- the device row and its device_ops are gone
      else
        update public.device_ops set result = jsonb_build_object('status', 'ok', 'data', v_data) where id = v_id;
      end if;
      v_res := v_res || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'ok', 'data', v_data));
    exception when others then
      get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
      -- 54000 = rate_limited (buddy.start over the per-device limit): permanent for that op. A retried
      -- start would land once the 24 h window slides, backdated to its queue time, i.e. already overdue,
      -- possibly after the user stopped the session: a false alarm to the contact.
      v_res := v_res || jsonb_build_array(jsonb_build_object(
        'id', v_id, 'status', 'error', 'error', v_msg, 'code', v_state,
        'retryable', not (v_state like '22%' or v_state like '23%' or v_state in ('P0002', '28000', '42501', '54000'))));
    end;
  end loop;

  return jsonb_build_object(
    'results',     v_res,
    'server_time', now(),
    'session',     case when v_erased then null else app_private.device_session_json(d.id) end);
end $$;

-- =============================================================================
-- 8. Cron / Edge Function API
-- =============================================================================
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
  perform app_private.flag_rate_limited();
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

-- Daily retention job.
create or replace function public.nc_cleanup()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_ops      int;
  v_sessions int;
  v_events   int;
  v_ips      int;
begin
  if not (app_private.is_trusted_caller() or public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.device_ops where received_at < now() - interval '30 days';
  get diagnostics v_ops = row_count;
  -- closed > 30 days ago, or abandoned (no change for 90 days): session + events (cascade)
  with old as (
    select s.id from public.buddy_sessions s
    where (s.status = 'closed' and coalesce(s.closed_at, s.updated_at) < now() - interval '30 days')
       or (s.status <> 'closed' and s.updated_at < now() - interval '90 days')
  ), ev as (
    select count(*)::int as n from public.checkin_events e where e.session_id in (select id from old)
  ), del as (
    delete from public.buddy_sessions s using old where s.id = old.id returning 1
  )
  select (select count(*)::int from del), (select n from ev) into v_sessions, v_events;
  update public.devices set reg_ip_hash = null
   where reg_ip_hash is not null and created_at < now() - interval '24 hours';
  get diagnostics v_ips = row_count;
  return jsonb_build_object('device_ops_deleted', v_ops, 'sessions_deleted', v_sessions,
                            'events_deleted', v_events, 'ip_hashes_cleared', v_ips, 'at', now());
end $$;

-- Claims sessions to alert (see 0800) + p_actor (admin behind a manual trigger)
-- + abuse quota on the cron path (re-checked for every claim of the batch).
drop function if exists public.nc_alert_claim(uuid, text, boolean, int);
create or replace function public.nc_alert_claim(p_session_id uuid default null, p_type text default 'overdue',
                                                 p_force boolean default false, p_limit int default 25,
                                                 p_actor uuid default null)
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
  perform app_private.set_actor(p_actor);

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
    -- manual trigger by an admin: never rate-limited
    select * into s from public.buddy_sessions where id = p_session_id for update;
    if not found or s.status = 'closed' or s.recipient_email is null then
      return v_out;
    end if;
    if s.status in ('overdue', 'active') then
      update public.buddy_sessions set alerted_at = v_now where id = s.id returning * into s;
    end if;
    return jsonb_build_array(app_private.alert_payload(s, 'overdue', v_now));
  end if;

  perform app_private.flag_rate_limited();
  for s in
    select * from public.buddy_sessions b
    where app_private.alert_due(b) and (p_session_id is null or b.id = p_session_id)
    order by b.next_due_at nulls last
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    for update skip locked
  loop
    -- an earlier claim of this batch may have used the recipient's quota
    if app_private.alert_quota_block(s.recipient_email) is not null then
      perform app_private.flag_rate_limited(s.id);
      continue;
    end if;
    update public.buddy_sessions set alerted_at = v_now where id = s.id returning * into s;
    v_out := v_out || jsonb_build_array(app_private.alert_payload(s, 'overdue', v_now));
  end loop;
  return v_out;
end $$;

-- Records the outcome of one e-mail (see 0800) + p_actor, p_reason (reason the
-- e-mail was worded with). An overdue e-mail that crossed an SOS keeps the
-- session 'overdue' so the SOS e-mail follows on the next tick.
drop function if exists public.nc_alert_result(uuid, boolean, text, text, text, text, text);
create or replace function public.nc_alert_result(p_session_id uuid, p_ok boolean, p_type text default 'overdue',
                                                  p_provider text default 'resend', p_provider_id text default null,
                                                  p_error text default null, p_trigger text default 'cron',
                                                  p_actor uuid default null, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  s           public.buddy_sessions%rowtype;
  v_meta      jsonb;
  v_label     text;
  v_all_clear boolean := false;
begin
  if not app_private.is_trusted_caller() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_label := app_private.set_actor(p_actor);
  select * into s from public.buddy_sessions where id = p_session_id for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  v_meta := jsonb_strip_nulls(jsonb_build_object(
    'type', coalesce(p_type, 'overdue'), 'provider', p_provider, 'id', p_provider_id,
    'error', left(p_error, 500), 'trigger', p_trigger,
    'reason', case when p_ok then p_reason else 'send_failed' end,
    'alert_reason', case when not p_ok then p_reason end,
    'actor', v_label));

  if coalesce(p_type, 'overdue') = 'overdue' then
    if p_ok then
      if s.status = 'overdue' and s.alert_reason = 'sos' and p_reason is not null and p_reason <> 'sos' then
        -- the traveller pressed SOS while the missed-check-in e-mail was on its way
        update public.buddy_sessions set alerted_at = null where id = s.id returning * into s;
      elsif s.status = 'overdue' or (p_trigger = 'manual' and s.status in ('active', 'alerted')) then
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
  return jsonb_build_object('session_id', s.id, 'status', s.status, 'alerted_at', s.alerted_at,
                            'alert_reason', s.alert_reason);
end $$;

-- =============================================================================
-- 9. Pack publishing: content comparison, no-op publish, change report
-- =============================================================================

-- Pack content without the fields that change on every build or every day
-- (version, published_at, size_bytes, facility freshness).
create or replace function app_private.pack_content(p jsonb)
returns jsonb
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select case when p is null or jsonb_typeof(p) <> 'object' then null else
    (p - array['version', 'published_at', 'size_bytes', 'source', 'facilities'])
    || jsonb_build_object('facilities', coalesce((
         select jsonb_agg(f - array['is_stale', 'days_since_verified'] order by f ->> 'id')
         from jsonb_array_elements(case when jsonb_typeof(p -> 'facilities') = 'array'
                                        then p -> 'facilities' else '[]'::jsonb end) f), '[]'::jsonb))
  end
$$;

create or replace function app_private.pack_content_hash(p jsonb)
returns text
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select case when p is null then null else encode(digest(app_private.pack_content(p)::text, 'sha256'), 'hex') end
$$;

-- {added:[{id,name,type}], removed:[{id,name,type,reason}], updated:[{id,name,type,fields}]}
-- between two pack item arrays; removed.reason = deleted | pending | rejected |
-- inactive | moved (still listed but no longer in this route's corridor).
create or replace function app_private.pack_item_diff(p_pub jsonb, p_live jsonb, p_facility boolean)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with pub as (
    select x ->> 'id' as id, x - array['is_stale', 'days_since_verified'] as j
    from jsonb_array_elements(case when jsonb_typeof(p_pub) = 'array' then p_pub else '[]'::jsonb end) x
  ), live as (
    select x ->> 'id' as id, x - array['is_stale', 'days_since_verified'] as j
    from jsonb_array_elements(case when jsonb_typeof(p_live) = 'array' then p_live else '[]'::jsonb end) x
  )
  select jsonb_build_object(
    'added', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.j ->> 'name', 'type', l.j ->> 'type')
                       order by l.j ->> 'name', l.id)
      from live l where not exists (select 1 from pub p where p.id = l.id)), '[]'::jsonb),
    'removed', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.j ->> 'name', 'type', p.j ->> 'type',
               'reason', case
                 when p_facility then (select case when f.id is null then 'deleted'
                                                   when f.status <> 'verified' then f.status else 'moved' end
                                       from (select 1) one left join public.facilities f on f.id = p.id)
                 else (select case when sv.id is null then 'deleted'
                                   when sv.status <> 'active' then sv.status else 'moved' end
                       from (select 1) one left join public.services sv on sv.id = p.id)
               end) order by p.j ->> 'name', p.id)
      from pub p where not exists (select 1 from live l where l.id = p.id)), '[]'::jsonb),
    'updated', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.j ->> 'name', 'type', l.j ->> 'type',
               'fields', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
                          from jsonb_object_keys(l.j || p.j) k
                          where (l.j -> k) is distinct from (p.j -> k)))
             order by l.j ->> 'name', l.id)
      from live l join pub p on p.id = l.id
      where l.j is distinct from p.j), '[]'::jsonb))
$$;

-- Snapshot the live pack as version = max + 1 — unless its content equals the
-- current pack (then the current one is returned with unchanged = true).
drop function if exists app_private.publish_pack(text, text, text, uuid);
create or replace function app_private.publish_pack(p_route_id text, p_carrier text, p_notes text default null,
                                                    p_actor uuid default null, p_force boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_version int;
  v_now     timestamptz := now();
  v_payload jsonb;
  v_size    int;
  v_sum     text;
  c         public.data_packs%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('nomadcare.pack:' || coalesce(p_route_id, '') || ':' || coalesce(p_carrier, '')));
  select coalesce(max(p.version), 0) + 1 into v_version
  from public.data_packs p where p.route_id = p_route_id and p.carrier = p_carrier;

  v_payload := app_private.build_pack(p_route_id, p_carrier, v_version, v_now);   -- raises if unknown

  select * into c from public.data_packs p
  where p.route_id = p_route_id and p.carrier = p_carrier and p.is_current
  order by p.version desc limit 1;
  if not coalesce(p_force, false) and c.id is not null and c.payload is not null
     and app_private.pack_content_hash(c.payload) = app_private.pack_content_hash(v_payload) then
    return jsonb_build_object('route_id', p_route_id, 'carrier', p_carrier, 'version', c.version,
                              'size_bytes', c.size_bytes, 'checksum', c.checksum, 'published_at', c.published_at,
                              'unchanged', true);
  end if;

  v_size := (v_payload ->> 'size_bytes')::int;
  v_sum := encode(digest(v_payload::text, 'sha256'), 'hex');
  update public.data_packs set is_current = false
   where route_id = p_route_id and carrier = p_carrier and is_current;
  insert into public.data_packs (route_id, carrier, version, published_at, published_by, notes,
                                 size_bytes, checksum, payload, is_current)
  values (p_route_id, p_carrier, v_version, v_now, p_actor, app_private.clean_text(p_notes, 500),
          v_size, v_sum, v_payload, true);

  return jsonb_build_object('route_id', p_route_id, 'carrier', p_carrier, 'version', v_version,
                            'size_bytes', v_size, 'checksum', v_sum, 'published_at', v_now, 'unchanged', false);
end $$;

drop function if exists public.admin_publish_pack(text, text, text);
create or replace function public.admin_publish_pack(p_route_id text, p_carrier text, p_notes text default null,
                                                     p_force boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform app_private.require_admin();
  return app_private.publish_pack(p_route_id, p_carrier, p_notes, auth.uid(), p_force);
end $$;

-- Unpublished changes per route × carrier (closures and deletions included):
-- [{route_id, carrier, version, published_at, published, changed, count,
--   facilities:{added,removed,updated}, services:{…}, other:[section…],
--   live_checksum, published_checksum}]
create or replace function public.admin_pack_changes(p_route_id text default null, p_carrier text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  r       record;
  c       public.data_packs%rowtype;
  v_live  jsonb;
  v_pub   jsonb;
  v_fac   jsonb;
  v_svc   jsonb;
  v_other jsonb;
  v_out   jsonb := '[]'::jsonb;
begin
  perform app_private.require_admin();
  for r in
    select ro.id as route_id, ca.id as carrier
    from public.routes ro cross join public.carriers ca
    where ro.is_active and (p_route_id is null or ro.id = p_route_id) and (p_carrier is null or ca.id = p_carrier)
    order by ro.sort, ro.id, ca.sort, ca.id
  loop
    select * into c from public.data_packs p
    where p.route_id = r.route_id and p.carrier = r.carrier and p.is_current
    order by p.version desc limit 1;
    v_pub := c.payload;
    v_live := app_private.build_pack(r.route_id, r.carrier, coalesce(c.version, 0), coalesce(c.published_at, now()));
    v_fac := app_private.pack_item_diff(v_pub -> 'facilities', v_live -> 'facilities', true);
    v_svc := app_private.pack_item_diff(v_pub -> 'services', v_live -> 'services', false);
    select coalesce(jsonb_agg(k order by k), '[]'::jsonb) into v_other
    from unnest(array['schema', 'route', 'nodes', 'edges', 'segments', 'model_version', 'accuracy', 'holdout_n']) k
    where v_pub is not null and (v_pub -> k) is distinct from (v_live -> k);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'route_id',     r.route_id,
      'carrier',      r.carrier,
      'version',      coalesce(c.version, 0),
      'published_at', c.published_at,
      'published',    v_pub is not null,
      'changed',      v_pub is null or app_private.pack_content_hash(v_pub) is distinct from app_private.pack_content_hash(v_live),
      'count',        jsonb_array_length(v_fac -> 'added') + jsonb_array_length(v_fac -> 'removed')
                      + jsonb_array_length(v_fac -> 'updated') + jsonb_array_length(v_svc -> 'added')
                      + jsonb_array_length(v_svc -> 'removed') + jsonb_array_length(v_svc -> 'updated')
                      + jsonb_array_length(v_other),
      'facilities',   v_fac,
      'services',     v_svc,
      'other',        v_other,
      'live_checksum',      app_private.pack_content_hash(v_live),
      'published_checksum', app_private.pack_content_hash(v_pub)));
  end loop;
  return v_out;
end $$;

-- =============================================================================
-- 10. Admin RPCs: submissions, samples, facilities
-- =============================================================================
create or replace function public.admin_review_submission(p_id text, p_status text, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  s        public.facility_submissions%rowtype;
  p        jsonb;
  v_fac    text;
  v_lat    double precision;
  v_lng    double precision;
  v_route  text;
  v_type   text;
  v_note   text := app_private.clean_text(p_note, 500);
begin
  perform app_private.require_admin();
  if p_status not in ('approved', 'rejected', 'pending') then
    raise exception 'invalid_status' using errcode = '22023', detail = coalesce(p_status, 'null');
  end if;
  select * into s from public.facility_submissions where id = p_id for update;
  if not found then
    raise exception 'submission_not_found' using errcode = 'P0002', detail = coalesce(p_id, 'null');
  end if;
  p := coalesce(s.payload, '{}'::jsonb);
  v_fac := s.facility_id;

  if p_status = 'approved' and s.status <> 'approved' then
    if s.kind = 'new' then
      if v_fac is not null and exists (select 1 from public.facilities x where x.id = v_fac) then
        null;   -- re-approval of a reopened report: keep the facility created the first time
      else
        v_lat := coalesce(s.lat, app_private.try_num(p ->> 'lat'));
        v_lng := coalesce(s.lng, app_private.try_num(p ->> 'lng'));
        v_type := case when p ->> 'type' in ('tram_y_te', 'phong_kham', 'benh_vien', 'nha_thuoc') then p ->> 'type' end;
        v_route := case when exists (select 1 from public.routes r where r.id = p ->> 'route_id') then p ->> 'route_id' end;
        if v_route is null and v_lat is not null then
          select e.route_id into v_route
          from public.route_edges e
          where ST_DWithin(e.geom, app_private.pt(v_lat, v_lng), 20000)
          order by e.geom <-> app_private.pt(v_lat, v_lng)
          limit 1;
        end if;
        insert into public.facilities (id, route_id, name, type, address, geom, phone, open_hours,
                                       status, source, notes)
        values (coalesce(v_fac, gen_random_uuid()::text), v_route,
                coalesce(app_private.clean_text(p ->> 'name', 160), 'Điểm y tế cộng đồng đề xuất'),
                v_type,
                app_private.clean_text(p ->> 'address', 300),
                app_private.pt(v_lat, v_lng),
                app_private.clean_text(p ->> 'phone', 32),
                app_private.clean_text(p ->> 'open_hours', 120),
                'pending', 'community',
                concat_ws(E'\n', 'Từ đóng góp cộng đồng #' || s.id, app_private.clean_text(p ->> 'note', 500), v_note))
        returning id into v_fac;
      end if;
    elsif s.kind = 'closed' and v_fac is not null then
      update public.facilities
         set status = case when status = 'verified' then 'pending' else status end,
             notes  = case when position('(#' || s.id || ')' in coalesce(notes, '')) > 0 then notes
                           else concat_ws(E'\n', notes, 'Báo đóng cửa (#' || s.id || ')' || coalesce(': ' || v_note, '')) end
       where id = v_fac;
    elsif s.kind = 'correction' and v_fac is not null then
      update public.facilities
         set notes = case when position('(#' || s.id || ')' in coalesce(notes, '')) > 0 then notes
                          else concat_ws(E'\n', notes, 'Đề xuất sửa (#' || s.id || '): '
                                         || coalesce(app_private.clean_text(p ->> 'note', 500), p::text)) end
       where id = v_fac;
    end if;
  end if;

  update public.facility_submissions set
    status      = p_status,
    review_note = v_note,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    facility_id = v_fac
  where id = s.id
  returning * into s;

  return jsonb_build_object('id', s.id, 'kind', s.kind, 'status', s.status,
                            'facility_id', s.facility_id, 'reviewed_at', s.reviewed_at);
end $$;

-- Only rows whose status changes are counted; one aggregated audit row per call.
create or replace function public.admin_review_samples(p_ids bigint[], p_status text)
returns int
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_n     int;
  v_ids   bigint[];
  v_actor uuid;
begin
  perform app_private.require_admin();
  if p_status not in ('approved', 'pending', 'rejected') then
    raise exception 'invalid_status' using errcode = '22023', detail = coalesce(p_status, 'null');
  end if;
  with u as (
    update public.signal_samples set status = p_status
     where id = any (coalesce(p_ids, '{}')) and status is distinct from p_status
    returning id
  )
  select count(*)::int, array_agg(id order by id) into v_n, v_ids from u;
  if v_n > 0 and coalesce(current_setting('nc.audit', true), 'on') <> 'off' then
    v_actor := coalesce(auth.uid(), app_private.try_uuid(current_setting('nc.actor_id', true)));
    insert into public.audit_log (actor, actor_label, action, entity, entity_id, details)
    values (v_actor, app_private.actor_label(v_actor), 'status', 'signal_samples', 'batch',
            jsonb_build_object('count', v_n, 'status', p_status, 'ids', to_jsonb(v_ids[1:50]),
                               'truncated', v_n > 50));
  end if;
  return v_n;
end $$;

-- As 0600 + 'invalid_date' (verification date in the future) and a Vietnam
-- bounding box for verified facilities ('invalid_coordinates', detail outside_vietnam).
create or replace function public.admin_upsert_facility(p_row jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  f        public.facilities%rowtype;
  v_exists boolean := false;
  v_miss   text[];
  v_lat    double precision;
  v_lng    double precision;
begin
  perform app_private.require_admin();
  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    raise exception 'invalid_row' using errcode = '22023';
  end if;
  if p_row ? 'id' and nullif(p_row ->> 'id', '') is not null then
    select * into f from public.facilities where id = p_row ->> 'id' for update;
    v_exists := found;
    f.id := p_row ->> 'id';
  else
    f.id := gen_random_uuid()::text;
  end if;
  if not v_exists then
    f.status := 'pending'; f.source := 'team'; f.is_demo := true;
  end if;

  if p_row ? 'route_id'       then f.route_id := nullif(p_row ->> 'route_id', ''); end if;
  if p_row ? 'name'           then f.name := app_private.clean_text(p_row ->> 'name', 160); end if;
  if p_row ? 'type'           then f.type := nullif(p_row ->> 'type', ''); end if;
  if p_row ? 'address'        then f.address := app_private.clean_text(p_row ->> 'address', 300); end if;
  if p_row ? 'phone'          then f.phone := app_private.clean_text(p_row ->> 'phone', 32); end if;
  if p_row ? 'open_hours'     then f.open_hours := app_private.clean_text(p_row ->> 'open_hours', 120); end if;
  if p_row ? 'night_shift'    then f.night_shift := app_private.try_bool(p_row ->> 'night_shift'); end if;
  if p_row ? 'trauma_capable' then f.trauma_capable := app_private.try_bool(p_row ->> 'trauma_capable'); end if;
  if p_row ? 'verified_by'    then f.verified_by := app_private.clean_text(p_row ->> 'verified_by', 120); end if;
  if p_row ? 'verified_at'    then f.verified_at := app_private.try_ts(p_row ->> 'verified_at')::date; end if;
  if p_row ? 'status'         then f.status := coalesce(nullif(p_row ->> 'status', ''), f.status); end if;
  if p_row ? 'source'         then f.source := coalesce(nullif(p_row ->> 'source', ''), f.source); end if;
  if p_row ? 'notes'          then f.notes := app_private.clean_text(p_row ->> 'notes', 2000); end if;
  if p_row ? 'is_demo'        then f.is_demo := coalesce(app_private.try_bool(p_row ->> 'is_demo'), f.is_demo); end if;
  if p_row ? 'lat' or p_row ? 'lng' then
    v_lat := app_private.try_num(p_row ->> 'lat');
    v_lng := app_private.try_num(p_row ->> 'lng');
    if v_lat is null or v_lng is null then
      f.geom := null;
    elsif v_lat between -90 and 90 and v_lng between -180 and 180 then
      f.geom := app_private.pt(v_lat, v_lng);
    else
      raise exception 'invalid_coordinates' using errcode = '22023';
    end if;
  end if;

  if not v_exists and p_row ? 'id' and not (p_row ? 'name') then
    raise exception 'facility_not_found' using errcode = 'P0002', detail = p_row ->> 'id';
  end if;
  if f.type is not null and f.type not in ('tram_y_te', 'phong_kham', 'benh_vien', 'nha_thuoc') then
    raise exception 'invalid_type' using errcode = '22023', detail = f.type;
  end if;
  if f.status is null or f.status not in ('verified', 'pending', 'rejected') then
    raise exception 'invalid_status' using errcode = '22023', detail = coalesce(f.status, 'null');
  end if;
  -- a typo like 2062 would otherwise keep a facility "fresh" for decades (one day of
  -- tolerance for admins in time zones ahead of Vietnam)
  if f.verified_at is not null and (f.verified_at > app_private.today_vn() + 1 or f.verified_at < date '2000-01-01') then
    raise exception 'invalid_date' using errcode = '22023', detail = f.verified_at::text,
      hint = 'The verification date cannot be in the future.';
  end if;
  if f.status = 'verified' and f.geom is not null
     and not (ST_Y(f.geom::geometry) between 8.1 and 23.5 and ST_X(f.geom::geometry) between 102.1 and 109.6) then
    raise exception 'invalid_coordinates' using errcode = '22023', detail = 'outside_vietnam',
      hint = 'A verified facility must be inside Vietnam (lat 8.1–23.5, lng 102.1–109.6).';
  end if;

  if f.status = 'verified' then
    v_miss := app_private.facility_missing_fields(f);
    if cardinality(v_miss) > 0 then
      raise exception 'incomplete' using errcode = '23514',
        detail = to_jsonb(v_miss)::text,
        hint = 'A verified facility needs every field (PDF 8.1); keep it pending until complete.';
    end if;
  end if;

  if v_exists then
    update public.facilities set
      route_id = f.route_id, name = f.name, type = f.type, address = f.address, geom = f.geom,
      phone = f.phone, open_hours = f.open_hours, night_shift = f.night_shift,
      trauma_capable = f.trauma_capable, verified_by = f.verified_by, verified_at = f.verified_at,
      status = f.status, source = f.source, notes = f.notes, is_demo = f.is_demo
    where id = f.id;
  else
    insert into public.facilities (id, route_id, name, type, address, geom, phone, open_hours, night_shift,
                                   trauma_capable, verified_by, verified_at, status, source, notes, is_demo)
    values (f.id, f.route_id, f.name, f.type, f.address, f.geom, f.phone, f.open_hours, f.night_shift,
            f.trauma_capable, f.verified_by, f.verified_at, f.status, f.source, f.notes, f.is_demo);
  end if;
  return (select to_jsonb(v) from public.v_facilities v where v.id = f.id);
end $$;

-- =============================================================================
-- 11. Realtime: packs, content releases, services, audit log
-- =============================================================================
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publication supabase_realtime not found: realtime not configured (dashboard falls back to polling)';
    return;
  end if;
  if (select puballtables from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array['data_packs', 'content_releases', 'services', 'audit_log'] loop
    if exists (select 1 from pg_publication_tables
                where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      continue;
    end if;
    if t = 'data_packs' and current_setting('server_version_num')::int >= 150000 then
      -- the pack payload (tens of kB) is not needed live: the dashboard re-reads the list
      begin
        execute 'alter publication supabase_realtime add table public.data_packs (id, route_id, carrier, version, '
             || 'published_at, published_by, notes, size_bytes, checksum, is_current)';
        continue;
      exception when others then
        raise notice 'publication column list not supported (%): publishing data_packs with all columns', sqlerrm;
      end;
    end if;
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
end $$;

-- =============================================================================
-- 12. Privileges (re-run of the 0900 sweep for the functions defined here)
-- =============================================================================
do $$
declare
  f text;
  has_roles boolean := exists (select 1 from pg_roles where rolname = 'anon');
begin
  foreach f in array array['public.register_device(text, text)', 'public.sync_device_ops(uuid, text, jsonb)'] loop
    execute format('revoke all on function %s from public', f);
    if has_roles then
      execute format('grant execute on function %s to anon, authenticated, service_role', f);
    end if;
  end loop;
  foreach f in array array['public.admin_publish_pack(text, text, text, boolean)',
                           'public.admin_pack_changes(text, text)',
                           'public.admin_review_submission(text, text, text)',
                           'public.admin_review_samples(bigint[], text)',
                           'public.admin_upsert_facility(jsonb)',
                           'public.nc_dispatch_alerts()', 'public.nc_cleanup()'] loop
    execute format('revoke all on function %s from public', f);
    if has_roles then
      execute format('revoke all on function %s from anon', f);
      execute format('grant execute on function %s to authenticated, service_role', f);
    end if;
  end loop;
  foreach f in array array['public.nc_alert_claim(uuid, text, boolean, int, uuid)',
                           'public.nc_alert_result(uuid, boolean, text, text, text, text, text, uuid, text)'] loop
    execute format('revoke all on function %s from public', f);
    if has_roles then
      execute format('revoke all on function %s from anon, authenticated', f);
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

revoke all on all functions in schema app_private from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
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
      and p.prokind = 'f'
      and l.lanname in ('sql', 'plpgsql')
      and p.proowner = (select oid from pg_roles where rolname = current_user)
      and not exists (select 1 from pg_depend d
                       where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s set jit = off', f);
  end loop;
end $$;

comment on function public.admin_pack_changes(text, text) is
  'Unpublished changes of every route × carrier pack (facilities/services added, removed with reason, updated).';
comment on function public.admin_publish_pack(text, text, text, boolean) is
  'Publishes a new pack version; returns the current one with unchanged = true when nothing changed (p_force to override).';
