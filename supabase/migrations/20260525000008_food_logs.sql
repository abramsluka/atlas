create table if not exists food_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  date          date not null,
  storage_path  text not null,
  item_name     text not null,
  calories      int,
  protein_g     numeric(6,1),
  carbs_g       numeric(6,1),
  confidence    text check (confidence in ('low','medium','high')),
  ai_raw        jsonb,
  notes         text,
  taken_at      timestamptz default now(),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table food_logs enable row level security;

do $$ begin
  drop policy if exists "food_logs_own" on food_logs;
end $$;

create policy "food_logs_own" on food_logs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists food_logs_user_date on food_logs (user_id, date desc);

alter table health_profile add column if not exists target_weight_lbs numeric(5,1);
alter table health_profile add column if not exists cut_pace text check (cut_pace in ('slow','moderate','aggressive'));
alter table health_profile add column if not exists daily_calorie_target int;
alter table health_profile add column if not exists daily_protein_target_g int;
alter table health_profile add column if not exists daily_carbs_target_g int;
alter table health_profile add column if not exists target_reasoning text;
alter table health_profile add column if not exists target_calc_weight_lbs numeric(5,1);
alter table health_profile add column if not exists target_calculated_at timestamptz;
alter table health_profile add column if not exists linked_target_goal_id uuid references goals(id) on delete set null;
