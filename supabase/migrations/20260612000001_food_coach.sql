-- Food coach: per-meal AI feedback + daily thread

-- Per-meal inline coach blurb (1:1 with food_logs)
alter table food_logs add column if not exists coach_feedback text;

-- Daily coach thread (Today's Fuel summary + Ask your coach Q&A)
create table if not exists food_coach_messages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  date          date not null,
  role          text not null check (role in ('user', 'assistant')),
  content       text not null,
  chip_label    text,
  is_summary    boolean not null default false,
  created_at    timestamptz not null default now()
);
alter table food_coach_messages enable row level security;
create policy "food_coach_own" on food_coach_messages for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists food_coach_messages_user_date
  on food_coach_messages (user_id, date, created_at);
