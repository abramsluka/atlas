ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;

-- Users can read exercises that belong to their workouts
CREATE POLICY "exercises_select_own"
  ON exercises FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workouts
      WHERE workouts.id = exercises.workout_id
        AND workouts.user_id = auth.uid()
    )
  );

-- Users can insert exercises into workouts they own
CREATE POLICY "exercises_insert_own"
  ON exercises FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workouts
      WHERE workouts.id = exercises.workout_id
        AND workouts.user_id = auth.uid()
    )
  );

-- Users can update exercises in workouts they own
CREATE POLICY "exercises_update_own"
  ON exercises FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM workouts
      WHERE workouts.id = exercises.workout_id
        AND workouts.user_id = auth.uid()
    )
  );

-- Users can delete exercises from workouts they own
CREATE POLICY "exercises_delete_own"
  ON exercises FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM workouts
      WHERE workouts.id = exercises.workout_id
        AND workouts.user_id = auth.uid()
    )
  );
