import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { runMigrations } from '../../src/main/db/migrations'
import { seedDefaultSettings } from '../../src/main/db/settings-seed'
import { createRepositories } from '../../src/main/db/repositories'
import type { AiSummaryContent } from '../../src/shared/ipc-types'

const nodeRequire = createRequire(import.meta.url)
const { DatabaseSync } = nodeRequire('node:sqlite')

function createTestDb() {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = OFF')
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
})

describe('AiSummariesRepository', () => {
  describe('getSummary', () => {
    it('returns null when no record exists', () => {
      expect(repos.aiSummaries.getSummary('doc-1')).toBeNull()
    })

    it('returns summary with parsed content when record exists', () => {
      const content: AiSummaryContent = { core: 'Test core', keyPoints: ['a', 'b'] }
      repos.aiSummaries.setSummary('doc-1', 'gpt-4o', content)
      const summary = repos.aiSummaries.getSummary('doc-1')
      expect(summary).not.toBeNull()
      expect(summary!.docId).toBe('doc-1')
      expect(summary!.model).toBe('gpt-4o')
      expect(summary!.content).toEqual(content)
      expect(summary!.createdAt).toBeTypeOf('number')
      expect(summary!.updatedAt).toBeTypeOf('number')
    })

    it('returns null for content when summaryJson is malformed JSON', () => {
      db.prepare(
        'INSERT INTO ai_summaries (docId, model, summaryJson, fullText, createdAt, updatedAt) VALUES (?, ?, ?, NULL, ?, ?)'
      ).run('doc-x', 'gpt-4o', 'not-json', Date.now(), Date.now())
      const summary = repos.aiSummaries.getSummary('doc-x')
      expect(summary).not.toBeNull()
      expect(summary!.content).toBeNull()
    })
  })

  describe('setSummary', () => {
    it('inserts a new record', () => {
      const content: AiSummaryContent = { core: 'Core', keyPoints: [] }
      repos.aiSummaries.setSummary('doc-1', 'gpt-4o', content)
      const summary = repos.aiSummaries.getSummary('doc-1')
      expect(summary!.content).toEqual(content)
      expect(summary!.model).toBe('gpt-4o')
    })

    it('updates existing record (upsert) - model and content change, createdAt stays', () => {
      const content1: AiSummaryContent = { core: 'V1', keyPoints: ['x'] }
      repos.aiSummaries.setSummary('doc-1', 'gpt-4o', content1)
      const original = repos.aiSummaries.getSummary('doc-1')!

      const content2: AiSummaryContent = { core: 'V2', keyPoints: ['y', 'z'] }
      repos.aiSummaries.setSummary('doc-1', 'claude-3', content2)
      const updated = repos.aiSummaries.getSummary('doc-1')!

      expect(updated.model).toBe('claude-3')
      expect(updated.content).toEqual(content2)
      expect(updated.createdAt).toBe(original.createdAt)
      expect(updated.updatedAt).toBeGreaterThanOrEqual(original.updatedAt)
    })
  })

  describe('getFullText', () => {
    it('returns null when no record exists', () => {
      expect(repos.aiSummaries.getFullText('doc-1')).toBeNull()
    })

    it('returns null when record exists but no fullText', () => {
      repos.aiSummaries.setSummary('doc-1', 'gpt-4o', { core: 'C', keyPoints: [] })
      expect(repos.aiSummaries.getFullText('doc-1')).toBeNull()
    })

    it('returns text and hash when fullText is set', () => {
      repos.aiSummaries.setFullText('doc-1', 'some text', 'hash123')
      const result = repos.aiSummaries.getFullText('doc-1')
      expect(result).toEqual({ text: 'some text', hash: 'hash123' })
    })

    it('returns null hash when hash is null', () => {
      repos.aiSummaries.setFullText('doc-1', 'some text', null)
      const result = repos.aiSummaries.getFullText('doc-1')
      expect(result).toEqual({ text: 'some text', hash: null })
    })
  })

  describe('setFullText', () => {
    it('inserts new record with fullText', () => {
      repos.aiSummaries.setFullText('doc-1', 'full text content', 'h1')
      const result = repos.aiSummaries.getFullText('doc-1')
      expect(result!.text).toBe('full text content')
      expect(result!.hash).toBe('h1')
    })

    it('updates existing fullText record', () => {
      repos.aiSummaries.setFullText('doc-1', 'v1', 'h1')
      repos.aiSummaries.setFullText('doc-1', 'v2', 'h2')
      const result = repos.aiSummaries.getFullText('doc-1')
      expect(result!.text).toBe('v2')
      expect(result!.hash).toBe('h2')
    })
  })

  describe('coexistence of summary and fullText', () => {
    it('setSummary after setFullText does not overwrite fullText', () => {
      repos.aiSummaries.setFullText('doc-1', 'full text', 'hash1')
      repos.aiSummaries.setSummary('doc-1', 'gpt-4o', { core: 'C', keyPoints: [] })

      expect(repos.aiSummaries.getFullText('doc-1')!.text).toBe('full text')
      expect(repos.aiSummaries.getSummary('doc-1')!.content).toEqual({ core: 'C', keyPoints: [] })
    })

    it('setFullText after setSummary does not overwrite summary', () => {
      repos.aiSummaries.setSummary('doc-1', 'gpt-4o', { core: 'C', keyPoints: ['a'] })
      repos.aiSummaries.setFullText('doc-1', 'full text', 'hash1')

      expect(repos.aiSummaries.getSummary('doc-1')!.content).toEqual({ core: 'C', keyPoints: ['a'] })
      expect(repos.aiSummaries.getSummary('doc-1')!.model).toBe('gpt-4o')
      expect(repos.aiSummaries.getFullText('doc-1')!.text).toBe('full text')
    })
  })

  describe('delete', () => {
    it('removes the record', () => {
      repos.aiSummaries.setSummary('doc-1', 'gpt-4o', { core: 'C', keyPoints: [] })
      expect(repos.aiSummaries.getSummary('doc-1')).not.toBeNull()
      repos.aiSummaries.delete('doc-1')
      expect(repos.aiSummaries.getSummary('doc-1')).toBeNull()
    })

    it('does not throw when record does not exist', () => {
      expect(() => repos.aiSummaries.delete('nonexistent')).not.toThrow()
    })
  })
})
