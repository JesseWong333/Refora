import { randomUUID } from 'node:crypto'
import type { ChatMessage, ChatSearchResult, ChatThread } from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'
import { RepoError } from './errors'

function mapThread(row: Record<string, unknown>): ChatThread {
  return {
    id: row.id as string,
    workspaceId: (row.workspaceId as string | null) ?? null,
    providerId: row.providerId as string,
    createdAt: row.createdAt as number,
    title: (row.title as string | null) ?? null,
    headCheckpointId: (row.headCheckpointId as string | null) ?? null,
    agentStateVersion: (row.agentStateVersion as number | null) ?? 0
  }
}

function mapMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: row.id as string,
    threadId: row.threadId as string,
    role: row.role as ChatMessage['role'],
    content: row.content as string,
    createdAt: row.createdAt as number
  }
}

export function createChatRepository(db: SqliteDb) {
  function createThread(workspaceId: string | null, providerId: string): ChatThread {
    const id = randomUUID()
    const now = Date.now()
    db.prepare(
      'INSERT INTO chat_threads (id, workspaceId, providerId, createdAt) VALUES (?, ?, ?, ?)'
    ).run(id, workspaceId, providerId, now)
    const row = db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(id) as Record<
      string,
      unknown
    >
    return mapThread(row)
  }

  function listThreads(workspaceId: string | null): ChatThread[] {
    const rows = db
      .prepare('SELECT * FROM chat_threads WHERE workspaceId IS ? ORDER BY createdAt DESC')
      .all(workspaceId) as Record<string, unknown>[]
    return rows.map(mapThread)
  }

  function getThread(id: string): ChatThread | null {
    const row = db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    return row ? mapThread(row) : null
  }

  function addMessage(threadId: string, role: ChatMessage['role'], content: string): ChatMessage {
    const id = randomUUID()
    const now = Date.now()
    db.prepare(
      'INSERT INTO chat_messages (id, threadId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)'
    ).run(id, threadId, role, content, now)
    const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id) as Record<
      string,
      unknown
    >
    return mapMessage(row)
  }

  function listMessages(threadId: string): ChatMessage[] {
    const rows = db
      .prepare('SELECT * FROM chat_messages WHERE threadId = ? ORDER BY createdAt')
      .all(threadId) as Record<string, unknown>[]
    return rows.map(mapMessage)
  }

  function search(q: string, limit = 10): ChatSearchResult[] {
    const trimmed = q.trim()
    if (!trimmed) return []
    const escaped = trimmed.replace(/[%_\\]/g, '\\$&')
    const like = `%${escaped}%`
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)))
    const rows = db
      .prepare(
        `WITH matching_messages AS (
           SELECT m.threadId, m.role, m.content, m.createdAt,
                  ROW_NUMBER() OVER (
                    PARTITION BY m.threadId
                    ORDER BY m.createdAt DESC, m.rowid DESC
                  ) AS matchRank
           FROM chat_messages m
           WHERE m.role IN ('user', 'assistant')
             AND m.content LIKE ? ESCAPE '\\'
         )
         SELECT t.id AS threadId, t.workspaceId, w.name AS workspaceName, t.title,
                m.role, m.content, COALESCE(m.createdAt, t.createdAt) AS matchedAt
         FROM chat_threads t
         LEFT JOIN workspaces w ON w.id = t.workspaceId
         LEFT JOIN matching_messages m ON m.threadId = t.id AND m.matchRank = 1
         WHERE t.title LIKE ? ESCAPE '\\'
            OR m.threadId IS NOT NULL
         ORDER BY matchedAt DESC, t.id
         LIMIT ?`
      )
      .all(like, like, safeLimit) as Record<string, unknown>[]
    const normalized = trimmed.toLocaleLowerCase()
    const seen = new Set<string>()
    const results: ChatSearchResult[] = []
    for (const row of rows) {
      const threadId = row.threadId as string
      if (seen.has(threadId)) continue
      seen.add(threadId)
      const content = typeof row.content === 'string' ? row.content.trim() : ''
      const matchIndex = content.toLocaleLowerCase().indexOf(normalized)
      const start = matchIndex < 0 ? 0 : Math.max(0, matchIndex - 80)
      const excerpt = content.slice(start, start + 240).trim()
      results.push({
        threadId,
        workspaceId: (row.workspaceId as string | null) ?? null,
        workspaceName: (row.workspaceName as string | null) ?? null,
        title: (row.title as string | null) ?? null,
        snippet: excerpt || ((row.title as string | null) ?? ''),
        role: row.role === 'assistant' ? 'assistant' : row.role === 'user' ? 'user' : null,
        matchedAt: row.matchedAt as number
      })
      if (results.length >= safeLimit) break
    }
    return results
  }

  function deleteLastExchange(threadId: string): number {
    const row = db
      .prepare(
        `SELECT rowid
         FROM chat_messages
         WHERE threadId = ? AND role = 'user'
         ORDER BY rowid DESC
         LIMIT 1`
      )
      .get(threadId) as { rowid: number } | undefined
    if (!row) return 0
    const result = db
      .prepare('DELETE FROM chat_messages WHERE threadId = ? AND rowid >= ?')
      .run(threadId, row.rowid)
    return result.changes
  }

  function deleteThread(id: string): void {
    const result = db.prepare('DELETE FROM chat_threads WHERE id = ?').run(id)
    if (result.changes === 0) throw new RepoError('not_found', `thread not found: ${id}`)
  }

  function updateTitle(threadId: string, title: string): ChatThread {
    db.prepare('UPDATE chat_threads SET title = ? WHERE id = ?').run(title, threadId)
    const row = db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(threadId) as
      | Record<string, unknown>
      | undefined
    if (!row) throw new RepoError('not_found', `thread not found: ${threadId}`)
    return mapThread(row)
  }

  function updateAgentState(
    threadId: string,
    headCheckpointId: string | null,
    agentStateVersion: number
  ): ChatThread {
    db.prepare(
      'UPDATE chat_threads SET headCheckpointId = ?, agentStateVersion = ? WHERE id = ?'
    ).run(headCheckpointId, agentStateVersion, threadId)
    const row = db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(threadId) as
      | Record<string, unknown>
      | undefined
    if (!row) throw new RepoError('not_found', `thread not found: ${threadId}`)
    return mapThread(row)
  }

  return {
    createThread,
    listThreads,
    getThread,
    addMessage,
    listMessages,
    search,
    deleteLastExchange,
    deleteThread,
    updateTitle,
    updateAgentState
  }
}
