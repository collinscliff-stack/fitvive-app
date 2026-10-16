-- Fitvive update 6: more exercises for rep rounds (bicep curls, shoulder press, lateral raises,
-- chest press and bench press). Safe to run more than once.

alter table public.rep_rounds drop constraint if exists rep_rounds_exercise_check;
alter table public.rep_rounds add constraint rep_rounds_exercise_check check (exercise in
  ('squat', 'press_up', 'jumping_jack', 'bicep_curl', 'shoulder_press', 'lateral_raise', 'chest_press', 'bench_press'));

create or replace function public.start_rep_round(p_session uuid, p_exercise text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.can_lead(p_session) then raise exception 'Only the trainer can start a rep round'; end if;
  if p_exercise not in ('squat', 'press_up', 'jumping_jack', 'bicep_curl', 'shoulder_press', 'lateral_raise', 'chest_press', 'bench_press') then
    raise exception 'Choose an exercise from the list';
  end if;
  update rep_rounds set ended_at = now() where session_id = p_session and ended_at is null;
  insert into rep_rounds (session_id, exercise, started_by) values (p_session, p_exercise, auth.uid()) returning id into v_id;
  return v_id;
end $$;
