import { randomUUID } from 'node:crypto'
import type { WorkspaceAgentMemory } from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'

export interface AgentMemoryRevision {
  id: string
  memoryId: string
  revision: number
  content: string
  sourceThreadId: string | null
  sourceRunId: string | null
  createdAt: number
}

function mapMemory(row: Record<string, unknown>): WorkspaceAgentMemory {
  return {
    id: row.id as string,
    scope: row.scope as WorkspaceAgentMemory['scope'],
    scopeId: row.scopeId as string,
    workspaceId: (row.workspaceId as string | null) ?? null,
    path: row.path as string,
    content: row.content as string,
    revision: row.revision as number,
    sourceThreadId: (row.sourceThreadId as string | null) ?? null,
    sourceRunId: (row.sourceRunId as string | null) ?? null,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number
  }
}

function mapRevision(row: Record<string, unknown>): AgentMemoryRevision {
  return {
    id: row.id as string,
    memoryId: row.memoryId as string,
    revision: row.revision as number,
    content: row.content as string,
    sourceThreadId: (row.sourceThreadId as string | null) ?? null,
    sourceRunId: (row.sourceRunId as string | null) ?? null,
    createdAt: row.createdAt as number
  }
}

export function createAgentMemoriesRepository(db: SqliteDb) {
  function list(scope: 'workspace' | 'global', scopeId: string): WorkspaceAgentMemory[] {
    const rows = db
      .prepare(
        'SELECT * FROM workspace_agent_memories WHERE scope = ? AND scopeId = ? ORDER BY path'
      )
      .all(scope, scopeId) as Record<string, unknown>[]
    return rows.map(mapMemory)
  }

  function get(
    scope: 'workspace' | 'global',
    scopeId: string,
    path: string
  ): WorkspaceAgentMemory | null {
    const row = db
      .prepare(
        'SELECT * FROM workspace_agent_memories WHERE scope = ? AND scopeId = ? AND path = ?'
      )
      .get(scope, scopeId, path) as Record<string, unknown> | undefined
    return row ? mapMemory(row) : null
  }

  function upsert(input: {
    scope: 'workspace' | 'global'
    scopeId: string
    workspaceId: string | null
    path: string
    content: string
    sourceThreadId?: string | null
    sourceRunId?: string | null
  }): WorkspaceAgentMemory {
    const existing = get(input.scope, input.scopeId, input.path)
    const now = Date.now()
    if (existing) {
      const revision = existing.revision + 1
      db.prepare(
        `UPDATE workspace_agent_memories
         SET content = ?, revision = ?, sourceThreadId = ?, sourceRunId = ?, updatedAt = ?
         WHERE id = ?`
      ).run(
        input.content,
        revision,
        input.sourceThreadId ?? null,
        input.sourceRunId ?? null,
        now,
        existing.id
      )
      db.prepare(
        `INSERT INTO workspace_agent_memory_revisions
         (id, memoryId, revision, content, sourceThreadId, sourceRunId, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        randomUUID(),
        existing.id,
        revision,
        input.content,
        input.sourceThreadId ?? null,
        input.sourceRunId ?? null,
        now
      )
      return get(input.scope, input.scopeId, input.path) as WorkspaceAgentMemory
    }

    const id = randomUUID()
    db.prepare(
      `INSERT INTO workspace_agent_memories
       (id, scope, scopeId, workspaceId, path, content, revision, sourceThreadId, sourceRunId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
    ).run(
      id,
      input.scope,
      input.scopeId,
      input.workspaceId,
      input.path,
      input.content,
      input.sourceThreadId ?? null,
      input.sourceRunId ?? null,
      now,
      now
    )
    db.prepare(
      `INSERT INTO workspace_agent_memory_revisions
       (id, memoryId, revision, content, sourceThreadId, sourceRunId, createdAt)
       VALUES (?, ?, 1, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      id,
      input.content,
      input.sourceThreadId ?? null,
      input.sourceRunId ?? null,
      now
    )
    return get(input.scope, input.scopeId, input.path) as WorkspaceAgentMemory
  }

  function remove(scope: 'workspace' | 'global', scopeId: string, path: string): number {
    return db
      .prepare(
        'DELETE FROM workspace_agent_memories WHERE scope = ? AND scopeId = ? AND path = ?'
      )
      .run(scope, scopeId, path).changes
  }

  function listRevisions(memoryId: string): AgentMemoryRevision[] {
    const rows = db
      .prepare(
        'SELECT * FROM workspace_agent_memory_revisions WHERE memoryId = ? ORDER BY revision DESC'
      )
      .all(memoryId) as Record<string, unknown>[]
    return rows.map(mapRevision)
  }

  return { list, get, upsert, remove, listRevisions }
}
