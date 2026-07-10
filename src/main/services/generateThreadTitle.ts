import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage } from '@langchain/core/messages'
import type { AiProvider } from '../../shared/ipc-types'
import { logger } from './logger'

export async function generateThreadTitle(
  modelId: string,
  provider: AiProvider,
  apiKey: string,
  userMessage: string
): Promise<string | null> {
  try {
    const llm = new ChatOpenAI({
      model: modelId,
      configuration: { baseURL: provider.baseUrl },
      apiKey,
      streaming: false,
      maxTokens: 30,
      temperature: 0.3
    })
    const prompt =
      'Generate a concise title (3-8 words, no quotes, no punctuation at the end) ' +
      'for a research conversation that starts with this user message. ' +
      'Reply with ONLY the title, nothing else.\n\n' +
      `User message: ${userMessage.slice(0, 500)}`
    const result = await llm.invoke([new HumanMessage(prompt)])
    const title = typeof result.content === 'string' ? result.content.trim() : ''
    const cleaned = title.replace(/^['"]+|['"]+$/g, '').replace(/\.$/, '').trim()
    if (!cleaned || cleaned.length > 100) return null
    return cleaned
  } catch (e) {
    logger.warn(`generateThreadTitle: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}
