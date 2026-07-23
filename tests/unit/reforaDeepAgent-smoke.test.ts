import { describe, expect, it } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { MemorySaver } from '@langchain/langgraph'
import { StateBackend } from 'deepagents'
import { createReforaDeepAgent } from '../../src/main/services/reforaDeepAgent'

describe('Refora Deep Agent package integration', () => {
  it('constructs and invokes the real Deep Agents graph', async () => {
    const agent = createReforaDeepAgent({
      model: new FakeListChatModel({ responses: ['Deep Agent ready'] }),
      systemPrompt: 'You are Refora.',
      tools: [],
      readOnlyTools: [],
      backend: new StateBackend(),
      memoryBackend: new StateBackend(),
      checkpointer: new MemorySaver()
    })

    const result = await agent.invoke(
      { messages: [new HumanMessage('Respond once.')] },
      { configurable: { thread_id: 'smoke-thread' } }
    )
    const messages = result.messages as Array<{ content: unknown }>
    expect(messages.at(-1)?.content).toBe('Deep Agent ready')
  })
})
