-- Fitvive database.
-- Paste this whole file into Supabase > SQL Editor and press Run. It is safe to run again.
-- Club time zone for streaks and the weekly ranking: Africa/Lagos (change in club_tz() below).

-- ---------------------------------------------------------------- tables
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  seats int not null default 0 check (seats >= 0),
  active_until timestamptz,
  admin_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null default '',
  phone text not null default '',
  gender text not null default 'unspecified' check (gender in ('female','male','unspecified')),
  role text not null default 'member' check (role in ('member','trainer','company_admin','admin')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','suspended','removed')),
  id_doc_path text,
  referral_code text,
  company_id uuid references public.companies(id) on delete set null,
  conduct_accepted_at timestamptz,
  cam_off_default boolean not null default false,
  low_data boolean not null default false,
  women_only_pref boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'invited' check (status in ('invited','joined','removed')),
  created_at timestamptz not null default now()
);

create table if not exists public.plans (
  key text primary key,
  label text not null,
  amount_kobo int not null default 0 check (amount_kobo >= 0),
  period text not null check (period in ('month','year')),
  paystack_plan_code text
);

create table if not exists public.discount_codes (
  code text primary key,
  percent_off int not null check (percent_off between 1 and 100),
  max_uses int not null default 100,
  used int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_key text,
  current_period_end timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  reference text primary key,
  user_id uuid references auth.users(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  kind text not null default 'member' check (kind in ('member','company')),
  plan_key text,
  amount_kobo int not null default 0,
  paid_kobo int,
  seats int not null default 1,
  discount_code text,
  status text not null default 'pending',
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 120),
  type text not null default 'workout' check (type in ('workout','dance','stretch','challenge')),
  trainer_id uuid references auth.users(id) on delete set null,
  starts_at timestamptz not null,
  duration_min int not null default 20 check (duration_min between 5 and 180),
  women_only boolean not null default false,
  company_id uuid references public.companies(id) on delete cascade,
  status text not null default 'scheduled' check (status in ('scheduled','ended','cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_starts_at on public.sessions(starts_at);

create table if not exists public.session_participants (
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  room_no int not null default 1,
  is_host boolean not null default false,
  seconds int not null default 0,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  left_at timestamptz,
  primary key (session_id, user_id)
);
create index if not exists sp_user on public.session_participants(user_id, joined_at);

create table if not exists public.partnerships (
  id uuid primary key default gen_random_uuid(),
  a uuid not null references auth.users(id) on delete cascade,
  b uuid not null references auth.users(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  check (a < b),
  unique (a, b)
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  partnership_id uuid not null references public.partnerships(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 140),
  target_days int not null default 30 check (target_days between 1 and 366),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.goal_checkins (
  goal_id uuid not null references public.goals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  primary key (goal_id, user_id, day)
);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  partnership_id uuid not null references public.partnerships(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists messages_partnership on public.messages(partnership_id, created_at);

create table if not exists public.partner_calls (
  id uuid primary key default gen_random_uuid(),
  partnership_id uuid not null references public.partnerships(id) on delete cascade,
  from_id uuid not null references auth.users(id) on delete cascade,
  to_id uuid not null references auth.users(id) on delete cascade,
  room_name text not null,
  room_url text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  reason text not null check (char_length(reason) between 2 and 200),
  status text not null default 'open' check (status in ('open','dismissed','actioned')),
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- seed rows
insert into public.plans (key, label, amount_kobo, period) values
  ('monthly', 'Monthly', 0, 'month'),
  ('yearly', 'Yearly', 0, 'year'),
  ('company_seat_monthly', 'Company seat, monthly', 0, 'month'),
  ('company_seat_yearly', 'Company seat, yearly', 0, 'year')
on conflict (key) do nothing;

-- free_access = true lets every approved member join without paying. Turn it off in Admin > Fees once fees are set.
insert into public.app_settings (key, value) values
  ('access', '{"free_access": true}'),
  ('room', '{"size": 6, "join_window_min": 5}')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- helpers
create or replace function public.club_tz() returns text language sql immutable as $$ select 'Africa/Lagos' $$;

create or replace function public.short_name(p_full text) returns text language sql immutable as $$
  select trim(split_part(trim(p_full), ' ', 1) || ' ' ||
    case when split_part(trim(p_full), ' ', 2) <> '' then upper(left(split_part(trim(p_full), ' ', 2), 1)) || '.' else '' end)
$$;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and status = 'approved')
$$;

create or replace function public.is_approved() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'approved')
$$;

create or replace function public.my_company_id() returns uuid language sql stable security definer set search_path = public as $$
  select company_id from profiles where id = auth.uid()
$$;

-- The role in the caller's login token: 'authenticated', 'anon', 'service_role', or '' in the SQL editor.
create or replace function public.jwt_role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
                  nullif(current_setting('request.jwt.claim.role', true), ''), '')
$$;

create or replace function public.is_trusted_caller() returns boolean language sql stable as $$
  select public.jwt_role() not in ('authenticated', 'anon')
      or coalesce(current_setting('fitvive.trusted', true), '') = '1'
$$;

create or replace function public.has_access(p_user uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p where p.id = p_user and p.status = 'approved' and (
      p.role in ('admin', 'trainer')
      or exists (select 1 from subscriptions s where s.user_id = p.id and s.current_period_end > now())
      or exists (select 1 from companies c where c.id = p.company_id and c.active_until > now())
      or coalesce((select (value->>'free_access')::boolean from app_settings where key = 'access'), false)
    ))
$$;

create or replace function public.in_partnership(p_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from partnerships where id = p_id and status = 'accepted' and (a = auth.uid() or b = auth.uid()))
$$;

create or replace function public.goal_is_mine(p_goal uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from goals g where g.id = p_goal and public.in_partnership(g.partnership_id))
$$;

create or replace function public.in_session(p_session uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from session_participants where session_id = p_session and user_id = auth.uid())
$$;

create or replace function public.week_start() returns timestamptz language sql stable as $$
  select date_trunc('week', now() at time zone public.club_tz()) at time zone public.club_tz()
$$;

-- ---------------------------------------------------------------- new users and protected fields
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare v_company uuid; m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  select company_id into v_company from company_invites
    where lower(email) = lower(new.email) and status = 'invited' order by created_at limit 1;
  insert into profiles (id, email, full_name, phone, gender, referral_code, company_id, conduct_accepted_at)
  values (new.id, new.email, coalesce(m->>'full_name', ''), coalesce(m->>'phone', ''),
    case when m->>'gender' in ('female', 'male') then m->>'gender' else 'unspecified' end,
    nullif(m->>'referral_code', ''), v_company,
    case when m->>'conduct' = 'true' then now() end)
  on conflict (id) do nothing;
  if v_company is not null then
    update company_invites set status = 'joined', user_id = new.id
      where lower(email) = lower(new.email) and company_id = v_company and status = 'invited';
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Members cannot change their own role, status, company, email or gender. Their name locks once reviewed.
create or replace function public.guard_profile() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_trusted_caller() or public.is_admin() then return new; end if;
  if new.role is distinct from old.role or new.status is distinct from old.status
     or new.company_id is distinct from old.company_id or new.email is distinct from old.email
     or new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'You cannot change that field';
  end if;
  if old.status <> 'pending' and (new.full_name is distinct from old.full_name or new.gender is distinct from old.gender) then
    raise exception 'Ask the club to change your name or gender';
  end if;
  return new;
end $$;

drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update on public.profiles
  for each row execute function public.guard_profile();

-- ---------------------------------------------------------------- member cards (safe public view of approved members)
-- (defined in the social section further down)

-- ---------------------------------------------------------------- live rooms
-- Places the caller in a room of the session. Hosts (the trainer, or an admin) sit in room 0 and are shown in every room.
create or replace function public.join_session(p_session uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me profiles; s sessions; v_room int; v_last int; v_host boolean;
  v_size int := coalesce((select (value->>'size')::int from app_settings where key = 'room'), 6);
  v_window int := coalesce((select (value->>'join_window_min')::int from app_settings where key = 'room'), 5);
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null then raise exception 'Log in first'; end if;
  if me.status <> 'approved' then raise exception 'Your account is not approved'; end if;
  select * into s from sessions where id = p_session;
  if s.id is null then raise exception 'Session not found'; end if;
  if s.status <> 'scheduled' then raise exception 'This session has ended'; end if;
  v_host := coalesce(s.trainer_id = me.id, false) or me.role = 'admin';

  if not v_host then
    if not public.has_access(me.id) then raise exception 'NO_ACCESS'; end if;
    if now() < s.starts_at - make_interval(mins => v_window) then
      raise exception 'Join opens % minutes before the start', v_window;
    end if;
    if now() > s.starts_at + make_interval(mins => s.duration_min) then raise exception 'This session has ended'; end if;
    if s.women_only and me.gender <> 'female' then raise exception 'This session is for women only'; end if;
    if s.company_id is not null and me.company_id is distinct from s.company_id then
      raise exception 'This is a private company session';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_session::text));
  update session_participants set left_at = last_seen
    where session_id = p_session and left_at is null and last_seen < now() - interval '90 seconds';

  if v_host then
    insert into session_participants (session_id, user_id, room_no, is_host)
      values (p_session, me.id, 0, true)
      on conflict (session_id, user_id) do update set room_no = 0, is_host = true, left_at = null, last_seen = now();
    return jsonb_build_object('room_no', 0, 'is_host', true);
  end if;

  select room_no into v_room from session_participants
    where session_id = p_session and user_id = me.id and left_at is null;

  if v_room is null then
    -- 1. a room that already holds a workout partner or a colleague, if it has space
    select sp.room_no into v_room from session_participants sp
      where sp.session_id = p_session and sp.left_at is null and not sp.is_host
        and (exists (select 1 from partnerships pt where pt.status = 'accepted'
                      and ((pt.a = me.id and pt.b = sp.user_id) or (pt.b = me.id and pt.a = sp.user_id)))
             or (me.company_id is not null and exists (
                   select 1 from profiles p2 where p2.id = sp.user_id and p2.company_id = me.company_id)))
        and (select count(*) from session_participants x
              where x.session_id = p_session and x.left_at is null and not x.is_host and x.room_no = sp.room_no) < v_size
      limit 1;

    -- 2. otherwise the emptiest room that still has space, so rooms stay even
    if v_room is null then
      select r.room_no into v_room from (
        select room_no, count(*) as c from session_participants
          where session_id = p_session and left_at is null and not is_host group by room_no) r
        where r.c < v_size order by r.c asc, r.room_no asc limit 1;
    end if;

    -- 3. otherwise open a new room and bring the two newest members along, so nobody sits alone
    if v_room is null then
      select coalesce(max(room_no), 0) into v_last from session_participants
        where session_id = p_session and left_at is null and not is_host;
      v_room := v_last + 1;
      if v_last > 0 then
        update session_participants set room_no = v_room
          where session_id = p_session and user_id in (
            select user_id from session_participants
              where session_id = p_session and left_at is null and not is_host and room_no = v_last
              order by joined_at desc limit 2);
      end if;
    end if;

    insert into session_participants (session_id, user_id, room_no, is_host)
      values (p_session, me.id, v_room, false)
      on conflict (session_id, user_id) do update set room_no = excluded.room_no, is_host = false, left_at = null, last_seen = now();
  else
    update session_participants set last_seen = now() where session_id = p_session and user_id = me.id;
  end if;

  return jsonb_build_object('room_no', v_room, 'is_host', false);
end $$;

-- Called every 30 seconds while in a room. Adds training time and returns the caller's current room.
create or replace function public.heartbeat(p_session uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_room int;
begin
  update session_participants
    set seconds = seconds + least(60, greatest(0, extract(epoch from now() - last_seen)))::int, last_seen = now()
    where session_id = p_session and user_id = auth.uid() and left_at is null
    returning room_no into v_room;
  return v_room;
end $$;

create or replace function public.leave_session(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_room int; v_alone uuid; v_to int;
  v_size int := coalesce((select (value->>'size')::int from app_settings where key = 'room'), 6);
begin
  perform pg_advisory_xact_lock(hashtext(p_session::text));
  update session_participants set left_at = now()
    where session_id = p_session and user_id = auth.uid() and left_at is null
    returning room_no into v_room;
  if v_room is null or v_room = 0 then return; end if;
  -- if one member is left alone in that room, move them to another room with space
  if (select count(*) from session_participants where session_id = p_session and left_at is null and not is_host and room_no = v_room) = 1 then
    select user_id into v_alone from session_participants
      where session_id = p_session and left_at is null and not is_host and room_no = v_room;
    select r.room_no into v_to from (
      select room_no, count(*) as c from session_participants
        where session_id = p_session and left_at is null and not is_host and room_no <> v_room group by room_no) r
      where r.c < v_size order by r.c asc limit 1;
    if v_to is not null then
      update session_participants set room_no = v_to where session_id = p_session and user_id = v_alone;
    end if;
  end if;
end $$;

-- Who the caller should see: members get their own room plus the hosts; hosts get everyone.
create or replace function public.session_roster(p_session uuid)
returns table (user_id uuid, display_name text, room_no int, is_host boolean)
language plpgsql stable security definer set search_path = public as $$
declare mine session_participants;
begin
  select * into mine from session_participants sp where sp.session_id = p_session and sp.user_id = auth.uid();
  if mine.user_id is null and not public.is_admin() then return; end if;
  return query
    select sp.user_id, public.short_name(p.full_name), sp.room_no, sp.is_host
    from session_participants sp join profiles p on p.id = sp.user_id
    where sp.session_id = p_session and sp.left_at is null and sp.last_seen > now() - interval '90 seconds'
      and (coalesce(mine.is_host, true) or sp.is_host or sp.room_no = mine.room_no)
    order by sp.is_host desc, sp.room_no, sp.joined_at;
end $$;

create or replace function public.end_session(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or exists (select 1 from sessions where id = p_session and trainer_id = auth.uid())) then
    raise exception 'Only the trainer or an admin can end this session';
  end if;
  update sessions set status = 'ended' where id = p_session;
  update session_participants set left_at = now() where session_id = p_session and left_at is null;
end $$;

-- ---------------------------------------------------------------- streaks and ranking
create or replace function public.streak_of(p_user uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare d date := (now() at time zone public.club_tz())::date; n int := 0; v_has boolean;
begin
  select exists (select 1 from session_participants where user_id = p_user and not is_host and seconds >= 120
                  and (joined_at at time zone public.club_tz())::date = d) into v_has;
  if not v_has then d := d - 1; end if;
  loop
    select exists (select 1 from session_participants where user_id = p_user and not is_host and seconds >= 120
                    and (joined_at at time zone public.club_tz())::date = d) into v_has;
    exit when not v_has or n >= 3660;
    n := n + 1; d := d - 1;
  end loop;
  return n;
end $$;

create or replace function public.weekly_ranking()
returns table (user_id uuid, display_name text, minutes int, streak int)
language sql stable security definer set search_path = public as $$
  select sp.user_id, public.short_name(p.full_name), (sum(sp.seconds) / 60)::int, public.streak_of(sp.user_id)
  from session_participants sp join profiles p on p.id = sp.user_id
  where public.is_approved() and not sp.is_host and p.status = 'approved' and sp.joined_at >= public.week_start()
  group by sp.user_id, p.full_name
  having sum(sp.seconds) >= 60
  order by 3 desc
  limit 50
$$;

create or replace function public.my_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_secs int; v_rank int;
begin
  select coalesce(sum(seconds), 0) into v_secs from session_participants
    where user_id = auth.uid() and not is_host and joined_at >= public.week_start();
  select count(*) + 1 into v_rank from (
    select sp.user_id from session_participants sp
      where not sp.is_host and sp.joined_at >= public.week_start()
      group by sp.user_id having sum(sp.seconds) > v_secs) t;
  return jsonb_build_object('minutes', v_secs / 60, 'streak', public.streak_of(auth.uid()),
    'rank', case when v_secs >= 60 then v_rank end);
end $$;

-- ---------------------------------------------------------------- partners
create or replace function public.request_partner(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; me uuid := auth.uid();
begin
  if me is null or not public.is_approved() then raise exception 'Your account is not approved'; end if;
  if p_other = me then raise exception 'Pick another member'; end if;
  if not exists (select 1 from profiles where id = p_other and status = 'approved') then raise exception 'Member not found'; end if;
  insert into partnerships (a, b, requested_by) values (least(me, p_other), greatest(me, p_other), me)
    on conflict (a, b) do nothing returning id into v_id;
  if v_id is null then raise exception 'You are already partners, or a request is waiting'; end if;
  return v_id;
end $$;

create or replace function public.respond_partner(p_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare pt partnerships;
begin
  select * into pt from partnerships where id = p_id;
  if pt.id is null or auth.uid() not in (pt.a, pt.b) or pt.requested_by = auth.uid() or pt.status <> 'pending' then
    raise exception 'Request not found';
  end if;
  if p_accept then update partnerships set status = 'accepted' where id = p_id;
  else delete from partnerships where id = p_id; end if;
end $$;

-- ---------------------------------------------------------------- companies
create or replace function public.create_company(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me profiles; v_id uuid;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.status <> 'approved' then raise exception 'Your account is not approved'; end if;
  if me.company_id is not null then raise exception 'You already belong to a company'; end if;
  insert into companies (name, admin_id) values (trim(p_name), me.id) returning id into v_id;
  perform set_config('fitvive.trusted', '1', true);
  update profiles set company_id = v_id, role = case when role = 'member' then 'company_admin' else role end where id = me.id;
  perform set_config('fitvive.trusted', '', true);
  return v_id;
end $$;

create or replace function public.company_invite(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare c companies; v_used int; v_user uuid; v_email text := lower(trim(p_email));
begin
  select * into c from companies where admin_id = auth.uid();
  if c.id is null then raise exception 'You do not manage a company'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  if exists (select 1 from company_invites where company_id = c.id and lower(email) = v_email and status <> 'removed') then
    raise exception 'That person is already on your list';
  end if;
  select (select count(*) from profiles where company_id = c.id)
       + (select count(*) from company_invites where company_id = c.id and status = 'invited') into v_used;
  if v_used >= c.seats then raise exception 'All seats are used. Buy more seats first.'; end if;
  select id into v_user from profiles where lower(email) = v_email and company_id is null;
  if v_user is not null then
    perform set_config('fitvive.trusted', '1', true);
    update profiles set company_id = c.id where id = v_user;
    perform set_config('fitvive.trusted', '', true);
    insert into company_invites (company_id, email, user_id, status) values (c.id, v_email, v_user, 'joined');
  else
    insert into company_invites (company_id, email) values (c.id, v_email);
  end if;
end $$;

create or replace function public.company_remove(p_invite uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c companies; inv company_invites;
begin
  select * into c from companies where admin_id = auth.uid();
  select * into inv from company_invites where id = p_invite;
  if c.id is null or inv.id is null or inv.company_id <> c.id then raise exception 'Not found'; end if;
  update company_invites set status = 'removed' where id = p_invite;
  if inv.user_id is not null and inv.user_id <> c.admin_id then
    perform set_config('fitvive.trusted', '1', true);
    update profiles set company_id = null where id = inv.user_id and company_id = c.id;
    perform set_config('fitvive.trusted', '', true);
  end if;
end $$;

create or replace function public.company_staff()
returns table (invite_id uuid, email text, status text, full_name text, member_status text)
language sql stable security definer set search_path = public as $$
  select i.id, i.email, i.status, p.full_name, p.status
  from company_invites i
  join companies c on c.id = i.company_id and c.admin_id = auth.uid()
  left join profiles p on p.id = i.user_id
  where i.status <> 'removed'
  order by i.created_at
$$;

create or replace function public.book_company_session(p_title text, p_type text, p_starts timestamptz, p_duration int) returns uuid
language plpgsql security definer set search_path = public as $$
declare c companies; v_id uuid;
begin
  select * into c from companies where admin_id = auth.uid();
  if c.id is null then raise exception 'You do not manage a company'; end if;
  if c.active_until is null or c.active_until < now() then raise exception 'Your company plan is not active'; end if;
  if p_starts < now() then raise exception 'Pick a time in the future'; end if;
  insert into sessions (title, type, starts_at, duration_min, company_id, created_by)
    values (trim(p_title), p_type, p_starts, p_duration, c.id, auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- payments (called by the server functions only)
create or replace function public.apply_payment(p_reference text, p_amount int, p_email text, p_plan_code text) returns text
language plpgsql security definer set search_path = public as $$
declare pay payments; v_plan plans; v_user uuid; v_int interval;
begin
  if public.jwt_role() in ('authenticated', 'anon') then raise exception 'Not allowed'; end if;
  select * into pay from payments where reference = p_reference for update;
  if pay.reference is not null and pay.status = 'success' then return 'already'; end if;

  if pay.reference is null then
    -- a renewal charged by Paystack on a subscription plan: match it by plan code and email
    select * into v_plan from plans where paystack_plan_code is not null and paystack_plan_code = p_plan_code;
    select id into v_user from profiles where lower(email) = lower(p_email);
    if v_plan.key is null or v_user is null then return 'ignored'; end if;
    insert into payments (reference, user_id, kind, plan_key, amount_kobo) values (p_reference, v_user, 'member', v_plan.key, p_amount);
    select * into pay from payments where reference = p_reference;
  else
    select * into v_plan from plans where key = pay.plan_key;
    if p_amount < pay.amount_kobo then
      update payments set status = 'underpaid', paid_kobo = p_amount where reference = p_reference;
      return 'underpaid';
    end if;
  end if;

  v_int := case when v_plan.period = 'year' then interval '1 year' else interval '1 month' end;
  if pay.kind = 'company' then
    update companies set seats = pay.seats, active_until = greatest(now(), coalesce(active_until, now())) + v_int
      where id = pay.company_id;
  else
    insert into subscriptions (user_id, plan_key, current_period_end) values (pay.user_id, pay.plan_key, now() + v_int)
      on conflict (user_id) do update set plan_key = excluded.plan_key,
        current_period_end = greatest(now(), subscriptions.current_period_end) + v_int, updated_at = now();
  end if;
  if pay.discount_code is not null then update discount_codes set used = used + 1 where code = pay.discount_code; end if;
  update payments set status = 'success', paid_kobo = p_amount, paid_at = now() where reference = p_reference;
  return 'ok';
end $$;

-- ---------------------------------------------------------------- access rules (row level security)
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_invites enable row level security;
alter table public.plans enable row level security;
alter table public.discount_codes enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.app_settings enable row level security;
alter table public.sessions enable row level security;
alter table public.session_participants enable row level security;
alter table public.partnerships enable row level security;
alter table public.goals enable row level security;
alter table public.goal_checkins enable row level security;
alter table public.messages enable row level security;
alter table public.partner_calls enable row level security;
alter table public.reports enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

drop policy if exists companies_read on public.companies;
create policy companies_read on public.companies for select to authenticated
  using (admin_id = auth.uid() or id = public.my_company_id() or public.is_admin());
drop policy if exists companies_admin on public.companies;
create policy companies_admin on public.companies for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists invites_admin on public.company_invites;
create policy invites_admin on public.company_invites for select to authenticated using (public.is_admin());

drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select using (true);
drop policy if exists plans_admin on public.plans;
create policy plans_admin on public.plans for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists codes_admin on public.discount_codes;
create policy codes_admin on public.discount_codes for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists subs_read on public.subscriptions;
create policy subs_read on public.subscriptions for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists subs_admin on public.subscriptions;
create policy subs_admin on public.subscriptions for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists settings_read on public.app_settings;
create policy settings_read on public.app_settings for select using (true);
drop policy if exists settings_admin on public.app_settings;
create policy settings_admin on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists sessions_read on public.sessions;
create policy sessions_read on public.sessions for select to authenticated
  using (public.is_admin() or (public.is_approved() and (company_id is null or company_id = public.my_company_id() or trainer_id = auth.uid())));
drop policy if exists sessions_admin on public.sessions;
create policy sessions_admin on public.sessions for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists sp_read on public.session_participants;
create policy sp_read on public.session_participants for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.in_session(session_id));

drop policy if exists partnerships_read on public.partnerships;
create policy partnerships_read on public.partnerships for select to authenticated using (a = auth.uid() or b = auth.uid());
drop policy if exists partnerships_delete on public.partnerships;
create policy partnerships_delete on public.partnerships for delete to authenticated using (a = auth.uid() or b = auth.uid());

drop policy if exists goals_all on public.goals;
create policy goals_all on public.goals for all to authenticated
  using (public.in_partnership(partnership_id)) with check (public.in_partnership(partnership_id) and created_by = auth.uid());

drop policy if exists checkins_read on public.goal_checkins;
create policy checkins_read on public.goal_checkins for select to authenticated using (public.goal_is_mine(goal_id));
drop policy if exists checkins_insert on public.goal_checkins;
create policy checkins_insert on public.goal_checkins for insert to authenticated with check (user_id = auth.uid() and public.goal_is_mine(goal_id));
drop policy if exists checkins_delete on public.goal_checkins;
create policy checkins_delete on public.goal_checkins for delete to authenticated using (user_id = auth.uid());

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated using (public.in_partnership(partnership_id));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.in_partnership(partnership_id) and public.is_approved());

drop policy if exists calls_read on public.partner_calls;
create policy calls_read on public.partner_calls for select to authenticated using (from_id = auth.uid() or to_id = auth.uid());

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated with check (reporter_id = auth.uid() and public.is_approved());
drop policy if exists reports_admin on public.reports;
create policy reports_admin on public.reports for all to authenticated using (public.is_admin()) with check (public.is_admin());


-- ---------------------------------------------------------------- photo ID storage (private)
insert into storage.buckets (id, name, public) values ('id-docs', 'id-docs', false) on conflict (id) do nothing;

drop policy if exists "id docs upload own" on storage.objects;
create policy "id docs upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'id-docs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "id docs read own or admin" on storage.objects;
create policy "id docs read own or admin" on storage.objects for select to authenticated
  using (bucket_id = 'id-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------------------------------------------------------------- session video (YouTube)
alter table public.sessions add column if not exists video_url text;
alter table public.sessions add column if not exists video_state text;
alter table public.sessions add column if not exists video_offset numeric not null default 0;
alter table public.sessions add column if not exists video_started_at timestamptz;
alter table public.sessions drop constraint if exists sessions_video_state_check;
alter table public.sessions add constraint sessions_video_state_check check (video_state is null or video_state in ('playing', 'paused'));
alter table public.sessions drop constraint if exists sessions_video_url_check;
alter table public.sessions add constraint sessions_video_url_check check (
  video_url is null or video_url ~* '^https?://([a-z0-9-]+\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)/');

-- The database clock, so every phone plays the video at the same point.
create or replace function public.server_now() returns timestamptz language sql stable as $$ select now() $$;

-- Sets the video of a session, or controls it for everyone. Only the session's trainer or an admin.
-- p_url: a new link ('' removes the video). p_mode: 'play', 'pause' or 'auto' (follow the session clock).
create or replace function public.set_session_video(p_session uuid, p_url text default null, p_mode text default null, p_offset numeric default 0)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or exists (select 1 from sessions where id = p_session and trainer_id = auth.uid())) then
    raise exception 'Only the trainer or an admin can change this video';
  end if;
  if p_url is not null then
    if trim(p_url) <> '' and trim(p_url) !~* '^https?://([a-z0-9-]+\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)/' then
      raise exception 'Paste a YouTube link';
    end if;
    update sessions set video_url = nullif(trim(p_url), ''), video_state = null, video_offset = 0, video_started_at = null
      where id = p_session;
  end if;
  if p_mode = 'play' then
    update sessions set video_state = 'playing', video_offset = greatest(0, coalesce(p_offset, 0)), video_started_at = now() where id = p_session;
  elsif p_mode = 'pause' then
    update sessions set video_state = 'paused', video_offset = greatest(0, coalesce(p_offset, 0)), video_started_at = null where id = p_session;
  elsif p_mode = 'auto' then
    update sessions set video_state = null, video_offset = 0, video_started_at = null where id = p_session;
  end if;
end $$;

-- ---------------------------------------------------------------- social: profiles, online, direct messages

-- ---------------------------------------------------------------- profile details
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists state text;
alter table public.profiles add column if not exists area text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists last_active timestamptz;
alter table public.profiles add column if not exists show_online boolean not null default true;
do $$ begin
  alter table public.profiles add constraint profiles_social_len check (
    (bio is null or char_length(bio) <= 200) and (area is null or char_length(area) <= 60) and (state is null or char_length(state) <= 40));
exception when duplicate_object then null; end $$;

-- What members can see about each other. Online and live are hidden when a member turns off "Show when I am online".
create or replace view public.member_cards as
  select p.id, public.short_name(p.full_name) as display_name, p.role,
    p.avatar_path, p.state, p.area, p.bio,
    case when p.show_online then p.last_active end as last_active,
    (p.show_online and p.last_active > now() - interval '3 minutes') as online,
    (p.show_online and exists (
      select 1 from public.session_participants sp join public.sessions s on s.id = sp.session_id
      where sp.user_id = p.id and sp.left_at is null and sp.last_seen > now() - interval '90 seconds' and s.status = 'scheduled')) as live
  from public.profiles p
  where p.status = 'approved' and public.is_approved();
grant select on public.member_cards to authenticated;

-- The app calls this every minute while a member has Fitvive open.
create or replace function public.touch() returns void
language sql security definer set search_path = public as $$
  update profiles set last_active = now() where id = auth.uid() and status = 'approved';
$$;

create or replace function public.is_member(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = p_user and status = 'approved')
$$;

-- ---------------------------------------------------------------- blocking
create table if not exists public.blocks (
  blocker uuid not null references auth.users(id) on delete cascade,
  blocked uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
alter table public.blocks enable row level security;
drop policy if exists blocks_own on public.blocks;
create policy blocks_own on public.blocks for all to authenticated
  using (blocker = auth.uid()) with check (blocker = auth.uid());

create or replace function public.is_blocked(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker = p_a and blocked = p_b) or (blocker = p_b and blocked = p_a))
$$;

-- ---------------------------------------------------------------- direct messages
create table if not exists public.direct_messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);
create index if not exists dm_recipient on public.direct_messages(recipient_id, created_at);
create index if not exists dm_sender on public.direct_messages(sender_id, created_at);
alter table public.direct_messages enable row level security;

drop policy if exists dm_read on public.direct_messages;
create policy dm_read on public.direct_messages for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());
drop policy if exists dm_send on public.direct_messages;
create policy dm_send on public.direct_messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_approved() and public.is_member(recipient_id)
    and not public.is_blocked(sender_id, recipient_id));

-- No flooding: at most 20 messages a minute.
create or replace function public.dm_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from direct_messages where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'You are sending messages too fast. Wait a minute.';
  end if;
  new.created_at := now();
  new.read_at := null;
  return new;
end $$;
drop trigger if exists dm_rate_limit on public.direct_messages;
create trigger dm_rate_limit before insert on public.direct_messages for each row execute function public.dm_rate_limit();

create or replace function public.mark_read(p_other uuid) returns void
language sql security definer set search_path = public as $$
  update direct_messages set read_at = now() where recipient_id = auth.uid() and sender_id = p_other and read_at is null;
$$;

-- One row per conversation, newest first.
create or replace function public.dm_threads()
returns table (other_id uuid, display_name text, avatar_path text, last_body text, last_at timestamptz, last_from_me boolean, unread int)
language sql stable security definer set search_path = public as $$
  with mine as (
    select case when m.sender_id = auth.uid() then m.recipient_id else m.sender_id end as other, m.*
    from direct_messages m where m.sender_id = auth.uid() or m.recipient_id = auth.uid()),
  latest as (
    select distinct on (other) other, body, created_at, sender_id from mine order by other, created_at desc, id desc)
  select l.other, public.short_name(p.full_name), p.avatar_path, l.body, l.created_at, l.sender_id = auth.uid(),
    (select count(*)::int from mine m where m.other = l.other and m.recipient_id = auth.uid() and m.read_at is null)
  from latest l join profiles p on p.id = l.other
  where public.is_approved()
  order by l.created_at desc;
$$;

create or replace function public.unread_count() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from direct_messages where recipient_id = auth.uid() and read_at is null;
$$;

-- ---------------------------------------------------------------- profile photos (members only)
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', false) on conflict (id) do nothing;
drop policy if exists "avatars upload own" on storage.objects;
create policy "avatars upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars change own" on storage.objects;
create policy "avatars change own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars delete own" on storage.objects;
create policy "avatars delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars members read" on storage.objects;
create policy "avatars members read" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.is_approved());

-- ---------------------------------------------------------------- live updates for messages
do $$ begin
  alter publication supabase_realtime add table public.direct_messages;
exception when others then null; end $$;

-- ---------------------------------------------------------------- coach-led rep rounds

create table if not exists public.rep_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  exercise text not null check (exercise in ('squat', 'press_up', 'jumping_jack')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  started_by uuid references auth.users(id) on delete set null
);
create index if not exists rep_rounds_session on public.rep_rounds(session_id, started_at desc);

create table if not exists public.rep_scores (
  round_id uuid not null references public.rep_rounds(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reps int not null default 0 check (reps between 0 and 5000),
  started_at timestamptz not null default now(),
  last_rep_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (round_id, user_id)
);

alter table public.rep_rounds enable row level security;
alter table public.rep_scores enable row level security;
drop policy if exists rep_rounds_read on public.rep_rounds;
create policy rep_rounds_read on public.rep_rounds for select to authenticated
  using (public.in_session(session_id) or public.is_admin());
drop policy if exists rep_scores_read on public.rep_scores;
create policy rep_scores_read on public.rep_scores for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create or replace function public.can_lead(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from sessions where id = p_session and trainer_id = auth.uid())
$$;

-- The coach starts a round for everyone. Any round still open is closed first.
create or replace function public.start_rep_round(p_session uuid, p_exercise text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.can_lead(p_session) then raise exception 'Only the trainer can start a rep round'; end if;
  if p_exercise not in ('squat', 'press_up', 'jumping_jack') then raise exception 'Choose squats, press-ups or jumping jacks'; end if;
  update rep_rounds set ended_at = now() where session_id = p_session and ended_at is null;
  insert into rep_rounds (session_id, exercise, started_by) values (p_session, p_exercise, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.end_rep_round(p_session uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.can_lead(p_session) then raise exception 'Only the trainer can complete a rep round'; end if;
  update rep_rounds set ended_at = now() where session_id = p_session and ended_at is null returning id into v_id;
  return v_id;
end $$;

-- A member's phone reports its count. The time runs from when that member started counting
-- (late joiners start later) to their last rep. Counts that rise impossibly fast are capped.
create or replace function public.submit_reps(p_round uuid, p_reps int) returns int
language plpgsql security definer set search_path = public as $$
declare r rep_rounds; cur rep_scores; v_allowed int; v_reps int;
begin
  select * into r from rep_rounds where id = p_round;
  if r.id is null then raise exception 'Round not found'; end if;
  if r.ended_at is not null and r.ended_at < now() - interval '20 seconds' then raise exception 'This round is over'; end if;
  if not exists (select 1 from session_participants where session_id = r.session_id and user_id = auth.uid() and not is_host) then
    raise exception 'Join the session first';
  end if;
  select * into cur from rep_scores where round_id = p_round and user_id = auth.uid();
  if cur.round_id is null then
    v_reps := least(greatest(coalesce(p_reps, 0), 0), 5);
    insert into rep_scores (round_id, session_id, user_id, reps, last_rep_at)
      values (p_round, r.session_id, auth.uid(), v_reps, case when v_reps > 0 then now() end);
    return v_reps;
  end if;
  v_allowed := cur.reps + 4 + ceil(extract(epoch from now() - cur.updated_at) * 3)::int;
  v_reps := least(greatest(coalesce(p_reps, 0), cur.reps), v_allowed, 5000);
  update rep_scores set reps = v_reps, updated_at = now(),
    last_rep_at = case when v_reps > cur.reps then now() else last_rep_at end
    where round_id = p_round and user_id = auth.uid();
  return v_reps;
end $$;

-- Live and final results for everyone in the session: most reps first, then the quickest.
create or replace function public.rep_results(p_round uuid)
returns table (user_id uuid, display_name text, room_no int, reps int, seconds int, is_me boolean)
language sql stable security definer set search_path = public as $$
  select s.user_id, public.short_name(p.full_name), sp.room_no, s.reps,
    coalesce(extract(epoch from s.last_rep_at - s.started_at), 0)::int,
    s.user_id = auth.uid()
  from rep_scores s
  join rep_rounds r on r.id = s.round_id
  join profiles p on p.id = s.user_id
  left join session_participants sp on sp.session_id = s.session_id and sp.user_id = s.user_id
  where s.round_id = p_round and (public.in_session(r.session_id) or public.is_admin())
  order by s.reps desc, (s.last_rep_at - s.started_at) asc nulls last, p.full_name;
$$;

do $$ begin
  alter publication supabase_realtime add table public.rep_rounds;
exception when others then null; end $$;

-- ---------------------------------------------------------------- training time (minutes balance)

alter table public.profiles add column if not exists seconds_left int not null default 0;

create table if not exists public.time_grants (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  minutes int not null,
  note text,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists time_grants_user on public.time_grants(user_id, created_at desc);
alter table public.time_grants enable row level security;
drop policy if exists time_grants_read on public.time_grants;
create policy time_grants_read on public.time_grants for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Members cannot change their own balance.
create or replace function public.guard_profile() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_trusted_caller() or public.is_admin() then return new; end if;
  if new.role is distinct from old.role or new.status is distinct from old.status
     or new.company_id is distinct from old.company_id or new.email is distinct from old.email
     or new.id is distinct from old.id or new.created_at is distinct from old.created_at
     or new.seconds_left is distinct from old.seconds_left then
    raise exception 'You cannot change that field';
  end if;
  if old.status <> 'pending' and (new.full_name is distinct from old.full_name or new.gender is distinct from old.gender) then
    raise exception 'Ask the club to change your name or gender';
  end if;
  return new;
end $$;

create or replace function public.time_billing() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value->>'time_billing')::boolean from app_settings where key = 'access'), false)
$$;

-- Does this person pay with their minutes? (Not staff, not covered by a company.)
create or replace function public.pays_by_time(p_user uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.time_billing() and exists (
    select 1 from profiles p where p.id = p_user and p.role not in ('admin', 'trainer')
      and not exists (select 1 from companies c where c.id = p.company_id and c.active_until > now()))
$$;

create or replace function public.has_access(p_user uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p where p.id = p_user and p.status = 'approved' and (
      p.role in ('admin', 'trainer')
      or exists (select 1 from companies c where c.id = p.company_id and c.active_until > now())
      or case when public.time_billing() then p.seconds_left > 0
         else exists (select 1 from subscriptions s where s.user_id = p.id and s.current_period_end > now())
           or coalesce((select (value->>'free_access')::boolean from app_settings where key = 'access'), false)
         end
    ))
$$;

-- Admin adds minutes (a negative number takes minutes back). Returns the new balance in minutes.
create or replace function public.add_minutes(p_user uuid, p_minutes int, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_left int;
begin
  if not public.is_admin() then raise exception 'Only club admins can add minutes'; end if;
  if p_minutes is null or p_minutes = 0 or abs(p_minutes) > 100000 then raise exception 'Enter a number of minutes'; end if;
  insert into time_grants (user_id, minutes, note, added_by) values (p_user, p_minutes, nullif(trim(p_note), ''), auth.uid());
  update profiles set seconds_left = greatest(0, seconds_left + p_minutes * 60) where id = p_user returning seconds_left into v_left;
  if v_left is null then raise exception 'Member not found'; end if;
  return v_left / 60;
end $$;

-- Called every 30 seconds while in a room: adds training time, and uses up the member's minutes.
-- Returns the room number, or -1 when the member's minutes have run out.
create or replace function public.heartbeat(p_session uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_room int; v_delta int; v_host boolean; v_left int;
begin
  select least(60, greatest(0, extract(epoch from now() - last_seen)))::int, is_host into v_delta, v_host
    from session_participants where session_id = p_session and user_id = auth.uid() and left_at is null;
  if v_delta is null then return null; end if;
  update session_participants set seconds = seconds + v_delta, last_seen = now()
    where session_id = p_session and user_id = auth.uid() and left_at is null
    returning room_no into v_room;
  if not v_host and public.pays_by_time(auth.uid()) then
    perform set_config('fitvive.trusted', '1', true);
    update profiles set seconds_left = greatest(0, seconds_left - v_delta) where id = auth.uid() returning seconds_left into v_left;
    perform set_config('fitvive.trusted', '', true);
    if v_left <= 0 then return -1; end if;
  end if;
  return v_room;
end $$;

-- ---------------------------------------------------------------- live updates
do $$
declare t text;
begin
  foreach t in array array['messages', 'session_participants', 'partner_calls', 'sessions', 'partnerships'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when others then null;
    end;
  end loop;
end $$;
