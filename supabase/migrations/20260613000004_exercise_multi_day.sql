-- Allow exercises to appear on multiple training days
ALTER TABLE gym_exercises
  ALTER COLUMN day_id SET DEFAULT '',
  ADD COLUMN IF NOT EXISTS day_ids text[] NOT NULL DEFAULT '{}';

-- Migrate existing single-day assignments
UPDATE gym_exercises
SET day_ids = ARRAY[day_id]
WHERE day_ids = '{}' AND day_id != '';
