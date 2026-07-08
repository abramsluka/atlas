-- gym_sessions: one row per user per training day, capturing the workout's
-- start and end time. Server-maintained from gym_logs: started_at is the first
-- set of the day, ended_at the most recent. date_key is the LA calendar day
-- (matches how the Gym history groups sets).
create table if not exists gym_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date_key text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  created_at timestamptz default now(),
  unique(user_id, date_key)
);

alter table gym_sessions enable row level security;

create policy "users manage own gym_sessions" on gym_sessions for all using (auth.uid() = user_id);

-- Backfill from existing set logs so past workouts get times immediately.
insert into gym_sessions (user_id, date_key, started_at, ended_at)
select
  user_id,
  (logged_at at time zone 'America/Los_Angeles')::date::text as date_key,
  min(logged_at) as started_at,
  max(logged_at) as ended_at
from gym_logs
group by user_id, (logged_at at time zone 'America/Los_Angeles')::date
on conflict (user_id, date_key) do nothing;
