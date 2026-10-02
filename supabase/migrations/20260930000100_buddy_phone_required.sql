-- =============================================================================
-- NomadCare v2 — 20260930000100 Buddy: recipient phone required, e-mail optional
-- (round 2, R7). Owner: backend. Idempotent; runs after 20260929000100 and
-- replaces app_private.op_buddy_start (same signature, grants are re-applied).
--   * app_private.norm_phone(text) → E.164 text or null, app_private.valid_phone
--     (text) → boolean. Same rules as normPhone() in assets/js/services/
--     backend-local.js: '+<cc>…', '00<cc>…' or Vietnamese national '0…' (→ +84);
--     separators space ( ) . - /; Vietnam: mobile 9 digits [35789]…, landline
--     10 digits 2…, a trunk '0' typed after +84 is dropped; demo numbers
--     '+84 000 000 0NN' are accepted; other countries 8–15 digits, first 1–9.
--   * buddy.start of a NEW session needs a valid recipient phone
--     ('recipient_phone_required' / 'recipient_phone_invalid', 22023, not
--     retryable). The phone is stored as E.164. The e-mail is optional: when
--     given it must be valid ('recipient_email_invalid'); without it the server
--     never e-mails anybody (alert_due / nc_alert_claim already skip sessions
--     without an e-mail) and the traveller relies on the SMS composed on the
--     phone.
--   * A re-sent start of a session the server already has (same device) may
--     come without a phone (legacy e-mail-only sessions keep working): the
--     stored phone is kept.
--   * The per-device start limit (limit_buddy_start_device_24h) only applies to
--     starts towards a real mailbox: a start without an e-mail (or to a demo
--     domain) is never counted nor limited — it cannot make the server send
--     anything.
-- =============================================================================
set search_path = public, extensions;

-- =============================================================================
-- 1. Phone helpers
-- =============================================================================
-- Input as typed, spaces collapsed (ASCII + Unicode spaces, = PHONE_SPACE_RE in JS), trimmed; '' when empty.
create or replace function app_private.phone_text(p text)
returns text
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select btrim(regexp_replace(coalesce(p, ''),
               '[ \t\n\v\f\r\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'), ' ')
$$;

create or replace function app_private.norm_phone(p text)
returns text
language plpgsql
immutable
set search_path = public, extensions, pg_temp
as $$
declare
  s text := app_private.phone_text(p);
  d text;
  n text;
begin
  if s = '' or length(s) > 32 or s !~ '^[(]?[+]?[0-9 ()./-]+$' then
    return null;
  end if;
  d := regexp_replace(s, '[^0-9]', '', 'g');
  if left(ltrim(s, '('), 1) = '+' then
    null;                                   -- already international ('+84 …' or '(+84) …')
  elsif left(d, 2) = '00' then
    d := substr(d, 3);                      -- 00<cc>…
  elsif left(d, 1) = '0' then
    d := '84' || substr(d, 2);              -- Vietnamese national number
  else
    return null;
  end if;
  if left(d, 2) = '84' then
    n := substr(d, 3);
    if n ~ '^0000000[0-9]{2}$' then
      return '+84' || n;                    -- demo number +84 000 000 0NN
    end if;
    if n ~ '^0[0-9]{9,10}$' then
      n := substr(n, 2);                    -- '+84 0912…': trunk 0 typed after the country code
    end if;
    if n ~ '^[35789][0-9]{8}$' or n ~ '^2[0-9]{9}$' then
      return '+84' || n;
    end if;
    return null;
  end if;
  if d ~ '^[1-9][0-9]{7,14}$' then
    return '+' || d;
  end if;
  return null;
end $$;

create or replace function app_private.valid_phone(p text)
returns boolean
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select app_private.norm_phone(p) is not null
$$;

-- =============================================================================
-- 2. op: buddy.start (phone required, e-mail optional, names cleaned, limit)
-- =============================================================================
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
  v_praw   text := nullif(app_private.phone_text(coalesce(v -> 'recipient' ->> 'phone', v ->> 'recipient_phone')), '');
  v_phone  text := app_private.norm_phone(v_praw);
  v_raw    text := app_private.clean_text(v ->> 'traveler_name', 200);
  v_name   text := app_private.clean_name(v ->> 'traveler_name', 60);
  -- offline-first: a start queued on the phone keeps its time, but never more than 24 h back
  v_start  timestamptz := greatest(least(coalesce(app_private.try_ts(v ->> 'started_at'),
                                                  app_private.try_ts(p_data ->> 'client_ts'), now()), now()),
                                   now() - interval '24 hours');
  v_int    int := greatest(1, least(coalesce(app_private.try_num(v ->> 'interval_min'), 60)::int, 10080));
  v_grace  int := greatest(0, least(coalesce(app_private.try_num(v ->> 'grace_min'), 15)::int, 1440));
  v_share  boolean := coalesce(app_private.try_bool(v ->> 'share_public_medical'), false);
  v_lat    double precision := coalesce(app_private.try_num(v ->> 'lat'), app_private.try_num(v ->> 'last_lat'));
  v_lng    double precision := coalesce(app_private.try_num(v ->> 'lng'), app_private.try_num(v ->> 'last_lng'));
  v_warn   jsonb := '[]'::jsonb;
  v_recent int;
  v_prev   public.buddy_sessions%rowtype;
  s        public.buddy_sessions%rowtype;
  v_old    public.buddy_sessions%rowtype;
begin
  if not (v_lat between -90 and 90 and v_lng between -180 and 180) then
    v_lat := null; v_lng := null;
  end if;
  -- the phone is the traveller's own channel (SMS composed on the device); the e-mail, when
  -- given, is the only channel the server alerts through by itself
  if v_praw is not null and v_phone is null then
    raise exception 'recipient_phone_invalid' using errcode = '22023', detail = 'invalid',
      hint = 'recipient.phone must be +<country code>… (E.164), 00<cc>… or a Vietnamese 0… number.';
  end if;
  if v_email is not null and not app_private.valid_email(v_email) then
    raise exception 'recipient_email_invalid' using errcode = '22023', detail = 'invalid',
      hint = 'recipient.email is optional but must be a valid address when given.';
  end if;
  if v_raw is distinct from v_name then
    v_warn := v_warn || '"traveler_name_sanitized"'::jsonb;
  end if;

  select * into v_prev from public.buddy_sessions where id = v_id for update;
  if found and v_prev.device_id is distinct from p_device.id then
    raise exception 'session_conflict' using errcode = '42501', detail = 'session id belongs to another device';
  end if;
  -- a new session needs the phone; a re-sent start of a known (legacy e-mail-only) session keeps its phone
  if v_prev.id is null and v_phone is null then
    raise exception 'recipient_phone_required' using errcode = '22023', detail = 'missing',
      hint = 'buddy.start needs the recipient phone number (the e-mail is optional).';
  end if;

  -- only starts towards a real mailbox are counted and limited
  if v_prev.id is null and v_email is not null and not app_private.is_reserved_email(v_email) then
    select count(*)::int into v_recent
    from public.buddy_sessions b
    where b.device_id = p_device.id
      and b.created_at > now() - interval '24 hours'
      and b.recipient_email is not null
      and not app_private.is_reserved_email(b.recipient_email);
    if v_recent >= app_private.limit_value('limit_buddy_start_device_24h', 5) then
      raise exception 'rate_limited' using errcode = '54000', detail = 'buddy_start_device_24h',
        hint = 'Too many Buddy sessions from this device in 24 h; the on-device alert still works.';
    end if;
  end if;

  -- one open session per device: close older open sessions (a late re-send of an
  -- already closed session must not close the session that replaced it)
  for v_old in
    select * from public.buddy_sessions
    where device_id = p_device.id and status <> 'closed' and id <> v_id
      and (v_prev.id is null or v_prev.status <> 'closed')
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
    v_name,
    app_private.clean_name(coalesce(v -> 'recipient' ->> 'name', v ->> 'recipient_name'), 60),
    v_email,
    v_phone,
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
    recipient_phone      = coalesce(excluded.recipient_phone, b.recipient_phone),
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

-- =============================================================================
-- 3. Privileges (as the 20260928000100 / 20260929000100 sweeps)
-- =============================================================================
revoke all on all functions in schema app_private from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
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
    where n.nspname = 'app_private'
      and p.proname in ('phone_text', 'norm_phone', 'valid_phone', 'op_buddy_start')
      and p.prokind = 'f'
      and l.lanname in ('sql', 'plpgsql')
      and p.proowner = (select oid from pg_roles where rolname = current_user)
      and not exists (select 1 from pg_depend d
                       where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s set jit = off', f);
  end loop;
end $$;

comment on function app_private.norm_phone(text) is
  'Buddy recipient phone → E.164 (+84… for Vietnam, demo +84 000 000 0NN kept) or null; mirrors normPhone() in backend-local.js.';
comment on function app_private.op_buddy_start(public.devices, jsonb, uuid) is
  'buddy.start: recipient phone required (E.164), e-mail optional (validated), names cleaned, per-device limit for real mailboxes only.';
