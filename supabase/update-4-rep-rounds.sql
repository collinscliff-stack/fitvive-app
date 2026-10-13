-- Fitvive update 4: coach-led rep rounds. The coach starts a round (squats, press-ups or jumping jacks),
-- every member's phone counts their reps, and when the coach completes the round the results are final:
-- most reps first, then the fastest time. Safe to run more than once.

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
