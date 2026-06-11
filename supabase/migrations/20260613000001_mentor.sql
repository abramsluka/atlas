-- ============================================================
-- MENTOR MIGRATION
-- Tables: jots, mentor_memories, mentor_context,
--         weekly_reports, jot_syntheses
-- ============================================================

-- Quick-capture thoughts ("The Void")
create table if not exists jots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz default now()
);
alter table jots enable row level security;
create policy "Users access own jots" on jots
  for all using (auth.uid() = user_id);

-- Per-session memory summaries (rolling, capped at 20)
create table if not exists mentor_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  summary text not null,
  created_at timestamptz default now()
);
alter table mentor_memories enable row level security;
create policy "Users access own memories" on mentor_memories
  for all using (auth.uid() = user_id);

-- Living user profile (one row per user, upserted after each session)
create table if not exists mentor_context (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  primary_goal text,
  about_me text,
  goal_last_comment text,
  last_synthesized_at timestamptz,
  updated_at timestamptz default now()
);
alter table mentor_context enable row level security;
create policy "Users access own context" on mentor_context
  for all using (auth.uid() = user_id);

-- Weekly synthesis reports
create table if not exists weekly_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_of date not null,
  report_text text not null,
  created_at timestamptz default now(),
  unique(user_id, week_of)
);
alter table weekly_reports enable row level security;
create policy "Users access own weekly reports" on weekly_reports
  for all using (auth.uid() = user_id);

-- Jot synthesis cards
create table if not exists jot_syntheses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  synthesis_text text not null,
  jot_count integer not null,
  created_at timestamptz default now()
);
alter table jot_syntheses enable row level security;
create policy "Users access own syntheses" on jot_syntheses
  for all using (auth.uid() = user_id);

-- ============================================================
-- NOTE: The goals table is NOT dropped because health_profile
-- has a FK: health_profile.linked_target_goal_id → goals(id)
-- To fully remove goals, first run:
--   ALTER TABLE health_profile DROP COLUMN linked_target_goal_id;
--   DROP TABLE IF EXISTS habit_logs;
--   DROP TABLE IF EXISTS goals;
-- The Goals UI has been removed but the data tables remain.
-- ============================================================
