import type {
  CustomProviderDetail,
  CustomProviderSummary,
  UpdateCustomProviderInput
} from '../../../shared/codex'

type ProviderDraftSource = Pick<CustomProviderSummary, 'name' | 'baseUrl' | 'model' | 'fastMode'> &
  Partial<Pick<CustomProviderDetail, 'apiKey'>>

export interface ProviderDraft {
  name: string
  baseUrl: string
  apiKey: string
  model: string
  fastMode: boolean
}

export function createProviderDraft(provider: ProviderDraftSource): ProviderDraft {
  return {
    name: provider.name ?? '',
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey ?? '',
    model: provider.model,
    fastMode: provider.fastMode
  }
}

export function buildProviderUpdateInput(
  provider: Pick<CustomProviderSummary, 'name' | 'baseUrl' | 'model' | 'fastMode'>,
  draft: ProviderDraft
): UpdateCustomProviderInput {
  const input: UpdateCustomProviderInput = {}
  const nextName = draft.name.trim()
  const nextBaseUrl = draft.baseUrl.trim()
  const nextApiKey = draft.apiKey.trim()
  const nextModel = draft.model.trim() || '5.4'

  if (nextName !== (provider.name ?? '')) {
    input.name = nextName
  }

  if (nextBaseUrl !== provider.baseUrl) {
    input.baseUrl = nextBaseUrl
  }

  if (nextApiKey) {
    input.apiKey = nextApiKey
  }

  if (nextModel !== provider.model) {
    input.model = nextModel
  }

  if (draft.fastMode !== provider.fastMode) {
    input.fastMode = draft.fastMode
  }

  return input
}
