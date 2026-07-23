-- Short display name for the horizontal exercise rail (e.g. "Smith Bench").
-- The full name stays in exercise_library.name and shows in the info sheet.
alter table exercise_library add column if not exists short_name text;
