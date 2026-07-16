-- Exercise library: global read-only reference table seeded from free-exercise-db
-- plus one-time AI enrichment. First shared (non per-user) table in the app.

create table if not exists exercise_library (
  id text primary key,                     -- dataset slug, e.g. 'Barbell_Bench_Press_-_Medium_Grip'; doubles as image folder
  name text not null,
  aliases text[] not null default '{}',
  category text,
  equipment text,
  level text,
  mechanic text,
  force text,
  primary_muscles text[] not null default '{}',
  secondary_muscles text[] not null default '{}',
  instructions text[] not null default '{}',
  image_paths text[] not null default '{}',  -- bucket-relative, e.g. '<slug>/0.jpg'
  -- AI-enriched Atlas fields
  bodyweight boolean not null default false,
  default_goal text not null default 'hypertrophy',  -- strength | hypertrophy | endurance
  rep_min integer not null default 8,
  rep_max integer not null default 12,
  step numeric not null default 2.5,
  start_weight_ratio numeric,              -- beginner working weight / body weight; null for non-loaded movements
  female_factor numeric,                   -- multiplier applied when health_profile.sex = 'f'; null if no ratio
  popularity integer not null default 0,   -- 0-100 search ranking
  enriched_at timestamptz,                 -- null = enrichment pending (resume checkpoint)
  created_at timestamptz default now()
);

alter table exercise_library enable row level security;

do $$ begin
  drop policy if exists "authenticated read exercise_library" on exercise_library;
  create policy "authenticated read exercise_library" on exercise_library
    for select to authenticated using (true);
end $$;
-- no insert/update/delete policies: only the service role (seed scripts) writes

alter table gym_exercises add column if not exists
  library_id text references exercise_library(id) on delete set null;

-- Public bucket for the public-domain demo photos (plain URLs, no signing)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-images', 'exercise-images', true, 2097152, array['image/jpeg'])
on conflict (id) do nothing;
