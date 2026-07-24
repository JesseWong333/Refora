import { describe, expect, it, vi } from 'vitest'
import { createReforaDeepAgent } from '../../src/main/services/reforaDeepAgent'

describe('Refora Python Deep Agent adapter', () => {
  it('passes host capabilities, memory, provider, and checkpoint configuration to Python', async () => {
    const requests: unknown[] = []
    const executeHostOperation = vi.fn(async () => '[]')
    const runtime = {
      stream: vi.fn(async function *(
        request: unknown,
        options: {
          executeTool: typeof executeHostOperation
          onComplete: (value: unknown) => void
        }
      ) {
        requests.push(request)
        expect(options.executeTool).toBe(executeHostOperation)
        yield {
          event: 'on_chat_model_stream',
          data: { chunk: { content: 'ready' } }
        }
        options.onComplete({
          result: { messages: [{ content: 'ready' }] },
          state: {
            config: { configurable: { checkpoint_id: 'checkpoint-2' } },
            values: { messages: [{ content: 'ready' }] },
            tasks: []
          }
        })
      })
    }
    const agent = createReforaDeepAgent({
      runtime: runtime as never,
      runId: 'run-1',
      threadId: 'thread-1',
      workspaceId: 'workspace-1',
      provider: {
        model: 'gpt-test',
        baseUrl: 'https://example.test/v1',
        apiKey: 'secret',
        useResponsesApi: true,
        modelKwargs: {},
        temperature: null,
        maxTokens: 1000
      },
      systemPrompt: 'Refora prompt',
      enabledToolNames: ['search_library'],
      executeHostOperation,
      sandboxRoot: '/tmp/refora-agent',
      memories: { '/brief.md': 'Project brief' },
      checkpointPath: '/tmp/checkpoints.sqlite',
      includeResearchMemory: true
    })

    const events = []
    for await (const event of agent.streamEvents(
      { messages: [{ role: 'user', content: 'hello' }] },
      {
        signal: new AbortController().signal,
        recursionLimit: 42,
        configurable: {
          thread_id: 'thread-1',
          checkpoint_id: 'checkpoint-1'
        }
      }
    )) {
      events.push(event)
    }

    expect(events).toEqual([{
      event: 'on_chat_model_stream',
      data: { chunk: { content: 'ready' } }
    }])
    expect(requests[0]).toMatchObject({
      mode: 'run',
      runId: 'run-1',
      threadId: 'thread-1',
      workspaceId: 'workspace-1',
      checkpointPath: '/tmp/checkpoints.sqlite',
      checkpointBefore: 'checkpoint-1',
      messages: [{ role: 'user', content: 'hello' }],
      enabledToolNames: ['search_library'],
      sandboxRoot: '/tmp/refora-agent',
      memories: { '/brief.md': 'Project brief' },
      includeResearchMemory: true,
      recursionLimit: 42
    })
    expect(requests[0]).toMatchObject({
      systemPrompt: expect.stringContaining('propose_workspace_memory_update')
    })
    expect(await agent.getState()).toMatchObject({
      config: { configurable: { checkpoint_id: 'checkpoint-2' } }
    })
    expect(agent.getResult()).toMatchObject({
      messages: [{ content: 'ready' }]
    })
  })
})
