import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRepositories } from '../../src/main/db/repositories'
import {
  ensureWorkspaceMemoryFiles,
  MAX_WORKSPACE_MEMORY_FILE_CHARS,
  readReforaWorkspaceMemories,
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

  it('passes only curated Markdown files to the Python memory backend', () => {
    updateWorkspaceMemory(repos, {
      workspaceId,
      path: '/brief.md',
      content: 'Line one\nLine two'
    })
    expect(readReforaWorkspaceMemories(repos, workspaceId)).toEqual({
      '/brief.md': 'Line one\nLine two',
      '/decisions.md': '',
      '/glossary.md': '',
      '/preferences.md': '',
      '/research.md': ''
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

  it('keeps research memory scoped to a Workspace', () => {
    ensureWorkspaceMemoryFiles(repos, null)

    expect(repos.agentMemories.get('global', 'global', '/research.md')).toBeNull()
    expect(() => updateWorkspaceMemory(repos, {
      workspaceId: null,
      path: '/research.md',
      content: 'Exploration'
    })).toThrow('Research memory requires a Workspace')

    const updated = updateWorkspaceMemory(repos, {
      workspaceId,
      path: '/research.md',
      content: 'Objective, findings, uncertainties, and next steps.'
    })
    expect(updated.content).toBe('Objective, findings, uncertainties, and next steps.')
  })
})
