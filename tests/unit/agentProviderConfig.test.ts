import { describe, expect, it } from 'vitest'
import {
  buildProviderReasoningOptions,
  createAgentPythonProviderConfig
} from '../../src/main/services/agentProviderConfig'
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

describe('Python provider request configuration', () => {
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

  it('builds a serializable Python model config without LangChain TS objects', () => {
    expect(
      createAgentPythonProviderConfig({
        provider: openAiProvider,
        apiKey: 'test-key',
        deepThinking: true,
        reasoningEffort: 'low',
        maxTokens: 123
      })
    ).toEqual({
      model: 'gpt-5.6-terra',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      useResponsesApi: true,
      modelKwargs: {},
      reasoning: { effort: 'low', summary: 'auto' },
      temperature: null,
      maxTokens: 123
    })
  })

  it('does not send reasoning parameters to a non-reasoning model', () => {
    const config = createAgentPythonProviderConfig({
      provider: { ...openAiProvider, model: 'gpt-4o-mini' },
      apiKey: 'test-key',
      deepThinking: true
    })

    expect(config.useResponsesApi).toBe(true)
    expect(config.modelKwargs).toEqual({})
    expect(config.reasoning).toBeUndefined()
  })
})
