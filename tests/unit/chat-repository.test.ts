import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { runMigrations } from '../../src/main/db/migrations'
import { seedDefaultSettings } from '../../src/main/db/settings-seed'
import { createRepositories } from '../../src/main/db/repositories'
import { RepoError } from '../../src/main/db/repositories/errors'

const nodeRequire = createRequire(import.meta.url)
const { DatabaseSync } = nodeRequire('node:sqlite')

function createTestDb() {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = ON')
  const db = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    getUserVersion: () => {
      const row = raw.prepare('PRAGMA user_version').get() as { user_version: number }
      return row.user_version
    },
    setUserVersion: (version: number) => {
      raw.exec(`PRAGMA user_version = ${version}`)
    }
  }
  runMigrations(db)
  seedDefaultSettings(db, 'en')
  return db
}

let db: ReturnType<typeof createTestDb>
let repos: ReturnType<typeof createRepositories>

beforeEach(() => {
  db = createTestDb()
  repos = createRepositories(db)
  const now = Date.now()
  db.prepare('INSERT INTO workspaces (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)').run('ws-1', 'WS1', now, now)
  db.prepare('INSERT INTO workspaces (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)').run('ws-2', 'WS2', now, now)
})

describe('ChatRepository', () => {
  describe('createThread', () => {
    it('creates and returns thread with correct workspaceId and providerId', () => {
      const thread = repos.chat.createThread('ws-1', 'prov-1')
      expect(thread.id).toBeTypeOf('string')
      expect(thread.id.length).toBeGreaterThan(0)
      expect(thread.workspaceId).toBe('ws-1')
      expect(thread.providerId).toBe('prov-1')
      expect(thread.createdAt).toBeTypeOf('number')
    })

    it('returns thread with title null', () => {
      const thread = repos.chat.createThread('ws-1', 'prov-1')
      expect(thread.title).toBeNull()
    })

    it('creates a global thread without a workspace', () => {
      const thread = repos.chat.createThread(null, 'prov-1')

      expect(thread.workspaceId).toBeNull()
      expect(repos.chat.getThread(thread.id)?.workspaceId).toBeNull()
    })
  })

  describe('listThreads', () => {
    it('returns threads for a workspace, sorted by createdAt DESC', () => {
      const t1 = repos.chat.createThread('ws-1', 'p1')
      const t2 = repos.chat.createThread('ws-1', 'p1')
      const t3 = repos.chat.createThread('ws-1', 'p1')
      const threads = repos.chat.listThreads('ws-1')
      expect(threads).toHaveLength(3)
      expect(threads[0].createdAt).toBeGreaterThanOrEqual(threads[1].createdAt)
      expect(threads[1].createdAt).toBeGreaterThanOrEqual(threads[2].createdAt)
      const ids = threads.map((t) => t.id)
      expect(ids).toContain(t1.id)
      expect(ids).toContain(t2.id)
      expect(ids).toContain(t3.id)
    })

    it('only returns threads for the specified workspace', () => {
      repos.chat.createThread('ws-1', 'p1')
      repos.chat.createThread('ws-2', 'p1')
      repos.chat.createThread(null, 'p1')
      expect(repos.chat.listThreads('ws-1')).toHaveLength(1)
      expect(repos.chat.listThreads('ws-2')).toHaveLength(1)
      expect(repos.chat.listThreads('ws-3')).toHaveLength(0)
      expect(repos.chat.listThreads(null)).toHaveLength(1)
    })
  })

  describe('getThread', () => {
    it('returns thread when exists', () => {
      const created = repos.chat.createThread('ws-1', 'p1')
      const fetched = repos.chat.getThread(created.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.id).toBe(created.id)
      expect(fetched!.workspaceId).toBe('ws-1')
      expect(fetched!.providerId).toBe('p1')
    })

    it('returns null when not found', () => {
      expect(repos.chat.getThread('nonexistent')).toBeNull()
    })

    it('returns title null for newly created thread', () => {
      const created = repos.chat.createThread('ws-1', 'p1')
      const fetched = repos.chat.getThread(created.id)
      expect(fetched!.title).toBeNull()
    })
  })

  describe('updateTitle', () => {
    it('sets the title and returns the updated thread', () => {
      const thread = repos.chat.createThread('ws-1', 'p1')
      const updated = repos.chat.updateTitle(thread.id, 'My Chat Title')
      expect(updated.id).toBe(thread.id)
      expect(updated.title).toBe('My Chat Title')
    })

    it('persists the title so getThread returns it', () => {
      const thread = repos.chat.createThread('ws-1', 'p1')
      repos.chat.updateTitle(thread.id, 'Persisted Title')
      const fetched = repos.chat.getThread(thread.id)
      expect(fetched!.title).toBe('Persisted Title')
    })

    it('throws RepoError not_found for nonexistent thread', () => {
      expect(() => repos.chat.updateTitle('nonexistent', 'Title')).toThrow(RepoError)
      try {
        repos.chat.updateTitle('nonexistent', 'Title')
      } catch (e) {
        expect(e).toBeInstanceOf(RepoError)
        expect((e as RepoError).code).toBe('not_found')
      }
    })

    it('listThreads returns threads with title', () => {
      const t1 = repos.chat.createThread('ws-1', 'p1')
      repos.chat.updateTitle(t1.id, 'Title One')
      repos.chat.createThread('ws-1', 'p1')
      const threads = repos.chat.listThreads('ws-1')
      expect(threads).toHaveLength(2)
      const titled = threads.find((t) => t.id === t1.id)
      expect(titled!.title).toBe('Title One')
      const untitled = threads.find((t) => t.id !== t1.id)
      expect(untitled!.title).toBeNull()
    })
  })

  describe('addMessage', () => {
    it('adds message with correct threadId, role, content', () => {
      const thread = repos.chat.createThread('ws-1', 'p1')
      const msg = repos.chat.addMessage(thread.id, 'user', 'Hello world')
      expect(msg.id).toBeTypeOf('string')
      expect(msg.threadId).toBe(thread.id)
      expect(msg.role).toBe('user')
      expect(msg.content).toBe('Hello world')
      expect(msg.createdAt).toBeTypeOf('number')
    })

    it('supports all message roles', () => {
      const thread = repos.chat.createThread('ws-1', 'p1')
      const userMsg = repos.chat.addMessage(thread.id, 'user', 'q')
      const assistantMsg = repos.chat.addMessage(thread.id, 'assistant', 'a')
      const toolMsg = repos.chat.addMessage(thread.id, 'tool', 't')
      expect(userMsg.role).toBe('user')
      expect(assistantMsg.role).toBe('assistant')
      expect(toolMsg.role).toBe('tool')
    })
  })

  describe('listMessages', () => {
    it('returns messages ordered by createdAt ASC', () => {
      const thread = repos.chat.createThread('ws-1', 'p1')
      const m1 = repos.chat.addMessage(thread.id, 'user', 'first')
      const m2 = repos.chat.addMessage(thread.id, 'assistant', 'second')
      const m3 = repos.chat.addMessage(thread.id, 'user', 'third')
      const messages = repos.chat.listMessages(thread.id)
      expect(messages).toHaveLength(3)
      expect(messages[0].id).toBe(m1.id)
      expect(messages[1].id).toBe(m2.id)
      expect(messages[2].id).toBe(m3.id)
    })

    it('only returns messages for the specified thread', () => {
      const t1 = repos.chat.createThread('ws-1', 'p1')
      const t2 = repos.chat.createThread('ws-1', 'p1')
      repos.chat.addMessage(t1.id, 'user', 'msg in t1')
      repos.chat.addMessage(t2.id, 'user', 'msg in t2')
      expect(repos.chat.listMessages(t1.id)).toHaveLength(1)
      expect(repos.chat.listMessages(t2.id)).toHaveLength(1)
    })

    it('returns empty array for thread with no messages', () => {
      const thread = repos.chat.createThread('ws-1', 'p1')
      expect(repos.chat.listMessages(thread.id)).toEqual([])
    })
  })

  describe('search', () => {
    it('searches titles and message content across workspaces without duplicate threads', () => {
      const titleThread = repos.chat.createThread('ws-1', 'p1')
      repos.chat.updateTitle(titleThread.id, 'Transformer survey')
      repos.chat.addMessage(titleThread.id, 'user', 'unrelated prompt')
      const messageThread = repos.chat.createThread('ws-2', 'p1')
      repos.chat.addMessage(messageThread.id, 'user', 'Explain sparse attention in transformers')
      repos.chat.addMessage(messageThread.id, 'assistant', 'Transformer sparse attention reduces compute')

      const results = repos.chat.search('transform')

      expect(results).toHaveLength(2)
      expect(results).toEqual(expect.arrayContaining([
        expect.objectContaining({
          threadId: titleThread.id,
          workspaceName: 'WS1',
          title: 'Transformer survey'
        }),
        expect.objectContaining({
          threadId: messageThread.id,
          workspaceName: 'WS2',
          snippet: expect.stringContaining('Transformer'),
          role: 'assistant'
        })
      ]))
    })

    it('treats LIKE wildcards as literal search text and ignores tool messages', () => {
      const thread = repos.chat.createThread('ws-1', 'p1')
      repos.chat.addMessage(thread.id, 'assistant', 'Accuracy reached 100%')
      const toolOnly = repos.chat.createThread('ws-1', 'p1')
      repos.chat.addMessage(toolOnly.id, 'tool', 'Accuracy reached 100%')

      expect(repos.chat.search('100%')).toEqual([
        expect.objectContaining({ threadId: thread.id, snippet: 'Accuracy reached 100%' })
      ])
      expect(repos.chat.search('   ')).toEqual([])
    })

    it('includes global chat results without a workspace name', () => {
      const thread = repos.chat.createThread(null, 'p1')
      repos.chat.updateTitle(thread.id, 'Global transformer notes')

      expect(repos.chat.search('transformer')).toEqual([
        expect.objectContaining({
          threadId: thread.id,
          workspaceId: null,
          workspaceName: null
        })
      ])
    })
  })

  describe('deleteThread', () => {
    it('removes the thread', () => {
      const thread = repos.chat.createThread('ws-1', 'p1')
      repos.chat.addMessage(thread.id, 'user', 'msg')
      repos.chat.deleteThread(thread.id)
      expect(repos.chat.getThread(thread.id)).toBeNull()
    })

    it('removes associated messages (cascade)', () => {
      const thread = repos.chat.createThread('ws-1', 'p1')
      repos.chat.addMessage(thread.id, 'user', 'msg1')
      repos.chat.addMessage(thread.id, 'assistant', 'msg2')
      repos.chat.deleteThread(thread.id)
      expect(repos.chat.listMessages(thread.id)).toEqual([])
    })

    it('throws RepoError not_found if thread does not exist', () => {
      expect(() => repos.chat.deleteThread('nonexistent')).toThrow(RepoError)
      try {
        repos.chat.deleteThread('nonexistent')
      } catch (e) {
        expect(e).toBeInstanceOf(RepoError)
        expect((e as RepoError).code).toBe('not_found')
      }
    })
  })
})
