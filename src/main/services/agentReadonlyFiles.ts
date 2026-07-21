import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, statSync } from 'node:fs'
import { chmod, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Repositories } from '../db/repositories'
import type { SqliteDb } from '../db/types'
import type { AgentSandboxService } from './agentSandbox'
import { requireWorkspaceAssetFile } from './workspaceAssets'

export interface AgentReadonlyFile {
  id: string
  workspaceId: string | null
  fileName: string
  sourcePath: string
  mimeType: string
  size: number
  kind: 'document' | 'asset'
}

interface AgentReadonlyFilesDeps {
  repos: Repositories
  db: SqliteDb
  sandboxService: AgentSandboxService
}

interface AgentReadonlyFilesManifest {
  manifestPath: string
  files: AgentReadonlyFile[]
}

interface CachedManifest {
  revision: number
  value: AgentReadonlyFilesManifest
}

const REVISION_TABLE = 'refora_agent_readonly_revision'

function createRevisionReader(db: SqliteDb): () => number {
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS ${REVISION_TABLE} (value INTEGER NOT NULL);
    INSERT INTO ${REVISION_TABLE} (value)
    SELECT 0
    WHERE NOT EXISTS (SELECT 1 FROM ${REVISION_TABLE});
    CREATE TEMP TRIGGER IF NOT EXISTS refora_agent_documents_insert
    AFTER INSERT ON main.documents BEGIN
      UPDATE ${REVISION_TABLE} SET value = value + 1;
    END;
    CREATE TEMP TRIGGER IF NOT EXISTS refora_agent_documents_update
    AFTER UPDATE OF filePath, fileName, fileSize, fileMissing ON main.documents BEGIN
      UPDATE ${REVISION_TABLE} SET value = value + 1;
    END;
    CREATE TEMP TRIGGER IF NOT EXISTS refora_agent_documents_delete
    AFTER DELETE ON main.documents BEGIN
      UPDATE ${REVISION_TABLE} SET value = value + 1;
    END;
    CREATE TEMP TRIGGER IF NOT EXISTS refora_agent_workspace_assets_insert
    AFTER INSERT ON main.workspace_assets BEGIN
      UPDATE ${REVISION_TABLE} SET value = value + 1;
    END;
    CREATE TEMP TRIGGER IF NOT EXISTS refora_agent_workspace_assets_update
    AFTER UPDATE OF workspaceId, fileName, filePath, mimeType, fileSize, fileMissing ON main.workspace_assets BEGIN
      UPDATE ${REVISION_TABLE} SET value = value + 1;
    END;
    CREATE TEMP TRIGGER IF NOT EXISTS refora_agent_workspace_assets_delete
    AFTER DELETE ON main.workspace_assets BEGIN
      UPDATE ${REVISION_TABLE} SET value = value + 1;
    END;
  `)
  const statement = db.prepare(`SELECT value FROM ${REVISION_TABLE}`)
  return () => {
    const row = statement.get() as { value?: number } | undefined
    return row?.value ?? 0
  }
}

function regularFile(path: string): boolean {
  try {
    return existsSync(path) && !lstatSync(path).isSymbolicLink() && statSync(path).isFile()
  } catch {
    return false
  }
}

export function createAgentReadonlyFilesService(deps: AgentReadonlyFilesDeps) {
  const readRevision = createRevisionReader(deps.db)
  let activeWrite: Promise<AgentReadonlyFilesManifest> | null = null
  let cachedManifest: CachedManifest | null = null

  function list(): AgentReadonlyFile[] {
    const documents = deps.repos.documents
      .list({ mode: 'all' })
      .filter((document) => regularFile(document.filePath))
      .map((document) => ({
        id: document.id,
        workspaceId: null,
        fileName: document.fileName,
        sourcePath: document.filePath,
        mimeType: 'application/pdf',
        size: document.fileSize ?? statSync(document.filePath).size,
        kind: 'document' as const
      }))
    const assets: AgentReadonlyFile[] = []
    for (const workspace of deps.repos.workspaces.list()) {
      for (const asset of deps.repos.workspaceAssets.list(workspace.id)) {
        try {
          const resolved = requireWorkspaceAssetFile(deps.repos, asset.id)
          assets.push({
            id: asset.id,
            workspaceId: asset.workspaceId,
            fileName: asset.fileName,
            sourcePath: resolved.filePath,
            mimeType: asset.mimeType,
            size: asset.fileSize,
            kind: 'asset'
          })
        } catch {
          continue
        }
      }
    }
    return [...documents, ...assets]
  }

  async function createManifest(): Promise<AgentReadonlyFilesManifest> {
    const shared = await deps.sandboxService.ensureShared()
    const files = list()
    const manifestPath = join(shared.sharedRoot, 'readonly-files.json')
    const temporary = `${manifestPath}.tmp-${randomUUID()}`
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, files }, null, 2), {
        encoding: 'utf8',
        mode: 0o600
      })
      await chmod(temporary, 0o400)
      await rename(temporary, manifestPath)
      return { manifestPath, files }
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  function writeManifest(): Promise<AgentReadonlyFilesManifest> {
    const revision = readRevision()
    if (cachedManifest?.revision === revision && existsSync(cachedManifest.value.manifestPath)) {
      return Promise.resolve(cachedManifest.value)
    }
    if (activeWrite) {
      return activeWrite.then(() => writeManifest())
    }
    activeWrite = createManifest().then((value) => {
      if (readRevision() === revision) cachedManifest = { revision, value }
      return value
    }).finally(() => {
      activeWrite = null
    })
    return activeWrite
  }

  return { list, writeManifest }
}

export type AgentReadonlyFilesService = ReturnType<typeof createAgentReadonlyFilesService>
