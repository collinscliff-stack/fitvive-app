-- Fitvive update 2: a YouTube video members follow in a session.
-- Paste into Supabase > SQL Editor and press Run. Safe to run more than once.

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
