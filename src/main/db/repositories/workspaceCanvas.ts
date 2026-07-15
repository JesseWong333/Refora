import {
  WORKSPACE_CANVAS_DEFAULT_ZOOM,
  WORKSPACE_CANVAS_MAX_ZOOM,
  WORKSPACE_CANVAS_MIN_ZOOM,
  type WorkspaceCanvasViewport
} from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'
import { RepoError } from './errors'

function validateViewport(viewport: WorkspaceCanvasViewport): void {
  if (
    !Number.isFinite(viewport.panX) ||
    !Number.isFinite(viewport.panY) ||
    !Number.isFinite(viewport.zoom) ||
    viewport.zoom < WORKSPACE_CANVAS_MIN_ZOOM ||
    viewport.zoom > WORKSPACE_CANVAS_MAX_ZOOM
  ) {
    throw new RepoError('invalid_viewport', 'workspace canvas viewport is out of bounds')
  }
}

export function createWorkspaceCanvasRepository(db: SqliteDb) {
  function ensureWorkspace(workspaceId: string): void {
    const workspace = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId)
    if (!workspace) throw new RepoError('not_found', `workspace not found: ${workspaceId}`)
  }

  function get(workspaceId: string): WorkspaceCanvasViewport {
    ensureWorkspace(workspaceId)
    const row = db
      .prepare('SELECT panX, panY, zoom FROM workspace_canvas_state WHERE workspaceId = ?')
      .get(workspaceId) as WorkspaceCanvasViewport | undefined
    return row ?? { panX: 0, panY: 0, zoom: WORKSPACE_CANVAS_DEFAULT_ZOOM }
  }

  function update(workspaceId: string, viewport: WorkspaceCanvasViewport): WorkspaceCanvasViewport {
    ensureWorkspace(workspaceId)
    validateViewport(viewport)
    db.prepare(
      `INSERT INTO workspace_canvas_state (workspaceId, panX, panY, zoom, updatedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(workspaceId) DO UPDATE SET
         panX = excluded.panX,
         panY = excluded.panY,
         zoom = excluded.zoom,
         updatedAt = excluded.updatedAt`
    ).run(workspaceId, viewport.panX, viewport.panY, viewport.zoom, Date.now())
    db.prepare('UPDATE workspaces SET updatedAt = ? WHERE id = ?').run(Date.now(), workspaceId)
    return get(workspaceId)
  }

  return { get, update }
}
