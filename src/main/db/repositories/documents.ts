import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type {
  Document,
  DocumentPatch,
  EditableField,
  ListFilter,
  ListMode,
  MetadataSource,
  MetadataStatus,
  RemoteValues,
  SearchResult,
  SortField
} from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'
import { RepoError } from './errors'
import { toLibraryRelative, resolveFromLibrary } from '../../services/paths'

export type NewDocument = Omit<Document, 'categories'>

export interface DocumentsRepoDeps {
  getLibraryFolder: () => string
}

const EDITABLE_FIELDS: readonly EditableField[] = [
  'title',
  'authors',
  'year',
  'venue',
  'volume',
  'issue',
  'pages',
  'abstract',
  'keywords',
  'url',
  'doi',
  'note'
]

const COLUMN_FOR: Record<EditableField, string> = {
  title: 'title',
  authors: 'authors',
  year: 'year',
  venue: 'venue',
  volume: 'volume',
  issue: 'issue',
  pages: 'pages',
  abstract: 'abstract',
  keywords: 'keywords',
  url: 'url',
  doi: 'doi',
  note: 'note'
}

const FTS_LIKE_COLUMNS = [
  'title',
  'authors',
  'venue',
  'year',
  'keywords',
  'abstract',
  'url',
  'note',
  'fileName'
] as const

const DOCUMENT_COLUMNS = [
  'id',
  'filePath',
  'originalFolderPath',
  'fileName',
  'fileSize',
  'fileHash',
  'title',
  'authors',
  'year',
  'venue',
  'volume',
  'issue',
  'pages',
  'abstract',
  'keywords',
  'url',
  'doi',
  'note',
  'starred',
  'addedAt',
  'lastReadAt',
  'updatedAt',
  'metadataSource',
  'metadataStatus',
  'metadataAttempts',
  'editedFields',
  'remoteValues',
  'fileMissing'
] as const

function isEditableField(key: string): key is EditableField {
  return (EDITABLE_FIELDS as readonly string[]).includes(key)
}

export function validatePatch(patch: DocumentPatch): EditableField[] {
  const rawKeys = Object.keys(patch)
  for (const key of rawKeys) {
    if (!isEditableField(key)) {
      throw new RepoError('forbidden_field', `field "${key}" is not editable`, key)
    }
  }
  return rawKeys as EditableField[]
}

function parseEditedFields(raw: unknown): EditableField[] {
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is EditableField => typeof v === 'string' && isEditableField(v))
  } catch {
    return []
  }
}

function parseRemoteValues(raw: unknown): RemoteValues | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as RemoteValues
    return null
  } catch {
    return null
  }
}

function safeInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v
  if (typeof v === 'bigint') return Number(v)
  return null
}

function mapDocument(row: Record<string, unknown>, libraryFolder: string): Document {
  const rawFilePath = row.filePath as string
  const rawOriginalFolderPath = row.originalFolderPath as string
  return {
    id: row.id as string,
    filePath: resolveFromLibrary(rawFilePath, libraryFolder),
    originalFolderPath: rawOriginalFolderPath && isAbsolute(rawOriginalFolderPath)
      ? rawOriginalFolderPath
      : resolveFromLibrary(rawOriginalFolderPath, libraryFolder),
    fileName: row.fileName as string,
    fileSize: safeInt(row.fileSize),
    fileHash: (row.fileHash as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    authors: (row.authors as string | null) ?? null,
    year: (row.year as string | null) ?? null,
    venue: (row.venue as string | null) ?? null,
    volume: (row.volume as string | null) ?? null,
    issue: (row.issue as string | null) ?? null,
    pages: (row.pages as string | null) ?? null,
    abstract: (row.abstract as string | null) ?? null,
    keywords: (row.keywords as string | null) ?? null,
    url: (row.url as string | null) ?? null,
    doi: (row.doi as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    starred: row.starred as number,
    addedAt: row.addedAt as number,
    lastReadAt: (row.lastReadAt as number | null) ?? null,
    updatedAt: row.updatedAt as number,
    metadataSource: (row.metadataSource as MetadataSource | null) ?? null,
    metadataStatus: row.metadataStatus as MetadataStatus,
    metadataAttempts: row.metadataAttempts as number,
    editedFields: parseEditedFields(row.editedFields),
    remoteValues: parseRemoteValues(row.remoteValues),
    fileMissing: row.fileMissing as number
  }
}

function orderByClause(mode: ListMode, sort?: { field: SortField; dir: 'asc' | 'desc' }): string {
  if (sort) return `ORDER BY ${sort.field} ${sort.dir}`
  if (mode === 'recentlyRead') return 'ORDER BY lastReadAt DESC'
  return 'ORDER BY addedAt DESC'
}

export function createDocumentsRepository(db: SqliteDb, deps: DocumentsRepoDeps) {
  const lib = () => deps.getLibraryFolder()

  function list(filter: ListFilter): Document[] {
    let where = ''
    const params: unknown[] = []
    if (filter.mode === 'recentlyRead') {
      where = 'WHERE lastReadAt IS NOT NULL'
    } else if (filter.mode === 'starred') {
      where = 'WHERE starred = 1'
    } else if (filter.mode === 'category') {
      where = 'WHERE id IN (SELECT documentId FROM document_categories WHERE categoryId = ?)'
      params.push(filter.categoryId)
    }
    const order = orderByClause(filter.mode, filter.sort)
    const rows = db.prepare(`SELECT * FROM documents ${where} ${order}`).all(...params) as Record<
      string,
      unknown
    >[]
    return rows.map((r) => mapDocument(r, lib()))
  }

  function search(q: string): SearchResult {
    const trimmed = q.trim()
    if (trimmed.length === 0) return []
    if (trimmed.length >= 3) {
      const rows = db
        .prepare(
          'SELECT d.* FROM documents d JOIN docs_fts f ON d.rowid = f.rowid WHERE docs_fts MATCH ? ORDER BY rank LIMIT 500'
        )
        .all(trimmed) as Record<string, unknown>[]
      return rows.map((r) => mapDocument(r, lib()))
    }
    const escaped = trimmed.replace(/[%_\\]/g, '\\$&')
    const like = `%${escaped}%`
    const clauses = FTS_LIKE_COLUMNS.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')
    const params = FTS_LIKE_COLUMNS.map(() => like)
    const rows = db.prepare(`SELECT * FROM documents WHERE ${clauses} LIMIT 500`).all(...params) as Record<
      string,
      unknown
    >[]
    return rows.map((r) => mapDocument(r, lib()))
  }

  function get(id: string): Document | null {
    const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    return row ? mapDocument(row, lib()) : null
  }

  function insert(doc: NewDocument): Document {
    const lf = lib()
    const values: unknown[] = [
      doc.id,
      toLibraryRelative(doc.filePath, lf),
      doc.originalFolderPath,
      doc.fileName,
      doc.fileSize,
      doc.fileHash,
      doc.title,
      doc.authors,
      doc.year,
      doc.venue,
      doc.volume,
      doc.issue,
      doc.pages,
      doc.abstract,
      doc.keywords,
      doc.url,
      doc.doi,
      doc.note,
      doc.starred,
      doc.addedAt,
      doc.lastReadAt,
      doc.updatedAt,
      doc.metadataSource,
      doc.metadataStatus,
      doc.metadataAttempts,
      JSON.stringify(doc.editedFields),
      doc.remoteValues === null ? null : JSON.stringify(doc.remoteValues),
      doc.fileMissing
    ]
    const placeholders = DOCUMENT_COLUMNS.map(() => '?').join(', ')
    const colList = DOCUMENT_COLUMNS.join(', ')
    db.prepare(`INSERT INTO documents (${colList}) VALUES (${placeholders})`).run(...values)
    return get(doc.id) as Document
  }

  function update(id: string, patch: DocumentPatch): Document {
    const keys = validatePatch(patch)
    const current = get(id)
    if (!current) throw new RepoError('not_found', `document not found: ${id}`)

    if (keys.length === 0) return current

    let edited = [...current.editedFields]
    for (const key of keys) {
      const value = patch[key]
      if (value === '') {
        edited = edited.filter((f) => f !== key)
      } else if (!edited.includes(key)) {
        edited.push(key)
      }
    }

    const sets = keys.map((k) => `${COLUMN_FOR[k]} = ?`).join(', ')
    const params: unknown[] = keys.map((k) => patch[k])
    params.push(JSON.stringify(edited), id)
    db.prepare(`UPDATE documents SET ${sets}, editedFields = ? WHERE id = ?`).run(...params)
    return get(id) as Document
  }

  function remove(id: string): void {
    db.prepare('DELETE FROM documents WHERE id = ?').run(id)
  }

  function bulkDelete(ids: string[]): void {
    if (ids.length === 0) return
    const placeholders = ids.map(() => '?').join(', ')
    db.prepare(`DELETE FROM documents WHERE id IN (${placeholders})`).run(...ids)
  }

  function setStarred(id: string, value: boolean): void {
    db.prepare('UPDATE documents SET starred = ? WHERE id = ?').run(value ? 1 : 0, id)
  }

  function findByPath(filePath: string): Document | null {
    const lf = lib()
    const rel = toLibraryRelative(filePath, lf)
    const row = db.prepare('SELECT * FROM documents WHERE filePath = ?').get(rel) as
      | Record<string, unknown>
      | undefined
    return row ? mapDocument(row, lf) : null
  }

  function findByHash(fileHash: string): Document | null {
    const lf = lib()
    const row = db.prepare('SELECT * FROM documents WHERE fileHash = ?').get(fileHash) as
      | Record<string, unknown>
      | undefined
    return row ? mapDocument(row, lf) : null
  }

  function updateFilePath(id: string, filePath: string, fileName: string): void {
    const rel = toLibraryRelative(filePath, lib())
    db.prepare('UPDATE documents SET filePath = ?, fileName = ?, updatedAt = ? WHERE id = ?').run(
      rel,
      fileName,
      Date.now(),
      id
    )
  }

  function setMetadataStatus(id: string, status: MetadataStatus, source?: MetadataSource): void {
    if (source === undefined) {
      db.prepare('UPDATE documents SET metadataStatus = ?, updatedAt = ? WHERE id = ?').run(
        status,
        Date.now(),
        id
      )
    } else {
      db.prepare(
        'UPDATE documents SET metadataStatus = ?, metadataSource = ?, updatedAt = ? WHERE id = ?'
      ).run(status, source, Date.now(), id)
    }
  }

  function incrementMetadataAttempts(id: string): number {
    db.prepare(
      'UPDATE documents SET metadataAttempts = metadataAttempts + 1, updatedAt = ? WHERE id = ?'
    ).run(Date.now(), id)
    const row = db.prepare('SELECT metadataAttempts AS a FROM documents WHERE id = ?').get(id) as
      | { a: number }
      | undefined
    return row?.a ?? 0
  }

  function setLastReadAt(id: string, ts: number | null): void {
    db.prepare('UPDATE documents SET lastReadAt = ?, updatedAt = ? WHERE id = ?').run(ts, Date.now(), id)
  }

  function setFileMissing(id: string, missing: boolean): void {
    db.prepare('UPDATE documents SET fileMissing = ?, updatedAt = ? WHERE id = ?').run(
      missing ? 1 : 0,
      Date.now(),
      id
    )
  }

  function getResumableMetadataRows(): Document[] {
    const lf = lib()
    const rows = db
      .prepare(
        "SELECT * FROM documents WHERE metadataStatus = 'pending' OR (metadataStatus = 'failed' AND metadataAttempts < 3)"
      )
      .all() as Record<string, unknown>[]
    return rows.map((r) => mapDocument(r, lf))
  }

  function countPendingMetadata(): number {
    const row = db.prepare("SELECT COUNT(*) AS c FROM documents WHERE metadataStatus = 'pending'").get() as
      | { c: number }
      | undefined
    return row?.c ?? 0
  }

  function setRemoteValues(id: string, remoteValues: RemoteValues | null): void {
    db.prepare('UPDATE documents SET remoteValues = ?, updatedAt = ? WHERE id = ?').run(
      remoteValues === null ? null : JSON.stringify(remoteValues),
      Date.now(),
      id
    )
  }

  function applyMetadataFields(
    id: string,
    fields: DocumentPatch,
    remoteValues: RemoteValues | null,
    status: MetadataStatus,
    source: MetadataSource | null
  ): Document {
    const keys = validatePatch(fields)
    if (keys.length === 0 && remoteValues === null && status === (get(id)?.metadataStatus ?? 'pending')) {
      return get(id) as Document
    }

    let sql = 'UPDATE documents SET '
    const params: unknown[] = []
    const parts: string[] = []

    for (const key of keys) {
      parts.push(`${COLUMN_FOR[key]} = ?`)
      params.push(fields[key])
    }

    parts.push('remoteValues = ?')
    params.push(remoteValues === null ? null : JSON.stringify(remoteValues))
    parts.push('metadataStatus = ?')
    params.push(status)
    if (source !== null) {
      parts.push('metadataSource = ?')
      params.push(source)
    }
    parts.push('updatedAt = ?')
    params.push(Date.now())

    sql += parts.join(', ')
    sql += ' WHERE id = ?'
    params.push(id)

    db.prepare(sql).run(...params)
    return get(id) as Document
  }

  return {
    list,
    search,
    get,
    insert,
    update,
    delete: remove,
    bulkDelete,
    setStarred,
    findByPath,
    findByHash,
    updateFilePath,
    setMetadataStatus,
    incrementMetadataAttempts,
    setLastReadAt,
    setFileMissing,
    getResumableMetadataRows,
    countPendingMetadata,
    setRemoteValues,
    applyMetadataFields
  }
}

export function newId(): string {
  return randomUUID()
}
