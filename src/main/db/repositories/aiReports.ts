import { randomUUID } from 'node:crypto'
import type { AiReport } from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'
import { RepoError } from './errors'

function parseSourceDocIds(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === 'string')
  } catch {
    // fall through
  }
  return []
}

function mapReport(row: Record<string, unknown>): AiReport {
  return {
    id: row.id as string,
    workspaceId: row.workspaceId as string,
    title: row.title as string,
    contentMd: row.contentMd as string,
    sourceDocIds: parseSourceDocIds(row.sourceDocIds),
    model: (row.model as string | null) ?? null,
    createdAt: row.createdAt as number
  }
}

export interface AiReportCreateInput {
  workspaceId: string
  title: string
  contentMd: string
  sourceDocIds: string[]
  model: string | null
}

export function createAiReportsRepository(db: SqliteDb) {
  function list(workspaceId: string): AiReport[] {
    const rows = db
      .prepare('SELECT * FROM ai_reports WHERE workspaceId = ? ORDER BY createdAt DESC')
      .all(workspaceId) as Record<string, unknown>[]
    return rows.map(mapReport)
  }

  function create(input: AiReportCreateInput): AiReport {
    const title = input.title.trim()
    if (!title) throw new RepoError('invalid_title', 'report title cannot be empty')
    const workspace = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(input.workspaceId)
    if (!workspace) throw new RepoError('not_found', `workspace not found: ${input.workspaceId}`)
    const id = randomUUID()
    const now = Date.now()
    db.prepare(
      `INSERT INTO ai_reports (id, workspaceId, title, contentMd, sourceDocIds, model, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.workspaceId, title, input.contentMd, JSON.stringify(input.sourceDocIds), input.model, now)
    db.prepare('UPDATE workspaces SET updatedAt = ? WHERE id = ?').run(now, input.workspaceId)
    const row = db.prepare('SELECT * FROM ai_reports WHERE id = ?').get(id) as Record<
      string,
      unknown
    >
    return mapReport(row)
  }

  function update(id: string, patch: { title?: string; contentMd?: string }): AiReport {
    const existing = db.prepare('SELECT * FROM ai_reports WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!existing) throw new RepoError('not_found', `report not found: ${id}`)
    const title = patch.title !== undefined ? patch.title.trim() : (existing.title as string)
    if (!title) throw new RepoError('invalid_title', 'report title cannot be empty')
    const contentMd = patch.contentMd !== undefined ? patch.contentMd : (existing.contentMd as string)
    db.prepare('UPDATE ai_reports SET title = ?, contentMd = ? WHERE id = ?').run(title, contentMd, id)
    db.prepare('UPDATE workspaces SET updatedAt = ? WHERE id = ?').run(Date.now(), existing.workspaceId)
    const row = db.prepare('SELECT * FROM ai_reports WHERE id = ?').get(id) as Record<string, unknown>
    return mapReport(row)
  }

  function remove(id: string): void {
    const existing = db.prepare('SELECT workspaceId FROM ai_reports WHERE id = ?').get(id) as
      | { workspaceId: string }
      | undefined
    if (!existing) throw new RepoError('not_found', `report not found: ${id}`)
    const result = db.prepare('DELETE FROM ai_reports WHERE id = ?').run(id)
    if (result.changes === 0) throw new RepoError('not_found', `report not found: ${id}`)
    db.prepare('UPDATE workspaces SET updatedAt = ? WHERE id = ?').run(Date.now(), existing.workspaceId)
  }

  function removeDocFromSources(docId: string): void {
    const pattern = `%"${docId}"%`
    const rows = db
      .prepare('SELECT id, sourceDocIds FROM ai_reports WHERE sourceDocIds LIKE ?')
      .all(pattern) as Array<{ id: string; sourceDocIds: string }>
    for (const row of rows) {
      const ids = parseSourceDocIds(row.sourceDocIds)
      if (!ids.includes(docId)) continue
      const updated = ids.filter((id) => id !== docId)
      db.prepare('UPDATE ai_reports SET sourceDocIds = ? WHERE id = ?').run(
        JSON.stringify(updated),
        row.id
      )
    }
  }

  return { list, create, update, delete: remove, removeDocFromSources }
}
