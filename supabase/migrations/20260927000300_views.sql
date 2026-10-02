-- =============================================================================
-- NomadCare v2 — 0300 views for the admin dashboard
-- Owner: P1 database. All views use security_invoker = true, so the RLS
-- policies of the underlying tables apply to the caller (admins only).
-- Contract views: v_facilities, v_buddy_sessions.
-- Extra helper views (lat/lng instead of geography): v_services, v_signal_samples.
-- =============================================================================
set search_path = public, extensions;

-- Facilities + freshness (PDF 8.1: re-verify every 90 days; stale ones are
-- still published, together with the verification date). Dates in Vietnam time.
create or replace view public.v_facilities
with (security_invoker = true) as
select
  f.id,
  f.route_id,
  f.name,
  f.type,
  f.address,
  ST_Y(f.geom::geometry)                                      as lat,
  ST_X(f.geom::geometry)                                      as lng,
  f.phone,
  f.open_hours,
  f.night_shift,
  f.trauma_capable,
  f.verified_by,
  f.verified_at,
  f.status,
  f.source,
  f.notes,
  f.is_demo,
  f.created_at,
  f.updated_at,
  coalesce(f.verified_at < app_private.today_vn() - 90, false) as is_stale,
  (app_private.today_vn() - f.verified_at)                    as days_since_verified
from public.facilities f;

-- Buddy sessions + monitoring helpers.
--   overdue_by_min: minutes past next_due_at (0 when not yet due or closed)
--   event_count / last_event_kind: from checkin_events
-- 20260928000100_hardening appends alert_reason + sos_at; CREATE OR REPLACE VIEW
-- cannot drop columns, so re-running this file starts from scratch (0400 re-grants).
drop view if exists public.v_buddy_sessions;
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
    limit 1)                                                  as last_event_kind
from public.buddy_sessions s;

-- Services with plain coordinates.
create or replace view public.v_services
with (security_invoker = true) as
select
  s.id,
  s.route_id,
  s.name,
  s.type,
  ST_Y(s.geom::geometry) as lat,
  ST_X(s.geom::geometry) as lng,
  s.phone,
  s.open_hours,
  s.is_partner,
  s.commission_rate,
  s.status,
  s.notes,
  s.is_demo,
  s.created_at,
  s.updated_at
from public.services s;

-- Signal samples with plain coordinates (heat map / moderation queue).
create or replace view public.v_signal_samples
with (security_invoker = true) as
select
  x.id,
  x.route_id,
  x.edge_id,
  x.carrier,
  x.tech,
  x.rsrp_dbm,
  x.level,
  ST_Y(x.geom::geometry) as lat,
  ST_X(x.geom::geometry) as lng,
  x.measured_at,
  x.source,
  x.status,
  x.device_model,
  x.is_holdout,
  x.created_at
from public.signal_samples x;
