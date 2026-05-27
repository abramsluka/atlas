export interface SubstanceDbEntry {
  id: string
  name: string
  cat: string
  unit: string
  defaultDose: number
  mlPerUnit: number
  note: string
}

export const SUBSTANCE_DB: SubstanceDbEntry[] = [
  { id: 'adderall',   name: 'Adderall (mixed amphetamine salts)',          cat: 'ADHD stim',    unit: 'mg',           defaultDose: 20,   mlPerUnit: 25,   note: 'Stim · reduces thirst signal · dries you out' },
  { id: 'concerta',   name: 'Concerta (methylphenidate ER)',                cat: 'ADHD stim',    unit: 'mg',           defaultDose: 36,   mlPerUnit: 13.9, note: 'Stim · reduces thirst signal' },
  { id: 'vyvanse',    name: 'Vyvanse (lisdexamfetamine)',                   cat: 'ADHD stim',    unit: 'mg',           defaultDose: 50,   mlPerUnit: 10,   note: 'Stim prodrug · long acting' },
  { id: 'ritalin',    name: 'Ritalin IR (methylphenidate)',                 cat: 'ADHD stim',    unit: 'mg',           defaultDose: 20,   mlPerUnit: 20,   note: 'Short-acting stim' },
  { id: 'focalin',    name: 'Focalin / Focalin XR',                        cat: 'ADHD stim',    unit: 'mg',           defaultDose: 20,   mlPerUnit: 20,   note: 'Methylphenidate isomer' },
  { id: 'modafinil',  name: 'Modafinil',                                   cat: 'Wakefulness',  unit: 'mg',           defaultDose: 200,  mlPerUnit: 1.75, note: 'Mild dehydrating effect' },
  { id: 'lithium',    name: 'Lithium',                                      cat: 'Mood',         unit: 'mg',           defaultDose: 600,  mlPerUnit: 1.67, note: 'Critical — narrow therapeutic window, dehydration → toxicity' },
  { id: 'hctz',       name: 'Hydrochlorothiazide (HCTZ)',                   cat: 'Diuretic',     unit: 'mg',           defaultDose: 25,   mlPerUnit: 40,   note: 'Direct diuretic — drink to compensate' },
  { id: 'lasix',      name: 'Furosemide (Lasix)',                           cat: 'Diuretic',     unit: 'mg',           defaultDose: 40,   mlPerUnit: 30,   note: 'Loop diuretic · talk to your doctor about target' },
  { id: 'spironol',   name: 'Spironolactone',                               cat: 'Diuretic',     unit: 'mg',           defaultDose: 50,   mlPerUnit: 12,   note: 'K-sparing diuretic' },
  { id: 'sudafed',    name: 'Pseudoephedrine (Sudafed)',                    cat: 'Decongestant', unit: 'mg',           defaultDose: 60,   mlPerUnit: 4.17, note: 'Sympathomimetic · dries mucous membranes' },
  { id: 'phenyl',     name: 'Phenylephrine',                                cat: 'Decongestant', unit: 'mg',           defaultDose: 10,   mlPerUnit: 20,   note: 'Vasoconstrictor — mild' },
  { id: 'nicotine',   name: 'Nicotine pouch (Velo / Zyn)',                  cat: 'Stim',         unit: 'pouches/day',  defaultDose: 4,    mlPerUnit: 62.5, note: 'Vasoconstriction + dry mouth' },
  { id: 'nicpatch',   name: 'Nicotine patch',                               cat: 'Stim',         unit: 'mg',           defaultDose: 14,   mlPerUnit: 18,   note: '24-h transdermal · sustained release' },
  { id: 'alcohol',    name: 'Alcohol',                                       cat: 'Depressant',   unit: 'drinks/day',   defaultDose: 1,    mlPerUnit: 400,  note: '~10ml urine per gram ethanol — adds up fast' },
  { id: 'cannabis',   name: 'Cannabis / THC',                               cat: 'Other',        unit: 'sessions/day', defaultDose: 1,    mlPerUnit: 250,  note: 'Cottonmouth — saliva gland inhibition' },
  { id: 'creatine',   name: 'Creatine monohydrate',                         cat: 'Supplement',   unit: 'g/day',        defaultDose: 5,    mlPerUnit: 80,   note: 'Pulls water into muscle cells — drink more' },
  { id: 'preworkout', name: 'Pre-workout (caffeine + others)',               cat: 'Stim',         unit: 'servings/day', defaultDose: 1,    mlPerUnit: 300,  note: 'High-stim formula on top of caffeine' },
  { id: 'metformin',  name: 'Metformin',                                     cat: 'Glucose',      unit: 'mg',           defaultDose: 1000, mlPerUnit: 0.3,  note: 'Mild GI fluid loss' },
  { id: 'sertraline', name: 'SSRI (sertraline / escitalopram / fluoxetine)', cat: 'SSRI',         unit: 'mg',           defaultDose: 50,   mlPerUnit: 4,    note: 'Mild dry mouth in some users' },
  { id: 'wellbutrin', name: 'Bupropion (Wellbutrin)',                        cat: 'NDRI',         unit: 'mg',           defaultDose: 300,  mlPerUnit: 1.17, note: 'Stim-like profile' },
]
