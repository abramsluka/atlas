-- Pinned correlation insights (Mentor → Insights tab).
-- insight_id is the deterministic Insight slug from computeCorrelations.ts.

create table if not exists insight_pins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  insight_id text not null,
  created_at timestamptz default now(),
  unique(user_id, insight_id)
);

alter table insight_pins enable row level security;

create policy "Users access own insight pins" on insight_pins
  for all using (auth.uid() = user_id);
