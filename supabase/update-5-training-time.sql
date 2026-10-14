-- Fitvive update 5: training time. Members hold a balance of minutes; live sessions use it up.
-- Admins can add (or take back) minutes by hand. Charging by time is switched on in Fees and access.
-- Safe to run more than once.

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
