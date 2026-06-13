create table if not exists daily_briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, date)
);

alter table daily_briefings enable row level security;

create policy "Users manage own briefings" on daily_briefings
  for all using (auth.uid() = user_id);
