import { readFileSync, existsSync, statSync, lstatSync, createReadStream } from 'node:fs'
import { basename, dirname, isAbsolute, resolve as resolvePath, parse as parsePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import type { Repositories } from '../db/repositories'
import { newId } from '../db/repositories/documents'
import { logger } from './logger'
import { copyToLibrary } from './library'
import { isInsideLibrary } from './paths'
import type { Document, EditableField, MetadataSource } from '../../shared/ipc-types'

export type BibImportSource = 'zotero' | 'mendeley'

interface BibImportEntry {
  entryType: string
  citekey: string
  fields: Record<string, string>
}

interface BibImportResultInternal {
  added: string[]
  skipped: string[]
  errors: Array<{ key: string; message: string }>
}

const FIELD_MAP: Record<string, EditableField> = {
  title: 'title',
  author: 'authors',
  year: 'year',
  journal: 'venue',
  booktitle: 'venue',
  volume: 'volume',
  number: 'issue',
  issue: 'issue',
  pages: 'pages',
  abstract: 'abstract',
  keywords: 'keywords',
  url: 'url',
  doi: 'doi',
  note: 'note'
}

const MAX_BIBTEX_BYTES = 50 * 1024 * 1024

export function parseBibtex(content: string): BibImportEntry[] {
  const entries: BibImportEntry[] = []
  const len = content.length
  let i = 0

  while (i < len) {
    const atIdx = content.indexOf('@', i)
    if (atIdx === -1) break

    let j = atIdx + 1
    let entryType = ''
    while (j < len && /[a-zA-Z]/.test(content[j]!)) {
      entryType += content[j]
      j++
    }

    const lowerType = entryType.toLowerCase()
    if (lowerType === 'comment' || lowerType === 'string' || lowerType === 'preamble') {
      i = j
      continue
    }

    while (j < len && /\s/.test(content[j]!)) j++

    if (content[j] !== '{') {
      i = j
      continue
    }
    j++

    let depth = 1
    let bodyEnd = -1
    let k = j
    while (k < len && depth > 0) {
      const ch = content[k]!
      if (ch === '{') depth++
      else if (ch === '}') depth--
      if (depth === 0) {
        bodyEnd = k
        break
      }
      k++
    }
    if (bodyEnd === -1) break

    const body = content.slice(j, bodyEnd)
    i = bodyEnd + 1

    const firstComma = body.indexOf(',')
    let citekey: string
    let fieldsText: string
    if (firstComma === -1) {
      citekey = body.trim()
      fieldsText = ''
    } else {
      citekey = body.slice(0, firstComma).trim()
      fieldsText = body.slice(firstComma + 1)
    }

    const fields = parseFields(fieldsText)
    entries.push({ entryType: lowerType, citekey, fields })
  }

  return entries
}

function parseFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {}
  let pos = 0

  while (pos < text.length) {
    while (pos < text.length && /[\s,]/.test(text[pos]!)) pos++
    if (pos >= text.length) break

    let name = ''
    while (pos < text.length && /[a-zA-Z0-9_\-:]/.test(text[pos]!)) {
      name += text[pos]
      pos++
    }
    name = name.toLowerCase()
    if (!name) break

    while (pos < text.length && /\s/.test(text[pos]!)) pos++

    if (text[pos] !== '=') break
    pos++

    while (pos < text.length && /\s/.test(text[pos]!)) pos++

    const valueResult = readValue(text, pos)
    if (valueResult === null) break
    pos = valueResult.nextPos

    const cleanName = name.replace(/^bibfield-/, '')
    if (fields[cleanName] === undefined) {
      fields[cleanName] = valueResult.value
    }
  }

  return fields
}

interface ReadValueResult {
  value: string
  nextPos: number
}

function readValue(text: string, start: number): ReadValueResult | null {
  let pos = start
  let result = ''

  while (pos < text.length) {
    while (pos < text.length && /\s/.test(text[pos]!)) pos++
    if (pos >= text.length) break

    const ch = text[pos]!
    if (ch === '{') {
      const braceResult = readBraceDelimited(text, pos)
      if (braceResult === null) return null
      result += braceResult.value
      pos = braceResult.nextPos
    } else if (ch === '"') {
      const quoteResult = readQuoteDelimited(text, pos)
      if (quoteResult === null) return null
      result += quoteResult.value
      pos = quoteResult.nextPos
    } else {
      let bare = ''
      while (pos < text.length && !/[,{}"]/.test(text[pos]!)) {
        bare += text[pos]
        pos++
      }
      bare = bare.trim()
      if (bare) result += bare
      if (bare === '') break
    }

    while (pos < text.length && /\s/.test(text[pos]!)) pos++

    if (text[pos] === '#') {
      pos++
      continue
    }
    break
  }

  return { value: result, nextPos: pos }
}

function readBraceDelimited(text: string, start: number): ReadValueResult | null {
  if (text[start] !== '{') return null
  let depth = 0
  let value = ''
  let pos = start

  while (pos < text.length) {
    const ch = text[pos]!
    if (ch === '{') {
      if (depth > 0) value += ch
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        pos++
        break
      }
      value += ch
    } else {
      value += ch
    }
    pos++
  }

  return { value, nextPos: pos }
}

function readQuoteDelimited(text: string, start: number): ReadValueResult | null {
  if (text[start] !== '"') return null
  let value = ''
  let pos = start + 1

  while (pos < text.length) {
    const ch = text[pos]!
    if (ch === '\\' && pos + 1 < text.length) {
      value += ch + text[pos + 1]!
      pos += 2
      continue
    }
    if (ch === '"') {
      pos++
      break
    }
    if (ch === '{') {
      const braceResult = readBraceDelimited(text, pos)
      if (braceResult !== null) {
        value += braceResult.value
        pos = braceResult.nextPos
        continue
      }
    }
    value += ch
    pos++
  }

  return { value, nextPos: pos }
}

function unescapeLatex(s: string): string {
  return s
    .replace(/\\\{}/g, '{')
    .replace(/\\\}/g, '}')
    .replace(/\\\{/g, '{')
    .replace(/\\"/g, '"')
    .replace(/\\&/g, '&')
    .replace(/\\%/g, '%')
    .replace(/\\#/g, '#')
    .replace(/\\_/g, '_')
    .replace(/\\\$/g, '$')
    .replace(/\\\\/g, '\\')
    .replace(/\{\\(["'`'^~=.])\}/g, '$1')
    .replace(/\\"{(\w)}/g, '$1')
    .replace(/\\'\{(\w)\}/g, '$1')
    .replace(/\\`\{(\w)\}/g, '$1')
    .replace(/\\\^(\w)/g, '$1')
    .replace(/\\~(\w)/g, '$1')
    .replace(/\{([^{}]*)\}/g, '$1')
}

function normalizeAuthors(authorField: string): string {
  const authors = authorField
    .split(/\band\b/i)
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
  const normalized = authors.map((a) => {
    if (a.includes(',')) {
      const [last, ...rest] = a.split(',')
      const first = rest.join(',').trim()
      return first ? `${last.trim()}, ${first}` : last.trim()
    }
    return a
  }).filter(Boolean)
  return normalized.join('; ')
}

function normalizePages(pages: string): string {
  return pages.replace(/\s*--\s*/g, '-').replace(/\s*-\s*/g, '-')
}

function extractMetadataFromEntry(
  entry: BibImportEntry
): Partial<Record<EditableField, string>> {
  const result: Partial<Record<EditableField, string>> = {}

  for (const [bibKey, docField] of Object.entries(FIELD_MAP)) {
    if (docField === 'venue') {
      if (result.venue !== undefined) continue
      const raw = entry.fields['journal'] ?? entry.fields['booktitle']
      if (raw !== undefined) {
        const value = unescapeLatex(raw).trim().replace(/[{}]/g, '')
        if (value) result.venue = value
      }
      continue
    }

    let value = entry.fields[bibKey]
    if (value === undefined) continue
    value = unescapeLatex(value).trim()
    if (!value) continue

    if (docField === 'authors') {
      value = normalizeAuthors(value)
    } else if (docField === 'pages') {
      value = normalizePages(value)
    } else if (docField === 'year') {
      const yearMatch = value.match(/\d{4}/)
      value = yearMatch ? yearMatch[0] : value
    }

    result[docField] = value
  }

  return result
}

export function extractAttachmentPaths(raw: string): string[] {
  return raw
    .split(';')
    .map((part) => {
      let candidate = part.trim()
      const pdfEnd = candidate.toLowerCase().indexOf('.pdf')
      if (pdfEnd >= 0) candidate = candidate.slice(0, pdfEnd + 4)

      const fileUrlIndex = candidate.toLowerCase().indexOf('file://')
      if (fileUrlIndex >= 0) {
        try {
          return fileURLToPath(candidate.slice(fileUrlIndex))
        } catch {
          return ''
        }
      }

      const descriptorEnd = candidate.indexOf(':')
      if (descriptorEnd >= 0) {
        const describedPath = candidate.slice(descriptorEnd + 1).trim()
        if (describedPath.toLowerCase().includes('.pdf')) candidate = describedPath
      }

      return candidate
    })
    .filter(Boolean)
}

function validatePdfPath(raw: string, baseDir: string): string | null {
  if (!raw) return null
  const abs = isAbsolute(raw) ? resolvePath(raw) : resolvePath(baseDir, raw)
  if (!abs.toLowerCase().endsWith('.pdf')) return null
  if (!existsSync(abs)) return null
  try {
    if (lstatSync(abs).isSymbolicLink()) return null
    if (!statSync(abs).isFile()) return null
  } catch {
    return null
  }
  return abs
}

function findPdfFromEntry(
  entry: BibImportEntry,
  source: BibImportSource,
  baseDir: string
): string | null {
  const candidates: string[] = []

  if (source === 'zotero') {
    for (let n = 1; n <= 9; n++) {
      const f = entry.fields[`file${n}`]
      if (f) candidates.push(...extractAttachmentPaths(f))
    }
    const fileField = entry.fields['file']
    if (fileField) candidates.push(...extractAttachmentPaths(fileField))
  } else if (source === 'mendeley') {
    const f = entry.fields['file']
    if (f) candidates.push(...extractAttachmentPaths(f))
    const ff = entry.fields['files']
    if (ff) candidates.push(...extractAttachmentPaths(ff))
  }

  for (const c of candidates) {
    const valid = validatePdfPath(c, baseDir)
    if (valid) return valid
  }

  return null
}

function applyMetadataToExistingDoc(
  repos: Repositories,
  docId: string,
  metadata: Partial<Record<EditableField, string>>,
  citekey: string
): void {
  const doc = repos.documents.get(docId)
  if (!doc) return

  const patch: Record<string, string> = {}
  const remoteValues: NonNullable<Document['remoteValues']> = doc.remoteValues
    ? { ...doc.remoteValues }
    : {}

  const source: MetadataSource = 'manual'

  for (const [field, value] of Object.entries(metadata)) {
    if (!value) continue
    const editableField = field as EditableField
    if (doc.editedFields.includes(editableField)) {
      remoteValues[editableField] = { value, source }
    } else {
      patch[editableField] = value
    }
  }

  if (citekey && !doc.note && !doc.editedFields.includes('note')) {
    patch.note = citekey
  }

  if (Object.keys(patch).length > 0) {
    repos.documents.update(docId, patch)
  }

  if (Object.keys(remoteValues).length > 0 || doc.remoteValues) {
    repos.documents.setRemoteValues(docId, remoteValues)
  }
}

async function hashPdf(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const hash = createHash('sha256')
      const stream = createReadStream(filePath)
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('end', () => resolve(hash.digest('hex')))
      stream.on('error', () => resolve(null))
    } catch {
      resolve(null)
    }
  })
}

function buildBaseDoc(
  metadata: Partial<Record<EditableField, string>>,
  citekey: string
) {
  const now = Date.now()
  return {
    id: newId(),
    title: metadata.title ?? null,
    authors: metadata.authors ?? null,
    affiliations: null,
    year: metadata.year ?? null,
    venue: metadata.venue ?? null,
    volume: metadata.volume ?? null,
    issue: metadata.issue ?? null,
    pages: metadata.pages ?? null,
    abstract: metadata.abstract ?? null,
    keywords: metadata.keywords ?? null,
    url: metadata.url ?? null,
    doi: metadata.doi ?? null,
    note: citekey || null,
    starred: 0,
    addedAt: now,
    lastReadAt: null,
    updatedAt: now,
    metadataSource: 'manual' as MetadataSource,
    metadataStatus: 'done' as const,
    metadataAttempts: 0,
    editedFields: [] as EditableField[],
    remoteValues: null,
    fileMissing: 0
  }
}

export async function importFromBibtex(
  repos: Repositories,
  filePath: string,
  source: BibImportSource
): Promise<BibImportResultInternal> {
  const bibStat = statSync(filePath)
  if (!bibStat.isFile()) throw new Error('BibTeX path is not a file')
  if (bibStat.size > MAX_BIBTEX_BYTES) throw new Error('BibTeX file exceeds the 50 MB limit')
  const json = readFileSync(filePath, 'utf-8')
  const entries = parseBibtex(json)

  const added: string[] = []
  const skipped: string[] = []
  const errors: Array<{ key: string; message: string }> = []

  const libraryFolder = repos.settings.get<string>('libraryFolderPath', '')

  for (const entry of entries) {
    const key = entry.citekey || `entry-${entries.indexOf(entry) + 1}`
    const metadata = extractMetadataFromEntry(entry)

    const pdfPath = findPdfFromEntry(entry, source, dirname(filePath))

    if (pdfPath) {
      const existingByPath = repos.documents.findByPath(pdfPath)
      if (existingByPath) {
        applyMetadataToExistingDoc(repos, existingByPath.id, metadata, entry.citekey)
        skipped.push(existingByPath.id)
        continue
      }

      const fileHash = await hashPdf(pdfPath)
      if (fileHash) {
        const existingByHash = repos.documents.findByHash(fileHash)
        if (existingByHash) {
          applyMetadataToExistingDoc(repos, existingByHash.id, metadata, entry.citekey)
          skipped.push(existingByHash.id)
          continue
        }
      }

      try {
        const fileSize = statSync(pdfPath).size
        const base = buildBaseDoc(metadata, entry.citekey)
        const doc = repos.documents.insert({
          ...base,
          filePath: pdfPath,
          originalFolderPath: dirname(pdfPath),
          fileName: basename(pdfPath),
          fileSize,
          fileHash
        })

        if (libraryFolder && !isInsideLibrary(pdfPath, libraryFolder)) {
          try {
            const newPath = copyToLibrary(pdfPath, libraryFolder)
            repos.documents.updateFilePath(doc.id, newPath, parsePath(newPath).base)
          } catch (copyErr) {
            logger.warn(
              `bib-import:copy-to-library failed ${pdfPath}: ${copyErr instanceof Error ? copyErr.message : String(copyErr)}`
            )
          }
        }

        added.push(doc.id)
        logger.info(`bib-import:added ${doc.id} - ${entry.citekey}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push({ key, message: msg })
        logger.warn(`bib-import:error ${key}: ${msg}`)
      }
    } else {
      try {
        const base = buildBaseDoc(metadata, entry.citekey)
        const doc = repos.documents.insert({
          ...base,
          filePath: '',
          originalFolderPath: '',
          fileName: entry.citekey || '',
          fileSize: null,
          fileHash: null,
          fileMissing: 1
        })
        added.push(doc.id)
        logger.info(`bib-import:added (no-pdf) ${doc.id} - ${entry.citekey}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push({ key, message: msg })
      }
    }
  }

  return { added, skipped, errors }
}

export { extractMetadataFromEntry, normalizeAuthors, normalizePages, unescapeLatex }
