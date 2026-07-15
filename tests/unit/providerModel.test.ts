import { describe, expect, it } from 'vitest'
import {
  buildProviderReasoningOptions,
  createProviderChatModel
} from '../../src/main/services/providerModel'
import type { AiProvider } from '../../src/shared/ipc-types'

const openAiProvider: AiProvider = {
  id: 'provider-openai',
  presetId: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiProtocol: 'openai-responses',
  reasoningControl: 'openai',
  reasoningEffort: 'high',
  model: 'gpt-5.6-terra',
  baseModel: 'gpt-5.6-terra',
  variant: '',
  variantFormat: 'none',
  hasKey: true,
  temperature: null,
  maxTokens: null,
  createdAt: 1
}

describe('provider reasoning request options', () => {
  it('uses Responses reasoning for OpenAI', () => {
    expect(
      buildProviderReasoningOptions(
        {
          presetId: 'openai',
          apiProtocol: 'openai-responses',
          reasoningControl: 'openai',
          reasoningEffort: 'high'
        },
        true
      )
    ).toEqual({
      useResponsesApi: true,
      modelKwargs: {},
      reasoning: { effort: 'high', summary: 'auto' }
    })
  })

  it('uses thinking.type for Kimi, DeepSeek, and GLM compatible APIs', () => {
    expect(
      buildProviderReasoningOptions(
        {
          presetId: 'deepseek',
          apiProtocol: 'openai-compatible',
          reasoningControl: 'thinking',
          reasoningEffort: 'max'
        },
        true
      ).modelKwargs
    ).toEqual({ thinking: { type: 'enabled' }, reasoning_effort: 'max' })

    expect(
      buildProviderReasoningOptions(
        {
          presetId: 'kimi',
          apiProtocol: 'openai-compatible',
          reasoningControl: 'thinking',
          reasoningEffort: 'high'
        },
        true
      ).modelKwargs
    ).toEqual({ thinking: { type: 'enabled' } })

    expect(
      buildProviderReasoningOptions(
        {
          presetId: 'deepseek',
          apiProtocol: 'openai-compatible',
          reasoningControl: 'thinking',
          reasoningEffort: 'high'
        },
        false
      ).modelKwargs
    ).toEqual({ thinking: { type: 'disabled' } })
  })

  it('uses enable_thinking for Qwen compatible APIs', () => {
    expect(
      buildProviderReasoningOptions(
        {
          presetId: 'qwen',
          apiProtocol: 'openai-compatible',
          reasoningControl: 'enable-thinking',
          reasoningEffort: 'high'
        },
        true
      ).modelKwargs
    ).toEqual({ enable_thinking: true })
  })

  it('does not send reasoning parameters to a non-reasoning model', () => {
    const model = createProviderChatModel({
      provider: { ...openAiProvider, model: 'gpt-4o-mini' },
      apiKey: 'test-key',
      streaming: false,
      deepThinking: true
    })

    expect(model.useResponsesApi).toBe(true)
    expect(model.modelKwargs).toEqual({})
    expect(model.reasoning).toBeUndefined()
  })
})
