import { describe, expect, it, vi } from 'vitest'
import { createAgentStringHostTool } from '../../src/main/services/agentHostTool'
import { createReforaDeepAgent } from '../../src/main/services/reforaDeepAgent'

describe('Refora Python Deep Agent adapter', () => {
  it('passes Agent configuration, Python tool schemas, memory, and checkpoints to the sidecar', async () => {
    const requests: unknown[] = []
    const runtime = {
      stream: vi.fn(async function *(
        request: unknown,
        options: { onComplete: (value: unknown) => void }
      ) {
        requests.push(request)
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
    const search = createAgentStringHostTool({
      name: 'search_library',
      argumentName: 'query',
      description: 'Search local papers',
      func: async (query) => JSON.stringify({ query })
    })
    const effectRepo = {
      get: vi.fn(() => null),
      begin: vi.fn(),
      finish: vi.fn()
    }
    const agent = createReforaDeepAgent({
      runtime: runtime as never,
      repos: { agentToolEffects: effectRepo } as never,
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
      tools: [search],
      readOnlyTools: [search],
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
      threadId: 'thread-1',
      workspaceId: 'workspace-1',
      checkpointPath: '/tmp/checkpoints.sqlite',
      checkpointBefore: 'checkpoint-1',
      messages: [{ role: 'user', content: 'hello' }],
      readOnlyToolNames: ['search_library'],
      academicToolNames: expect.arrayContaining(['search_arxiv']),
      sandboxRoot: '/tmp/refora-agent',
      memories: { '/brief.md': 'Project brief' },
      includeResearchMemory: true,
      recursionLimit: 42,
      tools: [{
        name: 'search_library',
        description: 'Search local papers',
        schema: expect.objectContaining({
          type: 'object',
          required: ['query']
        })
      }]
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

  it('replays idempotent host tool results for the same Python tool call ID', async () => {
    const effects = new Map<string, { status: string; result: string | null }>()
    const effectRepo = {
      get: vi.fn((_runId: string, toolCallId: string) => effects.get(toolCallId) ?? null),
      begin: vi.fn((input: { toolCallId: string }) => {
        effects.set(input.toolCallId, { status: 'running', result: null })
      }),
      finish: vi.fn((
        _runId: string,
        toolCallId: string,
        status: string,
        result: string
      ) => {
        effects.set(toolCallId, { status, result })
      })
    }
    const publish = vi.fn(async (paths: string) => JSON.stringify({ paths }))
    const tool = createAgentStringHostTool({
      name: 'publish_workspace_artifacts',
      argumentName: 'paths',
      description: 'Publish outputs',
      func: publish
    })
    const results: string[] = []
    const runtime = {
      stream: vi.fn(async function *(
        _request: unknown,
        options: {
          executeTool: (
            name: string,
            args: Record<string, unknown>,
            toolCallId: string | null
          ) => Promise<string>
          onComplete: (value: unknown) => void
        }
      ) {
        results.push(await options.executeTool(
          'publish_workspace_artifacts',
          { paths: 'outputs/report.md' },
          'tool-call-1'
        ))
        results.push(await options.executeTool(
          'publish_workspace_artifacts',
          { paths: 'outputs/report.md' },
          'tool-call-1'
        ))
        options.onComplete({ result: {}, state: {} })
        yield { event: 'on_chain_end', data: { output: {} } }
      })
    }
    const agent = createReforaDeepAgent({
      runtime: runtime as never,
      repos: { agentToolEffects: effectRepo } as never,
      runId: 'run-1',
      threadId: 'thread-1',
      workspaceId: 'workspace-1',
      provider: {
        model: 'gpt-test',
        baseUrl: 'https://example.test/v1',
        apiKey: 'secret',
        useResponsesApi: false,
        modelKwargs: {},
        temperature: null,
        maxTokens: null
      },
      systemPrompt: 'Refora prompt',
      tools: [tool],
      readOnlyTools: [],
      sandboxRoot: null,
      memories: {},
      checkpointPath: '/tmp/checkpoints.sqlite'
    })

    const events = []
    for await (const event of agent.streamEvents(
      { messages: [{ role: 'user', content: 'publish' }] },
      {}
    )) {
      events.push(event)
    }

    expect(events).toEqual([{ event: 'on_chain_end', data: { output: {} } }])
    expect(publish).toHaveBeenCalledTimes(1)
    expect(results).toEqual([
      '{"paths":"outputs/report.md"}',
      '{"paths":"outputs/report.md"}'
    ])
    expect(effectRepo.begin).toHaveBeenCalledTimes(1)
    expect(effectRepo.finish).toHaveBeenCalledTimes(1)
  })
})
