-- =============================================================================
-- NomadCare v2 — 0700 audit trail
-- Owner: P1 database. Row triggers write public.audit_log for:
--   facilities, services, facility_submissions, data_packs, content_releases
--   (insert / update / delete) and buddy_sessions (status changes only, no PII).
-- action: 'insert' | 'update' | 'status' (status column changed) | 'delete' | 'publish' (data_packs)
-- details: {row} on insert/delete, {changed:{col:{from,to}}} on update.
-- Large / noisy columns are left out (geom → lat/lng, payload, timestamps).
-- Bulk loads can switch auditing off for the current transaction/session:
--   set nc.audit = 'off';      -- e.g. at the top of seed.sql
-- An optional label for scripted changes:  set nc.actor = 'seed';
-- =============================================================================
set search_path = public, extensions;

-- Who is acting: admin display name / email, else the API role.
create or replace function app_private.actor_label(p_actor uuid)
returns text
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select coalesce(
    (select coalesce(a.display_name, u.email)
       from public.admin_users a left join auth.users u on u.id = a.user_id
      where a.user_id = p_actor),
    nullif(current_setting('nc.actor', true), ''),
    case auth.role()
      when 'anon'          then 'device'
      when 'service_role'  then 'service_role'
      when 'authenticated' then coalesce(auth.jwt() ->> 'email', 'user')
      else 'system'
    end)
$$;

-- JSON of a row without noisy columns; geography points become lat/lng.
create or replace function app_private.audit_clean(p_row jsonb, p_geom geography default null)
returns jsonb
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select (p_row - array['geom', 'payload', 'created_at', 'updated_at', 'secret_hash'])
         || case when p_geom is null then '{}'::jsonb
                 else jsonb_build_object('lat', trim_scale(round(ST_Y(p_geom::geometry)::numeric, 6)),
                                         'lng', trim_scale(round(ST_X(p_geom::geometry)::numeric, 6))) end
$$;

create or replace function app_private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor   uuid := auth.uid();
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
      return null;                                  -- nothing meaningful changed
    end if;
    if tg_table_name = 'data_packs' and v_changed - 'is_current' = '{}'::jsonb then
      return null;                                  -- the is_current flip of a publish
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

do $$
declare
  t text;
begin
  foreach t in array array['facilities', 'services', 'facility_submissions', 'data_packs', 'content_releases'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function app_private.audit_row()', t || '_audit', t);
  end loop;
end $$;

drop trigger if exists buddy_sessions_audit on public.buddy_sessions;
create trigger buddy_sessions_audit after update of status on public.buddy_sessions
  for each row when (old.status is distinct from new.status)
  execute function app_private.audit_row();
