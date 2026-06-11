-- Fitness goal + activity level on health_profile

alter table health_profile
  add column if not exists fitness_goal text
    check (fitness_goal in ('cut', 'recomp', 'lean_bulk', 'maintain'));

alter table health_profile
  add column if not exists activity_level text
    check (activity_level in ('sedentary', 'light', 'moderate', 'very_active'));

-- Existing users are on a cut (the only flow that existed before)
update health_profile set fitness_goal = 'cut' where fitness_goal is null and cut_pace is not null;
