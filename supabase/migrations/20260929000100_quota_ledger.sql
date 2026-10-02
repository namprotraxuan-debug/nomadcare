-- =============================================================================
-- NomadCare v2 — 20260929000100 alert quota ledger + route region_en (wave 3d).
-- Owner: backend. Idempotent; runs after 20260928000100_hardening.sql and
-- replaces some of its functions (same signatures, grants are kept).
--   Alert quota ledger (anti e-mail relay)
--   * app_private.alert_ledger: one row per alert / all-clear e-mail, keyed by a
--     salted sha256 of the normalised recipient address (lower case, "+tag"
--     dropped; Gmail dots dropped, googlemail.com = gmail.com). No plaintext
--     address, no foreign key to sessions or devices: device.erase and the
--     session retention do not touch it; nc_cleanup() prunes rows > 48 h.
--   * alert_quota_block() counts that ledger instead of the sessions' events:
--     overdue / SOS / manual alerts AND all-clear e-mails, claimed (in flight)
--     or sent, per recipient (limit_alert_recipient_24h, default 3) and for all
--     recipients (limit_alert_global_1h, default 50). Failed sends and demo
--     recipients (example.com, *.test, …) do not count. All-clear e-mails are
--     counted but never held back: at most one follows each alert that went out.
--   * nc_alert_claim() writes a 'claimed' row for every alert it hands out
--     (claims are serialised with an advisory lock, so a cron tick and an SOS
--     cannot both pass the same quota); nc_alert_result() marks it sent /
--     failed / demo, or records a send / all-clear that had no claim row;
--     op_device_erase() records the inline all-clear it queues and unlinks the
--     erased sessions from their open claims (the claims keep counting).
--   Routes
--   * routes.region_en (English region label) in list_routes() and in the pack
--     route object (app_private.build_pack). Packs published before this
--     migration lack it until they are published again; clients fall back to
--     region.
-- =============================================================================
set search_path = public, extensions;

-- =============================================================================
-- 1. Schema
-- =============================================================================
create table if not exists app_private.alert_ledger (
  id             bigint generated always as identity primary key,
  recipient_hash text        not null,          -- app_private.recipient_hash(e-mail)
  kind           text        not null check (kind in ('alert', 'all_clear')),
  reason         text,                          -- overdue | sos | manual | resolved
  source         text,                          -- cron | manual | erase | …
  status         text        not null default 'sent'
                 check (status in ('claimed', 'sent', 'failed', 'demo')),
  session_ref    uuid,                          -- open claim only (no FK); cleared by the result or device.erase
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table app_private.alert_ledger is
  'Every alert / all-clear e-mail (claimed, sent, failed, demo) by salted sha256 of the normalised recipient; '
  'no plaintext address, no FK. Basis of the abuse quotas; survives device.erase; pruned after 48 h by nc_cleanup().';
create index if not exists alert_ledger_recipient_idx on app_private.alert_ledger (recipient_hash, created_at desc);
create index if not exists alert_ledger_created_idx   on app_private.alert_ledger (created_at desc);
create index if not exists alert_ledger_claim_idx     on app_private.alert_ledger (session_ref) where session_ref is not null;

alter table app_private.alert_ledger enable row level security;
revoke all on app_private.alert_ledger from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on app_private.alert_ledger from anon, authenticated';
    execute 'grant select on app_private.alert_ledger to service_role';
  end if;
end $$;

-- per-project salt for the recipient hashes (never exposed)
insert into app_private.settings (key, value)
values ('ledger_salt', encode(gen_random_bytes(16), 'hex'))
on conflict (key) do nothing;

alter table public.routes add column if not exists region_en text;
comment on column public.routes.region_en is 'English label of the region (null: clients show region).';
-- the three demo routes (supabase/seed.sql sets the same values; real edits are kept)
update public.routes r set region_en = v.region_en
from (values ('khanh-le',          'Lâm Đồng – Khánh Hòa'),
             ('ta-nang-phan-dung', 'Lâm Đồng'),
             ('ha-giang-loop',     'Tuyên Quang (former Hà Giang province)')) as v(id, region_en)
where r.id = v.id and r.region_en is null;

-- =============================================================================
-- 2. Ledger helpers + quota
-- =============================================================================

-- Canonical recipient for counting: trimmed, lower case, "+tag" dropped from the
-- local part; Gmail ignores dots and googlemail.com is gmail.com. Null for
-- null / blank. Mirrors normalizeEmail() in assets/js/services/backend-local.js.
create or replace function app_private.normalize_email(p text)
returns text
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select case
    when x.v is null then null
    when position('@' in x.v) = 0 then x.v
    else (select case when y.dom in ('gmail.com', 'googlemail.com')
                      then replace(y.loc, '.', '') || '@gmail.com'
                      else y.loc || '@' || y.dom end
          from (select coalesce(nullif(split_part(regexp_replace(x.v, '@[^@]*$', ''), '+', 1), ''),
                                regexp_replace(x.v, '@[^@]*$', '')) as loc,
                       rtrim(substring(x.v from '@([^@]*)$'), '.') as dom) y)
  end
  from (select nullif(lower(btrim(p)), '') as v) x
$$;

-- sha256(ledger_salt | normalised address) as hex; null for null / blank.
create or replace function app_private.recipient_hash(p_email text)
returns text
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select case when n.e is not null
              then encode(digest(coalesce(app_private.setting('ledger_salt'), '') || '|' || n.e, 'sha256'), 'hex') end
  from (select app_private.normalize_email(p_email) as e) n
$$;

-- Records one e-mail in the ledger (demo recipients are never e-mailed for
-- real and are not recorded). Returns the ledger id or null.
create or replace function app_private.ledger_add(p_email text, p_kind text, p_reason text, p_source text,
                                                  p_status text default 'sent', p_session uuid default null)
returns bigint
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id bigint;
begin
  if p_email is null or btrim(p_email) = '' or app_private.is_reserved_email(p_email) then
    return null;
  end if;
  insert into app_private.alert_ledger (recipient_hash, kind, reason, source, status, session_ref)
  values (app_private.recipient_hash(p_email), p_kind, p_reason, p_source, coalesce(p_status, 'sent'),
          case when coalesce(p_status, 'sent') = 'claimed' then p_session end)
  returning id into v_id;
  return v_id;
end $$;

-- Why an alert e-mail to p_email must not go out now: 'recipient_24h' |
-- 'global_1h' | null. Counts the ledger (alerts and all-clears, claimed or
-- sent), which device.erase cannot delete.
create or replace function app_private.alert_quota_block(p_email text)
returns text
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select case
    when p_email is null or app_private.is_reserved_email(p_email) then null
    when (select count(*) from app_private.alert_ledger l
           where l.recipient_hash = app_private.recipient_hash(p_email)
             and l.status in ('claimed', 'sent')
             and l.created_at > now() - interval '24 hours')
         >= app_private.limit_value('limit_alert_recipient_24h', 3) then 'recipient_24h'
    when (select count(*) from app_private.alert_ledger l
           where l.status in ('claimed', 'sent')
             and l.created_at > now() - interval '1 hour')
         >= app_private.limit_value('limit_alert_global_1h', 50) then 'global_1h'
  end
$$;

-- One-time backfill: e-mails of the last 48 h recorded before the ledger existed.
do $$
begin
  if not exists (select 1 from app_private.settings where key = 'alert_ledger_backfilled') then
    insert into app_private.alert_ledger (recipient_hash, kind, reason, source, status, created_at, updated_at)
    select app_private.recipient_hash(b.recipient_email),
           case when e.meta ->> 'type' = 'resolved' then 'all_clear' else 'alert' end,
           case when e.meta ->> 'type' = 'resolved' then 'resolved' else coalesce(e.meta ->> 'reason', 'overdue') end,
           coalesce(e.meta ->> 'trigger', 'cron'), 'sent', e.received_at, e.received_at
    from public.checkin_events e
    join public.buddy_sessions b on b.id = e.session_id
    where e.kind = 'alert_sent'
      and coalesce(e.meta ->> 'provider', '') <> 'demo'
      and e.received_at > now() - interval '48 hours'
      and b.recipient_email is not null
      and not app_private.is_reserved_email(b.recipient_email);
    insert into app_private.settings (key, value) values ('alert_ledger_backfilled', now()::text)
    on conflict (key) do nothing;
  end if;
end $$;

-- =============================================================================
-- 3. device.erase: inline all-clear recorded, open claims unlinked
-- =============================================================================
-- As 20260928000100 + the ledger. Open sessions are closed WITHOUT an alert and
-- deleted with their events; community reports stay but lose the device link;
-- device_ops and the device row go. If a recipient was alerted and never got
-- the all-clear, it is sent from an inline payload (the Edge Function cannot
-- read the deleted row) and counted in the ledger.
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
  v_req      bigint;
  v_audit    text := current_setting('nc.audit', true);
begin
  for s in select * from public.buddy_sessions where device_id = p_device.id order by started_at for update loop
    if s.recipient_email is not null and app_private.all_clear_pending(s.id) then
      v_req := app_private.notify_deadman(jsonb_build_object(
        'type', 'resolved', 'session_id', s.id, 'source', 'erase',
        'inline', app_private.alert_payload(s, 'resolved', now())));
      if v_req is not null then
        perform app_private.ledger_add(s.recipient_email, 'all_clear', 'resolved', 'erase', 'sent', null);
      end if;
      v_clear := v_clear + 1;
    end if;
    if s.status <> 'closed' then
      update public.buddy_sessions set status = 'closed', closed_at = now() where id = s.id;
    end if;
  end loop;
  -- claims in flight keep counting against the quota, without the session link
  update app_private.alert_ledger set session_ref = null, updated_at = now()
   where session_ref in (select b.id from public.buddy_sessions b where b.device_id = p_device.id);
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

-- =============================================================================
-- 4. Cron / Edge Function API: ledger writes, retention
-- =============================================================================

-- Daily retention job (as 20260928000100 + ledger rows older than 48 h).
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
  v_ledger   int;
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
  delete from app_private.alert_ledger where created_at < now() - interval '48 hours';
  get diagnostics v_ledger = row_count;
  return jsonb_build_object('device_ops_deleted', v_ops, 'sessions_deleted', v_sessions,
                            'events_deleted', v_events, 'ip_hashes_cleared', v_ips,
                            'ledger_deleted', v_ledger, 'at', now());
end $$;

-- Claims sessions to alert (as 20260928000100) + a ledger row per claimed
-- alert. The cron path is serialised (advisory lock) so that parallel callers
-- (cron tick, SOS, device-detected overdue) see each other's claims.
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
  v_item   jsonb;
begin
  if not app_private.is_trusted_caller() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_type not in ('overdue', 'resolved') then
    raise exception 'invalid_type' using errcode = '22023', detail = coalesce(p_type, 'null');
  end if;
  perform app_private.set_actor(p_actor);

  if p_type = 'resolved' then
    -- recorded in the ledger by nc_alert_result once it went out
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
    -- manual trigger by an admin: never rate-limited, but counted
    select * into s from public.buddy_sessions where id = p_session_id for update;
    if not found or s.status = 'closed' or s.recipient_email is null then
      return v_out;
    end if;
    if s.status in ('overdue', 'active') then
      update public.buddy_sessions set alerted_at = v_now where id = s.id returning * into s;
    end if;
    v_item := app_private.alert_payload(s, 'overdue', v_now);
    perform app_private.ledger_add(s.recipient_email, 'alert', v_item ->> 'reason', 'manual', 'claimed', s.id);
    return jsonb_build_array(v_item);
  end if;

  perform pg_advisory_xact_lock(hashtext('nomadcare.nc_alert_claim'));
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
    v_item := app_private.alert_payload(s, 'overdue', v_now);
    perform app_private.ledger_add(s.recipient_email, 'alert', v_item ->> 'reason', 'cron', 'claimed', s.id);
    v_out := v_out || jsonb_build_array(v_item);
  end loop;
  return v_out;
end $$;

-- Records the outcome of one e-mail (as 20260928000100) + the ledger: the open
-- claim of this session becomes sent / failed / demo; a send without a claim
-- (all-clear, older Edge Function) is added as sent.
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
  v_kind      text := case when coalesce(p_type, 'overdue') = 'resolved' then 'all_clear' else 'alert' end;
  v_state     text := case when not coalesce(p_ok, false) then 'failed' when p_provider = 'demo' then 'demo' else 'sent' end;
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

  update app_private.alert_ledger l set status = v_state, session_ref = null, updated_at = now()
   where l.id = (select x.id from app_private.alert_ledger x
                  where x.session_ref = s.id and x.kind = v_kind and x.status = 'claimed'
                  order by x.created_at desc, x.id desc limit 1);
  if not found and v_state = 'sent' then
    perform app_private.ledger_add(s.recipient_email, v_kind,
                                   case when v_kind = 'all_clear' then 'resolved' else coalesce(p_reason, 'overdue') end,
                                   coalesce(p_trigger, 'cron'), 'sent', null);
  end if;

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
-- 5. Routes: region_en in the pack and the route catalogue
-- =============================================================================

-- Pack JSON (CONTRACT §8) for one route × carrier; as 0500 + route.region_en.
create or replace function app_private.build_pack(p_route_id text, p_carrier text,
                                                  p_version int, p_published_at timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  r           public.routes%rowtype;
  v_corridor  geography;
  v_model     text;
  v_accuracy  numeric;
  v_holdout   int;
  v_acc_model text;
  v_nodes     jsonb;
  v_edges     jsonb;
  v_segments  jsonb;
  v_fac       jsonb;
  v_svc       jsonb;
  v_pack      jsonb;
  v_size      int;
  v_len       int;
begin
  select * into r from public.routes where id = p_route_id;
  if not found then
    raise exception 'route_not_found' using errcode = 'P0002', detail = coalesce(p_route_id, 'null');
  end if;
  if not exists (select 1 from public.carriers c where c.id = p_carrier) then
    raise exception 'carrier_not_found' using errcode = 'P0002', detail = coalesce(p_carrier, 'null');
  end if;

  v_corridor := app_private.route_corridor(p_route_id);

  select a.accuracy, a.holdout_n, a.model_version
    into v_accuracy, v_holdout, v_acc_model
  from public.route_accuracy a
  where a.route_id = p_route_id and a.carrier = p_carrier;

  select s.model_version into v_model
  from public.signal_segments s
  where s.route_id = p_route_id and s.carrier = p_carrier
  order by s.created_at desc, s.id desc
  limit 1;

  -- nodes, in travel order along the route line (then id): pickers and
  -- itineraries read naturally without re-sorting on the device
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',      n.id,
           'name',    n.name,
           'name_en', n.name_en,
           'kind',    n.kind,
           'lat',     trim_scale(round(ST_Y(n.geom::geometry)::numeric, 6)),
           'lng',     trim_scale(round(ST_X(n.geom::geometry)::numeric, 6)))
           order by case when r.geom is not null then ST_LineLocatePoint(r.geom::geometry, n.geom::geometry) end,
                    n.id), '[]'::jsonb)
    into v_nodes
  from public.route_nodes n
  where n.route_id = p_route_id;

  -- edges (geometry oriented from → to)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',           e.id,
           'from',         e.from_node,
           'to',           e.to_node,
           'length_km',    trim_scale(round(e.length_km::numeric, 3)),
           'is_connector', e.is_connector,
           'geometry',     app_private.line_latlng(
                             case when ST_Distance(ST_StartPoint(e.geom::geometry)::geography, fn.geom)
                                     > ST_Distance(ST_EndPoint(e.geom::geometry)::geography, fn.geom)
                                  then ST_Reverse(e.geom::geometry)
                                  else e.geom::geometry end)) order by e.id), '[]'::jsonb)
    into v_edges
  from public.route_edges e
  join public.route_nodes fn on fn.id = e.from_node
  where e.route_id = p_route_id;

  -- segments, grouped per edge
  with segs as (
    select s.edge_id, s.seq, s.from_km, s.to_km, s.level, s.confidence
    from public.signal_segments s
    join public.route_edges e on e.id = s.edge_id and e.route_id = p_route_id
    where s.route_id = p_route_id
      and s.carrier = p_carrier
      and s.model_version is not distinct from v_model
    union all
    select e.id, 0, 0::numeric, e.length_km, 'uncertain', 0::numeric
    from public.route_edges e
    where e.route_id = p_route_id
      and not exists (select 1 from public.signal_segments s
                       where s.edge_id = e.id and s.carrier = p_carrier
                         and s.model_version is not distinct from v_model)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'edge_id',    g.edge_id,
           'seq',        g.seq,
           'from_km',    trim_scale(round(g.from_km::numeric, 3)),
           'to_km',      trim_scale(round(g.to_km::numeric, 3)),
           'level',      g.level,
           'confidence', trim_scale(round(g.confidence::numeric, 3))) order by g.edge_id, g.seq, g.from_km), '[]'::jsonb)
    into v_segments
  from segs g;

  -- verified facilities of the route (or untagged within the corridor)
  select coalesce(jsonb_agg(app_private.facility_pack_json(f) order by f.id), '[]'::jsonb)
    into v_fac
  from public.facilities f
  where f.status = 'verified'
    and f.geom is not null
    and app_private.in_route(f.route_id, f.geom, p_route_id, v_corridor);

  -- active services
  select coalesce(jsonb_agg(app_private.service_pack_json(s) order by s.id), '[]'::jsonb)
    into v_svc
  from public.services s
  where s.status = 'active'
    and s.geom is not null
    and app_private.in_route(s.route_id, s.geom, p_route_id, v_corridor);

  v_pack := jsonb_build_object(
    'schema', 1,
    'route', jsonb_build_object(
      'id',             r.id,
      'name',           r.name,
      'name_en',        r.name_en,
      'region',         r.region,
      'region_en',      r.region_en,
      'travel_mode',    r.travel_mode,
      'length_km',      app_private.route_length_km(r.id),
      'color',          r.color,
      'bbox',           app_private.route_bbox(r.id),
      'description_vi', r.description_vi,
      'description_en', r.description_en),
    'carrier',       p_carrier,
    'version',       coalesce(p_version, 0),
    'published_at',  p_published_at,
    'model_version', coalesce(v_model, v_acc_model),
    'accuracy',      v_accuracy,
    'holdout_n',     coalesce(v_holdout, 0),
    'nodes',         v_nodes,
    'edges',         v_edges,
    'segments',      v_segments,
    'facilities',    v_fac,
    'services',      v_svc);

  -- size_bytes must describe the final text, which includes size_bytes itself.
  v_size := octet_length(v_pack::text);
  for i in 1 .. 5 loop
    v_len := octet_length((v_pack || jsonb_build_object('size_bytes', v_size))::text);
    exit when v_len = v_size;
    v_size := v_len;
  end loop;
  return v_pack || jsonb_build_object('size_bytes', v_size);
end $$;

-- =============================================================================
-- 5. Public read RPCs
-- =============================================================================


-- Route catalogue (as 0500 + region_en).
create or replace function public.list_routes()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select coalesce(jsonb_agg(q.item order by q.sort, q.id), '[]'::jsonb)
  from (
    select r.sort, r.id,
      jsonb_build_object(
        'id',             r.id,
        'name',           r.name,
        'name_en',        r.name_en,
        'region',         r.region,
        'region_en',      r.region_en,
        'travel_mode',    r.travel_mode,
        'length_km',      app_private.route_length_km(r.id),
        'color',          r.color,
        'bbox',           app_private.route_bbox(r.id),
        'description_vi', r.description_vi,
        'description_en', r.description_en,
        'verified_facilities', (
          select count(*)::int from public.facilities f
          where f.status = 'verified'
            and app_private.in_route(f.route_id, f.geom, r.id, cor.g)),
        'accuracy', (
          select coalesce(jsonb_object_agg(c.id, a.accuracy order by c.sort), '{}'::jsonb)
          from public.carriers c
          left join public.route_accuracy a on a.route_id = r.id and a.carrier = c.id),
        'packs', (
          select coalesce(jsonb_object_agg(c.id, (
                   select jsonb_build_object('version', p.version,
                                             'published_at', p.published_at,
                                             'size_bytes', p.size_bytes)
                   from public.data_packs p
                   where p.route_id = r.id and p.carrier = c.id and p.is_current
                   order by p.version desc limit 1) order by c.sort), '{}'::jsonb)
          from public.carriers c)
      ) as item
    from public.routes r
    cross join lateral (select app_private.route_corridor(r.id) as g) cor
    where r.is_active
  ) q
$$;

-- =============================================================================
-- 6. Privileges (as the 0900 / 20260928000100 sweeps, for the functions here)
-- =============================================================================
revoke all on function public.nc_cleanup() from public;
revoke all on function public.nc_alert_claim(uuid, text, boolean, int, uuid) from public;
revoke all on function public.nc_alert_result(uuid, boolean, text, text, text, text, text, uuid, text) from public;
revoke all on function public.list_routes() from public;
revoke all on all functions in schema app_private from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.list_routes() to anon, authenticated, service_role';
    execute 'revoke all on function public.nc_cleanup() from anon';
    execute 'grant execute on function public.nc_cleanup() to authenticated, service_role';
    execute 'revoke all on function public.nc_alert_claim(uuid, text, boolean, int, uuid) from anon, authenticated';
    execute 'grant execute on function public.nc_alert_claim(uuid, text, boolean, int, uuid) to service_role';
    execute 'revoke all on function public.nc_alert_result(uuid, boolean, text, text, text, text, text, uuid, text) from anon, authenticated';
    execute 'grant execute on function public.nc_alert_result(uuid, boolean, text, text, text, text, text, uuid, text) to service_role';
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
      and p.proname in ('normalize_email', 'recipient_hash', 'ledger_add', 'alert_quota_block', 'op_device_erase',
                        'nc_cleanup', 'nc_alert_claim', 'nc_alert_result', 'build_pack', 'list_routes')
      and p.prokind = 'f'
      and l.lanname in ('sql', 'plpgsql')
      and p.proowner = (select oid from pg_roles where rolname = current_user)
      and not exists (select 1 from pg_depend d
                       where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s set jit = off', f);
  end loop;
end $$;

comment on function public.list_routes() is
  'Route catalogue: names (vi/en), region (vi/en), length, bbox, verified facilities, accuracy and current pack per carrier.';
comment on function public.nc_cleanup() is
  'Daily retention: device_ops > 30 d, closed sessions > 30 d / idle > 90 d, IP hashes > 24 h, alert ledger > 48 h.';
