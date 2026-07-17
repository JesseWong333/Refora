import type { WorkspaceAsset, WorkspaceFileSearchResult } from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'
import { RepoError } from './errors'

export type NewWorkspaceAsset = WorkspaceAsset

function mapWorkspaceAsset(row: Record<string, unknown>): WorkspaceAsset {
  return {
    id: row.id as string,
    workspaceId: row.workspaceId as string,
    fileName: row.fileName as string,
    filePath: row.filePath as string,
    sourcePath: row.sourcePath as string,
    mimeType: row.mimeType as string,
    previewKind: row.previewKind as WorkspaceAsset['previewKind'],
    fileSize: row.fileSize as number,
    fileHash: row.fileHash as string,
    fileMissing: row.fileMissing as number,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number
  }
}

export function createWorkspaceAssetsRepository(db: SqliteDb) {
  function list(workspaceId: string): WorkspaceAsset[] {
    const workspace = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId)
    if (!workspace) throw new RepoError('not_found', `workspace not found: ${workspaceId}`)
    const rows = db
      .prepare('SELECT * FROM workspace_assets WHERE workspaceId = ? ORDER BY createdAt, id')
      .all(workspaceId) as Record<string, unknown>[]
    return rows.map(mapWorkspaceAsset)
  }

  function get(id: string): WorkspaceAsset | null {
    const row = db.prepare('SELECT * FROM workspace_assets WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    return row ? mapWorkspaceAsset(row) : null
  }

  function search(q: string, limit = 10): WorkspaceFileSearchResult[] {
    const trimmed = q.trim()
    if (!trimmed) return []
    const escaped = trimmed.replace(/[%_\\]/g, '\\$&')
    const like = `%${escaped}%`
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)))
    const rows = db
      .prepare(
        `SELECT a.id, a.workspaceId, w.name AS workspaceName, a.fileName, a.mimeType,
                a.previewKind, a.fileMissing, a.updatedAt
         FROM workspace_assets a
         JOIN workspaces w ON w.id = a.workspaceId
         WHERE a.fileName LIKE ? ESCAPE '\\'
            OR a.sourcePath LIKE ? ESCAPE '\\'
            OR a.mimeType LIKE ? ESCAPE '\\'
         ORDER BY a.updatedAt DESC, a.id
         LIMIT ?`
      )
      .all(like, like, like, safeLimit) as Record<string, unknown>[]
    return rows.map((row) => ({
      id: row.id as string,
      workspaceId: row.workspaceId as string,
      workspaceName: row.workspaceName as string,
      fileName: row.fileName as string,
      mimeType: row.mimeType as string,
      previewKind: row.previewKind as WorkspaceAsset['previewKind'],
      fileMissing: row.fileMissing as number,
      updatedAt: row.updatedAt as number
    }))
  }

  function insert(asset: NewWorkspaceAsset): WorkspaceAsset {
    const workspace = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(asset.workspaceId)
    if (!workspace) throw new RepoError('not_found', `workspace not found: ${asset.workspaceId}`)
    db.prepare(
      `INSERT INTO workspace_assets
       (id, workspaceId, fileName, filePath, sourcePath, mimeType, previewKind, fileSize, fileHash, fileMissing, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      asset.id,
      asset.workspaceId,
      asset.fileName,
      asset.filePath,
      asset.sourcePath,
      asset.mimeType,
      asset.previewKind,
      asset.fileSize,
      asset.fileHash,
      asset.fileMissing,
      asset.createdAt,
      asset.updatedAt
    )
    return get(asset.id) as WorkspaceAsset
  }

  function setFileMissing(id: string, missing: boolean): void {
    const result = db
      .prepare('UPDATE workspace_assets SET fileMissing = ?, updatedAt = ? WHERE id = ?')
      .run(missing ? 1 : 0, Date.now(), id)
    if (result.changes === 0) throw new RepoError('not_found', `workspace asset not found: ${id}`)
  }

  function remove(id: string): void {
    const asset = get(id)
    if (!asset) throw new RepoError('not_found', `workspace asset not found: ${id}`)
    const result = db.prepare('DELETE FROM workspace_assets WHERE id = ?').run(id)
    if (result.changes === 0) throw new RepoError('not_found', `workspace asset not found: ${id}`)
    db.prepare('UPDATE workspaces SET updatedAt = ? WHERE id = ?').run(Date.now(), asset.workspaceId)
  }

  return { list, search, get, insert, setFileMissing, delete: remove }
}
