import { describe, expect, it, vi } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { Command, MemorySaver } from '@langchain/langgraph'
import { FakeToolCallingModel } from 'langchain'
import { StateBackend } from 'deepagents'
import { z } from 'zod'
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

  it('rejects one OCR call without executing it', async () => {
    const executeOcr = vi.fn(async () => 'OCR complete')
    const prepareOcr = new DynamicStructuredTool({
      name: 'prepare_paper_ocr',
      description: 'Prepare OCR',
      schema: z.object({ docId: z.string() }),
      func: executeOcr
    })
    const model = new FakeToolCallingModel({
      toolCalls: [
        [{
          name: 'prepare_paper_ocr',
          args: { docId: 'doc-1' },
          id: 'ocr-call-1'
        }],
        [],
        [{
          name: 'prepare_paper_ocr',
          args: { docId: 'doc-1' },
          id: 'ocr-call-2'
        }]
      ]
    })
    const agent = createReforaDeepAgent({
      model,
      systemPrompt: 'You are Refora.',
      tools: [prepareOcr],
      readOnlyTools: [],
      backend: new StateBackend(),
      memoryBackend: new StateBackend(),
      checkpointer: new MemorySaver()
    })
    const config = { configurable: { thread_id: 'ocr-rejection-thread' } }

    await agent.invoke(
      { messages: [new HumanMessage('Use OCR if approved.')] },
      config
    )
    const interrupted = await agent.getState(config)
    expect(interrupted.tasks[0]?.interrupts[0]?.value).toMatchObject({
      actionRequests: [{
        name: 'prepare_paper_ocr',
        args: { docId: 'doc-1' }
      }]
    })

    await agent.invoke(
      new Command({
        resume: {
          decisions: [{
            type: 'reject',
            message: 'The user rejected this OCR action.'
          }]
        }
      }),
      config
    )
    expect(executeOcr).not.toHaveBeenCalled()

    await agent.invoke(
      { messages: [new HumanMessage('Request OCR again if it is still needed.')] },
      config
    )
    const interruptedAgain = await agent.getState(config)
    expect(interruptedAgain.tasks[0]?.interrupts[0]?.value).toMatchObject({
      actionRequests: [{
        name: 'prepare_paper_ocr',
        args: { docId: 'doc-1' }
      }]
    })
    expect(executeOcr).not.toHaveBeenCalled()
  })
})
