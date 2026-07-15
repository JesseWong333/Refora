import { ChatOpenAI, type ChatOpenAIFields } from '@langchain/openai'
import type { AiProvider, AiReasoningEffort } from '../../shared/ipc-types'
import { inferModelCapabilities } from '../../shared/providerCatalog'

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

export function createProviderChatModel(input: {
  provider: AiProvider
  apiKey: string
  modelId?: string
  streaming: boolean
  deepThinking?: boolean
  temperature?: number | null
  maxTokens?: number | null
}): ChatOpenAI {
  const modelId = input.modelId?.trim() || input.provider.model
  const capabilities = inferModelCapabilities(input.provider.presetId, modelId)
  const reasoningOptions = buildProviderReasoningOptions(
    input.provider,
    capabilities.supportsReasoning ? input.deepThinking : undefined
  )
  const temperature = input.temperature ?? input.provider.temperature
  const maxTokens = input.maxTokens ?? input.provider.maxTokens

  const fields: ChatOpenAIFields = {
    model: modelId,
    configuration: { baseURL: input.provider.baseUrl },
    apiKey: input.apiKey || 'local-provider',
    streaming: input.streaming,
    useResponsesApi: reasoningOptions.useResponsesApi,
    ...(reasoningOptions.reasoning
      ? { reasoning: reasoningOptions.reasoning as ChatOpenAIFields['reasoning'] }
      : {}),
    ...(temperature != null && !capabilities.supportsReasoning ? { temperature } : {}),
    ...(maxTokens != null ? { maxTokens } : {}),
    ...(Object.keys(reasoningOptions.modelKwargs).length > 0
      ? { modelKwargs: reasoningOptions.modelKwargs }
      : {})
  }
  return new ChatOpenAI(fields)
}
