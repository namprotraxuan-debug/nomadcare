-- =============================================================================
-- NomadCare v2 — 0100 extensions & private schema
-- Owner: P1 database. Idempotent (safe to re-run in the Supabase SQL Editor).
-- postgis + pgcrypto are REQUIRED. pg_cron + pg_net are OPTIONAL: if the server
-- does not offer them, this file still succeeds and the dead-man cron is simply
-- not scheduled (see 0800_cron.sql and supabase/README.md).
-- =============================================================================
set search_path = public, extensions;

create schema if not exists extensions;

-- Required -------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;  -- digest(), gen_random_bytes()
create extension if not exists postgis  with schema extensions;  -- geography, ST_*

-- Optional: pg_cron (job scheduler) -------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available on this server: skipping (dead-man cron will not be scheduled)';
    return;
  end if;
  begin
    -- Supabase installs pg_cron into pg_catalog (its objects live in schema "cron").
    execute 'create extension if not exists pg_cron with schema pg_catalog';
  exception when others then
    begin
      execute 'create extension if not exists pg_cron';
    exception when others then
      raise notice 'pg_cron could not be enabled (%): enable it in Dashboard > Database > Extensions, then create the cron jobs (supabase/README.md, Bước 5) or re-run the whole setup_all.sql — never 0800_cron.sql alone', sqlerrm;
    end;
  end;
end $$;

-- Optional: pg_net (async HTTP from SQL, used to call the Edge Function) -----
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;
  if not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_net is not available on this server: skipping (alerts must be triggered from the dashboard)';
    return;
  end if;
  begin
    execute 'create extension if not exists pg_net with schema extensions';
  exception when others then
    begin
      execute 'create extension if not exists pg_net';
    exception when others then
      raise notice 'pg_net could not be enabled (%): enable it in Dashboard > Database > Extensions', sqlerrm;
    end;
  end;
end $$;

-- Private schema: NOT exposed through the Data API (PostgREST) -----------------
create schema if not exists app_private;
revoke all on schema app_private from public;
do $$
begin
  -- Supabase API roles exist on every Supabase project; guard for plain Postgres.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema app_private from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema app_private to service_role';
  end if;
end $$;
