-- Fitvive update 3: member profiles (photo and location), who is online, and direct messages between members.
-- Safe to run more than once.

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
