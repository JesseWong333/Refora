import type { AiProvider, AiReasoningEffort } from '../../shared/ipc-types'
import { inferModelCapabilities } from '../../shared/providerCatalog'
import type { AgentPythonProviderConfig } from './agentPythonRuntime'

export interface ProviderReasoningOptions {
  useResponsesApi: boolean
  modelKwargs: Record<string, unknown>
  reasoning?: {
    effort: AiReasoningEffort
    summary: 'auto'
  }
}

export function buildProviderReasoningOptions(
  provider: Pick<
    AiProvider,
    'presetId' | 'apiProtocol' | 'reasoningControl' | 'reasoningEffort'
  >,
  deepThinking?: boolean
): ProviderReasoningOptions {
  const modelKwargs: Record<string, unknown> = {}
  let reasoning: ProviderReasoningOptions['reasoning']

  if (deepThinking === true && provider.reasoningEffort !== 'none') {
    if (provider.reasoningControl === 'openai') {
      if (provider.apiProtocol === 'openai-responses') {
        reasoning = { effort: provider.reasoningEffort, summary: 'auto' }
      } else {
        modelKwargs.reasoning_effort = provider.reasoningEffort
      }
    }
    if (provider.reasoningControl === 'thinking') {
      modelKwargs.thinking = { type: 'enabled' }
      if (provider.presetId !== 'kimi') {
        modelKwargs.reasoning_effort = provider.reasoningEffort
      }
    }
    if (provider.reasoningControl === 'enable-thinking') {
      modelKwargs.enable_thinking = true
    }
  }

  if (deepThinking === false) {
    if (provider.reasoningControl === 'thinking') {
      modelKwargs.thinking = { type: 'disabled' }
    }
    if (provider.reasoningControl === 'enable-thinking') {
      modelKwargs.enable_thinking = false
    }
  }

  return {
    useResponsesApi: provider.apiProtocol === 'openai-responses',
    modelKwargs,
    ...(reasoning ? { reasoning } : {})
  }
}

export function createAgentPythonProviderConfig(input: {
  provider: AiProvider
  apiKey: string
  modelId?: string
  deepThinking?: boolean
  reasoningEffort?: AiReasoningEffort
  temperature?: number | null
  maxTokens?: number | null
}): AgentPythonProviderConfig {
  const model = input.modelId?.trim() || input.provider.model
  const capabilities = inferModelCapabilities(input.provider.presetId, model)
  const reasoningProvider = input.reasoningEffort
    ? { ...input.provider, reasoningEffort: input.reasoningEffort }
    : input.provider
  const reasoningOptions = buildProviderReasoningOptions(
    reasoningProvider,
    capabilities.supportsReasoning ? input.deepThinking : undefined
  )
  const temperature = input.temperature ?? input.provider.temperature
  const maxTokens = input.maxTokens ?? input.provider.maxTokens

  return {
    model,
    baseUrl: input.provider.baseUrl,
    apiKey: input.apiKey,
    useResponsesApi: reasoningOptions.useResponsesApi,
    modelKwargs: reasoningOptions.modelKwargs,
    ...(reasoningOptions.reasoning ? { reasoning: reasoningOptions.reasoning } : {}),
    temperature: temperature != null && !capabilities.supportsReasoning ? temperature : null,
    maxTokens
  }
}
