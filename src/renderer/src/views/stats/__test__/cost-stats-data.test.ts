import { describe, expect, it } from 'vitest'

import {
  buildAccountConsumptionEntries,
  buildAccountConsumptionEntriesFromGateway,
  buildGroupConsumptionEntriesFromGateway,
  buildInstanceConsumptionEntries
} from '../cost-stats-data'

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

  it('按绑定账号汇总实例 token，并将未知成本按 0 计入账号成本', () => {
    expect(
      buildAccountConsumptionEntries({
        tokenCostByInstanceId: {
          'inst-a': {
            sessionTokens: 20,
            sessionCostUSD: null,
            last30DaysTokens: 80,
            last30DaysCostUSD: null,
            updatedAt: '2026-04-21T00:00:00.000Z'
          },
          'inst-b': {
            sessionTokens: 40,
            sessionCostUSD: 0.0004,
            last30DaysTokens: 180,
            last30DaysCostUSD: 0.0018,
            updatedAt: '2026-04-22T00:00:00.000Z'
          },
          unbound: {
            sessionTokens: 100,
            sessionCostUSD: 0.001,
            last30DaysTokens: 200,
            last30DaysCostUSD: 0.002,
            updatedAt: '2026-04-22T00:00:00.000Z'
          }
        },
        instances: [
          {
            id: 'inst-a',
            name: 'A',
            codexHome: '/tmp/instances/a',
            bindAccountId: 'acct-1',
            extraArgs: '',
            isDefault: false,
            createdAt: '2026-04-21T00:00:00.000Z',
            updatedAt: '2026-04-21T00:00:00.000Z',
            running: false,
            initialized: true
          },
          {
            id: 'inst-b',
            name: 'B',
            codexHome: '/tmp/instances/b',
            bindAccountId: 'acct-1',
            extraArgs: '',
            isDefault: false,
            createdAt: '2026-04-21T00:00:00.000Z',
            updatedAt: '2026-04-21T00:00:00.000Z',
            running: true,
            initialized: true
          },
          {
            id: 'unbound',
            name: 'Unbound',
            codexHome: '/tmp/instances/unbound',
            extraArgs: '',
            isDefault: false,
            createdAt: '2026-04-21T00:00:00.000Z',
            updatedAt: '2026-04-21T00:00:00.000Z',
            running: true,
            initialized: true
          }
        ],
        accounts: [
          {
            id: 'acct-1',
            email: 'acct@example.com',
            groupIds: [],
            createdAt: '2026-04-21T00:00:00.000Z',
            updatedAt: '2026-04-21T00:00:00.000Z'
          }
        ],
        resolveLabel: (_accountId, account) => account?.email ?? 'unknown'
      })
    ).toMatchObject([
      {
        accountId: 'acct-1',
        label: 'acct@example.com',
        sessionTokens: 60,
        sessionCostUSD: 0.0004,
        last30DaysTokens: 260,
        last30DaysCostUSD: 0.0018,
        instanceCount: 2
      }
    ])
  })

  describe('buildAccountConsumptionEntriesFromGateway', () => {
    it('从网关用量摘要构建账号消费条目', () => {
      const result = buildAccountConsumptionEntriesFromGateway({
        gatewayUsageByAccountId: {
          'acct-1': {
            todayTokens: 500,
            todayCostUSD: 0.005,
            last30DaysTokens: 3000,
            last30DaysCostUSD: 0.03,
            updatedAt: '2026-05-10T12:00:00.000Z'
          },
          'acct-2': {
            todayTokens: 200,
            todayCostUSD: 0.002,
            last30DaysTokens: 1000,
            last30DaysCostUSD: 0.01,
            updatedAt: '2026-05-09T12:00:00.000Z'
          }
        },
        accounts: [
          {
            id: 'acct-1',
            email: 'alice@example.com',
            groupIds: [],
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-01T00:00:00.000Z'
          },
          {
            id: 'acct-2',
            email: 'bob@example.com',
            groupIds: [],
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-01T00:00:00.000Z'
          }
        ],
        resolveLabel: (_id, account) => account?.email ?? 'unknown'
      })

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        accountId: 'acct-1',
        label: 'alice@example.com',
        sessionTokens: 500,
        sessionCostUSD: 0.005,
        last30DaysTokens: 3000,
        last30DaysCostUSD: 0.03
      })
      expect(result[1]).toMatchObject({
        accountId: 'acct-2',
        label: 'bob@example.com',
        last30DaysTokens: 1000
      })
    })

    it('过滤掉没有任何用量的账号', () => {
      const result = buildAccountConsumptionEntriesFromGateway({
        gatewayUsageByAccountId: {
          'acct-empty': {
            todayTokens: 0,
            todayCostUSD: null,
            last30DaysTokens: 0,
            last30DaysCostUSD: null,
            updatedAt: '2026-05-10T12:00:00.000Z'
          }
        },
        accounts: [],
        resolveLabel: (id) => id
      })

      expect(result).toHaveLength(0)
    })

    it('按 last30DaysTokens 降序排列', () => {
      const result = buildAccountConsumptionEntriesFromGateway({
        gatewayUsageByAccountId: {
          'acct-low': {
            todayTokens: 10,
            todayCostUSD: 0.001,
            last30DaysTokens: 100,
            last30DaysCostUSD: 0.001,
            updatedAt: '2026-05-10T12:00:00.000Z'
          },
          'acct-high': {
            todayTokens: 1000,
            todayCostUSD: 0.01,
            last30DaysTokens: 9000,
            last30DaysCostUSD: 0.09,
            updatedAt: '2026-05-09T12:00:00.000Z'
          }
        },
        accounts: [],
        resolveLabel: (id) => id
      })

      expect(result[0].accountId).toBe('acct-high')
      expect(result[1].accountId).toBe('acct-low')
    })
  })

  describe('buildGroupConsumptionEntriesFromGateway', () => {
    it('按账号分组汇总网关用量', () => {
      const result = buildGroupConsumptionEntriesFromGateway({
        gatewayUsageByAccountId: {
          'acct-1': {
            todayTokens: 500,
            todayCostUSD: 0.005,
            last30DaysTokens: 3000,
            last30DaysCostUSD: 0.03,
            updatedAt: '2026-05-10T12:00:00.000Z'
          },
          'acct-2': {
            todayTokens: 200,
            todayCostUSD: null,
            last30DaysTokens: 1000,
            last30DaysCostUSD: null,
            updatedAt: '2026-05-11T12:00:00.000Z'
          }
        },
        accounts: [
          {
            id: 'acct-1',
            email: 'alice@example.com',
            groupIds: ['group-a', 'group-b'],
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-01T00:00:00.000Z'
          },
          {
            id: 'acct-2',
            email: 'bob@example.com',
            groupIds: ['group-a'],
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-01T00:00:00.000Z'
          }
        ],
        groups: [
          {
            id: 'group-a',
            name: '研发组',
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-01T00:00:00.000Z'
          },
          {
            id: 'group-b',
            name: '设计组',
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-01T00:00:00.000Z'
          }
        ],
        resolveLabel: (_id, group) => group?.name ?? 'unknown'
      })

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        groupId: 'group-a',
        label: '研发组',
        sessionTokens: 700,
        sessionCostUSD: 0.005,
        last30DaysTokens: 4000,
        last30DaysCostUSD: 0.03,
        updatedAt: '2026-05-11T12:00:00.000Z',
        accountCount: 2
      })
      expect(result[1]).toMatchObject({
        groupId: 'group-b',
        label: '设计组',
        sessionTokens: 500,
        last30DaysTokens: 3000,
        accountCount: 1
      })
    })

    it('忽略未分组账号和不存在的分组', () => {
      const result = buildGroupConsumptionEntriesFromGateway({
        gatewayUsageByAccountId: {
          'acct-1': {
            todayTokens: 500,
            todayCostUSD: 0.005,
            last30DaysTokens: 3000,
            last30DaysCostUSD: 0.03,
            updatedAt: '2026-05-10T12:00:00.000Z'
          },
          'acct-2': {
            todayTokens: 200,
            todayCostUSD: 0.002,
            last30DaysTokens: 1000,
            last30DaysCostUSD: 0.01,
            updatedAt: '2026-05-11T12:00:00.000Z'
          }
        },
        accounts: [
          {
            id: 'acct-1',
            groupIds: ['missing-group'],
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-01T00:00:00.000Z'
          },
          {
            id: 'acct-2',
            groupIds: [],
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-01T00:00:00.000Z'
          }
        ],
        groups: [],
        resolveLabel: (id) => id
      })

      expect(result).toHaveLength(0)
    })
  })
})
