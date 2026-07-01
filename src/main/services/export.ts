import { readFileSync, writeFileSync } from 'node:fs'
import type { Repositories } from '../db/repositories'
import type { Document, Category } from '../../shared/ipc-types'

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

function entryType(doc: Document): string {
  if (doc.venue || doc.volume) return 'article'
  return 'misc'
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
          key = base + suffix
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
      key = fallback + suffix
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
  const type = entryType(doc)
  const citekey = buildCitekey(doc, used)

  const fields: Record<string, string> = {}
  if (doc.title) fields.title = escapeBibtexValue(doc.title)
  const authorStr = formatAuthors(doc.authors)
  if (authorStr) fields.author = escapeBibtexValue(authorStr)
  if (doc.year) fields.year = escapeBibtexValue(doc.year)
  if (doc.venue) {
    fields.journal = escapeBibtexValue(doc.venue)
  }
  if (doc.volume) fields.volume = escapeBibtexValue(doc.volume)
  if (doc.abstract) fields.abstract = escapeBibtexValue(doc.abstract)
  if (doc.keywords) fields.keywords = escapeBibtexValue(doc.keywords)
  if (doc.url) fields.url = escapeBibtexValue(doc.url)
  if (doc.doi) fields.doi = escapeBibtexValue(doc.doi)

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
    moveToLibrary: c.moveToLibrary,
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

function importReplace(repos: Repositories, data: ExportData): number {
  const existingDocIds = repos.documents.list({ mode: 'all' }).map((d) => d.id)
  if (existingDocIds.length > 0) {
    repos.documents.bulkDelete(existingDocIds)
  }

  const existingCats = repos.categories.list()
  for (const c of existingCats) {
    repos.categories.delete(c.id)
  }

  const catNameToId = new Map<string, string>()
  for (const cat of data.categories) {
    try {
      const created = repos.categories.create(cat.name, cat.moveToLibrary ?? undefined)
      catNameToId.set(cat.name, created.id)
    } catch {
      continue
    }
  }

  let count = 0
  for (const doc of data.documents) {
    try {
      repos.documents.insert(doc)
      count++
    } catch {
      continue
    }
  }

  for (const dc of data.documentCategories) {
    try {
      repos.categories.assign(dc.documentId, dc.categoryId)
    } catch {
      continue
    }
  }

  return count
}

function importMerge(repos: Repositories, data: ExportData): number {
  for (const cat of data.categories) {
    const existing = repos.categories.list().find((c) => c.name === cat.name)
    if (!existing) {
      try {
        repos.categories.create(cat.name, cat.moveToLibrary ?? undefined)
      } catch {
        continue
      }
    }
  }

  let count = 0
  for (const doc of data.documents) {
    const existing = repos.documents.get(doc.id)
    if (existing) continue
    try {
      repos.documents.insert(doc)
      count++
    } catch {
      continue
    }
  }

  for (const dc of data.documentCategories) {
    try {
      repos.categories.assign(dc.documentId, dc.categoryId)
    } catch {
      continue
    }
  }

  return count
}

export function writeExportFile(repos: Repositories, filePath: string): void {
  const json = serialize(repos)
  writeFileSync(filePath, json, 'utf-8')
}

export function importFromJsonFile(
  repos: Repositories,
  filePath: string,
  mode: 'replace' | 'merge'
): number {
  const json = readFileSync(filePath, 'utf-8')
  const data = parseExportJson(json)
  if (mode === 'replace') {
    return importReplace(repos, data)
  }
  return importMerge(repos, data)
}

export { serialize, parseExportJson, type ExportData }
