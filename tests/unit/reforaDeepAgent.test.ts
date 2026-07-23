import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createDeepAgent: vi.fn(() => ({ kind: 'deep-agent' })),
  createFilesystemMiddleware: vi.fn(() => ({ name: 'FilesystemMiddleware' }))
}))

vi.mock('deepagents', () => ({
  CompositeBackend: class {
    constructor(
      readonly defaultBackend: unknown,
      readonly routes: Record<string, unknown>
    ) {}
  },
  createDeepAgent: mocks.createDeepAgent,
  createFilesystemMiddleware: mocks.createFilesystemMiddleware
}))

import { createReforaDeepAgent } from '../../src/main/services/reforaDeepAgent'

describe('Refora Deep Agent factory', () => {
  beforeEach(() => {
    mocks.createDeepAgent.mockClear()
  })

  it('builds the single Refora harness with planning, subagents, memory, and HITL policy', () => {
    const model = { id: 'model' }
    const tools = [{ name: 'search_library' }, { name: 'publish_workspace_artifacts' }]
    const readOnlyTools = [tools[0]]
    const sandboxBackend = { id: 'workspace:one' }
    const memoryBackend = { id: 'memory:one' }
    const checkpointer = { id: 'checkpointer' }
    const middleware = [{ name: 'policy' }]

    const result = createReforaDeepAgent({
      model,
      systemPrompt: 'Refora prompt',
      tools,
      readOnlyTools,
      backend: sandboxBackend,
      memoryBackend,
      checkpointer,
      includeResearchMemory: true,
      middleware
    } as never)

    expect(result).toEqual({ kind: 'deep-agent' })
    expect(mocks.createDeepAgent).toHaveBeenCalledTimes(1)
    const options = mocks.createDeepAgent.mock.calls[0][0]
    expect(options.name).toBe('refora')
    expect(options.tools).toBe(tools)
    expect(options.checkpointer).toBe(checkpointer)
    expect(options.middleware).toEqual([
      { name: 'FilesystemMiddleware' },
      ...middleware
    ])
    expect(mocks.createFilesystemMiddleware).toHaveBeenCalledWith(expect.objectContaining({
      backend: options.backend,
      systemPrompt: expect.stringContaining('same sandbox root')
    }))
    expect(options.memory).toEqual([
      '/memories/brief.md',
      '/memories/preferences.md',
      '/memories/decisions.md',
      '/memories/glossary.md',
      '/memories/research.md'
    ])
    expect(options.systemPrompt).toMatchObject({
      prefix: 'Refora prompt',
      suffix: expect.stringContaining('propose_workspace_memory_update')
    })
    expect(options.subagents.map((agent: { name: string }) => agent.name)).toEqual([
      'general-purpose',
      'researcher',
      'analyst',
      'data-analyst'
    ])
    for (const subagent of options.subagents) {
      expect(subagent.tools).toBe(readOnlyTools)
      expect(subagent.middleware).toEqual([{ name: 'FilesystemMiddleware' }])
    }
    expect(options.interruptOn).toEqual({
      install_runtime_packages: { allowedDecisions: ['approve', 'reject'] },
      publish_workspace_artifacts: { allowedDecisions: ['approve', 'reject'] },
      propose_workspace_memory_update: {
        allowedDecisions: ['approve', 'edit', 'reject']
      }
    })
    expect(options.backend.defaultBackend).toBe(sandboxBackend)
    expect(options.backend.routes).toEqual({ '/memories/': memoryBackend })
  })
})
