import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRepositories } from '../../src/main/db/repositories'
import { createAgentReadonlyFilesService } from '../../src/main/services/agentReadonlyFiles'
import { createAgentSandboxService } from '../../src/main/services/agentSandbox'
import { createMainTestDb, makeNewDocument, migrateMainTestDb, type MainTestDb } from '../helpers/mainDb'

describe('agent readonly files service', () => {
  let db: MainTestDb
  const directories: string[] = []

  afterEach(async () => {
    db.close()
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('reuses the manifest until documents or WorkspaceAssets change', async () => {
    const library = mkdtempSync(join(tmpdir(), 'refora-agent-readonly-'))
    directories.push(library)
    db = createMainTestDb()
    const sqlite = migrateMainTestDb(db)
    const repos = createRepositories(sqlite)
    repos.settings.set('libraryFolderPath', library)
    const documentPath = join(library, 'paper.pdf')
    writeFileSync(documentPath, 'pdf')
    repos.documents.insert(makeNewDocument('document-1', {
      filePath: documentPath,
      originalFolderPath: library,
      fileName: 'paper.pdf',
      fileSize: 3
    }))
    const workspace = repos.workspaces.create('Research')
    const sandboxService = createAgentSandboxService({ repos, dbPath: join(library, 'refora.db') })
    const documentList = vi.spyOn(repos.documents, 'list')
    const workspaceList = vi.spyOn(repos.workspaces, 'list')
    const service = createAgentReadonlyFilesService({ repos, db: sqlite, sandboxService })

    const initial = await service.writeManifest()
    const cached = await service.writeManifest()
    repos.documents.update('document-1', { title: 'Updated title' })
    repos.settings.set('language', 'en')
    const afterUnrelatedChange = await service.writeManifest()

    expect(initial.files.map((file) => file.id)).toEqual(['document-1'])
    expect(cached).toBe(initial)
    expect(afterUnrelatedChange).toBe(initial)
    expect(documentList).toHaveBeenCalledOnce()
    expect(workspaceList).toHaveBeenCalledOnce()

    const assetId = 'asset-1'
    const assetDirectory = join(library, 'refora-assets', assetId)
    const assetPath = join(assetDirectory, 'result.csv')
    mkdirSync(assetDirectory, { recursive: true })
    writeFileSync(assetPath, 'a,b\n1,2\n')
    repos.workspaceAssets.insert({
      id: assetId,
      workspaceId: workspace.id,
      fileName: 'result.csv',
      filePath: `refora-assets/${assetId}/result.csv`,
      sourcePath: assetPath,
      mimeType: 'text/csv',
      previewKind: 'text',
      fileSize: 8,
      fileHash: 'hash',
      fileMissing: 0,
      createdAt: 1000,
      updatedAt: 1000
    })

    const refreshed = await service.writeManifest()

    expect(refreshed).not.toBe(initial)
    expect(refreshed.files.map((file) => file.id)).toEqual(['document-1', assetId])
    expect(documentList).toHaveBeenCalledTimes(2)
    expect(workspaceList).toHaveBeenCalledTimes(2)
  })
})
