import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AccountRateLimits,
  AccountTokenRefreshResult,
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
  CreateSkillLibraryInput,
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
  TrashCodexSessionInput,
  TrashCodexSessionResult,
  SkillLibraryCategoryList,
  SkillLibraryCollectInput,
  SkillLibraryCollectResult,
  SkillLibraryDetail,
  SkillLibraryExportResult,
  SkillLibraryImportResult,
  SkillLibraryInstallInput,
  SkillLibraryInstallResult,
  SkillLibrarySearchInput,
  SkillLibrarySummary,
  LoginAttempt,
  LoginEvent,
  LoginMethod,
  PortOccupant,
  TokenCostDetail,
  TokenCostReadOptions,
  LocalGatewayStatus,
  UpdateAccountHealthInput,
  UpdateAccountWakeScheduleInput,
  UpdateAccountTokensInput,
  UpdatePromptInput,
  UpdateSkillLibraryInput,
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
  importAccountsFromRaw: (raw: string) => Promise<AppSnapshot>
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
  updateAccountHealth: (accountId: string, input: UpdateAccountHealthInput) => Promise<AppSnapshot>
  getAccountTokens: (accountId: string) => Promise<AccountTokensDetail>
  refreshAccountTokens: (accountId: string) => Promise<AccountTokenRefreshResult>
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
  openProviderIsolatedInCodex: (providerId: string) => Promise<AppSnapshot>
  openLocalGatewayInCodex: () => Promise<AppSnapshot>
  openLocalGatewayIsolatedInCodex: () => Promise<AppSnapshot>
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
  trashCodexSession: (input: TrashCodexSessionInput) => Promise<TrashCodexSessionResult>
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
  listSkillLibrary: (input?: SkillLibrarySearchInput) => Promise<SkillLibrarySummary[]>
  getSkillLibraryDetail: (skillId: string) => Promise<SkillLibraryDetail>
  createSkillLibrary: (input: CreateSkillLibraryInput) => Promise<SkillLibraryDetail>
  updateSkillLibrary: (
    skillId: string,
    input: UpdateSkillLibraryInput
  ) => Promise<SkillLibraryDetail>
  removeSkillLibrary: (skillId: string) => Promise<void>
  listSkillLibraryCategories: () => Promise<SkillLibraryCategoryList>
  createSkillLibraryCategory: (name: string) => Promise<SkillLibraryCategoryList>
  renameSkillLibraryCategory: (
    oldName: string,
    newName: string
  ) => Promise<SkillLibraryCategoryList>
  removeSkillLibraryCategory: (name: string) => Promise<SkillLibraryCategoryList>
  importSkillLibraryDir: (dirPath: string) => Promise<SkillLibraryImportResult>
  exportSkillLibraryDir: (targetDir: string) => Promise<SkillLibraryExportResult>
  collectSkillLibrary: (input: SkillLibraryCollectInput) => Promise<SkillLibraryCollectResult>
  installSkillLibrary: (input: SkillLibraryInstallInput) => Promise<SkillLibraryInstallResult>
  getLocalGatewayStatus: () => Promise<LocalGatewayStatus>
  getLocalGatewayApiKey: () => Promise<string>
  getLocalGatewayPortOccupant: () => Promise<PortOccupant | null>
  startLocalGateway: () => Promise<AppSnapshot>
  stopLocalGateway: () => Promise<AppSnapshot>
  rotateLocalGatewayKey: () => Promise<LocalGatewayStatus & { apiKey: string }>
  killLocalGatewayPortOccupant: () => Promise<PortOccupant | null>
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
