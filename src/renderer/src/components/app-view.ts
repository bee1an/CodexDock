import type {
  AppLanguage,
  AppTheme,
  AccountRateLimitEntry,
  AccountRateLimits,
  AccountSummary,
  CustomProviderSummary,
  LoginEvent
} from '../../../shared/codex'
import { remainingPercent } from '../../../shared/codex'
export { statusBarAccounts } from '../../../shared/codex'

export const pollingOptions = [5, 15, 30, 60] as const

export const languageOptions: Array<{ value: AppLanguage; label: string }> = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: 'English' }
]

export function accountScopedRecord<T>(
  accounts: Array<Pick<AccountSummary, 'id'>>,
  record: Record<string, T>
): Record<string, T> {
  const accountIds = new Set(accounts.map((account) => account.id))
  return Object.fromEntries(
    Object.entries(record).filter(([accountId]) => accountIds.has(accountId))
  )
}

export function preserveAccountScopedRecord<T>(
  accounts: Array<Pick<AccountSummary, 'id'>>,
  snapshotRecord: Record<string, T>,
  currentRecord: Record<string, T>
): Record<string, T> {
  return accountScopedRecord(accounts, {
    ...snapshotRecord,
    ...currentRecord
  })
}

export const messages = {
  'zh-CN': {
    unnamedAccount: '未命名账号',
    actionFailed: '操作失败',
    startLoginFailed: '无法启动登录流程',
    readRateLimitFailed: '无法读取账号限额',
    legacyAccountNeedsReimport: '这个账号来自旧版本的钥匙串存储，请重新导入。',
    legacyProviderNeedsApiKey: '这个提供商的 API Key 来自旧版本的钥匙串存储，请重新填写并保存。',
    removeConfirm: (label: string) => `删除 ${label} 的本地保存登录态？`,
    callbackLogin: '回调登录',
    deviceLogin: '设备码登录',
    importCurrent: '导入当前登录',
    importAccountsFile: '导入账号文件',
    pasteSession: '粘贴 Session',
    pasteSessionTitle: '粘贴 ChatGPT Session',
    pasteSessionHint:
      '粘贴从 chatgpt.com/api/auth/session 获取的 JSON。注意：包含敏感凭证，请勿泄露。',
    pasteSessionLabel: 'Session JSON',
    pasteSessionPlaceholder: '{"user":{...},"accessToken":"eyJ...","account":{...}}',
    pasteSessionConfirm: '导入',
    importMethodTitle: '选择导入方式',
    importFromFile: '从文件导入',
    importFromFileDescription: '选择本地 JSON 文件导入账号。',
    importFromSession: '粘贴 Session',
    importFromSessionDescription: '粘贴 ChatGPT 网页端的 session JSON 导入。',
    exportAccountsFile: '导出账号文件',
    toolbarDialogTitle: '快捷工具',
    closeDialog: '关闭',
    exportFormatDialogTitle: '选择导出格式',
    exportFormatDialogDescription: '导入会自动识别格式；导出时请选择目标工具兼容的 JSON 结构。',
    exportFormatTargetAll: '导出全部账号',
    exportFormatTargetSelected: (count: number) => `导出选中的 ${count} 个账号`,
    exportFormatCodexDock: 'CodexDock',
    exportFormatCodexDockDescription: '原生模板，保留完整额度与扩展字段。',
    exportFormatCockpitTools: 'Cockpit Tools',
    exportFormatCockpitToolsDescription: '兼容 Cockpit Tools 的账号数组格式。',
    exportFormatSub2api: 'sub2api',
    exportFormatSub2apiDescription: '兼容 sub2api 的批量导入数据格式。',
    exportFormatCliProxyApi: 'CLIProxyAPI',
    exportFormatCliProxyApiDescription: '兼容 CLIProxyAPI 的 token storage 格式。',
    exportFormatConfirm: '开始导出',
    exportFormatCancel: '取消',
    switchBest: '切换到最优账号',
    alreadyBest: '当前已是最优账号',
    noBestAccount: '暂无可切换账号',
    switchToAccount: (email: string) => `切换到 ${email}`,
    settings: '设置',
    generalSettings: '通用设置',
    generalSettingsDescription: '这些设置会保存到本机，并在下次启动时继续生效。',
    pollingInterval: '额度轮询',
    autoCheckUpdates: '启动时检查更新',
    showLocalMockData: '显示本地 Mock 数据',
    toolbarSettings: '底部工具栏',
    toolbarSettingsDescription: '控制工具栏收起后的入口图标显示与拖动行为。',
    toolbarIconMovable: '允许拖动收起图标',
    toolbarIconMovableDescription: '关闭“默认位置显示”后，可拖动收起图标并保留当前位置。',
    collapsedToolbarIconDefaultPosition: '收起后在默认位置显示图标',
    collapsedToolbarIconDefaultPositionDescription:
      '开启后图标固定显示在底部默认位置；关闭后使用拖动后的位置。',
    codexDesktopExecutablePath: '多开 Codex EXE',
    showCodexDesktopExecutablePath: '手动指定',
    hideCodexDesktopExecutablePath: '收起',
    codexDesktopExecutablePlaceholder: '例如 C:\\Program Files\\Codex\\Codex.exe',
    minutes: '分钟',
    callbackLoginLink: '授权链接',
    deviceLoginLink: '设备验证页面',
    deviceCode: '设备码',
    copyLink: '复制链接',
    copyCode: '复制设备码',
    openBrowser: '打开浏览器',
    openMainPanel: '打开主面板',
    waitingCallback: '等待在浏览器中完成授权并回调到本地地址。',
    waitingDeviceCode: '在浏览器里完成授权后，这里会自动继续。',
    statusBarAccountCount: (count: number) => `${count} 个状态栏账号`,
    noStatusBarAccounts: '还没有可显示的账号。',
    statusBarDisplayAccounts: '状态栏显示账号',
    maxFiveAccounts: '最多 5 个',
    visible: '已显示',
    hidden: '未显示',
    accountList: '账号列表',
    accountCount: (count: number) => `${count} 个账号`,
    tokenStats: '用量',
    tokenStatsTitle: '用量 / 消耗统计',
    tokenStatsDescription: '实例数据来自本地 Codex 日志。',
    tokenStatsReadFailed: '无法读取用量统计',
    tokenStatsSelectedTarget: '当前统计目标',
    tokenStatsDefaultFallback: '无运行实例，回退 default',
    tokenStatsNoData: '暂无本地用量数据',
    skills: 'Skills',
    skillsTitle: 'Skill 管理',
    skillsDescription: '管理各实例下的 Skills，支持实例间复制。',
    skillsRefresh: '刷新 Skills',
    skillsReadFailed: '无法读取 Skills',
    skillsEmpty: '暂无 Skill',
    skillsInstanceEmpty: '该实例暂无 Skill',
    skillsCount: (count: number) => `${count} 个 Skill`,
    skillsSearchPlaceholder: '搜索 Skill 名称或描述',
    skillsAllInstances: '全部实例',
    skillsDetail: 'Skill 详情',
    skillsBackToList: '返回列表',
    skillsDetailLoading: '正在读取 Skill 详情',
    skillsCopyToInstance: '复制到实例',
    skillsCopyDialogTitle: '复制 Skill',
    skillsCopyDialogDescription: (name: string) => `将 ${name} 复制到其他实例`,
    skillsBulkCopyDialogDescription: (count: number) => `将已选的 ${count} 个 Skill 复制到其他实例`,
    skillsBulkSelected: (count: number) => `已选中 ${count} 个 Skill`,
    skillsBulkSelectAllVisible: '选中当前列表',
    skillsBulkClear: '清除选择',
    skillsBulkCopyAction: (count: number) => `复制选中的 ${count} 条`,
    skillsBulkCopyProgress: (done: number, total: number) => `正在复制 ${done}/${total}`,
    skillsBulkToggleSelect: '切换选择',
    skillsCopySourceInstance: '源实例',
    skillsCopyTargetInstances: '目标实例',
    skillsCopyTargetHelp: '选择要复制到的目标实例（已存在同名 Skill 的实例会被跳过）',
    skillsCopyConfirm: '确认复制',
    skillsCopyCancel: '取消',
    skillsCopyResult: '复制结果',
    skillsCopySuccess: (count: number) => `成功复制到 ${count} 个实例`,
    skillsCopySkipped: (count: number) => `${count} 个实例已存在同名 Skill，已跳过`,
    skillsCopyFailed: (count: number) => `${count} 个实例复制失败`,
    skillsCopyNoTarget: '请至少选择一个目标实例',
    skillsInstance: '实例',
    skillsName: '名称',
    skillsDescription2: '描述',
    skillsPath: '路径',
    skillLibrary: '技能库',
    skillLibraryTitle: '技能库管理',
    skillLibraryDescription: '管理本地技能库，支持分类、搜索、导入导出和安装到实例。',
    skillLibraryEmpty: '技能库为空',
    skillLibraryCount: (count: number) => `${count} 个技能`,
    skillLibraryLoading: '正在加载技能库',
    skillLibraryRefresh: '刷新',
    skillLibrarySearchPlaceholder: '搜索技能名称或描述',
    skillLibraryAllCategories: '全部分类',
    skillLibraryCreate: '新建技能',
    skillLibraryEdit: '编辑',
    skillLibrarySave: '保存',
    skillLibraryCancel: '取消',
    skillLibraryDelete: '删除',
    skillLibraryDeleteConfirm: (name: string) => `删除技能 "${name}"？`,
    skillLibraryBackToList: '返回列表',
    skillLibraryNamePlaceholder: '技能名称',
    skillLibraryContentPlaceholder: '输入 SKILL.md 内容...',
    skillLibraryCategoryManager: '分类管理',
    skillLibraryCategoryCreate: '新增分类',
    skillLibraryCategoryRename: '重命名',
    skillLibraryCategoryRemove: '删除',
    skillLibraryCategoryRemoveConfirm: (name: string) =>
      `删除分类 "${name}"？所有技能中的该分类标签会被移除。`,
    skillLibraryCategoryPlaceholder: '分类名称',
    skillLibraryCategorySelection: '分类',
    skillLibraryInstall: '安装到实例',
    skillLibraryInstallTitle: '安装技能',
    skillLibraryInstallDescription: (name: string) => `将 "${name}" 安装到选定实例`,
    skillLibraryInstallConfirm: '确认安装',
    skillLibraryInstallNoTarget: '请至少选择一个目标实例',
    skillLibraryInstallSuccess: (count: number) => `成功安装到 ${count} 个实例`,
    skillLibraryInstallSkipped: (count: number) => `${count} 个实例已存在同名技能，已跳过`,
    skillLibraryInstallFailed: (count: number) => `${count} 个实例安装失败`,
    skillLibraryCollect: '从实例收集',
    skillLibraryImport: '导入',
    skillLibraryExport: '导出',
    skillLibraryImportPrompt: '输入要导入的 Skill 目录路径',
    skillLibraryExportPrompt: '输入导出目标目录路径',
    skillLibraryImportResult: (imported: number, skipped: number) =>
      `已导入 ${imported} 个，跳过 ${skipped} 个`,
    skillLibraryExportResult: (exported: number, outputPath: string) =>
      `已导出 ${exported} 个 Skill 到 ${outputPath}`,
    skillLibraryCollectResult: (collected: number, skipped: number) =>
      `已收集 ${collected} 个，跳过 ${skipped} 个`,
    skillLibraryErrorCount: (count: number) => `${count} 个错误`,
    skillLibraryCollectInstance: '实例',
    skillLibraryCollectNames: 'Skill 目录名（逗号分隔）',
    skillLibraryCollectPlaceholder: 'skill-a, skill-b',
    prompts: 'Prompts',
    promptsTitle: 'Prompt 管理',
    promptsDescription: '管理本地保存的 Prompt 模板，支持分类、搜索和导入导出。',
    promptsEmpty: '暂无 Prompt',
    promptsCount: (count: number) => `${count} 个 Prompt`,
    promptsLoading: '正在加载 Prompt',
    promptsRefresh: '刷新',
    promptsUpdated: (date: string) => `更新于 ${date}`,
    promptsSearchPlaceholder: '搜索标题或正文',
    promptsAllCategories: '全部分类',
    promptsCreate: '新建 Prompt',
    promptsEdit: '编辑',
    promptsSave: '保存',
    promptsCancel: '取消',
    promptsDelete: '删除',
    promptsDeleteConfirm: (title: string) => `删除 Prompt "${title}"？`,
    promptsCopyContent: '复制正文',
    promptsCopied: '已复制',
    promptsBackToList: '返回列表',
    promptsTitlePlaceholder: 'Prompt 标题',
    promptsContentPlaceholder: '输入 Prompt 正文...',
    promptsCategoryManager: '分类管理',
    promptsCategoryCreate: '新增分类',
    promptsCategoryRename: '重命名',
    promptsCategoryRemove: '删除',
    promptsCategoryRemoveConfirm: (name: string) =>
      `删除分类 "${name}"？所有 Prompt 中的该分类标签会被移除。`,
    promptsCategoryPlaceholder: '分类名称',
    promptsImagesLabel: '参考图片',
    promptsImagesUpload: '添加图片',
    promptsImagesEmpty: '尚未添加参考图片',
    promptsImagesHint: '支持 PNG / JPG / WebP / GIF / SVG，单张最大 10 MB',
    promptsImagesRemove: '移除图片',
    promptsImagesCreateFirst: '请先保存 Prompt 后再添加参考图片',
    promptsImagesTooLarge: (name: string) => `图片 "${name}" 超过 10 MB，已跳过`,
    promptsImagesInvalidType: (name: string) => `文件 "${name}" 不是受支持的图片类型`,
    promptsImagesUploadFailed: '图片上传失败',
    promptsImageBuiltInHint: '内置分类，不可删除或重命名',
    sessions: '会话',
    sessionsTitle: 'Session 管理',
    sessionsDescription:
      '按实例展示本地 Codex 历史会话，可查看、复制或删除；删除会移入系统回收站。',
    sessionsReadFailed: '无法读取 Session',
    sessionsRefresh: '刷新 Session',
    sessionsAllInstances: '全部实例',
    sessionsSearchPlaceholder: '按项目路径筛选',
    sessionsInstanceSearchPlaceholder: '搜索该实例 Session',
    sessionsStatusAll: '全部状态',
    sessionsStatusActive: '活跃',
    sessionsStatusArchived: '已归档',
    sessionsEmpty: '暂无 Session',
    sessionsInstanceEmpty: '该实例暂无 Session',
    sessionsCount: (count: number) => `${count} 个 Session`,
    sessionsProviderCount: (count: number) => `${count} 个 Provider`,
    sessionsProjectCount: (count: number) => `${count} 个项目`,
    sessionsUnknownProvider: '未知 Provider',
    sessionsUnknownProject: '未知项目',
    sessionsShowMore: (count: number) => `展开剩余 ${count} 条`,
    sessionsCollapse: '收起',
    sessionsScannedAt: (value: string) => `扫描于 ${value}`,
    sessionsSource: '来源',
    sessionsSourceCustom: '自定义来源',
    sessionsInstance: '实例',
    sessionsProvider: 'Provider',
    sessionsProject: '项目',
    sessionsCreatedAt: '创建',
    sessionsUpdatedAt: '最近更新',
    sessionsBranch: '分支',
    sessionsId: 'Session ID',
    sessionsLastMessage: '最后一句话',
    sessionsDetail: '会话详情',
    sessionsBackToList: '返回列表',
    sessionsDetailLoading: '正在读取会话详情',
    sessionsNoMessages: '暂无可展示的对话内容',
    sessionsImageAlt: '会话图片',
    sessionsCopyToProvider: '复制到 Provider',
    sessionsTargetInstance: '目标实例',
    sessionsTargetProvider: '目标 Provider',
    sessionsCopyTargetInstanceHelp: '选择复制后的 Session 放到哪个 Codex 实例。',
    sessionsCopyTargetProviderHelp:
      '只显示目标实例下已有或绑定的 Provider，模型会使用该 Provider 当前配置的模型。',
    sessionsCopyConfirm: '确认复制',
    sessionsCopyFailed: '复制 Session 失败',
    sessionsNoTargetProvider: '暂无可用 Provider，请先添加 Provider。',
    sessionsCopySuccess: (instanceName: string, model: string) =>
      `已复制到 ${instanceName}，使用模型 ${model}`,
    sessionsCopySessionLabel: (title: string) => `复制 ${title} 到其他 Provider`,
    sessionsBulkSelected: (count: number) => `已选中 ${count} 个会话`,
    sessionsBulkClear: '清除选择',
    sessionsBulkToggleSelect: '切换选择',
    sessionsBulkCopyAction: (count: number) => `复制选中的 ${count} 条`,
    sessionsBulkCopyConfirm: (count: number) => `确认复制 ${count} 条`,
    sessionsBulkCopyProgress: (done: number, total: number) => `正在复制 ${done}/${total}`,
    sessionsBulkCopyDialogTitle: (count: number) => `批量复制 ${count} 个会话`,
    sessionsBulkCopySuccess: (count: number) => `${count} 个会话复制成功`,
    sessionsBulkCopyFailureCount: (count: number) => `${count} 个会话复制失败`,
    sessionsBulkCopyResult: '批量复制结果',
    sessionsTrashSession: '删除',
    sessionsTrashSessionLabel: (title: string) => `删除会话 ${title}`,
    sessionsTrashConfirmTitle: '确认删除',
    sessionsTrashConfirmMessage: '该会话将被移动到系统回收站，可从回收站恢复。',
    sessionsTrashConfirmAction: '删除',
    sessionsTrashSuccess: '已移动到回收站',
    sessionsTrashFailed: '删除会话失败',
    sessionsBulkTrashAction: (count: number) => `删除选中的 ${count} 条`,
    sessionsBulkTrashConfirmMessage: (count: number) =>
      `${count} 个会话将被移动到系统回收站，可从回收站恢复。`,
    sessionsBulkTrashProgress: (done: number, total: number) => `正在删除 ${done}/${total}`,
    sessionsBulkTrashSuccess: (count: number) => `${count} 个会话已移动到回收站`,
    sessionsBulkTrashFailureCount: (count: number) => `${count} 个会话删除失败`,
    sessionsExpandMessage: '展开消息',
    sessionsCollapseMessage: '收起消息',
    sessionsRoleUser: '用户',
    sessionsRoleAssistant: '助手',
    sessionsRoleSystem: '系统',
    sessionsRoleDeveloper: '开发者',
    sessionsRoleTool: '工具',
    sessionsRoleOther: '其他',
    runningTokenCostSummary: '全部实例汇总',
    runningInstanceCount: (count: number) => `${count} 个运行实例`,
    today: 'Today',
    last30Days: 'Last 30 days',
    tokens: 'tokens',
    cost: 'cost',
    costReference: (value: string) => `成本参考 ${value}`,
    updatedAt: '更新时间',
    dailyTrend: '30 天日趋势',
    trendMetric: '趋势指标',
    trendMetricTokens: 'Token',
    trendMetricCost: '成本',
    modelBreakdown: '模型分布',
    instanceUsage: '实例用量/消耗',
    instanceUsageDescription: '按实例汇总近 30 天 token；cost 仅作辅助信息。',
    displayConfig: '显示配置',
    displayConfigDescription: '勾选后会在统计页显示，对应设置会持久化到本地。',
    noChartsVisible: '已隐藏全部图表，可在上方显示配置中重新开启。',
    inputTokens: 'input tokens',
    outputTokens: 'output tokens',
    dailyAvgTokens: '日均 tokens',
    dailyAvgCost: '日均 cost',
    peakDay: '峰值日',
    peakDayTokens: '峰值 tokens',
    statsDays: '统计天数',
    modelsUsedCount: '使用模型数',
    costStatus: 'Cost 状态',
    costStatusAllKnown: '全部可计算',
    costStatusPartialUnknown: '部分价格未知',
    costStatusNoCost: '暂无 cost',
    costUnknown: '价格未知',
    topModel: '主要消耗模型',
    topModelSummary: (name: string, percent: string) => `${name}，占 ${percent}`,
    costUnknownModelsHint: '部分模型价格未知，cost 仅为已知部分的合计。',
    trendTooltipModels: '模型',
    instanceRunning: '运行中',
    instanceStopped: '已停止',
    emptyReasonNoLogs: '本地还没有 Codex 日志',
    emptyReasonNoTokenCount: '日志中没有 token_count 记录',
    emptyReasonNoRecentUsage: '当前实例近期没有用量',
    sessionUsed: '5小时已用',
    weeklyUsed: '周限额已用',
    credits: 'Credits',
    unlimited: '无限',
    refresh: '刷新',
    refreshing: '刷新中',
    selectedAccountCount: (count: number) => `已选 ${count} 个账号`,
    selectAccount: '选择账号',
    selectAllVisibleAccounts: '全选当前筛选',
    clearSelectedAccounts: '清空选择',
    exportAccount: '导出账号',
    exportSelectedAccounts: '导出选中',
    deleteSelectedAccounts: '删除选中',
    removeSelectedConfirm: (count: number) => `删除选中的 ${count} 个本地保存登录态？`,
    providerList: '提供商列表',
    providerCount: (count: number) => `${count} 个提供商`,
    dragSortHint: '拖动左侧手柄调整顺序',
    dragSortHandle: '拖动排序',
    manageGroups: '管理组',
    groupManagerTitle: '组管理',
    groupManagerHint: '创建、重命名或删除组，用来给账号分组与在本地网关中筛选。',
    groupManagerNoAccountsHint: '导入账号后才能把它们加入组。',
    newGroupPlaceholder: '输入新组名称',
    createGroup: '新增组',
    renameGroup: '重命名组',
    deleteGroup: '删除组',
    save: '保存',
    cancel: '取消',
    close: '关闭',
    allGroups: '全部',
    ungrouped: '未分组',
    filterByGroup: '按组筛选',
    filtersAndBulkActions: '筛选与批量操作',
    showFiltersAndBulkActions: '展开筛选与批量操作',
    hideFiltersAndBulkActions: '收起筛选与批量操作',
    emptyFilterTools: '导入账号后再进行筛选或批量操作',
    addGroup: '加入组',
    removeGroup: '移出组',
    groupMemberCount: (count: number) => `${count} 个账号`,
    noGroups: '还没有组，先创建一个。',
    noAccountsForFilter: '当前筛选下没有账号。',
    deleteGroupConfirm: (name: string) => `删除组 ${name}？已加入的账号会一并取消关联。`,
    active: '当前',
    accountExpired: '已过期',
    accountUsageRefreshFailed: '刷新失败',
    accountExpiredHint: '登录态已失效，请重新登录或重新导入当前登录。',
    accountHealthNormal: '正常',
    accountHealthAuthError: '账号异常',
    accountHealthAuthErrorHint: (reason: string) =>
      `该账号已被排除，需要手动修复后再标记为正常。原因：${reason}`,
    accountHealthSource: '来源',
    accountHealthMarkedAt: '标记时间',
    accountHealthHttpStatus: 'HTTP 状态',
    markAccountNormal: '标记为正常',
    sessionQuota: '5小时',
    weeklyQuota: '周限额',
    sessionReset: '5小时重置',
    weeklyReset: '周限额重置',
    subscriptionExpiresAt: '订阅到期',
    subscriptionRemaining: (value: string) => `订阅剩余 ${value}`,
    subscriptionExpiredAgo: (value: string) => `订阅已过期 ${value}`,
    tokenExpiresAtLabel: 'Token 过期时间',
    tokenExpiringSoon: (value: string) => `Token ${value} 后过期`,
    tokenExpiredAgo: (value: string) => `Token 已过期 ${value}`,
    tagVisibilityTitle: '显示控制',
    tagVisibilitySubscription: '订阅到期',
    tagVisibilityTokenExpiry: 'Token 过期',
    tagVisibilityWakeSchedule: '唤醒计划',
    tagVisibilityGroups: '分组标签',
    tagVisibilityQuotaSummary: '额度总汇',
    openCodex: '打开 Codex',
    openCodexIsolated: '多开 Codex',
    openCustomProvider: '启动提供商',
    openCustomProviderIsolated: '多开提供商',
    switchAccount: '切换账号',
    refreshQuota: '刷新额度',
    wakeQuota: '唤醒',
    wakeQuotaHint: '发送一条请求来启动这轮 Session 计时',
    wakeQuotaUnsupported: 'Free 层级不支持唤醒',
    wakeSchedule: '定时唤醒',
    wakeScheduleHint: '按设定时间自动发送唤醒请求',
    wakeDialogTitle: '唤醒中心',
    wakeDialogDescription: '可立即发送唤醒请求，也可以在同一个弹框里配置定时唤醒。',
    wakeScheduleDialogTitle: '定时唤醒',
    wakeScheduleDialogDescription: '按本地时间在设定时刻自动发送唤醒请求。',
    wakeScheduleEnabled: '启用定时唤醒',
    wakeScheduleTimes: '时间',
    wakeScheduleAddTime: '新增时间',
    wakeScheduleTimePlaceholder: '例如：09:00',
    wakeScheduleRemoveTime: '删除时间',
    wakeScheduleNextRun: '下次触发',
    wakeScheduleLastRun: '上次执行',
    wakeScheduleLastStatus: '上次结果',
    wakeScheduleLastMessage: '结果详情',
    wakeScheduleDelete: '删除计划',
    wakeScheduleSave: '保存计划',
    wakeScheduleNoTimes: '至少添加一个时间',
    wakeScheduleInvalidTime: '时间格式必须是 HH:mm',
    wakeScheduleEmpty: '未设置',
    wakeScheduleStatusIdle: '待命',
    wakeScheduleStatusSuccess: '成功',
    wakeScheduleStatusError: '失败',
    wakeScheduleStatusSkipped: '跳过',
    wakeQuotaDialogTitle: '唤醒 Session',
    wakeQuotaDialogDescription: '发送一条请求来启动这轮 Session 计时。',
    wakeQuotaPromptLabel: '唤醒词',
    wakeQuotaPromptPlaceholder: '例如：ping',
    wakeQuotaModelLabel: '模型',
    wakeQuotaModelPlaceholder: '例如：gpt-5.4-mini',
    wakeQuotaConfirm: '开始唤醒',
    wakeQuotaCancel: '取消',
    wakeQuotaStatusIdle: '待命',
    wakeQuotaStatusRunning: '进行中',
    wakeQuotaStatusSuccess: '已完成',
    wakeQuotaStatusSkipped: '已跳过',
    wakeQuotaStatusError: '失败',
    wakeQuotaLogTitle: '过程输出',
    wakeQuotaLogEmpty: '还没有输出，点击下方开始唤醒后会在这里显示过程。',
    wakeQuotaLogReady: (label: string) => `已准备对 ${label} 发起唤醒测试。`,
    wakeQuotaLogStart: (model: string) => `开始唤醒测试，模型：${model}`,
    wakeQuotaLogPrompt: (prompt: string) => `Prompt：${prompt}`,
    wakeQuotaLogRequesting: '正在发送唤醒请求…',
    wakeQuotaLogAccepted: (status: number) => `请求已返回，状态码：${status}`,
    wakeQuotaLogResponse: (text: string) => `最终返回：${text}`,
    wakeQuotaLogRefreshingUsage: '正在刷新额度状态…',
    wakeQuotaLogSessionReset: (value: string) => `Session 重置时间：${value}`,
    wakeQuotaLogWeeklyReset: (value: string) => `周限额重置时间：${value}`,
    wakeQuotaLogCompleted: '唤醒流程完成。',
    wakeQuotaLogSkipped: '当前条件已变化，本次没有真正触发唤醒请求。',
    wakeQuotaLogFailed: (message: string) => `唤醒失败：${message}`,
    wakeQuotaResult: '请求结果',
    wakeQuotaResultStatus: '状态',
    wakeQuotaResultEmpty: '空响应',
    refreshAllQuota: '刷新全部额度',
    refreshQuotaBlocked: (minutes: number) => `${minutes} 分钟内不重复请求`,
    quotaSummaryTitle: '额度汇总',
    quotaSummarySubtitle: (count: number) => `${count} 个非 Free 账号`,
    quotaSummaryPrimaryLabel: '5h 平均剩余',
    quotaSummarySecondaryLabel: '周平均剩余',
    quotaSummaryAccountSuffix: (count: number) => `${count} 个账号`,
    quotaSummaryEmpty: '暂无可用额度数据',
    deleteSaved: '删除保存',
    noSavedAccounts: '还没有保存任何账号。先导入当前登录，或者走一次新的回调登录。',
    providerNamePlaceholder: '提供商名称（可选）',
    providerBaseUrlPlaceholder: '提供商 Base URL',
    providerApiKeyPlaceholder: '提供商 API Key',
    providerModelPlaceholder: '模型（默认 5.4）',
    providerProtocol: '协议',
    providerProtocolOpenai: 'OpenAI 兼容',
    providerProtocolAnthropic: 'Anthropic Claude',
    providerProtocolGemini: 'Gemini',
    providerFastMode: '开启 Fast Mode',
    createProvider: '新增提供商',
    editProvider: '编辑提供商',
    editAccount: '编辑账号',
    editAccountTokensTitle: '编辑账号令牌',
    editAccountTokensHint:
      '仅编辑需要更新的字段，留空则保留原值。保存后会重新解析邮箱、计划等派生信息。',
    accessTokenLabel: 'Access Token',
    refreshTokenLabel: 'Refresh Token',
    idTokenLabel: 'ID Token（可选）',
    accountIdHintLabel: 'Account ID 提示（可选）',
    accessTokenPlaceholder: '粘贴新的 access_token，留空保留原值',
    refreshTokenPlaceholder: '粘贴新的 refresh_token，留空保留原值',
    idTokenPlaceholder: '可选，通常无需修改',
    accountIdHintPlaceholder: '可选，account_id 提示（从 id_token 解析失败时使用）',
    saveAccountTokens: '保存令牌',
    editAccountTokensEmptyError: '请至少填写一个令牌字段。',
    editAccountTokensLoading: '正在加载当前令牌…',
    editAccountTokensLoadFailed: (message: string) => `读取令牌失败：${message}`,
    editAccountTokensSuccess: '令牌已更新。',
    editAccountTokensFailed: (message: string) => `令牌保存失败：${message}`,
    accountDetailsExpand: '展开详情',
    accountDetailsCollapse: '收起详情',
    accountDetailsSectionIdentity: '身份信息',
    accountDetailsSectionSubscription: '订阅与计划',
    accountDetailsSectionTokens: '令牌状态',
    accountDetailsSectionTimestamps: '时间戳与唤醒',
    accountDetailsFieldEmail: '邮箱',
    accountDetailsFieldName: '昵称',
    accountDetailsFieldAccountId: 'Account ID',
    accountDetailsFieldRowId: '本地 ID',
    accountDetailsFieldHealth: '账号状态',
    accountDetailsFieldPlanType: '计划类型',
    accountDetailsFieldLimitName: '额度名称',
    accountDetailsFieldSubscriptionExpiresAt: '订阅到期',
    accountDetailsFieldCredits: '余额',
    accountDetailsFieldCreditsLocal: '本地消息',
    accountDetailsFieldCreditsCloud: '云消息',
    accountDetailsFieldPrimaryReset: '5 小时重置',
    accountDetailsFieldSecondaryReset: '周限额重置',
    accountDetailsFieldAccessToken: 'Access Token',
    accountDetailsFieldRefreshToken: 'Refresh Token',
    accountDetailsFieldIdToken: 'ID Token',
    accountDetailsFieldCreatedAt: '创建时间',
    accountDetailsFieldUpdatedAt: '最近更新',
    accountDetailsFieldLastUsedAt: '最后使用',
    accountDetailsFieldWakeSchedule: '定时唤醒',
    accountDetailsFieldWakeLastRun: '上次唤醒',
    accountDetailsFieldWakeLastStatus: '上次结果',
    accountDetailsTokenMissing: '未设置',
    accountDetailsTokenNoExpiry: '未包含过期信息',
    accountDetailsTokenExpired: (value: string) => `已过期 ${value}`,
    accountDetailsTokenExpiresIn: (value: string) => `${value} 后过期`,
    accountDetailsTokenLoading: '读取中…',
    accountDetailsTokenLoadFailed: (message: string) => `读取令牌失败：${message}`,
    accountDetailsTokenRefresh: '刷新',
    forceRefreshTokensTitle: '强制刷新令牌',
    forceRefreshTokensDescription:
      '使用 refresh_token 向 OpenAI 请求新的 access_token 和 id_token，无论当前令牌是否过期。',
    forceRefreshTokensButton: '强制刷新',
    forceRefreshTokensRunning: '刷新中…',
    forceRefreshTokensSuccess: '刷新成功',
    forceRefreshTokensError: '刷新失败',
    forceRefreshTokensIdle: '就绪',
    forceRefreshTokensBefore: '刷新前',
    forceRefreshTokensAfter: '刷新后',
    forceRefreshTokensAccessToken: 'Access Token',
    forceRefreshTokensRefreshToken: 'Refresh Token',
    forceRefreshTokensIdToken: 'ID Token',
    forceRefreshTokensLogTitle: '操作日志',
    forceRefreshTokensLogEmpty: '等待操作…',
    forceRefreshTokensShowRaw: '显示原始日志',
    forceRefreshTokensHideRaw: '隐藏原始日志',
    forceRefreshTokensRawWarning: '原始日志包含敏感令牌信息，确定要显示吗？',
    forceRefreshTokensConfirmRaw: '确认显示',
    forceRefreshTokensNoExpiry: '无过期信息',
    accountDetailsCreditsUnlimited: '无限额',
    accountDetailsCreditsNone: '无',
    accountDetailsEmpty: '--',
    accountDetailsJustNow: '刚刚',
    accountDetailsAgo: (value: string) => `${value}前`,
    accountDetailsInFuture: (value: string) => `${value}后`,
    accountDetailsCopyValue: '复制',
    accountDetailsCopied: '已复制',
    saveProvider: '保存提供商',
    deleteProvider: '删除提供商',
    deleteProviderConfirm: (label: string) => `删除提供商 ${label}？`,
    providerBadge: '自定义提供商',
    providerEmptyName: 'custom',
    providerCreateDialogDescription:
      '填写兼容 OpenAI 的接口地址和 Key，可先请求模型列表再选择模型。',
    providerModelProbe: '请求模型列表',
    providerModelProbeLoading: '请求中…',
    providerModelProbeFailed: '请求模型列表失败，请检查 Base URL 和 API Key。',
    providerModelProbeFound: (count: number) => `找到 ${count} 个模型`,
    noProviders: '还没有自定义提供商。',
    localGateway: '本地服务',
    localGatewayTitle: '本地反代网关',
    localGatewayDescription: 'Sub2API 风格本地网关，兼容 OpenAI / Claude / Gemini 客户端。',
    localGatewayRunning: '运行中',
    localGatewayStopped: '已停止',
    startLocalGateway: '启动服务',
    stopLocalGateway: '停止服务',
    localGatewayOpenCodex: '直接打开 Codex',
    localGatewayOpenCodexIsolated: '多开 Codex',
    localGatewayOpenCodexRequiresRunning: '请先启动本地服务。',
    rotateLocalGatewayKey: '轮换 Key',
    copyLocalGatewayBaseUrl: '复制 Base URL',
    copyLocalGatewayApiKey: '复制 API Key',
    localGatewayShowApiKey: '显示 API Key',
    localGatewayHideApiKey: '隐藏 API Key',
    localGatewayNoApiKey: '启动或轮换后生成',
    localGatewayKeyRotated: '已轮换，完整 Key 已复制到剪贴板。',
    localGatewayConfigHint: '客户端配置',
    localGatewayLogs: '请求日志',
    localGatewayLogsHint: '仅保留最近 80 条本地请求。',
    localGatewayNoLogs: '暂无请求日志',
    localGatewayNoMatchedLogs: '没有匹配的请求日志',
    localGatewayHealth: '健康',
    localGatewayHealthReady: '就绪',
    localGatewayHealthIdle: '待命',
    localGatewayPort: '端口',
    localGatewayRequests: '请求数',
    localGatewaySuccessRate: '成功率',
    localGatewayAvgLatency: '平均延迟',
    localGatewayErrors: '错误数',
    localGatewayStatusFilter: '状态筛选',
    localGatewayAllStatus: '全部状态',
    localGatewaySearchLogs: '搜索路径 / 状态…',
    localGatewayLogTime: '时间',
    localGatewayLogMethod: '方法',
    localGatewayLogPath: '路径',
    localGatewayLogProvider: 'Provider',
    localGatewayLogModel: '模型',
    localGatewayLogTokens: 'Tokens',
    localGatewayLogLatency: '延迟',
    localGatewayLogStatus: '状态',
    localGatewayLogDetail: '详情',
    localGatewayLogTarget: '目标',
    localGatewayLogClient: '客户端',
    localGatewayLogRequestBytes: '请求大小',
    localGatewayLogResponseBytes: '响应大小',
    localGatewayLogContentType: 'Content-Type',
    localGatewayColumnSettings: '列显示',
    localGatewayExpandDetail: '展开详情',
    localGatewayCollapseDetail: '收起详情',
    localGatewayModelMappingsTitle: '模型映射',
    localGatewayModelMappingsHint:
      '将客户端发送的模型名映射到上游 Codex 支持的模型。命中映射后用目标模型向上游发请求。',
    localGatewayModelMappingsEmpty: '尚未配置映射。',
    localGatewayModelMappingFromPlaceholder: '客户端模型（例如 claude-3-5-sonnet）',
    localGatewayModelMappingToPlaceholder: '上游模型（例如 gpt-5.5）',
    localGatewayModelMappingAdd: '添加映射',
    localGatewayModelMappingRemove: '删除',
    localGatewayModelMappingDuplicate: '已存在相同的源模型，请直接编辑现有条目。',
    localGatewayModelMappingsManage: '管理映射',
    localGatewayModelMappingsMore: (count: number) => `还有 ${count} 条映射，打开弹框查看。`,
    localGatewayAllowedGroupsTitle: '允许使用的组或账号',
    localGatewayAllowedGroupsHint:
      '至少选择一个组或账号才能启动本地网关，只有被选中的账号或组内账号会参与路由。',
    localGatewayAllowedGroupsEmpty: '还没有创建组，请先在账号页的组管理中创建。',
    localGatewayAllowedGroupsRequired: '请至少选择一个组、账号或 Provider 后再启动本地网关。',
    localGatewayAllowedTargetsAdd: '添加组或账号',
    localGatewayAllowedProvidersTitle: 'Provider 回退',
    localGatewayAllowedProvidersHint:
      '选择参与路由的 Provider。Codex 账号优先，失败时回退到已选 Provider。',
    localGatewayAddProvider: '添加 Provider',
    localGatewayRoutingNoProviders: '未配置 Provider，请先到 Provider 页面添加。',
    instanceManager: '实例管理',
    instanceManagerHint: '独立实例使用独立 CODEX_HOME，首次创建会复制当前 .codex。',
    instanceCount: (count: number) => `${count} 个实例`,
    defaultInstance: '默认实例',
    instanceNamePlaceholder: '实例名称',
    instanceDirPlaceholder: '实例目录（可选）',
    instanceArgsPlaceholder: '附加启动参数（可选）',
    instanceBindAccount: '绑定账号',
    instanceUnbound: '不绑定账号',
    createInstance: '创建实例',
    saveInstance: '保存实例',
    startInstance: '启动实例',
    stopInstance: '停止实例',
    deleteInstance: '删除实例',
    deleteInstanceConfirm: (name: string) => `删除实例 ${name}？实例目录也会被删除。`,
    instanceDirectory: '实例目录',
    instanceStatusRunning: '运行中',
    instanceStatusStopped: '未运行',
    instanceInitialized: '已初始化',
    instanceNeedsInit: '首次启动时初始化',
    defaultInstanceRoot: '默认实例目录',
    switchLanguage: '切换语言',
    switchTheme: (current: string) => `切换主题，当前${current}`,
    openGithub: '打开 GitHub',
    githubPending: 'GitHub 链接待配置',
    checkUpdates: '检查更新',
    checkingUpdates: '检查更新中',
    downloadUpdate: (version?: string) => `下载更新${version ? ` v${version}` : ''}`,
    updatingViaHomebrew: '正在通过 Homebrew 更新…',
    homebrewUpdateStatus: (status?: string, command?: string) => {
      switch (status) {
        case 'brew-update':
          return `正在执行：${command ?? 'brew update'}`
        case 'waiting-for-app-quit':
          return 'Homebrew 已准备安装，正在关闭应用…'
        case 'brew-upgrade':
          return `正在执行：${command ?? 'brew upgrade --cask codexdock'}`
        case 'reopening':
          return '正在重新打开应用…'
        default:
          return command ? `正在执行：${command}` : '正在通过 Homebrew 更新…'
      }
    },
    updateViaHomebrew: (version?: string) => `通过 Homebrew 更新${version ? ` v${version}` : ''}`,
    openReleasePage: (version?: string) => `前往下载${version ? ` v${version}` : ''}`,
    restartToInstallUpdate: '重启安装更新',
    updateReady: '更新已下载，重启后安装。',
    updateUpToDate: '当前已是最新版本。',
    updateAvailableVersion: (version?: string) =>
      version ? `发现新版本 v${version}` : '发现新版本',
    updateDownloadProgress: (progress?: number) => `下载中 ${progress ?? 0}%`,
    updatesUnsupported: '当前构建不支持自动更新',
    updateFailed: '检查更新失败',
    lightTheme: '浅色主题',
    darkTheme: '深色主题',
    systemTheme: '跟随系统',
    portOccupied: (command: string, pid: number) => `1455 端口当前被 ${command} (${pid}) 占用`,
    killPortOccupant: '结束占用进程',
    killPortOccupantFailed: '无法结束占用 1455 端口的进程',
    localGatewayPortOccupied: (port: number, command: string, pid: number) =>
      `本地服务端口 ${port} 当前被 ${command} (${pid}) 占用`,
    killLocalGatewayPortOccupant: '结束占用本地服务端口的进程',
    killLocalGatewayPortOccupantFailed: '无法结束占用本地服务端口的进程',
    emptyStateTitle: '还没有账号',
    emptyStateDescription: '导入当前登录，或者新建一次回调登录。',
    importCurrentHint: '导入当前登录',
    importCurrentDetail: '适合你已经在本机 Codex 里登录过账号的情况。',
    callbackLoginHint: '新建回调登录',
    callbackLoginDetail: '适合补充新账号，授权完成后会自动回调导入。',
    deviceLoginHint: '设备码登录',
    deviceLoginDetail: '适合在别的设备或浏览器里完成授权，再回到这里自动导入。'
  },
  en: {
    unnamedAccount: 'Unnamed account',
    actionFailed: 'Action failed',
    startLoginFailed: 'Unable to start login flow',
    readRateLimitFailed: 'Unable to read account limits',
    legacyAccountNeedsReimport:
      'This account was saved by an older Keychain-backed version. Re-import it to continue.',
    legacyProviderNeedsApiKey:
      'This provider API key was saved by an older Keychain-backed version. Enter it again and save the provider.',
    removeConfirm: (label: string) => `Remove the saved local session for ${label}?`,
    callbackLogin: 'Callback login',
    deviceLogin: 'Device code login',
    importCurrent: 'Import current login',
    importAccountsFile: 'Import account file',
    pasteSession: 'Paste session',
    pasteSessionTitle: 'Paste ChatGPT session',
    pasteSessionHint:
      'Paste the JSON from chatgpt.com/api/auth/session. Contains sensitive credentials.',
    pasteSessionLabel: 'Session JSON',
    pasteSessionPlaceholder: '{"user":{...},"accessToken":"eyJ...","account":{...}}',
    pasteSessionConfirm: 'Import',
    importMethodTitle: 'Choose import method',
    importFromFile: 'Import from file',
    importFromFileDescription: 'Select a local JSON file to import accounts.',
    importFromSession: 'Paste session',
    importFromSessionDescription: 'Paste ChatGPT web session JSON to import.',
    exportAccountsFile: 'Export account file',
    toolbarDialogTitle: 'Quick tools',
    closeDialog: 'Close',
    exportFormatDialogTitle: 'Choose export format',
    exportFormatDialogDescription:
      'Import auto-detects the source format. Choose the JSON structure that matches the target tool when exporting.',
    exportFormatTargetAll: 'Export all accounts',
    exportFormatTargetSelected: (count: number) =>
      `Export ${count} selected account${count === 1 ? '' : 's'}`,
    exportFormatCodexDock: 'CodexDock',
    exportFormatCodexDockDescription:
      'Native template with the full quota and extra metadata preserved.',
    exportFormatCockpitTools: 'Cockpit Tools',
    exportFormatCockpitToolsDescription: 'Compatible with the Cockpit Tools account array format.',
    exportFormatSub2api: 'sub2api',
    exportFormatSub2apiDescription: 'Compatible with the sub2api bulk import data format.',
    exportFormatCliProxyApi: 'CLIProxyAPI',
    exportFormatCliProxyApiDescription: 'Compatible with the CLIProxyAPI token storage format.',
    exportFormatConfirm: 'Export',
    exportFormatCancel: 'Cancel',
    switchBest: 'Switch to best account',
    alreadyBest: 'Already using best account',
    noBestAccount: 'No account to switch to',
    switchToAccount: (email: string) => `Switch to ${email}`,
    settings: 'Settings',
    generalSettings: 'General settings',
    generalSettingsDescription: 'These preferences are saved locally and reused on next launch.',
    pollingInterval: 'Usage polling',
    autoCheckUpdates: 'Check updates on startup',
    showLocalMockData: 'Show local mock data',
    toolbarSettings: 'Bottom toolbar',
    toolbarSettingsDescription: 'Configure the collapsed entry icon and drag behavior.',
    toolbarIconMovable: 'Allow dragging collapsed icon',
    toolbarIconMovableDescription:
      'Turn off the default position option to drag the collapsed icon and keep its position.',
    collapsedToolbarIconDefaultPosition: 'Show collapsed icon at default position',
    collapsedToolbarIconDefaultPositionDescription:
      'When enabled, the icon stays at the default bottom position. When disabled, it uses the dragged position.',
    codexDesktopExecutablePath: 'Multi-open Codex EXE',
    showCodexDesktopExecutablePath: 'Manual path',
    hideCodexDesktopExecutablePath: 'Hide',
    codexDesktopExecutablePlaceholder: 'For example C:\\Program Files\\Codex\\Codex.exe',
    minutes: 'min',
    callbackLoginLink: 'Authorization URL',
    deviceLoginLink: 'Device verification URL',
    deviceCode: 'Device code',
    copyLink: 'Copy link',
    copyCode: 'Copy code',
    openBrowser: 'Open browser',
    openMainPanel: 'Open main panel',
    waitingCallback: 'Waiting for authorization in the browser to call back to the local app.',
    waitingDeviceCode:
      'Finish authorization in the browser and CodexDock will continue automatically.',
    statusBarAccountCount: (count: number) => `${count} menu bar account${count === 1 ? '' : 's'}`,
    noStatusBarAccounts: 'No account selected for the menu bar.',
    statusBarDisplayAccounts: 'Menu bar accounts',
    maxFiveAccounts: 'Up to 5 accounts',
    visible: 'Shown',
    hidden: 'Hidden',
    accountList: 'Accounts',
    accountCount: (count: number) => `${count} account${count === 1 ? '' : 's'}`,
    tokenStats: 'Usage',
    tokenStatsTitle: 'Usage / consumption stats',
    tokenStatsDescription: 'Instance data comes from local Codex logs.',
    tokenStatsReadFailed: 'Unable to read usage stats',
    tokenStatsSelectedTarget: 'Selected target',
    tokenStatsDefaultFallback: 'No running instance, falling back to default',
    tokenStatsNoData: 'No local usage data yet',
    skills: 'Skills',
    skillsTitle: 'Skill management',
    skillsDescription: 'Manage skills across instances with copy support.',
    skillsRefresh: 'Refresh skills',
    skillsReadFailed: 'Unable to read skills',
    skillsEmpty: 'No skills yet',
    skillsInstanceEmpty: 'No skills for this instance',
    skillsCount: (count: number) => `${count} skill${count === 1 ? '' : 's'}`,
    skillsSearchPlaceholder: 'Search skill name or description',
    skillsAllInstances: 'All instances',
    skillsDetail: 'Skill detail',
    skillsBackToList: 'Back to list',
    skillsDetailLoading: 'Loading skill detail',
    skillsCopyToInstance: 'Copy to instance',
    skillsCopyDialogTitle: 'Copy skill',
    skillsCopyDialogDescription: (name: string) => `Copy ${name} to other instances`,
    skillsBulkCopyDialogDescription: (count: number) =>
      `Copy the selected ${count} skill${count === 1 ? '' : 's'} to other instances`,
    skillsBulkSelected: (count: number) => `${count} skill${count === 1 ? '' : 's'} selected`,
    skillsBulkSelectAllVisible: 'Select all visible',
    skillsBulkClear: 'Clear selection',
    skillsBulkCopyAction: (count: number) =>
      `Copy ${count} selected skill${count === 1 ? '' : 's'}`,
    skillsBulkCopyProgress: (done: number, total: number) => `Copying ${done}/${total}`,
    skillsBulkToggleSelect: 'Toggle selection',
    skillsCopySourceInstance: 'Source instance',
    skillsCopyTargetInstances: 'Target instances',
    skillsCopyTargetHelp:
      'Select target instances to copy to (instances with an existing skill of the same name will be skipped)',
    skillsCopyConfirm: 'Copy',
    skillsCopyCancel: 'Cancel',
    skillsCopyResult: 'Copy result',
    skillsCopySuccess: (count: number) => `Copied to ${count} instance${count === 1 ? '' : 's'}`,
    skillsCopySkipped: (count: number) =>
      `${count} instance${count === 1 ? '' : 's'} already had this skill, skipped`,
    skillsCopyFailed: (count: number) =>
      `Failed to copy to ${count} instance${count === 1 ? '' : 's'}`,
    skillsCopyNoTarget: 'Select at least one target instance',
    skillsInstance: 'Instance',
    skillsName: 'Name',
    skillsDescription2: 'Description',
    skillsPath: 'Path',
    skillLibrary: 'Skill Library',
    skillLibraryTitle: 'Skill Library',
    skillLibraryDescription:
      'Manage your local skill library. Supports categories, search, import/export, and installation to instances.',
    skillLibraryEmpty: 'Skill library is empty',
    skillLibraryCount: (count: number) => `${count} skill${count === 1 ? '' : 's'}`,
    skillLibraryLoading: 'Loading skill library',
    skillLibraryRefresh: 'Refresh',
    skillLibrarySearchPlaceholder: 'Search skill name or description',
    skillLibraryAllCategories: 'All categories',
    skillLibraryCreate: 'New skill',
    skillLibraryEdit: 'Edit',
    skillLibrarySave: 'Save',
    skillLibraryCancel: 'Cancel',
    skillLibraryDelete: 'Delete',
    skillLibraryDeleteConfirm: (name: string) => `Delete skill "${name}"?`,
    skillLibraryBackToList: 'Back to list',
    skillLibraryNamePlaceholder: 'Skill name',
    skillLibraryContentPlaceholder: 'Enter SKILL.md content...',
    skillLibraryCategoryManager: 'Category manager',
    skillLibraryCategoryCreate: 'New category',
    skillLibraryCategoryRename: 'Rename',
    skillLibraryCategoryRemove: 'Delete',
    skillLibraryCategoryRemoveConfirm: (name: string) =>
      `Remove category "${name}"? It will be removed from all skills.`,
    skillLibraryCategoryPlaceholder: 'Category name',
    skillLibraryCategorySelection: 'Categories',
    skillLibraryInstall: 'Install to instance',
    skillLibraryInstallTitle: 'Install skill',
    skillLibraryInstallDescription: (name: string) => `Install "${name}" to selected instances`,
    skillLibraryInstallConfirm: 'Confirm install',
    skillLibraryInstallNoTarget: 'Please select at least one target instance',
    skillLibraryInstallSuccess: (count: number) =>
      `Successfully installed to ${count} instance${count === 1 ? '' : 's'}`,
    skillLibraryInstallSkipped: (count: number) =>
      `${count} instance${count === 1 ? '' : 's'} already had this skill, skipped`,
    skillLibraryInstallFailed: (count: number) =>
      `${count} instance${count === 1 ? '' : 's'} failed`,
    skillLibraryCollect: 'Collect from instance',
    skillLibraryImport: 'Import',
    skillLibraryExport: 'Export',
    skillLibraryImportPrompt: 'Enter the skill directory path to import',
    skillLibraryExportPrompt: 'Enter the target directory path for export',
    skillLibraryImportResult: (imported: number, skipped: number) =>
      `Imported ${imported}, skipped ${skipped}`,
    skillLibraryExportResult: (exported: number, outputPath: string) =>
      `Exported ${exported} skills to ${outputPath}`,
    skillLibraryCollectResult: (collected: number, skipped: number) =>
      `Collected ${collected}, skipped ${skipped}`,
    skillLibraryErrorCount: (count: number) => `${count} error${count === 1 ? '' : 's'}`,
    skillLibraryCollectInstance: 'Instance',
    skillLibraryCollectNames: 'Skill directory names (comma-separated)',
    skillLibraryCollectPlaceholder: 'skill-a, skill-b',
    prompts: 'Prompts',
    promptsTitle: 'Prompt management',
    promptsDescription:
      'Manage locally saved prompt templates with categories, search, and import/export.',
    promptsEmpty: 'No prompts yet',
    promptsCount: (count: number) => `${count} prompt${count === 1 ? '' : 's'}`,
    promptsLoading: 'Loading prompts',
    promptsRefresh: 'Refresh',
    promptsUpdated: (date: string) => `Updated ${date}`,
    promptsSearchPlaceholder: 'Search title or content',
    promptsAllCategories: 'All categories',
    promptsCreate: 'New prompt',
    promptsEdit: 'Edit',
    promptsSave: 'Save',
    promptsCancel: 'Cancel',
    promptsDelete: 'Delete',
    promptsDeleteConfirm: (title: string) => `Delete prompt "${title}"?`,
    promptsCopyContent: 'Copy content',
    promptsCopied: 'Copied',
    promptsBackToList: 'Back to list',
    promptsTitlePlaceholder: 'Prompt title',
    promptsContentPlaceholder: 'Enter prompt content...',
    promptsCategoryManager: 'Category manager',
    promptsCategoryCreate: 'New category',
    promptsCategoryRename: 'Rename',
    promptsCategoryRemove: 'Remove',
    promptsCategoryRemoveConfirm: (name: string) =>
      `Remove category "${name}"? It will be removed from all prompts.`,
    promptsCategoryPlaceholder: 'Category name',
    promptsImagesLabel: 'Reference images',
    promptsImagesUpload: 'Add image',
    promptsImagesEmpty: 'No reference images yet',
    promptsImagesHint: 'PNG, JPG, WebP, GIF or SVG up to 10 MB each',
    promptsImagesRemove: 'Remove image',
    promptsImagesCreateFirst: 'Save the prompt first before attaching images',
    promptsImagesTooLarge: (name: string) => `Image "${name}" exceeds 10 MB and was skipped`,
    promptsImagesInvalidType: (name: string) => `File "${name}" is not a supported image type`,
    promptsImagesUploadFailed: 'Failed to upload image',
    promptsImageBuiltInHint: 'Built-in category, cannot be removed or renamed',
    sessions: 'Sessions',
    sessionsTitle: 'Session management',
    sessionsDescription:
      'Local Codex sessions grouped by instance. You can view, copy, or delete them; deletion moves files to the system Trash.',
    sessionsReadFailed: 'Unable to read sessions',
    sessionsRefresh: 'Refresh sessions',
    sessionsAllInstances: 'All instances',
    sessionsSearchPlaceholder: 'Filter by project path',
    sessionsInstanceSearchPlaceholder: 'Search this instance',
    sessionsStatusAll: 'All statuses',
    sessionsStatusActive: 'Active',
    sessionsStatusArchived: 'Archived',
    sessionsEmpty: 'No sessions yet',
    sessionsInstanceEmpty: 'No sessions for this instance',
    sessionsCount: (count: number) => `${count} session${count === 1 ? '' : 's'}`,
    sessionsProviderCount: (count: number) => `${count} provider${count === 1 ? '' : 's'}`,
    sessionsProjectCount: (count: number) => `${count} project${count === 1 ? '' : 's'}`,
    sessionsUnknownProvider: 'Unknown provider',
    sessionsUnknownProject: 'Unknown project',
    sessionsShowMore: (count: number) => `Show ${count} more`,
    sessionsCollapse: 'Collapse',
    sessionsScannedAt: (value: string) => `Scanned at ${value}`,
    sessionsSource: 'Source',
    sessionsSourceCustom: 'Custom source',
    sessionsInstance: 'Instance',
    sessionsProvider: 'Provider',
    sessionsProject: 'Project',
    sessionsCreatedAt: 'Created',
    sessionsUpdatedAt: 'Updated',
    sessionsBranch: 'Branch',
    sessionsId: 'Session ID',
    sessionsLastMessage: 'Last message',
    sessionsDetail: 'Session detail',
    sessionsBackToList: 'Back to list',
    sessionsDetailLoading: 'Loading session detail',
    sessionsNoMessages: 'No conversation content to display',
    sessionsImageAlt: 'Session image',
    sessionsCopyToProvider: 'Copy to provider',
    sessionsTargetInstance: 'Target instance',
    sessionsTargetProvider: 'Target provider',
    sessionsCopyTargetInstanceHelp:
      'Choose which Codex instance should receive the copied session.',
    sessionsCopyTargetProviderHelp:
      'Only providers already present or bound under the target instance are shown. Its configured model will be used.',
    sessionsCopyConfirm: 'Copy',
    sessionsCopyFailed: 'Failed to copy session',
    sessionsNoTargetProvider: 'No providers available. Add a provider first.',
    sessionsCopySuccess: (instanceName: string, model: string) =>
      `Copied to ${instanceName} with model ${model}`,
    sessionsCopySessionLabel: (title: string) => `Copy ${title} to another provider`,
    sessionsBulkSelected: (count: number) => `${count} session${count === 1 ? '' : 's'} selected`,
    sessionsBulkClear: 'Clear selection',
    sessionsBulkToggleSelect: 'Toggle selection',
    sessionsBulkCopyAction: (count: number) =>
      `Copy ${count} selected session${count === 1 ? '' : 's'}`,
    sessionsBulkCopyConfirm: (count: number) => `Copy ${count} session${count === 1 ? '' : 's'}`,
    sessionsBulkCopyProgress: (done: number, total: number) => `Copying ${done}/${total}`,
    sessionsBulkCopyDialogTitle: (count: number) =>
      `Bulk copy ${count} session${count === 1 ? '' : 's'}`,
    sessionsBulkCopySuccess: (count: number) => `${count} session${count === 1 ? '' : 's'} copied`,
    sessionsBulkCopyFailureCount: (count: number) =>
      `${count} session${count === 1 ? '' : 's'} failed`,
    sessionsBulkCopyResult: 'Bulk copy result',
    sessionsTrashSession: 'Delete',
    sessionsTrashSessionLabel: (title: string) => `Delete session ${title}`,
    sessionsTrashConfirmTitle: 'Confirm delete',
    sessionsTrashConfirmMessage:
      'This session will be moved to the system Trash. You can restore it from there.',
    sessionsTrashConfirmAction: 'Delete',
    sessionsTrashSuccess: 'Moved to Trash',
    sessionsTrashFailed: 'Failed to delete session',
    sessionsBulkTrashAction: (count: number) =>
      `Delete ${count} selected session${count === 1 ? '' : 's'}`,
    sessionsBulkTrashConfirmMessage: (count: number) =>
      `${count} session${count === 1 ? '' : 's'} will be moved to the system Trash. You can restore ${count === 1 ? 'it' : 'them'} from there.`,
    sessionsBulkTrashProgress: (done: number, total: number) => `Deleting ${done}/${total}`,
    sessionsBulkTrashSuccess: (count: number) =>
      `${count} session${count === 1 ? '' : 's'} moved to Trash`,
    sessionsBulkTrashFailureCount: (count: number) =>
      `${count} session${count === 1 ? '' : 's'} failed to delete`,
    sessionsExpandMessage: 'Expand message',
    sessionsCollapseMessage: 'Collapse message',
    sessionsRoleUser: 'User',
    sessionsRoleAssistant: 'Assistant',
    sessionsRoleSystem: 'System',
    sessionsRoleDeveloper: 'Developer',
    sessionsRoleTool: 'Tool',
    sessionsRoleOther: 'Other',
    runningTokenCostSummary: 'All instances summary',
    runningInstanceCount: (count: number) => `${count} running instance${count === 1 ? '' : 's'}`,
    today: 'Today',
    last30Days: 'Last 30 days',
    tokens: 'tokens',
    cost: 'cost',
    costReference: (value: string) => `Cost reference ${value}`,
    updatedAt: 'Updated',
    dailyTrend: '30-day daily trend',
    trendMetric: 'Trend metric',
    trendMetricTokens: 'Tokens',
    trendMetricCost: 'Cost',
    modelBreakdown: 'Model breakdown',
    instanceUsage: 'Instance usage / consumption',
    instanceUsageDescription:
      'Aggregates 30-day tokens by instance, with cost kept as context only.',
    displayConfig: 'Display config',
    displayConfigDescription: 'Checked charts stay visible on the stats page and persist locally.',
    noChartsVisible: 'All charts are hidden. Re-enable them from the display config above.',
    inputTokens: 'input tokens',
    outputTokens: 'output tokens',
    dailyAvgTokens: 'Daily avg tokens',
    dailyAvgCost: 'Daily avg cost',
    peakDay: 'Peak day',
    peakDayTokens: 'Peak tokens',
    statsDays: 'Days tracked',
    modelsUsedCount: 'Models used',
    costStatus: 'Cost status',
    costStatusAllKnown: 'Fully calculable',
    costStatusPartialUnknown: 'Partial pricing unknown',
    costStatusNoCost: 'No cost data',
    costUnknown: 'Price unknown',
    topModel: 'Top model',
    topModelSummary: (name: string, percent: string) => `${name}, ${percent}`,
    costUnknownModelsHint: 'Some model prices are unknown. Cost reflects known models only.',
    trendTooltipModels: 'Models',
    instanceRunning: 'Running',
    instanceStopped: 'Stopped',
    emptyReasonNoLogs: 'No local Codex logs found',
    emptyReasonNoTokenCount: 'Logs contain no token_count records',
    emptyReasonNoRecentUsage: 'This instance has no recent usage',
    sessionUsed: 'Session used',
    weeklyUsed: 'Weekly used',
    credits: 'Credits',
    unlimited: 'Unlimited',
    refresh: 'Refresh',
    refreshing: 'Refreshing',
    selectedAccountCount: (count: number) => `${count} selected account${count === 1 ? '' : 's'}`,
    selectAccount: 'Select account',
    selectAllVisibleAccounts: 'Select visible',
    clearSelectedAccounts: 'Clear selection',
    exportAccount: 'Export account',
    exportSelectedAccounts: 'Export selected',
    deleteSelectedAccounts: 'Delete selected',
    removeSelectedConfirm: (count: number) =>
      `Remove the ${count} selected saved local session${count === 1 ? '' : 's'}?`,
    providerList: 'Providers',
    providerCount: (count: number) => `${count} provider${count === 1 ? '' : 's'}`,
    dragSortHint: 'Drag the left handle to reorder',
    dragSortHandle: 'Drag to reorder',
    manageGroups: 'Manage groups',
    groupManagerTitle: 'Manage groups',
    groupManagerHint:
      'Create, rename, or delete groups to organize accounts and filter them in the local gateway.',
    groupManagerNoAccountsHint: 'Import accounts first to assign them to groups.',
    newGroupPlaceholder: 'Enter a new group name',
    createGroup: 'Create group',
    renameGroup: 'Rename group',
    deleteGroup: 'Delete group',
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    allGroups: 'All',
    ungrouped: 'Ungrouped',
    filterByGroup: 'Filter by group',
    filtersAndBulkActions: 'Filters & bulk actions',
    showFiltersAndBulkActions: 'Show filters and bulk actions',
    hideFiltersAndBulkActions: 'Hide filters and bulk actions',
    emptyFilterTools: 'Import accounts to unlock filters and bulk actions',
    addGroup: 'Add to group',
    removeGroup: 'Remove from group',
    groupMemberCount: (count: number) => `${count} account${count === 1 ? '' : 's'}`,
    noGroups: 'No groups yet. Create one above first.',
    noAccountsForFilter: 'No accounts match the current filter.',
    deleteGroupConfirm: (name: string) =>
      `Delete group ${name}? It will also be removed from any assigned accounts.`,
    active: 'Active',
    accountExpired: 'Expired',
    accountUsageRefreshFailed: 'Refresh failed',
    accountExpiredHint: 'Session is no longer valid. Sign in again or re-import the current login.',
    accountHealthNormal: 'Normal',
    accountHealthAuthError: 'Account issue',
    accountHealthAuthErrorHint: (reason: string) =>
      `This account is excluded until you repair it and mark it normal. Reason: ${reason}`,
    accountHealthSource: 'Source',
    accountHealthMarkedAt: 'Marked at',
    accountHealthHttpStatus: 'HTTP status',
    markAccountNormal: 'Mark as normal',
    sessionQuota: 'Session',
    weeklyQuota: 'Weekly',
    sessionReset: 'Session resets',
    weeklyReset: 'Weekly resets',
    subscriptionExpiresAt: 'Subscription expires',
    subscriptionRemaining: (value: string) => `Subscription ${value} left`,
    subscriptionExpiredAgo: (value: string) => `Subscription expired ${value} ago`,
    tokenExpiresAtLabel: 'Token expires at',
    tokenExpiringSoon: (value: string) => `Token expires in ${value}`,
    tokenExpiredAgo: (value: string) => `Token expired ${value} ago`,
    tagVisibilityTitle: 'Display',
    tagVisibilitySubscription: 'Subscription',
    tagVisibilityTokenExpiry: 'Token Expiry',
    tagVisibilityWakeSchedule: 'Wake Schedule',
    tagVisibilityGroups: 'Groups',
    tagVisibilityQuotaSummary: 'Quota Summary',
    openCodex: 'Open Codex',
    openCodexIsolated: 'Open isolated Codex',
    openCustomProvider: 'Launch provider',
    openCustomProviderIsolated: 'Launch provider isolated',
    switchAccount: 'Switch account',
    refreshQuota: 'Refresh usage',
    wakeQuota: 'Wake',
    wakeQuotaHint: 'Send a request to start the current session timer',
    wakeQuotaUnsupported: 'Wake is not supported on the Free plan',
    wakeSchedule: 'Wake schedule',
    wakeScheduleHint: 'Send wake requests automatically on a schedule',
    wakeDialogTitle: 'Wake center',
    wakeDialogDescription:
      'Send an immediate wake request or configure the wake schedule from the same dialog.',
    wakeScheduleDialogTitle: 'Wake schedule',
    wakeScheduleDialogDescription: 'Automatically send wake requests at the selected local times.',
    wakeScheduleEnabled: 'Enable scheduled wake',
    wakeScheduleTimes: 'Times',
    wakeScheduleAddTime: 'Add time',
    wakeScheduleTimePlaceholder: 'For example: 09:00',
    wakeScheduleRemoveTime: 'Remove time',
    wakeScheduleNextRun: 'Next run',
    wakeScheduleLastRun: 'Last run',
    wakeScheduleLastStatus: 'Last result',
    wakeScheduleLastMessage: 'Result detail',
    wakeScheduleDelete: 'Delete schedule',
    wakeScheduleSave: 'Save schedule',
    wakeScheduleNoTimes: 'Add at least one time',
    wakeScheduleInvalidTime: 'Time must use HH:mm format',
    wakeScheduleEmpty: 'Not set',
    wakeScheduleStatusIdle: 'Idle',
    wakeScheduleStatusSuccess: 'Success',
    wakeScheduleStatusError: 'Error',
    wakeScheduleStatusSkipped: 'Skipped',
    wakeQuotaDialogTitle: 'Wake session',
    wakeQuotaDialogDescription: 'Send a request to start this session timer.',
    wakeQuotaPromptLabel: 'Prompt',
    wakeQuotaPromptPlaceholder: 'For example: ping',
    wakeQuotaModelLabel: 'Model',
    wakeQuotaModelPlaceholder: 'For example: gpt-5.4-mini',
    wakeQuotaConfirm: 'Wake now',
    wakeQuotaCancel: 'Cancel',
    wakeQuotaStatusIdle: 'Idle',
    wakeQuotaStatusRunning: 'Running',
    wakeQuotaStatusSuccess: 'Done',
    wakeQuotaStatusSkipped: 'Skipped',
    wakeQuotaStatusError: 'Failed',
    wakeQuotaLogTitle: 'Output',
    wakeQuotaLogEmpty: 'No output yet. Start the wake request below to see progress here.',
    wakeQuotaLogReady: (label: string) => `Ready to wake ${label}.`,
    wakeQuotaLogStart: (model: string) => `Starting wake flow with model ${model}`,
    wakeQuotaLogPrompt: (prompt: string) => `Prompt: ${prompt}`,
    wakeQuotaLogRequesting: 'Sending wake request…',
    wakeQuotaLogAccepted: (status: number) => `Request returned with status ${status}`,
    wakeQuotaLogResponse: (text: string) => `Final response: ${text}`,
    wakeQuotaLogRefreshingUsage: 'Refreshing usage state…',
    wakeQuotaLogSessionReset: (value: string) => `Session reset: ${value}`,
    wakeQuotaLogWeeklyReset: (value: string) => `Weekly reset: ${value}`,
    wakeQuotaLogCompleted: 'Wake flow completed.',
    wakeQuotaLogSkipped: 'Wake request was skipped because the condition changed.',
    wakeQuotaLogFailed: (message: string) => `Wake failed: ${message}`,
    wakeQuotaResult: 'Response',
    wakeQuotaResultStatus: 'Status',
    wakeQuotaResultEmpty: 'Empty response',
    refreshAllQuota: 'Refresh all usage',
    refreshQuotaBlocked: (minutes: number) => `No repeat request within ${minutes} min`,
    quotaSummaryTitle: 'Quota summary',
    quotaSummarySubtitle: (count: number) => `${count} non-Free account${count === 1 ? '' : 's'}`,
    quotaSummaryPrimaryLabel: '5h avg. remaining',
    quotaSummarySecondaryLabel: 'Weekly avg. remaining',
    quotaSummaryAccountSuffix: (count: number) => `${count} account${count === 1 ? '' : 's'}`,
    quotaSummaryEmpty: 'No usage data yet',
    deleteSaved: 'Delete saved login',
    noSavedAccounts:
      'No saved accounts yet. Import the current login or start a new callback login.',
    providerNamePlaceholder: 'Provider name (optional)',
    providerBaseUrlPlaceholder: 'Provider base URL',
    providerApiKeyPlaceholder: 'Provider API key',
    providerModelPlaceholder: 'Model (default 5.4)',
    providerProtocol: 'Protocol',
    providerProtocolOpenai: 'OpenAI compatible',
    providerProtocolAnthropic: 'Anthropic Claude',
    providerProtocolGemini: 'Gemini',
    providerFastMode: 'Enable Fast Mode',
    createProvider: 'Create provider',
    editProvider: 'Edit provider',
    editAccount: 'Edit account',
    editAccountTokensTitle: 'Edit account tokens',
    editAccountTokensHint:
      'Only fill in what you want to change; empty fields keep the existing value. Email and plan metadata are re-derived after saving.',
    accessTokenLabel: 'Access Token',
    refreshTokenLabel: 'Refresh Token',
    idTokenLabel: 'ID Token (optional)',
    accountIdHintLabel: 'Account ID hint (optional)',
    accessTokenPlaceholder: 'Paste new access_token, leave blank to keep existing',
    refreshTokenPlaceholder: 'Paste new refresh_token, leave blank to keep existing',
    idTokenPlaceholder: 'Optional, usually no need to change',
    accountIdHintPlaceholder: 'Optional account_id hint when id_token parsing fails',
    saveAccountTokens: 'Save tokens',
    editAccountTokensEmptyError: 'Provide at least one token to update.',
    editAccountTokensLoading: 'Loading current tokens…',
    editAccountTokensLoadFailed: (message: string) => `Failed to load tokens: ${message}`,
    editAccountTokensSuccess: 'Tokens updated.',
    editAccountTokensFailed: (message: string) => `Failed to save tokens: ${message}`,
    accountDetailsExpand: 'Expand details',
    accountDetailsCollapse: 'Collapse details',
    accountDetailsSectionIdentity: 'Identity',
    accountDetailsSectionSubscription: 'Subscription & plan',
    accountDetailsSectionTokens: 'Token status',
    accountDetailsSectionTimestamps: 'Timestamps & wake',
    accountDetailsFieldEmail: 'Email',
    accountDetailsFieldName: 'Name',
    accountDetailsFieldAccountId: 'Account ID',
    accountDetailsFieldRowId: 'Local ID',
    accountDetailsFieldHealth: 'Account status',
    accountDetailsFieldPlanType: 'Plan type',
    accountDetailsFieldLimitName: 'Limit name',
    accountDetailsFieldSubscriptionExpiresAt: 'Subscription expires',
    accountDetailsFieldCredits: 'Balance',
    accountDetailsFieldCreditsLocal: 'Local messages',
    accountDetailsFieldCreditsCloud: 'Cloud messages',
    accountDetailsFieldPrimaryReset: 'Session reset',
    accountDetailsFieldSecondaryReset: 'Weekly reset',
    accountDetailsFieldAccessToken: 'Access Token',
    accountDetailsFieldRefreshToken: 'Refresh Token',
    accountDetailsFieldIdToken: 'ID Token',
    accountDetailsFieldCreatedAt: 'Created at',
    accountDetailsFieldUpdatedAt: 'Updated at',
    accountDetailsFieldLastUsedAt: 'Last used',
    accountDetailsFieldWakeSchedule: 'Wake schedule',
    accountDetailsFieldWakeLastRun: 'Last wake',
    accountDetailsFieldWakeLastStatus: 'Last result',
    accountDetailsTokenMissing: 'Not set',
    accountDetailsTokenNoExpiry: 'No expiration info',
    accountDetailsTokenExpired: (value: string) => `Expired ${value} ago`,
    accountDetailsTokenExpiresIn: (value: string) => `Expires in ${value}`,
    accountDetailsTokenLoading: 'Loading…',
    accountDetailsTokenLoadFailed: (message: string) => `Failed to load tokens: ${message}`,
    accountDetailsTokenRefresh: 'Refresh',
    forceRefreshTokensTitle: 'Force Refresh Tokens',
    forceRefreshTokensDescription:
      'Request new access_token and id_token from OpenAI using the refresh_token, regardless of current expiry state.',
    forceRefreshTokensButton: 'Force Refresh',
    forceRefreshTokensRunning: 'Refreshing…',
    forceRefreshTokensSuccess: 'Refresh successful',
    forceRefreshTokensError: 'Refresh failed',
    forceRefreshTokensIdle: 'Ready',
    forceRefreshTokensBefore: 'Before',
    forceRefreshTokensAfter: 'After',
    forceRefreshTokensAccessToken: 'Access Token',
    forceRefreshTokensRefreshToken: 'Refresh Token',
    forceRefreshTokensIdToken: 'ID Token',
    forceRefreshTokensLogTitle: 'Operation log',
    forceRefreshTokensLogEmpty: 'Waiting for operation…',
    forceRefreshTokensShowRaw: 'Show raw logs',
    forceRefreshTokensHideRaw: 'Hide raw logs',
    forceRefreshTokensRawWarning: 'Raw logs contain sensitive token data. Are you sure?',
    forceRefreshTokensConfirmRaw: 'Confirm',
    forceRefreshTokensNoExpiry: 'No expiry info',
    accountDetailsCreditsUnlimited: 'Unlimited',
    accountDetailsCreditsNone: 'None',
    accountDetailsEmpty: '--',
    accountDetailsJustNow: 'just now',
    accountDetailsAgo: (value: string) => `${value} ago`,
    accountDetailsInFuture: (value: string) => `in ${value}`,
    accountDetailsCopyValue: 'Copy',
    accountDetailsCopied: 'Copied',
    saveProvider: 'Save provider',
    deleteProvider: 'Delete provider',
    deleteProviderConfirm: (label: string) => `Delete provider ${label}?`,
    providerBadge: 'Custom provider',
    providerEmptyName: 'custom',
    providerCreateDialogDescription:
      'Enter an OpenAI-compatible endpoint and key. You can fetch the model list before choosing a model.',
    providerModelProbe: 'Fetch models',
    providerModelProbeLoading: 'Fetching…',
    providerModelProbeFailed: 'Failed to fetch models. Check the Base URL and API key.',
    providerModelProbeFound: (count: number) => `${count} model${count === 1 ? '' : 's'} found`,
    noProviders: 'No custom providers yet.',
    localGateway: 'Local service',
    localGatewayTitle: 'Local reverse proxy gateway',
    localGatewayDescription: 'Sub2API-style local gateway for OpenAI / Claude / Gemini clients.',
    localGatewayRunning: 'Running',
    localGatewayStopped: 'Stopped',
    startLocalGateway: 'Start service',
    stopLocalGateway: 'Stop service',
    localGatewayOpenCodex: 'Open Codex directly',
    localGatewayOpenCodexIsolated: 'Open isolated Codex',
    localGatewayOpenCodexRequiresRunning: 'Start the local service first.',
    rotateLocalGatewayKey: 'Rotate key',
    copyLocalGatewayBaseUrl: 'Copy Base URL',
    copyLocalGatewayApiKey: 'Copy API key',
    localGatewayShowApiKey: 'Show API key',
    localGatewayHideApiKey: 'Hide API key',
    localGatewayNoApiKey: 'Generated after start or rotate',
    localGatewayKeyRotated: 'Rotated. Full key copied to clipboard.',
    localGatewayConfigHint: 'Client config',
    localGatewayLogs: 'Request logs',
    localGatewayLogsHint: 'Keeps the latest 80 local requests.',
    localGatewayNoLogs: 'No requests yet',
    localGatewayNoMatchedLogs: 'No matching request logs',
    localGatewayHealth: 'Health',
    localGatewayHealthReady: 'Ready',
    localGatewayHealthIdle: 'Idle',
    localGatewayPort: 'Port',
    localGatewayRequests: 'Requests',
    localGatewaySuccessRate: 'Success rate',
    localGatewayAvgLatency: 'Avg latency',
    localGatewayErrors: 'Errors',
    localGatewayStatusFilter: 'Status filter',
    localGatewayAllStatus: 'All status',
    localGatewaySearchLogs: 'Search path / status…',
    localGatewayLogTime: 'Time',
    localGatewayLogMethod: 'Method',
    localGatewayLogPath: 'Path',
    localGatewayLogProvider: 'Provider',
    localGatewayLogModel: 'Model',
    localGatewayLogTokens: 'Tokens',
    localGatewayLogLatency: 'Latency',
    localGatewayLogStatus: 'Status',
    localGatewayLogDetail: 'Detail',
    localGatewayLogTarget: 'Target',
    localGatewayLogClient: 'Client',
    localGatewayLogRequestBytes: 'Req size',
    localGatewayLogResponseBytes: 'Res size',
    localGatewayLogContentType: 'Content-Type',
    localGatewayColumnSettings: 'Columns',
    localGatewayExpandDetail: 'Expand detail',
    localGatewayCollapseDetail: 'Collapse detail',
    localGatewayModelMappingsTitle: 'Model mappings',
    localGatewayModelMappingsHint:
      'Map client-sent model names to upstream Codex models. Matched entries rewrite the model before the upstream request.',
    localGatewayModelMappingsEmpty: 'No mappings configured.',
    localGatewayModelMappingFromPlaceholder: 'Client model (e.g. claude-3-5-sonnet)',
    localGatewayModelMappingToPlaceholder: 'Upstream model (e.g. gpt-5.5)',
    localGatewayModelMappingAdd: 'Add mapping',
    localGatewayModelMappingRemove: 'Remove',
    localGatewayModelMappingDuplicate:
      'A mapping with the same source already exists. Edit the existing entry instead.',
    localGatewayModelMappingsManage: 'Manage mappings',
    localGatewayModelMappingsMore: (count: number) =>
      `${count} more mapping${count === 1 ? '' : 's'} hidden. Open the dialog to view all.`,
    localGatewayAllowedGroupsTitle: 'Allowed groups or accounts',
    localGatewayAllowedGroupsHint:
      'Select at least one group or account before starting the local gateway. Only selected accounts or accounts in selected groups will be routed.',
    localGatewayAllowedGroupsEmpty:
      'No groups yet. Create one from group management on the accounts page first.',
    localGatewayAllowedGroupsRequired:
      'Select at least one group, account, or provider before starting the gateway.',
    localGatewayAllowedTargetsAdd: 'Add group or account',
    localGatewayAllowedProvidersTitle: 'Provider fallback',
    localGatewayAllowedProvidersHint:
      'Select providers to participate in routing. Codex accounts are tried first; selected providers are used as fallback.',
    localGatewayAddProvider: 'Add provider',
    localGatewayRoutingNoProviders: 'No providers configured. Add one on the Providers page first.',
    instanceManager: 'Instances',
    instanceManagerHint:
      'Each instance uses its own CODEX_HOME and copies the current .codex on first creation.',
    instanceCount: (count: number) => `${count} instance${count === 1 ? '' : 's'}`,
    defaultInstance: 'Default instance',
    instanceNamePlaceholder: 'Instance name',
    instanceDirPlaceholder: 'Instance directory (optional)',
    instanceArgsPlaceholder: 'Extra launch arguments (optional)',
    instanceBindAccount: 'Bound account',
    instanceUnbound: 'No bound account',
    createInstance: 'Create instance',
    saveInstance: 'Save instance',
    startInstance: 'Start instance',
    stopInstance: 'Stop instance',
    deleteInstance: 'Delete instance',
    deleteInstanceConfirm: (name: string) =>
      `Delete instance ${name}? Its instance directory will also be removed.`,
    instanceDirectory: 'Instance directory',
    instanceStatusRunning: 'Running',
    instanceStatusStopped: 'Stopped',
    instanceInitialized: 'Initialized',
    instanceNeedsInit: 'Initialized on first start',
    defaultInstanceRoot: 'Default instance directory',
    switchLanguage: 'Switch language',
    switchTheme: (current: string) => `Switch theme, current ${current}`,
    openGithub: 'Open GitHub',
    githubPending: 'GitHub link not configured',
    checkUpdates: 'Check for updates',
    checkingUpdates: 'Checking for updates',
    downloadUpdate: (version?: string) => `Download update${version ? ` v${version}` : ''}`,
    updatingViaHomebrew: 'Updating through Homebrew…',
    homebrewUpdateStatus: (status?: string, command?: string) => {
      switch (status) {
        case 'brew-update':
          return `Running: ${command ?? 'brew update'}`
        case 'waiting-for-app-quit':
          return 'Homebrew is ready to install, closing the app…'
        case 'brew-upgrade':
          return `Running: ${command ?? 'brew upgrade --cask codexdock'}`
        case 'reopening':
          return 'Reopening the app…'
        default:
          return command ? `Running: ${command}` : 'Updating through Homebrew…'
      }
    },
    updateViaHomebrew: (version?: string) => `Update with Homebrew${version ? ` v${version}` : ''}`,
    openReleasePage: (version?: string) => `Open download page${version ? ` v${version}` : ''}`,
    restartToInstallUpdate: 'Restart to install update',
    updateReady: 'Update downloaded and ready to install.',
    updateUpToDate: 'Already up to date.',
    updateAvailableVersion: (version?: string) =>
      version ? `Update v${version} is available.` : 'An update is available.',
    updateDownloadProgress: (progress?: number) => `Downloading ${progress ?? 0}%`,
    updatesUnsupported: 'Automatic updates are not available for this build.',
    updateFailed: 'Update check failed',
    lightTheme: 'Light theme',
    darkTheme: 'Dark theme',
    systemTheme: 'System theme',
    portOccupied: (command: string, pid: number) =>
      `Port 1455 is currently in use by ${command} (${pid})`,
    killPortOccupant: 'Kill occupying process',
    killPortOccupantFailed: 'Unable to terminate the process using port 1455',
    localGatewayPortOccupied: (port: number, command: string, pid: number) =>
      `Local service port ${port} is currently in use by ${command} (${pid})`,
    killLocalGatewayPortOccupant: 'Kill local service port process',
    killLocalGatewayPortOccupantFailed:
      'Unable to terminate the process using the local service port',
    emptyStateTitle: 'No accounts yet',
    emptyStateDescription: 'Import the current login or start a callback login.',
    importCurrentHint: 'Import current login',
    importCurrentDetail:
      'Best when this machine is already signed in through Codex and you want to pull it in immediately.',
    callbackLoginHint: 'Start callback login',
    callbackLoginDetail:
      'Best when you want to add another account and let the local callback finish automatically.',
    deviceLoginHint: 'Use device code',
    deviceLoginDetail:
      'Best when you want to approve the login on another browser or device and let CodexDock poll automatically.'
  }
} as const

export type LocalizedCopy = (typeof messages)['zh-CN']

export function accountLabel(
  account: Pick<AccountSummary, 'name' | 'email' | 'accountId'>,
  copy: LocalizedCopy
): string {
  return account.name ?? account.email ?? account.accountId ?? copy.unnamedAccount
}

export function accountEmail(
  account: Pick<AccountSummary, 'name' | 'email' | 'accountId'>,
  copy: LocalizedCopy
): string {
  return account.email ?? account.name ?? account.accountId ?? copy.unnamedAccount
}

export function providerLabel(
  provider: Pick<CustomProviderSummary, 'name' | 'baseUrl'>,
  copy: Pick<LocalizedCopy, 'providerEmptyName'>
): string {
  return provider.name?.trim() || provider.baseUrl || copy.providerEmptyName
}

export function planLabel(planType?: string | null): string {
  switch ((planType ?? '').toLowerCase()) {
    case 'free':
      return 'Free'
    case 'plus':
      return 'Plus'
    case 'pro':
      return 'Pro'
    case 'team':
      return 'Team'
    case 'enterprise':
      return 'Enterprise'
    default:
      return planType || '--'
  }
}

export function planTagClass(planType?: string | null): string {
  switch ((planType ?? '').toLowerCase()) {
    case 'free':
      return 'theme-plan-neutral bg-[var(--surface-soft)] text-[var(--ink-soft)]'
    case 'plus':
      return 'theme-plan-plus bg-emerald-500/12 text-emerald-700'
    case 'pro':
      return 'theme-plan-pro bg-sky-500/12 text-sky-700'
    case 'team':
      return 'theme-plan-team bg-amber-500/14 text-amber-700'
    case 'enterprise':
      return 'theme-plan-enterprise bg-rose-500/14 text-rose-700'
    default:
      return 'theme-plan-neutral bg-[var(--surface-soft)] text-[var(--ink-soft)]'
  }
}

function formatDurationCompact(ms: number, language: AppLanguage): string {
  const absoluteMs = Math.abs(ms)
  const dayMs = 24 * 60 * 60 * 1000
  const hourMs = 60 * 60 * 1000
  const minuteMs = 60 * 1000
  const days = Math.floor(absoluteMs / dayMs)
  const hours = Math.floor((absoluteMs % dayMs) / hourMs)
  const minutes = Math.floor((absoluteMs % hourMs) / minuteMs)

  if (language === 'en') {
    if (days > 0) {
      return `${days}d ${hours}h`
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m`
    }
    return `${minutes}m`
  }

  if (days > 0) {
    return `${days}天${hours}小时`
  }
  if (hours > 0) {
    return `${hours}小时${minutes}分钟`
  }
  return `${minutes}分钟`
}

export function formatSubscriptionDateTime(
  subscriptionExpiresAt: string | undefined,
  language: AppLanguage
): string | null {
  if (!subscriptionExpiresAt) {
    return null
  }

  const parsed = Date.parse(subscriptionExpiresAt)
  if (Number.isNaN(parsed)) {
    return subscriptionExpiresAt
  }

  return new Intl.DateTimeFormat(language, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(parsed))
}

export function accountSubscriptionBadge(
  subscriptionExpiresAt: string | undefined,
  language: AppLanguage,
  copy: Pick<
    LocalizedCopy,
    'subscriptionExpiresAt' | 'subscriptionRemaining' | 'subscriptionExpiredAgo'
  >,
  now = Date.now()
): { label: string; title: string; expired: boolean; critical: boolean } | null {
  if (!subscriptionExpiresAt) {
    return null
  }

  const parsed = Date.parse(subscriptionExpiresAt)
  if (Number.isNaN(parsed)) {
    return null
  }

  const remainingMs = parsed - now
  const duration = formatDurationCompact(remainingMs, language)
  const dateTime =
    formatSubscriptionDateTime(subscriptionExpiresAt, language) ?? subscriptionExpiresAt
  const expired = remainingMs < 0

  return {
    label: expired ? copy.subscriptionExpiredAgo(duration) : copy.subscriptionRemaining(duration),
    title: `${copy.subscriptionExpiresAt}: ${dateTime}`,
    expired,
    critical: remainingMs <= 3 * 24 * 60 * 60 * 1000
  }
}

export function accountTokenExpiryBadge(
  accessTokenExpiresAt: number | undefined,
  language: AppLanguage,
  copy: Pick<LocalizedCopy, 'tokenExpiresAtLabel' | 'tokenExpiringSoon' | 'tokenExpiredAgo'>,
  now = Date.now()
): { label: string; title: string; expired: boolean; critical: boolean } | null {
  if (!accessTokenExpiresAt) {
    return null
  }

  const remainingMs = accessTokenExpiresAt - now
  if (remainingMs > 3 * 24 * 60 * 60 * 1000) {
    return null
  }

  const duration = formatDurationCompact(remainingMs, language)
  const expired = remainingMs <= 0
  const dateTime = new Date(accessTokenExpiresAt).toLocaleString(
    language === 'zh-CN' ? 'zh-CN' : 'en-US'
  )

  return {
    label: expired ? copy.tokenExpiredAgo(duration) : copy.tokenExpiringSoon(duration),
    title: `${copy.tokenExpiresAtLabel}: ${dateTime}`,
    expired,
    critical: remainingMs <= 1 * 24 * 60 * 60 * 1000
  }
}

export function loginTone(phase: LoginEvent['phase']): string {
  if (phase === 'success') {
    return 'text-success'
  }

  if (phase === 'error' || phase === 'cancelled') {
    return 'text-danger'
  }

  return 'text-carbon'
}

export function accountCardTone(active: boolean): string {
  return active
    ? 'theme-account-card theme-account-card-active border-[var(--line-strong)] bg-[var(--surface-selected)]'
    : 'theme-account-card border-[var(--color-arctic-mist)] bg-[var(--panel-strong)]'
}

export function usageErrorKind(message?: string): 'expired' | 'workspace' | 'error' | null {
  if (!message) {
    return null
  }

  const normalized = message.toLowerCase()

  if (normalized.includes('deactivated_workspace')) {
    return 'workspace'
  }

  if (
    normalized.includes('invalid_grant') ||
    normalized.includes('refresh_token_expired') ||
    normalized.includes('refresh_token_reused') ||
    normalized.includes('refresh_token_invalidated') ||
    normalized.includes('already used') ||
    normalized.includes('revoked') ||
    normalized.includes('missing refresh token') ||
    normalized.includes('missing access token') ||
    normalized.includes('token refresh failed (401)') ||
    normalized.includes('token refresh failed (403)') ||
    normalized.includes('failed: 401') ||
    normalized.includes('failed: 403')
  ) {
    return 'expired'
  }

  return 'error'
}

function usageErrorDetail(
  message: string,
  account?: Pick<AccountSummary, 'id' | 'email' | 'name' | 'accountId'>
): string {
  const normalized = message.trim()
  if (!normalized || !account) {
    return normalized
  }

  const prefixes = [account.email, account.name, account.accountId, account.id].filter(
    (value): value is string => Boolean(value)
  )
  for (const prefix of prefixes) {
    if (normalized.startsWith(`${prefix}: `)) {
      return normalized.slice(prefix.length + 2).trim()
    }
  }

  return normalized
}

export function accountUsageBadge(
  message: string | undefined,
  account: Pick<AccountSummary, 'id' | 'email' | 'name' | 'accountId'>,
  copy: Pick<LocalizedCopy, 'accountExpired' | 'accountExpiredHint' | 'accountUsageRefreshFailed'>
): { kind: 'expired' | 'workspace' | 'error'; title: string; detail: string } | null {
  const kind = usageErrorKind(message)

  if (!message || !kind) {
    return null
  }

  const detail = usageErrorDetail(message, account)

  if (kind === 'expired') {
    return {
      kind,
      detail,
      title: `${copy.accountExpiredHint}\n${detail}`
    }
  }

  return {
    kind,
    detail,
    title: detail
  }
}

export function progressWidth(value?: number | null): string {
  return `${remainingPercent(value)}%`
}

export interface QuotaAggregate {
  averageRemaining: number
  accountCount: number
}

export interface QuotaAggregateSummary {
  primary: QuotaAggregate
  secondary: QuotaAggregate
  totalAccounts: number
}

export function aggregateAccountQuotas(
  accounts: Array<Pick<AccountSummary, 'id'>>,
  usageByAccountId: Record<string, AccountRateLimits>
): QuotaAggregateSummary {
  let primarySum = 0
  let primaryCount = 0
  let secondarySum = 0
  let secondaryCount = 0
  let totalAccounts = 0

  for (const account of accounts) {
    const rateLimits = usageByAccountId[account.id]
    if (!rateLimits) {
      continue
    }

    if (!rateLimits.primary && !rateLimits.secondary) {
      continue
    }

    totalAccounts += 1

    if (rateLimits.primary) {
      primarySum += remainingPercent(rateLimits.primary.usedPercent)
      primaryCount += 1
    }

    if (rateLimits.secondary) {
      secondarySum += remainingPercent(rateLimits.secondary.usedPercent)
      secondaryCount += 1
    }
  }

  return {
    primary: {
      averageRemaining: primaryCount ? Math.round(primarySum / primaryCount) : 0,
      accountCount: primaryCount
    },
    secondary: {
      averageRemaining: secondaryCount ? Math.round(secondarySum / secondaryCount) : 0,
      accountCount: secondaryCount
    },
    totalAccounts
  }
}

function normalizeResetTimestamp(value?: number | null): number | null {
  if (!value) {
    return null
  }

  return value < 1_000_000_000_000 ? value * 1000 : value
}

export function weeklyResetTimeToneClass(value?: number | null, now = Date.now()): string {
  const normalized = normalizeResetTimestamp(value)
  if (!normalized) {
    return 'text-muted-strong'
  }

  const diffMs = normalized - now
  if (diffMs <= 0) {
    return 'text-emerald-700'
  }

  const remainingDays = Math.ceil(diffMs / (24 * 60 * 60_000))

  if (remainingDays <= 1) {
    return 'text-emerald-700'
  }

  if (remainingDays <= 3) {
    return 'text-sky-700'
  }

  if (remainingDays <= 5) {
    return 'text-amber-700'
  }

  return 'text-red-700'
}

export function limitLabel(limit: AccountRateLimitEntry): string {
  const raw = (limit.limitName ?? limit.limitId ?? '').toLowerCase()

  if (raw.includes('review')) {
    return 'review'
  }

  if (raw.includes('codex')) {
    return 'codex'
  }

  return limit.limitName ?? limit.limitId ?? 'extra'
}

export function themeIconClass(theme: AppTheme): string {
  switch (theme) {
    case 'dark':
      return 'i-lucide-moon-star'
    case 'system':
      return 'i-lucide-monitor'
    default:
      return 'i-lucide-sun-medium'
  }
}

export function themeTitle(theme: AppTheme, copy: LocalizedCopy): string {
  switch (theme) {
    case 'dark':
      return copy.darkTheme
    case 'system':
      return copy.systemTheme
    default:
      return copy.lightTheme
  }
}

export function nextTheme(theme: AppTheme): AppTheme {
  switch (theme) {
    case 'light':
      return 'dark'
    case 'dark':
      return 'system'
    default:
      return 'light'
  }
}

export function extraLimits(
  usageByAccountId: Record<string, AccountRateLimits>,
  accountId: string
): AccountRateLimitEntry[] {
  const rateLimits = usageByAccountId[accountId]
  if (!rateLimits) {
    return []
  }

  return rateLimits.limits.filter((limit) => {
    if (limit.limitId === rateLimits.limitId) {
      return false
    }

    const raw = (limit.limitName ?? limit.limitId ?? '').toLowerCase()
    if (raw.includes('review')) {
      return false
    }

    return true
  })
}
