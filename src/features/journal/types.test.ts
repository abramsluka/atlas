import { describe, expect, it } from 'vitest'
import { journalKindAt } from './types'

const at = (h: number, m: number) => new Date(2026, 10, 3, h, m)

describe('journalKindAt', () => {
  it('is night until 5am', () => {
    expect(journalKindAt(at(0, 30))).toBe('night')
    expect(journalKindAt(at(4, 59))).toBe('night')
  })

  it('is day from 5am up to 9:30pm', () => {
    expect(journalKindAt(at(5, 0))).toBe('morning')
    expect(journalKindAt(at(18, 30))).toBe('morning')
    expect(journalKindAt(at(21, 29))).toBe('morning')
  })

  it('is night from 9:30pm', () => {
    expect(journalKindAt(at(21, 30))).toBe('night')
    expect(journalKindAt(at(23, 59))).toBe('night')
  })
})
