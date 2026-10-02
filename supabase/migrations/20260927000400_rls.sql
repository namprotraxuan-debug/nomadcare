-- =============================================================================
-- NomadCare v2 — 0400 row-level security, privileges, is_admin()
-- Owner: P1 database.
-- Model:
--   anon           → NO table/view privileges at all; only the public RPCs (0500).
--   authenticated  → table privileges, but every policy requires is_admin()
--                    (a row in admin_users). Non-admin accounts see nothing.
--   service_role   → bypasses RLS (Edge Functions, server scripts).
-- SECURITY DEFINER functions are owned by the migration role (table owner), so
-- they are not subject to these policies and validate their own input.
-- =============================================================================
set search_path = public, extensions;

-- --------------------------------------------------------- is_admin() ----
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (select 1 from public.admin_users a where a.user_id = auth.uid())
$$;
comment on function public.is_admin() is
  'True when the calling JWT user (auth.uid()) has a row in admin_users (role admin or reviewer).';

-- Role helper for the few actions reserved to role = ''admin'' (managing admins).
create or replace function app_private.has_admin_role(p_role text default 'admin')
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (select 1 from public.admin_users a
                  where a.user_id = auth.uid() and a.role = p_role)
$$;

revoke all on function public.is_admin() from public;
revoke all on function app_private.has_admin_role(text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.is_admin() from anon';
    execute 'grant execute on function public.is_admin() to authenticated, service_role';
    execute 'grant execute on function app_private.has_admin_role(text) to authenticated, service_role';
    -- policies evaluated as "authenticated" need to resolve app_private.* helpers
    execute 'grant usage on schema app_private to authenticated';
  end if;
end $$;

-- ------------------------------------------------ enable RLS + policies ----
do $$
declare
  t text;
  -- tables administered with full CRUD by admins
  crud_tables text[] := array[
    'carriers', 'routes', 'route_nodes', 'route_edges', 'signal_samples', 'signal_segments',
    'route_accuracy', 'facilities', 'services', 'facility_submissions', 'data_packs',
    'content_releases', 'devices', 'device_ops', 'buddy_sessions', 'checkin_events'];
  all_tables text[] := crud_tables || array['admin_users', 'audit_log'];
  has_roles boolean := exists (select 1 from pg_roles where rolname = 'anon');
begin
  foreach t in array all_tables loop
    execute format('alter table public.%I enable row level security', t);
    -- privileges: anon gets nothing, authenticated gets DML (filtered by RLS)
    execute format('revoke all on public.%I from public', t);
    if has_roles then
      execute format('revoke all on public.%I from anon', t);
      execute format('grant all on public.%I to service_role', t);
    end if;
  end loop;

  foreach t in array crud_tables loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated
                      using ((select public.is_admin()))
                      with check ((select public.is_admin()))', t || '_admin_all', t);
    if has_roles then
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    end if;
  end loop;
end $$;

-- admin_users: every signed-in user may read their own row (the dashboard uses
-- it to show "not an admin"); admins read all; only role 'admin' manages admins.
drop policy if exists admin_users_select on public.admin_users;
create policy admin_users_select on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists admin_users_manage on public.admin_users;
create policy admin_users_manage on public.admin_users for all to authenticated
  using ((select app_private.has_admin_role('admin')))
  with check ((select app_private.has_admin_role('admin')));

-- audit_log: append-only for admins (triggers write it as definer).
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select public.is_admin()));
drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check ((select public.is_admin()) and (actor is null or actor = (select auth.uid())));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select, insert, update, delete on public.admin_users to authenticated;
    grant select, insert on public.audit_log to authenticated;
    revoke update, delete, truncate on public.audit_log from authenticated;

    -- identity sequences: admins insert rows into identity tables
    grant usage, select on all sequences in schema public to authenticated, service_role;
    revoke all on all sequences in schema public from anon;

    -- views (security_invoker → base-table RLS applies)
    revoke all on public.v_facilities, public.v_buddy_sessions, public.v_services, public.v_signal_samples from anon;
    grant select on public.v_facilities, public.v_buddy_sessions, public.v_services, public.v_signal_samples
      to authenticated, service_role;
  end if;
end $$;
revoke all on public.v_facilities, public.v_buddy_sessions, public.v_services, public.v_signal_samples from public;

-- app_private.settings: owner / service_role only.
alter table app_private.settings enable row level security;
revoke all on app_private.settings from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on app_private.settings from anon, authenticated';
    execute 'grant select on app_private.settings to service_role';
  end if;
end $$;
