-- Demo account nightly reset.
--
-- demo_reset() wipes every row the demo user owns (EXCEPT user_settings and
-- user_secrets — name + API keys survive) and reseeds a realistic trailing
-- week, dated relative to current_date so the demo never goes stale. Scheduled
-- nightly at 11:00 UTC (~4am ET / 3am CT / 1am PT) via pg_cron so reviewers
-- can poke at the account freely and it self-heals every morning.
--
-- Run on demand any time with:  select public.demo_reset();

create or replace function public.demo_reset()
returns void
language plpgsql
as $$
declare
  uid constant uuid := 'cbe1c53a-087f-46ac-836e-c93beb5ceef7';  -- the demo account
  ex_bench uuid; ex_ohp uuid; ex_row uuid; ex_pull uuid; ex_squat uuid; ex_rdl uuid;
  sup_creatine uuid; sup_fish uuid; sup_mag uuid;
  h_bed uuid; h_workout uuid; h_read uuid; h_meditate uuid; h_walk uuid;
begin
  -- ── Wipe (children before parents; keeps user_settings + user_secrets) ──
  delete from supplement_logs        where user_id = uid;
  delete from supplements            where user_id = uid;
  delete from habit_completions      where user_id = uid;
  delete from habit_logs             where user_id = uid;
  delete from habits                 where user_id = uid;
  delete from gym_logs               where user_id = uid;
  delete from gym_sessions           where user_id = uid;
  delete from gym_exercises          where user_id = uid;
  delete from gym_config             where user_id = uid;
  delete from po_logs                where user_id = uid;
  delete from po_exercises           where user_id = uid;
  delete from po_user_config         where user_id = uid;
  delete from sets                   where user_id = uid;
  delete from exercises              where user_id = uid;
  delete from workout_coach_responses where user_id = uid;
  delete from workouts               where user_id = uid;
  delete from training_programs      where user_id = uid;
  delete from mentor_messages        where user_id = uid;
  delete from mentor_conversations   where user_id = uid;
  delete from mentor_context         where user_id = uid;
  delete from jot_syntheses          where user_id = uid;
  delete from jots                   where user_id = uid;
  delete from journal_entries        where user_id = uid;
  delete from insight_pins           where user_id = uid;
  delete from food_coach_messages    where user_id = uid;
  delete from food_logs              where user_id = uid;
  delete from food_items             where user_id = uid;
  delete from saved_meals            where user_id = uid;
  delete from user_ingredients       where user_id = uid;
  delete from water_logs             where user_id = uid;
  delete from caffeine_logs          where user_id = uid;
  delete from body_weights           where user_id = uid;
  delete from body_weight_logs       where user_id = uid;
  delete from body_measurements      where user_id = uid;
  delete from progress_photos        where user_id = uid;
  delete from health_profile         where user_id = uid;
  delete from wearable_data          where user_id = uid;
  delete from wearable_tokens        where user_id = uid;
  delete from apple_health_logs      where user_id = uid;
  delete from apple_workouts         where user_id = uid;
  delete from daily_checkins         where user_id = uid;
  delete from daily_briefings        where user_id = uid;
  delete from todays_call            where user_id = uid;
  delete from weekly_reports         where user_id = uid;
  delete from debloat_logs           where user_id = uid;
  delete from energy_ratings         where user_id = uid;
  delete from goals                  where user_id = uid;
  delete from subscriptions          where user_id = uid;
  delete from orb_chip_cache         where user_id = uid;
  delete from orb_commands           where user_id = uid;
  delete from user_profile_facts     where user_id = uid;
  delete from mcp_auth_codes         where user_id = uid;
  delete from mcp_tokens             where user_id = uid;

  -- ── Health profile (gives food page real targets/progress bars) ──
  insert into health_profile (user_id, weight_lbs, target_weight_lbs, daily_water_target_oz,
    daily_calorie_target, daily_protein_target_g, daily_carbs_target_g, weight_unit, show_oura)
  values (uid, 173, 168, 80, 2400, 160, 250, 'lbs', true);

  -- ── Habits + a realistically imperfect week of completions ──
  insert into habits (user_id, name, emoji, kind, cadence, order_index, active) values
    (uid,'Make bed','🛏️','manual','{"per_week": 7}',1,true) returning id into h_bed;
  insert into habits (user_id, name, emoji, kind, cadence, order_index, active) values
    (uid,'Workout','💪','manual','{"per_week": 4}',2,true) returning id into h_workout;
  insert into habits (user_id, name, emoji, kind, cadence, order_index, active) values
    (uid,'Read','📖','manual','{"per_week": 5}',3,true) returning id into h_read;
  insert into habits (user_id, name, emoji, kind, cadence, order_index, active) values
    (uid,'Meditate','🧘','manual','{"per_week": 7}',4,true) returning id into h_meditate;
  insert into habits (user_id, name, emoji, kind, cadence, order_index, active) values
    (uid,'Evening walk','🚶','manual','{"per_week": 7}',5,true) returning id into h_walk;

  insert into habit_completions (user_id, habit_id, date, completed)
  select uid, h, current_date - d, true
  from (values
    (6,'bed'),(6,'workout'),(6,'read'),(6,'meditate'),(6,'walk'),
    (5,'bed'),(5,'meditate'),(5,'walk'),
    (4,'bed'),(4,'workout'),(4,'read'),(4,'walk'),
    (3,'bed'),(3,'workout'),(3,'read'),(3,'meditate'),(3,'walk'),
    (2,'bed'),(2,'read'),(2,'walk'),
    (1,'bed'),(1,'workout'),(1,'read'),(1,'meditate'),(1,'walk'),
    (0,'bed'),(0,'meditate')
  ) v(d, key)
  cross join lateral (select case v.key
    when 'bed' then h_bed when 'workout' then h_workout when 'read' then h_read
    when 'meditate' then h_meditate else h_walk end) m(h);

  -- ── Gym: config, exercises, four sessions with progression (one rest gap) ──
  insert into gym_config (user_id, gyms, days, split_rotation, units, upgrade_at_reps, celebrate_pr, show_next_target)
  values (uid,
    '[{"id":"g_demo","name":"Campus Gym"}]',
    '[{"id":"d_push","name":"Push"},{"id":"d_pull","name":"Pull"},{"id":"d_legs","name":"Legs"}]',
    '{Push,Pull,Legs,Rest}', 'lbs', 12, true, true);

  insert into gym_exercises (user_id, name, gym_id, day_id, day_ids, bodyweight, start_weight, rep_min, rep_max, step, order_index)
    values (uid,'Bench Press','g_demo','d_push','{d_push}',false,135,8,12,5,1) returning id into ex_bench;
  insert into gym_exercises (user_id, name, gym_id, day_id, day_ids, bodyweight, start_weight, rep_min, rep_max, step, order_index)
    values (uid,'Overhead Press','g_demo','d_push','{d_push}',false,75,8,12,5,2) returning id into ex_ohp;
  insert into gym_exercises (user_id, name, gym_id, day_id, day_ids, bodyweight, start_weight, rep_min, rep_max, step, order_index)
    values (uid,'Barbell Row','g_demo','d_pull','{d_pull}',false,115,8,12,5,3) returning id into ex_row;
  insert into gym_exercises (user_id, name, gym_id, day_id, day_ids, bodyweight, start_weight, rep_min, rep_max, step, order_index)
    values (uid,'Pull-ups','g_demo','d_pull','{d_pull}',true,0,6,12,5,4) returning id into ex_pull;
  insert into gym_exercises (user_id, name, gym_id, day_id, day_ids, bodyweight, start_weight, rep_min, rep_max, step, order_index)
    values (uid,'Squat','g_demo','d_legs','{d_legs}',false,185,8,12,5,5) returning id into ex_squat;
  insert into gym_exercises (user_id, name, gym_id, day_id, day_ids, bodyweight, start_weight, rep_min, rep_max, step, order_index)
    values (uid,'Romanian Deadlift','g_demo','d_legs','{d_legs}',false,155,8,12,5,6) returning id into ex_rdl;

  insert into gym_logs (user_id, exercise_id, weight, reps, logged_at) values
    -- Push, 6 days ago
    (uid, ex_bench, 135, 10, (current_date-6) + time '18:02'),
    (uid, ex_bench, 135,  9, (current_date-6) + time '18:08'),
    (uid, ex_bench, 135,  8, (current_date-6) + time '18:14'),
    (uid, ex_ohp,    75, 10, (current_date-6) + time '18:22'),
    (uid, ex_ohp,    75,  9, (current_date-6) + time '18:28'),
    -- Pull, 4 days ago
    (uid, ex_row,  115, 11, (current_date-4) + time '17:48'),
    (uid, ex_row,  115, 10, (current_date-4) + time '17:54'),
    (uid, ex_row,  115,  9, (current_date-4) + time '18:00'),
    (uid, ex_pull,   0,  9, (current_date-4) + time '18:08'),
    (uid, ex_pull,   0,  7, (current_date-4) + time '18:14'),
    -- Legs, 3 days ago
    (uid, ex_squat, 185, 10, (current_date-3) + time '18:05'),
    (uid, ex_squat, 185,  9, (current_date-3) + time '18:12'),
    (uid, ex_squat, 185,  8, (current_date-3) + time '18:19'),
    (uid, ex_rdl,   155, 11, (current_date-3) + time '18:27'),
    (uid, ex_rdl,   155, 10, (current_date-3) + time '18:33'),
    -- Push again, 1 day ago — small progression on bench
    (uid, ex_bench, 140,  9, (current_date-1) + time '18:04'),
    (uid, ex_bench, 140,  8, (current_date-1) + time '18:10'),
    (uid, ex_bench, 140,  8, (current_date-1) + time '18:16'),
    (uid, ex_ohp,    80,  8, (current_date-1) + time '18:24'),
    (uid, ex_ohp,    80,  7, (current_date-1) + time '18:30');

  -- ── Weight: gentle downward wobble across the week ──
  insert into body_weights (user_id, date_key, weight) values
    (uid, to_char(current_date-6,'YYYY-MM-DD'), 173.8),
    (uid, to_char(current_date-5,'YYYY-MM-DD'), 173.4),
    (uid, to_char(current_date-4,'YYYY-MM-DD'), 173.6),
    (uid, to_char(current_date-3,'YYYY-MM-DD'), 173.0),
    (uid, to_char(current_date-2,'YYYY-MM-DD'), 172.9),
    (uid, to_char(current_date-1,'YYYY-MM-DD'), 172.5),
    (uid, to_char(current_date,  'YYYY-MM-DD'), 172.6);

  -- ── Food: 2–3 typed meals/day (no photo meals), one indulgent night ──
  insert into food_logs (user_id, date, item_name, emoji, calories, protein_g, carbs_g, fat_g, source, taken_at) values
    (uid, current_date-6, 'Greek yogurt with berries & granola','🍓',380,28,46,10,'meal',(current_date-6)+time '15:40'),
    (uid, current_date-6, 'Chicken burrito bowl','🌯',780,52,74,26,'meal',(current_date-6)+time '19:45'),
    (uid, current_date-6, 'Salmon, rice & broccoli','🍣',640,45,58,22,'meal',(current_date-6)+time '02:20'),
    (uid, current_date-5, 'Oatmeal with banana & peanut butter','🥣',450,16,68,14,'meal',(current_date-5)+time '15:35'),
    (uid, current_date-5, 'Turkey sandwich & apple','🥪',520,35,60,14,'meal',(current_date-5)+time '19:50'),
    (uid, current_date-5, 'Pasta with meat sauce','🍝',720,38,88,20,'meal',(current_date-5)+time '02:35'),
    (uid, current_date-4, 'Protein shake & bagel','🥯',510,42,64,8,'meal',(current_date-4)+time '15:30'),
    (uid, current_date-4, 'Chipotle chicken bowl','🥗',760,50,72,24,'meal',(current_date-4)+time '20:10'),
    (uid, current_date-3, 'Scrambled eggs & toast','🍳',420,26,34,20,'meal',(current_date-3)+time '15:45'),
    (uid, current_date-3, 'Poke bowl','🍚',610,40,70,14,'meal',(current_date-3)+time '19:55'),
    (uid, current_date-3, 'Steak, potatoes & asparagus','🥩',740,52,48,32,'meal',(current_date-3)+time '02:15'),
    (uid, current_date-2, 'Breakfast burrito','🌯',560,28,52,24,'meal',(current_date-2)+time '16:05'),
    (uid, current_date-2, 'Late night pizza with the club guys','🍕',980,38,110,38,'meal',(current_date-2)+time '05:40'),
    (uid, current_date-1, 'Greek yogurt with berries & granola','🍓',380,28,46,10,'meal',(current_date-1)+time '15:38'),
    (uid, current_date-1, 'Chicken teriyaki & rice','🍱',680,44,80,16,'meal',(current_date-1)+time '19:58'),
    (uid, current_date-1, 'Shrimp tacos','🌮',590,36,54,20,'meal',(current_date-1)+time '02:25'),
    (uid, current_date,   'Oatmeal with banana & peanut butter','🥣',450,16,68,14,'meal',(current_date)+time '15:42');

  -- ── Water + caffeine ──
  -- Water target is 80 oz — the streak only banks days that HIT the target, so
  -- most seeded days clear 80 with one honest miss (day-5) for texture.
  -- Streak reads 4 (grace rule: today counts once a reviewer tops it up).
  insert into water_logs (user_id, date, amount_oz, logged_at)
  select uid, current_date - d, oz, (current_date - d) + t from (values
    (6,24,time '16:00'),(6,32,time '20:30'),(6,32,time '01:00'),
    (5,24,time '16:10'),(5,24,time '21:00'),
    (4,32,time '15:50'),(4,32,time '20:15'),(4,32,time '00:30'),
    (3,24,time '16:20'),(3,32,time '20:45'),(3,24,time '23:30'),
    (2,32,time '16:30'),(2,28,time '22:00'),(2,24,time '05:10'),
    (1,32,time '15:55'),(1,32,time '20:20'),(1,24,time '01:10'),
    (0,24,time '16:15')
  ) v(d, oz, t);

  insert into caffeine_logs (user_id, date, source, amount_mg, logged_at)
  select uid, current_date - d, 'Coffee', 120, (current_date - d) + time '15:20'
  from (values (6),(5),(4),(2),(1),(0)) v(d);

  -- ── Supplements + logs (most days, not all) ──
  insert into supplements (user_id, name, dose, times, active, order_index)
    values (uid,'Creatine','5 g','{morning}',true,1) returning id into sup_creatine;
  insert into supplements (user_id, name, dose, times, active, order_index)
    values (uid,'Fish Oil','2 capsules','{lunch}',true,2) returning id into sup_fish;
  insert into supplements (user_id, name, dose, times, active, order_index)
    values (uid,'Magnesium','200 mg','{evening}',true,3) returning id into sup_mag;

  insert into supplement_logs (user_id, supplement_id, date, time_slot)
  select uid, s, current_date - d, slot from (values
    (6,'c','morning'),(6,'f','lunch'),(6,'m','evening'),
    (5,'c','morning'),(5,'m','evening'),
    (4,'c','morning'),(4,'f','lunch'),(4,'m','evening'),
    (3,'c','morning'),(3,'f','lunch'),
    (1,'c','morning'),(1,'f','lunch'),(1,'m','evening'),
    (0,'c','morning')
  ) v(d, key, slot)
  cross join lateral (select case v.key when 'c' then sup_creatine when 'f' then sup_fish else sup_mag end) m(s);

  -- ── Oura-shaped wearable data (renders sleep/readiness/steps cards) ──
  insert into wearable_data (user_id, provider, date, data, fetched_at)
  select uid, 'oura', current_date - d,
    jsonb_build_object(
      'sleep', jsonb_build_object('score', sleep, 'score_day', to_char(current_date-d,'YYYY-MM-DD'),
        'latency', null, 'detail_day', null, 'efficiency', null, 'average_hrv', null, 'bedtime_end', null,
        'rem_sleep_duration', null, 'resting_heart_rate', null, 'deep_sleep_duration', null, 'total_sleep_duration', null),
      'activity', jsonb_build_object('steps', steps, 'steps_day', to_char(current_date-d,'YYYY-MM-DD'),
        'total_calories', tcal, 'active_calories', acal),
      'readiness', jsonb_build_object('score', ready, 'temperature_deviation', 0)
    ), now()
  from (values
    (6, 84, 9412, 2680, 540, 86),
    (5, 79, 6120, 2450, 380, 81),
    (4, 86, 10240, 2710, 590, 88),
    (3, 82, 8330, 2600, 470, 84),
    (2, 64, 7150, 2530, 420, 68),  -- the late pizza night shows up
    (1, 77, 9870, 2660, 520, 79),
    (0, 83, 4210, 2380, 260, 85)
  ) v(d, sleep, steps, tcal, acal, ready);

  -- ── Check-ins, journal, jots ──
  insert into daily_checkins (user_id, date, morning_intent, morning_planned_training, evening_actual_training, evening_reflection) values
    (uid, current_date-4, 'Lift after class, finish the case prep', true, true, 'Got both done. Rows felt strong.'),
    (uid, current_date-3, 'Leg day, keep meals clean', true, true, 'Squats moved well. Slept early.'),
    (uid, current_date-2, 'Rest day, catch up on reading', false, false, 'Club social ran late. Worth it.'),
    (uid, current_date-1, 'Push day, hit protein target', true, true, 'Added 5 lbs to bench.'),
    (uid, current_date,   'Morning walk, review flashcards', false, null, null);

  insert into journal_entries (user_id, date, kind, title, body, mood) values
    (uid, current_date-2, 'night', 'Long day, good people',
     'Stayed out way later than planned at the club social. Ate too much pizza and skipped my wind-down, but honestly the conversations were worth it. Feeling a little run down, want to get back on track tomorrow.', 4);
  insert into journal_entries (user_id, date, kind, title, body, plan) values
    (uid, current_date-1, 'morning', 'Push day and case prep',
     'Gym first thing, then two hours on the market-sizing case. Groceries after class. Call home in the evening.',
     jsonb_build_array(
       jsonb_build_object('id', gen_random_uuid(), 'text', 'Push day — bench focus', 'done', true),
       jsonb_build_object('id', gen_random_uuid(), 'text', 'Market-sizing case, 2 hrs', 'done', true),
       jsonb_build_object('id', gen_random_uuid(), 'text', 'Groceries', 'done', true),
       jsonb_build_object('id', gen_random_uuid(), 'text', 'Call home', 'done', false)
     ));

  insert into jots (user_id, content, created_at) values
    (uid, 'Sleep tanks every time I eat past midnight — the data actually shows it now', (current_date-1) + time '17:10'),
    (uid, 'Bench finally moving again after the deload week', (current_date-1) + time '18:40'),
    (uid, 'Try meal prepping Sundays so late nights stop wrecking the next day', (current_date) + time '16:05');
end;
$$;

-- Nightly schedule at 11:00 UTC (~4am ET / 1am PT). cron.schedule upserts by
-- name, so re-running this migration is safe. Guarded: if pg_cron can't be
-- enabled on this instance, the function still exists for manual/API-driven
-- resets and this migration doesn't fail.
do $outer$
begin
  begin
    create extension if not exists pg_cron;
    perform cron.schedule('atlas-demo-reset', '0 11 * * *', 'select public.demo_reset()');
  exception when others then
    raise notice 'pg_cron unavailable (%). Schedule demo_reset() another way.', sqlerrm;
  end;
end
$outer$;
