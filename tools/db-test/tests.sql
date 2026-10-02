-- =============================================================================
-- tests.sql — assertions for the NomadCare Supabase backend (run by run.sh
-- after shim + migrations + seed). Data-agnostic: works on supabase/seed.sql or
-- tools/db-test/fixtures.sql. Any failure raises 'TEST FAILED: …' and stops psql.
-- psql variables: with_fakes=on|off (fake pg_net / pg_cron / realtime present)
--                 expected_file=PATH (optional) JSON of tools/db-test/expected_packs.js:
--                 enables 2b/2c (parity of packs, list_routes, admin_kpis with
--                 the browser build of seed-core.js) — only valid on a fresh seed.sql
-- Sections 6b / 8b are end-to-end flows (device: register → … → admin resolve;
-- admin: report → approve → verify → publish) and stay data-agnostic.
-- Section 10 covers 20260928000100_hardening + 20260930000100 (recipient phone
-- required / e-mail optional since round 2, name cleaning,
-- rate limits, SOS alert_reason, buddy.update, device.erase, retention, manual-
-- alert attribution, admin re-approval / dates / bounding box / pack changes).
-- Section 10b covers 20260929000100 (alert quota ledger that device.erase cannot
-- reset, all-clear e-mails counted, Gmail aliases, retention); route region_en is
-- checked with the pack / list_routes shape and parity (1, 2, 2b).
-- 20260930000100 (round 2 R7): buddy.start needs the recipient phone (E.164,
-- app_private.norm_phone), the e-mail is optional; phone-only sessions are never
-- e-mailed nor counted by the start limit; legacy e-mail-only sessions keep working.
-- 20261002000100 (2026-10-02): the recipient phone must be able to receive the SMS —
-- a Vietnamese 02x landline is refused for a new session (recipient_phone_not_mobile;
-- app_private.valid_phone / phone_is_landline = normPhone().valid / .landline), a
-- legacy session that stored a landline keeps working (end of section 10).
-- Section 10c covers 20260930000200 (round 2 R6): buddy.heartbeat, contact_lost
-- detection (paused / silence_until / recent check-in protect, phone-only never
-- e-mailed), Web Push ops push.subscribe / unsubscribe / schedule, the
-- push-dispatch API (nc_push_claim / nc_push_result / nc_push_tick) and privileges.
-- =============================================================================
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;
set search_path = public, extensions;

-- ------------------------------------------------------------ helpers ----
set client_min_messages = warning;
drop schema if exists nc_test cascade;
set client_min_messages = notice;
create schema nc_test;
create table nc_test.vars (k text primary key, v text);
create or replace function nc_test.ok(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'TEST FAILED: %', p_name;
  end if;
  perform set_config('nc_test.passed',
    (coalesce(nullif(current_setting('nc_test.passed', true), ''), '0')::int + 1)::text, false);
  raise notice 'ok  %', p_name;
end $$;
create or replace function nc_test.setv(p_k text, p_v text) returns void
language sql as $$ insert into nc_test.vars values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
create or replace function nc_test.getv(p_k text) returns text
language sql as $$ select v from nc_test.vars where k = p_k $$;
-- sorted key list of a JSON object
create or replace function nc_test.keys(p jsonb) returns text[]
language sql immutable as $$ select array(select jsonb_object_keys(p) order by 1) $$;
create or replace function nc_test.sorted(p text[]) returns text[]
language sql immutable as $$ select array(select unnest(p) order by 1) $$;
-- act as an API role (claims like PostgREST sets them)
create or replace function nc_test.claims(p_role text, p_sub uuid default null) returns void
language sql as $$
  select set_config('request.jwt.claims',
           jsonb_build_object('role', p_role, 'sub', p_sub, 'email',
                              case when p_sub is not null then 'user-' || left(p_sub::text, 8) || '@test.local' end)::text, false),
         set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), false),
         set_config('request.jwt.claim.role', p_role, false)
$$;
create or replace function nc_test.noclaims() returns void
language sql as $$
  select set_config('request.jwt.claims', '', false),
         set_config('request.jwt.claim.sub', '', false),
         set_config('request.jwt.claim.role', '', false)
$$;
-- one field of every element of a JSON array / the strings of a JSON string array
create or replace function nc_test.ids(p jsonb, p_field text default 'id') returns text[]
language sql immutable as $$
  select array(select x ->> p_field from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x)
$$;
create or replace function nc_test.texts(p jsonb) returns text[]
language sql immutable as $$
  select array(select jsonb_array_elements_text(coalesce(p, '[]'::jsonb)))
$$;
-- '' when both lists hold the same values, else "missing …; extra …; count …" (first 10 of each)
create or replace function nc_test.set_diff(p_exp text[], p_act text[]) returns text
language sql immutable as $$
  select concat_ws('; ',
    'missing ' || nullif(array_to_string(array(
        select x from unnest(p_exp) x except select y from unnest(p_act) y order by 1 limit 10), ','), ''),
    'extra ' || nullif(array_to_string(array(
        select y from unnest(p_act) y except select x from unnest(p_exp) x order by 1 limit 10), ','), ''),
    case when cardinality(p_exp) is distinct from cardinality(p_act)
         then 'count ' || coalesce(cardinality(p_act), 0) || ' vs expected ' || coalesce(cardinality(p_exp), 0) end)
$$;
-- ' [detail]' suffix for an assertion name ('' when there is nothing to report)
create or replace function nc_test.why(p_detail text) returns text
language sql immutable as $$
  select case when coalesce(p_detail, '') = '' then '' else ' [' || left(p_detail, 400) || ']' end
$$;

-- Pack parity: a server pack (get_data_pack / build_data_pack) against the pack the
-- browser builds from seed-core.js (one entry of tools/db-test/expected_packs.js).
-- Arrays are compared as sets of ids (server nodes are in travel order, the
-- browser keeps seed order), then field by field; numbers are compared at the
-- precision the server publishes (coordinates 6 decimals, km/confidence 3).
create or replace function nc_test.pack_parity(p jsonb, e jsonb, tag text) returns void
language plpgsql as $$
declare
  d text;
begin
  if e is null then
    raise exception 'TEST FAILED: %: no browser pack for this route × carrier', tag;
  end if;

  -- shape and scalars
  d := concat_ws('; ',
    'pack ' || nullif(nc_test.set_diff(nc_test.texts(e -> 'keys'), nc_test.keys(p)), ''),
    'route ' || nullif(nc_test.set_diff(nc_test.texts(e -> 'route_keys'), nc_test.keys(p -> 'route')), ''));
  perform nc_test.ok(d = '', tag || ': top-level and route keys = browser pack' || nc_test.why(d));
  d := concat_ws(', ',
    case when p ->> 'schema' is distinct from e ->> 'schema' then 'schema' end,
    case when p ->> 'carrier' is distinct from e ->> 'carrier' then 'carrier' end,
    case when p -> 'route' ->> 'id' is distinct from e -> 'route' ->> 'id' then 'route.id' end,
    case when p -> 'route' ->> 'name' is distinct from e -> 'route' ->> 'name' then 'route.name' end,
    case when p -> 'route' ->> 'region' is distinct from e -> 'route' ->> 'region' then 'route.region' end,
    case when p -> 'route' ->> 'region_en' is distinct from e -> 'route' ->> 'region_en' then 'route.region_en' end,
    case when p -> 'route' ->> 'travel_mode' is distinct from e -> 'route' ->> 'travel_mode' then 'route.travel_mode' end,
    case when p -> 'route' ->> 'color' is distinct from e -> 'route' ->> 'color' then 'route.color' end,
    case when round((p -> 'route' ->> 'length_km')::numeric, 3) is distinct from round((e -> 'route' ->> 'length_km')::numeric, 3)
         then 'route.length_km ' || coalesce(p -> 'route' ->> 'length_km', 'null') || ' vs ' || coalesce(e -> 'route' ->> 'length_km', 'null') end,
    case when jsonb_typeof(p -> 'route' -> 'bbox') is distinct from 'array'
           or jsonb_array_length(p -> 'route' -> 'bbox') <> 4
           or exists (select 1 from generate_series(0, 3) i
                      where round((p -> 'route' -> 'bbox' ->> i)::numeric, 6) is distinct from round((e -> 'route' -> 'bbox' ->> i)::numeric, 6))
         then 'route.bbox ' || coalesce(p -> 'route' ->> 'bbox', 'null') || ' vs ' || coalesce(e -> 'route' ->> 'bbox', 'null') end,
    case when p ->> 'model_version' is distinct from e ->> 'model_version' then 'model_version' end,
    case when (p ->> 'accuracy')::numeric is distinct from (e ->> 'accuracy')::numeric
         then 'accuracy ' || coalesce(p ->> 'accuracy', 'null') || ' vs ' || coalesce(e ->> 'accuracy', 'null') end,
    case when (p ->> 'holdout_n')::int is distinct from (e ->> 'holdout_n')::int then 'holdout_n' end);
  perform nc_test.ok(d = '', tag || ': route, carrier, model_version, accuracy, holdout_n = browser pack' || nc_test.why(d));

  -- nodes
  d := nc_test.set_diff(nc_test.ids(e -> 'nodes'), nc_test.ids(p -> 'nodes'));
  perform nc_test.ok(d = '', tag || ': node ids = browser pack (' || jsonb_array_length(e -> 'nodes') || ')' || nc_test.why(d));
  select string_agg(q.id, ',') into d from (
    select x.id
    from jsonb_to_recordset(e -> 'nodes') as x(id text, name text, name_en text, kind text, lat numeric, lng numeric)
    join lateral (select v from jsonb_array_elements(p -> 'nodes') v where v ->> 'id' = x.id limit 1) a on true
    where a.v ->> 'name' is distinct from x.name or a.v ->> 'name_en' is distinct from x.name_en
       or a.v ->> 'kind' is distinct from x.kind
       or round((a.v ->> 'lat')::numeric, 6) is distinct from round(x.lat, 6)
       or round((a.v ->> 'lng')::numeric, 6) is distinct from round(x.lng, 6)
    order by x.id limit 10) q;
  perform nc_test.ok(d is null, tag || ': node name/kind/lat/lng = browser pack' || nc_test.why(d));

  -- edges
  d := nc_test.set_diff(nc_test.ids(e -> 'edges'), nc_test.ids(p -> 'edges'));
  perform nc_test.ok(d = '', tag || ': edge ids = browser pack (' || jsonb_array_length(e -> 'edges') || ')' || nc_test.why(d));
  select string_agg(q.id, ',') into d from (
    select x.id
    from jsonb_to_recordset(e -> 'edges')
           as x(id text, "from" text, "to" text, length_km numeric, is_connector boolean, npoints int, first jsonb, last jsonb)
    join lateral (select v from jsonb_array_elements(p -> 'edges') v where v ->> 'id' = x.id limit 1) a on true
    where a.v ->> 'from' is distinct from x."from" or a.v ->> 'to' is distinct from x."to"
       or round((a.v ->> 'length_km')::numeric, 3) is distinct from round(x.length_km, 3)
       or (a.v ->> 'is_connector')::boolean is distinct from x.is_connector
       or jsonb_array_length(a.v -> 'geometry') is distinct from x.npoints
       or round((a.v -> 'geometry' -> 0 ->> 0)::numeric, 6) is distinct from round((x.first ->> 0)::numeric, 6)
       or round((a.v -> 'geometry' -> 0 ->> 1)::numeric, 6) is distinct from round((x.first ->> 1)::numeric, 6)
       or round((a.v -> 'geometry' -> -1 ->> 0)::numeric, 6) is distinct from round((x.last ->> 0)::numeric, 6)
       or round((a.v -> 'geometry' -> -1 ->> 1)::numeric, 6) is distinct from round((x.last ->> 1)::numeric, 6)
    order by x.id limit 10) q;
  perform nc_test.ok(d is null, tag || ': edge from/to/length/is_connector/geometry = browser pack' || nc_test.why(d));

  -- signal segments of this carrier
  d := nc_test.set_diff(
         array(select (x ->> 'edge_id') || '#' || (x ->> 'seq') from jsonb_array_elements(e -> 'segments') x),
         array(select (x ->> 'edge_id') || '#' || (x ->> 'seq') from jsonb_array_elements(p -> 'segments') x));
  perform nc_test.ok(d = '', tag || ': segment (edge_id, seq) = browser pack (' || jsonb_array_length(e -> 'segments') || ')'
                             || nc_test.why(d));
  select string_agg(q.k, ',') into d from (
    select x.edge_id || '#' || x.seq as k
    from jsonb_to_recordset(e -> 'segments')
           as x(edge_id text, seq int, from_km numeric, to_km numeric, level text, confidence numeric)
    join lateral (select v from jsonb_array_elements(p -> 'segments') v
                  where v ->> 'edge_id' = x.edge_id and (v ->> 'seq')::int = x.seq limit 1) a on true
    where a.v ->> 'level' is distinct from x.level
       or round((a.v ->> 'from_km')::numeric, 3) is distinct from round(x.from_km, 3)
       or round((a.v ->> 'to_km')::numeric, 3) is distinct from round(x.to_km, 3)
       or round((a.v ->> 'confidence')::numeric, 3) is distinct from round(x.confidence, 3)
    order by x.edge_id, x.seq limit 10) q;
  perform nc_test.ok(d is null, tag || ': segment level/from_km/to_km/confidence = browser pack' || nc_test.why(d));

  -- verified facilities
  d := concat_ws('; ',
    'vs browser pack: ' || nullif(nc_test.set_diff(nc_test.ids(e -> 'facilities'), nc_test.ids(p -> 'facilities')), ''),
    'vs verified rows of seed-core.js: '
      || nullif(nc_test.set_diff(nc_test.texts(e -> 'verified_facility_ids'), nc_test.ids(p -> 'facilities')), ''));
  perform nc_test.ok(d = '', tag || ': verified-facility set = browser pack = seed-core.js ('
                             || jsonb_array_length(e -> 'facilities') || ')' || nc_test.why(d));
  select string_agg(q.id, ',') into d from (
    select x.id
    from jsonb_to_recordset(e -> 'facilities')
           as x(id text, type text, lat numeric, lng numeric, phone text, verified_at text, night_shift boolean,
                trauma_capable boolean, is_stale boolean, days_since_verified int, is_demo boolean)
    join lateral (select v from jsonb_array_elements(p -> 'facilities') v where v ->> 'id' = x.id limit 1) a on true
    where a.v ->> 'type' is distinct from x.type or a.v ->> 'phone' is distinct from x.phone
       or a.v ->> 'verified_at' is distinct from x.verified_at
       or (a.v ->> 'night_shift')::boolean is distinct from x.night_shift
       or (a.v ->> 'trauma_capable')::boolean is distinct from x.trauma_capable
       or (a.v ->> 'is_stale')::boolean is distinct from x.is_stale
       or (a.v ->> 'days_since_verified')::int is distinct from x.days_since_verified
       or (a.v ->> 'is_demo')::boolean is distinct from x.is_demo
       or round((a.v ->> 'lat')::numeric, 6) is distinct from round(x.lat, 6)
       or round((a.v ->> 'lng')::numeric, 6) is distinct from round(x.lng, 6)
    order by x.id limit 10) q;
  perform nc_test.ok(d is null, tag || ': facility fields incl. is_stale/days_since_verified = browser pack' || nc_test.why(d));

  -- active services
  d := nc_test.set_diff(nc_test.ids(e -> 'services'), nc_test.ids(p -> 'services'));
  select concat_ws('; ', nullif(d, ''), 'fields ' || string_agg(q.id, ',')) into d from (
    select x.id
    from jsonb_to_recordset(e -> 'services') as x(id text, type text, is_partner boolean, is_demo boolean)
    join lateral (select v from jsonb_array_elements(p -> 'services') v where v ->> 'id' = x.id limit 1) a on true
    where a.v ->> 'type' is distinct from x.type or (a.v ->> 'is_partner')::boolean is distinct from x.is_partner
       or (a.v ->> 'is_demo')::boolean is distinct from x.is_demo
    order by x.id limit 10) q;
  perform nc_test.ok(d = '', tag || ': services (ids, type, is_partner) = browser pack ('
                             || jsonb_array_length(e -> 'services') || ')' || nc_test.why(d));
end $$;

grant usage on schema nc_test to anon, authenticated, service_role;
grant all on nc_test.vars to anon, authenticated, service_role;
grant execute on all functions in schema nc_test to anon, authenticated, service_role;

-- Browser-side expectations (tools/db-test/expected_packs.js output), passed by
-- run.sh as -v expected_file=… when the seed is supabase/seed.sql.
\if :{?expected_file}
\set nc_expected_json `cat :'expected_file'`
insert into nc_test.vars values ('expected', :'nc_expected_json');
\unset nc_expected_json
\endif

\echo '== sanity: data present'
do $$ begin
  perform nc_test.ok((select count(*) from routes where is_active) > 0, 'there is at least one active route');
  perform nc_test.ok((select count(*) from carriers) >= 1, 'carriers present');
  perform nc_test.ok((select count(*) from facilities where status = 'verified') > 0, 'verified facilities present');
end $$;

-- ================================================================ 1. list_routes
\echo '== list_routes'
do $$
declare
  v jsonb := public.list_routes();
  r jsonb;
begin
  perform nc_test.ok(jsonb_typeof(v) = 'array'
                     and jsonb_array_length(v) = (select count(*) from routes where is_active),
                     'list_routes returns every active route');
  for r in select value from jsonb_array_elements(v) loop
    perform nc_test.ok(r ?& array['id','name','name_en','region','region_en','travel_mode','length_km','color','bbox',
                                  'verified_facilities','accuracy','packs'],
                       'list_routes item has contract keys: ' || (r ->> 'id'));
    perform nc_test.ok(r ->> 'region_en' is not distinct from (select x.region_en from routes x where x.id = r ->> 'id'),
                       'list_routes region_en = routes.region_en: ' || (r ->> 'id'));
    perform nc_test.ok(jsonb_typeof(r -> 'bbox') = 'array' and jsonb_array_length(r -> 'bbox') = 4
                       and (r -> 'bbox' ->> 0)::numeric <= (r -> 'bbox' ->> 2)::numeric
                       and (r -> 'bbox' ->> 1)::numeric <= (r -> 'bbox' ->> 3)::numeric
                       and abs((r -> 'bbox' ->> 0)::numeric) <= 90,
                       'bbox is [south, west, north, east]: ' || (r ->> 'id'));
    perform nc_test.ok(nc_test.keys(r -> 'accuracy') = nc_test.sorted(array(select id from carriers))
                       and nc_test.keys(r -> 'packs') = nc_test.sorted(array(select id from carriers)),
                       'accuracy/packs keyed by every carrier: ' || (r ->> 'id'));
    perform nc_test.ok((r ->> 'verified_facilities')::int >= 0, 'verified_facilities is a count: ' || (r ->> 'id'));
  end loop;
end $$;

-- ============================================================ 2. Pack shape
\echo '== get_data_pack / build_data_pack for every route x carrier'
do $$
declare
  x         record;
  p         jsonb;
  b         jsonb;
  k_pack    text[] := nc_test.sorted(array['schema','route','carrier','version','published_at','model_version',
                                           'accuracy','holdout_n','nodes','edges','segments','facilities',
                                           'services','size_bytes']);
  k_route   text[] := nc_test.sorted(array['id','name','name_en','region','region_en','travel_mode','length_km','color',
                                           'bbox','description_vi','description_en']);
  k_node    text[] := nc_test.sorted(array['id','name','name_en','kind','lat','lng']);
  k_edge    text[] := nc_test.sorted(array['id','from','to','length_km','is_connector','geometry']);
  k_seg     text[] := nc_test.sorted(array['edge_id','seq','from_km','to_km','level','confidence']);
  k_fac     text[] := nc_test.sorted(array['id','name','type','address','lat','lng','phone','open_hours',
                                           'night_shift','trauma_capable','verified_by','verified_at',
                                           'is_stale','days_since_verified','is_demo']);
  k_svc     text[] := nc_test.sorted(array['id','name','type','lat','lng','phone','open_hours','is_partner','is_demo']);
  tag       text;
  n_bad     int;
  cor       geography;
begin
  for x in select r.id as rid, c.id as cid from routes r cross join carriers c where r.is_active order by 1, 2 loop
    tag := x.rid || '/' || x.cid;
    p := public.get_data_pack(x.rid, x.cid);
    b := public.build_data_pack(x.rid, x.cid);
    perform nc_test.ok(nc_test.keys(p) = k_pack and nc_test.keys(b) = k_pack, 'pack top-level keys exact: ' || tag);
    perform nc_test.ok(nc_test.keys(p -> 'route') = k_route, 'pack.route keys exact: ' || tag);
    perform nc_test.ok((p ->> 'schema')::int = 1 and p ->> 'carrier' = x.cid and p -> 'route' ->> 'id' = x.rid,
                       'schema/carrier/route id: ' || tag);
    perform nc_test.ok(octet_length(p::text) = (p ->> 'size_bytes')::int
                       and octet_length(b::text) = (b ->> 'size_bytes')::int,
                       'size_bytes = octet_length(json text): ' || tag);
    perform nc_test.ok(jsonb_typeof(p -> 'route' -> 'bbox') = 'array' and jsonb_array_length(p -> 'route' -> 'bbox') = 4,
                       'route.bbox array[4]: ' || tag);

    -- nodes
    select count(*) into n_bad from jsonb_array_elements(p -> 'nodes') n
     where nc_test.keys(n) <> k_node or jsonb_typeof(n -> 'lat') <> 'number'
        or (n ->> 'lat')::numeric < (p -> 'route' -> 'bbox' ->> 0)::numeric - 0.01
        or (n ->> 'lat')::numeric > (p -> 'route' -> 'bbox' ->> 2)::numeric + 0.01;
    perform nc_test.ok(n_bad = 0 and jsonb_array_length(p -> 'nodes') = (select count(*) from route_nodes where route_id = x.rid),
                       'nodes: keys, [lat,lng] inside bbox, count: ' || tag);
    select count(*) into n_bad from (
      select ST_LineLocatePoint(r.geom::geometry, ST_SetSRID(ST_MakePoint((n ->> 'lng')::float8, (n ->> 'lat')::float8), 4326)) as f,
             lag(ST_LineLocatePoint(r.geom::geometry, ST_SetSRID(ST_MakePoint((n ->> 'lng')::float8, (n ->> 'lat')::float8), 4326)))
               over (order by o) as pf
      from jsonb_array_elements(p -> 'nodes') with ordinality as t(n, o), routes r
      where r.id = x.rid and r.geom is not null) q
     where q.pf is not null and q.f < q.pf - 1e-6;
    perform nc_test.ok(n_bad = 0, 'nodes in travel order along the route line: ' || tag);

    -- edges: keys, count, geometry oriented from -> to, [lat,lng] pairs
    select count(*) into n_bad
    from jsonb_array_elements(p -> 'edges') e
    join route_nodes fn on fn.id = e ->> 'from'
    join route_nodes tn on tn.id = e ->> 'to'
    where nc_test.keys(e) <> k_edge
       or jsonb_array_length(e -> 'geometry') < 2
       or ST_Distance(app_private.pt((e -> 'geometry' -> 0 ->> 0)::float8, (e -> 'geometry' -> 0 ->> 1)::float8), fn.geom)
        > ST_Distance(app_private.pt((e -> 'geometry' -> -1 ->> 0)::float8, (e -> 'geometry' -> -1 ->> 1)::float8), fn.geom)
       or ST_Distance(app_private.pt((e -> 'geometry' -> 0 ->> 0)::float8, (e -> 'geometry' -> 0 ->> 1)::float8), fn.geom) > 2000;
    perform nc_test.ok(n_bad = 0 and jsonb_array_length(p -> 'edges') = (select count(*) from route_edges where route_id = x.rid),
                       'edges: keys, count, geometry starts at from-node: ' || tag);

    -- segments: keys, grouped/ordered per edge, cover every edge fully
    select count(*) into n_bad from jsonb_array_elements(p -> 'segments') s
     where nc_test.keys(s) <> k_seg or s ->> 'level' not in ('likely', 'uncertain', 'lost');
    perform nc_test.ok(n_bad = 0, 'segments: keys + level enum: ' || tag);
    select count(*) into n_bad from (
      select s ->> 'edge_id' as eid, (s ->> 'seq')::int as seq,
             lag(s ->> 'edge_id') over (order by o) as peid, lag((s ->> 'seq')::int) over (order by o) as pseq
      from jsonb_array_elements(p -> 'segments') with ordinality as t(s, o)) q
     where q.peid is not null and (q.eid < q.peid or (q.eid = q.peid and q.seq < q.pseq));
    perform nc_test.ok(n_bad = 0, 'segments grouped per edge and ordered by seq: ' || tag);
    select count(*) into n_bad
    from jsonb_array_elements(p -> 'edges') e
    left join lateral (
      select min((s ->> 'from_km')::numeric) as lo, max((s ->> 'to_km')::numeric) as hi, count(*) as n
      from jsonb_array_elements(p -> 'segments') s where s ->> 'edge_id' = e ->> 'id') c on true
    where c.n = 0 or c.lo > 0.01 or c.hi < (e ->> 'length_km')::numeric * 0.99 - 0.02;
    perform nc_test.ok(n_bad = 0, 'segments cover every edge [0, length_km]: ' || tag);

    -- facilities: verified only, stale flag, route membership
    select count(*) into n_bad
    from jsonb_array_elements(p -> 'facilities') f
    left join facilities d on d.id = f ->> 'id'
    where nc_test.keys(f) <> k_fac or d.status is distinct from 'verified'
       or (f ->> 'is_stale')::boolean <> (d.verified_at < (now() at time zone 'Asia/Ho_Chi_Minh')::date - 90)
       or (f ->> 'days_since_verified')::int <> (now() at time zone 'Asia/Ho_Chi_Minh')::date - d.verified_at;
    perform nc_test.ok(n_bad = 0, 'facilities: keys, verified only, is_stale/days_since_verified (Vietnam date): ' || tag);
    cor := app_private.route_corridor(x.rid);
    perform nc_test.ok(jsonb_array_length(p -> 'facilities') =
                       (select count(*) from facilities f where f.status = 'verified' and f.geom is not null
                          and (f.route_id = x.rid or (f.route_id is null and ST_DWithin(f.geom, cor, 15000)))),
                       'facilities: every verified facility of the route is included: ' || tag);

    -- services: active only
    select count(*) into n_bad
    from jsonb_array_elements(p -> 'services') s left join services d on d.id = s ->> 'id'
    where nc_test.keys(s) <> k_svc or d.status is distinct from 'active';
    perform nc_test.ok(n_bad = 0, 'services: keys, active only: ' || tag);
  end loop;
end $$;

-- ================================= 2b. Parity with the browser (seed-core.js)
-- The app uses the same pack three ways: bundled default (built in the browser
-- from seed-core.js), local mock server, and Supabase. All must agree, for the
-- published snapshot (get_data_pack) and a fresh build (build_data_pack).
\if :{?expected_file}
\echo '== parity: get_data_pack / build_data_pack = browser pack from seed-core.js'
do $$
declare
  ex jsonb := nc_test.getv('expected')::jsonb;
  k  text;
  d  text;
begin
  d := nc_test.set_diff(nc_test.texts(ex -> 'pairs'),
                        array(select r.id || ':' || c.id from routes r cross join carriers c where r.is_active));
  perform nc_test.ok(d = '', 'server route × carrier pairs = seed-core.js (' || jsonb_array_length(ex -> 'pairs') || ')'
                             || nc_test.why(d));
  -- route catalogue (list_routes) = the packs the browser builds
  for k in select jsonb_array_elements_text(ex -> 'pairs') loop
    select concat_ws(', ',
      case when item is null then 'route missing from list_routes' end,
      case when item ->> 'name' is distinct from ex -> 'packs' -> k -> 'route' ->> 'name' then 'name' end,
      case when item ->> 'region' is distinct from ex -> 'packs' -> k -> 'route' ->> 'region' then 'region' end,
      case when item ->> 'region_en' is distinct from ex -> 'packs' -> k -> 'route' ->> 'region_en' then 'region_en' end,
      case when item ->> 'travel_mode' is distinct from ex -> 'packs' -> k -> 'route' ->> 'travel_mode' then 'travel_mode' end,
      case when round((item ->> 'length_km')::numeric, 3) is distinct from round((ex -> 'packs' -> k -> 'route' ->> 'length_km')::numeric, 3)
           then 'length_km' end,
      case when (item ->> 'verified_facilities')::int is distinct from (ex -> 'packs' -> k -> 'counts' ->> 'facilities')::int
           then 'verified_facilities ' || (item ->> 'verified_facilities') || ' vs ' || (ex -> 'packs' -> k -> 'counts' ->> 'facilities') end,
      case when (item -> 'accuracy' ->> split_part(k, ':', 2))::numeric is distinct from (ex -> 'packs' -> k ->> 'accuracy')::numeric
           then 'accuracy.' || split_part(k, ':', 2) end,
      case when (item -> 'packs' -> split_part(k, ':', 2) ->> 'version')::int is distinct from
                (select (x ->> 'version')::int from jsonb_array_elements(ex -> 'kpis' -> 'packs') x
                  where x ->> 'route_id' || ':' || (x ->> 'carrier') = k)
           then 'packs.' || split_part(k, ':', 2) || '.version' end)
      into d
    from (select value as item from jsonb_array_elements(public.list_routes()) where value ->> 'id' = split_part(k, ':', 1)) r
    right join (select 1) one on true;
    perform nc_test.ok(d = '', 'list_routes ' || k || ': name, region (vi/en), mode, length, verified_facilities, accuracy, pack version = browser'
                               || nc_test.why(d));
  end loop;
  for k in select jsonb_array_elements_text(ex -> 'pairs') loop
    perform nc_test.pack_parity(public.get_data_pack(split_part(k, ':', 1), split_part(k, ':', 2)),
                                ex -> 'packs' -> k, 'get_data_pack ' || k);
    perform nc_test.pack_parity(public.build_data_pack(split_part(k, ':', 1), split_part(k, ':', 2)),
                                ex -> 'packs' -> k, 'build_data_pack ' || k);
  end loop;
end $$;

-- ====================================== 2c. admin_kpis() of the fresh seed
\echo '== parity: admin_kpis() = counts of seed-core.js / seed-admin.js'
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000a001', 'admin@test.local')
on conflict (id) do nothing;
insert into admin_users (user_id, display_name, role)
values ('00000000-0000-4000-8000-00000000a001', 'Test Admin', 'admin')
on conflict (user_id) do nothing;
set role authenticated;
do $$ begin perform nc_test.claims('authenticated', '00000000-0000-4000-8000-00000000a001'); end $$;
do $$
declare
  ex jsonb := nc_test.getv('expected')::jsonb -> 'kpis';
  k  jsonb := public.admin_kpis();
  r  jsonb;
  kr jsonb;
  d  text;
begin
  perform nc_test.ok(k -> 'facilities' = ex -> 'facilities',
                     'admin_kpis.facilities = seed ' || (ex ->> 'facilities')
                     || nc_test.why(case when k -> 'facilities' <> ex -> 'facilities' then 'got ' || (k ->> 'facilities') end));
  perform nc_test.ok((k ->> 'submissions_pending')::int = (ex ->> 'submissions_pending')::int,
                     'admin_kpis.submissions_pending = seed (' || (ex ->> 'submissions_pending') || ')'
                     || nc_test.why(case when k -> 'submissions_pending' <> ex -> 'submissions_pending'
                                         then 'got ' || (k ->> 'submissions_pending') end));
  if jsonb_typeof(ex -> 'samples') = 'object' then
    perform nc_test.ok((k -> 'samples' -> 'total') = (ex -> 'samples' -> 'total')
                       and (k -> 'samples' -> 'pending') = (ex -> 'samples' -> 'pending')
                       and (k -> 'samples' -> 'by_carrier') = (ex -> 'samples' -> 'by_carrier'),
                       'admin_kpis.samples = seed-admin.js ' || (ex ->> 'samples')
                       || nc_test.why(case when k -> 'samples' <> ex -> 'samples' then 'got ' || (k ->> 'samples') end));
    perform nc_test.ok(k -> 'buddy' = ex -> 'buddy',
                       'admin_kpis.buddy = seed-admin.js scenario ' || (ex ->> 'buddy')
                       || nc_test.why(case when k -> 'buddy' <> ex -> 'buddy' then 'got ' || (k ->> 'buddy') end));
    perform nc_test.ok((k -> 'devices') = (ex -> 'devices'),
                       'admin_kpis.devices = seed-admin.js (' || (ex ->> 'devices') || ')'
                       || nc_test.why(case when k -> 'devices' is distinct from ex -> 'devices' then 'got ' || (k ->> 'devices') end));
  end if;
  d := nc_test.set_diff(nc_test.ids(ex -> 'routes'), nc_test.ids(k -> 'routes'));
  perform nc_test.ok(d = '', 'admin_kpis.routes = seed routes' || nc_test.why(d));
  for r in select value from jsonb_array_elements(ex -> 'routes') loop
    select value into kr from jsonb_array_elements(k -> 'routes') where value ->> 'id' = r ->> 'id';
    d := concat_ws(', ',
      case when kr -> 'verified' is distinct from r -> 'verified' then 'verified ' || (kr ->> 'verified') || ' vs ' || (r ->> 'verified') end,
      case when kr -> 'pending' is distinct from r -> 'pending' then 'pending ' || (kr ->> 'pending') || ' vs ' || (r ->> 'pending') end,
      case when kr -> 'stale' is distinct from r -> 'stale' then 'stale ' || (kr ->> 'stale') || ' vs ' || (r ->> 'stale') end,
      case when jsonb_typeof(r -> 'samples') = 'number' and kr -> 'samples' is distinct from r -> 'samples'
           then 'samples ' || (kr ->> 'samples') || ' vs ' || (r ->> 'samples') end,
      case when kr -> 'accuracy' is distinct from r -> 'accuracy'
           then 'accuracy ' || (kr ->> 'accuracy') || ' vs ' || (r ->> 'accuracy') end);
    perform nc_test.ok(d = '', 'admin_kpis.routes[' || (r ->> 'id') || '] verified/pending/stale/samples/accuracy = seed'
                               || nc_test.why(d));
  end loop;
  d := nc_test.set_diff(
         array(select (x ->> 'route_id') || ':' || (x ->> 'carrier') || ':v' || (x ->> 'version') from jsonb_array_elements(ex -> 'packs') x),
         array(select (x ->> 'route_id') || ':' || (x ->> 'carrier') || ':v' || (x ->> 'version') from jsonb_array_elements(k -> 'packs') x));
  perform nc_test.ok(d = '', 'admin_kpis.packs = seed-core.js packs (current versions)' || nc_test.why(d));
end $$;
reset role;
do $$ begin perform nc_test.noclaims(); end $$;
\else
\echo '== parity with seed-core.js: SKIPPED (needs supabase/seed.sql + node; run through tools/db-test/run.sh)'
\endif

-- ===================================================== 3. nearest_facilities
\echo '== nearest_facilities'
do $$
declare
  n    record;
  v    jsonb;
  best text;
  bad  int;
begin
  for n in select distinct on (route_id) route_id, ST_Y(geom::geometry) as lat, ST_X(geom::geometry) as lng
           from route_nodes order by route_id, id loop
    v := public.nearest_facilities(n.lat, n.lng, 7, null);
    perform nc_test.ok(jsonb_array_length(v) between 1 and 7, 'nearest: 1..limit results near ' || n.route_id);
    select count(*) into bad from (
      select (x ->> 'distance_km')::numeric as d, lag((x ->> 'distance_km')::numeric) over (order by o) as pd,
             f.status
      from jsonb_array_elements(v) with ordinality t(x, o) left join facilities f on f.id = x ->> 'id') q
     where q.status is distinct from 'verified' or (q.pd is not null and q.d < q.pd);
    perform nc_test.ok(bad = 0, 'nearest: verified only, ordered by distance near ' || n.route_id);
    select f.id into best from facilities f where f.status = 'verified' and f.geom is not null
     order by ST_Distance(f.geom, app_private.pt(n.lat, n.lng)), f.trauma_capable desc limit 1;
    perform nc_test.ok(v -> 0 ->> 'id' = best, 'nearest: first result = brute-force nearest near ' || n.route_id);
    perform nc_test.ok(v -> 0 ? 'distance_km' and v -> 0 ? 'is_stale', 'nearest: item has distance_km + pack fields');
  end loop;
  v := public.nearest_facilities(n.lat, n.lng, 50, array['benh_vien']);
  perform nc_test.ok(not exists (select 1 from jsonb_array_elements(v) x where x ->> 'type' <> 'benh_vien'),
                     'nearest: p_types filter');
  begin
    perform public.nearest_facilities(123, 0, 5, null);
    perform nc_test.ok(false, 'nearest: invalid coordinates rejected');
  exception when sqlstate '22023' then
    perform nc_test.ok(true, 'nearest: invalid coordinates rejected');
  end;
end $$;

-- ===================================================== 4. content release
\echo '== get_content_release'
do $$
declare v jsonb := public.get_content_release();
begin
  perform nc_test.ok(v is null or v ?& array['version', 'status', 'approved_at', 'approver', 'notes'],
                     'get_content_release shape');
end $$;

-- ============================================== 5. device registration & sync
\echo '== register_device + sync_device_ops'
do $$
declare
  reg  jsonb := public.register_device('viettel', 'test-1.0');
  dev  uuid := (reg ->> 'device_id')::uuid;
  sec  text := reg ->> 'secret';
  sid  uuid := gen_random_uuid();
  op1  uuid := gen_random_uuid();
  op2  uuid := gen_random_uuid();
  op3  uuid := gen_random_uuid();
  op4  uuid := gen_random_uuid();
  op5  uuid := gen_random_uuid();
  op6  uuid := gen_random_uuid();
  op7  uuid := gen_random_uuid();
  res  jsonb;
  s    buddy_sessions%rowtype;
  rt   text := (select id from routes where is_active order by sort, id limit 1);
  lat  float8;
  lng  float8;
begin
  select ST_Y(geom::geometry), ST_X(geom::geometry) into lat, lng
  from route_nodes where route_id = rt order by id limit 1;
  perform nc_test.ok(dev is not null and sec ~ '^[0-9a-f]{64}$', 'register_device returns id + 32-byte hex secret');
  perform nc_test.ok((select secret_hash from devices where id = dev) = encode(digest(sec, 'sha256'), 'hex'),
                     'only sha256(secret) is stored');
  begin
    perform public.sync_device_ops(dev, 'wrong', '[]'::jsonb);   -- raises unauthorized_device / 28000
    perform nc_test.ok(false, 'sync with a wrong secret is rejected');
  exception when sqlstate '28000' then
    perform nc_test.ok(true, 'sync with a wrong secret is rejected');
  end;

  res := public.sync_device_ops(dev, sec, jsonb_build_array(
    jsonb_build_object('id', op1, 'op', 'buddy.start', 'data', jsonb_build_object(
      'id', sid, 'traveler_name', 'Test Traveller',
      'recipient', jsonb_build_object('name', 'Recipient', 'email', 'Recipient@Example.com', 'phone', '+84 000 000 009'),
      'interval_min', 60, 'grace_min', 10, 'route_id', rt, 'travel_mode', 'motorbike',
      'share_public_medical', true,
      'public_medical', jsonb_build_object('blood_type', 'O+', 'allergies', 'Penicillin', 'full_name', 'LEAK'),
      'lat', lat, 'lng', lng)),
    jsonb_build_object('id', op2, 'op', 'buddy.checkin', 'data', jsonb_build_object(
      'session_id', sid, 'kind', 'checkin', 'lat', lat + 0.001, 'lng', lng + 0.001, 'accuracy_m', 12)),
    jsonb_build_object('id', op3, 'op', 'report.submit', 'data', jsonb_build_object(
      'id', op3::text, 'kind', 'new', 'facility_id', null, 'lat', lat, 'lng', lng,
      'payload', jsonb_build_object('name', 'Trạm y tế test', 'type', 'tram_y_te', 'note', 'test', 'route_id', rt))),
    jsonb_build_object('id', op4, 'op', 'signal.log', 'data', jsonb_build_object('samples', jsonb_build_array(
      jsonb_build_object('lat', lat, 'lng', lng, 'rsrp_dbm', -112, 'tech', '4G'),
      jsonb_build_object('lat', 0, 'lng', 0, 'rsrp_dbm', -90, 'tech', '4G')))),
    jsonb_build_object('id', op5, 'op', 'no.such.op', 'data', '{}'::jsonb),
    jsonb_build_object('id', 'not-a-uuid', 'op', 'buddy.checkin', 'data', '{}'::jsonb)));

  perform nc_test.ok(res ?& array['results', 'server_time', 'session'], 'sync response shape');
  perform nc_test.ok(jsonb_array_length(res -> 'results') = 6, 'one result per op');
  perform nc_test.ok(res -> 'results' -> 0 ->> 'status' = 'ok' and res -> 'results' -> 1 ->> 'status' = 'ok'
                     and res -> 'results' -> 2 ->> 'status' = 'ok' and res -> 'results' -> 3 ->> 'status' = 'ok',
                     'start/checkin/report/signal ops ok');
  perform nc_test.ok(res -> 'results' -> 4 ->> 'status' = 'error' and (res -> 'results' -> 4 ->> 'retryable')::boolean = false,
                     'unknown op -> error, not retryable');
  perform nc_test.ok(res -> 'results' -> 5 ->> 'status' = 'error', 'invalid op id -> error');
  perform nc_test.ok(not exists (select 1 from device_ops where id = op5), 'failed op is not recorded');
  perform nc_test.ok(res -> 'session' ->> 'id' = sid::text and res -> 'session' ->> 'status' = 'active'
                     and (res -> 'session' ->> 'synced')::boolean, 'sync returns the current session');

  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(s.device_id = dev and s.status = 'active' and s.recipient_email = 'recipient@example.com',
                     'session stored for the device (email normalised)');
  perform nc_test.ok(s.public_medical ? 'blood_type' and not (s.public_medical ? 'full_name'),
                     'only the public medical layer is stored');
  perform nc_test.ok(s.next_due_at = s.last_checkin_at + interval '60 minutes', 'next_due_at = last_checkin_at + interval');
  perform nc_test.ok(abs(s.last_lat - (lat + 0.001)) < 1e-9, 'checkin updates last location');
  perform nc_test.ok((select count(*) from checkin_events where session_id = sid and kind in ('start', 'checkin')) = 2,
                     'start + checkin events stored');
  perform nc_test.ok((select count(*) from facility_submissions where device_id = dev and status = 'pending'
                        and payload ->> 'name' = 'Trạm y tế test' and not (payload ? 'payload')) = 1,
                     'report.submit -> pending submission with the report payload');
  perform nc_test.ok((res -> 'results' -> 3 -> 'data' ->> 'inserted')::int = 1 and (res -> 'results' -> 3 -> 'data' ->> 'skipped')::int = 1
                     and exists (select 1 from signal_samples where source = 'community' and status = 'pending'
                                   and route_id = rt and level = 'uncertain' and rsrp_dbm = -112),
                     'signal.log -> pending community sample snapped to route, level derived from RSRP');

  -- duplicate (idempotency)
  res := public.sync_device_ops(dev, sec, jsonb_build_array(
    jsonb_build_object('id', op2, 'op', 'buddy.checkin', 'data', jsonb_build_object('session_id', sid, 'kind', 'checkin'))));
  perform nc_test.ok(res -> 'results' -> 0 ->> 'status' = 'duplicate' and res -> 'results' -> 0 -> 'data' ? 'event_id',
                     'replayed op id -> duplicate with stored data');
  perform nc_test.ok((select count(*) from checkin_events where session_id = sid and kind = 'checkin') = 1,
                     'duplicate does not create a second event');

  -- location, pre_deadzone, stop
  res := public.sync_device_ops(dev, sec, jsonb_build_array(
    jsonb_build_object('id', op6, 'op', 'buddy.checkin', 'data', jsonb_build_object(
      'session_id', sid, 'kind', 'pre_deadzone', 'lat', lat + 0.002, 'lng', lng, 'meta', jsonb_build_object('start_km', 3.2))),
    jsonb_build_object('id', op7, 'op', 'buddy.stop', 'data', jsonb_build_object('session_id', sid))));
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(s.status = 'closed' and s.closed_at is not null and abs(s.last_lat - (lat + 0.002)) < 1e-9,
                     'pre_deadzone updates location, stop closes the session');
  perform nc_test.ok(exists (select 1 from checkin_events where session_id = sid and kind = 'stop'), 'stop event stored');

  -- another device cannot touch this session
  reg := public.register_device('mobifone', 'test-1.0');
  res := public.sync_device_ops((reg ->> 'device_id')::uuid, reg ->> 'secret', jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.checkin', 'data', jsonb_build_object('session_id', sid))));
  perform nc_test.ok(res -> 'results' -> 0 ->> 'status' = 'error', 'a device cannot write to another device''s session');
  perform nc_test.ok(res -> 'session' = 'null'::jsonb, 'device without sessions gets session = null');
end $$;

-- =================================================== 6. overdue & alerting
\echo '== dead-man: overdue marking, alert claim/result, resolve, backoff, SOS'
insert into app_private.settings (key, value) values
  ('functions_url', 'https://example-ref.supabase.co/functions/v1/'), ('cron_secret', 'test-cron-secret')
on conflict (key) do update set value = excluded.value;

do $$
declare
  reg  jsonb := public.register_device('viettel', 'test-1.0');
  dev  uuid := (reg ->> 'device_id')::uuid;
  sec  text := reg ->> 'secret';
  sid  uuid := gen_random_uuid();
  res  jsonb;
  n    int;
  s    buddy_sessions%rowtype;
begin
  res := public.sync_device_ops(dev, sec, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start', 'data', jsonb_build_object(
      'id', sid, 'traveler_name', 'Overdue Olly', 'recipient', jsonb_build_object('name', 'Mum', 'email', 'mum@example.com', 'phone', '+84 000 000 010'),
      'interval_min', 30, 'grace_min', 5, 'lat', 12.1, 'lng', 108.6, 'share_public_medical', false,
      'public_medical', jsonb_build_object('blood_type', 'A+')))));
  perform nc_test.ok((select public_medical is null from buddy_sessions where id = sid),
                     'public_medical dropped when not consented');
  perform nc_test.ok(public.nc_mark_overdue() = 0 or not exists (select 1 from buddy_sessions where id = sid and status <> 'active'),
                     'fresh session is not overdue');
  -- time travel: the check-in was due 40 minutes ago (grace 5)
  update buddy_sessions set next_due_at = now() - interval '40 minutes' where id = sid;
  n := public.nc_mark_overdue();
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(n >= 1 and s.status = 'overdue', 'nc_mark_overdue flips an expired session to overdue');
  perform nc_test.ok(exists (select 1 from checkin_events where session_id = sid and kind = 'overdue'
                             and meta ->> 'source' = 'server'), 'overdue event written by the server');
  perform nc_test.ok(public.nc_mark_overdue() = 0 or (select count(*) from checkin_events where session_id = sid and kind = 'overdue') = 1,
                     'nc_mark_overdue is idempotent');
  perform nc_test.ok((select overdue_by_min from v_buddy_sessions where id = sid) >= 39, 'v_buddy_sessions.overdue_by_min');
  perform nc_test.ok(app_private.alert_due(s), 'overdue session is due for an alert');
  perform nc_test.setv('dev', dev::text);
  perform nc_test.setv('sec', sec);
  perform nc_test.setv('sid', sid::text);
end $$;

\if :with_fakes
do $$
declare n int;
begin
  delete from net.http_request_log;
  n := public.nc_dispatch_alerts();
  perform nc_test.ok(n >= 1, 'nc_dispatch_alerts reports due sessions');
  perform nc_test.ok(exists (select 1 from net.http_request_log
                             where url = 'https://example-ref.supabase.co/functions/v1/deadman-alert'
                               and headers ->> 'x-nc-cron-secret' = 'test-cron-secret'
                               and body ->> 'type' = 'overdue'),
                     'pg_net POST to {functions_url}/deadman-alert with x-nc-cron-secret');
  perform nc_test.ok((public.nc_deadman_tick()) ? 'marked_overdue', 'nc_deadman_tick returns a summary');
end $$;
\endif

-- the Edge Function side, as service_role
set role service_role;
do $$ begin perform nc_test.claims('service_role'); end $$;
do $$
declare
  sid uuid := nc_test.getv('sid')::uuid;
  c   jsonb;
  s   buddy_sessions%rowtype;
begin
  c := public.nc_alert_claim();
  perform nc_test.ok(exists (select 1 from jsonb_array_elements(c) x where x ->> 'id' = sid::text
                               and x ->> 'reason' = 'overdue' and x ->> 'recipient_email' = 'mum@example.com'
                               and x -> 'public_medical' = 'null'::jsonb),
                     'nc_alert_claim returns the due session payload (no medical data without consent)');
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(s.alerted_at is not null and s.status = 'overdue', 'claim marks alerted_at');
  perform nc_test.ok(not exists (select 1 from jsonb_array_elements(public.nc_alert_claim()) x where x ->> 'id' = sid::text),
                     'a claimed session is not claimed twice');
  c := public.nc_alert_result(sid, true, 'overdue', 'resend', 'em_test_1', null, 'cron');
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(s.status = 'alerted' and s.alerted_at is not null, 'successful send -> status alerted');
  perform nc_test.ok(exists (select 1 from checkin_events where session_id = sid and kind = 'alert_sent'
                             and meta ->> 'id' = 'em_test_1' and meta ->> 'provider' = 'resend'),
                     'alert_sent event with provider id');
end $$;
reset role;
do $$ begin perform nc_test.noclaims(); end $$;

\if :with_fakes
delete from net.http_request_log;
\endif
do $$
declare
  res jsonb;
  sid uuid := nc_test.getv('sid')::uuid;
  s   buddy_sessions%rowtype;
begin
  -- a (late) check-in resolves the incident
  res := public.sync_device_ops(nc_test.getv('dev')::uuid, nc_test.getv('sec'), jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.checkin',
                       'data', jsonb_build_object('session_id', sid, 'kind', 'checkin', 'lat', 12.2, 'lng', 108.7))));
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(s.status = 'active' and s.alerted_at is null and s.next_due_at > now(),
                     'check-in after an alert -> active again');
  perform nc_test.ok(exists (select 1 from checkin_events where session_id = sid and kind = 'resolved'
                             and meta ->> 'reason' = 'checkin'), 'resolved event written');
end $$;
\if :with_fakes
do $$ begin
  perform nc_test.ok(exists (select 1 from net.http_request_log where body ->> 'type' = 'resolved'
                             and body ->> 'session_id' = nc_test.getv('sid')),
                     'all-clear notification queued via pg_net');
end $$;
\endif

set role service_role;
do $$ begin perform nc_test.claims('service_role'); end $$;
do $$
declare
  sid uuid := nc_test.getv('sid')::uuid;
  c   jsonb;
begin
  c := public.nc_alert_claim(sid, 'resolved');
  perform nc_test.ok(jsonb_array_length(c) = 1 and c -> 0 ->> 'reason' = 'resolved', 'all-clear claim for a resolved incident');
  perform public.nc_alert_result(sid, true, 'resolved', 'resend', 'em_test_2', null, 'cron');
  perform nc_test.ok(jsonb_array_length(public.nc_alert_claim(sid, 'resolved')) = 0, 'all-clear is sent only once');
end $$;
reset role;
do $$ begin perform nc_test.noclaims(); end $$;

-- SOS escalates an active session like a missed check-in (same rule as the
-- local mock backend); the alert e-mail is then worded as SOS
\if :with_fakes
delete from net.http_request_log;
\endif
do $$
declare
  dev uuid := nc_test.getv('dev')::uuid;
  sec text := nc_test.getv('sec');
  sid uuid := nc_test.getv('sid')::uuid;
  res jsonb;
  s   buddy_sessions%rowtype;
begin
  res := public.sync_device_ops(dev, sec, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.checkin',
                       'data', jsonb_build_object('session_id', sid, 'kind', 'sos', 'lat', 12.3, 'lng', 108.8))));
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(s.status = 'overdue' and res -> 'results' -> 0 -> 'data' ->> 'status' = 'overdue'
                     and res -> 'session' ->> 'status' = 'overdue' and abs(s.last_lat - 12.3) < 1e-9,
                     'SOS escalates the session to overdue, with its location');
  perform nc_test.ok(exists (select 1 from checkin_events where session_id = sid and kind = 'sos' and lat = 12.3),
                     'SOS event stored');
  perform nc_test.ok(app_private.alert_due(s) and app_private.alert_payload(s, 'overdue', now()) ->> 'reason' = 'sos',
                     'SOS session is due for an alert with reason = sos');
  -- device-detected overdue (queued while offline) escalates an active session too
  update buddy_sessions set status = 'active' where id = sid;
  res := public.sync_device_ops(dev, sec, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.checkin',
                       'data', jsonb_build_object('session_id', sid, 'kind', 'overdue', 'queued', true))));
  perform nc_test.ok((select status from buddy_sessions where id = sid) = 'overdue'
                     and exists (select 1 from checkin_events where session_id = sid and kind = 'overdue' and queued),
                     'device-side overdue -> overdue (event flagged queued)');
end $$;
\if :with_fakes
do $$ begin
  perform nc_test.ok((select count(*) from net.http_request_log
                       where body ->> 'type' = 'overdue' and body ->> 'source' in ('sos', 'overdue')) = 2,
                     'SOS / device overdue call the Edge Function at once (no wait for cron)');
end $$;
\endif

set role service_role;
do $$ begin perform nc_test.claims('service_role'); end $$;
do $$
declare
  sid uuid := nc_test.getv('sid')::uuid;
  s   buddy_sessions%rowtype;
begin
  perform public.nc_alert_claim(sid);
  perform public.nc_alert_result(sid, false, 'overdue', 'resend', null, 'HTTP 500', 'cron');
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(s.status = 'overdue' and s.alerted_at is null, 'failed send releases the claim');
  perform nc_test.ok(not app_private.alert_due(s), 'backoff: not retried immediately after a failure');
  update checkin_events set received_at = now() - interval '3 minutes' where session_id = sid and kind = 'alert_failed';
  perform nc_test.ok(app_private.alert_due(s), 'backoff: retried after the wait');
  -- manual (admin) trigger works on an active session too
  update buddy_sessions set status = 'active', alerted_at = null where id = sid;
  perform nc_test.ok(jsonb_array_length(public.nc_alert_claim(sid, 'overdue', true)) = 1, 'manual claim of an active session');
  perform public.nc_alert_result(sid, true, 'overdue', 'resend', 'em_test_3', null, 'manual');
  perform nc_test.ok((select status from buddy_sessions where id = sid) = 'alerted', 'manual send -> alerted');
end $$;
reset role;
do $$ begin perform nc_test.noclaims(); end $$;

-- device resolve ("I'm OK")
do $$
declare
  res jsonb;
  sid uuid := nc_test.getv('sid')::uuid;
begin
  res := public.sync_device_ops(nc_test.getv('dev')::uuid, nc_test.getv('sec'), jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.resolve', 'data', jsonb_build_object('session_id', sid, 'note', 'OK'))));
  perform nc_test.ok((select status from buddy_sessions where id = sid) = 'active'
                     and res -> 'results' -> 0 -> 'data' ->> 'status' = 'active'
                     and exists (select 1 from checkin_events where session_id = sid and kind = 'resolved' and meta ->> 'by' = 'traveler'),
                     'buddy.resolve -> active + resolved event');
end $$;

-- ============================================ 6b. end-to-end device flow
-- One traveller, as the app does it: register → outbox batch (device.register,
-- buddy.start queued offline, check-in) → the same batch replayed after a lost
-- response → silence past the grace period → cron → admin closes the incident.
\echo '== e2e: register → start → check-in → duplicate → overdue → nc_mark_overdue → admin_resolve_session'
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000a001', 'admin@test.local')
on conflict (id) do nothing;
insert into admin_users (user_id, display_name, role)
values ('00000000-0000-4000-8000-00000000a001', 'Test Admin', 'admin')
on conflict (user_id) do nothing;
do $$
declare
  reg      jsonb := public.register_device('vinaphone', 'e2e-2.0');
  dev      uuid := (reg ->> 'device_id')::uuid;
  sec      text := reg ->> 'secret';
  sid      uuid := gen_random_uuid();
  op_reg   uuid := gen_random_uuid();
  op_start uuid := gen_random_uuid();
  op_ck    uuid := gen_random_uuid();
  op_loc   uuid := gen_random_uuid();
  t_start  timestamptz := now() - interval '30 minutes';   -- started while offline
  t_ck     timestamptz := now() - interval '1 minute';
  rt       text := (select id from routes where is_active order by sort desc, id desc limit 1);
  v_lat    float8;
  v_lng    float8;
  res      jsonb;
  res1     jsonb;
  s        buddy_sessions%rowtype;
  n        int;
begin
  select ST_Y(geom::geometry), ST_X(geom::geometry) into v_lat, v_lng
  from route_nodes where route_id = rt order by id offset 1 limit 1;

  -- 1. first sync: device.register + buddy.start (queued) + check-in
  res1 := public.sync_device_ops(dev, sec, jsonb_build_array(
    jsonb_build_object('id', op_reg, 'op', 'device.register',
                       'data', jsonb_build_object('carrier', 'viettel', 'app_version', 'e2e-2.1')),
    jsonb_build_object('id', op_start, 'op', 'buddy.start', 'data', jsonb_build_object(
      'id', sid, 'traveler_name', 'E2E Traveller', 'started_at', t_start,
      'recipient', jsonb_build_object('name', 'Buddy', 'email', 'buddy@example.com', 'phone', '+84 000 000 011'),
      'interval_min', 45, 'grace_min', 10, 'route_id', rt, 'travel_mode', 'hiking',
      'share_public_medical', false, 'lat', v_lat, 'lng', v_lng)),
    jsonb_build_object('id', op_ck, 'op', 'buddy.checkin', 'data', jsonb_build_object(
      'session_id', sid, 'kind', 'checkin', 'lat', v_lat + 0.01, 'lng', v_lng, 'accuracy_m', 8, 'client_ts', t_ck))));
  perform nc_test.ok((select count(*) from jsonb_array_elements(res1 -> 'results') r where r ->> 'status' = 'ok') = 3
                     and res1 -> 'results' -> 1 -> 'data' ->> 'session_id' = sid::text
                     and res1 -> 'results' -> 2 -> 'data' ? 'received_at',
                     'e2e: first sync -> 3 ok results (session id, received_at)');
  perform nc_test.ok(exists (select 1 from devices where id = dev and carrier = 'viettel' and app_version = 'e2e-2.1'
                               and last_seen_at is not null),
                     'e2e: device.register op updates carrier/app version, last_seen_at set');
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(s.status = 'active' and s.started_at = t_start and s.route_id = rt and s.travel_mode = 'hiking'
                     and s.public_medical is null,
                     'e2e: session active, started_at = client time, route/mode stored, no medical data');
  perform nc_test.ok(s.last_checkin_at = t_ck and s.next_due_at = t_ck + interval '45 minutes'
                     and abs(s.last_lat - (v_lat + 0.01)) < 1e-9 and s.last_location_at = t_ck,
                     'e2e: check-in -> last_checkin_at = client_ts, next_due_at = +interval, last location');
  perform nc_test.ok((res1 -> 'session' ->> 'next_due_at')::timestamptz = s.next_due_at
                     and res1 -> 'session' ->> 'status' = 'active',
                     'e2e: sync response carries the updated session');
  perform nc_test.ok((select queued from checkin_events where session_id = sid and kind = 'start')
                     and not (select queued from checkin_events where session_id = sid and kind = 'checkin'),
                     'e2e: start synced 30 min late is flagged queued, the fresh check-in is not');

  -- 2. the device never got the response: it replays the whole batch + one new op
  res := public.sync_device_ops(dev, sec, jsonb_build_array(
    jsonb_build_object('id', op_start, 'op', 'buddy.start', 'data', jsonb_build_object('id', sid, 'interval_min', 5)),
    jsonb_build_object('id', op_ck, 'op', 'buddy.checkin', 'data', jsonb_build_object('session_id', sid, 'kind', 'checkin')),
    jsonb_build_object('id', op_loc, 'op', 'buddy.checkin', 'data', jsonb_build_object(
      'session_id', sid, 'kind', 'location', 'lat', v_lat + 0.02, 'lng', v_lng))));
  perform nc_test.ok(res -> 'results' -> 0 ->> 'status' = 'duplicate' and res -> 'results' -> 1 ->> 'status' = 'duplicate'
                     and res -> 'results' -> 2 ->> 'status' = 'ok'
                     and res -> 'results' -> 1 -> 'data' ->> 'event_id' = res1 -> 'results' -> 2 -> 'data' ->> 'event_id',
                     'e2e: replayed ops -> duplicate with the original result, new op -> ok');
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(s.interval_min = 45 and s.next_due_at = t_ck + interval '45 minutes'
                     and (select count(*) from checkin_events where session_id = sid and kind in ('start', 'checkin')) = 2
                     and (select count(*) from device_ops where device_id = dev) = 4,
                     'e2e: duplicates change nothing (settings, due time, events); 4 ops recorded');
  perform nc_test.ok(abs(s.last_lat - (v_lat + 0.02)) < 1e-9 and s.last_checkin_at = t_ck,
                     'e2e: location op moves the last location but is not a check-in');

  -- 3. time travel: silent inside the grace period, then past it
  update buddy_sessions set last_checkin_at = now() - interval '54 minutes', next_due_at = now() - interval '9 minutes'
   where id = sid;
  perform public.nc_mark_overdue();
  perform nc_test.ok((select status from buddy_sessions where id = sid) = 'active',
                     'e2e: 9 min past due with grace 10 -> still active');
  update buddy_sessions set last_checkin_at = now() - interval '56 minutes', next_due_at = now() - interval '11 minutes'
   where id = sid;
  n := public.nc_mark_overdue();
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(n >= 1 and s.status = 'overdue', 'e2e: 11 min past due -> nc_mark_overdue flips it to overdue');
  perform nc_test.ok((select count(*) from checkin_events where session_id = sid and kind = 'overdue'
                        and meta ->> 'source' = 'server' and abs(checkin_events.lat - s.last_lat) < 1e-9) = 1
                     and (select overdue_by_min from v_buddy_sessions where id = sid) = 11,
                     'e2e: one server overdue event at the last location; overdue_by_min = 11');
  perform public.nc_mark_overdue();
  perform nc_test.ok((select count(*) from checkin_events where session_id = sid and kind = 'overdue') = 1,
                     'e2e: cron again -> no second overdue event');
  perform nc_test.ok(exists (select 1 from audit_log where entity = 'buddy_sessions' and entity_id = sid::text
                               and action = 'status' and details ->> 'from' = 'active' and details ->> 'to' = 'overdue'),
                     'e2e: status change active -> overdue audited');
  res := public.sync_device_ops(dev, sec, '[]'::jsonb);
  perform nc_test.ok(jsonb_array_length(res -> 'results') = 0 and res -> 'session' ->> 'status' = 'overdue',
                     'e2e: next (empty) device sync learns the server-side overdue');
  perform nc_test.setv('e2e_dev', dev::text);
  perform nc_test.setv('e2e_sec', sec);
  perform nc_test.setv('e2e_sid', sid::text);
end $$;

-- 4. the admin reaches the traveller and closes the incident
\if :with_fakes
delete from net.http_request_log;
\endif
set role authenticated;
do $$ begin perform nc_test.claims('authenticated', '00000000-0000-4000-8000-00000000a001'); end $$;
do $$
declare
  sid uuid := nc_test.getv('e2e_sid')::uuid;
  k0  jsonb := public.admin_kpis();
  k1  jsonb;
  r   jsonb;
begin
  r := public.admin_resolve_session(sid, 'Đã gọi được cho du khách, an toàn');
  k1 := public.admin_kpis();
  perform nc_test.ok(r ->> 'status' = 'closed' and r ->> 'previous_status' = 'overdue' and r ->> 'closed_at' is not null
                     and (select status from public.buddy_sessions where id = sid) = 'closed',
                     'e2e: admin_resolve_session closes the overdue session');
  perform nc_test.ok(exists (select 1 from public.checkin_events where session_id = sid and kind = 'resolved'
                               and meta ->> 'by' = 'admin' and meta ->> 'previous_status' = 'overdue'
                               and meta ->> 'admin' = '00000000-0000-4000-8000-00000000a001'
                               and note = 'Đã gọi được cho du khách, an toàn'),
                     'e2e: resolved event (by admin, with note)');
  perform nc_test.ok(exists (select 1 from public.audit_log where entity = 'buddy_sessions' and entity_id = sid::text
                               and details ->> 'to' = 'closed' and actor = '00000000-0000-4000-8000-00000000a001'),
                     'e2e: closing is audited with the admin as actor');
  perform nc_test.ok((k1 -> 'buddy' ->> 'overdue')::int = (k0 -> 'buddy' ->> 'overdue')::int - 1
                     and (k1 -> 'buddy' ->> 'closed_24h')::int = (k0 -> 'buddy' ->> 'closed_24h')::int + 1,
                     'e2e: admin_kpis.buddy overdue -1, closed_24h +1');
  r := public.admin_resolve_session(sid, 'lần 2');
  perform nc_test.ok(r ->> 'status' = 'closed' and r ->> 'previous_status' = 'closed'
                     and (select count(*) from public.checkin_events where session_id = sid and kind = 'resolved') = 1,
                     'e2e: resolving a closed session again is a no-op');
  begin
    perform public.admin_resolve_session(gen_random_uuid(), null);
    perform nc_test.ok(false, 'e2e: admin_resolve_session of an unknown id -> session_not_found');
  exception when sqlstate 'P0002' then
    perform nc_test.ok(sqlerrm = 'session_not_found', 'e2e: admin_resolve_session of an unknown id -> session_not_found');
  end;
end $$;
reset role;
do $$ begin perform nc_test.noclaims(); end $$;
\if :with_fakes
do $$ begin
  perform nc_test.ok(not exists (select 1 from net.http_request_log where body ->> 'session_id' = nc_test.getv('e2e_sid')),
                     'e2e: no all-clear e-mail when the recipient was never alerted');
end $$;
\endif

-- 5. a late event from the phone after the admin closed it: logged, nothing changes
do $$
declare
  sid uuid := nc_test.getv('e2e_sid')::uuid;
  res jsonb;
begin
  res := public.sync_device_ops(nc_test.getv('e2e_dev')::uuid, nc_test.getv('e2e_sec'), jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.checkin', 'data', jsonb_build_object(
      'session_id', sid, 'kind', 'checkin', 'lat', 12.0, 'lng', 108.0))));
  perform nc_test.ok(res -> 'results' -> 0 ->> 'status' = 'ok' and res -> 'results' -> 0 -> 'data' ->> 'ignored' = 'session_closed'
                     and res -> 'session' ->> 'status' = 'closed'
                     and (select status from buddy_sessions where id = sid) = 'closed'
                     and (select count(*) from checkin_events where session_id = sid and kind = 'checkin') = 2,
                     'e2e: late check-in on a closed session is logged and ignored');
end $$;

-- 6. same, but the recipient HAD been e-mailed: closing sends the all-clear
do $$
declare
  dev uuid := nc_test.getv('e2e_dev')::uuid;
  sid uuid := gen_random_uuid();
  res jsonb;
begin
  res := public.sync_device_ops(dev, nc_test.getv('e2e_sec'), jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start', 'data', jsonb_build_object(
      'id', sid, 'traveler_name', 'E2E Two', 'recipient', jsonb_build_object('email', 'buddy2@example.com', 'phone', '+84 000 000 012'),
      'interval_min', 30, 'grace_min', 5, 'lat', 12.1, 'lng', 108.6))));
  update buddy_sessions set next_due_at = now() - interval '20 minutes' where id = sid;
  perform public.nc_mark_overdue();
  perform nc_test.setv('e2e_sid2', sid::text);
end $$;
set role service_role;
do $$ begin perform nc_test.claims('service_role'); end $$;
do $$
declare sid uuid := nc_test.getv('e2e_sid2')::uuid;
begin
  perform nc_test.ok(jsonb_array_length(public.nc_alert_claim(sid)) = 1, 'e2e: overdue session claimed by the Edge Function');
  perform public.nc_alert_result(sid, true, 'overdue', 'resend', 'em_e2e_1', null, 'cron');
  perform nc_test.ok((select status from buddy_sessions where id = sid) = 'alerted', 'e2e: e-mail sent -> alerted');
end $$;
reset role;
\if :with_fakes
delete from net.http_request_log;
\endif
set role authenticated;
do $$ begin perform nc_test.claims('authenticated', '00000000-0000-4000-8000-00000000a001'); end $$;
do $$
declare r jsonb := public.admin_resolve_session(nc_test.getv('e2e_sid2')::uuid, 'Người thân đã liên lạc được');
begin
  perform nc_test.ok(r ->> 'status' = 'closed' and r ->> 'previous_status' = 'alerted',
                     'e2e: admin_resolve_session closes an alerted session');
end $$;
reset role;
do $$ begin perform nc_test.noclaims(); end $$;
\if :with_fakes
do $$ begin
  perform nc_test.ok(exists (select 1 from net.http_request_log where body ->> 'session_id' = nc_test.getv('e2e_sid2')
                               and body ->> 'type' = 'resolved'),
                     'e2e: closing an alerted session queues the all-clear e-mail');
end $$;
\endif

-- ================================================== 7. data constraints
\echo '== constraints'
do $$
begin
  begin
    insert into facilities (id, name, type, address, geom, open_hours, night_shift, trauma_capable, verified_by, verified_at, status)
    values ('t-incomplete', 'Thiếu số điện thoại', 'tram_y_te', 'X', app_private.pt(12, 108), '7-17', false, false, 'A', current_date, 'verified');
    perform nc_test.ok(false, 'verified facility without phone is rejected');
  exception when check_violation then
    perform nc_test.ok(true, 'verified facility without phone is rejected');
  end;
  begin
    insert into facilities (id, name, type, address, geom, phone, open_hours, night_shift, trauma_capable, verified_by, verified_at, status)
    values ('t-blank', 'Tên', 'tram_y_te', '  ', app_private.pt(12, 108), '+84 000 000 099', '7-17', false, false, 'A', current_date, 'verified');
    perform nc_test.ok(false, 'blank address counts as missing');
  exception when check_violation then
    perform nc_test.ok(true, 'blank address counts as missing');
  end;
  insert into facilities (id, name, status) values ('t-pending', 'Chỉ có tên', 'pending');
  perform nc_test.ok(true, 'incomplete pending facility is accepted');
  delete from facilities where id = 't-pending';
  begin
    insert into content_releases (version, status) values ('t-unsigned', 'approved');
    perform nc_test.ok(false, 'approved content without approver is rejected');
  exception when check_violation then
    perform nc_test.ok(true, 'approved content without approver is rejected');
  end;
end $$;

-- ================================================================ 8. RLS
\echo '== RLS & privileges'
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000a001', 'admin@test.local'),
  ('00000000-0000-4000-8000-00000000b002', 'user@test.local')
on conflict (id) do nothing;
insert into admin_users (user_id, display_name, role)
values ('00000000-0000-4000-8000-00000000a001', 'Test Admin', 'admin')
on conflict (user_id) do nothing;
do $$ begin perform nc_test.setv('total_facilities', (select count(*) from facilities)::text); end $$;

-- anon: no table/view access, public RPC only
set role anon;
do $$ begin perform nc_test.claims('anon'); end $$;
do $$
declare
  t text;
  denied int := 0;
  objs text[] := array['carriers','routes','route_nodes','route_edges','signal_samples','signal_segments',
                       'route_accuracy','facilities','services','facility_submissions','data_packs',
                       'content_releases','devices','device_ops','buddy_sessions','checkin_events',
                       'admin_users','audit_log','v_facilities','v_buddy_sessions','v_services','v_signal_samples'];
begin
  foreach t in array objs loop
    begin
      execute format('select 1 from public.%I limit 1', t);
    exception when insufficient_privilege then
      denied := denied + 1;
    end;
  end loop;
  perform nc_test.ok(denied = cardinality(objs), 'anon cannot select any table or view (' || denied || '/' || cardinality(objs) || ')');
  begin
    insert into public.facility_submissions (kind) values ('new');
    perform nc_test.ok(false, 'anon cannot insert directly');
  exception when insufficient_privilege then
    perform nc_test.ok(true, 'anon cannot insert directly');
  end;
  perform nc_test.ok(jsonb_array_length(public.list_routes()) > 0, 'anon can call list_routes');
  perform nc_test.ok(public.get_data_pack((select r ->> 'id' from jsonb_array_elements(public.list_routes()) r limit 1), 'viettel') ? 'nodes',
                     'anon can call get_data_pack');
  foreach t in array array['admin_kpis()', 'nc_alert_claim()', 'nc_mark_overdue()', 'is_admin()'] loop
    begin
      execute 'select public.' || t;
      perform nc_test.ok(false, 'anon cannot execute ' || t);
    exception when insufficient_privilege then
      perform nc_test.ok(true, 'anon cannot execute ' || t);
    end;
  end loop;
  begin
    perform app_private.build_pack('x', 'y', 1, now());
    perform nc_test.ok(false, 'anon cannot reach app_private');
  exception when insufficient_privilege then
    perform nc_test.ok(true, 'anon cannot reach app_private');
  end;
end $$;
reset role;
do $$ begin perform nc_test.noclaims(); end $$;

-- authenticated, but not an admin: sees nothing, changes nothing
set role authenticated;
do $$ begin perform nc_test.claims('authenticated', '00000000-0000-4000-8000-00000000b002'); end $$;
do $$
declare n int;
begin
  perform nc_test.ok(not public.is_admin(), 'is_admin() false for a normal user');
  perform nc_test.ok((select count(*) from public.facilities) = 0 and (select count(*) from public.buddy_sessions) = 0
                     and (select count(*) from public.v_facilities) = 0,
                     'non-admin sees no rows (tables and security_invoker views)');
  update public.facilities set notes = 'hack';
  get diagnostics n = row_count;
  perform nc_test.ok(n = 0, 'non-admin update affects 0 rows');
  begin
    insert into public.facilities (id, name) values ('t-hack', 'x');
    perform nc_test.ok(false, 'non-admin insert is rejected by RLS');
  exception when insufficient_privilege then
    perform nc_test.ok(true, 'non-admin insert is rejected by RLS');
  end;
  begin
    perform public.admin_kpis();
    perform nc_test.ok(false, 'non-admin admin_kpis -> forbidden');
  exception when insufficient_privilege then
    perform nc_test.ok(true, 'non-admin admin_kpis -> forbidden');
  end;
  begin
    perform public.nc_mark_overdue();
    perform nc_test.ok(false, 'non-admin nc_mark_overdue -> forbidden');
  exception when insufficient_privilege then
    perform nc_test.ok(true, 'non-admin nc_mark_overdue -> forbidden');
  end;
  begin
    insert into public.admin_users (user_id) values ('00000000-0000-4000-8000-00000000b002');
    perform nc_test.ok(false, 'a user cannot make themselves admin');
  exception when insufficient_privilege then
    perform nc_test.ok(true, 'a user cannot make themselves admin');
  end;
end $$;
reset role;
do $$ begin perform nc_test.noclaims(); end $$;

-- admin: full access through RLS + admin RPCs
set role authenticated;
do $$ begin perform nc_test.claims('authenticated', '00000000-0000-4000-8000-00000000a001'); end $$;
do $$
declare
  k     jsonb;
  pub1  jsonb;
  pub2  jsonb;
  rt    text := (select id from public.routes where is_active order by sort, id limit 1);
  fid   text := (select id from public.facilities where status = 'verified' order by id limit 1);
  sub   text;
  rev   jsonb;
  cr    jsonb;
  up    jsonb;
  sid   uuid;
begin
  perform nc_test.ok(public.is_admin(), 'is_admin() true for an admin');
  perform nc_test.ok((select count(*) from public.facilities) = nc_test.getv('total_facilities')::int,
                     'admin sees every facility');
  perform nc_test.ok((select count(*) from public.v_facilities where lat is not null) > 0, 'admin reads v_facilities with lat/lng');
  perform nc_test.ok((select count(*) from public.admin_users) >= 1, 'admin reads admin_users');

  k := public.admin_kpis();
  perform nc_test.ok(k ?& array['facilities', 'submissions_pending', 'buddy', 'samples', 'routes', 'packs']
                     and (k -> 'facilities' ->> 'target')::int = 216
                     and k -> 'buddy' ?& array['active', 'overdue', 'alerted', 'closed_24h']
                     and k -> 'samples' ?& array['total', 'pending', 'by_carrier'],
                     'admin_kpis shape');

  update public.facilities set notes = coalesce(notes, '') || ' [audited]' where id = fid;
  perform nc_test.ok(exists (select 1 from public.audit_log where entity = 'facilities' and entity_id = fid
                             and actor = '00000000-0000-4000-8000-00000000a001' and actor_label = 'Test Admin'
                             and details -> 'changed' ? 'notes'),
                     'audit trigger records admin updates with actor');

  pub1 := public.admin_publish_pack(rt, 'viettel', 'test publish 1', true);    -- forced: new version
  pub2 := public.admin_publish_pack(rt, 'viettel', 'test publish 2');          -- nothing changed since pub1
  perform nc_test.ok(not (pub1 ->> 'unchanged')::boolean and (pub2 ->> 'unchanged')::boolean
                     and (pub2 ->> 'version')::int = (pub1 ->> 'version')::int
                     and (select count(*) from public.data_packs where route_id = rt and carrier = 'viettel'
                                                             and version > (pub1 ->> 'version')::int) = 0,
                     'admin_publish_pack without changes -> same version, unchanged = true, no new row');
  pub2 := public.admin_publish_pack(rt, 'viettel', 'test publish 3', true);
  perform nc_test.ok((pub2 ->> 'version')::int = (pub1 ->> 'version')::int + 1 and not (pub2 ->> 'unchanged')::boolean,
                     'admin_publish_pack(force) bumps version');
  perform nc_test.ok((select count(*) from public.data_packs where route_id = rt and carrier = 'viettel' and is_current) = 1
                     and (select version from public.data_packs where route_id = rt and carrier = 'viettel' and is_current)
                         = (pub2 ->> 'version')::int,
                     'exactly one current pack (the new one)');
  perform nc_test.ok((public.get_data_pack(rt, 'viettel') ->> 'version')::int = (pub2 ->> 'version')::int
                     and (public.get_data_pack(rt, 'viettel') ->> 'size_bytes')::int = (pub2 ->> 'size_bytes')::int,
                     'get_data_pack serves the published snapshot');
  perform nc_test.ok((select checksum from public.data_packs where route_id = rt and carrier = 'viettel' and is_current)
                     = encode(digest((public.get_data_pack(rt, 'viettel'))::text, 'sha256'), 'hex'),
                     'checksum = sha256(payload)');
  perform nc_test.ok(exists (select 1 from public.audit_log where entity = 'data_packs' and action = 'publish'),
                     'publish is audited');
  perform nc_test.ok(((select item from jsonb_array_elements(public.list_routes()) item where item ->> 'id' = rt)
                      -> 'packs' -> 'viettel' ->> 'version')::int = (pub2 ->> 'version')::int,
                     'list_routes shows the current pack version');

  select id into sub from public.facility_submissions where kind = 'new' and status = 'pending' order by created_at, id limit 1;
  if sub is not null then
    rev := public.admin_review_submission(sub, 'approved', 'ok');
    perform nc_test.ok(rev ->> 'status' = 'approved' and rev ->> 'facility_id' is not null
                       and (select status from public.facilities where id = rev ->> 'facility_id') = 'pending',
                       'approving a new submission creates a pending facility');
  end if;
  begin
    perform public.admin_review_submission('does-not-exist', 'approved', null);
    perform nc_test.ok(false, 'review of an unknown submission fails');
  exception when sqlstate 'P0002' then
    perform nc_test.ok(true, 'review of an unknown submission fails');
  end;

  perform nc_test.ok(public.admin_review_samples(array(select id from public.signal_samples where status = 'pending'), 'approved') >= 1,
                     'admin_review_samples approves pending samples');

  insert into public.content_releases (version, status, notes, reviewer_round1)
  values ('9.9.9-test', 'in_review', 'test', 'Nhóm') returning to_jsonb(content_releases.*) into cr;
  begin
    perform public.admin_approve_content((cr ->> 'id')::bigint, '  ');
    perform nc_test.ok(false, 'approval without approver is refused');
  exception when sqlstate '22023' then
    perform nc_test.ok(true, 'approval without approver is refused');
  end;
  cr := public.admin_approve_content((cr ->> 'id')::bigint, 'BS. Cố vấn');
  perform nc_test.ok(cr ->> 'status' = 'approved' and public.get_content_release() ->> 'version' = '9.9.9-test',
                     'admin_approve_content + get_content_release returns the latest approved');

  begin
    perform public.admin_upsert_facility(jsonb_build_object('name', 'Trạm mới', 'type', 'tram_y_te', 'lat', 12.0, 'lng', 108.5,
                                                            'status', 'verified'));
    perform nc_test.ok(false, 'admin_upsert_facility refuses an incomplete verified facility');
  exception when check_violation then
    perform nc_test.ok(true, 'admin_upsert_facility refuses an incomplete verified facility');
  end;
  up := public.admin_upsert_facility(jsonb_build_object(
    'name', 'Trạm test đủ trường', 'type', 'tram_y_te', 'address', 'Xã Test', 'lat', 12.0, 'lng', 108.5,
    'phone', '+84 000 000 077', 'open_hours', '7:00–17:00', 'night_shift', false, 'trauma_capable', true,
    'verified_by', 'Chị Test', 'verified_at', current_date::text, 'status', 'verified', 'route_id', rt));
  perform nc_test.ok(up ->> 'status' = 'verified' and (up ->> 'lat')::float8 = 12.0, 'admin_upsert_facility inserts with lat/lng');
  up := public.admin_upsert_facility(jsonb_build_object('id', up ->> 'id', 'phone', '+84 000 000 078'));
  perform nc_test.ok(up ->> 'phone' = '+84 000 000 078' and up ->> 'status' = 'verified', 'admin_upsert_facility partial update');
  up := public.admin_upsert_facility(jsonb_build_object('id', up ->> 'id', 'status', 'rejected'));
  perform nc_test.ok(up ->> 'status' = 'rejected' and up ->> 'phone' = '+84 000 000 078',
                     'status-only upsert (setFacilityStatus) keeps the other fields');
  begin
    perform public.admin_upsert_facility(jsonb_build_object('id', 'no-such-facility', 'status', 'rejected'));
    perform nc_test.ok(false, 'status change of an unknown facility -> facility_not_found');
  exception when sqlstate 'P0002' then
    perform nc_test.ok(sqlerrm = 'facility_not_found', 'status change of an unknown facility -> facility_not_found');
  end;
  begin
    perform public.admin_upsert_facility(jsonb_build_object('name', 'X', 'type', 'spa'));
    perform nc_test.ok(false, 'admin_upsert_facility rejects an unknown type');
  exception when sqlstate '22023' then
    perform nc_test.ok(sqlerrm = 'invalid_type', 'admin_upsert_facility rejects an unknown type');
  end;
  delete from public.facilities where id = up ->> 'id';
  perform nc_test.ok(not exists (select 1 from public.facilities where id = up ->> 'id')
                     and exists (select 1 from public.audit_log where entity = 'facilities' and entity_id = up ->> 'id'
                                   and action = 'delete'),
                     'admin deletes a facility through RLS (audited)');

  up := public.admin_upsert_service(jsonb_build_object('name', 'Sửa xe test', 'type', 'repair', 'lat', 12.0, 'lng', 108.5));
  perform nc_test.ok(up ->> 'status' = 'active' and up ->> 'type' = 'repair', 'admin_upsert_service inserts');
  up := public.admin_upsert_service(jsonb_build_object('id', up ->> 'id', 'is_partner', true, 'status', 'inactive'));
  perform nc_test.ok((up ->> 'is_partner')::boolean and up ->> 'status' = 'inactive' and up ->> 'name' = 'Sửa xe test',
                     'admin_upsert_service partial update');
  begin
    perform public.admin_upsert_service(jsonb_build_object('type', 'repair'));
    perform nc_test.ok(false, 'admin_upsert_service requires a name');
  exception when check_violation then
    perform nc_test.ok(sqlerrm = 'incomplete', 'admin_upsert_service requires a name');
  end;
  begin
    perform public.admin_upsert_service(jsonb_build_object('name', 'X', 'type', 'hospital'));
    perform nc_test.ok(false, 'admin_upsert_service rejects an unknown type');
  exception when sqlstate '22023' then
    perform nc_test.ok(sqlerrm = 'invalid_type', 'admin_upsert_service rejects an unknown type');
  end;

  select id into sid from public.buddy_sessions where status <> 'closed' order by started_at desc limit 1;
  if sid is not null then
    perform nc_test.ok(public.admin_resolve_session(sid, 'Đã liên lạc được') ->> 'status' = 'closed',
                       'admin_resolve_session closes the session');
  end if;

  begin
    perform public.nc_alert_claim();
    perform nc_test.ok(false, 'nc_alert_claim is service_role only');
  exception when insufficient_privilege then
    perform nc_test.ok(true, 'nc_alert_claim is service_role only');
  end;
end $$;
reset role;
do $$ begin perform nc_test.noclaims(); end $$;

-- trusted-caller detection does not depend on the JWT claim alone
set role authenticated;
do $$ begin perform nc_test.noclaims(); end $$;
do $$ begin
  begin
    perform public.nc_alert_claim();
    perform nc_test.ok(false, 'authenticated role without claims is not trusted');
  exception when insufficient_privilege then
    perform nc_test.ok(true, 'authenticated role without claims is not trusted');
  end;
end $$;
reset role;
grant execute on function public.admin_kpis() to anon;   -- simulate a mis-grant: the guard must still refuse
set role anon;
do $$ begin
  begin
    perform public.admin_kpis();
    perform nc_test.ok(false, 'admin RPC refuses anon even if EXECUTE was granted by mistake');
  exception when insufficient_privilege then
    perform nc_test.ok(true, 'admin RPC refuses anon even if EXECUTE was granted by mistake');
  end;
end $$;
reset role;
revoke execute on function public.admin_kpis() from anon;
set role service_role;
do $$ begin
  perform nc_test.ok(app_private.is_trusted_caller(), 'service_role without JWT claims is trusted (SET ROLE)');
end $$;
reset role;

-- service_role bypasses RLS
set role service_role;
do $$ begin perform nc_test.claims('service_role'); end $$;
do $$ begin
  perform nc_test.ok((select count(*) from public.facilities) > 0 and (select count(*) from public.devices) > 0,
                     'service_role reads everything (RLS bypass)');
end $$;
reset role;
do $$ begin perform nc_test.noclaims(); end $$;

-- ============================================== 8b. end-to-end admin flows
-- Community report from a phone (anon) → admin approves (pending facility) →
-- completes + verifies it → publishes a new pack version; then the seeded
-- 'new' / 'closed' / 'correction' submissions.
\echo '== e2e admin: report → approve → verify → admin_publish_pack; seeded submissions'
set role anon;
do $$ begin perform nc_test.claims('anon'); end $$;
do $$
declare
  reg jsonb := public.register_device('mobifone', 'e2e-2.0');
  rt  text := public.list_routes() -> 0 ->> 'id';
  nd  jsonb;
  sub text := 'e2e-' || gen_random_uuid()::text;
  res jsonb;
begin
  nd := public.get_data_pack(rt, 'mobifone') -> 'nodes' -> 1;
  res := public.sync_device_ops((reg ->> 'device_id')::uuid, reg ->> 'secret', jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'op', 'report.submit', 'data', jsonb_build_object(
      'id', sub, 'kind', 'new', 'facility_id', null,
      'lat', (nd ->> 'lat')::float8 + 0.003, 'lng', (nd ->> 'lng')::float8 + 0.003,
      'payload', jsonb_build_object('name', 'Phòng khám E2E thôn Test', 'type', 'phong_kham',
                                    'note', 'Mở cửa 7:00–20:00, có bác sĩ trực', 'route_id', rt)))));
  perform nc_test.ok(res -> 'results' -> 0 ->> 'status' = 'ok' and res -> 'results' -> 0 -> 'data' ->> 'submission_id' = sub,
                     'e2e admin: an anon device files a "new facility" report');
  perform nc_test.setv('e2e_sub', sub);
  perform nc_test.setv('e2e_rt', rt);
  perform nc_test.setv('e2e_lat', ((nd ->> 'lat')::float8 + 0.003)::text);
  perform nc_test.setv('e2e_lng', ((nd ->> 'lng')::float8 + 0.003)::text);
end $$;
reset role;
do $$ begin perform nc_test.noclaims(); end $$;

-- route a seeded report without route_id should be attached to (nearest edge ≤ 20 km)
do $$
declare s record;
begin
  select id, lat, lng into s from facility_submissions
   where kind = 'new' and status = 'pending' and coalesce(payload ->> 'route_id', '') = '' and lat is not null
     and id <> nc_test.getv('e2e_sub')
   order by created_at, id limit 1;
  if found then
    perform nc_test.setv('e2e_sub_seed', s.id);
    perform nc_test.setv('e2e_sub_seed_route', coalesce(
      (select e.route_id from route_edges e
        where ST_DWithin(e.geom, app_private.pt(s.lat, s.lng), 20000)
        order by ST_Distance(e.geom, app_private.pt(s.lat, s.lng)) limit 1), ''));
  end if;
end $$;

set role authenticated;
do $$ begin perform nc_test.claims('authenticated', '00000000-0000-4000-8000-00000000a001'); end $$;
do $$
declare
  admin_id uuid := '00000000-0000-4000-8000-00000000a001';
  sub   text := nc_test.getv('e2e_sub');
  rt    text := nc_test.getv('e2e_rt');
  c     text := 'mobifone';
  v_lat float8 := nc_test.getv('e2e_lat')::float8;
  v_lng float8 := nc_test.getv('e2e_lng')::float8;
  ex    jsonb := nc_test.getv('expected')::jsonb;
  today text := (now() at time zone 'Asia/Ho_Chi_Minh')::date::text;
  k0    jsonb := public.admin_kpis();
  k1    jsonb;
  rev   jsonb;
  fid   text;
  f     public.v_facilities%rowtype;
  v0    int;
  vv0   int;
  pub   jsonb;
  p     jsonb;
  d     text;
  cs    record;
  v_before text;
begin
  -- approve → pending facility prefilled from the report
  rev := public.admin_review_submission(sub, 'approved', 'Đã gọi xác minh sơ bộ');
  fid := rev ->> 'facility_id';
  perform nc_test.ok(rev ->> 'status' = 'approved' and rev ->> 'kind' = 'new' and fid is not null
                     and rev ->> 'reviewed_at' is not null,
                     'e2e admin: approving the report returns the new facility id');
  select * into f from public.v_facilities where id = fid;
  perform nc_test.ok(f.status = 'pending' and f.source = 'community' and f.is_demo
                     and f.name = 'Phòng khám E2E thôn Test' and f.type = 'phong_kham' and f.route_id = rt
                     and abs(f.lat - v_lat) < 1e-9 and abs(f.lng - v_lng) < 1e-9
                     and f.notes like '%#' || sub || '%' and f.notes like '%có bác sĩ trực%'
                     and f.notes like '%Đã gọi xác minh sơ bộ%',
                     'e2e admin: approved "new" report -> PENDING facility prefilled (name, type, route, location, notes)');
  perform nc_test.ok((select s.status = 'approved' and s.reviewed_by = admin_id and s.facility_id = fid
                             and s.review_note = 'Đã gọi xác minh sơ bộ'
                      from public.facility_submissions s where s.id = sub),
                     'e2e admin: submission approved with reviewer + facility link');
  rev := public.admin_review_submission(sub, 'approved', 'lần 2');
  perform nc_test.ok(rev ->> 'facility_id' = fid
                     and (select count(*) from public.facilities where notes like '%#' || sub || '%') = 1,
                     'e2e admin: approving twice does not create a second facility');
  k1 := public.admin_kpis();
  perform nc_test.ok((k1 -> 'facilities' ->> 'pending')::int = (k0 -> 'facilities' ->> 'pending')::int + 1
                     and k1 -> 'facilities' -> 'verified' = k0 -> 'facilities' -> 'verified'
                     and (k1 ->> 'submissions_pending')::int = (k0 ->> 'submissions_pending')::int - 1,
                     'e2e admin: admin_kpis pending facilities +1, pending submissions -1');
  perform nc_test.ok(not (public.build_data_pack(rt, c) -> 'facilities' @> jsonb_build_array(jsonb_build_object('id', fid))),
                     'e2e admin: a pending facility is never in a pack');

  -- verify: refused while incomplete, then completed
  begin
    perform public.admin_upsert_facility(jsonb_build_object('id', fid, 'status', 'verified'));
    perform nc_test.ok(false, 'e2e admin: verifying an incomplete facility is refused with the missing fields');
  exception when check_violation then
    get stacked diagnostics d = pg_exception_detail;
    perform nc_test.ok(sqlerrm = 'incomplete' and d::jsonb ?& array['address', 'phone', 'open_hours', 'verified_by', 'verified_at']
                       and not (d::jsonb ?| array['name', 'type', 'lat_lng']),
                       'e2e admin: verifying an incomplete facility is refused with the missing fields' || nc_test.why(d));
  end;
  perform public.admin_upsert_facility(jsonb_build_object(
    'id', fid, 'address', 'Thôn Test, xã Test', 'phone', '+84 000 000 066', 'open_hours', '07:00–20:00',
    'night_shift', false, 'trauma_capable', false, 'verified_by', 'Nhóm Stormbreakers (gọi xác minh)',
    'verified_at', today, 'status', 'verified'));
  perform nc_test.ok(public.build_data_pack(rt, c) -> 'facilities'
                       @> jsonb_build_array(jsonb_build_object('id', fid, 'is_stale', false, 'days_since_verified', 0)),
                     'e2e admin: once verified it is in the live build (0 days since verification)');
  if exists (select 1 from public.data_packs where route_id = rt and carrier = c and is_current) then
    perform nc_test.ok(not (public.get_data_pack(rt, c) -> 'facilities' @> jsonb_build_array(jsonb_build_object('id', fid))),
                       'e2e admin: ... but not in the published pack before a publish');
  end if;

  -- publish
  v0 := (public.get_data_pack(rt, c) ->> 'version')::int;
  vv0 := (public.get_data_pack(rt, 'viettel') ->> 'version')::int;
  pub := public.admin_publish_pack(rt, c, 'E2E: thêm phòng khám cộng đồng');
  p := public.get_data_pack(rt, c);
  perform nc_test.ok((pub ->> 'version')::int = v0 + 1 and (p ->> 'version')::int = v0 + 1
                     and (p ->> 'size_bytes')::int = octet_length(p::text) and (pub ->> 'size_bytes')::int = (p ->> 'size_bytes')::int,
                     'e2e admin: admin_publish_pack -> get_data_pack serves version ' || (v0 + 1) || ' with exact size_bytes');
  perform nc_test.ok(p -> 'facilities' @> jsonb_build_array(jsonb_build_object('id', fid)),
                     'e2e admin: the published pack now lists the verified community facility');
  if ex is not null then
    d := concat_ws('; ',
      'facilities ' || nullif(nc_test.set_diff(nc_test.texts(ex -> 'packs' -> (rt || ':' || c) -> 'verified_facility_ids') || fid,
                                               nc_test.ids(p -> 'facilities')), ''),
      'nodes ' || nullif(nc_test.set_diff(nc_test.ids(ex -> 'packs' -> (rt || ':' || c) -> 'nodes'), nc_test.ids(p -> 'nodes')), ''),
      'edges ' || nullif(nc_test.set_diff(nc_test.ids(ex -> 'packs' -> (rt || ':' || c) -> 'edges'), nc_test.ids(p -> 'edges')), ''),
      'segments ' || nullif(nc_test.set_diff(
        array(select (x ->> 'edge_id') || '#' || (x ->> 'seq') || ':' || (x ->> 'level')
              from jsonb_array_elements(ex -> 'packs' -> (rt || ':' || c) -> 'segments') x),
        array(select (x ->> 'edge_id') || '#' || (x ->> 'seq') || ':' || (x ->> 'level')
              from jsonb_array_elements(p -> 'segments') x)), ''));
    perform nc_test.ok(d = '', 'e2e admin: republished pack = browser pack from seed-core.js + the new facility' || nc_test.why(d));
  end if;
  perform nc_test.ok((select published_by = admin_id and notes = 'E2E: thêm phòng khám cộng đồng'
                             and checksum = encode(digest(payload::text, 'sha256'), 'hex')
                      from public.data_packs where route_id = rt and carrier = c and version = v0 + 1),
                     'e2e admin: publish stores admin, notes and sha256 checksum');
  perform nc_test.ok((select count(*) from public.data_packs where route_id = rt and carrier = c and is_current) = 1
                     and not coalesce((select is_current from public.data_packs where route_id = rt and carrier = c and version = v0), false),
                     'e2e admin: exactly one current version (the previous one, if any, is kept as history)');
  perform nc_test.ok(((select item from jsonb_array_elements(public.list_routes()) item where item ->> 'id' = rt)
                        -> 'packs' -> c ->> 'version')::int = v0 + 1
                     and exists (select 1 from jsonb_array_elements(public.admin_kpis() -> 'packs') x
                                  where x ->> 'route_id' = rt and x ->> 'carrier' = c and (x ->> 'version')::int = v0 + 1)
                     and (public.get_data_pack(rt, 'viettel') ->> 'version')::int = vv0,
                     'e2e admin: list_routes + admin_kpis show the new version; other carriers untouched');
  perform nc_test.ok(exists (select 1 from public.audit_log where entity = 'data_packs' and action = 'publish'
                               and actor = admin_id and details -> 'row' ->> 'route_id' = rt
                               and details -> 'row' ->> 'carrier' = c and (details -> 'row' ->> 'version')::int = v0 + 1),
                     'e2e admin: publish audited with the admin as actor');

  -- seeded 'new' report without route_id: attached to the nearest route
  if nc_test.getv('e2e_sub_seed') is not null then
    rev := public.admin_review_submission(nc_test.getv('e2e_sub_seed'), 'approved', null);
    perform nc_test.ok((select status = 'pending' and source = 'community'
                               and route_id is not distinct from nullif(nc_test.getv('e2e_sub_seed_route'), '')
                        from public.facilities where id = rev ->> 'facility_id'),
                       'e2e admin: seeded report ' || nc_test.getv('e2e_sub_seed') || ' -> pending facility on route '
                       || coalesce(nullif(nc_test.getv('e2e_sub_seed_route'), ''), '(none)'));
  end if;

  -- 'closed' report of a verified facility: back to pending, out of the live pack
  select s.id, s.facility_id, f2.route_id into cs
  from public.facility_submissions s join public.facilities f2 on f2.id = s.facility_id
  where s.kind = 'closed' and s.status = 'pending' and f2.status = 'verified' and f2.route_id is not null
  order by s.created_at, s.id limit 1;
  if found then
    rev := public.admin_review_submission(cs.id, 'approved', 'Đã xác nhận đóng cửa');
    perform nc_test.ok((select status = 'pending' and notes like '%Báo đóng cửa (#' || cs.id || '): Đã xác nhận đóng cửa%'
                        from public.facilities where id = cs.facility_id),
                       'e2e admin: approved "closed" report -> facility ' || cs.facility_id || ' back to pending');
    perform nc_test.ok(not (public.build_data_pack(cs.route_id, 'viettel') -> 'facilities'
                              @> jsonb_build_array(jsonb_build_object('id', cs.facility_id))),
                       'e2e admin: ... and out of the live pack (devices get it at the next publish)');
  end if;

  -- 'correction' rejected: facility untouched
  select s.id, s.facility_id into cs from public.facility_submissions s
  where s.kind = 'correction' and s.status = 'pending' and s.facility_id is not null
  order by s.created_at, s.id limit 1;
  if found then
    v_before := (select notes from public.facilities where id = cs.facility_id);
    rev := public.admin_review_submission(cs.id, 'rejected', 'Không đủ căn cứ');
    perform nc_test.ok(rev ->> 'status' = 'rejected'
                       and (select notes from public.facilities where id = cs.facility_id) is not distinct from v_before
                       and (select review_note from public.facility_submissions where id = cs.id) = 'Không đủ căn cứ',
                       'e2e admin: rejected correction leaves the facility untouched');
  end if;
  begin
    perform public.admin_review_submission(sub, 'maybe', null);
    perform nc_test.ok(false, 'e2e admin: unknown review status -> invalid_status');
  exception when sqlstate '22023' then
    perform nc_test.ok(sqlerrm = 'invalid_status', 'e2e admin: unknown review status -> invalid_status');
  end;
end $$;

-- the direct reads of the dashboard (assets/js/services/backend-supabase.js), same
-- relations / columns / filters / order as the PostgREST calls, through RLS
do $$
declare
  seeded boolean := nc_test.getv('expected') is not null;
  c      jsonb;
begin
  c := jsonb_build_object(
    'admin_users', (select count(*) from public.admin_users where user_id = '00000000-0000-4000-8000-00000000a001'
                      and role is not null and display_name is not null),
    'v_facilities', (select count(*) from (select * from public.v_facilities
                       where route_id is not null and status = 'verified' and type is not null and is_stale in (true, false)
                         and (name ilike '%a%' or address ilike '%a%' or id ilike '%a%') order by route_id, name) q),
    'v_services', (select count(*) from (select * from public.v_services where route_id is not null and type is not null
                     and lat is not null order by route_id, name) q),
    'facility_submissions', (select count(*) from (select * from public.facility_submissions where status is not null
                               order by created_at desc) q),
    'v_signal_samples', (select count(*) from (select * from public.v_signal_samples where route_id is not null
                           and carrier is not null and status is not null and source is not null and lat is not null
                           order by measured_at desc, id desc) q),
    'signal_segments', (select count(*) from (select * from public.signal_segments where route_id is not null
                          and carrier is not null order by edge_id, seq) q),
    'route_accuracy', (select count(*) from public.route_accuracy),
    'v_buddy_sessions', (select count(*) from (select * from public.v_buddy_sessions where status is not null
                           order by started_at desc) q),
    'checkin_events', (select count(*) from (select * from public.checkin_events where session_id is not null
                         order by client_ts nulls last, received_at) q),
    'data_packs', (select count(*) from (select id, route_id, carrier, version, published_at, published_by, notes,
                     size_bytes, checksum, is_current from public.data_packs order by published_at desc, version desc) q),
    'content_releases', (select count(*) from public.content_releases),
    'audit_log', (select count(*) from (select * from public.audit_log order by created_at desc, id desc) q));
  perform nc_test.ok(not seeded or not exists (select 1 from jsonb_each(c) where value::int = 0),
                     'e2e admin: dashboard reads of backend-supabase.js run under RLS' || nc_test.why(c::text));
end $$;
reset role;
do $$ begin perform nc_test.noclaims(); end $$;

-- the same admin RPCs refuse a signed-in non-admin
set role authenticated;
do $$ begin perform nc_test.claims('authenticated', '00000000-0000-4000-8000-00000000b002'); end $$;
do $$
declare
  q text;
begin
  foreach q in array array[
    format('select public.admin_publish_pack(%L, %L, null)', nc_test.getv('e2e_rt'), 'viettel'),
    format('select public.admin_review_submission(%L, %L, null)', nc_test.getv('e2e_sub'), 'rejected'),
    format('select public.admin_resolve_session(%L::uuid, null)', nc_test.getv('e2e_sid2')),
    format('select public.admin_pack_changes(%L, %L)', nc_test.getv('e2e_rt'), 'viettel')] loop
    begin
      execute q;
      perform nc_test.ok(false, 'e2e admin: non-admin refused: ' || split_part(q, '(', 1));
    exception when insufficient_privilege then
      perform nc_test.ok(true, 'e2e admin: non-admin refused: ' || split_part(q, '(', 1));
    end;
  end loop;
end $$;
reset role;
do $$ begin perform nc_test.noclaims(); end $$;

-- ======================================================= 9. realtime & cron
\if :with_fakes
\echo '== realtime publication & cron jobs'
do $$ begin
  perform nc_test.ok((select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
                       and tablename in ('buddy_sessions','checkin_events','facility_submissions','facilities','signal_samples')) = 5,
                     'realtime publication has the 5 dashboard tables');
  perform nc_test.ok((select count(*) from pg_publication_tables where pubname = 'supabase_realtime'
                       and tablename in ('data_packs','content_releases','services','audit_log')) = 4,
                     'realtime publication has data_packs, content_releases, services, audit_log');
  perform nc_test.ok((select not ('payload' = any (attnames)) and 'version' = any (attnames) and 'is_current' = any (attnames)
                      from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'data_packs'),
                     'data_packs is published without its payload column');
  perform nc_test.ok(exists (select 1 from cron.job where jobname = 'nomadcare-deadman' and schedule = '* * * * *'
                             and command like '%nc_deadman_tick%'), 'pg_cron job nomadcare-deadman every minute');
end $$;
\endif

-- ========================================== 10. hardening (20260928000100)
-- Recipient phone required / e-mail optional (20260930000100), name cleaning, abuse limits, SOS alert_reason,
-- buddy.update, device.erase, retention, manual-alert attribution, admin data
-- quality (re-approval, dates, bounding box, sample audit, pack changes).
\echo '== hardening: phone required / e-mail optional, names, limits, SOS reason, buddy.update, device.erase, retention, admin checks'
do $$ begin
  perform nc_test.ok(app_private.clean_name('  Minh   Anh  ') = 'Minh Anh', 'clean_name collapses spaces');
  perform nc_test.ok(app_private.clean_name(E'Anna\n\tBell http://evil.example.org/x www.phish.io bob@evil.com verify-at evil.example.org now')
                     = 'Anna Bell verify-at now',
                     'clean_name strips control characters, URLs, www., e-mail addresses and domains');
  perform nc_test.ok(app_private.clean_name('Dr.Smith Nguyễn Văn') = 'Dr.Smith Nguyễn Văn', 'clean_name keeps dotted names that are not domains');
  perform nc_test.ok(char_length(app_private.clean_name(repeat('Ă', 100))) = 60 and app_private.clean_name('https://x.co') is null,
                     'clean_name caps at 60 characters; a URL-only name becomes null');
  perform nc_test.ok(app_private.is_reserved_email('a@example.com') and app_private.is_reserved_email('b@sub.example.org')
                     and app_private.is_reserved_email('c@demo.test') and not app_private.is_reserved_email('d@gmail.com')
                     and not app_private.is_reserved_email('e@notexample.com'),
                     'is_reserved_email = the Edge Function''s demo domains');
end $$;

-- buddy.start (20260930000100, round 2 R7): phone required (E.164), e-mail
-- optional but valid, names cleaned, 24 h cap, per-device limit
do $$
declare
  reg jsonb := public.register_device('viettel', 'hardening');
  dev uuid := (reg ->> 'device_id')::uuid;
  sec text := reg ->> 'secret';
  sid uuid := gen_random_uuid();
  res jsonb;
  s   buddy_sessions%rowtype;
  i   int;
begin
  res := public.sync_device_ops(dev, sec, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start', 'data', jsonb_build_object(
      'traveler_name', 'No phone', 'recipient', jsonb_build_object('name', 'Lê Hà', 'email', 'le.ha@example.com'), 'interval_min', 2)),
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start', 'data', jsonb_build_object(
      'recipient_email', 'le.ha@example.com', 'recipient_phone', '12345')),
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start', 'data', jsonb_build_object(
      'recipient_phone', '+84 912 345 678', 'recipient_email', 'not an email')),
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start', 'data', jsonb_build_object(
      'recipient', jsonb_build_object('phone', '024 3826 4444', 'email', 't@example.com')))));
  perform nc_test.ok(res -> 'results' -> 0 ->> 'error' = 'recipient_phone_required' and res -> 'results' -> 0 ->> 'code' = '22023'
                     and not (res -> 'results' -> 0 ->> 'retryable')::boolean
                     and res -> 'results' -> 1 ->> 'error' = 'recipient_phone_invalid'
                     and not (res -> 'results' -> 1 ->> 'retryable')::boolean
                     and res -> 'results' -> 2 ->> 'error' = 'recipient_email_invalid'
                     and not (res -> 'results' -> 2 ->> 'retryable')::boolean
                     and res -> 'results' -> 3 ->> 'error' = 'recipient_phone_not_mobile' and res -> 'results' -> 3 ->> 'code' = '22023'
                     and not (res -> 'results' -> 3 ->> 'retryable')::boolean,
                     'buddy.start: no phone -> recipient_phone_required, bad phone -> recipient_phone_invalid, bad e-mail -> recipient_email_invalid, 02x landline -> recipient_phone_not_mobile (not retryable)');
  perform nc_test.ok(not exists (select 1 from buddy_sessions where device_id = dev), 'a refused start stores nothing');

  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start',
    'data', jsonb_build_object('id', sid, 'traveler_name', 'Lan http://evil.example.org Trần ' || repeat('x', 80),
      'recipient', jsonb_build_object('name', 'Mẹ www.x.com', 'email', 'QA-Limit@Gmail.com', 'phone', '0912 345 678'),
      'started_at', '2020-01-01T00:00:00Z', 'interval_min', 60))));
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(res -> 'results' -> 0 ->> 'status' = 'ok'
                     and res -> 'results' -> 0 -> 'data' -> 'warnings' ? 'traveler_name_sanitized'
                     and s.traveler_name like 'Lan Trần x%' and char_length(s.traveler_name) = 60
                     and s.recipient_name = 'Mẹ' and s.recipient_email = 'qa-limit@gmail.com'
                     and s.recipient_phone = '+84912345678',
                     'traveller / recipient names cleaned (URLs stripped, ≤ 60 chars), phone stored as E.164; warning returned');
  perform nc_test.ok(s.started_at >= now() - interval '24 hours 1 second' and s.started_at <= now() - interval '23 hours 59 minutes',
                     'a start backdated to 2020 is capped to 24 h ago');
  for i in 1..4 loop
    res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start',
      'data', jsonb_build_object('recipient_email', 'qa-limit' || i || '@gmail.com', 'recipient_phone', '+84 000 000 013', 'interval_min', 60))));
    perform nc_test.ok(res -> 'results' -> 0 ->> 'status' = 'ok', 'new session ' || (i + 1) || '/5 of a device in 24 h accepted');
  end loop;
  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start',
    'data', jsonb_build_object('recipient_email', 'qa-limit9@gmail.com', 'recipient_phone', '+84 000 000 013'))));
  perform nc_test.ok(res -> 'results' -> 0 ->> 'error' = 'rate_limited' and res -> 'results' -> 0 ->> 'code' = '54000'
                     and not (res -> 'results' -> 0 ->> 'retryable')::boolean
                     and (select count(*) from buddy_sessions where device_id = dev) = 5,
                     '6th new session of a device in 24 h -> rate_limited (not retryable: a late start would already be overdue), nothing stored');
  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start',
    'data', jsonb_build_object('id', gen_random_uuid(), 'recipient_email', 'friend@example.com', 'recipient_phone', '+84 000 000 014', 'interval_min', 60))));
  perform nc_test.ok(res -> 'results' -> 0 ->> 'status' = 'ok', 'demo recipients (reserved domains) are not limited');
  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start',
    'data', jsonb_build_object('id', gen_random_uuid(), 'recipient_phone', '+84 987 654 321', 'interval_min', 60))));
  perform nc_test.ok(res -> 'results' -> 0 ->> 'status' = 'ok' and res -> 'session' ->> 'recipient_email' is null
                     and res -> 'session' ->> 'recipient_phone' = '+84987654321',
                     'a phone-only start (no e-mail) is not held back by the e-mail start limit');
  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start',
    'data', jsonb_build_object('id', gen_random_uuid(), 'recipient_email', 'qa-limit9@gmail.com', 'recipient_phone', '+84 000 000 013'))));
  perform nc_test.ok(res -> 'results' -> 0 ->> 'error' = 'rate_limited',
                     'phone-only and demo sessions are not counted: a 6th real mailbox is still limited');
  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start',
    'data', jsonb_build_object('id', sid, 'recipient_email', 'qa-limit@gmail.com', 'interval_min', 45))));
  perform nc_test.ok(res -> 'results' -> 0 ->> 'status' = 'ok' and (select status from buddy_sessions where id = sid) = 'closed'
                     and res -> 'session' ->> 'recipient_phone' = '+84987654321' and res -> 'session' ->> 'status' = 'active',
                     'late re-send of a closed session: not limited, does not reopen it or close its successor');
  perform nc_test.ok((select recipient_phone = '+84912345678' and interval_min = 45 from buddy_sessions where id = sid),
                     'a re-sent start without a phone (legacy client) keeps the stored phone');
end $$;

-- recipient phone → E.164 (app_private.norm_phone). Same table as the
-- 'normPhone' test in tools/tests/data.test.js: keep both in sync.
do $$
declare
  r   record;
  bad text := '';
  n   int := 0;
begin
  for r in select * from (values
      ('+84 912 345 678', '+84912345678'), ('0912 345 678', '+84912345678'), ('0912-345-678', '+84912345678'),
      ('(+84) 912.345.678', '+84912345678'), ('+84 (0) 912 345 678', '+84912345678'), ('+84 0912 345 678', '+84912345678'),
      ('0084 912 345 678', '+84912345678'), ('0912345678', '+84912345678'), ('+84912345678', '+84912345678'),
      ('+84' || chr(160) || '912' || chr(160) || '345' || chr(160) || '678', '+84912345678'),
      ('+84 000 000 001', '+84000000001'), ('+84000000001', '+84000000001'), ('0 000 000 012', null),
      ('024 3826 4444', '+842438264444'), ('+84 24 3826 4444', '+842438264444'),
      ('+1 (415) 555-2671', '+14155552671'), ('+44 20 7946 0958', '+442079460958'), ('0049 30 123456', '+4930123456'),
      ('+84 912 345 6789', null), ('912345678', null), ('84912345678', null), ('+84 123 456 789', null),
      ('0123 456 789', null), ('+84 912 345', null), ('abc', null), ('+84 912 345 678 ext 5', null), ('', null),
      ('   ', null), ('+0 123 4567 890', null), ('+123 4567', null), ('+1234567890123456', null),
      ('++84 912 345 678', null), ('+84 000 000 123', null), ('+84 912 345 678 +1', null), (null, null)
    ) as x(raw, want)
  loop
    n := n + 1;
    if app_private.norm_phone(r.raw) is distinct from r.want then
      bad := bad || coalesce(r.raw, 'null') || ' -> ' || coalesce(app_private.norm_phone(r.raw), 'null') || '; ';
    end if;
  end loop;
  perform nc_test.ok(bad = '', 'norm_phone: ' || n || ' cases (VN national / +84 / 00 / international / demo / invalid) ' || bad);
  perform nc_test.ok(app_private.valid_phone('+84 912 345 678') and not app_private.valid_phone('12345')
                     and not app_private.valid_phone(null), 'valid_phone');
end $$;

-- 20261002000100: Vietnamese mobiles valid, 02x landlines flagged (and not valid),
-- international / demo valid. Same table as 'PHONE_KIND_CASES' in
-- tools/tests/data.test.js (normPhone().valid / .landline): keep both in sync.
do $$
declare
  r   record;
  bad text := '';
  n   int := 0;
begin
  for r in select * from (values
      ('0312 345 678', true, false), ('0562 345 678', true, false), ('0701 234 567', true, false), ('0812 345 678', true, false),
      ('0987 654 321', true, false), ('+84 326 789 012', true, false), ('0084 912 345 678', true, false), ('+84 (0) 912 345 678', true, false),
      ('024 3826 4444', false, true), ('028 3829 5555', false, true), ('0203 3825 111', false, true), ('+84 24 3826 4444', false, true),
      ('0084 28 3829 5555', false, true), ('+84 (0) 24 3826 4444', false, true), ('+842438264444', false, true),
      ('+84 000 000 001', true, false), ('+44 20 7946 0958', true, false), ('+1 (415) 555-2671', true, false), ('0049 30 123456', true, false),
      ('024 382 6444', false, false), ('0123 456 789', false, false), ('12345', false, false), ('', false, false), (null, false, false)
    ) as x(raw, valid, landline)
  loop
    n := n + 1;
    if app_private.valid_phone(r.raw) is distinct from r.valid or app_private.phone_is_landline(r.raw) is distinct from r.landline then
      bad := bad || coalesce(r.raw, 'null') || ' -> ' || coalesce(app_private.valid_phone(r.raw)::text, 'null') || '/'
             || coalesce(app_private.phone_is_landline(r.raw)::text, 'null') || '; ';
    end if;
  end loop;
  perform nc_test.ok(bad = '', 'valid_phone / phone_is_landline: ' || n || ' cases (VN mobiles 03x-09x, 02x landlines, international, demo, invalid) ' || bad);
  perform nc_test.ok(app_private.norm_phone('024 3826 4444') = '+842438264444',
                     'norm_phone still normalises a landline (a stored legacy value keeps its E.164 form)');
end $$;

-- 20261002000100: buddy.start of a new session with a 02x landline is refused
-- (recipient_phone_not_mobile, before the start limit; a bad e-mail is reported
-- first), mobile / international / demo accepted; a legacy open session that
-- stored a landline keeps working (re-sent start keeps it, check-ins accepted).
-- Same flow as the 20261002000100 buddy.start test in tools/tests/data.test.js.
do $$
declare
  reg jsonb := public.register_device('viettel', 'mobile-only');
  dev uuid := (reg ->> 'device_id')::uuid;
  sec text := reg ->> 'secret';
  leg uuid := gen_random_uuid();
  res jsonb;
  r   record;
  s   buddy_sessions%rowtype;
begin
  res := public.sync_device_ops(dev, sec, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start', 'data', jsonb_build_object(
      'recipient', jsonb_build_object('name', 'Mẹ', 'phone', '024 3826 4444'), 'interval_min', 60)),
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start', 'data', jsonb_build_object(
      'recipient_phone', '+84 28 3829 5555', 'recipient_email', 'real.person@gmail.com', 'interval_min', 60)),
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start', 'data', jsonb_build_object(
      'recipient', jsonb_build_object('phone', '0203 3825 111', 'email', 'not an email'), 'interval_min', 60))));
  perform nc_test.ok(res -> 'results' -> 0 ->> 'error' = 'recipient_phone_not_mobile' and res -> 'results' -> 0 ->> 'code' = '22023'
                     and not (res -> 'results' -> 0 ->> 'retryable')::boolean
                     and res -> 'results' -> 1 ->> 'error' = 'recipient_phone_not_mobile'
                     and res -> 'results' -> 2 ->> 'error' = 'recipient_email_invalid'
                     and not exists (select 1 from buddy_sessions where device_id = dev),
                     'buddy.start: 02x landline -> recipient_phone_not_mobile (22023, not retryable), bad e-mail reported first, nothing stored');
  for r in select * from (values ('0362 123 456', '+84362123456'), ('+44 20 7946 0958', '+442079460958'),
                                 ('+84 000 000 021', '+84000000021')) as x(raw, want)
  loop
    res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start',
      'data', jsonb_build_object('recipient', jsonb_build_object('name', 'Mẹ', 'phone', r.raw), 'interval_min', 60))));
    perform nc_test.ok(res -> 'results' -> 0 ->> 'status' = 'ok' and res -> 'session' ->> 'recipient_phone' = r.want,
                       'buddy.start accepts ' || r.raw || ' (stored ' || r.want || ')');
  end loop;
  -- a session created before 20261002000100 that stored a landline
  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start',
    'data', jsonb_build_object('id', leg, 'recipient_phone', '+84 000 000 032', 'interval_min', 60))));
  update buddy_sessions set recipient_phone = '+842438264444' where id = leg;
  res := public.sync_device_ops(dev, sec, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start', 'data', jsonb_build_object(
      'id', leg, 'recipient_phone', '024 3826 4444', 'interval_min', 90)),
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.checkin', 'data', jsonb_build_object('session_id', leg, 'kind', 'checkin'))));
  select * into s from buddy_sessions where id = leg;
  perform nc_test.ok(res -> 'results' -> 0 ->> 'status' = 'ok' and res -> 'results' -> 1 ->> 'status' = 'ok'
                     and s.status = 'active' and s.recipient_phone = '+842438264444' and s.interval_min = 90,
                     'legacy landline session: re-sent start keeps the stored phone, check-in accepted');
  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start',
    'data', jsonb_build_object('id', leg, 'recipient_phone', '028 3829 5555', 'interval_min', 60))));
  perform nc_test.ok(res -> 'results' -> 0 ->> 'status' = 'ok'
                     and (select recipient_phone from buddy_sessions where id = leg) = '+842438264444',
                     'a re-sent landline never replaces the stored phone');
end $$;

-- phone-only session (no e-mail): accepted, goes overdue, but the server never
-- claims an alert e-mail for it; an e-mail-only legacy session keeps working
do $$
declare
  reg jsonb := public.register_device('viettel', 'phone-only');
  dev uuid := (reg ->> 'device_id')::uuid;
  sec text := reg ->> 'secret';
  sid uuid := gen_random_uuid();
  leg uuid := gen_random_uuid();
  res jsonb;
  s   buddy_sessions%rowtype;
  i   int;
begin
  for i in 1..6 loop
    res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start',
      'data', jsonb_build_object('recipient', jsonb_build_object('name', 'Mẹ', 'phone', '0987 654 32' || i), 'interval_min', 60))));
    perform nc_test.ok(res -> 'results' -> 0 ->> 'status' = 'ok', 'phone-only session ' || i || '/6 of a device in 24 h accepted (never e-mailed, never limited)');
  end loop;
  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start',
    'data', jsonb_build_object('id', sid, 'traveler_name', 'Solo', 'recipient', jsonb_build_object('name', 'Mẹ', 'phone', '+84 912 000 111', 'email', '  '),
      'interval_min', 30, 'grace_min', 0, 'lat', 22.8, 'lng', 105.0))));
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(res -> 'results' -> 0 ->> 'status' = 'ok' and s.recipient_email is null and s.recipient_phone = '+84912000111'
                     and s.status = 'active' and res -> 'session' ->> 'recipient_phone' = '+84912000111',
                     'phone-only session stored (blank e-mail = no e-mail, phone as E.164) and echoed to the device');
  update buddy_sessions set next_due_at = now() - interval '20 minutes' where id = sid;
  perform public.nc_mark_overdue();
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(s.status = 'overdue' and not app_private.alert_due(s)
                     and jsonb_array_length(public.nc_alert_claim(sid)) = 0
                     and jsonb_array_length(public.nc_alert_claim(sid, 'overdue', true)) = 0,
                     'phone-only session goes overdue but no alert e-mail is ever claimed (cron or manual)');
  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.checkin',
    'data', jsonb_build_object('session_id', sid, 'kind', 'sos', 'lat', 22.81, 'lng', 105.01))));
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(res -> 'results' -> 0 ->> 'status' = 'ok' and s.alert_reason = 'sos' and not app_private.alert_due(s),
                     'SOS on a phone-only session is recorded (alert_reason sos), still no e-mail');
  -- legacy row (created before 20260930000100): e-mail, no phone
  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start',
    'data', jsonb_build_object('id', leg, 'recipient_email', 'legacy@example.com', 'recipient_phone', '+84 000 000 031', 'interval_min', 60))));
  update buddy_sessions set recipient_phone = null where id = leg;
  res := public.sync_device_ops(dev, sec, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start', 'data', jsonb_build_object(
      'id', leg, 'recipient_email', 'legacy@example.com', 'interval_min', 90)),
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.checkin', 'data', jsonb_build_object('session_id', leg, 'kind', 'checkin'))));
  select * into s from buddy_sessions where id = leg;
  perform nc_test.ok(res -> 'results' -> 0 ->> 'status' = 'ok' and res -> 'results' -> 1 ->> 'status' = 'ok'
                     and s.recipient_phone is null and s.recipient_email = 'legacy@example.com' and s.interval_min = 90,
                     'legacy e-mail-only session: re-sent start without a phone and check-ins keep working');
end $$;

-- SOS → alert_reason 'sos' (kept while alerted), check-in clears it, missed
-- check-in → 'overdue', SOS after an overdue alert (or crossing its e-mail)
-- re-alerts. Separate blocks = separate transactions (now() differs).
do $$
declare
  reg jsonb := public.register_device('viettel', 'hardening');
  dev uuid := (reg ->> 'device_id')::uuid;
  sec text := reg ->> 'secret';
  sid uuid := gen_random_uuid();
  res jsonb;
  c   jsonb;
  s   buddy_sessions%rowtype;
  op  jsonb := jsonb_build_object('session_id', sid, 'kind', 'sos', 'lat', 22.9, 'lng', 105.1);
begin
  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start',
    'data', jsonb_build_object('id', sid, 'traveler_name', 'SOS Sam', 'recipient', jsonb_build_object('email', 'sos@example.com', 'phone', '+84 000 000 015'),
      'interval_min', 60, 'grace_min', 5, 'share_public_medical', true, 'public_medical', jsonb_build_object('blood_type', 'B+')))));
  perform nc_test.ok((select alert_reason is null and public_medical ->> 'blood_type' = 'B+' from buddy_sessions where id = sid),
                     'active session: alert_reason null, consented medical layer stored');
  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.checkin', 'data', op)));
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(s.status = 'overdue' and s.alert_reason = 'sos' and res -> 'session' ->> 'alert_reason' = 'sos'
                     and res -> 'results' -> 0 -> 'data' ->> 'alert_reason' = 'sos',
                     'SOS -> overdue + alert_reason sos (op result and session JSON)');
  perform nc_test.ok((select alert_reason = 'sos' and sos_at is not null from v_buddy_sessions where id = sid),
                     'v_buddy_sessions exposes alert_reason and sos_at');
  c := public.nc_alert_claim(sid);
  perform nc_test.ok(jsonb_array_length(c) = 1 and c -> 0 ->> 'reason' = 'sos' and c -> 0 ->> 'alert_reason' = 'sos'
                     and c -> 0 ->> 'sos_at' is not null, 'the claimed SOS payload is worded as SOS');
  perform public.nc_alert_result(sid, true, 'overdue', 'resend', 'em_sos_1', null, 'cron', null, 'sos');
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(s.status = 'alerted' and s.alert_reason = 'sos'
                     and exists (select 1 from checkin_events where session_id = sid and kind = 'alert_sent' and meta ->> 'reason' = 'sos'),
                     'SOS e-mail sent -> alerted, alert_reason stays sos (dashboard keeps showing SOS)');
  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.checkin', 'data', op)));
  perform nc_test.ok((select status = 'alerted' from buddy_sessions where id = sid), 'a second SOS after the SOS e-mail does not e-mail again');
  perform nc_test.setv('sos_dev', dev::text);
  perform nc_test.setv('sos_sec', sec);
  perform nc_test.setv('sos_sid', sid::text);
end $$;
do $$
declare
  sid uuid := nc_test.getv('sos_sid')::uuid;
  res jsonb;
  c   jsonb;
begin
  res := public.sync_device_ops(nc_test.getv('sos_dev')::uuid, nc_test.getv('sos_sec'), jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'op', 'buddy.checkin', 'data', jsonb_build_object('session_id', sid, 'kind', 'checkin'))));
  perform nc_test.ok((select status = 'active' and alert_reason is null from buddy_sessions where id = sid), 'check-in -> active, alert_reason null');
  update buddy_sessions set next_due_at = now() - interval '30 minutes' where id = sid;
  perform public.nc_mark_overdue();
  perform nc_test.ok((select status = 'overdue' and alert_reason = 'overdue' from buddy_sessions where id = sid),
                     'missed check-in -> alert_reason overdue');
  c := public.nc_alert_claim(sid);
  perform nc_test.ok(c -> 0 ->> 'reason' = 'overdue', 'missed check-in payload is worded as overdue');
end $$;
do $$
declare
  sid uuid := nc_test.getv('sos_sid')::uuid;
  dev uuid := nc_test.getv('sos_dev')::uuid;
  sec text := nc_test.getv('sos_sec');
  op  jsonb := jsonb_build_object('session_id', nc_test.getv('sos_sid')::uuid, 'kind', 'sos');
  res jsonb;
  c   jsonb;
  s   buddy_sessions%rowtype;
begin
  -- SOS arrives while the missed-check-in e-mail is on its way
  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.checkin', 'data', op)));
  perform public.nc_alert_result(sid, true, 'overdue', 'resend', 'em_o_1', null, 'cron', null, 'overdue');
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(s.status = 'overdue' and s.alert_reason = 'sos' and s.alerted_at is null and app_private.alert_due(s),
                     'an overdue e-mail that crossed an SOS keeps the session overdue: the SOS e-mail follows');
  c := public.nc_alert_claim(sid);
  perform public.nc_alert_result(sid, true, 'overdue', 'resend', 'em_sos_2', null, 'cron', null, c -> 0 ->> 'reason');
  perform nc_test.ok(c -> 0 ->> 'reason' = 'sos' and (select status from buddy_sessions where id = sid) = 'alerted',
                     '... and is sent as SOS');
  -- alerted for a missed check-in, then SOS → re-alert as SOS
  update buddy_sessions set alert_reason = 'overdue' where id = sid;
  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.checkin', 'data', op)));
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(s.status = 'overdue' and s.alert_reason = 'sos' and s.alerted_at is null,
                     'SOS after a missed-check-in alert -> overdue again with reason sos (new SOS e-mail)');
  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.stop',
    'data', jsonb_build_object('session_id', sid))));
  perform nc_test.ok((select status = 'closed' and public_medical is null and alert_reason is null and share_public_medical
                      from buddy_sessions where id = sid),
                     'buddy.stop -> closed; the consented medical layer is dropped at once');
end $$;

-- buddy.update: consent withdrawn / given again
do $$
declare
  reg jsonb := public.register_device('viettel', 'hardening');
  dev uuid := (reg ->> 'device_id')::uuid;
  sec text := reg ->> 'secret';
  sid uuid := gen_random_uuid();
  reg2 jsonb := public.register_device('viettel', 'hardening');
  res jsonb;
  n   int;
begin
  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start',
    'data', jsonb_build_object('id', sid, 'recipient_email', 'upd@example.com', 'recipient_phone', '+84 000 000 016', 'share_public_medical', true,
      'public_medical', jsonb_build_object('blood_type', 'O+', 'allergies', 'Penicillin')))));
  n := (select count(*) from checkin_events where session_id = sid);
  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.update',
    'data', jsonb_build_object('session_id', sid, 'share_public_medical', false,
      'public_medical', jsonb_build_object('blood_type', 'O+'), 'client_ts', now()))));
  perform nc_test.ok(res -> 'results' -> 0 ->> 'status' = 'ok' and not (res -> 'results' -> 0 -> 'data' ->> 'has_public_medical')::boolean
                     and (select not share_public_medical and public_medical is null from buddy_sessions where id = sid)
                     and (select count(*) from checkin_events where session_id = sid) = n
                     and not (res -> 'session' ->> 'share_public_medical')::boolean,
                     'buddy.update share=false -> medical layer removed at once, no event');
  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.update',
    'data', jsonb_build_object('session_id', sid, 'share_public_medical', true,
      'public_medical', jsonb_build_object('blood_type', 'A+', 'full_name', 'LEAK')))));
  perform nc_test.ok((select share_public_medical and public_medical ->> 'blood_type' = 'A+' and not (public_medical ? 'full_name')
                      from buddy_sessions where id = sid),
                     'buddy.update share=true -> only the sanitised public layer is stored');
  res := public.sync_device_ops((reg2 ->> 'device_id')::uuid, reg2 ->> 'secret', jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'op', 'buddy.update', 'data', jsonb_build_object('session_id', sid, 'share_public_medical', true))));
  perform nc_test.ok(res -> 'results' -> 0 ->> 'error' = 'session_forbidden', 'buddy.update of another device''s session is refused');
  perform public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.stop',
    'data', jsonb_build_object('session_id', sid))));
  res := public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.update',
    'data', jsonb_build_object('session_id', sid, 'share_public_medical', true, 'public_medical', jsonb_build_object('blood_type', 'A+')))));
  perform nc_test.ok(res -> 'results' -> 0 -> 'data' ->> 'ignored' = 'session_closed'
                     and (select public_medical is null from buddy_sessions where id = sid),
                     'buddy.update on a closed session is ignored');
end $$;

-- alert e-mail quota per recipient (3 / 24 h) + hourly global cap
do $$
declare
  i   int;
  reg jsonb;
  sid uuid;
  ids text := '';
begin
  for i in 1..4 loop
    reg := public.register_device('viettel', 'hardening');
    sid := gen_random_uuid();
    perform public.sync_device_ops((reg ->> 'device_id')::uuid, reg ->> 'secret', jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'op', 'buddy.start', 'data', jsonb_build_object(
        'id', sid, 'traveler_name', 'Victim ' || i, 'recipient_email', 'QA-Victim@Gmail.com', 'recipient_phone', '+84 000 000 017',
        'interval_min', 30, 'grace_min', 0))));
    ids := ids || case when ids = '' then '' else ',' end || sid::text;
  end loop;
  update buddy_sessions set next_due_at = now() - interval '5 minutes' where id = any (string_to_array(ids, ',')::uuid[]);
  perform public.nc_mark_overdue();
  perform nc_test.setv('victims', ids);
end $$;
set role service_role;
do $$ begin perform nc_test.claims('service_role'); end $$;
do $$
declare
  ids  uuid[] := string_to_array(nc_test.getv('victims'), ',')::uuid[];
  c    jsonb;
  itm  jsonb;
  lim  uuid;
  s    buddy_sessions%rowtype;
begin
  c := public.nc_alert_claim();
  perform nc_test.ok((select count(*) from jsonb_array_elements(c) x where (x ->> 'id')::uuid = any (ids)) = 3,
                     'at most 3 alert e-mails per recipient: 3 of the 4 sessions claimed');
  perform nc_test.ok((select count(*) from checkin_events where session_id = any (ids) and kind = 'alert_failed'
                        and meta ->> 'reason' = 'rate_limited' and meta ->> 'limit' = 'recipient_24h') = 1,
                     'the 4th session gets one alert_failed {reason: rate_limited}');
  for itm in select value from jsonb_array_elements(c) where (value ->> 'id')::uuid = any (ids) loop
    perform public.nc_alert_result((itm ->> 'id')::uuid, true, 'overdue', 'resend', 'em_v', null, 'cron', null, itm ->> 'reason');
  end loop;
  select id into lim from buddy_sessions where id = any (ids) and status = 'overdue';
  c := public.nc_alert_claim();
  perform public.nc_dispatch_alerts();
  select * into s from buddy_sessions where id = lim;
  perform nc_test.ok(lim is not null and not exists (select 1 from jsonb_array_elements(c) x where (x ->> 'id')::uuid = lim)
                     and s.status = 'overdue' and not app_private.alert_due(s) and app_private.alert_backoff_ok(lim)
                     and (select count(*) from checkin_events where session_id = lim and kind = 'alert_failed'
                            and meta ->> 'reason' = 'rate_limited') = 1,
                     'quota used: no further claim, still overdue, one marker per episode, no send backoff');
  perform nc_test.setv('victim_limited', lim::text);
  c := public.nc_alert_claim(lim, 'overdue', true, 25, '00000000-0000-4000-8000-00000000a001');
  perform nc_test.ok(jsonb_array_length(c) = 1, 'a manual (admin) alert is never rate-limited');
  perform public.nc_alert_result(lim, true, 'overdue', 'resend', 'em_manual', null, 'manual',
                                 '00000000-0000-4000-8000-00000000a001', c -> 0 ->> 'reason');
  perform nc_test.ok(exists (select 1 from audit_log where entity = 'buddy_sessions' and entity_id = lim::text
                               and details ->> 'to' = 'alerted' and actor = '00000000-0000-4000-8000-00000000a001'
                               and actor_label = 'Test Admin')
                     and exists (select 1 from checkin_events where session_id = lim and kind = 'alert_sent'
                                   and meta ->> 'trigger' = 'manual' and meta ->> 'actor' = 'Test Admin'),
                     'a manual alert is audited with the admin who sent it (not "system")');
end $$;
reset role;
do $$ begin perform nc_test.noclaims(); end $$;
do $$ begin
  insert into app_private.settings (key, value) values ('limit_alert_global_1h', '0')
  on conflict (key) do update set value = excluded.value;
  perform nc_test.ok(app_private.alert_quota_block('someone-new@gmail.com') = 'global_1h'
                     and app_private.alert_quota_block('demo@example.com') is null,
                     'hourly global cap (app_private.settings override); demo recipients exempt');
  delete from app_private.settings where key = 'limit_alert_global_1h';
  perform nc_test.ok(app_private.alert_quota_block('someone-new@gmail.com') is null, 'default caps apply again');
end $$;

-- register_device: per client IP (request.headers) throttle, IP stored only as a salted hash
do $$
declare dummy jsonb;
begin
  insert into app_private.settings (key, value) values ('limit_register_ip_1h', '2')
  on conflict (key) do update set value = excluded.value;
  perform set_config('request.headers', '{"x-forwarded-for": "203.0.113.9, 10.0.0.1"}', true);
  dummy := public.register_device('viettel', 'ip-test');
  dummy := public.register_device('viettel', 'ip-test');
  begin
    dummy := public.register_device('viettel', 'ip-test');
    perform nc_test.ok(false, 'register_device over the per-IP limit -> rate_limited');
  exception when sqlstate '54000' then
    perform nc_test.ok(sqlerrm = 'rate_limited', 'register_device over the per-IP limit -> rate_limited');
  end;
  perform set_config('request.headers', '{"cf-connecting-ip": "198.51.100.7"}', true);
  perform nc_test.ok(public.register_device('viettel', 'ip-test') ? 'device_id', 'another client IP can still register');
  perform nc_test.ok((select count(*) from devices where app_version = 'ip-test' and reg_ip_hash ~ '^[0-9a-f]{64}$') = 3,
                     'only a salted sha256 of the IP is stored');
  perform set_config('request.headers', '', true);
  perform nc_test.ok(public.register_device('viettel', 'no-ip') ? 'device_id', 'no request headers (SQL editor, cron): no IP limit');
  delete from app_private.settings where key = 'limit_register_ip_1h';
end $$;

-- device.erase: everything of the device goes; tombstone replays are no-ops
do $$
declare
  reg jsonb := public.register_device('viettel', 'hardening');
  dev uuid := (reg ->> 'device_id')::uuid;
  sec text := reg ->> 'secret';
  sid uuid := gen_random_uuid();
  sub text := 'erase-' || gen_random_uuid()::text;
begin
  perform public.sync_device_ops(dev, sec, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.start', 'data', jsonb_build_object(
      'id', sid, 'traveler_name', 'Erase Me', 'recipient_email', 'erase@example.com', 'recipient_phone', '+84 000 000 018', 'interval_min', 30,
      'share_public_medical', true, 'public_medical', jsonb_build_object('blood_type', 'O+'))),
    jsonb_build_object('id', gen_random_uuid(), 'op', 'report.submit', 'data', jsonb_build_object(
      'id', sub, 'kind', 'new', 'lat', 22.9, 'lng', 105.1, 'payload', jsonb_build_object('name', 'Erase report')))));
  update buddy_sessions set next_due_at = now() - interval '40 minutes' where id = sid;
  perform public.nc_mark_overdue();
  perform public.nc_alert_claim(sid);
  perform public.nc_alert_result(sid, true, 'overdue', 'resend', 'em_erase', null, 'cron', null, 'overdue');
  perform nc_test.ok((select status from buddy_sessions where id = sid) = 'alerted'
                     and exists (select 1 from audit_log where entity = 'facility_submissions' and entity_id = sub
                                   and details -> 'row' ->> 'device_id' = dev::text),
                     'erase fixture: alerted session + community report of the device');
  perform nc_test.setv('erase_dev', dev::text);
  perform nc_test.setv('erase_sec', sec);
  perform nc_test.setv('erase_sid', sid::text);
  perform nc_test.setv('erase_sub', sub);
end $$;
\if :with_fakes
delete from net.http_request_log;
\endif
do $$
declare
  dev uuid := nc_test.getv('erase_dev')::uuid;
  sec text := nc_test.getv('erase_sec');
  sid uuid := nc_test.getv('erase_sid')::uuid;
  res jsonb;
  reg jsonb := public.register_device('viettel', 'hardening');
begin
  res := public.sync_device_ops(dev, sec, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.stop', 'data', jsonb_build_object('session_id', sid)),
    jsonb_build_object('id', gen_random_uuid(), 'op', 'device.erase', 'data', jsonb_build_object('client_ts', now())),
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.checkin', 'data', jsonb_build_object('session_id', sid))));
  perform nc_test.ok(res -> 'results' -> 0 ->> 'status' = 'ok'
                     and res -> 'results' -> 1 ->> 'status' = 'ok' and (res -> 'results' -> 1 -> 'data' ->> 'erased')::boolean
                     and (res -> 'results' -> 1 -> 'data' ->> 'sessions_deleted')::int = 1
                     and (res -> 'results' -> 1 -> 'data' ->> 'submissions_unlinked')::int = 1
                     and res -> 'results' -> 2 ->> 'error' = 'device_erased'
                     and not (res -> 'results' -> 2 ->> 'retryable')::boolean
                     and res -> 'session' = 'null'::jsonb,
                     'device.erase: {erased:true}; later ops of the batch -> device_erased; no session');
  perform nc_test.ok(not exists (select 1 from devices where id = dev) and not exists (select 1 from device_ops where device_id = dev)
                     and not exists (select 1 from buddy_sessions where device_id = dev or id = sid)
                     and not exists (select 1 from checkin_events where session_id = sid or device_id = dev),
                     'device.erase deletes the device, its ops, sessions and events');
  perform nc_test.ok(exists (select 1 from facility_submissions where id = nc_test.getv('erase_sub') and device_id is null)
                     and not exists (select 1 from audit_log where details::text like '%' || dev::text || '%'),
                     'community reports are kept but unlinked; the device id is gone from the audit trail');
  res := public.sync_device_ops(dev, sec, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.stop', 'data', jsonb_build_object('session_id', sid)),
    jsonb_build_object('id', gen_random_uuid(), 'op', 'device.erase', 'data', '{}'::jsonb)));
  perform nc_test.ok(res -> 'results' -> 1 ->> 'status' = 'ok' and (res -> 'results' -> 1 -> 'data' ->> 'already_erased')::boolean
                     and res -> 'results' -> 0 ->> 'error' = 'device_erased',
                     'tombstone replay for an erased device -> device.erase ok (idempotent), other ops device_erased');
  perform nc_test.ok(public.sync_device_ops(gen_random_uuid(), 'anything', jsonb_build_array(jsonb_build_object(
                       'id', gen_random_uuid(), 'op', 'device.erase'))) -> 'results' -> 0 ->> 'status' = 'ok',
                     'device.erase for an unknown device id is a no-op success');
  begin
    perform public.sync_device_ops(dev, sec, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'op', 'buddy.checkin')));
    perform nc_test.ok(false, 'an erased device cannot sync anything else');
  exception when sqlstate '28000' then
    perform nc_test.ok(true, 'an erased device cannot sync anything else');
  end;
  begin
    perform public.sync_device_ops((reg ->> 'device_id')::uuid, 'wrong', jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'op', 'device.erase')));
    perform nc_test.ok(false, 'device.erase of an existing device needs its secret');
  exception when sqlstate '28000' then
    perform nc_test.ok(exists (select 1 from devices where id = (reg ->> 'device_id')::uuid),
                       'device.erase of an existing device needs its secret');
  end;
end $$;
\if :with_fakes
do $$ begin
  perform nc_test.ok(exists (select 1 from net.http_request_log where body ->> 'type' = 'resolved' and body ->> 'source' = 'erase'
                               and body -> 'inline' ->> 'recipient_email' = 'erase@example.com'
                               and body -> 'inline' ->> 'reason' = 'resolved'),
                     'the alerted recipient still gets the all-clear (inline payload: the row is gone)');
end $$;
\endif

-- retention (nc_cleanup)
do $$
declare
  reg    jsonb := public.register_device('viettel', 'retention');
  dev    uuid := (reg ->> 'device_id')::uuid;
  s_old  uuid := gen_random_uuid();
  s_new  uuid := gen_random_uuid();
  s_idle uuid := gen_random_uuid();
  r      jsonb;
begin
  insert into buddy_sessions (id, device_id, traveler_name, recipient_email, status, started_at, closed_at, updated_at) values
    (s_old,  dev, 'Old',    'old@example.com',  'closed', now() - interval '32 days',  now() - interval '31 days', now() - interval '31 days'),
    (s_new,  dev, 'Recent', 'new@example.com',  'closed', now() - interval '11 days',  now() - interval '10 days', now() - interval '10 days'),
    (s_idle, dev, 'Idle',   'idle@example.com', 'active', now() - interval '100 days', null,                        now() - interval '95 days');
  insert into checkin_events (session_id, device_id, kind) values (s_old, dev, 'start'), (s_old, dev, 'stop'), (s_idle, dev, 'start');
  update devices set created_at = now() - interval '2 days', reg_ip_hash = repeat('a', 64) where id = dev;
  r := public.nc_cleanup();
  perform nc_test.ok(not exists (select 1 from buddy_sessions where id in (s_old, s_idle))
                     and exists (select 1 from buddy_sessions where id = s_new)
                     and not exists (select 1 from checkin_events where session_id in (s_old, s_idle))
                     and (r ->> 'sessions_deleted')::int >= 2 and (r ->> 'events_deleted')::int >= 3,
                     'nc_cleanup: sessions closed > 30 days ago and idle > 90 days are deleted with their events');
  perform nc_test.ok((select reg_ip_hash is null from devices where id = dev), 'nc_cleanup clears registration IP hashes after 24 h');
end $$;

-- admin: re-approval, dates, bounding box, sample audit, pack changes
set role authenticated;
do $$ begin perform nc_test.claims('authenticated', '00000000-0000-4000-8000-00000000a001'); end $$;
do $$
declare
  admin_id uuid := '00000000-0000-4000-8000-00000000a001';
  rt   text := (select id from public.routes where is_active order by sort, id limit 1);
  sub  text := 'reopen-' || gen_random_uuid()::text;
  fac  text := (select id from public.facilities where status = 'verified' order by id limit 1);
  r1   jsonb;
  r2   jsonb;
  up   jsonb;
  ids  bigint[];
  n0   int;
  n1   int;
  ch   jsonb;
  pub  jsonb;
  f_closed text;
  f_deleted text;
  f_edited text;
  d    text;
begin
  insert into public.facility_submissions (id, kind, payload, lat, lng)
  values (sub, 'new', jsonb_build_object('name', 'Reopen test', 'type', 'tram_y_te', 'route_id', rt), 22.9, 105.1);
  r1 := public.admin_review_submission(sub, 'approved', 'ok');
  perform public.admin_review_submission(sub, 'pending', 'reopen');
  r2 := public.admin_review_submission(sub, 'approved', 'again');
  perform nc_test.ok(r1 ->> 'facility_id' = r2 ->> 'facility_id'
                     and (select count(*) from public.facilities where notes like '%#' || sub || '%') = 1,
                     'approve -> reopen -> approve reuses the facility (one facility per report)');
  delete from public.facilities where id = r1 ->> 'facility_id';
  perform public.admin_review_submission(sub, 'pending', null);
  r2 := public.admin_review_submission(sub, 'approved', null);
  perform nc_test.ok(r2 ->> 'facility_id' = r1 ->> 'facility_id'
                     and exists (select 1 from public.facilities where id = r1 ->> 'facility_id' and status = 'pending'),
                     're-approval after the facility was deleted recreates it under the same id');
  delete from public.facilities where id = r1 ->> 'facility_id';

  begin
    perform public.admin_upsert_facility(jsonb_build_object('id', fac, 'verified_at', '2031-01-01'));
    perform nc_test.ok(false, 'a verification date in the future -> invalid_date');
  exception when sqlstate '22023' then
    perform nc_test.ok(sqlerrm = 'invalid_date', 'a verification date in the future -> invalid_date');
  end;
  up := public.admin_upsert_facility(jsonb_build_object('name', 'Tomorrow (TZ)', 'type', 'tram_y_te',
                                                        'verified_at', (app_private.today_vn() + 1)::text));
  perform nc_test.ok(up ->> 'verified_at' is not null, 'one day of tolerance for admins ahead of Vietnam time');
  delete from public.facilities where id = up ->> 'id';
  begin
    perform public.admin_upsert_facility(jsonb_build_object(
      'name', 'QA zero', 'type', 'tram_y_te', 'route_id', rt, 'address', 'x', 'phone', '+84 000 000 099', 'open_hours', '24/7',
      'night_shift', true, 'trauma_capable', false, 'lat', 0, 'lng', 0, 'verified_by', 'QA',
      'verified_at', app_private.today_vn()::text, 'status', 'verified'));
    perform nc_test.ok(false, 'a verified facility at (0, 0) -> invalid_coordinates (outside_vietnam)');
  exception when sqlstate '22023' then
    get stacked diagnostics d = pg_exception_detail;
    perform nc_test.ok(sqlerrm = 'invalid_coordinates' and d = 'outside_vietnam',
                       'a verified facility at (0, 0) -> invalid_coordinates (outside_vietnam)');
  end;
  up := public.admin_upsert_facility(jsonb_build_object('name', 'QA zero pending', 'type', 'tram_y_te', 'lat', 0, 'lng', 0));
  perform nc_test.ok(up ->> 'status' = 'pending', 'a pending draft may still hold any coordinates');
  delete from public.facilities where id = up ->> 'id';

  select array_agg(id) into ids from (select id from public.signal_samples where status <> 'rejected' order by id limit 3) q;
  n0 := (select count(*) from public.audit_log where entity = 'signal_samples');
  n1 := public.admin_review_samples(ids, 'rejected');
  perform nc_test.ok(n1 = 3
                     and (select count(*) from public.audit_log where entity = 'signal_samples') = n0 + 1
                     and exists (select 1 from public.audit_log where entity = 'signal_samples' and entity_id = 'batch'
                                   and action = 'status' and (details ->> 'count')::int = 3 and details ->> 'status' = 'rejected'
                                   and jsonb_array_length(details -> 'ids') = 3 and actor = admin_id and actor_label = 'Test Admin'),
                     'admin_review_samples writes one aggregated audit row with the admin');
  n1 := public.admin_review_samples(ids, 'rejected');
  perform nc_test.ok(n1 = 0
                     and (select count(*) from public.audit_log where entity = 'signal_samples') = n0 + 1,
                     'the same review again changes nothing and writes no audit row');
  perform public.admin_review_samples(ids, 'approved');

  pub := public.admin_publish_pack(rt, 'viettel', 'baseline', true);
  ch := public.admin_pack_changes(rt, 'viettel');
  perform nc_test.ok(jsonb_array_length(ch) = 1 and not (ch -> 0 ->> 'changed')::boolean and (ch -> 0 ->> 'count')::int = 0
                     and (ch -> 0 ->> 'version')::int = (pub ->> 'version')::int and (ch -> 0 ->> 'published')::boolean,
                     'admin_pack_changes: nothing to publish right after a publish');
  select id into f_closed  from public.facilities where route_id = rt and status = 'verified' order by id limit 1;
  select id into f_deleted from public.facilities where route_id = rt and status = 'verified' order by id offset 1 limit 1;
  select id into f_edited  from public.facilities where route_id = rt and status = 'verified' order by id offset 2 limit 1;
  perform public.admin_upsert_facility(jsonb_build_object('id', f_closed, 'status', 'pending'));
  delete from public.facilities where id = f_deleted;
  perform public.admin_upsert_facility(jsonb_build_object('id', f_edited, 'open_hours', '06:00–22:00 (QA)'));
  ch := public.admin_pack_changes(rt, 'viettel');
  perform nc_test.ok((ch -> 0 ->> 'changed')::boolean and (ch -> 0 ->> 'count')::int = 3
                     and ch -> 0 -> 'facilities' -> 'removed' @> jsonb_build_array(jsonb_build_object('id', f_closed, 'reason', 'pending'))
                     and ch -> 0 -> 'facilities' -> 'removed' @> jsonb_build_array(jsonb_build_object('id', f_deleted, 'reason', 'deleted'))
                     and ch -> 0 -> 'facilities' -> 'updated' @> jsonb_build_array(jsonb_build_object('id', f_edited,
                                                                                    'fields', jsonb_build_array('open_hours'))),
                     'closures and deletions count as unpublished changes (with their reason), edits list the fields'
                     || nc_test.why((ch -> 0 -> 'facilities')::text));
  r1 := public.admin_publish_pack(rt, 'viettel', 'after closure');
  perform nc_test.ok(not (r1 ->> 'unchanged')::boolean and (r1 ->> 'version')::int = (pub ->> 'version')::int + 1
                     and not (public.get_data_pack(rt, 'viettel') -> 'facilities' @> jsonb_build_array(jsonb_build_object('id', f_closed)))
                     and not (public.admin_pack_changes(rt, 'viettel') -> 0 ->> 'changed')::boolean,
                     'publishing takes the closed facility out; afterwards nothing is pending');
  perform nc_test.ok(jsonb_array_length(public.admin_pack_changes()) =
                     (select count(*) from public.routes where is_active) * (select count(*) from public.carriers),
                     'admin_pack_changes() covers every route x carrier');
end $$;
reset role;
do $$ begin perform nc_test.noclaims(); end $$;

-- ============================== 10b. alert quota ledger (20260929000100)
-- The per-recipient / global e-mail quotas are counted on app_private.alert_ledger
-- (salted hash of the normalised address, no FK), so device.erase cannot reset
-- them; all-clear e-mails count too; Gmail aliases are one recipient.
\echo '== alert ledger: quotas survive device.erase, all-clears counted, aliases folded, retention, privileges'
do $$ begin
  perform nc_test.ok(app_private.normalize_email('  T.a.r.g.e.t+promo@GoogleMail.com. ') = 'target@gmail.com'
                     and app_private.normalize_email('Bob.Smith+x@Outlook.com') = 'bob.smith@outlook.com'
                     and app_private.normalize_email('+only@gmail.com') = '+only@gmail.com'
                     and app_private.normalize_email('') is null and app_private.normalize_email(null) is null,
                     'normalize_email: lower case, +tag dropped, Gmail dots and googlemail.com folded (= backend-local.js)');
  perform nc_test.ok(app_private.recipient_hash('Target+x@gmail.com') = app_private.recipient_hash('t.arget@googlemail.com')
                     and app_private.recipient_hash('target@gmail.com') ~ '^[0-9a-f]{64}$'
                     and app_private.recipient_hash('target@gmail.com') <> encode(digest('target@gmail.com', 'sha256'), 'hex')
                     and app_private.recipient_hash(null) is null,
                     'recipient_hash: salted sha256 of the normalised address');
  perform nc_test.ok(exists (select 1 from app_private.settings where key = 'alert_ledger_backfilled')
                     and exists (select 1 from app_private.settings where key = 'ledger_salt' and length(value) = 32),
                     'ledger salt created, one-time backfill recorded');
end $$;

-- the reverify-admin-security loop: start → overdue → e-mail → device.erase, six times, same victim (aliases)
do $$
declare
  i       int;
  reg     jsonb;
  sid     uuid;
  c       jsonb;
  res     jsonb;
  v_fake  boolean := app_private.setting('functions_url') is not null and app_private.has_pg_net();
  v_sent  int := 0;
  v_lim   int := 0;
  v_hash  text := app_private.recipient_hash('ledger.victim@gmail.com');
  emails  text[] := array['ledger.victim@gmail.com', 'Ledger.Victim+2@gmail.com', 'l.e.d.g.e.r.victim@googlemail.com'];
begin
  for i in 1..6 loop
    reg := public.register_device('viettel', 'ledger');
    sid := gen_random_uuid();
    perform public.sync_device_ops((reg ->> 'device_id')::uuid, reg ->> 'secret', jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'op', 'buddy.start', 'data', jsonb_build_object(
        'id', sid, 'traveler_name', 'Ledger ' || i, 'recipient', jsonb_build_object('name', 'V', 'email', emails[1 + (i - 1) % 3], 'phone', '+84 000 000 019'),
        'interval_min', 1, 'grace_min', 0, 'started_at', '2020-01-01T00:00:00Z'))));
    perform public.nc_mark_overdue();
    c := public.nc_alert_claim(sid);
    if jsonb_array_length(c) = 1 then
      perform public.nc_alert_result(sid, true, 'overdue', 'resend', 'em_ledger_' || i, null, 'cron', null, c -> 0 ->> 'reason');
      v_sent := v_sent + 1;
    end if;
    v_lim := v_lim + (select count(*)::int from checkin_events where session_id = sid and kind = 'alert_failed'
                        and meta ->> 'reason' = 'rate_limited' and meta ->> 'limit' = 'recipient_24h');
    res := public.sync_device_ops((reg ->> 'device_id')::uuid, reg ->> 'secret', jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'op', 'device.erase', 'data', '{}'::jsonb)));
    perform nc_test.ok((res -> 'results' -> 0 -> 'data' ->> 'erased')::boolean, 'ledger cycle ' || i || ': device erased');
  end loop;
  -- with pg_net every erase also sends the all-clear, which counts: alert, all-clear, alert, all-clear, then held back
  perform nc_test.ok(v_sent = case when v_fake then 2 else 3 end and v_lim = 6 - v_sent,
                     'device.erase does not reset the per-recipient quota (' || v_sent || ' alerts, ' || v_lim || ' held back)');
  perform nc_test.ok((select count(*) from app_private.alert_ledger where recipient_hash = v_hash and kind = 'alert' and status = 'sent') = v_sent
                     and (select count(*) from app_private.alert_ledger where recipient_hash = v_hash and kind = 'all_clear' and status = 'sent')
                         = case when v_fake then 2 else 0 end
                     and not exists (select 1 from app_private.alert_ledger where recipient_hash = v_hash and session_ref is not null),
                     'ledger keeps the alerts and the inline all-clears of erased devices, without session links');
  perform nc_test.ok(app_private.alert_quota_block('LEDGER.VICTIM+new@gmail.com') = 'recipient_24h',
                     'an alias of the victim is still over the quota');
  perform nc_test.ok(not exists (select 1 from app_private.alert_ledger l where l::text ilike '%victim%' or l::text ilike '%@%'),
                     'no plaintext address in the ledger');
end $$;

-- an alert claimed but not yet reported keeps counting when the device is erased; failed sends do not count
do $$
declare
  reg  jsonb;
  sid  uuid;
  c    jsonb;
  addr text;
begin
  foreach addr in array array['inflight.victim@gmail.com', 'failing.victim@gmail.com'] loop
    reg := public.register_device('viettel', 'ledger');
    sid := gen_random_uuid();
    perform public.sync_device_ops((reg ->> 'device_id')::uuid, reg ->> 'secret', jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'op', 'buddy.start', 'data', jsonb_build_object(
        'id', sid, 'recipient_email', addr, 'recipient_phone', '+84 000 000 020', 'interval_min', 1, 'grace_min', 0,
        'started_at', '2020-01-01T00:00:00Z'))));
    perform public.nc_mark_overdue();
    c := public.nc_alert_claim(sid);
    perform nc_test.ok(jsonb_array_length(c) = 1
                       and exists (select 1 from app_private.alert_ledger where session_ref = sid and status = 'claimed'),
                       'claim writes an open ledger row: ' || addr);
    if addr like 'failing%' then
      perform public.nc_alert_result(sid, false, 'overdue', 'resend', null, 'Resend HTTP 500', 'cron', null, 'overdue');
    else
      perform public.sync_device_ops((reg ->> 'device_id')::uuid, reg ->> 'secret', jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(), 'op', 'device.erase', 'data', '{}'::jsonb)));
    end if;
  end loop;
  insert into app_private.settings (key, value) values ('limit_alert_recipient_24h', '1')
  on conflict (key) do update set value = excluded.value;
  perform nc_test.ok(app_private.alert_quota_block('inflight.victim@gmail.com') = 'recipient_24h'
                     and exists (select 1 from app_private.alert_ledger
                                  where recipient_hash = app_private.recipient_hash('inflight.victim@gmail.com')
                                    and status = 'claimed' and session_ref is null),
                     'an in-flight claim survives device.erase (unlinked, still counted)');
  perform nc_test.ok(app_private.alert_quota_block('failing.victim@gmail.com') is null
                     and exists (select 1 from app_private.alert_ledger
                                  where recipient_hash = app_private.recipient_hash('failing.victim@gmail.com') and status = 'failed'),
                     'a failed send is recorded as failed and does not use the quota');
  delete from app_private.settings where key = 'limit_alert_recipient_24h';
end $$;

-- all-clear after a check-in goes through nc_alert_result(type resolved) and is counted
do $$
declare
  reg  jsonb := public.register_device('viettel', 'ledger');
  sid  uuid := gen_random_uuid();
  c    jsonb;
  h    text := app_private.recipient_hash('allclear.person@gmail.com');
begin
  perform public.sync_device_ops((reg ->> 'device_id')::uuid, reg ->> 'secret', jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'op', 'buddy.start', 'data', jsonb_build_object(
      'id', sid, 'recipient_email', 'allclear.person@gmail.com', 'recipient_phone', '+84 000 000 021', 'interval_min', 1, 'grace_min', 0,
      'started_at', '2020-01-01T00:00:00Z'))));
  perform public.nc_mark_overdue();
  c := public.nc_alert_claim(sid);
  perform public.nc_alert_result(sid, true, 'overdue', 'resend', 'em_ac', null, 'cron', null, c -> 0 ->> 'reason');
  perform public.sync_device_ops((reg ->> 'device_id')::uuid, reg ->> 'secret', jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'op', 'buddy.checkin', 'data', jsonb_build_object('session_id', sid, 'kind', 'checkin'))));
  c := public.nc_alert_claim(sid, 'resolved');
  perform nc_test.ok(jsonb_array_length(c) = 1, 'all-clear claimable after the check-in');
  perform public.nc_alert_result(sid, true, 'resolved', 'resend', 'em_ac2', null, 'cron', null, 'resolved');
  perform nc_test.ok((select count(*) from app_private.alert_ledger where recipient_hash = h and kind = 'alert' and status = 'sent') = 1
                     and (select count(*) from app_private.alert_ledger where recipient_hash = h and kind = 'all_clear' and status = 'sent') = 1,
                     'alert and all-clear e-mails are both in the ledger');
  insert into app_private.settings (key, value) values ('limit_alert_recipient_24h', '2')
  on conflict (key) do update set value = excluded.value;
  perform nc_test.ok(app_private.alert_quota_block('allclear.person@gmail.com') = 'recipient_24h',
                     'the all-clear counts against the recipient quota');
  delete from app_private.settings where key = 'limit_alert_recipient_24h';
end $$;

-- the hourly global cap survives device.erase too
do $$
declare
  v_base int := (select count(*)::int from app_private.alert_ledger
                 where status in ('claimed', 'sent') and created_at > now() - interval '1 hour');
  reg    jsonb := public.register_device('viettel', 'ledger');
  sid    uuid := gen_random_uuid();
  c      jsonb;
begin
  insert into app_private.settings (key, value) values ('limit_alert_global_1h', (v_base + 1)::text)
  on conflict (key) do update set value = excluded.value;
  perform public.sync_device_ops((reg ->> 'device_id')::uuid, reg ->> 'secret', jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'op', 'buddy.start', 'data', jsonb_build_object(
      'id', sid, 'recipient_email', 'global.one@gmail.com', 'recipient_phone', '+84 000 000 022', 'interval_min', 1, 'grace_min', 0,
      'started_at', '2020-01-01T00:00:00Z'))));
  perform public.nc_mark_overdue();
  c := public.nc_alert_claim(sid);
  perform public.nc_alert_result(sid, true, 'overdue', 'resend', 'em_g1', null, 'cron', null, c -> 0 ->> 'reason');
  perform public.sync_device_ops((reg ->> 'device_id')::uuid, reg ->> 'secret', jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'op', 'device.erase', 'data', '{}'::jsonb)));
  perform nc_test.ok(jsonb_array_length(c) = 1 and app_private.alert_quota_block('global.two@gmail.com') = 'global_1h'
                     and app_private.alert_quota_block('demo@example.com') is null,
                     'global cap still reached after the device that used it was erased');
  delete from app_private.settings where key = 'limit_alert_global_1h';
end $$;

-- retention + privileges of the ledger
do $$
declare r jsonb;
begin
  insert into app_private.alert_ledger (recipient_hash, kind, reason, source, status, created_at) values
    (repeat('a', 64), 'alert', 'overdue', 'test', 'sent', now() - interval '49 hours'),
    (repeat('b', 64), 'alert', 'overdue', 'test', 'sent', now() - interval '47 hours');
  r := public.nc_cleanup();
  perform nc_test.ok((r ->> 'ledger_deleted')::int >= 1
                     and not exists (select 1 from app_private.alert_ledger where recipient_hash = repeat('a', 64))
                     and exists (select 1 from app_private.alert_ledger where recipient_hash = repeat('b', 64)),
                     'nc_cleanup prunes ledger rows older than 48 h (and keeps younger ones)');
  delete from app_private.alert_ledger where recipient_hash = repeat('b', 64);
  perform nc_test.ok(not has_table_privilege('anon', 'app_private.alert_ledger', 'select')
                     and not has_table_privilege('authenticated', 'app_private.alert_ledger', 'select')
                     and not has_function_privilege('anon', 'app_private.ledger_add(text, text, text, text, text, uuid)', 'execute')
                     and not has_function_privilege('authenticated', 'app_private.recipient_hash(text)', 'execute'),
                     'the ledger and its helpers are not reachable by anon / authenticated');
end $$;

-- privileges of the new / replaced functions
set role anon;
do $$ begin perform nc_test.claims('anon'); end $$;
do $$
declare q text;
begin
  foreach q in array array['select public.admin_pack_changes()',
                           'select public.nc_alert_claim(null::uuid, ''overdue'', false, 1, null::uuid)',
                           'select public.nc_alert_result(gen_random_uuid(), true)'] loop
    begin
      execute q;
      perform nc_test.ok(false, 'anon cannot run ' || split_part(q, '(', 1));
    exception when insufficient_privilege then
      perform nc_test.ok(true, 'anon cannot run ' || split_part(q, '(', 1));
    end;
  end loop;
end $$;
reset role;
do $$ begin perform nc_test.noclaims(); end $$;
do $$ begin
  perform nc_test.ok(to_regprocedure('public.nc_alert_claim(uuid, text, boolean, integer)') is null
                     and to_regprocedure('public.nc_alert_result(uuid, boolean, text, text, text, text, text)') is null
                     and to_regprocedure('public.admin_publish_pack(text, text, text)') is null
                     and to_regprocedure('app_private.publish_pack(text, text, text, uuid)') is null,
                     'replaced signatures are dropped (no PostgREST overload ambiguity)');
end $$;

-- ================= 10c. heartbeat, contact_lost, Web Push (20260930000200, R6)
-- buddy.heartbeat (no event, closed ignored, invalid_state, silence_until cap),
-- nc_mark_contact_lost (paused / silence_until / recent check-in protect; phone-
-- only never e-mailed), alert payload reason, push.subscribe / unsubscribe /
-- schedule validation + replace-all, nc_push_claim / nc_push_result / tick, RLS.
\echo '== heartbeat + contact_lost + web push: buddy.heartbeat, nc_mark_contact_lost, push.* ops, nc_push_claim/result, privileges'
create or replace function nc_test.op1(p_dev uuid, p_sec text, p_op text, p_data jsonb) returns jsonb
language sql as $$
  select public.sync_device_ops(p_dev, p_sec, jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'op', p_op, 'data', p_data))) -> 'results' -> 0
$$;

do $$
declare
  reg  jsonb := public.register_device('viettel', 'heartbeat');
  dev  uuid := (reg ->> 'device_id')::uuid;
  sec  text := reg ->> 'secret';
  reg2 jsonb := public.register_device('viettel', 'heartbeat-2');
  dev2 uuid := (reg2 ->> 'device_id')::uuid;
  sec2 text := reg2 ->> 'secret';
  sid  uuid := gen_random_uuid();
  sid2 uuid := gen_random_uuid();
  r    jsonb;
  c    jsonb;
  n    int;
  s    buddy_sessions%rowtype;
begin
  r := nc_test.op1(dev, sec, 'buddy.start', jsonb_build_object('id', sid, 'traveler_name', 'Heartbeat Hà',
    'recipient', jsonb_build_object('name', 'Mẹ', 'email', 'lost.contact@example.com', 'phone', '+84 000 000 031'),
    'interval_min', 240, 'grace_min', 15));
  perform nc_test.ok(r ->> 'status' = 'ok', 'heartbeat: session started');
  r := nc_test.op1(dev, sec, 'buddy.heartbeat', jsonb_build_object('session_id', sid, 'state', 'live', 'lat', 23.1, 'lng', 105.2,
    'accuracy_m', 12, 'silence_until', null, 'client_ts', now()));
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(r ->> 'status' = 'ok' and r -> 'data' ->> 'heartbeat_state' = 'live' and s.heartbeat_state = 'live'
                     and s.last_heartbeat_at > now() - interval '1 minute' and s.silence_until is null
                     and s.last_lat = 23.1 and s.last_lng = 105.2 and s.status = 'active',
                     'buddy.heartbeat live: last_heartbeat_at, heartbeat_state, newer fix → last location');
  perform nc_test.ok((select count(*) from checkin_events where session_id = sid) = 1,
                     'a heartbeat writes no event (only the start is logged)');
  r := nc_test.op1(dev, sec, 'buddy.heartbeat', jsonb_build_object('session_id', sid, 'state', 'asleep'));
  perform nc_test.ok(r ->> 'status' = 'error' and r ->> 'error' = 'invalid_state' and not (r ->> 'retryable')::boolean,
                     'buddy.heartbeat with an unknown state -> invalid_state (not retryable)');
  r := nc_test.op1(dev, sec, 'buddy.heartbeat', jsonb_build_object('session_id', sid, 'state', 'live',
    'silence_until', to_char(now() + interval '3 days', 'YYYY-MM-DD"T"HH24:MI:SSOF')));
  perform nc_test.ok((select silence_until <= now() + interval '24 hours 1 minute' and silence_until > now() + interval '23 hours'
                      from buddy_sessions where id = sid), 'silence_until is capped at 24 h ahead');

  -- silent 20 min, but inside a predicted dead zone (silence_until ahead) → protected
  update buddy_sessions set last_heartbeat_at = now() - interval '20 minutes', last_checkin_at = now() - interval '60 minutes',
         silence_until = now() + interval '10 minutes' where id = sid;
  perform public.nc_mark_contact_lost();
  perform nc_test.ok((select status = 'active' from buddy_sessions where id = sid), 'silent inside the predicted dead zone (silence_until ahead) → not flagged');
  update buddy_sessions set silence_until = null, heartbeat_state = 'paused' where id = sid;
  perform public.nc_mark_contact_lost();
  perform nc_test.ok((select status = 'active' from buddy_sessions where id = sid), 'paused session (app hidden) → not flagged (dead-man switch only)');
  update buddy_sessions set heartbeat_state = 'live', last_checkin_at = now() - interval '5 minutes' where id = sid;
  perform public.nc_mark_contact_lost();
  perform nc_test.ok((select status = 'active' from buddy_sessions where id = sid), 'a check-in within 15 min counts as contact → not flagged');
  update buddy_sessions set last_checkin_at = now() - interval '60 minutes', silence_until = now() - interval '1 minute' where id = sid;
  n := public.nc_mark_contact_lost();
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(n >= 1 and s.status = 'overdue' and s.alert_reason = 'contact_lost' and s.alerted_at is null,
                     'live + silent > 15 min + silence_until past → overdue with alert_reason contact_lost');
  perform nc_test.ok(exists (select 1 from checkin_events where session_id = sid and kind = 'overdue' and meta ->> 'source' = 'server'
                             and meta ->> 'reason' = 'contact_lost' and meta ? 'last_heartbeat_at'), 'overdue event {reason: contact_lost, last_heartbeat_at}');
  perform public.nc_mark_contact_lost();
  perform nc_test.ok((select count(*) from checkin_events where session_id = sid and kind = 'overdue') = 1, 'nc_mark_contact_lost is idempotent');
  perform nc_test.ok((select alert_reason = 'contact_lost' and heartbeat_state = 'live' and last_heartbeat_at is not null and silence_until is not null
                      from v_buddy_sessions where id = sid), 'v_buddy_sessions shows alert_reason contact_lost + the heartbeat columns');
  perform nc_test.ok(app_private.alert_due(s), 'contact_lost with an e-mail is due for an alert');
  c := public.nc_alert_claim(sid);
  perform nc_test.ok(jsonb_array_length(c) = 1 and c -> 0 ->> 'reason' = 'contact_lost' and c -> 0 ->> 'alert_reason' = 'contact_lost'
                     and c -> 0 ? 'last_heartbeat_at' and c -> 0 ->> 'heartbeat_state' = 'live',
                     'alert payload: reason contact_lost + last_heartbeat_at / heartbeat_state');
  perform public.nc_alert_result(sid, true, 'overdue', 'demo', 'demo-1', null, 'cron', null, 'contact_lost');
  select * into s from buddy_sessions where id = sid;
  perform nc_test.ok(s.status = 'alerted' and s.alert_reason = 'contact_lost', 'contact_lost e-mail sent → alerted, reason kept');
  r := nc_test.op1(dev, sec, 'buddy.heartbeat', jsonb_build_object('session_id', sid, 'state', 'live'));
  perform nc_test.ok((select status = 'alerted' from buddy_sessions where id = sid), 'a later heartbeat never clears the alert (the traveller checks in)');
  r := nc_test.op1(dev, sec, 'buddy.checkin', jsonb_build_object('session_id', sid, 'kind', 'sos'));
  perform nc_test.ok((select status = 'overdue' and alert_reason = 'sos' from buddy_sessions where id = sid), 'SOS after contact_lost → re-alert as SOS');
  r := nc_test.op1(dev, sec, 'buddy.checkin', jsonb_build_object('session_id', sid, 'kind', 'checkin'));
  perform nc_test.ok((select status = 'active' and alert_reason is null from buddy_sessions where id = sid), 'check-in resolves (active, reason cleared)');

  -- phone-only session: flagged (dashboard), never e-mailed
  r := nc_test.op1(dev2, sec2, 'buddy.start', jsonb_build_object('id', sid2, 'recipient_phone', '+84 987 654 321', 'interval_min', 240));
  r := nc_test.op1(dev2, sec2, 'buddy.heartbeat', jsonb_build_object('session_id', sid2, 'state', 'live'));
  update buddy_sessions set last_heartbeat_at = now() - interval '16 minutes', last_checkin_at = now() - interval '30 minutes' where id = sid2;
  perform public.nc_mark_contact_lost();
  select * into s from buddy_sessions where id = sid2;
  perform nc_test.ok(s.status = 'overdue' and s.alert_reason = 'contact_lost' and not app_private.alert_due(s)
                     and jsonb_array_length(public.nc_alert_claim(sid2)) = 0,
                     'phone-only session: contact_lost is flagged but never e-mailed');
  r := nc_test.op1(dev2, sec2, 'buddy.stop', jsonb_build_object('session_id', sid2));
  r := nc_test.op1(dev2, sec2, 'buddy.heartbeat', jsonb_build_object('session_id', sid2, 'state', 'live'));
  perform nc_test.ok(r ->> 'status' = 'ok' and r -> 'data' ->> 'ignored' = 'session_closed', 'heartbeat of a closed session is ignored');
  update buddy_sessions set last_heartbeat_at = null, heartbeat_state = null where id = sid;
  update buddy_sessions set last_checkin_at = now() - interval '2 hours' where id = sid;
  perform public.nc_mark_contact_lost();
  perform nc_test.ok((select status = 'active' from buddy_sessions where id = sid), 'a session that never sent a heartbeat (older app) is never flagged');
  perform nc_test.ok((public.nc_deadman_tick()) ? 'contact_lost', 'nc_deadman_tick runs the contact_lost step');
  r := nc_test.op1(dev, sec, 'buddy.stop', jsonb_build_object('session_id', sid));
end $$;

-- Web Push ops
do $$
declare
  reg jsonb := public.register_device('viettel', 'push');
  dev uuid := (reg ->> 'device_id')::uuid;
  sec text := reg ->> 'secret';
  ep  text := 'https://fcm.googleapis.com/fcm/send/nc-test-' || gen_random_uuid();
  k1  text := repeat('A', 87);
  k2  text := repeat('B', 22);
  r   jsonb;
  c   jsonb;
  i   int;
  v_id bigint;
begin
  r := nc_test.op1(dev, sec, 'push.subscribe', jsonb_build_object('endpoint', ep, 'p256dh', k1, 'auth', k2, 'lang', 'en'));
  perform nc_test.ok(r ->> 'status' = 'ok' and (select count(*) from push_subscriptions where device_id = dev and lang = 'en') = 1,
                     'push.subscribe stores the subscription');
  r := nc_test.op1(dev, sec, 'push.subscribe', jsonb_build_object('endpoint', ep, 'p256dh', k1, 'auth', k2, 'lang', 'vi'));
  perform nc_test.ok((select count(*) from push_subscriptions where endpoint = ep) = 1 and (select lang from push_subscriptions where endpoint = ep) = 'vi',
                     'push.subscribe is an upsert by endpoint');
  r := nc_test.op1(dev, sec, 'push.subscribe', jsonb_build_object('endpoint', 'https://evil.example.org/fcm.googleapis.com/x', 'p256dh', k1, 'auth', k2));
  perform nc_test.ok(r ->> 'error' = 'invalid_push_endpoint' and not (r ->> 'retryable')::boolean,
                     'an endpoint that is not a browser push service -> invalid_push_endpoint (the Edge Function never POSTs to arbitrary URLs)');
  perform nc_test.ok(not app_private.valid_push_endpoint('http://fcm.googleapis.com/x') and not app_private.valid_push_endpoint('https://fcm.googleapis.com.evil.io/x')
                     and not app_private.valid_push_endpoint('https://user@fcm.googleapis.com/x')
                     and app_private.valid_push_endpoint('https://web.push.apple.com/QX') and app_private.valid_push_endpoint('https://wns2-par02p.notify.windows.com/w/?token=x')
                     and app_private.valid_push_endpoint('https://updates.push.services.mozilla.com/wpush/v2/x'),
                     'valid_push_endpoint: https + FCM / Mozilla / Apple / WNS hosts only (= validPushEndpoint in backend-local.js)');
  r := nc_test.op1(dev, sec, 'push.subscribe', jsonb_build_object('endpoint', ep, 'p256dh', 'short', 'auth', k2));
  perform nc_test.ok(r ->> 'error' = 'invalid_push_keys', 'bad subscription keys -> invalid_push_keys');
  for i in 1..6 loop
    r := nc_test.op1(dev, sec, 'push.subscribe', jsonb_build_object('endpoint', 'https://updates.push.services.mozilla.com/wpush/v2/nc' || i || '-' || dev,
      'p256dh', k1, 'auth', k2));
  end loop;
  perform nc_test.ok((select count(*) from push_subscriptions where device_id = dev) = 5, 'at most 5 subscriptions per device (the oldest go)');

  r := nc_test.op1(dev, sec, 'push.schedule', jsonb_build_object('items', jsonb_build_array(
    jsonb_build_object('fire_at', now() + interval '10 minutes', 'kind', 'deadzone_ahead', 'minutes_before', 5, 'zone_km', 12.3456),
    jsonb_build_object('fire_at', now() - interval '1 hour', 'kind', 'deadzone_ahead', 'minutes_before', 5, 'zone_km', 1),
    jsonb_build_object('fire_at', now() + interval '49 hours', 'kind', 'deadzone_ahead', 'minutes_before', 5, 'zone_km', 2))));
  perform nc_test.ok(r ->> 'status' = 'ok' and (r -> 'data' ->> 'scheduled')::int = 1 and (r -> 'data' ->> 'skipped')::int = 2
                     and (select zone_km from push_schedule where device_id = dev) = 12.346,
                     'push.schedule: past / > 48 h items skipped, zone_km rounded');
  r := nc_test.op1(dev, sec, 'push.schedule', jsonb_build_object('items', (select jsonb_agg(jsonb_build_object('fire_at', now() + make_interval(mins => g),
    'kind', 'deadzone_ahead', 'minutes_before', 5, 'zone_km', g)) from generate_series(1, 21) g)));
  perform nc_test.ok(r ->> 'error' = 'too_many_items' and not (r ->> 'retryable')::boolean, 'push.schedule with 21 items -> too_many_items');
  r := nc_test.op1(dev, sec, 'push.schedule', jsonb_build_object('items', jsonb_build_array(
    jsonb_build_object('fire_at', now() + interval '5 minutes', 'kind', 'deadzone_ahead', 'minutes_before', '5', 'zone_km', 1))));
  perform nc_test.ok(r ->> 'error' = 'invalid_push_schedule' and (select count(*) from push_schedule where device_id = dev) = 1,
                     'a malformed item (string minutes_before) -> invalid_push_schedule, the old schedule is kept');
  r := nc_test.op1(dev, sec, 'push.schedule', jsonb_build_object('items', jsonb_build_array(
    jsonb_build_object('fire_at', now() + interval '2 minutes', 'kind', 'deadzone_ahead', 'minutes_before', 5, 'zone_km', 3),
    jsonb_build_object('fire_at', now() + interval '40 minutes', 'kind', 'deadzone_ahead', 'minutes_before', 5, 'zone_km', 9))));
  perform nc_test.ok((select count(*) from push_schedule where device_id = dev) = 2
                     and not exists (select 1 from push_schedule where device_id = dev and zone_km = 12.346),
                     'push.schedule replaces the whole schedule of the device');

  -- dispatch API (service side)
  update push_schedule set fire_at = now() - interval '1 minute' where device_id = dev and zone_km = 3 returning id into v_id;
  c := public.nc_push_claim(100);
  perform nc_test.ok(exists (select 1 from jsonb_array_elements(c) x where (x ->> 'id')::bigint = v_id
                             and jsonb_array_length(x -> 'subscriptions') = 5 and x ->> 'kind' = 'deadzone_ahead'
                             and not (x ? 'lat') and x -> 'subscriptions' -> 0 ? 'p256dh'),
                     'nc_push_claim: due reminder + the device subscriptions (no coordinates)');
  perform nc_test.ok(not exists (select 1 from jsonb_array_elements(public.nc_push_claim(100)) x where (x ->> 'id')::bigint = v_id),
                     'a claimed reminder is not handed out twice');
  perform public.nc_push_result(v_id, false, 'HTTP 500', null);
  perform nc_test.ok((select claimed_at is null and sent_at is null and attempts = 1 and last_error = 'HTTP 500' from push_schedule where id = v_id),
                     'failed send releases the claim for a retry');
  c := public.nc_push_claim(100);
  perform public.nc_push_result(v_id, true, null, array['https://updates.push.services.mozilla.com/wpush/v2/nc6-' || dev]);
  perform nc_test.ok((select sent_at is not null and attempts = 2 from push_schedule where id = v_id)
                     and (select count(*) from push_subscriptions where device_id = dev) = 4,
                     'sent → sent_at; endpoints answered 404/410 are deleted');
  update push_schedule set fire_at = now() - interval '40 minutes' where device_id = dev and zone_km = 9;
  perform nc_test.ok(not exists (select 1 from jsonb_array_elements(public.nc_push_claim(100)) x where (x ->> 'zone_km')::numeric = 9),
                     'a reminder more than 30 min late is never sent');
  update push_schedule set fire_at = now() - interval '2 hours' where device_id = dev and zone_km = 9;
  perform public.nc_push_claim(100);
  perform nc_test.ok(not exists (select 1 from push_schedule where device_id = dev and zone_km = 9), 'unsent reminders > 1 h late are pruned');
  r := nc_test.op1(dev, sec, 'push.schedule', jsonb_build_object('items', '[]'::jsonb));
  perform nc_test.ok((select count(*) from push_schedule where device_id = dev and sent_at is null) = 0, 'an empty push.schedule clears the pending reminders');
  r := nc_test.op1(dev, sec, 'push.unsubscribe', jsonb_build_object('endpoint', 'https://updates.push.services.mozilla.com/wpush/v2/nc2-' || dev));
  perform nc_test.ok((r -> 'data' ->> 'deleted')::int = 1 and (select count(*) from push_subscriptions where device_id = dev) = 3, 'push.unsubscribe {endpoint}');
  r := nc_test.op1(dev, sec, 'push.unsubscribe', '{}'::jsonb);
  perform nc_test.ok((r -> 'data' ->> 'deleted')::int = 3 and not exists (select 1 from push_subscriptions where device_id = dev), 'push.unsubscribe {} forgets every subscription of the device');
  r := nc_test.op1(dev, sec, 'push.subscribe', jsonb_build_object('endpoint', ep, 'p256dh', k1, 'auth', k2));
  r := nc_test.op1(dev, sec, 'push.schedule', jsonb_build_object('items', jsonb_build_array(
    jsonb_build_object('fire_at', now() + interval '20 minutes', 'kind', 'deadzone_ahead', 'minutes_before', 15, 'zone_km', 4))));
  r := nc_test.op1(dev, sec, 'device.erase', '{}'::jsonb);
  perform nc_test.ok(not exists (select 1 from push_subscriptions where device_id = dev) and not exists (select 1 from push_schedule where device_id = dev),
                     'device.erase deletes the device''s push subscriptions and schedule');
end $$;

\if :with_fakes
do $$
declare
  reg jsonb := public.register_device('viettel', 'push-tick');
  dev uuid := (reg ->> 'device_id')::uuid;
  sec text := reg ->> 'secret';
  r   jsonb;
  n   int;
begin
  r := nc_test.op1(dev, sec, 'push.subscribe', jsonb_build_object('endpoint', 'https://fcm.googleapis.com/fcm/send/tick-' || dev,
    'p256dh', repeat('C', 87), 'auth', repeat('D', 22)));
  r := nc_test.op1(dev, sec, 'push.schedule', jsonb_build_object('items', jsonb_build_array(
    jsonb_build_object('fire_at', now() + interval '1 minute', 'kind', 'deadzone_ahead', 'minutes_before', 5, 'zone_km', 7))));
  update push_schedule set fire_at = now() - interval '10 seconds' where device_id = dev;
  delete from net.http_request_log;
  n := public.nc_push_tick();
  perform nc_test.ok(n >= 1 and exists (select 1 from net.http_request_log
                                        where url = 'https://example-ref.supabase.co/functions/v1/push-dispatch'
                                          and headers ->> 'x-nc-cron-secret' = 'test-cron-secret'),
                     'nc_push_tick POSTs {functions_url}/push-dispatch with x-nc-cron-secret when a reminder is due');
  perform nc_test.ok(exists (select 1 from cron.job where jobname = 'nomadcare-push' and schedule = '* * * * *'
                             and command like '%nc_push_tick%'), 'pg_cron job nomadcare-push every minute');
  r := nc_test.op1(dev, sec, 'device.erase', '{}'::jsonb);
end $$;
\else
do $$ begin
  perform nc_test.ok(public.nc_push_tick() = 0, 'nc_push_tick without pg_net: nothing dispatched (notice only)');
end $$;
\endif

-- privileges of the new tables / functions
set role anon;
do $$ begin perform nc_test.claims('anon'); end $$;
do $$
declare q text;
begin
  foreach q in array array['select 1 from public.push_subscriptions limit 1', 'select 1 from public.push_schedule limit 1',
                           'select public.nc_push_claim(1)', 'select public.nc_push_result(1::bigint, true)',
                           'select public.nc_mark_contact_lost()', 'select public.nc_push_tick()',
                           'select app_private.op_buddy_heartbeat(null::public.devices, ''{}''::jsonb, null)'] loop
    begin
      execute q;
      perform nc_test.ok(false, 'anon cannot run: ' || q);
    exception when insufficient_privilege then
      perform nc_test.ok(true, 'anon cannot run: ' || q);
    end;
  end loop;
end $$;
reset role;
do $$ begin perform nc_test.noclaims(); end $$;
set role authenticated;
do $$ begin perform nc_test.claims('authenticated', '00000000-0000-4000-8000-00000000b002'); end $$;
do $$
declare q text;
begin
  perform nc_test.ok((select count(*) from public.push_subscriptions) = 0 and (select count(*) from public.push_schedule) = 0,
                     'a non-admin user sees no push rows');
  foreach q in array array['select public.nc_mark_contact_lost()', 'select public.nc_push_tick()', 'select public.nc_push_claim(1)'] loop
    begin
      execute q;
      perform nc_test.ok(false, 'non-admin cannot run: ' || q);
    exception when insufficient_privilege then
      perform nc_test.ok(true, 'non-admin cannot run: ' || q);
    end;
  end loop;
  begin
    insert into public.push_subscriptions (device_id, endpoint, p256dh, auth) values (gen_random_uuid(), 'https://fcm.googleapis.com/x', 'a', 'b');
    perform nc_test.ok(false, 'non-admin cannot insert push rows');
  exception when insufficient_privilege then
    perform nc_test.ok(true, 'non-admin cannot insert push rows');
  end;
end $$;
reset role;
do $$ begin perform nc_test.noclaims(); end $$;
set role authenticated;
do $$ begin perform nc_test.claims('authenticated', '00000000-0000-4000-8000-00000000a001'); end $$;
do $$ begin
  perform nc_test.ok((select count(*) from public.push_subscriptions) >= 0 and public.nc_mark_contact_lost() >= 0,
                     'an admin may read push rows and run nc_mark_contact_lost');
end $$;
reset role;
do $$ begin perform nc_test.noclaims(); end $$;

-- ================================================================ summary
\echo '== summary'
do $$ begin
  raise notice 'ALL TESTS PASSED (% assertions)', current_setting('nc_test.passed', true);
end $$;
