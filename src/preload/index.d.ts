import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AccountRateLimits,
  AccountTokensDetail,
  AccountWakeSchedule,
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
  PromptAttachmentData,
  PromptAttachmentPayload,
  PromptCategoryList,
  PromptDetail,
  PromptImportResult,
  PromptSearchInput,
  PromptSummary,
  ProbeProviderModelsInput,
  ProviderModelsProbeResult,
  ReadCodexSessionDetailInput,
  LoginAttempt,
  LoginEvent,
  LoginMethod,
  PortOccupant,
  TokenCostDetail,
  TokenCostReadOptions,
  LocalGatewayStatus,
  UpdateAccountWakeScheduleInput,
  UpdateAccountTokensInput,
  UpdatePromptInput,
  WakeAccountRateLimitsInput,
  WakeAccountRateLimitsResult,
  UpdateCustomProviderInput
} from '../shared/codex'

interface CodexDesktopApi {
  getSnapshot: () => Promise<AppSnapshot>
  getAppMeta: () => Promise<AppMeta>
  getUpdateState: () => Promise<AppUpdateState>
  updateSettings: (nextSettings: Partial<AppSettings>) => Promise<AppSnapshot>
  openMainWindow: () => Promise<AppSnapshot>
  openCodex: () => Promise<AppSnapshot>
  importCurrentAccount: () => Promise<AppSnapshot>
  importAccountsFromFile: () => Promise<AppSnapshot>
  exportAccountsToFile: (format?: AccountTransferFormat) => Promise<AppSnapshot>
  exportSelectedAccountsToFile: (
    accountIds: string[],
    format?: AccountTransferFormat
  ) => Promise<AppSnapshot>
  activateAccount: (accountId: string) => Promise<AppSnapshot>
  activateBestAccount: () => Promise<AppSnapshot>
  reorderAccounts: (accountIds: string[]) => Promise<AppSnapshot>
  removeAccount: (accountId: string) => Promise<AppSnapshot>
  removeAccounts: (accountIds: string[]) => Promise<AppSnapshot>
  updateAccountGroups: (accountId: string, groupIds: string[]) => Promise<AppSnapshot>
  updateAccountTokens: (accountId: string, input: UpdateAccountTokensInput) => Promise<AppSnapshot>
  getAccountTokens: (accountId: string) => Promise<AccountTokensDetail>
  getAccountWakeSchedule: (accountId: string) => Promise<AccountWakeSchedule | null>
  updateAccountWakeSchedule: (
    accountId: string,
    input: UpdateAccountWakeScheduleInput
  ) => Promise<AppSnapshot>
  deleteAccountWakeSchedule: (accountId: string) => Promise<AppSnapshot>
  createGroup: (name: string) => Promise<AppSnapshot>
  updateGroup: (groupId: string, name: string) => Promise<AppSnapshot>
  deleteGroup: (groupId: string) => Promise<AppSnapshot>
  listProviders: () => Promise<AppSnapshot['providers']>
  getProvider: (providerId: string) => Promise<CustomProviderDetail>
  reorderProviders: (providerIds: string[]) => Promise<AppSnapshot>
  createProvider: (input: CreateCustomProviderInput) => Promise<AppSnapshot>
  updateProvider: (providerId: string, input: UpdateCustomProviderInput) => Promise<AppSnapshot>
  removeProvider: (providerId: string) => Promise<AppSnapshot>
  probeProviderModels: (input: ProbeProviderModelsInput) => Promise<ProviderModelsProbeResult>
  openProviderInCodex: (providerId: string) => Promise<AppSnapshot>
  openLocalGatewayInCodex: () => Promise<AppSnapshot>
  openAccountInCodex: (accountId: string) => Promise<AppSnapshot>
  openAccountInIsolatedCodex: (accountId: string) => Promise<AppSnapshot>
  readAccountRateLimits: (accountId: string) => Promise<AccountRateLimits>
  wakeAccountRateLimits: (
    accountId: string,
    input?: WakeAccountRateLimitsInput
  ) => Promise<WakeAccountRateLimitsResult>
  readTokenCost: (input?: TokenCostReadOptions) => Promise<TokenCostDetail>
  listCodexSessionProjects: (
    input?: ListCodexSessionProjectsInput
  ) => Promise<CodexSessionProjectsResult>
  listCodexSessions: (input?: ListCodexSessionsInput) => Promise<CodexSessionsResult>
  readCodexSessionDetail: (input: ReadCodexSessionDetailInput) => Promise<CodexSessionDetail>
  copyCodexSessionToProvider: (
    input: CopyCodexSessionToProviderInput
  ) => Promise<CopyCodexSessionToProviderResult>
  listCodexSkills: () => Promise<CodexSkillsResult>
  readCodexSkillDetail: (instanceId: string, skillDirName: string) => Promise<CodexSkillDetail>
  copyCodexSkill: (input: CopyCodexSkillInput) => Promise<CopyCodexSkillResult>
  listPrompts: (input?: PromptSearchInput) => Promise<PromptSummary[]>
  getPromptDetail: (promptId: string) => Promise<PromptDetail>
  createPrompt: (input: CreatePromptInput) => Promise<PromptDetail>
  updatePrompt: (promptId: string, input: UpdatePromptInput) => Promise<PromptDetail>
  removePrompt: (promptId: string) => Promise<void>
  copyPromptContent: (promptId: string) => Promise<string>
  listPromptCategories: () => Promise<PromptCategoryList>
  createPromptCategory: (name: string) => Promise<PromptCategoryList>
  renamePromptCategory: (oldName: string, newName: string) => Promise<PromptCategoryList>
  removePromptCategory: (name: string) => Promise<PromptCategoryList>
  importPromptFile: (filePath: string) => Promise<PromptImportResult>
  importPromptDir: (dirPath: string) => Promise<PromptImportResult>
  exportPromptDir: (targetDir: string) => Promise<{ exported: number }>
  addPromptAttachment: (promptId: string, payload: PromptAttachmentPayload) => Promise<PromptDetail>
  removePromptAttachment: (promptId: string, fileName: string) => Promise<PromptDetail>
  readPromptAttachment: (promptId: string, fileName: string) => Promise<PromptAttachmentData>
  getLocalGatewayStatus: () => Promise<LocalGatewayStatus>
  getLocalGatewayApiKey: () => Promise<string>
  startLocalGateway: () => Promise<AppSnapshot>
  stopLocalGateway: () => Promise<AppSnapshot>
  rotateLocalGatewayKey: () => Promise<LocalGatewayStatus & { apiKey: string }>
  checkForUpdates: () => Promise<AppUpdateState>
  downloadUpdate: () => Promise<AppUpdateState>
  installUpdate: () => Promise<void>
  startLogin: (method: LoginMethod) => Promise<LoginAttempt>
  getLoginPortOccupant: () => Promise<PortOccupant | null>
  killLoginPortOccupant: () => Promise<PortOccupant | null>
  onSnapshotUpdated: (callback: (snapshot: AppSnapshot) => void) => () => void
  onUpdateState: (callback: (state: AppUpdateState) => void) => () => void
  onLoginEvent: (callback: (event: LoginEvent) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    codexApp: CodexDesktopApi
  }
}
