-- Tape measurements for US Navy body fat calculation
create table body_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  date_key text not null,
  neck_in float not null,
  waist_in float not null,
  hip_in float,
  bf_pct float not null,
  created_at timestamptz not null default now(),
  unique (user_id, date_key)
);

alter table body_measurements enable row level security;

create policy "Users manage own body_measurements"
  on body_measurements for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
