-- ============================================================
-- Apple Health sync (iOS Shortcuts bridge).
-- IN:  steps, active energy, VO2 max (daily) + cardio workouts.
-- OUT: body weight + nutrition are read from existing tables.
-- Auth: a long-lived per-user sync_token (Bearer) on user_settings.
-- ============================================================

-- Long-lived sync token for the Shortcut's Bearer auth.
alter table user_settings add column if not exists sync_token text unique;
alter table user_settings add column if not exists sync_token_created_at timestamptz;

-- Daily aggregates pulled from Apple Health.
create table if not exists apple_health_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  steps int,
  active_calories int,
  vo2_max numeric,
  synced_at timestamptz default now(),
  unique(user_id, date)
);

-- Individual cardio / non-lifting workouts (not in gym_logs).
create table if not exists apple_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_type text,
  start_time timestamptz not null,
  date date,
  duration_min numeric,
  distance_mi numeric,
  active_calories int,
  synced_at timestamptz default now(),
  unique(user_id, start_time)
);

create index if not exists idx_apple_health_logs_user_date on apple_health_logs(user_id, date desc);
create index if not exists idx_apple_workouts_user_date on apple_workouts(user_id, date desc);

alter table apple_health_logs enable row level security;
alter table apple_workouts enable row level security;

create policy "Users access own apple health logs" on apple_health_logs
  for all using (auth.uid() = user_id);
create policy "Users access own apple workouts" on apple_workouts
  for all using (auth.uid() = user_id);
