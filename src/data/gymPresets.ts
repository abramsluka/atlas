export interface PresetExercise {
  name: string
  bodyweight: boolean
  rep_min: number
  rep_max: number
  step: number
  start_weight: number
  goal: 'Hypertrophy' | 'Endurance' | 'Strength'
  description: string
  cue: string
  progression: string
  startingPoint: string
}

export interface GymPreset {
  id: string
  title: string
  subtitle: string
  exercises: PresetExercise[]
}

export const GYM_PRESETS: GymPreset[] = [
  {
    id: 'neck-jaw',
    title: 'Neck & Jaw Strength',
    subtitle: '7 exercises · bodyweight + plate',
    exercises: [
      {
        name: 'Neck Flexion',
        bodyweight: false,
        rep_min: 12,
        rep_max: 15,
        step: 2.5,
        start_weight: 0,
        goal: 'Hypertrophy',
        description: 'Lie supine with your head off the end of a bench. Lower your chin slowly to your chest, then raise back to neutral.',
        cue: 'Control the descent — 3 seconds down, squeeze at the top.',
        progression: 'Start with plate held on forehead. Add +2.5 lbs when you hit 15 clean reps.',
        startingPoint: '0 lbs × 12',
      },
      {
        name: 'Neck Extension',
        bodyweight: false,
        rep_min: 12,
        rep_max: 15,
        step: 2.5,
        start_weight: 0,
        goal: 'Hypertrophy',
        description: 'Lie prone with your head off the end of a bench. Lower your chin toward the floor, then extend back to neutral.',
        cue: 'Don\'t hyperextend. Stop at neutral — chin parallel to the floor.',
        progression: 'Plate held at back of skull. Add +2.5 lbs when you hit 15 clean reps.',
        startingPoint: '0 lbs × 12',
      },
      {
        name: 'Lateral Neck Flexion L',
        bodyweight: false,
        rep_min: 12,
        rep_max: 15,
        step: 2.5,
        start_weight: 0,
        goal: 'Hypertrophy',
        description: 'Lie on your right side, head off the edge. Lower your head toward the floor laterally, then raise it back up.',
        cue: 'Keep your ear tracking toward your shoulder — no rotation.',
        progression: 'Plate on left temple. Add +2.5 lbs when you hit 15 clean reps.',
        startingPoint: '0 lbs × 12',
      },
      {
        name: 'Lateral Neck Flexion R',
        bodyweight: false,
        rep_min: 12,
        rep_max: 15,
        step: 2.5,
        start_weight: 0,
        goal: 'Hypertrophy',
        description: 'Lie on your left side, head off the edge. Lower your head toward the floor laterally, then raise it back up.',
        cue: 'Keep your ear tracking toward your shoulder — no rotation.',
        progression: 'Plate on right temple. Add +2.5 lbs when you hit 15 clean reps.',
        startingPoint: '0 lbs × 12',
      },
      {
        name: 'Chin Tuck',
        bodyweight: true,
        rep_min: 15,
        rep_max: 20,
        step: 0,
        start_weight: 0,
        goal: 'Hypertrophy',
        description: 'Stand or sit upright. Draw your chin straight back (not down) to create a "double chin." Hold 2 seconds at peak contraction.',
        cue: 'Think: tall spine, chin back. You should feel deep cervical flexors engage.',
        progression: 'Progress by adding a resistance band around the back of your head.',
        startingPoint: 'BW × 15',
      },
      {
        name: 'Jaw Clench Hold',
        bodyweight: true,
        rep_min: 8,
        rep_max: 12,
        step: 0,
        start_weight: 0,
        goal: 'Endurance',
        description: 'Bite down firmly on a molar chew trainer or gum for 30 seconds. Release fully between reps.',
        cue: 'Clench at ~70% max — not a death grip. Masseter should bulge visibly.',
        progression: 'Increase hold duration or clench intensity. Add sets before weight.',
        startingPoint: 'BW × 30s',
      },
      {
        name: 'Tongue Press',
        bodyweight: true,
        rep_min: 8,
        rep_max: 12,
        step: 0,
        start_weight: 0,
        goal: 'Endurance',
        description: 'Press your entire tongue flat against the roof of your mouth. Hold for 30 seconds while breathing through your nose.',
        cue: 'Full tongue contact — tip, mid, and back. Don\'t let it slide forward.',
        progression: 'Extend hold time to 60 seconds. Practice while walking.',
        startingPoint: 'BW × 30s',
      },
    ],
  },
]
