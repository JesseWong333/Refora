import { randomUUID } from 'node:crypto'
import type { AgentTraceStep, AgentTraceStepKind, AgentTraceStepStatus } from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'

function mapStep(row: Record<string, unknown>): AgentTraceStep {
  return {
    id: row.id as string,
    threadId: row.threadId as string,
    runId: row.runId as string,
    kind: row.kind as AgentTraceStepKind,
    name: (row.name as string | null) ?? null,
    input: (row.input as string | null) ?? null,
    output: (row.output as string | null) ?? null,
    status: row.status as AgentTraceStepStatus,
    startedAt: row.startedAt as number,
    endedAt: (row.endedAt as number | null) ?? null,
    seq: row.seq as number,
    inputTokens: (row.inputTokens as number | null) ?? null,
    outputTokens: (row.outputTokens as number | null) ?? null,
    totalTokens: (row.totalTokens as number | null) ?? null,
    parentStepId: (row.parentStepId as string | null) ?? null,
    agentName: (row.agentName as string | null) ?? null,
    namespace: (row.namespace as string | null) ?? null,
    depth: (row.depth as number | null) ?? 0,
    checkpointId: (row.checkpointId as string | null) ?? null
  }
}

export function createAgentTracesRepository(db: SqliteDb) {
  function addStep(input: {
    threadId: string
    runId: string
    kind: AgentTraceStepKind
    name?: string | null
    input?: string | null
    output?: string | null
    status: AgentTraceStepStatus
    startedAt: number
    endedAt?: number | null
    seq: number
    inputTokens?: number | null
    outputTokens?: number | null
    totalTokens?: number | null
    parentStepId?: string | null
    agentName?: string | null
    namespace?: string | null
    depth?: number
    checkpointId?: string | null
  }): AgentTraceStep {
    const id = randomUUID()
    db.prepare(
      `INSERT INTO agent_trace_steps
        (id, threadId, runId, kind, name, input, output, status, startedAt, endedAt, seq,
         inputTokens, outputTokens, totalTokens, parentStepId, agentName, namespace, depth, checkpointId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.threadId,
      input.runId,
      input.kind,
      input.name ?? null,
      input.input ?? null,
      input.output ?? null,
      input.status,
      input.startedAt,
      input.endedAt ?? null,
      input.seq,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.totalTokens ?? null,
      input.parentStepId ?? null,
      input.agentName ?? null,
      input.namespace ?? null,
      input.depth ?? 0,
      input.checkpointId ?? null
    )
    const row = db.prepare('SELECT * FROM agent_trace_steps WHERE id = ?').get(id) as Record<
      string,
      unknown
    >
    return mapStep(row)
  }

  function updateStep(
    id: string,
    patch: {
      input?: string | null
      output?: string | null
      status?: AgentTraceStepStatus
      endedAt?: number | null
      inputTokens?: number | null
      outputTokens?: number | null
      totalTokens?: number | null
    }
  ): AgentTraceStep | null {
    const existing = db.prepare('SELECT * FROM agent_trace_steps WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    if (!existing) return null
    const traceInput = patch.input !== undefined ? patch.input : (existing.input as string | null)
    const output = patch.output !== undefined ? patch.output : (existing.output as string | null)
    const status = patch.status ?? (existing.status as AgentTraceStepStatus)
    const endedAt = patch.endedAt !== undefined ? patch.endedAt : (existing.endedAt as number | null)

    const sets: string[] = ['input = ?', 'output = ?', 'status = ?', 'endedAt = ?']
    const params: unknown[] = [traceInput, output, status, endedAt]

    if (patch.inputTokens !== undefined) {
      sets.push('inputTokens = ?')
      params.push(patch.inputTokens)
    }
    if (patch.outputTokens !== undefined) {
      sets.push('outputTokens = ?')
      params.push(patch.outputTokens)
    }
    if (patch.totalTokens !== undefined) {
      sets.push('totalTokens = ?')
      params.push(patch.totalTokens)
    }

    params.push(id)
    db.prepare(`UPDATE agent_trace_steps SET ${sets.join(', ')} WHERE id = ?`).run(...params)

    const row = db.prepare('SELECT * FROM agent_trace_steps WHERE id = ?').get(id) as Record<
      string,
      unknown
    >
    return mapStep(row)
  }

  function listByThread(threadId: string): AgentTraceStep[] {
    const rows = db
      .prepare(
        'SELECT * FROM agent_trace_steps WHERE threadId = ? ORDER BY startedAt ASC, seq ASC'
      )
      .all(threadId) as Record<string, unknown>[]
    return rows.map(mapStep)
  }

  function listByRun(runId: string): AgentTraceStep[] {
    const rows = db
      .prepare('SELECT * FROM agent_trace_steps WHERE runId = ? ORDER BY seq ASC')
      .all(runId) as Record<string, unknown>[]
    return rows.map(mapStep)
  }

  function deleteByThread(threadId: string): number {
    const result = db.prepare('DELETE FROM agent_trace_steps WHERE threadId = ?').run(threadId)
    return result.changes
  }

  function deleteByRun(threadId: string, runId: string): number {
    const result = db
      .prepare('DELETE FROM agent_trace_steps WHERE threadId = ? AND runId = ?')
      .run(threadId, runId)
    return result.changes
  }

  function deleteOlderThan(timestamp: number): number {
    const result = db.prepare('DELETE FROM agent_trace_steps WHERE startedAt < ?').run(timestamp)
    return result.changes
  }

  function reconcileRunning(output: string, endedAt = Date.now()): number {
    return db.prepare(
      `UPDATE agent_trace_steps
       SET status = 'cancelled', output = COALESCE(output, ?), endedAt = ?
       WHERE status = 'running'`
    ).run(output, endedAt).changes
  }

  return {
    addStep,
    updateStep,
    listByThread,
    listByRun,
    deleteByThread,
    deleteByRun,
    deleteOlderThan,
    reconcileRunning
  }
}
