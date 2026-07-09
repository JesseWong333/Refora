import { randomUUID } from 'node:crypto'
import type { ChatMessage, ChatThread } from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'

function mapThread(row: Record<string, unknown>): ChatThread {
  return {
    id: row.id as string,
    workspaceId: row.workspaceId as string,
    providerId: row.providerId as string,
    createdAt: row.createdAt as number
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
  function createThread(workspaceId: string, providerId: string): ChatThread {
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

  function listThreads(workspaceId: string): ChatThread[] {
    const rows = db
      .prepare('SELECT * FROM chat_threads WHERE workspaceId = ? ORDER BY createdAt DESC')
      .all(workspaceId) as Record<string, unknown>[]
    return rows.map(mapThread)
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

  return { createThread, listThreads, addMessage, listMessages }
}
