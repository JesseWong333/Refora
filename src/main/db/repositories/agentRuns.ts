import type { AgentRun, AgentRunStatus } from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'

function mapRun(row: Record<string, unknown>): AgentRun {
  return {
    id: row.id as string,
    threadId: row.threadId as string,
    providerId: row.providerId as string,
    modelId: row.modelId as string,
    status: row.status as AgentRunStatus,
    checkpointBefore: (row.checkpointBefore as string | null) ?? null,
    checkpointAfter: (row.checkpointAfter as string | null) ?? null,
    replacesRunId: (row.replacesRunId as string | null) ?? null,
    userMessageId: (row.userMessageId as string | null) ?? null,
    assistantMessageId: (row.assistantMessageId as string | null) ?? null,
    startedAt: row.startedAt as number,
    endedAt: (row.endedAt as number | null) ?? null,
    error: (row.error as string | null) ?? null
  }
}

export function createAgentRunsRepository(db: SqliteDb) {
  function create(input: {
    id: string
    threadId: string
    providerId: string
    modelId: string
    status?: AgentRunStatus
    checkpointBefore?: string | null
    replacesRunId?: string | null
    userMessageId?: string | null
    startedAt?: number
  }): AgentRun {
    db.prepare(
      `INSERT INTO agent_runs
       (id, threadId, providerId, modelId, status, checkpointBefore, checkpointAfter,
        replacesRunId, userMessageId, assistantMessageId, startedAt, endedAt, error)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, NULL, NULL)`
    ).run(
      input.id,
      input.threadId,
      input.providerId,
      input.modelId,
      input.status ?? 'queued',
      input.checkpointBefore ?? null,
      input.replacesRunId ?? null,
      input.userMessageId ?? null,
      input.startedAt ?? Date.now()
    )
    return get(input.id) as AgentRun
  }

  function get(id: string): AgentRun | null {
    const row = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    return row ? mapRun(row) : null
  }

  function listByThread(threadId: string): AgentRun[] {
    const rows = db
      .prepare('SELECT * FROM agent_runs WHERE threadId = ? ORDER BY startedAt, id')
      .all(threadId) as Record<string, unknown>[]
    return rows.map(mapRun)
  }

  function update(
    id: string,
    patch: Partial<Pick<
      AgentRun,
      | 'status'
      | 'checkpointBefore'
      | 'checkpointAfter'
      | 'userMessageId'
      | 'assistantMessageId'
      | 'endedAt'
      | 'error'
    >>
  ): AgentRun | null {
    const existing = get(id)
    if (!existing) return null
    const next = { ...existing, ...patch }
    db.prepare(
      `UPDATE agent_runs
       SET status = ?, checkpointBefore = ?, checkpointAfter = ?, userMessageId = ?,
           assistantMessageId = ?, endedAt = ?, error = ?
       WHERE id = ?`
    ).run(
      next.status,
      next.checkpointBefore,
      next.checkpointAfter,
      next.userMessageId,
      next.assistantMessageId,
      next.endedAt,
      next.error,
      id
    )
    return get(id)
  }

  function reconcileRunning(error: string, endedAt = Date.now()): number {
    return db.prepare(
      `UPDATE agent_runs
       SET status = 'cancelled', endedAt = ?, error = ?
       WHERE status IN ('queued', 'running')`
    ).run(endedAt, error).changes
  }

  return { create, get, listByThread, update, reconcileRunning }
}
