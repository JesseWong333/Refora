import type { SqliteDb } from '../types'

export interface AgentToolEffect {
  runId: string
  toolCallId: string
  toolName: string
  workspaceId: string | null
  status: 'running' | 'done' | 'error'
  result: string | null
  createdAt: number
  updatedAt: number
}

function mapEffect(row: Record<string, unknown>): AgentToolEffect {
  return {
    runId: row.runId as string,
    toolCallId: row.toolCallId as string,
    toolName: row.toolName as string,
    workspaceId: (row.workspaceId as string | null) ?? null,
    status: row.status as AgentToolEffect['status'],
    result: (row.result as string | null) ?? null,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number
  }
}

export function createAgentToolEffectsRepository(db: SqliteDb) {
  function get(runId: string, toolCallId: string): AgentToolEffect | null {
    const row = db
      .prepare('SELECT * FROM agent_tool_effects WHERE runId = ? AND toolCallId = ?')
      .get(runId, toolCallId) as Record<string, unknown> | undefined
    return row ? mapEffect(row) : null
  }

  function begin(input: {
    runId: string
    toolCallId: string
    toolName: string
    workspaceId?: string | null
  }): AgentToolEffect {
    const existing = get(input.runId, input.toolCallId)
    if (existing) return existing
    const now = Date.now()
    db.prepare(
      `INSERT INTO agent_tool_effects
       (runId, toolCallId, toolName, workspaceId, status, result, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 'running', NULL, ?, ?)`
    ).run(input.runId, input.toolCallId, input.toolName, input.workspaceId ?? null, now, now)
    return get(input.runId, input.toolCallId) as AgentToolEffect
  }

  function finish(
    runId: string,
    toolCallId: string,
    status: 'done' | 'error',
    result: string
  ): AgentToolEffect | null {
    db.prepare(
      `UPDATE agent_tool_effects SET status = ?, result = ?, updatedAt = ?
       WHERE runId = ? AND toolCallId = ?`
    ).run(status, result, Date.now(), runId, toolCallId)
    return get(runId, toolCallId)
  }

  return { get, begin, finish }
}
