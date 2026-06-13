create table if not exists energy_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  logged_at timestamptz not null default now(),
  date_key text not null,
  rating int not null check (rating >= 0 and rating <= 100),
  predicted int,
  created_at timestamptz default now()
);

create index if not exists energy_ratings_user_date on energy_ratings (user_id, date_key);

alter table energy_ratings enable row level security;

create policy "users manage own energy ratings"
  on energy_ratings for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
