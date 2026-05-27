create table if not exists journal_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        date not null default current_date,
  title       text,
  body        text not null,
  mood        int check (mood between 1 and 5),
  ai_reflection text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table journal_entries enable row level security;

do $$ begin
  drop policy if exists "journal_entries_own" on journal_entries;
end $$;

create policy "journal_entries_own"
  on journal_entries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists journal_entries_user_date
  on journal_entries (user_id, date desc);
