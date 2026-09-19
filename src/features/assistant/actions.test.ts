import { describe, it, expect } from 'vitest'
import { actionKey, isDuplicateProposal, actionHistoryNote, type AssistantAction, type ProposedAction } from './actions'

const banana: AssistantAction = {
  kind: 'log_food', item_name: 'Banana', calories: 105, protein_g: 1.3, carbs_g: 27,
  portion_desc: '1 medium', is_hydrating: false, volume_oz: null, confidence: 'high', notes: '',
}
const milkshake: AssistantAction = { ...banana, item_name: 'Milkshake', calories: 520, protein_g: 12, carbs_g: 70 }

const card = (action: AssistantAction, status: ProposedAction['status']): ProposedAction => ({ id: `x-${status}`, action, status })

describe('actionKey', () => {
  it('ignores field order, including nested objects', () => {
    const a: AssistantAction = { kind: 'propose_workout', day_name: 'Push', existing_day_id: null, gym_ids: ['g1'], exercises: [{ name: 'Bench', rep_min: 8, rep_max: 12, step: 5, bodyweight: false }] }
    const b: AssistantAction = { exercises: [{ bodyweight: false, step: 5, rep_max: 12, rep_min: 8, name: 'Bench' }], gym_ids: ['g1'], existing_day_id: null, day_name: 'Push', kind: 'propose_workout' }
    expect(actionKey(a)).toBe(actionKey(b))
  })
  it('differs when any field differs', () => {
    expect(actionKey(banana)).not.toBe(actionKey(milkshake))
    expect(actionKey(banana)).not.toBe(actionKey({ ...banana, calories: 110 }))
  })
})

describe('isDuplicateProposal', () => {
  it('drops a re-proposal of a card that is still pending', () => {
    expect(isDuplicateProposal(banana, [card(banana, 'pending')])).toBe(true)
  })
  it('lets a genuinely new item through next to a pending one', () => {
    expect(isDuplicateProposal(milkshake, [card(banana, 'pending')])).toBe(false)
  })
  it('does not block repeats of done, dismissed, or errored cards', () => {
    // "another 20 oz" / a second set at the same weight is byte-identical and legitimate
    expect(isDuplicateProposal(banana, [card(banana, 'done')])).toBe(false)
    expect(isDuplicateProposal(banana, [card(banana, 'dismissed')])).toBe(false)
    expect(isDuplicateProposal(banana, [card(banana, 'error')])).toBe(false)
  })
})

describe('actionHistoryNote', () => {
  it('tells the model a logged card is saved and not to repeat it', () => {
    expect(actionHistoryNote(card(banana, 'done'), 'lbs')).toMatch(/^\[LOGGED: Log Banana .*do NOT propose again\]$/)
    expect(actionHistoryNote(card(banana, 'pending'), 'lbs')).toMatch(/AWAITING CONFIRM/)
    expect(actionHistoryNote(card(banana, 'dismissed'), 'lbs')).toMatch(/DISMISSED/)
  })
})
