-- =============================================================================
-- NomadCare v2 — 0500 public RPC (granted to anon + authenticated)
-- Owner: P1 database. Contract: CONTRACT.md §8 (Pack format) + §9 (RPC names).
--   list_routes() · get_data_pack(route, carrier) · build_data_pack(route, carrier)
--   nearest_facilities(lat, lng, limit, types) · get_content_release()
--   register_device(carrier, app_version) · sync_device_ops(device_id, secret, ops)
-- All public functions are SECURITY DEFINER with a fixed search_path and only
-- ever expose published data (verified facilities, active services) or data
-- that belongs to the calling device (device id + secret).
-- Internal helpers live in schema app_private (not exposed by the Data API).
-- =============================================================================
set search_path = public, extensions;

-- =============================================================================
-- 1. Small internal helpers
-- =============================================================================

-- Point from lat/lng (WGS84).
create or replace function app_private.pt(p_lat double precision, p_lng double precision)
returns geography
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select case when p_lat is null or p_lng is null then null
              else ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography end
$$;

-- [lat, lng] rounded to 6 decimals (~0.1 m) for a point.
create or replace function app_private.latlng(p_geom geography)
returns jsonb
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select case when p_geom is null then null else
    jsonb_build_array(trim_scale(round(ST_Y(p_geom::geometry)::numeric, 6)), trim_scale(round(ST_X(p_geom::geometry)::numeric, 6))) end
$$;

-- [[lat, lng], …] for a line, in vertex order.
create or replace function app_private.line_latlng(p_geom geometry)
returns jsonb
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_array(trim_scale(round(ST_Y(d.geom)::numeric, 6)),
                                              trim_scale(round(ST_X(d.geom)::numeric, 6))) order by d.path),
                  '[]'::jsonb)
  from ST_DumpPoints(p_geom) as d
$$;

-- Lenient parsers for JSON coming from devices (never raise).
create or replace function app_private.try_ts(p text)
returns timestamptz
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
begin
  if p is null or btrim(p) = '' then
    return null;
  end if;
  if p ~ '^\d{10,13}(\.\d+)?$' then            -- epoch seconds or milliseconds
    if length(split_part(p, '.', 1)) >= 13 then
      return to_timestamp(p::numeric / 1000.0);
    end if;
    return to_timestamp(p::numeric);
  end if;
  return p::timestamptz;
exception when others then
  return null;
end $$;

create or replace function app_private.try_num(p text)
returns double precision
language plpgsql
immutable
set search_path = public, extensions, pg_temp
as $$
begin
  if p is null or btrim(p) = '' then
    return null;
  end if;
  return p::double precision;
exception when others then
  return null;
end $$;

create or replace function app_private.try_bool(p text)
returns boolean
language plpgsql
immutable
set search_path = public, extensions, pg_temp
as $$
begin
  if p is null or btrim(p) = '' then
    return null;
  end if;
  return p::boolean;
exception when others then
  return null;
end $$;

create or replace function app_private.try_uuid(p text)
returns uuid
language plpgsql
immutable
set search_path = public, extensions, pg_temp
as $$
begin
  if p is null or btrim(p) = '' then
    return null;
  end if;
  return p::uuid;
exception when others then
  return null;
end $$;

-- Trimmed, length-capped text; empty → null.
create or replace function app_private.clean_text(p text, p_max int default 200)
returns text
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select nullif(btrim(left(p, p_max)), '')
$$;

create or replace function app_private.valid_email(p text)
returns boolean
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select p is not null and length(p) <= 254 and p ~* '^[^@\s<>"'',;]+@[^@\s<>"'',;]+\.[a-z]{2,}$'
$$;

-- =============================================================================
-- 2. Route helpers (bbox, corridor, facility membership)
-- =============================================================================

-- [south, west, north, east]. Uses routes.bbox when valid (array or object;
-- a GeoJSON-ordered [w,s,e,n] array is detected and re-ordered), otherwise
-- the extent of the route line + edges + nodes.
create or replace function app_private.route_bbox(p_route_id text)
returns jsonb
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
declare
  v jsonb;
  b box2d;
begin
  select r.bbox into v from public.routes r where r.id = p_route_id;
  if v is not null and jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 4 then
    if abs((v ->> 0)::numeric) > 90 or abs((v ->> 2)::numeric) > 90 then
      return jsonb_build_array(v -> 1, v -> 0, v -> 3, v -> 2);   -- was [w,s,e,n]
    end if;
    return v;
  end if;
  if v is not null and jsonb_typeof(v) = 'object' then
    if v ? 'south' then
      return jsonb_build_array(v -> 'south', v -> 'west', v -> 'north', v -> 'east');
    elsif v ? 'min_lat' then
      return jsonb_build_array(v -> 'min_lat', v -> 'min_lng', v -> 'max_lat', v -> 'max_lng');
    end if;
  end if;
  select ST_Extent(g) into b
  from (
    select r.geom::geometry as g from public.routes r where r.id = p_route_id and r.geom is not null
    union all select e.geom::geometry from public.route_edges e where e.route_id = p_route_id
    union all select n.geom::geometry from public.route_nodes n where n.route_id = p_route_id
  ) as x;
  if b is null then
    return null;
  end if;
  return jsonb_build_array(trim_scale(round(ST_YMin(b)::numeric, 6)), trim_scale(round(ST_XMin(b)::numeric, 6)),
                           trim_scale(round(ST_YMax(b)::numeric, 6)), trim_scale(round(ST_XMax(b)::numeric, 6)));
end $$;

-- Route line used for corridor queries: routes.geom, else the union of edges.
create or replace function app_private.route_corridor(p_route_id text)
returns geography
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select coalesce(
    (select r.geom from public.routes r where r.id = p_route_id),
    (select ST_Union(e.geom::geometry)::geography from public.route_edges e where e.route_id = p_route_id)
  )
$$;

-- Corridor half-width for facilities/services that have no route_id (metres).
create or replace function app_private.corridor_m()
returns double precision
language sql
immutable
set search_path = public, extensions, pg_temp
as $$ select 15000::double precision $$;

-- A facility/service belongs to a route when tagged with it, or when untagged
-- and within the corridor of the route line.
create or replace function app_private.in_route(p_item_route text, p_item_geom geography,
                                                p_route_id text, p_corridor geography)
returns boolean
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  -- CASE guarantees the (expensive) geography distance only runs for untagged items
  select case
    when p_item_route is not null then p_item_route = p_route_id
    when p_item_geom is null or p_corridor is null then false
    else ST_DWithin(p_item_geom, p_corridor, app_private.corridor_m())
  end
$$;

-- Route length: stored value, else sum of the non-connector edges.
create or replace function app_private.route_length_km(p_route_id text)
returns numeric
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select trim_scale(round(coalesce(
    (select r.length_km from public.routes r where r.id = p_route_id),
    (select sum(e.length_km) from public.route_edges e where e.route_id = p_route_id and not e.is_connector),
    0)::numeric, 3))
$$;

-- =============================================================================
-- 3. JSON shapes (CONTRACT §8)
-- =============================================================================

-- Facility as published in a pack (verified_at 'YYYY-MM-DD').
create or replace function app_private.facility_pack_json(f public.facilities)
returns jsonb
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'id',                  f.id,
    'name',                f.name,
    'type',                f.type,
    'address',             f.address,
    'lat',                 trim_scale(round(ST_Y(f.geom::geometry)::numeric, 6)),
    'lng',                 trim_scale(round(ST_X(f.geom::geometry)::numeric, 6)),
    'phone',               f.phone,
    'open_hours',          f.open_hours,
    'night_shift',         f.night_shift,
    'trauma_capable',      f.trauma_capable,
    'verified_by',         f.verified_by,
    'verified_at',         f.verified_at,
    'is_stale',            coalesce(f.verified_at < app_private.today_vn() - 90, false),
    'days_since_verified', app_private.today_vn() - f.verified_at,
    'is_demo',             f.is_demo)
$$;

create or replace function app_private.service_pack_json(s public.services)
returns jsonb
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'id',         s.id,
    'name',       s.name,
    'type',       s.type,
    'lat',        trim_scale(round(ST_Y(s.geom::geometry)::numeric, 6)),
    'lng',        trim_scale(round(ST_X(s.geom::geometry)::numeric, 6)),
    'phone',      s.phone,
    'open_hours', s.open_hours,
    'is_partner', s.is_partner,
    'is_demo',    s.is_demo)
$$;

-- Buddy session as returned to the device (CONTRACT §8 Session object).
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

-- Most relevant session of a device: the newest open one, else the newest.
create or replace function app_private.device_session_json(p_device_id uuid)
returns jsonb
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select app_private.session_json(s)
  from public.buddy_sessions s
  where s.device_id = p_device_id
  order by (s.status <> 'closed') desc, s.started_at desc
  limit 1
$$;

-- =============================================================================
-- 4. Pack builder
-- =============================================================================

-- Builds the Pack JSON (CONTRACT §8) for one route × carrier.
--   * coordinates are [lat, lng]; every edge geometry is oriented from→to
--   * array order: nodes along the route line; edges, facilities, services by id
--   * segments: latest model_version of that route×carrier, ordered by edge, seq;
--     an edge without any segment gets one 'uncertain' segment (confidence 0)
--     so that segments always cover every edge fully
--   * facilities: verified only (+ is_stale / days_since_verified);
--     services: active only; both with coordinates
--   * size_bytes = octet_length of the final JSON text (fixed point, exact)
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

-- Live build (not stored). version = current published version (0 if none).
create or replace function public.build_data_pack(p_route_id text, p_carrier text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_version int;
begin
  select coalesce(max(p.version), 0) into v_version
  from public.data_packs p
  where p.route_id = p_route_id and p.carrier = p_carrier and p.is_current;
  return app_private.build_pack(p_route_id, p_carrier, v_version, now());
end $$;
comment on function public.build_data_pack(text, text) is
  'Live Pack JSON (CONTRACT §8) built from the current tables; not stored.';

-- Current published pack; falls back to a live build when nothing is published
-- (or when a published row has no stored payload, e.g. imported metadata).
create or replace function public.get_data_pack(p_route_id text, p_carrier text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_payload jsonb;
  v_version int;
  v_published timestamptz;
begin
  select p.payload, p.version, p.published_at
    into v_payload, v_version, v_published
  from public.data_packs p
  where p.route_id = p_route_id and p.carrier = p_carrier and p.is_current
  order by p.version desc
  limit 1;
  if v_payload is not null then
    return v_payload;
  end if;
  return app_private.build_pack(p_route_id, p_carrier, coalesce(v_version, 0), coalesce(v_published, now()));
end $$;
comment on function public.get_data_pack(text, text) is
  'Current published Pack JSON for a route × carrier (live build if none is published).';

-- Route catalogue with per-carrier accuracy and current pack metadata.
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

-- Nearest verified facilities to a point (server-side twin of the offline
-- client search). Ordered purely by distance, then trauma capability —
-- never by partnership (PDF C.2).
create or replace function public.nearest_facilities(p_lat double precision, p_lng double precision,
                                                     p_limit int default 5, p_types text[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_pt    geography;
  v_limit int := greatest(1, least(coalesce(p_limit, 5), 50));
  v_out   jsonb;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid_coordinates' using errcode = '22023';
  end if;
  v_pt := app_private.pt(p_lat, p_lng);

  select coalesce(jsonb_agg(z.item order by z.dist, z.trauma desc), '[]'::jsonb) into v_out
  from (
    select app_private.facility_pack_json(c.fac)
             || jsonb_build_object('route_id', c.route_id,
                                   'distance_km', trim_scale(round((ST_Distance(c.geom, v_pt) / 1000.0)::numeric, 3))) as item,
           ST_Distance(c.geom, v_pt) as dist,
           coalesce(c.trauma_capable, false) as trauma
    from (
      -- KNN pre-selection via the GiST index, then exact spheroid distance
      select f as fac, f.geom, f.route_id, f.trauma_capable
      from public.facilities f
      where f.status = 'verified'
        and f.geom is not null
        and (p_types is null or cardinality(p_types) = 0 or f.type = any (p_types))
      order by f.geom <-> v_pt
      limit greatest(v_limit * 4, 40)
    ) c
    order by dist, trauma desc
    limit v_limit
  ) z;
  return v_out;
end $$;

-- Medical content release shown in the app: latest approved, else latest.
create or replace function public.get_content_release()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select to_jsonb(x)
  from (
    select c.id, c.version, c.kind, c.status, c.notes, c.reviewer_round1,
           c.approver, c.approved_at, c.created_at
    from public.content_releases c
    order by (c.status = 'approved') desc, c.approved_at desc nulls last, c.created_at desc, c.id desc
    limit 1
  ) x
$$;

-- =============================================================================
-- 6. Devices & sync
-- =============================================================================

-- Anonymous device registration. Returns the secret ONCE; only its sha256 is
-- stored. The device keeps {device_id, secret} in its encrypted store.
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
begin
  insert into public.devices (secret_hash, carrier, app_version, last_seen_at)
  values (encode(digest(v_secret, 'sha256'), 'hex'), v_carrier, app_private.clean_text(p_app_version, 40), now())
  returning id into v_id;
  return jsonb_build_object('device_id', v_id, 'secret', v_secret);
end $$;

-- Verifies a device credential (raises 'unauthorized_device', SQLSTATE 28000;
-- same code as the local mock backend, so the client re-registers).
create or replace function app_private.verify_device(p_device_id uuid, p_secret text)
returns public.devices
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  d public.devices%rowtype;
begin
  select * into d from public.devices where id = p_device_id;
  if not found or d.secret_hash is null or p_secret is null
     or d.secret_hash <> encode(digest(p_secret, 'sha256'), 'hex') then
    raise exception 'unauthorized_device'
      using errcode = '28000', hint = 'Unknown device or wrong secret: call register_device again.';
  end if;
  return d;
end $$;

-- Only the consented PUBLIC medical layer may reach the server (PDF 6.5).
create or replace function app_private.sanitize_public_medical(p jsonb)
returns jsonb
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select case when p is null or jsonb_typeof(p) <> 'object' then null else
    nullif(jsonb_strip_nulls(jsonb_build_object(
      'blood_type',  app_private.clean_text(p ->> 'blood_type', 12),
      'allergies',   app_private.clean_text(p ->> 'allergies', 300),
      'conditions',  app_private.clean_text(p ->> 'conditions', 300),
      'medications', app_private.clean_text(p ->> 'medications', 300),
      'notes',       app_private.clean_text(p ->> 'notes', 300))), '{}'::jsonb) end
$$;

-- Inserts one buddy event (idempotent on event id) and returns its id.
create or replace function app_private.insert_event(p_session public.buddy_sessions, p_kind text,
                                                    p_event_id uuid, p_lat double precision,
                                                    p_lng double precision, p_accuracy numeric,
                                                    p_client_ts timestamptz, p_queued boolean,
                                                    p_note text, p_meta jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid := coalesce(p_event_id, gen_random_uuid());
begin
  insert into public.checkin_events (id, session_id, device_id, kind, lat, lng, accuracy_m,
                                     client_ts, received_at, queued, note, meta)
  values (v_id, p_session.id, p_session.device_id, p_kind,
          case when p_lat between -90 and 90 and p_lng between -180 and 180 then p_lat end,
          case when p_lat between -90 and 90 and p_lng between -180 and 180 then p_lng end,
          p_accuracy, coalesce(p_client_ts, now()), now(), coalesce(p_queued, false),
          app_private.clean_text(p_note, 500), p_meta)
  on conflict (id) do nothing;
  return v_id;
end $$;

-- Resolves the target session of an op: explicit id (must belong to the
-- device), else the device's newest open session.
create or replace function app_private.op_session(p_device public.devices, p_session_id uuid)
returns public.buddy_sessions
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  s public.buddy_sessions%rowtype;
begin
  if p_session_id is not null then
    select * into s from public.buddy_sessions where id = p_session_id for update;
    if not found then
      raise exception 'session_not_found' using errcode = 'P0002', detail = p_session_id::text;
    end if;
    if s.device_id is distinct from p_device.id then
      raise exception 'session_forbidden' using errcode = '42501', detail = 'session belongs to another device';
    end if;
    return s;
  end if;
  select * into s from public.buddy_sessions
  where device_id = p_device.id and status <> 'closed'
  order by started_at desc limit 1
  for update;
  if not found then
    raise exception 'no_active_session' using errcode = 'P0002';
  end if;
  return s;
end $$;

-- ---- op: buddy.start ---------------------------------------------------------
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
  v_start  timestamptz := least(coalesce(app_private.try_ts(v ->> 'started_at'),
                                         app_private.try_ts(p_data ->> 'client_ts'), now()), now());
  v_int    int := greatest(1, least(coalesce(app_private.try_num(v ->> 'interval_min'), 60)::int, 10080));
  v_grace  int := greatest(0, least(coalesce(app_private.try_num(v ->> 'grace_min'), 15)::int, 1440));
  v_share  boolean := coalesce(app_private.try_bool(v ->> 'share_public_medical'), false);
  v_lat    double precision := coalesce(app_private.try_num(v ->> 'lat'), app_private.try_num(v ->> 'last_lat'));
  v_lng    double precision := coalesce(app_private.try_num(v ->> 'lng'), app_private.try_num(v ->> 'last_lng'));
  v_warn   jsonb := '[]'::jsonb;
  v_prev   public.buddy_sessions%rowtype;
  s        public.buddy_sessions%rowtype;
  v_old    public.buddy_sessions%rowtype;
begin
  if not (v_lat between -90 and 90 and v_lng between -180 and 180) then
    v_lat := null; v_lng := null;
  end if;
  if v_email is not null and not app_private.valid_email(v_email) then
    v_warn := v_warn || '"invalid_recipient_email"'::jsonb;
    v_email := null;
  end if;
  if v_email is null then
    v_warn := v_warn || '"no_recipient_email"'::jsonb;
  end if;

  select * into v_prev from public.buddy_sessions where id = v_id for update;
  if found and v_prev.device_id is distinct from p_device.id then
    raise exception 'session_conflict' using errcode = '42501', detail = 'session id belongs to another device';
  end if;

  -- one open session per device: close older open sessions
  for v_old in
    select * from public.buddy_sessions
    where device_id = p_device.id and status <> 'closed' and id <> v_id
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
    app_private.clean_text(v ->> 'traveler_name', 80),
    app_private.clean_text(coalesce(v -> 'recipient' ->> 'name', v ->> 'recipient_name'), 80),
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

-- ---- op: buddy.checkin (checkin | location | pre_deadzone | sos | overdue) ----
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
  v_escalate boolean := false; -- send the alert now (active → overdue)
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
    -- late event for a closed session: keep it in the log, change nothing
    return jsonb_build_object('event_id', v_event, 'received_at', now(), 'status', s.status,
                              'ignored', 'session_closed');
  end if;

  -- newest known location
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
      perform app_private.insert_event(s, 'resolved', null, v_lat, v_lng, null, now(), false, null,
                                       jsonb_build_object('reason', 'checkin', 'previous_status', v_prev));
    end if;
  elsif v_kind in ('sos', 'overdue') and s.status = 'active' then
    -- SOS pressed, or overdue detected on the device while offline: escalate
    -- like a missed check-in so the recipient is e-mailed (alert_payload
    -- words it as SOS when an 'sos' event exists since the last check-in).
    -- Same rule as the local mock backend (backend-local.js opBuddyCheckin).
    s.status := 'overdue';
    s.alerted_at := null;
    v_escalate := true;
  end if;

  update public.buddy_sessions set
    status           = s.status,
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
                            'next_due_at', s.next_due_at);
end $$;

-- ---- op: buddy.stop ------------------------------------------------------------
create or replace function app_private.op_buddy_stop(p_device public.devices, p_data jsonb, p_op_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_ts   timestamptz := least(coalesce(app_private.try_ts(p_data ->> 'client_ts'), now()), now());
  v_lat  double precision := app_private.try_num(p_data ->> 'lat');
  v_lng  double precision := app_private.try_num(p_data ->> 'lng');
  s      public.buddy_sessions%rowtype;
begin
  s := app_private.op_session(p_device, coalesce(app_private.try_uuid(p_data ->> 'session_id'),
                                                 app_private.try_uuid(p_data ->> 'id')));
  if s.status = 'closed' then
    return jsonb_build_object('session_id', s.id, 'status', s.status, 'received_at', now(), 'ignored', 'already_closed');
  end if;
  if s.status in ('overdue', 'alerted') then
    perform app_private.insert_event(s, 'resolved', null, v_lat, v_lng, null, v_ts, false, null,
                                     jsonb_build_object('by', 'stop', 'previous_status', s.status));
  end if;
  perform app_private.insert_event(s, 'stop', app_private.try_uuid(p_data ->> 'event_id'), v_lat, v_lng,
                                   app_private.try_num(p_data ->> 'accuracy_m')::numeric, v_ts,
                                   now() - v_ts > interval '2 minutes', p_data ->> 'note', null);
  update public.buddy_sessions
     set status = 'closed', closed_at = v_ts
   where id = s.id;
  if s.status = 'alerted' then
    perform app_private.notify_deadman(jsonb_build_object('session_id', s.id, 'type', 'resolved'));
  end if;
  return jsonb_build_object('session_id', s.id, 'status', 'closed', 'received_at', now());
end $$;

-- ---- op: buddy.resolve ("Tôi an toàn": re-arms the timer, leaves overdue/alerted) ----
create or replace function app_private.op_buddy_resolve(p_device public.devices, p_data jsonb, p_op_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_ts  timestamptz := least(coalesce(app_private.try_ts(p_data ->> 'client_ts'), now()), now());
  v_lat double precision := app_private.try_num(p_data ->> 'lat');
  v_lng double precision := app_private.try_num(p_data ->> 'lng');
  s     public.buddy_sessions%rowtype;
  v_was text;
begin
  s := app_private.op_session(p_device, coalesce(app_private.try_uuid(p_data ->> 'session_id'),
                                                 app_private.try_uuid(p_data ->> 'id')));
  v_was := s.status;
  if s.status = 'closed' then
    return jsonb_build_object('session_id', s.id, 'status', s.status, 'received_at', now(), 'ignored', 'session_closed');
  end if;
  if not (v_lat between -90 and 90 and v_lng between -180 and 180) then
    v_lat := null; v_lng := null;
  end if;
  perform app_private.insert_event(s, 'resolved', app_private.try_uuid(p_data ->> 'event_id'), v_lat, v_lng,
                                   null, v_ts, now() - v_ts > interval '2 minutes', p_data ->> 'note',
                                   jsonb_build_object('by', 'traveler', 'previous_status', v_was));
  update public.buddy_sessions set
    status           = 'active',
    alerted_at       = null,
    last_checkin_at  = greatest(coalesce(last_checkin_at, v_ts), v_ts),
    next_due_at      = greatest(coalesce(last_checkin_at, v_ts), v_ts) + make_interval(mins => interval_min),
    last_lat         = case when v_lat is not null and (last_location_at is null or v_ts >= last_location_at) then v_lat else last_lat end,
    last_lng         = case when v_lat is not null and (last_location_at is null or v_ts >= last_location_at) then v_lng else last_lng end,
    last_location_at = case when v_lat is not null and (last_location_at is null or v_ts >= last_location_at) then v_ts else last_location_at end
  where id = s.id
  returning * into s;
  if v_was = 'alerted' then
    perform app_private.notify_deadman(jsonb_build_object('session_id', s.id, 'type', 'resolved'));
  end if;
  return jsonb_build_object('session_id', s.id, 'status', s.status, 'received_at', now(), 'next_due_at', s.next_due_at);
end $$;

-- ---- op: report.submit (community facility report) -------------------------------
create or replace function app_private.op_report_submit(p_device public.devices, p_data jsonb, p_op_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id   text := coalesce(app_private.clean_text(p_data ->> 'id', 64), p_op_id::text);
  v_kind text := coalesce(nullif(p_data ->> 'kind', ''), 'new');
  v_lat  double precision := app_private.try_num(p_data ->> 'lat');
  v_lng  double precision := app_private.try_num(p_data ->> 'lng');
begin
  if v_kind not in ('new', 'correction', 'closed', 'signal_report') then
    raise exception 'invalid_kind' using errcode = '22023', detail = v_kind;
  end if;
  if octet_length(p_data::text) > 8000 then
    raise exception 'payload_too_large' using errcode = '22023';
  end if;
  if not (v_lat between -90 and 90 and v_lng between -180 and 180) then
    v_lat := null; v_lng := null;
  end if;
  -- the device sends {id, kind, facility_id, payload:{name,type,note,route_id}, lat, lng};
  -- a flat report {kind, name, type, note, …} is accepted too
  insert into public.facility_submissions (id, device_id, facility_id, kind, payload, lat, lng, status)
  values (v_id, p_device.id, app_private.clean_text(p_data ->> 'facility_id', 64), v_kind,
          case when jsonb_typeof(p_data -> 'payload') = 'object' then p_data -> 'payload'
               else p_data - array['id', 'kind', 'facility_id', 'lat', 'lng'] end,
          v_lat, v_lng, 'pending')
  on conflict (id) do nothing;
  return jsonb_build_object('submission_id', v_id, 'received_at', now());
end $$;

-- ---- op: signal.log (opt-in anonymous community signal samples) --------------------
create or replace function app_private.op_signal_log(p_device public.devices, p_data jsonb, p_op_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_arr      jsonb := case when jsonb_typeof(p_data) = 'array' then p_data else p_data -> 'samples' end;
  x          jsonb;
  v_lat      double precision;
  v_lng      double precision;
  v_pt       geography;
  v_carrier  text;
  v_route    text;
  v_edge     text;
  v_rsrp     int;
  v_tech     text;
  v_level    text;
  v_ok       int := 0;
  v_skip     int := 0;
begin
  if v_arr is null or jsonb_typeof(v_arr) <> 'array' then
    raise exception 'invalid_samples' using errcode = '22023';
  end if;
  if jsonb_array_length(v_arr) > 1000 then
    raise exception 'too_many_samples' using errcode = '22023';
  end if;
  for x in select value from jsonb_array_elements(v_arr) loop
    v_lat := app_private.try_num(x ->> 'lat');
    v_lng := app_private.try_num(x ->> 'lng');
    v_carrier := coalesce(nullif(x ->> 'carrier', ''), p_device.carrier);
    v_rsrp := app_private.try_num(coalesce(x ->> 'rsrp_dbm', x ->> 'rsrp'))::int;
    v_tech := case when x ->> 'tech' in ('5G', '4G', '3G', '2G', 'none') then x ->> 'tech' end;
    v_level := case when x ->> 'level' in ('likely', 'uncertain', 'lost') then x ->> 'level' end;
    if v_rsrp is not null and v_rsrp not between -160 and -20 then
      v_rsrp := null;
    end if;
    if not (v_lat between -90 and 90 and v_lng between -180 and 180)
       or not exists (select 1 from public.carriers c where c.id = v_carrier)
       or (v_level is null and v_rsrp is null and v_tech is null) then
      v_skip := v_skip + 1;
      continue;
    end if;
    v_pt := app_private.pt(v_lat, v_lng);
    v_route := case when exists (select 1 from public.routes r where r.id = x ->> 'route_id') then x ->> 'route_id' end;
    v_edge := case when exists (select 1 from public.route_edges e where e.id = x ->> 'edge_id') then x ->> 'edge_id' end;
    if v_edge is null then
      select e.id, coalesce(v_route, e.route_id) into v_edge, v_route
      from public.route_edges e
      where ST_DWithin(e.geom, v_pt, 5000) and (v_route is null or e.route_id = v_route)
      order by e.geom <-> v_pt
      limit 1;
      if v_edge is not null and not exists (select 1 from public.route_edges e
                                              where e.id = v_edge and ST_DWithin(e.geom, v_pt, 1000)) then
        v_edge := null;   -- close to the route but not to a specific edge
      end if;
    end if;
    if v_route is null then
      v_skip := v_skip + 1;
      continue;
    end if;
    insert into public.signal_samples (route_id, edge_id, carrier, tech, rsrp_dbm, level, geom,
                                       measured_at, source, status, device_model, is_holdout)
    values (v_route, v_edge, v_carrier, v_tech, v_rsrp, v_level, v_pt,
            least(coalesce(app_private.try_ts(coalesce(x ->> 'measured_at', x ->> 'ts')), now()), now()),
            'community', 'pending', app_private.clean_text(x ->> 'device_model', 60), false);
    v_ok := v_ok + 1;
  end loop;
  return jsonb_build_object('inserted', v_ok, 'skipped', v_skip);
end $$;

-- ---- dispatcher -------------------------------------------------------------------
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
    when 'report.submit' then return app_private.op_report_submit(p_device, p_data, p_op_id);
    when 'signal.log'    then return app_private.op_signal_log(p_device, p_data, p_op_id);
    else
      raise exception 'unknown_op' using errcode = '22023', detail = coalesce(p_op, 'null');
  end case;
end $$;

-- Batch sync of the device outbox. Each op runs in its own sub-transaction;
-- an op id that was already processed returns 'duplicate' with the stored
-- result (idempotency via device_ops). Failed ops are NOT recorded, so the
-- device may retry them; results carry retryable=false for bad input.
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
begin
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
      update public.device_ops set result = jsonb_build_object('status', 'ok', 'data', v_data) where id = v_id;
      v_res := v_res || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'ok', 'data', v_data));
    exception when others then
      get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
      v_res := v_res || jsonb_build_array(jsonb_build_object(
        'id', v_id, 'status', 'error', 'error', v_msg, 'code', v_state,
        'retryable', not (v_state like '22%' or v_state like '23%' or v_state in ('P0002', '28000', '42501'))));
    end;
  end loop;

  return jsonb_build_object(
    'results',     v_res,
    'server_time', now(),
    'session',     app_private.device_session_json(d.id));
end $$;

-- =============================================================================
-- 7. Privileges
-- =============================================================================
do $$
declare
  f text;
  public_rpcs text[] := array[
    'public.list_routes()',
    'public.get_data_pack(text, text)',
    'public.build_data_pack(text, text)',
    'public.nearest_facilities(double precision, double precision, int, text[])',
    'public.get_content_release()',
    'public.register_device(text, text)',
    'public.sync_device_ops(uuid, text, jsonb)'];
  has_roles boolean := exists (select 1 from pg_roles where rolname = 'anon');
begin
  foreach f in array public_rpcs loop
    execute format('revoke all on function %s from public', f);
    if has_roles then
      execute format('grant execute on function %s to anon, authenticated, service_role', f);
    end if;
  end loop;
end $$;
