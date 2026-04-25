import { describe, expect, it } from 'vitest'

import { buildProviderUpdateInput, createProviderDraft } from '../accounts-panel-provider'

describe('accounts panel provider helpers', () => {
  it('creates a draft from provider summary defaults', () => {
    expect(
      createProviderDraft({
        name: 'Mirror',
        baseUrl: 'https://mirror.example.com',
        model: 'gpt-5.4',
        fastMode: true
      })
    ).toEqual({
      name: 'Mirror',
      baseUrl: 'https://mirror.example.com',
      apiKey: '',
      protocol: 'openai',
      model: 'gpt-5.4',
      fastMode: true
    })
  })

  it('only emits trimmed provider fields that actually changed', () => {
    expect(
      buildProviderUpdateInput(
        {
          name: 'Mirror',
          baseUrl: 'https://mirror.example.com',
          protocol: 'openai',
          model: 'gpt-5.4',
          fastMode: false
        },
        {
          name: ' Mirror 2 ',
          baseUrl: ' https://mirror-2.example.com ',
          apiKey: ' sk-test ',
          protocol: 'openai',
          model: ' ',
          fastMode: true
        }
      )
    ).toEqual({
      name: 'Mirror 2',
      baseUrl: 'https://mirror-2.example.com',
      apiKey: 'sk-test',
      model: '5.4',
      fastMode: true
    })
  })

  it('returns an empty patch when nothing changed and no api key is supplied', () => {
    expect(
      buildProviderUpdateInput(
        {
          name: 'Mirror',
          baseUrl: 'https://mirror.example.com',
          protocol: 'openai',
          model: 'gpt-5.4',
          fastMode: true
        },
        {
          name: 'Mirror',
          baseUrl: 'https://mirror.example.com',
          apiKey: '   ',
          protocol: 'openai',
          model: 'gpt-5.4',
          fastMode: true
        }
      )
    ).toEqual({})
  })
})
