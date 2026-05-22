import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createCodexGatewayUsageService } from '../codex-gateway-usage'

describe('CodexGatewayUsageService', () => {
  let userDataPath: string
  const fixedNow = new Date('2026-05-10T12:00:00.000Z')

  beforeEach(async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'gw-usage-'))
  })

  afterEach(async () => {
    await rm(userDataPath, { recursive: true, force: true })
  })

  function createService(now?: () => Date): ReturnType<typeof createCodexGatewayUsageService> {
    return createCodexGatewayUsageService({ userDataPath, now: now ?? (() => fixedNow) })
  }

  describe('record + read round-trip', () => {
    it('records usage and reads it back with correct aggregation', async () => {
      const service = createService()

      await service.record({
        accountId: 'acct-1',
        instanceId: 'inst-a',
        model: 'gpt-4o',
        inputTokens: 100,
        cachedTokens: 20,
        outputTokens: 50
      })

      await service.record({
        accountId: 'acct-1',
        instanceId: 'inst-a',
        model: 'gpt-4o',
        inputTokens: 200,
        cachedTokens: 0,
        outputTokens: 100
      })

      const detail = await service.read({ accountId: 'acct-1' })
      expect(detail.source).toBe('gateway')
      expect(detail.accountId).toBe('acct-1')
      expect(detail.retentionDays).toBe(90)
      expect(detail.summary.todayTokens).toBe(450)
      expect(detail.daily).toHaveLength(1)
      expect(detail.daily[0].inputTokens).toBe(300)
      expect(detail.daily[0].outputTokens).toBe(150)
      expect(detail.daily[0].modelsUsed).toEqual(['gpt-4o'])
    })

    it('aggregates by dual key (accountId + instanceId)', async () => {
      const service = createService()

      await service.record({
        accountId: 'acct-1',
        instanceId: 'inst-a',
        model: 'gpt-4o',
        inputTokens: 100,
        cachedTokens: 0,
        outputTokens: 50
      })

      await service.record({
        accountId: 'acct-1',
        instanceId: 'inst-b',
        model: 'gpt-4o',
        inputTokens: 200,
        cachedTokens: 0,
        outputTokens: 100
      })

      const detail = await service.read({ accountId: 'acct-1' })
      expect(detail.summary.todayTokens).toBe(450)
      expect(detail.instanceBreakdowns).toHaveLength(2)

      const instB = detail.instanceBreakdowns.find((b) => b.instanceId === 'inst-b')
      expect(instB?.totalTokens).toBe(300)
    })

    it('filters by instanceId when specified', async () => {
      const service = createService()

      await service.record({
        accountId: 'acct-1',
        instanceId: 'inst-a',
        model: 'gpt-4o',
        inputTokens: 100,
        cachedTokens: 0,
        outputTokens: 50
      })

      await service.record({
        accountId: 'acct-1',
        instanceId: 'inst-b',
        model: 'gpt-4o',
        inputTokens: 200,
        cachedTokens: 0,
        outputTokens: 100
      })

      const detail = await service.read({ accountId: 'acct-1', instanceId: 'inst-a' })
      expect(detail.summary.todayTokens).toBe(150)
      expect(detail.instanceBreakdowns).toHaveLength(1)
      expect(detail.instanceBreakdowns[0].instanceId).toBe('inst-a')
    })

    it('calculates instance cost from each instance model mix instead of day-level proportions', async () => {
      const service = createService()

      await service.record({
        accountId: 'acct-1',
        instanceId: 'inst-expensive',
        model: 'gpt-5',
        inputTokens: 1000,
        cachedTokens: 0,
        outputTokens: 0
      })

      await service.record({
        accountId: 'acct-1',
        instanceId: 'inst-cheap',
        model: 'gpt-5-mini',
        inputTokens: 1000,
        cachedTokens: 0,
        outputTokens: 0
      })

      const detail = await service.read({ accountId: 'acct-1' })
      const expensive = detail.instanceBreakdowns.find(
        (entry) => entry.instanceId === 'inst-expensive'
      )
      const cheap = detail.instanceBreakdowns.find((entry) => entry.instanceId === 'inst-cheap')
      const dailyExpensive = detail.daily[0].instanceBreakdowns.find(
        (entry) => entry.instanceId === 'inst-expensive'
      )
      const dailyCheap = detail.daily[0].instanceBreakdowns.find(
        (entry) => entry.instanceId === 'inst-cheap'
      )

      expect(expensive?.costUSD).toBeCloseTo(0.00125)
      expect(cheap?.costUSD).toBeCloseTo(0.00025)
      expect(dailyExpensive?.costUSD).toBeCloseTo(0.00125)
      expect(dailyCheap?.costUSD).toBeCloseTo(0.00025)
    })
  })

  describe('readSnapshotSummaries', () => {
    it('returns summaries keyed by accountId', async () => {
      const service = createService()

      await service.record({
        accountId: 'acct-1',
        instanceId: 'inst-a',
        model: 'gpt-4o',
        inputTokens: 500,
        cachedTokens: 100,
        outputTokens: 200
      })

      await service.record({
        accountId: 'acct-2',
        instanceId: 'inst-b',
        model: 'gpt-4o-mini',
        inputTokens: 300,
        cachedTokens: 0,
        outputTokens: 100
      })

      const result = await service.readSnapshotSummaries(['acct-1', 'acct-2', 'acct-missing'])
      expect(result.gatewayUsageByAccountId['acct-1'].todayTokens).toBe(700)
      expect(result.gatewayUsageByAccountId['acct-2'].todayTokens).toBe(400)
      expect(result.gatewayUsageByAccountId['acct-missing']).toBeUndefined()
    })

    it('uses the same 90-day window as read()', async () => {
      const service = createService()

      await service.record({
        accountId: 'acct-1',
        instanceId: 'inst-a',
        model: 'gpt-4o',
        inputTokens: 100,
        cachedTokens: 0,
        outputTokens: 50,
        timestamp: '2026-03-11T12:00:00.000Z'
      })

      const detail = await service.read({ accountId: 'acct-1' })
      const snapshot = await service.readSnapshotSummaries(['acct-1'])

      expect(detail.summary.last30DaysTokens).toBe(150)
      expect(snapshot.gatewayUsageByAccountId['acct-1'].last30DaysTokens).toBe(150)
    })
  })

  describe('90-day retention prune', () => {
    it('prunes entries older than 90 days on write', async () => {
      const day91Ago = new Date('2026-02-09T12:00:00.000Z')
      let currentTime = day91Ago
      const service = createService(() => currentTime)

      await service.record({
        accountId: 'acct-1',
        instanceId: 'inst-a',
        model: 'gpt-4o',
        inputTokens: 100,
        cachedTokens: 0,
        outputTokens: 50
      })

      currentTime = fixedNow
      await service.record({
        accountId: 'acct-1',
        instanceId: 'inst-a',
        model: 'gpt-4o',
        inputTokens: 200,
        cachedTokens: 0,
        outputTokens: 100
      })

      const detail = await service.read({ accountId: 'acct-1' })
      expect(detail.daily).toHaveLength(1)
      expect(detail.daily[0].date).toBe('2026-05-10')
    })
  })

  describe('corrupt file recovery', () => {
    it('recovers from corrupt JSON by starting fresh', async () => {
      const dir = join(userDataPath, 'gateway-usage')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'v1.json'), 'not valid json!!!', 'utf8')

      const service = createService()
      await service.record({
        accountId: 'acct-1',
        instanceId: 'inst-a',
        model: 'gpt-4o',
        inputTokens: 100,
        cachedTokens: 0,
        outputTokens: 50
      })

      const detail = await service.read({ accountId: 'acct-1' })
      expect(detail.summary.todayTokens).toBe(150)
    })

    it('recovers from wrong version number', async () => {
      const dir = join(userDataPath, 'gateway-usage')
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, 'v1.json'),
        JSON.stringify({
          version: 999,
          accounts: { 'acct-old': { instances: {}, updatedAt: '' } }
        }),
        'utf8'
      )

      const service = createService()
      const detail = await service.read({ accountId: 'acct-old' })
      expect(detail.summary.todayTokens).toBe(0)
    })
  })

  describe('concurrent record serialization', () => {
    it('serializes concurrent writes without data loss', async () => {
      const service = createService()

      await Promise.all(
        Array.from({ length: 10 }, () =>
          service.record({
            accountId: 'acct-1',
            instanceId: 'inst-a',
            model: 'gpt-4o',
            inputTokens: 100,
            cachedTokens: 0,
            outputTokens: 50
          })
        )
      )

      const detail = await service.read({ accountId: 'acct-1' })
      expect(detail.summary.todayTokens).toBe(1500)
    })
  })

  describe('edge cases', () => {
    it('skips record when all tokens are zero', async () => {
      const service = createService()

      await service.record({
        accountId: 'acct-1',
        instanceId: 'inst-a',
        model: 'gpt-4o',
        inputTokens: 0,
        cachedTokens: 0,
        outputTokens: 0
      })

      const detail = await service.read({ accountId: 'acct-1' })
      expect(detail.summary.todayTokens).toBe(0)
      expect(detail.daily).toHaveLength(0)
    })

    it('skips record when accountId is empty', async () => {
      const service = createService()

      await service.record({
        accountId: '  ',
        instanceId: 'inst-a',
        model: 'gpt-4o',
        inputTokens: 100,
        cachedTokens: 0,
        outputTokens: 50
      })

      const detail = await service.read()
      expect(detail.summary.todayTokens).toBe(0)
    })

    it('uses __unknown__ for empty instanceId', async () => {
      const service = createService()

      await service.record({
        accountId: 'acct-1',
        instanceId: '',
        model: 'gpt-4o',
        inputTokens: 100,
        cachedTokens: 0,
        outputTokens: 50
      })

      const detail = await service.read({ accountId: 'acct-1' })
      expect(detail.instanceBreakdowns[0].instanceId).toBe('__unknown__')
    })

    it('clamps negative token values to zero', async () => {
      const service = createService()

      await service.record({
        accountId: 'acct-1',
        instanceId: 'inst-a',
        model: 'gpt-4o',
        inputTokens: -50,
        cachedTokens: -10,
        outputTokens: 100
      })

      const detail = await service.read({ accountId: 'acct-1' })
      expect(detail.daily[0].inputTokens).toBe(0)
      expect(detail.daily[0].outputTokens).toBe(100)
    })

    it('persists data to disk and survives service recreation', async () => {
      const service1 = createService()
      await service1.record({
        accountId: 'acct-1',
        instanceId: 'inst-a',
        model: 'gpt-4o',
        inputTokens: 100,
        cachedTokens: 0,
        outputTokens: 50
      })

      const service2 = createService()
      const detail = await service2.read({ accountId: 'acct-1' })
      expect(detail.summary.todayTokens).toBe(150)
    })
  })
})
