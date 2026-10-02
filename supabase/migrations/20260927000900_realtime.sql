-- =============================================================================
-- NomadCare v2 — 0900 Supabase Realtime + final privilege sweep
-- Owner: P1 database.
-- Realtime (postgres_changes) for the admin dashboard: buddy_sessions,
-- checkin_events, facility_submissions, facilities, signal_samples.
-- Realtime applies RLS, so only admins receive the changes. Skipped with a
-- NOTICE when the publication "supabase_realtime" does not exist.
-- =============================================================================
set search_path = public, extensions;

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publication supabase_realtime not found: realtime not configured (dashboard falls back to polling)';
    return;
  end if;
  if (select puballtables from pg_publication where pubname = 'supabase_realtime') then
    return;                                        -- FOR ALL TABLES: already included
  end if;
  foreach t in array array['buddy_sessions', 'checkin_events', 'facility_submissions', 'facilities', 'signal_samples'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ------------------------------------------------ final privilege sweep ----
-- Functions are EXECUTE-able by PUBLIC by default in PostgreSQL. Nothing in
-- app_private is reachable through the Data API, but lock it down anyway and
-- re-grant only what RLS policies / invoker-rights triggers need.
revoke all on all functions in schema app_private from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all functions in schema app_private from anon, authenticated';
    execute 'grant execute on all functions in schema app_private to service_role';
    -- used by RLS policies and by SECURITY INVOKER triggers fired by admin DML
    execute 'grant execute on function app_private.has_admin_role(text) to authenticated';
    execute 'grant execute on function app_private.level_from_rsrp(int, text) to authenticated';
    execute 'grant execute on function app_private.touch_updated_at() to authenticated';
    execute 'grant execute on function app_private.route_defaults() to authenticated';
    execute 'grant execute on function app_private.signal_sample_defaults() to authenticated';
    -- used by the security_invoker view v_facilities
    execute 'grant execute on function app_private.today_vn() to authenticated';
  end if;
end $$;

-- JIT off for every NomadCare function: these are small OLTP queries, and
-- right after a bulk load (no statistics yet) inflated estimates would make
-- PostgreSQL spend ~70 ms JIT-compiling a 1 ms query (measured on list_routes).
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
