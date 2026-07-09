import { randomUUID } from 'node:crypto'
import type { AiReport } from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'
import { RepoError } from './errors'

function mapReport(row: Record<string, unknown>): AiReport {
  let sourceDocIds: string[] = []
  const raw = row.sourceDocIds
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) sourceDocIds = parsed.filter((v) => typeof v === 'string')
    } catch {
      sourceDocIds = []
    }
  }
  return {
    id: row.id as string,
    workspaceId: row.workspaceId as string,
    title: row.title as string,
    contentMd: row.contentMd as string,
    sourceDocIds,
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
    const id = randomUUID()
    const now = Date.now()
    db.prepare(
      `INSERT INTO ai_reports (id, workspaceId, title, contentMd, sourceDocIds, model, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.workspaceId, input.title, input.contentMd, JSON.stringify(input.sourceDocIds), input.model, now)
    const row = db.prepare('SELECT * FROM ai_reports WHERE id = ?').get(id) as Record<
      string,
      unknown
    >
    return mapReport(row)
  }

  function remove(id: string): void {
    const result = db.prepare('DELETE FROM ai_reports WHERE id = ?').run(id)
    if (result.changes === 0) throw new RepoError('not_found', `report not found: ${id}`)
  }

  return { list, create, delete: remove }
}
