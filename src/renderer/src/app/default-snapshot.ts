import { defaultStatsDisplaySettings } from '../../../shared/codex'
import type { AppSnapshot } from '../../../shared/codex'

export function createDefaultSnapshot(): AppSnapshot {
  return {
    accounts: [],
    providers: [],
    groups: [],
    codexInstances: [],
    codexInstanceDefaults: {
      rootDir: '',
      defaultCodexHome: ''
    },
    currentSession: null,
    loginInProgress: false,
    settings: {
      usagePollingMinutes: 15,
      statusBarAccountIds: [],
      language: 'zh-CN',
      theme: 'light',
      checkForUpdatesOnStartup: true,
      autoWakeOnStartup: false,
      autoWakeTargetMode: 'all',
      autoWakeGroupIds: [],
      autoWakeAccountIds: [],
      autoWakeIncludeUngrouped: false,
      autoWakeFirstWindowRemainingThresholdPercent: 96,
      autoWakeResetToleranceMinutes: 5,
      autoWakeCooldownWindowRatio: 0.1,
      codexDesktopExecutablePath: '',
      preserveChatGptAuthOnDirectProviderOpen: false,
      showLocalMockData: true,
      statsDisplay: defaultStatsDisplaySettings(),
      toolbarIconMovable: true,
      collapsedToolbarIconDefaultPosition: true,
      localGateway: {
        host: '127.0.0.1',
        port: 11456,
        apiKey: '',
        autoStart: false,
        stickyTtlMinutes: 360,
        requestTimeoutMs: 120_000,
        modelMappings: [],
        allowedGroupIds: [],
        allowedAccountIds: [],
        allowedProviderIds: []
      }
    },
    usageByAccountId: {},
    usageErrorByAccountId: {},
    accountHealthByAccountId: {},
    wakeSchedulesByAccountId: {},
    wakeStateByAccountId: {},
    tokenCostByInstanceId: {},
    tokenCostErrorByInstanceId: {},
    runningTokenCostSummary: null,
    runningTokenCostInstanceIds: [],
    gatewayUsageByAccountId: {},
    localGatewayStatus: {
      running: false,
      baseUrl: 'http://127.0.0.1:11456',
      apiKeyPreview: ''
    }
  }
}
