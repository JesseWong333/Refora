import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AIMessage } from '@langchain/core/messages'
import type { AiProvider } from '../../src/shared/ipc-types'
import { createRepositories } from '../../src/main/db/repositories'
import {
  createMainTestDb,
  migrateMainTestDb,
  type MainTestDb
} from '../helpers/mainDb'

const mocks = vi.hoisted(() => ({
  createReforaDeepAgent: vi.fn(),
  emitAiChatDone: vi.fn(),
  emitAiChatError: vi.fn(),
  emitAiChatInterrupted: vi.fn(),
  emitAiChatRunStatus: vi.fn()
}))

vi.mock('../../src/main/services/reforaDeepAgent', () => ({
  createReforaDeepAgent: mocks.createReforaDeepAgent
}))

vi.mock('../../src/main/services/providerModel', () => ({
  createProviderChatModel: vi.fn(() => ({ id: 'model' }))
}))

vi.mock('../../src/main/services/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock('../../src/main/ipc/events', () => ({
  emitAiChatToken: vi.fn(),
  emitAiChatReasoning: vi.fn(),
  emitAiChatDone: mocks.emitAiChatDone,
  emitAiChatError: mocks.emitAiChatError,
  emitAiChatTrace: vi.fn(),
  emitAiChatInterrupted: mocks.emitAiChatInterrupted,
  emitAiChatRunStatus: mocks.emitAiChatRunStatus,
  emitAiChatTitleUpdated: vi.fn(),
  emitAiReportCreated: vi.fn(),
  emitWorkspaceItemsChanged: vi.fn()
}))

import { createAiAgentService } from '../../src/main/services/aiAgent'

const provider: AiProvider = {
  id: 'provider-1',
  presetId: 'openai',
  name: 'Provider',
  baseUrl: 'https://example.test/v1',
  apiProtocol: 'openai-chat',
  reasoningControl: 'none',
  reasoningEffort: 'none',
  model: 'model-1',
  models: null,
  baseModel: 'model-1',
  variant: '',
  variantFormat: 'none',
  hasKey: true,
  temperature: null,
  maxTokens: null,
  createdAt: 0
}

describe('AiAgentService approval resume', () => {
  let db: MainTestDb
  let repos: ReturnType<typeof createRepositories>

  beforeEach(() => {
    vi.clearAllMocks()
    db = createMainTestDb()
    repos = createRepositories(migrateMainTestDb(db))
  })

  afterEach(() => {
    db.close()
  })

  it('persists an interrupt and resumes the same checkpointed run after approval', async () => {
    const workspace = repos.workspaces.create('Research')
    const thread = repos.chat.createThread(workspace.id, provider.id)
    const interruptedAgent = {
      streamEvents: async function* () {},
      getState: vi.fn(async () => ({
        config: { configurable: { checkpoint_id: 'checkpoint-1' } },
        tasks: [{
          interrupts: [{
            value: {
              actionRequests: [{
                name: 'publish_workspace_artifacts',
                args: { paths: ['outputs/report.md'] },
                description: 'Publish report.md'
              }],
              reviewConfigs: [{ allowedDecisions: ['approve', 'reject'] }]
            }
          }]
        }]
      }))
    }
    const resumedAgent = {
      invoke: vi.fn(async () => ({ messages: [new AIMessage('Published report.md')] })),
      getState: vi.fn(async () => ({
        config: { configurable: { checkpoint_id: 'checkpoint-2' } },
        tasks: []
      }))
    }
    mocks.createReforaDeepAgent
      .mockReturnValueOnce(interruptedAgent)
      .mockReturnValueOnce(resumedAgent)
    const service = createAiAgentService(
      repos,
      () => ({ isDestroyed: () => false }) as never,
      {
        getProvider: vi.fn(() => provider),
        getDecryptedKey: vi.fn(() => 'key')
      } as never,
      { getOrExtract: vi.fn(async () => '') } as never,
      { summarize: vi.fn(), destroy: vi.fn() } as never
    )

    await service.run({
      workspaceId: workspace.id,
      threadId: thread.id,
      text: 'Publish the report',
      providerId: provider.id,
      model: provider.model
    }, thread.id, 'run-1')

    const pending = repos.agentInterrupts.getPendingByRun('run-1')
    expect(pending).toMatchObject({
      status: 'pending',
      checkpointId: 'checkpoint-1',
      actions: [{
        name: 'publish_workspace_artifacts',
        allowedDecisions: ['approve', 'reject']
      }]
    })
    expect(repos.agentRuns.get('run-1')).toMatchObject({
      status: 'interrupted',
      checkpointAfter: 'checkpoint-1'
    })
    expect(repos.chat.getThread(thread.id)).toMatchObject({
      headCheckpointId: 'checkpoint-1',
      agentStateVersion: 1
    })
    expect(mocks.emitAiChatInterrupted).toHaveBeenCalledTimes(1)

    await service.resume({
      threadId: thread.id,
      runId: 'run-1',
      decisions: [{ type: 'approve' }]
    })

    expect(resumedAgent.invoke).toHaveBeenCalledTimes(1)
    expect(repos.agentInterrupts.get(pending!.id)).toMatchObject({
      status: 'resolved',
      decision: ['approve']
    })
    expect(repos.agentRuns.get('run-1')).toMatchObject({
      status: 'completed',
      checkpointAfter: 'checkpoint-2'
    })
    expect(repos.chat.listMessages(thread.id).at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Published report.md'
    })
    expect(mocks.emitAiChatDone).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        threadId: thread.id,
        runId: 'run-1',
        finalText: 'Published report.md'
      })
    )
    expect(mocks.emitAiChatError).not.toHaveBeenCalled()
  })

  it('detects an interrupt from the latest state when a later turn starts from a checkpoint', async () => {
    const workspace = repos.workspaces.create('Research')
    const thread = repos.chat.createThread(workspace.id, provider.id)
    repos.chat.updateAgentState(thread.id, 'checkpoint-before', 1)
    const getState = vi.fn(async (config: { configurable?: { checkpoint_id?: string } }) =>
      config.configurable?.checkpoint_id
        ? {
            config: { configurable: { checkpoint_id: 'checkpoint-before' } },
            tasks: []
          }
        : {
            config: { configurable: { checkpoint_id: 'checkpoint-after' } },
            tasks: [{
              interrupts: [{
                value: {
                  actionRequests: [{
                    name: 'publish_workspace_artifacts',
                    args: { paths: ['outputs/report.md'] }
                  }],
                  reviewConfigs: [{ allowedDecisions: ['approve', 'reject'] }]
                }
              }]
            }]
          })
    const streamEvents = vi.fn(async function* () {})
    mocks.createReforaDeepAgent.mockReturnValue({ streamEvents, getState })
    const service = createAiAgentService(
      repos,
      () => ({ isDestroyed: () => false }) as never,
      {
        getProvider: vi.fn(() => provider),
        getDecryptedKey: vi.fn(() => 'key')
      } as never,
      { getOrExtract: vi.fn(async () => '') } as never,
      { summarize: vi.fn(), destroy: vi.fn() } as never
    )

    await service.run({
      workspaceId: workspace.id,
      threadId: thread.id,
      text: 'Publish another report',
      providerId: provider.id,
      model: provider.model
    }, thread.id, 'run-2')

    expect(streamEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        configurable: {
          thread_id: thread.id,
          checkpoint_id: 'checkpoint-before'
        }
      })
    )
    expect(getState).toHaveBeenLastCalledWith({
      configurable: { thread_id: thread.id }
    })
    expect(repos.agentInterrupts.getPendingByRun('run-2')).toMatchObject({
      checkpointId: 'checkpoint-after',
      status: 'pending'
    })
    expect(repos.agentRuns.get('run-2')).toMatchObject({
      checkpointAfter: 'checkpoint-after',
      status: 'interrupted'
    })
  })

  it('rejects edited approvals that change the tool name or violate its schema', async () => {
    const workspace = repos.workspaces.create('Research')
    const thread = repos.chat.createThread(workspace.id, provider.id)
    repos.agentRuns.create({
      id: 'run-edit',
      threadId: thread.id,
      providerId: provider.id,
      modelId: provider.model,
      status: 'interrupted'
    })
    const interrupt = repos.agentInterrupts.create({
      runId: 'run-edit',
      threadId: thread.id,
      checkpointId: 'checkpoint-edit',
      actions: [{
        name: 'propose_workspace_memory_update',
        args: { path: '/brief.md', content: 'Original', rationale: 'Keep context' },
        allowedDecisions: ['approve', 'edit', 'reject']
      }]
    })
    const service = createAiAgentService(
      repos,
      () => ({ isDestroyed: () => false }) as never,
      {
        getProvider: vi.fn(() => provider),
        getDecryptedKey: vi.fn(() => 'key')
      } as never,
      { getOrExtract: vi.fn(async () => '') } as never,
      { summarize: vi.fn(), destroy: vi.fn() } as never
    )

    await expect(service.resume({
      threadId: thread.id,
      runId: 'run-edit',
      decisions: [{
        type: 'edit',
        editedAction: {
          name: 'publish_workspace_artifacts',
          args: { paths: ['outputs/report.md'] }
        }
      }]
    })).rejects.toThrow('cannot change the action name')

    await expect(service.resume({
      threadId: thread.id,
      runId: 'run-edit',
      decisions: [{
        type: 'edit',
        editedAction: {
          name: 'propose_workspace_memory_update',
          args: { path: '/brief.md', content: 'Edited without rationale' }
        }
      }]
    })).rejects.toThrow()

    expect(repos.agentInterrupts.get(interrupt.id)).toMatchObject({ status: 'pending' })
    expect(repos.agentRuns.get('run-edit')).toMatchObject({ status: 'interrupted' })
    expect(mocks.createReforaDeepAgent).not.toHaveBeenCalled()
  })

  it('keeps the interrupt pending and rejects resume when execution fails', async () => {
    const workspace = repos.workspaces.create('Research')
    const thread = repos.chat.createThread(workspace.id, provider.id)
    repos.agentRuns.create({
      id: 'run-failed-resume',
      threadId: thread.id,
      providerId: provider.id,
      modelId: provider.model,
      status: 'interrupted'
    })
    const interrupt = repos.agentInterrupts.create({
      runId: 'run-failed-resume',
      threadId: thread.id,
      checkpointId: 'checkpoint-failed-resume',
      actions: [{
        name: 'publish_workspace_artifacts',
        args: { paths: ['outputs/report.md'] },
        allowedDecisions: ['approve', 'reject']
      }]
    })
    mocks.createReforaDeepAgent.mockReturnValue({
      invoke: vi.fn(async () => {
        throw new Error('Provider unavailable')
      })
    })
    const service = createAiAgentService(
      repos,
      () => ({ isDestroyed: () => false }) as never,
      {
        getProvider: vi.fn(() => provider),
        getDecryptedKey: vi.fn(() => 'key')
      } as never,
      { getOrExtract: vi.fn(async () => '') } as never,
      { summarize: vi.fn(), destroy: vi.fn() } as never
    )

    await expect(service.resume({
      threadId: thread.id,
      runId: 'run-failed-resume',
      decisions: [{ type: 'approve' }]
    })).rejects.toThrow('Provider unavailable')

    expect(repos.agentInterrupts.get(interrupt.id)).toMatchObject({ status: 'pending' })
    expect(repos.agentRuns.get('run-failed-resume')).toMatchObject({
      status: 'failed',
      error: 'Provider unavailable'
    })
    expect(mocks.emitAiChatError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ message: 'Provider unavailable' })
    )
  })
})
