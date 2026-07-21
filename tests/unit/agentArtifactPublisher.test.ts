import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRepositories } from '../../src/main/db/repositories'
import { createAgentArtifactPublisher } from '../../src/main/services/agentArtifactPublisher'
import { createAgentSandboxService } from '../../src/main/services/agentSandbox'
import { createMainTestDb, migrateMainTestDb, type MainTestDb } from '../helpers/mainDb'

describe('agent artifact publisher', () => {
  let db: MainTestDb
  const directories: string[] = []

  afterEach(async () => {
    db.close()
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('publishes a regular sandbox file as a managed WorkspaceAsset', async () => {
    const library = mkdtempSync(join(tmpdir(), 'refora-agent-publish-'))
    directories.push(library)
    db = createMainTestDb()
    const repos = createRepositories(migrateMainTestDb(db))
    repos.settings.set('libraryFolderPath', library)
    const workspace = repos.workspaces.create('Research')
    const sandboxService = createAgentSandboxService({ repos, dbPath: join(library, 'refora.db') })
    const paths = await sandboxService.ensure(workspace.id)
    writeFileSync(join(paths.outputsRoot, 'result.csv'), 'a,b\n1,2\n')
    const publisher = createAgentArtifactPublisher({ repos, sandboxService, win: () => null })

    const result = await publisher.publish(workspace.id, ['outputs/result.csv'])

    expect(result.errors).toEqual([])
    expect(result.published).toEqual([
      expect.objectContaining({ path: 'outputs/result.csv', fileName: 'result.csv' })
    ])
    const asset = repos.workspaceAssets.list(workspace.id)[0]
    expect(asset.filePath).toMatch(/^refora-assets\//)
    expect(existsSync(join(library, asset.filePath))).toBe(true)
    expect(repos.workspaceItems.list(workspace.id)[0]).toMatchObject({ kind: 'asset', assetId: asset.id })
  })

  it('leaves artifacts pending when no workspace is selected', async () => {
    const library = mkdtempSync(join(tmpdir(), 'refora-agent-publish-'))
    directories.push(library)
    db = createMainTestDb()
    const repos = createRepositories(migrateMainTestDb(db))
    repos.settings.set('libraryFolderPath', library)
    const sandboxService = createAgentSandboxService({ repos, dbPath: join(library, 'refora.db') })
    const publisher = createAgentArtifactPublisher({ repos, sandboxService, win: () => null })

    const result = await publisher.publish(null, ['outputs/result.csv'])

    expect(result.published).toEqual([])
    expect(result.errors[0].message).toContain('default sandbox')
  })

  it('does not publish intermediate files outside outputs', async () => {
    const library = mkdtempSync(join(tmpdir(), 'refora-agent-publish-'))
    directories.push(library)
    db = createMainTestDb()
    const repos = createRepositories(migrateMainTestDb(db))
    repos.settings.set('libraryFolderPath', library)
    const workspace = repos.workspaces.create('Research')
    const sandboxService = createAgentSandboxService({ repos, dbPath: join(library, 'refora.db') })
    const paths = await sandboxService.ensure(workspace.id)
    writeFileSync(join(paths.scriptsRoot, 'analysis.py'), 'print(1)')
    const publisher = createAgentArtifactPublisher({ repos, sandboxService, win: () => null })

    const result = await publisher.publish(workspace.id, ['scripts/analysis.py'])

    expect(result.published).toEqual([])
    expect(result.errors[0].message).toContain('outputs directory')
  })
})
