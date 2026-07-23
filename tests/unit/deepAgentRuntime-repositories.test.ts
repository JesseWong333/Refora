import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRepositories } from '../../src/main/db/repositories'
import {
  ensureWorkspaceMemoryFiles,
  updateWorkspaceMemory
} from '../../src/main/services/reforaWorkspaceMemoryBackend'
import {
  createMainTestDb,
  migrateMainTestDb,
  type MainTestDb
} from '../helpers/mainDb'

describe('Deep Agent runtime repositories', () => {
  let db: MainTestDb
  let repos: ReturnType<typeof createRepositories>

  beforeEach(() => {
    db = createMainTestDb()
    repos = createRepositories(migrateMainTestDb(db))
  })

  afterEach(() => {
    db.close()
  })

  it('isolates curated memory by Workspace and keeps revision history', () => {
    const first = repos.workspaces.create('First')
    const second = repos.workspaces.create('Second')
    ensureWorkspaceMemoryFiles(repos, first.id)
    ensureWorkspaceMemoryFiles(repos, second.id)
    ensureWorkspaceMemoryFiles(repos, null)

    const updated = updateWorkspaceMemory(repos, {
      workspaceId: first.id,
      path: '/brief.md',
      content: 'First workspace only'
    })
    updateWorkspaceMemory(repos, {
      workspaceId: first.id,
      path: '/brief.md',
      content: 'First workspace revision two'
    })

    expect(repos.agentMemories.list('workspace', first.id)).toHaveLength(4)
    expect(repos.agentMemories.get('workspace', first.id, '/brief.md')?.content)
      .toBe('First workspace revision two')
    expect(repos.agentMemories.get('workspace', second.id, '/brief.md')?.content).toBe('')
    expect(repos.agentMemories.get('global', 'global', '/brief.md')?.content).toBe('')
    expect(repos.agentMemories.listRevisions(updated.id).map((entry) => entry.revision))
      .toEqual([3, 2, 1])
  })

  it('persists runs, approvals, and idempotent tool outcomes', () => {
    const workspace = repos.workspaces.create('Research')
    const thread = repos.chat.createThread(workspace.id, 'provider-1')
    const userMessage = repos.chat.addMessage(thread.id, 'user', 'Create a report')
    const run = repos.agentRuns.create({
      id: 'run-1',
      threadId: thread.id,
      providerId: 'provider-1',
      modelId: 'model-1',
      status: 'running',
      checkpointBefore: 'checkpoint-before',
      userMessageId: userMessage.id
    })

    const interrupt = repos.agentInterrupts.create({
      runId: run.id,
      threadId: thread.id,
      checkpointId: 'checkpoint-after',
      actions: [{
        name: 'publish_workspace_artifacts',
        args: { paths: ['outputs/report.md'] },
        allowedDecisions: ['approve', 'reject']
      }]
    })
    repos.agentInterrupts.resolve(interrupt.id, ['approve'])
    repos.agentToolEffects.begin({
      runId: run.id,
      toolCallId: 'tool-call-1',
      toolName: 'publish_workspace_artifacts',
      workspaceId: workspace.id
    })
    repos.agentToolEffects.finish(run.id, 'tool-call-1', 'done', '{"published":1}')
    repos.agentRuns.update(run.id, {
      status: 'completed',
      checkpointAfter: 'checkpoint-after',
      endedAt: 2
    })

    expect(repos.agentRuns.get(run.id)).toMatchObject({
      status: 'completed',
      checkpointBefore: 'checkpoint-before',
      checkpointAfter: 'checkpoint-after'
    })
    expect(repos.agentInterrupts.get(interrupt.id)).toMatchObject({
      status: 'resolved',
      decision: ['approve']
    })
    expect(repos.agentToolEffects.get(run.id, 'tool-call-1')).toMatchObject({
      status: 'done',
      result: '{"published":1}'
    })
  })

  it('cascades Workspace memory and run state with their owners', () => {
    const workspace = repos.workspaces.create('Disposable')
    ensureWorkspaceMemoryFiles(repos, workspace.id)
    const thread = repos.chat.createThread(workspace.id, 'provider-1')
    repos.agentRuns.create({
      id: 'run-1',
      threadId: thread.id,
      providerId: 'provider-1',
      modelId: 'model-1'
    })

    repos.workspaces.delete(workspace.id)

    expect(repos.agentMemories.list('workspace', workspace.id)).toEqual([])
    expect(repos.agentRuns.get('run-1')).toBeNull()
    expect(repos.chat.getThread(thread.id)).toBeNull()
  })

  it('reconciles unfinished runs and trace steps after an unclean exit', () => {
    const thread = repos.chat.createThread(null, 'provider-1')
    repos.agentRuns.create({
      id: 'run-running',
      threadId: thread.id,
      providerId: 'provider-1',
      modelId: 'model-1',
      status: 'running'
    })
    repos.agentRuns.create({
      id: 'run-completed',
      threadId: thread.id,
      providerId: 'provider-1',
      modelId: 'model-1',
      status: 'completed'
    })
    const runningStep = repos.agentTraces.addStep({
      threadId: thread.id,
      runId: 'run-running',
      kind: 'llm',
      status: 'running',
      startedAt: 1,
      seq: 0
    })
    const completedStep = repos.agentTraces.addStep({
      threadId: thread.id,
      runId: 'run-completed',
      kind: 'llm',
      status: 'done',
      startedAt: 1,
      endedAt: 2,
      seq: 0
    })

    expect(repos.agentRuns.reconcileRunning('Recovered after restart', 10)).toBe(1)
    expect(repos.agentTraces.reconcileRunning('Recovered after restart', 10)).toBe(1)

    expect(repos.agentRuns.get('run-running')).toMatchObject({
      status: 'cancelled',
      endedAt: 10,
      error: 'Recovered after restart'
    })
    expect(repos.agentRuns.get('run-completed')).toMatchObject({ status: 'completed' })
    expect(repos.agentTraces.listByRun('run-running').find((step) => step.id === runningStep.id))
      .toMatchObject({ status: 'cancelled', endedAt: 10, output: 'Recovered after restart' })
    expect(repos.agentTraces.listByRun('run-completed').find((step) => step.id === completedStep.id))
      .toMatchObject({ status: 'done', endedAt: 2 })
  })
})
