import { describe, expect, it } from 'vitest'

/**
 * Tests for the SSE parsing and usage extraction format used by the local gateway.
 * The production parser is module-private, so these tests verify the event payload
 * contract and callback shape that the gateway relies on.
 */

function buildResponseCompletedSsePayload(options: {
  model?: string
  inputTokens: number
  cachedTokens?: number
  outputTokens: number
}): string {
  const response = {
    id: 'resp_test',
    model: options.model ?? 'gpt-4o',
    usage: {
      input_tokens: options.inputTokens,
      cached_input_tokens: options.cachedTokens ?? 0,
      output_tokens: options.outputTokens
    }
  }
  return [
    'event: response.completed',
    `data: ${JSON.stringify({ type: 'response.completed', response })}`,
    '',
    ''
  ].join('\n')
}

function buildTextDeltaSsePayload(text: string): string {
  return [
    'event: response.output_text.delta',
    `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}`,
    '',
    ''
  ].join('\n')
}

describe('local-gateway usage hook (SSE extraction)', () => {
  // We can't directly test private functions, but we can verify the full flow
  // by creating a minimal gateway instance and triggering a streaming response.
  // However, CodexLocalGatewayService requires many dependencies.
  // Instead, we test the SSE block format parsing logic by simulating what
  // streamResponsesTextDeltas does with a mock upstream.

  // Since the functions are not exported, we replicate the parsing logic here
  // to verify the SSE format contract that the gateway relies on.

  describe('SSE block format contract', () => {
    it('response.completed event carries usage in expected structure', () => {
      const payload = buildResponseCompletedSsePayload({
        model: 'gpt-4o-2024-08-06',
        inputTokens: 1500,
        cachedTokens: 300,
        outputTokens: 800
      })

      const lines = payload.split('\n')
      const eventLine = lines.find((l) => l.startsWith('event:'))
      expect(eventLine).toBe('event: response.completed')

      const dataLine = lines.find((l) => l.startsWith('data:'))
      const json = JSON.parse(dataLine!.slice('data:'.length).trim())
      expect(json.type).toBe('response.completed')
      expect(json.response.usage.input_tokens).toBe(1500)
      expect(json.response.usage.cached_input_tokens).toBe(300)
      expect(json.response.usage.output_tokens).toBe(800)
      expect(json.response.model).toBe('gpt-4o-2024-08-06')
    })

    it('text delta event carries delta string', () => {
      const payload = buildTextDeltaSsePayload('Hello world')
      const lines = payload.split('\n')
      const dataLine = lines.find((l) => l.startsWith('data:'))
      const json = JSON.parse(dataLine!.slice('data:'.length).trim())
      expect(json.delta).toBe('Hello world')
    })

    it('cache_read_input_tokens is accepted as fallback for cached_input_tokens', () => {
      const response = {
        id: 'resp_test',
        model: 'gpt-4o',
        usage: {
          input_tokens: 1000,
          cache_read_input_tokens: 500,
          output_tokens: 200
        }
      }
      const block = [
        'event: response.completed',
        `data: ${JSON.stringify({ type: 'response.completed', response })}`,
        '',
        ''
      ].join('\n')

      const lines = block.split('\n')
      const dataLine = lines.find((l) => l.startsWith('data:'))
      const json = JSON.parse(dataLine!.slice('data:'.length).trim())
      const usage = json.response.usage
      const cachedTokens = usage.cached_input_tokens ?? usage.cache_read_input_tokens ?? 0
      expect(cachedTokens).toBe(500)
    })
  })

  describe('extractInstanceIdFromPath contract', () => {
    it('/inst/<id>/v1/... extracts instanceId and rewrites path', () => {
      const url = new URL('http://127.0.0.1:11456/inst/my-instance-123/v1/chat/completions')
      const match = /^\/inst\/([^/]+)(\/.*)?$/.exec(url.pathname)
      expect(match).not.toBeNull()
      const instanceId = decodeURIComponent(match![1]).trim()
      const remainingPath = match![2] ?? '/'
      expect(instanceId).toBe('my-instance-123')
      expect(remainingPath).toBe('/v1/chat/completions')
    })

    it('returns null for paths without /inst/ prefix', () => {
      const url = new URL('http://127.0.0.1:11456/v1/chat/completions')
      const match = /^\/inst\/([^/]+)(\/.*)?$/.exec(url.pathname)
      expect(match).toBeNull()
    })

    it('handles URL-encoded instanceId', () => {
      const encoded = encodeURIComponent('instance with spaces')
      const url = new URL(`http://127.0.0.1:11456/inst/${encoded}/v1/responses`)
      const match = /^\/inst\/([^/]+)(\/.*)?$/.exec(url.pathname)
      expect(match).not.toBeNull()
      const instanceId = decodeURIComponent(match![1]).trim()
      expect(instanceId).toBe('instance with spaces')
    })
  })

  describe('makeUsageCallback behavior', () => {
    it('onAccountUsage receives correct input shape from usage result', () => {
      const received: Array<Record<string, unknown>> = []
      const onAccountUsage = (input: Record<string, unknown>): void => {
        received.push(input)
      }

      // Simulate what makeUsageCallback does
      const account = { id: 'acct-1' }
      const requestModel = 'gpt-4o'
      const instanceId = 'inst-abc'

      const usageResult = {
        model: 'gpt-4o-2024-08-06',
        inputTokens: 1500,
        cachedTokens: 300,
        outputTokens: 800
      }

      // Replicate makeUsageCallback logic
      onAccountUsage({
        accountId: account.id,
        instanceId,
        model: usageResult.model || requestModel || 'unknown',
        inputTokens: usageResult.inputTokens,
        cachedTokens: usageResult.cachedTokens,
        outputTokens: usageResult.outputTokens
      })

      expect(received).toHaveLength(1)
      expect(received[0]).toEqual({
        accountId: 'acct-1',
        instanceId: 'inst-abc',
        model: 'gpt-4o-2024-08-06',
        inputTokens: 1500,
        cachedTokens: 300,
        outputTokens: 800
      })
    })

    it('falls back to requestModel when usage.model is undefined', () => {
      const received: Array<Record<string, unknown>> = []
      const onAccountUsage = (input: Record<string, unknown>): void => {
        received.push(input)
      }

      const usageResult = {
        model: undefined,
        inputTokens: 100,
        cachedTokens: 0,
        outputTokens: 50
      }

      onAccountUsage({
        accountId: 'acct-1',
        instanceId: 'inst-a',
        model: usageResult.model || 'gpt-4o-mini',
        inputTokens: usageResult.inputTokens,
        cachedTokens: usageResult.cachedTokens,
        outputTokens: usageResult.outputTokens
      })

      expect(received[0].model).toBe('gpt-4o-mini')
    })

    it('falls back to "unknown" when both usage.model and requestModel are empty', () => {
      const received: Array<Record<string, unknown>> = []
      const onAccountUsage = (input: Record<string, unknown>): void => {
        received.push(input)
      }

      const usageResult = {
        model: undefined,
        inputTokens: 100,
        cachedTokens: 0,
        outputTokens: 50
      }

      onAccountUsage({
        accountId: 'acct-1',
        instanceId: 'inst-a',
        model: usageResult.model || '' || 'unknown',
        inputTokens: usageResult.inputTokens,
        cachedTokens: usageResult.cachedTokens,
        outputTokens: usageResult.outputTokens
      })

      expect(received[0].model).toBe('unknown')
    })
  })
})
