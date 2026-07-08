-- Habit tracker: definitions + manual completion ticks.
--
-- Auto habits (kind='auto') derive their done-days from source tables at read
-- time (see src/lib/habits/compute.ts) — nothing is stored for them. Manual
-- habits store one row per ticked day in habit_completions. A completion row on
-- an auto habit is a manual OVERRIDE that unions in (e.g. logging a climb the
-- Apple shortcut never saw). completed=false is represented by the absence of a
-- row, so un-ticking a manual day deletes it.

create table if not exists habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  emoji text,
  kind text not null default 'manual' check (kind in ('auto', 'manual')),
  source text,                                     -- auto habits only: 'water' | 'cardio' | ...
  cadence jsonb not null default '{"per_week": 7}'::jsonb,
  order_index int not null default 0,
  active boolean not null default true,
  created_at timestamptz default now(),
  archived_at timestamptz
);

create table if not exists habit_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references habits(id) on delete cascade,
  date date not null,                              -- local calendar day (YYYY-MM-DD)
  completed boolean not null default true,
  created_at timestamptz default now(),
  unique(user_id, habit_id, date)
);

create index if not exists idx_habits_user_order on habits(user_id, order_index);
create index if not exists idx_habit_completions_user_date on habit_completions(user_id, date desc);
create index if not exists idx_habit_completions_habit on habit_completions(habit_id);

alter table habits enable row level security;
alter table habit_completions enable row level security;

create policy "users manage own habits" on habits for all using (auth.uid() = user_id);
create policy "users manage own habit_completions" on habit_completions for all using (auth.uid() = user_id);
