import { existsSync, lstatSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, parse as parsePath, resolve as resolvePath } from 'node:path'
import type { Repositories } from '../db/repositories'
import type { SqliteDb } from '../db/types'
import type { NewDocument } from '../db/repositories/documents'
import type {
  Document,
  Category,
  EditableField,
  MetadataSource,
  MetadataStatus,
  RemoteValues
} from '../../shared/ipc-types'
import { lookupVenue, venueType } from './venue-map'
import { isInsideLibrary } from './paths'

const BIBTEX_ESCAPE_MAP: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '%': '\\%',
  '#': '\\#',
  '"': '{\\"}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}'
}

const SKIP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'is',
  'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had', 'do',
  'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can',
  'shall', 'not', 'no', 'nor', 'but', 'yet', 'so', 'if', 'then', 'than',
  'that', 'this', 'these', 'those', 'it', 'its', 'with', 'from', 'by', 'as',
  'into', 'about', 'over', 'under', 'up', 'out', 'also', 'just', 'only',
  'very', 'too', 'much', 'more', 'most', 'some', 'any', 'all', 'each', 'every',
  'both', 'few', 'new', 'other', 'such', 'own', 'same', 'use', 'used', 'using'
])

function resolveEntryType(doc: Document): 'inproceedings' | 'article' | 'misc' {
  const venue = doc.venue?.trim()
  if (!venue && !doc.volume && !doc.pages) return 'misc'
  if (venue) {
    const vType = venueType(venue)
    if (vType === 'conference') return 'inproceedings'
    if (vType === 'journal') return 'article'
  }
  if (doc.volume) return 'article'
  if (doc.pages && !venue) return 'misc'
  return 'article'
}

function escapeBibtexValue(value: string): string {
  let result = ''
  for (const ch of value) {
    if (BIBTEX_ESCAPE_MAP[ch] !== undefined) {
      result += BIBTEX_ESCAPE_MAP[ch]
    } else if (ch.charCodeAt(0) > 127) {
      result += `{${ch}}`
    } else {
      result += ch
    }
  }
  return `{${result}}`
}

function sanitizeCitekey(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

function firstAuthorLastName(authors: string | null): string | null {
  if (!authors) return null
  const first = authors.split(';')[0].trim()
  if (!first) return null
  const commaIdx = first.indexOf(',')
  return commaIdx >= 0 ? first.slice(0, commaIdx).trim() : first.trim()
}

function firstTitleWord(title: string | null): string | null {
  if (!title) return null
  const words = title.replace(/[{}\\]/g, ' ').split(/\s+/)
  for (const w of words) {
    const cleaned = w.replace(/[^a-zA-Z]/g, '')
    if (cleaned.length > 0 && !SKIP_WORDS.has(cleaned.toLowerCase())) {
      return cleaned
    }
  }
  const firstWord = words.find((w) => w.length > 0)
  return firstWord ? firstWord.replace(/[^a-zA-Z]/g, '') : null
}

function buildCitekey(doc: Document, used: Set<string>): string {
  const author = firstAuthorLastName(doc.authors)
  const year = (doc.year || '').match(/\d{4}/)?.[0] || doc.year || ''
  const titleWord = firstTitleWord(doc.title)

  if (author || year || titleWord) {
    const base = [author, year, titleWord].filter((s): s is string => s !== null).map(sanitizeCitekey).join('')
    if (base.length > 0) {
      let key = base
      let suffix = 1
      while (used.has(key)) {
        key = base + String.fromCharCode(96 + suffix)
        suffix++
        if (suffix > 26) {
          while (used.has(key)) {
            suffix++
            key = base + suffix
          }
          break
        }
      }
      used.add(key)
      return key
    }
  }

  const fallback = sanitizeCitekey(doc.id.slice(0, 8))
  let key = fallback
  let suffix = 1
  while (used.has(key)) {
    key = fallback + String.fromCharCode(96 + suffix)
    suffix++
    if (suffix > 26) {
      while (used.has(key)) {
        suffix++
        key = fallback + suffix
      }
      break
    }
  }
  used.add(key)
  return key
}

function formatAuthors(authors: string | null): string | null {
  if (!authors) return null
  return authors
    .split(';')
    .map((a) => a.trim())
    .filter(Boolean)
    .join(' and ')
}

function formatBibtexEntry(doc: Document, used: Set<string>): string | null {
  const type = resolveEntryType(doc)
  const citekey = buildCitekey(doc, used)

  const fields: Record<string, string> = {}
  if (doc.title) fields.title = escapeBibtexValue(doc.title)
  const authorStr = formatAuthors(doc.authors)
  if (authorStr) fields.author = escapeBibtexValue(authorStr)
  if (doc.year) fields.year = escapeBibtexValue(doc.year)
  if (doc.venue) {
    const venueInfo = lookupVenue(doc.venue)
    const venueName = venueInfo ? venueInfo.canonical : doc.venue
    if (type === 'inproceedings') fields.booktitle = escapeBibtexValue(venueName)
    else fields.journal = escapeBibtexValue(venueName)
  }
  if (doc.volume) fields.volume = escapeBibtexValue(doc.volume)
  if (doc.issue) fields.number = escapeBibtexValue(doc.issue)
  if (doc.pages) fields.pages = escapeBibtexValue(doc.pages)
  if (doc.keywords) fields.keywords = escapeBibtexValue(doc.keywords)
  if (doc.url) fields.url = escapeBibtexValue(doc.url)
  if (doc.doi) fields.doi = escapeBibtexValue(doc.doi)
  if (doc.arxivId) {
    fields.eprint = escapeBibtexValue(doc.arxivId)
    fields.archiveprefix = escapeBibtexValue('arXiv')
  }

  if (Object.keys(fields).length === 0) return null

  const lines = Object.entries(fields).map(([k, v]) => `  ${k.padEnd(12)} = ${v}`)
  return `@${type}{${citekey},\n${lines.join(',\n')}\n}`
}

export function toBibtex(docs: Document[]): string {
  const used = new Set<string>()
  const entries: string[] = []
  for (const doc of docs) {
    const entry = formatBibtexEntry(doc, used)
    if (entry) entries.push(entry)
  }
  return entries.join('\n\n') + (entries.length > 0 ? '\n' : '')
}

interface DocumentCategoryRow {
  documentId: string
  categoryId: string
}

interface ExportData {
  version: number
  exportedAt: number
  documents: Document[]
  categories: Category[]
  documentCategories: DocumentCategoryRow[]
}

function serialize(repos: Repositories): string {
  const documents = repos.documents.list({ mode: 'all' })
  const categories = repos.categories.list().map((c) => ({
    id: c.id,
    name: c.name,
    sortOrder: c.sortOrder,
    createdAt: c.createdAt
  }))
  const documentCategories = repos.categories.getAllDocumentCategories()

  const data: ExportData = {
    version: 1,
    exportedAt: Date.now(),
    documents,
    categories,
    documentCategories
  }

  return JSON.stringify(data, null, 2)
}

function parseExportJson(json: string): ExportData {
  const parsed = JSON.parse(json)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid export format: not an object')
  }
  if (!Array.isArray(parsed.documents)) {
    throw new Error('Invalid export format: missing documents array')
  }
  if (!Array.isArray(parsed.categories)) {
    throw new Error('Invalid export format: missing categories array')
  }
  if (!Array.isArray(parsed.documentCategories)) {
    throw new Error('Invalid export format: missing documentCategories array')
  }
  return parsed as ExportData
}

const EDITABLE_FIELD_VALUES: readonly EditableField[] = [
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
  'arxivId',
  'note',
  'affiliations'
]

const METADATA_STATUS_VALUES: readonly MetadataStatus[] = ['pending', 'done', 'failed']

const METADATA_SOURCE_VALUES: readonly MetadataSource[] = [
  'pdf',
  'crossref',
  'arxiv',
  'dblp',
  'manual'
]

function asStringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function asNumberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function asNumberDefault(v: unknown, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : def
}

export function sanitizeImportedDoc(doc: unknown, libraryFolder: string): NewDocument | null {
  if (!doc || typeof doc !== 'object') return null
  const d = doc as Record<string, unknown>

  if (typeof d.id !== 'string' || d.id.length === 0) return null
  if (typeof d.filePath !== 'string') return null
  let filePath: string
  if (isAbsolute(d.filePath)) {
    filePath = resolvePath(d.filePath)
  } else {
    if (!libraryFolder) return null
    filePath = resolvePath(libraryFolder, d.filePath)
    if (!isInsideLibrary(filePath, libraryFolder)) return null
  }
  if (!filePath.toLowerCase().endsWith('.pdf')) return null

  let fileMissing = 1
  let fileSize = asNumberOrNull(d.fileSize)
  if (existsSync(filePath)) {
    try {
      if (lstatSync(filePath).isSymbolicLink()) return null
      const fileStat = statSync(filePath)
      if (!fileStat.isFile()) return null
      fileMissing = 0
      fileSize = fileStat.size
    } catch {
      return null
    }
  }

  const originalFolderPath =
    typeof d.originalFolderPath === 'string' && isAbsolute(d.originalFolderPath)
      ? resolvePath(d.originalFolderPath)
      : dirname(filePath)

  const editedFields: EditableField[] = Array.isArray(d.editedFields)
    ? d.editedFields.filter(
        (v): v is EditableField =>
          typeof v === 'string' &&
          (EDITABLE_FIELD_VALUES as readonly string[]).includes(v)
      )
    : []

  const remoteValues: RemoteValues | null =
    d.remoteValues !== null && typeof d.remoteValues === 'object'
      ? (d.remoteValues as RemoteValues)
      : null

  const metadataStatus: MetadataStatus =
    typeof d.metadataStatus === 'string' &&
    (METADATA_STATUS_VALUES as readonly string[]).includes(d.metadataStatus)
      ? (d.metadataStatus as MetadataStatus)
      : 'pending'

  const metadataSource: MetadataSource | null =
    typeof d.metadataSource === 'string' &&
    (METADATA_SOURCE_VALUES as readonly string[]).includes(d.metadataSource)
      ? (d.metadataSource as MetadataSource)
      : null

  return {
    id: d.id,
    filePath,
    originalFolderPath,
    fileName: parsePath(filePath).base,
    fileSize,
    fileHash: asStringOrNull(d.fileHash),
    title: asStringOrNull(d.title),
    authors: asStringOrNull(d.authors),
    year: asStringOrNull(d.year),
    venue: asStringOrNull(d.venue),
    volume: asStringOrNull(d.volume),
    issue: asStringOrNull(d.issue),
    pages: asStringOrNull(d.pages),
    abstract: asStringOrNull(d.abstract),
    keywords: asStringOrNull(d.keywords),
    url: asStringOrNull(d.url),
    doi: asStringOrNull(d.doi),
    arxivId: asStringOrNull(d.arxivId),
    note: asStringOrNull(d.note),
    affiliations: asStringOrNull(d.affiliations),
    starred: asNumberDefault(d.starred, 0),
    addedAt: asNumberDefault(d.addedAt, 0),
    lastReadAt: asNumberOrNull(d.lastReadAt),
    updatedAt: asNumberDefault(d.updatedAt, 0),
    metadataSource,
    metadataStatus,
    metadataAttempts: asNumberDefault(d.metadataAttempts, 0),
    editedFields,
    remoteValues,
    fileMissing
  }
}

function importReplace(
  repos: Repositories,
  data: ExportData,
  libraryFolder: string,
  db?: SqliteDb
): number {
  if (!db) {
    throw new Error('Database connection required for replace import')
  }

  const sanitizedDocs = data.documents
    .map((doc) => sanitizeImportedDoc(doc, libraryFolder))
    .filter((d): d is NewDocument => d !== null)

  const doReplace = (): number => {
    repos.documents.deleteAll()

    const existingCats = repos.categories.list()
    for (const c of existingCats) {
      repos.categories.delete(c.id)
    }

    const oldCatIdToNew = new Map<string, string>()
    const seenNames = new Set<string>()
    for (const cat of data.categories) {
      if (typeof cat.id !== 'string' || typeof cat.name !== 'string') continue
      if (oldCatIdToNew.has(cat.id) || seenNames.has(cat.name)) continue
      const created = repos.categories.create(cat.name)
      oldCatIdToNew.set(cat.id, created.id)
      seenNames.add(cat.name)
    }

    const insertedDocIds = new Set<string>()
    let count = 0
    for (const doc of sanitizedDocs) {
      repos.documents.insert(doc)
      insertedDocIds.add(doc.id)
      count++
    }

    for (const dc of data.documentCategories) {
      if (typeof dc.documentId !== 'string' || typeof dc.categoryId !== 'string') continue
      if (!insertedDocIds.has(dc.documentId)) continue
      const newCatId = oldCatIdToNew.get(dc.categoryId)
      if (newCatId) {
        repos.categories.assign(dc.documentId, newCatId)
      }
    }

    return count
  }

  db.exec('BEGIN')
  try {
    const count = doReplace()
    db.exec('COMMIT')
    return count
  } catch (e) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // transaction may have already auto-rolled back
    }
    throw e
  }
}

function importMerge(repos: Repositories, data: ExportData, libraryFolder: string): number {
  return repos.transaction(() => {
    const oldCatIdToNew = new Map<string, string>()
    const nameToDbId = new Map<string, string>()
    for (const cat of repos.categories.list()) {
      nameToDbId.set(cat.name, cat.id)
    }
    for (const cat of data.categories) {
      if (typeof cat.id !== 'string' || typeof cat.name !== 'string') continue
      if (oldCatIdToNew.has(cat.id)) continue
      let dbId = nameToDbId.get(cat.name)
      if (!dbId) {
        try {
          const created = repos.categories.create(cat.name)
          dbId = created.id
          nameToDbId.set(cat.name, dbId)
        } catch {
          continue
        }
      }
      oldCatIdToNew.set(cat.id, dbId)
    }

    const insertedDocIds = new Set<string>()
    let count = 0
    for (const doc of data.documents) {
      const sanitized = sanitizeImportedDoc(doc, libraryFolder)
      if (!sanitized) continue
      const existing = repos.documents.get(sanitized.id)
      if (existing) continue
      try {
        repos.documents.insert(sanitized)
        insertedDocIds.add(sanitized.id)
        count++
      } catch {
        continue
      }
    }

    for (const dc of data.documentCategories) {
      if (typeof dc.documentId !== 'string' || typeof dc.categoryId !== 'string') continue
      if (!insertedDocIds.has(dc.documentId)) continue
      const newCatId = oldCatIdToNew.get(dc.categoryId)
      if (newCatId) {
        try {
          repos.categories.assign(dc.documentId, newCatId)
        } catch {
          continue
        }
      }
    }

    return count
  })
}

export function writeExportFile(repos: Repositories, filePath: string): void {
  const json = serialize(repos)
  writeFileSync(filePath, json, 'utf-8')
}

export function importFromJsonFile(
  repos: Repositories,
  filePath: string,
  mode: 'replace' | 'merge',
  db?: SqliteDb
): number {
  const json = readFileSync(filePath, 'utf-8')
  const data = parseExportJson(json)
  const libraryFolder = repos.settings.get<string>('libraryFolderPath', '')
  if (mode === 'replace') {
    return importReplace(repos, data, libraryFolder, db)
  }
  return importMerge(repos, data, libraryFolder)
}

export { serialize, parseExportJson, type ExportData }
