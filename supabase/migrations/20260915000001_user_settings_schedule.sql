-- Wake and sleep clock times the user sets in Settings. Local wall-clock
-- (interpreted in the user's timezone); null = let each surface use its own
-- default. The wake time replaces the wearable-derived typical wake as the
-- energy model's fallback (a real measured wake from last night still wins),
-- and both drive the home day ring and the energy curve's end of day.
alter table user_settings
  add column if not exists wake_time time,
  add column if not exists sleep_time time;
