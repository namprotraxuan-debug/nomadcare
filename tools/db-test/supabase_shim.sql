-- =============================================================================
-- supabase_shim.sql — emulates the parts of a Supabase project that the
-- NomadCare migrations rely on, so they can be tested on a plain PostgreSQL +
-- PostGIS server (tools/db-test/run.sh). NEVER run this on a real Supabase DB.
--
-- Provides: roles anon / authenticated / service_role / authenticator,
-- schemas extensions + auth (auth.users, auth.uid(), auth.role(), auth.jwt(),
-- auth.email()), Supabase-like default privileges on schema public,
-- optionally the supabase_realtime publication and fake pg_net / pg_cron APIs.
--
-- psql variables (set with -v):   with_realtime=on|off   with_fakes=on|off
-- =============================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- roles ----
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;
-- the migrating user must be able to "set role" to the API roles in tests
grant anon, authenticated, service_role to current_user;

-- ------------------------------------------------------------- schemas ----
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  aud                text default 'authenticated',
  role               text default 'authenticated',
  email              text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data  jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- Same definitions as Supabase (GoTrue) uses: read the PostgREST JWT GUCs.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.email() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant execute on function auth.uid(), auth.role(), auth.email(), auth.jwt()
  to anon, authenticated, service_role;

-- ------------------------------------- Supabase-like default privileges ----
-- Supabase grants everything in schema public to the API roles by default;
-- the NomadCare migrations must explicitly take this away from anon.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ------------------------------------------------ realtime publication ----
\if :with_realtime
set client_min_messages = error;   -- local clusters warn that wal_level is not 'logical'
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
reset client_min_messages;
\endif

-- --------------------------------------------- fake pg_net / pg_cron ----
-- Minimal API-compatible stand-ins so the dispatch/cron code paths run.
\if :with_fakes
create schema if not exists net;
create table if not exists net.http_request_log (
  id         bigserial primary key,
  url        text,
  body       jsonb,
  params     jsonb,
  headers    jsonb,
  timeout_ms int,
  created_at timestamptz default now()
);
create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint
language sql as $$
  insert into net.http_request_log (url, body, params, headers, timeout_ms)
  values (url, body, params, headers, timeout_milliseconds)
  returning id
$$;

create schema if not exists cron;
create table if not exists cron.job (
  jobid    bigserial primary key,
  jobname  text unique,
  schedule text not null,
  command  text not null,
  active   boolean default true
);
create or replace function cron.schedule(job_name text, schedule text, command text)
returns bigint
language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;
create or replace function cron.unschedule(job_name text) returns boolean
language sql as $$
  with d as (delete from cron.job where jobname = job_name returning 1)
  select exists (select 1 from d)
$$;
\endif
