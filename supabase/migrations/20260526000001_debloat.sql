create table if not exists debloat_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        date not null,
  bloat_level int check (bloat_level between 1 and 5),
  checklist   jsonb default '{}',
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (user_id, date)
);

alter table debloat_logs enable row level security;

do $$ begin
  drop policy if exists "debloat_logs_own" on debloat_logs;
end $$;

create policy "debloat_logs_own" on debloat_logs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists debloat_logs_user_date on debloat_logs (user_id, date desc);
