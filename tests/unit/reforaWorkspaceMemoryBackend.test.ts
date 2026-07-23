import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRepositories } from '../../src/main/db/repositories'
import {
  createReforaWorkspaceMemoryBackend,
  ensureWorkspaceMemoryFiles,
  MAX_WORKSPACE_MEMORY_FILE_CHARS,
  updateWorkspaceMemory
} from '../../src/main/services/reforaWorkspaceMemoryBackend'
import {
  createMainTestDb,
  migrateMainTestDb,
  type MainTestDb
} from '../helpers/mainDb'

describe('Refora Workspace memory backend', () => {
  let db: MainTestDb
  let repos: ReturnType<typeof createRepositories>
  let workspaceId: string

  beforeEach(() => {
    db = createMainTestDb()
    repos = createRepositories(migrateMainTestDb(db))
    workspaceId = repos.workspaces.create('Research').id
    ensureWorkspaceMemoryFiles(repos, workspaceId)
  })

  afterEach(() => {
    db.close()
  })

  it('exposes only the four curated Markdown files as read-only data', async () => {
    updateWorkspaceMemory(repos, {
      workspaceId,
      path: '/brief.md',
      content: 'Line one\nLine two'
    })
    const backend = createReforaWorkspaceMemoryBackend(repos, workspaceId)

    const listing = await backend.ls('/')
    expect('files' in listing ? listing.files.map((entry) => entry.path) : [])
      .toEqual(['/brief.md', '/decisions.md', '/glossary.md', '/preferences.md'])
    expect(await backend.read('/brief.md')).toMatchObject({
      content: '1: Line one\n2: Line two',
      mimeType: 'text/markdown'
    })
    expect(await backend.write('/brief.md', 'unapproved')).toMatchObject({
      error: expect.stringContaining('read-only')
    })
    expect(await backend.read('/outside.md')).toMatchObject({
      error: expect.stringContaining('not found')
    })
  })

  it('rejects unsupported paths and oversized updates before persistence', () => {
    expect(() => updateWorkspaceMemory(repos, {
      workspaceId,
      path: '/custom.md',
      content: 'no'
    })).toThrow('Unsupported workspace memory path')
    expect(() => updateWorkspaceMemory(repos, {
      workspaceId,
      path: '/brief.md',
      content: 'x'.repeat(MAX_WORKSPACE_MEMORY_FILE_CHARS + 1)
    })).toThrow('Workspace memory file is too large')
    expect(repos.agentMemories.get('workspace', workspaceId, '/brief.md')?.content).toBe('')
  })
})
