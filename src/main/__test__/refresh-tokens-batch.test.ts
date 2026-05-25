import { describe, expect, it } from 'vitest'

import { __testing__ } from '../codex-services'

const { mapWithConcurrencyLimit } = __testing__

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('mapWithConcurrencyLimit', () => {
  it('caps in-flight tasks at the configured limit', async () => {
    const total = 20
    const limit = 6
    let inFlight = 0
    let peak = 0

    const items = Array.from({ length: total }, (_, i) => i)
    const gates = items.map(() => deferred<void>())
    const startedAt: number[] = []

    const promise = mapWithConcurrencyLimit(items, limit, async (item) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      startedAt.push(item)
      await gates[item].promise
      inFlight -= 1
      return item * 2
    })

    // Wait one microtask so all initial worker tasks register their inFlight increment.
    await Promise.resolve()
    await Promise.resolve()

    expect(startedAt.length).toBe(limit)
    expect(peak).toBe(limit)

    for (const gate of gates) gate.resolve()
    const results = await promise

    expect(peak).toBe(limit)
    expect(results).toEqual(items.map((i) => i * 2))
  })

  it('preserves task order in the result array', async () => {
    const items = ['a', 'b', 'c', 'd']
    const results = await mapWithConcurrencyLimit(
      items,
      2,
      async (item, index) => `${index}:${item}`
    )
    expect(results).toEqual(['0:a', '1:b', '2:c', '3:d'])
  })

  it('handles empty input without spawning workers', async () => {
    const seen: number[] = []
    const results = await mapWithConcurrencyLimit<number, number>([], 4, async (item) => {
      seen.push(item)
      return item
    })
    expect(results).toEqual([])
    expect(seen).toEqual([])
  })

  it('clamps limit to at least 1', async () => {
    const order: number[] = []
    const items = [10, 20, 30]
    const results = await mapWithConcurrencyLimit(items, 0, async (item) => {
      order.push(item)
      return item
    })
    expect(results).toEqual(items)
    expect(order).toEqual(items)
  })
})
