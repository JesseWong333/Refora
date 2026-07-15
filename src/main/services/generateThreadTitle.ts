import { HumanMessage } from '@langchain/core/messages'
import type { AiProvider } from '../../shared/ipc-types'
import { resolveDeepThinkingMode } from '../../shared/deepThinking'
import { logger } from './logger'
import { createProviderChatModel } from './providerModel'

export async function generateThreadTitle(
  modelId: string,
  provider: AiProvider,
  apiKey: string,
  userMessage: string
): Promise<string | null> {
  try {
    const isReasoningModel = resolveDeepThinkingMode(modelId) === 'native'
    const llm = createProviderChatModel({
      provider,
      apiKey,
      modelId,
      streaming: false,
      deepThinking: false,
      maxTokens: isReasoningModel ? 512 : 30,
      temperature: 0.3
    })
    const prompt =
      'Generate a concise title (3-8 words, no quotes, no punctuation at the end) ' +
      'for a research conversation that starts with this user message. ' +
      'Reply with ONLY the title, nothing else.\n\n' +
      `User message: ${userMessage.slice(0, 500)}`
    const result = await llm.invoke([new HumanMessage(prompt)])
    const content = result.content
    let title: string
    if (typeof content === 'string') {
      title = content
    } else if (isReasoningModel) {
      let text = ''
      for (const part of content) {
        const p = part as Record<string, unknown>
        if (p.type === 'text' && typeof p.text === 'string') {
          text = p.text
          break
        }
      }
      if (!text) {
        const reasoningContent = result.additional_kwargs?.reasoning_content
        if (typeof reasoningContent === 'string') {
          const lines = reasoningContent
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
          text = lines[lines.length - 1] ?? ''
        }
      }
      title = text
    } else {
      title = ''
    }
    const cleaned = title
      .trim()
      .replace(/^['"]+|['"]+$/g, '')
      .replace(/\.$/, '')
      .trim()
    if (!cleaned || cleaned.length > 100) return null
    return cleaned
  } catch (e) {
    logger.warn(`generateThreadTitle: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}
