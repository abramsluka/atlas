-- gym_config: one row per user, stores gyms/days/split/settings
create table if not exists gym_config (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  gyms jsonb not null default '[{"id":"g_default","name":"Gym"}]'::jsonb,
  days jsonb not null default '[{"id":"d_push","name":"Push"},{"id":"d_pull","name":"Pull"},{"id":"d_legs","name":"Legs"}]'::jsonb,
  split_rotation text[] not null default array['Push','Pull','Legs','Rest'],
  split_anchor jsonb,
  units text not null default 'lbs',
  upgrade_at_reps integer not null default 12,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- gym_exercises
create table if not exists gym_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  gym_id text not null default 'both',
  day_id text not null default '',
  bodyweight boolean not null default false,
  start_weight numeric not null default 0,
  rep_min integer not null default 6,
  rep_max integer not null default 8,
  step numeric not null default 2.5,
  order_index integer not null default 0,
  created_at timestamptz default now()
);

-- gym_logs: individual set logs
create table if not exists gym_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid not null references gym_exercises(id) on delete cascade,
  weight numeric not null default 0,
  reps integer not null,
  logged_at timestamptz default now()
);

-- body_weights: one entry per day per user
create table if not exists body_weights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date_key text not null,
  weight numeric not null,
  created_at timestamptz default now(),
  unique(user_id, date_key)
);

-- RLS
alter table gym_config enable row level security;
alter table gym_exercises enable row level security;
alter table gym_logs enable row level security;
alter table body_weights enable row level security;

create policy "users manage own gym_config" on gym_config for all using (auth.uid() = user_id);
create policy "users manage own gym_exercises" on gym_exercises for all using (auth.uid() = user_id);
create policy "users manage own gym_logs" on gym_logs for all using (auth.uid() = user_id);
create policy "users manage own body_weights" on body_weights for all using (auth.uid() = user_id);
