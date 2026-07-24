import type { AiProvider } from '../../shared/ipc-types'
import { resolveDeepThinkingMode } from '../../shared/deepThinking'
import { logger } from './logger'
import { createAgentPythonProviderConfig } from './agentProviderConfig'
import type { AgentPythonRuntime } from './agentPythonRuntime'

export async function generateThreadTitle(
  runtime: AgentPythonRuntime,
  modelId: string,
  provider: AiProvider,
  apiKey: string,
  userMessage: string
): Promise<string | null> {
  try {
    const isReasoningModel = resolveDeepThinkingMode(modelId) === 'native'
    const providerConfig = createAgentPythonProviderConfig({
      provider,
      apiKey,
      modelId,
      deepThinking: false,
      maxTokens: isReasoningModel ? 512 : 30,
      temperature: 0.3
    })
    return await runtime.generateTitle(
      {
        provider: providerConfig,
        userMessage,
        reasoningModel: isReasoningModel
      },
      new AbortController().signal
    )
  } catch (e) {
    logger.warn(`generateThreadTitle: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}
