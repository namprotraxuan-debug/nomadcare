-- =============================================================================
-- NomadCare v2 — 0600 admin RPC (authenticated only, every call checks is_admin())
-- Owner: P1 database. Contract names (CONTRACT §9):
--   admin_kpis() · admin_publish_pack(route, carrier, notes)
--   admin_review_submission(id, status, note) · admin_review_samples(ids, status)
--   admin_resolve_session(id, note) · admin_approve_content(id, approver)
-- Extra helpers for the dashboard (lat/lng in, completeness check with the
-- list of missing fields): admin_upsert_facility(row) · admin_upsert_service(row)
-- SQL-editor helpers (no JWT needed): app_private.publish_pack(...),
-- app_private.publish_all_packs(notes).
-- =============================================================================
set search_path = public, extensions;

-- Trusted callers: the service_role key (Edge Functions, scripts) and direct
-- database sessions (SQL Editor, psql, pg_cron), i.e. anything that does not
-- come through the Data API as anon/authenticated. Both the JWT role claim and
-- the SET ROLE done by PostgREST (GUC "role", unchanged inside SECURITY
-- DEFINER) are checked, so a missing claim can never escalate a user role.
create or replace function app_private.is_trusted_caller()
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select case
    when coalesce(auth.role(), '') in ('anon', 'authenticated')
      or coalesce(current_setting('role', true), 'none') in ('anon', 'authenticated') then false
    when coalesce(auth.role(), '') = 'service_role'
      or coalesce(current_setting('role', true), 'none') = 'service_role' then true
    else session_user <> 'authenticator'
  end
$$;

-- Raises 42501 'forbidden' unless the caller is an admin (or trusted, see above).
create or replace function app_private.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if public.is_admin() or app_private.is_trusted_caller() then
    return;
  end if;
  raise exception 'forbidden' using errcode = '42501', hint = 'Admin account required (table admin_users).';
end $$;

-- ------------------------------------------------------------ KPIs ----
create or replace function public.admin_kpis()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v jsonb;
begin
  perform app_private.require_admin();
  select jsonb_build_object(
    'generated_at', now(),
    'facilities', (
      select jsonb_build_object(
        'verified', count(*) filter (where f.status = 'verified'),
        'pending',  count(*) filter (where f.status = 'pending'),
        'rejected', count(*) filter (where f.status = 'rejected'),
        'stale',    count(*) filter (where f.status = 'verified' and f.verified_at < app_private.today_vn() - 90),
        'target',   216)                        -- PDF 8.1: 216 verified points (72 per route)
      from public.facilities f),
    'submissions_pending', (select count(*) from public.facility_submissions s where s.status = 'pending'),
    'buddy', (
      select jsonb_build_object(
        'active',    count(*) filter (where b.status = 'active'),
        'overdue',   count(*) filter (where b.status = 'overdue'),
        'alerted',   count(*) filter (where b.status = 'alerted'),
        'closed_24h', count(*) filter (where b.status = 'closed' and b.closed_at > now() - interval '24 hours'))
      from public.buddy_sessions b),
    'samples', jsonb_build_object(
      'total',   (select count(*) from public.signal_samples),
      'pending', (select count(*) from public.signal_samples x where x.status = 'pending'),
      'by_carrier', (
        select coalesce(jsonb_object_agg(c.id, (select count(*) from public.signal_samples x where x.carrier = c.id)
                                         order by c.sort), '{}'::jsonb)
        from public.carriers c)),
    'devices', (select count(*) from public.devices),
    'routes', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id',       r.id,
          'name',     r.name,
          'verified', (select count(*) from public.facilities f where f.route_id = r.id and f.status = 'verified'),
          'pending',  (select count(*) from public.facilities f where f.route_id = r.id and f.status = 'pending'),
          'stale',    (select count(*) from public.facilities f where f.route_id = r.id and f.status = 'verified'
                                                                    and f.verified_at < app_private.today_vn() - 90),
          'accuracy', (select coalesce(jsonb_object_agg(c.id, a.accuracy order by c.sort), '{}'::jsonb)
                         from public.carriers c
                         left join public.route_accuracy a on a.route_id = r.id and a.carrier = c.id),
          'samples',  (select count(*) from public.signal_samples x where x.route_id = r.id))
        order by r.sort, r.id), '[]'::jsonb)
      from public.routes r),
    'packs', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'route_id', p.route_id, 'carrier', p.carrier, 'version', p.version,
          'published_at', p.published_at, 'size_bytes', p.size_bytes)
        order by p.route_id, p.carrier), '[]'::jsonb)
      from public.data_packs p where p.is_current)
  ) into v;
  return v;
end $$;

-- ------------------------------------------------------ pack publishing ----
-- Snapshot the live pack as version = max + 1 and make it the current one.
create or replace function app_private.publish_pack(p_route_id text, p_carrier text,
                                                    p_notes text default null, p_actor uuid default null)
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
begin
  -- serialise concurrent publishes of the same route × carrier
  perform pg_advisory_xact_lock(hashtext('nomadcare.pack:' || coalesce(p_route_id, '') || ':' || coalesce(p_carrier, '')));
  select coalesce(max(p.version), 0) + 1 into v_version
  from public.data_packs p where p.route_id = p_route_id and p.carrier = p_carrier;

  v_payload := app_private.build_pack(p_route_id, p_carrier, v_version, v_now);   -- raises if unknown
  v_size := (v_payload ->> 'size_bytes')::int;
  v_sum := encode(digest(v_payload::text, 'sha256'), 'hex');

  update public.data_packs set is_current = false
   where route_id = p_route_id and carrier = p_carrier and is_current;
  insert into public.data_packs (route_id, carrier, version, published_at, published_by, notes,
                                 size_bytes, checksum, payload, is_current)
  values (p_route_id, p_carrier, v_version, v_now, p_actor, app_private.clean_text(p_notes, 500),
          v_size, v_sum, v_payload, true);

  return jsonb_build_object('route_id', p_route_id, 'carrier', p_carrier, 'version', v_version,
                            'size_bytes', v_size, 'checksum', v_sum, 'published_at', v_now);
end $$;

-- Publishes every active route × carrier (SQL editor / seed helper).
create or replace function app_private.publish_all_packs(p_notes text default 'Initial publish')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_out jsonb := '[]'::jsonb;
  r record;
begin
  for r in
    select ro.id as route_id, c.id as carrier
    from public.routes ro cross join public.carriers c
    where ro.is_active
    order by ro.sort, ro.id, c.sort
  loop
    v_out := v_out || jsonb_build_array(app_private.publish_pack(r.route_id, r.carrier, p_notes, null));
  end loop;
  return v_out;
end $$;

create or replace function public.admin_publish_pack(p_route_id text, p_carrier text, p_notes text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform app_private.require_admin();
  return app_private.publish_pack(p_route_id, p_carrier, p_notes, auth.uid());
end $$;

-- ------------------------------------------------ community submissions ----
-- approved 'new'        → creates a PENDING facility prefilled from the payload
-- approved 'closed'     → target facility back to 'pending' (unpublished until re-verified)
-- approved 'correction' → note appended to the facility (admin edits the fields)
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
      insert into public.facilities (route_id, name, type, address, geom, phone, open_hours,
                                     status, source, notes)
      values (v_route,
              coalesce(app_private.clean_text(p ->> 'name', 160), 'Điểm y tế cộng đồng đề xuất'),
              v_type,
              app_private.clean_text(p ->> 'address', 300),
              app_private.pt(v_lat, v_lng),
              app_private.clean_text(p ->> 'phone', 32),
              app_private.clean_text(p ->> 'open_hours', 120),
              'pending', 'community',
              concat_ws(E'\n', 'Từ đóng góp cộng đồng #' || s.id, app_private.clean_text(p ->> 'note', 500), v_note))
      returning id into v_fac;
    elsif s.kind = 'closed' and v_fac is not null then
      update public.facilities
         set status = case when status = 'verified' then 'pending' else status end,
             notes  = concat_ws(E'\n', notes, 'Báo đóng cửa (#' || s.id || ')' || coalesce(': ' || v_note, ''))
       where id = v_fac;
    elsif s.kind = 'correction' and v_fac is not null then
      update public.facilities
         set notes = concat_ws(E'\n', notes, 'Đề xuất sửa (#' || s.id || '): '
                                             || coalesce(app_private.clean_text(p ->> 'note', 500), p::text))
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

create or replace function public.admin_review_samples(p_ids bigint[], p_status text)
returns int
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_n int;
begin
  perform app_private.require_admin();
  if p_status not in ('approved', 'pending', 'rejected') then
    raise exception 'invalid_status' using errcode = '22023', detail = coalesce(p_status, 'null');
  end if;
  update public.signal_samples set status = p_status where id = any (coalesce(p_ids, '{}'));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ------------------------------------------------------- buddy sessions ----
-- Admin closes an incident (traveller confirmed safe). Sends the "all clear"
-- email when the recipient had been alerted.
create or replace function public.admin_resolve_session(p_id uuid, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  s     public.buddy_sessions%rowtype;
  v_was text;
begin
  perform app_private.require_admin();
  select * into s from public.buddy_sessions where id = p_id for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002', detail = coalesce(p_id::text, 'null');
  end if;
  v_was := s.status;
  if v_was <> 'closed' then
    perform app_private.insert_event(s, 'resolved', null, null, null, null, now(), false, p_note,
                                     jsonb_build_object('by', 'admin', 'admin', auth.uid(), 'previous_status', v_was));
    update public.buddy_sessions set status = 'closed', closed_at = now()
     where id = s.id
     returning * into s;
    if v_was = 'alerted' then
      perform app_private.notify_deadman(jsonb_build_object('session_id', s.id, 'type', 'resolved'));
    end if;
  end if;
  return app_private.session_json(s) || jsonb_build_object('previous_status', v_was);
end $$;

-- ---------------------------------------------------- content releases ----
-- Round-2 sign-off by the medical advisor (PDF 8.1).
create or replace function public.admin_approve_content(p_id bigint, p_approver text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  c public.content_releases%rowtype;
  v_approver text := app_private.clean_text(p_approver, 120);
begin
  perform app_private.require_admin();
  if v_approver is null then
    raise exception 'approver_required' using errcode = '22023',
      hint = 'Round-2 approval must name the medical advisor.';
  end if;
  update public.content_releases
     set status = 'approved', approver = v_approver, approved_at = now()
   where id = p_id
   returning * into c;
  if not found then
    raise exception 'content_release_not_found' using errcode = 'P0002', detail = coalesce(p_id::text, 'null');
  end if;
  return to_jsonb(c);
end $$;

-- ------------------------------------------ facility / service upserts ----
-- Required fields of a verified facility (mirrors facilities_verified_complete).
create or replace function app_private.facility_missing_fields(f public.facilities)
returns text[]
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select array_remove(array[
    case when nullif(btrim(f.name), '') is null        then 'name' end,
    case when nullif(btrim(f.address), '') is null     then 'address' end,
    case when f.geom is null                           then 'lat_lng' end,
    case when f.type is null                           then 'type' end,
    case when nullif(btrim(f.open_hours), '') is null  then 'open_hours' end,
    case when f.night_shift is null                    then 'night_shift' end,
    case when f.trauma_capable is null                 then 'trauma_capable' end,
    case when nullif(btrim(f.phone), '') is null       then 'phone' end,
    case when nullif(btrim(f.verified_by), '') is null then 'verified_by' end,
    case when f.verified_at is null                    then 'verified_at' end], null)
$$;

-- Insert or partially update a facility from JSON {id?, lat, lng, …}. Only the
-- keys present in p_row are changed. Errors (same codes as the local backend):
--   'incomplete' (23514, DETAIL = JSON array of missing fields) when a
--   'verified' row lacks a required field; 'invalid_type' / 'invalid_status' /
--   'invalid_coordinates' (22023); 'facility_not_found' (P0002) when an unknown
--   id comes without a name (e.g. a status change of a deleted facility).
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

-- Insert or partially update a service (lodging/repair/fuel/rental) from JSON
-- {id?, lat, lng, …}. Errors: 'incomplete' (23514, DETAIL '["name"]'),
-- 'invalid_type' / 'invalid_status' / 'invalid_coordinates' (22023).
create or replace function public.admin_upsert_service(p_row jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  s        public.services%rowtype;
  v_exists boolean := false;
  v_lat    double precision;
  v_lng    double precision;
begin
  perform app_private.require_admin();
  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    raise exception 'invalid_row' using errcode = '22023';
  end if;
  if nullif(p_row ->> 'id', '') is not null then
    select * into s from public.services where id = p_row ->> 'id' for update;
    v_exists := found;
    s.id := p_row ->> 'id';
  else
    s.id := gen_random_uuid()::text;
  end if;
  if not v_exists then
    s.status := 'active'; s.is_partner := false; s.commission_rate := 0; s.is_demo := true;
  end if;
  if p_row ? 'route_id'        then s.route_id := nullif(p_row ->> 'route_id', ''); end if;
  if p_row ? 'name'            then s.name := app_private.clean_text(p_row ->> 'name', 160); end if;
  if p_row ? 'type'            then s.type := nullif(p_row ->> 'type', ''); end if;
  if p_row ? 'phone'           then s.phone := app_private.clean_text(p_row ->> 'phone', 32); end if;
  if p_row ? 'open_hours'      then s.open_hours := app_private.clean_text(p_row ->> 'open_hours', 120); end if;
  if p_row ? 'is_partner'      then s.is_partner := coalesce(app_private.try_bool(p_row ->> 'is_partner'), false); end if;
  if p_row ? 'commission_rate' then s.commission_rate := coalesce(app_private.try_num(p_row ->> 'commission_rate'), 0); end if;
  if p_row ? 'status'          then s.status := coalesce(nullif(p_row ->> 'status', ''), s.status); end if;
  if p_row ? 'notes'           then s.notes := app_private.clean_text(p_row ->> 'notes', 2000); end if;
  if p_row ? 'is_demo'         then s.is_demo := coalesce(app_private.try_bool(p_row ->> 'is_demo'), s.is_demo); end if;
  if p_row ? 'lat' or p_row ? 'lng' then
    v_lat := app_private.try_num(p_row ->> 'lat');
    v_lng := app_private.try_num(p_row ->> 'lng');
    if v_lat is null or v_lng is null then
      s.geom := null;
    elsif v_lat between -90 and 90 and v_lng between -180 and 180 then
      s.geom := app_private.pt(v_lat, v_lng);
    else
      raise exception 'invalid_coordinates' using errcode = '22023';
    end if;
  end if;

  if s.name is null then
    raise exception 'incomplete' using errcode = '23514', detail = '["name"]', hint = 'Service name is required.';
  end if;
  if s.type is null or s.type not in ('lodging', 'repair', 'fuel', 'rental') then
    raise exception 'invalid_type' using errcode = '22023', detail = coalesce(s.type, 'null');
  end if;
  if s.status is null or s.status not in ('active', 'inactive') then
    raise exception 'invalid_status' using errcode = '22023', detail = coalesce(s.status, 'null');
  end if;

  if v_exists then
    update public.services set
      route_id = s.route_id, name = s.name, type = s.type, geom = s.geom, phone = s.phone,
      open_hours = s.open_hours, is_partner = s.is_partner, commission_rate = s.commission_rate,
      status = s.status, notes = s.notes, is_demo = s.is_demo
    where id = s.id;
  else
    insert into public.services (id, route_id, name, type, geom, phone, open_hours, is_partner,
                                 commission_rate, status, notes, is_demo)
    values (s.id, s.route_id, s.name, s.type, s.geom, s.phone, s.open_hours, s.is_partner,
            s.commission_rate, s.status, s.notes, s.is_demo);
  end if;
  return (select to_jsonb(v) from public.v_services v where v.id = s.id);
end $$;

-- ------------------------------------------------------------ privileges ----
do $$
declare
  f text;
  admin_rpcs text[] := array[
    'public.admin_kpis()',
    'public.admin_publish_pack(text, text, text)',
    'public.admin_review_submission(text, text, text)',
    'public.admin_review_samples(bigint[], text)',
    'public.admin_resolve_session(uuid, text)',
    'public.admin_approve_content(bigint, text)',
    'public.admin_upsert_facility(jsonb)',
    'public.admin_upsert_service(jsonb)'];
  has_roles boolean := exists (select 1 from pg_roles where rolname = 'anon');
begin
  foreach f in array admin_rpcs loop
    execute format('revoke all on function %s from public', f);
    if has_roles then
      execute format('revoke all on function %s from anon', f);
      execute format('grant execute on function %s to authenticated, service_role', f);
    end if;
  end loop;
end $$;
