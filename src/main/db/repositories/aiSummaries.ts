import type { AiSummary, AiSummaryContent } from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'

function parseSummaryContent(raw: unknown): AiSummaryContent | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as AiSummaryContent
    return null
  } catch {
    return null
  }
}

function mapSummary(row: Record<string, unknown>): AiSummary {
  return {
    docId: row.docId as string,
    model: (row.model as string | null) ?? null,
    content: parseSummaryContent(row.summaryJson),
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number
  }
}

export function createAiSummariesRepository(db: SqliteDb) {
  function getSummary(docId: string): AiSummary | null {
    const row = db.prepare('SELECT * FROM ai_summaries WHERE docId = ?').get(docId) as
      | Record<string, unknown>
      | undefined
    return row ? mapSummary(row) : null
  }

  function setSummary(docId: string, model: string, content: AiSummaryContent): void {
    const now = Date.now()
    const summaryJson = JSON.stringify(content)
    db.prepare(
      `INSERT INTO ai_summaries (docId, model, summaryJson, fullText, createdAt, updatedAt)
       VALUES (?, ?, ?, NULL, ?, ?)
       ON CONFLICT(docId) DO UPDATE SET
         model = excluded.model,
         summaryJson = excluded.summaryJson,
         updatedAt = excluded.updatedAt`
    ).run(docId, model, summaryJson, now, now)
  }

  function getFullText(docId: string): { text: string; hash: string | null } | null {
    const row = db
      .prepare('SELECT fullText, fullTextHash FROM ai_summaries WHERE docId = ?')
      .get(docId) as { fullText: string | null; fullTextHash: string | null } | undefined
    if (!row || row.fullText === null) return null
    return { text: row.fullText, hash: row.fullTextHash ?? null }
  }

  function setFullText(docId: string, text: string, hash: string | null): void {
    const now = Date.now()
    db.prepare(
      `INSERT INTO ai_summaries (docId, model, summaryJson, fullText, fullTextHash, createdAt, updatedAt)
       VALUES (?, NULL, NULL, ?, ?, ?, ?)
       ON CONFLICT(docId) DO UPDATE SET
         fullText = excluded.fullText,
         fullTextHash = excluded.fullTextHash,
         updatedAt = excluded.updatedAt`
    ).run(docId, text, hash, now, now)
  }

  function remove(docId: string): void {
    db.prepare('DELETE FROM ai_summaries WHERE docId = ?').run(docId)
  }

  return { getSummary, setSummary, getFullText, setFullText, delete: remove }
}
