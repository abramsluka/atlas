-- Supplements
create table supplements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  dose text,
  times text[] not null default '{}',
  running_low boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Daily supplement logs
create table supplement_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  supplement_id uuid references supplements not null,
  date text not null,
  time_slot text not null,
  taken_at timestamptz not null default now(),
  unique (supplement_id, date, time_slot)
);

-- Water logs
create table water_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  date text not null,
  amount_oz float not null,
  logged_at timestamptz not null default now()
);

-- User health profile
create table health_profile (
  user_id uuid primary key references auth.users,
  weight_lbs float,
  daily_water_target_oz float,
  updated_at timestamptz not null default now()
);

-- Caffeine logs
create table caffeine_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  date text not null,
  source text not null,
  amount_mg float not null,
  logged_at timestamptz not null default now()
);

-- Wearable OAuth tokens
create table wearable_tokens (
  user_id uuid references auth.users not null,
  provider text not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  primary key (user_id, provider)
);

-- Wearable daily data cache
create table wearable_data (
  user_id uuid references auth.users not null,
  provider text not null,
  date text not null,
  data jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (user_id, provider, date)
);

-- RLS
alter table supplements enable row level security;
create policy "supplements_own" on supplements for all using (auth.uid() = user_id);

alter table supplement_logs enable row level security;
create policy "supplement_logs_own" on supplement_logs for all using (auth.uid() = user_id);

alter table water_logs enable row level security;
create policy "water_logs_own" on water_logs for all using (auth.uid() = user_id);

alter table health_profile enable row level security;
create policy "health_profile_own" on health_profile for all using (auth.uid() = user_id);

alter table caffeine_logs enable row level security;
create policy "caffeine_logs_own" on caffeine_logs for all using (auth.uid() = user_id);

alter table wearable_tokens enable row level security;
create policy "wearable_tokens_own" on wearable_tokens for all using (auth.uid() = user_id);

alter table wearable_data enable row level security;
create policy "wearable_data_own" on wearable_data for all using (auth.uid() = user_id);
