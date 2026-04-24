import { describe, expect, it } from 'vitest'

import { buildInstanceConsumptionEntries } from '../cost-stats-data'

describe('cost stats data helpers', () => {
  it('按近 30 天 token 对实例汇总排序并保留实例名称', () => {
    expect(
      buildInstanceConsumptionEntries({
        tokenCostByInstanceId: {
          __default__: {
            sessionTokens: 20,
            sessionCostUSD: 0.0002,
            last30DaysTokens: 80,
            last30DaysCostUSD: 0.0008,
            updatedAt: '2026-04-21T00:00:00.000Z'
          },
          'inst-work': {
            sessionTokens: 40,
            sessionCostUSD: 0.0004,
            last30DaysTokens: 180,
            last30DaysCostUSD: 0.0018,
            updatedAt: '2026-04-22T00:00:00.000Z'
          }
        },
        instances: [
          {
            id: '__default__',
            name: '',
            codexHome: '/tmp/.codex',
            extraArgs: '',
            isDefault: true,
            createdAt: '2026-04-21T00:00:00.000Z',
            updatedAt: '2026-04-21T00:00:00.000Z',
            running: false,
            initialized: true
          },
          {
            id: 'inst-work',
            name: 'Work',
            codexHome: '/tmp/instances/work',
            extraArgs: '',
            isDefault: false,
            createdAt: '2026-04-21T00:00:00.000Z',
            updatedAt: '2026-04-21T00:00:00.000Z',
            running: true,
            initialized: true
          }
        ],
        runningInstanceIds: ['inst-work'],
        resolveLabel: (instanceId, instance) =>
          instance?.isDefault || instanceId === '__default__'
            ? 'default'
            : (instance?.name ?? instanceId)
      }).map((entry) => entry.label)
    ).toEqual(['Work', 'default'])
  })

  it('实例汇总会过滤掉没有 token 也没有 cost 的空实例', () => {
    expect(
      buildInstanceConsumptionEntries({
        tokenCostByInstanceId: {
          empty: {
            sessionTokens: 0,
            sessionCostUSD: null,
            last30DaysTokens: 0,
            last30DaysCostUSD: null,
            updatedAt: '2026-04-21T00:00:00.000Z'
          }
        },
        instances: [],
        runningInstanceIds: [],
        resolveLabel: (instanceId) => instanceId
      })
    ).toEqual([])
  })
})
