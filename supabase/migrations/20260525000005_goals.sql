create table if not exists goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  type          text not null check (type in ('habit', 'oneoff', 'numeric')),
  title         text not null,
  description   text,
  target_value  float,
  current_value float default 0,
  unit          text,
  due_date      date,
  completed_at  timestamptz,
  order_index   int default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table if not exists habit_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  goal_id    uuid not null references goals(id) on delete cascade,
  date       date not null default current_date,
  created_at timestamptz default now(),
  unique (goal_id, date)
);

alter table goals enable row level security;
alter table habit_logs enable row level security;

do $$ begin
  drop policy if exists "goals_own" on goals;
  drop policy if exists "habit_logs_own" on habit_logs;
end $$;

create policy "goals_own" on goals for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "habit_logs_own" on habit_logs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists goals_user_idx on goals (user_id, order_index);
create index if not exists habit_logs_goal_date on habit_logs (goal_id, date desc);
