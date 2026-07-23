import { randomUUID } from 'node:crypto'
import type {
  AgentInterrupt,
  AgentInterruptAction,
  AgentInterruptDecision
} from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function mapInterrupt(row: Record<string, unknown>): AgentInterrupt {
  return {
    id: row.id as string,
    runId: row.runId as string,
    threadId: row.threadId as string,
    checkpointId: (row.checkpointId as string | null) ?? null,
    actions: parseJson<AgentInterruptAction[]>(row.payload, []),
    status: row.status as AgentInterrupt['status'],
    decision: parseJson<AgentInterruptDecision[] | null>(row.decision, null),
    createdAt: row.createdAt as number,
    resolvedAt: (row.resolvedAt as number | null) ?? null
  }
}

export function createAgentInterruptsRepository(db: SqliteDb) {
  function create(input: {
    runId: string
    threadId: string
    checkpointId?: string | null
    actions: AgentInterruptAction[]
  }): AgentInterrupt {
    const id = randomUUID()
    const now = Date.now()
    db.prepare(
      `INSERT INTO agent_interrupts
       (id, runId, threadId, checkpointId, payload, status, decision, createdAt, resolvedAt)
       VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, NULL)`
    ).run(id, input.runId, input.threadId, input.checkpointId ?? null, JSON.stringify(input.actions), now)
    return get(id) as AgentInterrupt
  }

  function get(id: string): AgentInterrupt | null {
    const row = db.prepare('SELECT * FROM agent_interrupts WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    return row ? mapInterrupt(row) : null
  }

  function getPendingByRun(runId: string): AgentInterrupt | null {
    const row = db
      .prepare(
        `SELECT * FROM agent_interrupts
         WHERE runId = ? AND status = 'pending'
         ORDER BY createdAt DESC LIMIT 1`
      )
      .get(runId) as Record<string, unknown> | undefined
    return row ? mapInterrupt(row) : null
  }

  function resolve(id: string, decisions: AgentInterruptDecision[]): AgentInterrupt | null {
    db.prepare(
      `UPDATE agent_interrupts
       SET status = 'resolved', decision = ?, resolvedAt = ?
       WHERE id = ? AND status = 'pending'`
    ).run(JSON.stringify(decisions), Date.now(), id)
    return get(id)
  }

  return { create, get, getPendingByRun, resolve }
}
