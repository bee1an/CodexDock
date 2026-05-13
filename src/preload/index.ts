import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AccountTokenRefreshResult,
  AccountWakeSchedule,
  AccountTokensDetail,
  AccountTransferFormat,
  AppMeta,
  AppSettings,
  AppSnapshot,
  AppUpdateState,
  CopyCodexSessionToProviderInput,
  CopyCodexSessionToProviderResult,
  CopyCodexSkillInput,
  CopyCodexSkillResult,
  CreateCustomProviderInput,
  CreatePromptInput,
  CustomProviderDetail,
  CodexSessionDetail,
  CodexSessionProjectsResult,
  CodexSessionsResult,
  CodexSkillDetail,
  CodexSkillsResult,
  ListCodexSessionProjectsInput,
  ListCodexSessionsInput,
  ProbeProviderModelsInput,
  ProviderModelsProbeResult,
  PromptCategoryList,
  PromptAttachmentData,
  PromptAttachmentPayload,
  PromptDetail,
  PromptImportResult,
  PromptSearchInput,
  PromptSummary,
  ReadCodexSessionDetailInput,
  UpdateCustomProviderInput,
  UpdatePromptInput,
  LoginEvent,
  LoginMethod,
  PortOccupant,
  TokenCostDetail,
  TokenCostReadOptions,
  UpdateAccountWakeScheduleInput,
  UpdateAccountTokensInput,
  WakeAccountRateLimitsInput
} from '../shared/codex'

// Custom APIs for renderer
const codexApp = {
  getSnapshot: () => ipcRenderer.invoke('codex:get-snapshot'),
  getAppMeta: (): Promise<AppMeta> => ipcRenderer.invoke('codex:get-app-meta'),
  getUpdateState: (): Promise<AppUpdateState> => ipcRenderer.invoke('codex:get-update-state'),
  updateSettings: (nextSettings: Partial<AppSettings>) =>
    ipcRenderer.invoke('codex:update-settings', nextSettings),
  openMainWindow: () => ipcRenderer.invoke('codex:open-main-window'),
  openCodex: () => ipcRenderer.invoke('codex:open-codex'),
  importCurrentAccount: () => ipcRenderer.invoke('codex:import-current-account'),
  importAccountsFromFile: () => ipcRenderer.invoke('codex:import-accounts-from-file'),
  importAccountsFromRaw: (raw: string) => ipcRenderer.invoke('codex:import-accounts-from-raw', raw),
  exportAccountsToFile: (format?: AccountTransferFormat) =>
    ipcRenderer.invoke('codex:export-accounts-to-file', format),
  exportSelectedAccountsToFile: (accountIds: string[], format?: AccountTransferFormat) =>
    ipcRenderer.invoke('codex:export-selected-accounts-to-file', accountIds, format),
  activateAccount: (accountId: string) => ipcRenderer.invoke('codex:activate-account', accountId),
  activateBestAccount: () => ipcRenderer.invoke('codex:activate-best-account'),
  reorderAccounts: (accountIds: string[]) =>
    ipcRenderer.invoke('codex:reorder-accounts', accountIds),
  removeAccount: (accountId: string) => ipcRenderer.invoke('codex:remove-account', accountId),
  removeAccounts: (accountIds: string[]) => ipcRenderer.invoke('codex:remove-accounts', accountIds),
  updateAccountGroups: (accountId: string, groupIds: string[]) =>
    ipcRenderer.invoke('codex:update-account-groups', accountId, groupIds),
  updateAccountTokens: (accountId: string, input: UpdateAccountTokensInput) =>
    ipcRenderer.invoke('codex:update-account-tokens', accountId, input),
  getAccountTokens: (accountId: string): Promise<AccountTokensDetail> =>
    ipcRenderer.invoke('codex:get-account-tokens', accountId),
  refreshAccountTokens: (accountId: string): Promise<AccountTokenRefreshResult> =>
    ipcRenderer.invoke('codex:refresh-account-tokens', accountId),
  getAccountWakeSchedule: (accountId: string): Promise<AccountWakeSchedule | null> =>
    ipcRenderer.invoke('codex:get-account-wake-schedule', accountId),
  updateAccountWakeSchedule: (accountId: string, input: UpdateAccountWakeScheduleInput) =>
    ipcRenderer.invoke('codex:update-account-wake-schedule', accountId, input),
  deleteAccountWakeSchedule: (accountId: string) =>
    ipcRenderer.invoke('codex:delete-account-wake-schedule', accountId),
  createGroup: (name: string) => ipcRenderer.invoke('codex:create-group', name),
  updateGroup: (groupId: string, name: string) =>
    ipcRenderer.invoke('codex:update-group', groupId, name),
  deleteGroup: (groupId: string) => ipcRenderer.invoke('codex:delete-group', groupId),
  listProviders: () => ipcRenderer.invoke('codex:list-providers'),
  getProvider: (providerId: string): Promise<CustomProviderDetail> =>
    ipcRenderer.invoke('codex:get-provider', providerId),
  reorderProviders: (providerIds: string[]) =>
    ipcRenderer.invoke('codex:reorder-providers', providerIds),
  createProvider: (input: CreateCustomProviderInput) =>
    ipcRenderer.invoke('codex:create-provider', input),
  updateProvider: (providerId: string, input: UpdateCustomProviderInput) =>
    ipcRenderer.invoke('codex:update-provider', providerId, input),
  removeProvider: (providerId: string) => ipcRenderer.invoke('codex:remove-provider', providerId),
  probeProviderModels: (input: ProbeProviderModelsInput): Promise<ProviderModelsProbeResult> =>
    ipcRenderer.invoke('codex:probe-provider-models', input),
  openProviderInCodex: (providerId: string) =>
    ipcRenderer.invoke('codex:open-provider-in-codex', providerId),
  openLocalGatewayInCodex: () => ipcRenderer.invoke('codex:open-local-gateway-in-codex'),
  openAccountInCodex: (accountId: string) =>
    ipcRenderer.invoke('codex:open-account-in-codex', accountId),
  openAccountInIsolatedCodex: (accountId: string) =>
    ipcRenderer.invoke('codex:open-account-in-isolated-codex', accountId),
  readAccountRateLimits: (accountId: string) =>
    ipcRenderer.invoke('codex:read-account-rate-limits', accountId),
  wakeAccountRateLimits: (accountId: string, input?: WakeAccountRateLimitsInput) =>
    ipcRenderer.invoke('codex:wake-account-rate-limits', accountId, input),
  readTokenCost: (input?: TokenCostReadOptions): Promise<TokenCostDetail> =>
    ipcRenderer.invoke('codex:read-token-cost', input),
  listCodexSessionProjects: (
    input?: ListCodexSessionProjectsInput
  ): Promise<CodexSessionProjectsResult> =>
    ipcRenderer.invoke('codex:list-session-projects', input),
  listCodexSessions: (input?: ListCodexSessionsInput): Promise<CodexSessionsResult> =>
    ipcRenderer.invoke('codex:list-sessions', input),
  readCodexSessionDetail: (input: ReadCodexSessionDetailInput): Promise<CodexSessionDetail> =>
    ipcRenderer.invoke('codex:read-session-detail', input),
  copyCodexSessionToProvider: (
    input: CopyCodexSessionToProviderInput
  ): Promise<CopyCodexSessionToProviderResult> =>
    ipcRenderer.invoke('codex:copy-session-to-provider', input),
  listCodexSkills: (): Promise<CodexSkillsResult> => ipcRenderer.invoke('codex:list-skills'),
  readCodexSkillDetail: (instanceId: string, skillDirName: string): Promise<CodexSkillDetail> =>
    ipcRenderer.invoke('codex:read-skill-detail', instanceId, skillDirName),
  copyCodexSkill: (input: CopyCodexSkillInput): Promise<CopyCodexSkillResult> =>
    ipcRenderer.invoke('codex:copy-skill', input),
  // Prompt management
  listPrompts: (input?: PromptSearchInput): Promise<PromptSummary[]> =>
    ipcRenderer.invoke('codex:prompt-list', input),
  getPromptDetail: (promptId: string): Promise<PromptDetail> =>
    ipcRenderer.invoke('codex:prompt-detail', promptId),
  createPrompt: (input: CreatePromptInput): Promise<PromptDetail> =>
    ipcRenderer.invoke('codex:prompt-create', input),
  updatePrompt: (promptId: string, input: UpdatePromptInput): Promise<PromptDetail> =>
    ipcRenderer.invoke('codex:prompt-update', promptId, input),
  removePrompt: (promptId: string): Promise<void> =>
    ipcRenderer.invoke('codex:prompt-remove', promptId),
  copyPromptContent: (promptId: string): Promise<string> =>
    ipcRenderer.invoke('codex:prompt-copy', promptId),
  listPromptCategories: (): Promise<PromptCategoryList> =>
    ipcRenderer.invoke('codex:prompt-category-list'),
  createPromptCategory: (name: string): Promise<PromptCategoryList> =>
    ipcRenderer.invoke('codex:prompt-category-create', name),
  renamePromptCategory: (oldName: string, newName: string): Promise<PromptCategoryList> =>
    ipcRenderer.invoke('codex:prompt-category-rename', oldName, newName),
  removePromptCategory: (name: string): Promise<PromptCategoryList> =>
    ipcRenderer.invoke('codex:prompt-category-remove', name),
  importPromptFile: (filePath: string): Promise<PromptImportResult> =>
    ipcRenderer.invoke('codex:prompt-import-file', filePath),
  importPromptDir: (dirPath: string): Promise<PromptImportResult> =>
    ipcRenderer.invoke('codex:prompt-import-dir', dirPath),
  exportPromptDir: (targetDir: string): Promise<{ exported: number }> =>
    ipcRenderer.invoke('codex:prompt-export-dir', targetDir),
  addPromptAttachment: (
    promptId: string,
    payload: PromptAttachmentPayload
  ): Promise<PromptDetail> => ipcRenderer.invoke('codex:prompt-attachment-add', promptId, payload),
  removePromptAttachment: (promptId: string, fileName: string): Promise<PromptDetail> =>
    ipcRenderer.invoke('codex:prompt-attachment-remove', promptId, fileName),
  readPromptAttachment: (promptId: string, fileName: string): Promise<PromptAttachmentData> =>
    ipcRenderer.invoke('codex:prompt-attachment-read', promptId, fileName),
  getLocalGatewayStatus: () => ipcRenderer.invoke('codex:get-local-gateway-status'),
  getLocalGatewayApiKey: (): Promise<string> =>
    ipcRenderer.invoke('codex:get-local-gateway-api-key'),
  getLocalGatewayPortOccupant: (): Promise<PortOccupant | null> =>
    ipcRenderer.invoke('codex:get-local-gateway-port-occupant'),
  startLocalGateway: () => ipcRenderer.invoke('codex:start-local-gateway'),
  stopLocalGateway: () => ipcRenderer.invoke('codex:stop-local-gateway'),
  rotateLocalGatewayKey: () => ipcRenderer.invoke('codex:rotate-local-gateway-key'),
  killLocalGatewayPortOccupant: (): Promise<PortOccupant | null> =>
    ipcRenderer.invoke('codex:kill-local-gateway-port-occupant'),
  checkForUpdates: (): Promise<AppUpdateState> => ipcRenderer.invoke('codex:check-for-updates'),
  downloadUpdate: (): Promise<AppUpdateState> => ipcRenderer.invoke('codex:download-update'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('codex:install-update'),
  startLogin: (method: LoginMethod) => ipcRenderer.invoke('codex:start-login', method),
  getLoginPortOccupant: (): Promise<PortOccupant | null> =>
    ipcRenderer.invoke('codex:get-login-port-occupant'),
  killLoginPortOccupant: (): Promise<PortOccupant | null> =>
    ipcRenderer.invoke('codex:kill-login-port-occupant'),
  onSnapshotUpdated: (callback: (snapshot: AppSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AppSnapshot): void =>
      callback(payload)
    ipcRenderer.on('codex:snapshot-updated', listener)

    return (): void => {
      ipcRenderer.removeListener('codex:snapshot-updated', listener)
    }
  },
  onUpdateState: (callback: (state: AppUpdateState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AppUpdateState): void =>
      callback(payload)
    ipcRenderer.on('codex:update-state', listener)

    return (): void => {
      ipcRenderer.removeListener('codex:update-state', listener)
    }
  },
  onLoginEvent: (callback: (event: LoginEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: LoginEvent): void =>
      callback(payload)
    ipcRenderer.on('codex:login-event', listener)

    return (): void => {
      ipcRenderer.removeListener('codex:login-event', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('codexApp', codexApp)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.codexApp = codexApp
}
