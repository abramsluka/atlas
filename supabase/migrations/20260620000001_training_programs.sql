-- ============================================================
-- AI-generated training programs (periodization layer)
-- Distinct from the PO tracker (owns weight) and split rotation
-- (owns "today's day"). A program adds week-by-week prescription.
-- ============================================================

create table if not exists training_programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,                       -- "8-Week Hypertrophy Block"
  goal text not null,                       -- 'strength' | 'hypertrophy' | 'recomp'
  duration_weeks int not null,              -- 4, 6, or 8
  days_per_week int not null,               -- 3, 4, or 5
  structure text not null default 'overlay',-- 'overlay' (maps to existing days) | 'standalone'
  status text not null default 'active',    -- 'active' | 'completed' | 'archived'
  start_date date,
  notes text,
  created_at timestamptz default now()
);

create table if not exists program_sessions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references training_programs(id) on delete cascade,
  week_number int not null,                 -- 1..duration_weeks
  session_number int not null,              -- 1..days_per_week (order within the week)
  label text not null,                      -- "Push", "Legs A"
  day_id text,                              -- overlay mode: maps to gym_config.days[].id; null = standalone
  phase text,                               -- 'accumulation' | 'deload' | 'intensification' | 'peak'
  exercises jsonb not null default '[]'::jsonb,
  -- exercises shape (periodization only — no weight; PO engine owns that):
  -- [{ exercise_id: uuid|null, name, sets, rep_min, rep_max, rpe: number|null, notes: string|null, is_new: bool }]
  created_at timestamptz default now()
);

create index if not exists idx_training_programs_user on training_programs(user_id, status);
create index if not exists idx_program_sessions_program on program_sessions(program_id, week_number, session_number);

alter table training_programs enable row level security;
alter table program_sessions enable row level security;

create policy "Users access own programs" on training_programs
  for all using (auth.uid() = user_id);

-- Sessions inherit access via their parent program.
create policy "Users access own program sessions" on program_sessions
  for all using (
    exists (select 1 from training_programs p where p.id = program_id and p.user_id = auth.uid())
  );
