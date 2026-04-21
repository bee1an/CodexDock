import { describe, expect, it } from 'vitest'

describe('vitest config scope', () => {
  it('keeps pure node tests free from renderer globals', () => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
  })
})
