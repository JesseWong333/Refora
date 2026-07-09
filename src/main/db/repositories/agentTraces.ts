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
    seq: row.seq as number
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
  }): AgentTraceStep {
    const id = randomUUID()
    db.prepare(
      `INSERT INTO agent_trace_steps
        (id, threadId, runId, kind, name, input, output, status, startedAt, endedAt, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      input.seq
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
      output?: string | null
      status?: AgentTraceStepStatus
      endedAt?: number | null
    }
  ): AgentTraceStep | null {
    const existing = db.prepare('SELECT * FROM agent_trace_steps WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    if (!existing) return null
    const output = patch.output !== undefined ? patch.output : (existing.output as string | null)
    const status = patch.status ?? (existing.status as AgentTraceStepStatus)
    const endedAt = patch.endedAt !== undefined ? patch.endedAt : (existing.endedAt as number | null)
    db.prepare(
      'UPDATE agent_trace_steps SET output = ?, status = ?, endedAt = ? WHERE id = ?'
    ).run(output, status, endedAt, id)
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

  return { addStep, updateStep, listByThread, listByRun }
}
