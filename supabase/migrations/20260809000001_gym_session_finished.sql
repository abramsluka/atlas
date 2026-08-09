-- Server-side "workout is finished" marker.
--
-- Until now "Finish Workout" only wrote localStorage, so nothing server-side
-- could tell a workout in progress from a finished one — the training streak
-- banked the day on the very first set, and the AI coaches kept telling Luka to
-- go train while he was mid-session.
--
-- finished_at is set when he taps Finish Workout, and cleared by syncGymSession
-- whenever a later set lands (logging again means the workout resumed). A
-- session with no finished_at is still treated as finished once it goes cold
-- (SESSION_IDLE_MS with no set), so a forgotten tap never costs a streak day.
alter table gym_sessions add column if not exists finished_at timestamptz;

-- Every session that already exists is, by definition, over.
update gym_sessions set finished_at = ended_at where finished_at is null;
