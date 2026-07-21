import { type BrowserWindow, utilityProcess, net } from 'electron'
import { join } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import type { Repositories } from '../db/repositories'
import type { Document, DocumentPatch, EditableField, MetadataSource, RemoteValues } from '../../shared/ipc-types'
import { newId } from '../db/repositories/documents'
import { RepoError } from '../db/repositories/errors'
import { emitDocumentUpdated } from '../ipc/events'
import { logger } from './logger'
import { normalizeVenue } from './venue-map'

interface WorkerResponse {
  correlationId: string
  error?: { type: string; message: string }
  fileHash?: string | null
  info?: Record<string, unknown>
  text?: string
  titleCandidate?: string | null
}

interface PendingRequest {
  resolve: (value: WorkerResponse) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const WORKER_TIMEOUT_MS = 60_000
const NET_TIMEOUT_MS = 8_000
const WORKER_IDLE_TIMEOUT_MS = 60_000

type MetadataJob = () => Promise<void>

class NetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NetworkError'
  }
}

function isNetworkError(e: unknown): boolean {
  return e instanceof NetworkError
}

const REFERENCE_HEADINGS = /references|bibliography|参考文献|参考资料|references\s*$/i
const DOI_REGEX = /10\.\d{4,9}\/[-._;()/:a-zA-Z0-9+]+/g
const ARXIV_ID_REGEX = /(?:arxiv\s*:?\s*|arxiv\.org\/(?:abs|pdf)\/)((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?)/i
const ARXIV_MODERN_ID = /^\d{4}\.\d{4,5}(?:v\d+)?$/i
const ARXIV_LEGACY_ID = /^[a-z-]+(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?$/i

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

const TEMPLATE_NOISE_TITLE = /\b(formatting instructions|instructions for authors|template|sample manuscript|sample paper|untitled|main\.tex|preliminary version|do not cite|work in progress|draft version|preprint version|accepted for publication|to appear in)\b/i

export function isTemplateNoiseTitle(title: string): boolean {
  return TEMPLATE_NOISE_TITLE.test(title)
}

export function extractDoiFromText(text: string): string | null {
  const lines = text.split('\n')
  let inReferences = false
  let firstMatch: string | null = null

  for (const line of lines) {
    if (REFERENCE_HEADINGS.test(line.trim())) {
      inReferences = true
      continue
    }
    if (inReferences) continue

    const cleanLine = line.replace(/https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi\s*:?\s*/i, '')
    const match = cleanLine.match(DOI_REGEX)
    if (match && !firstMatch) {
      firstMatch = match[0].replace(/[.,;)\]]+$/, '')
    }
  }

  return firstMatch
}

export function extractDoiFromInfo(info: Record<string, unknown>): string | null {
  const raw = info['doi'] ?? info['DOI'] ?? info['Doi'] ?? null
  if (typeof raw !== 'string' || raw.length === 0) return null
  return raw.trim()
}

export function extractArxivFromText(text: string): string | null {
  const match = text.match(ARXIV_ID_REGEX)
  return match ? normalizeArxivId(match[1]) : null
}

export function normalizeArxivId(input: string): string | null {
  let value = input.trim()
  value = value.replace(/^arxiv\s*:\s*/i, '')
  value = value.replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//i, '')
  value = value.split(/[?#]/, 1)[0] ?? ''
  value = value.replace(/\.pdf$/i, '')
  if (!ARXIV_MODERN_ID.test(value) && !ARXIV_LEGACY_ID.test(value)) return null
  return value.replace(/v(\d+)$/i, 'v$1')
}

function baseArxivId(arxivId: string): string {
  return arxivId.replace(/v\d+$/i, '')
}

export function deriveDoiFromArxivId(arxivId: string): string {
  const normalizedId = normalizeArxivId(arxivId) ?? arxivId
  const bareId = baseArxivId(normalizedId)
  return `10.48550/arXiv.${bareId}`
}

const ABSTRACT_KEYWORD = /^(?:abstract)\b\.?:?\s*-?\s*/i
const ABSTRACT_KEYWORD_SPACED = /^a\s*b\s*s\s*t\s*r\s*a\s*c\s*t\b\.?:?\s*-?\s*/i
const ABSTRACT_KEYWORD_CN = /^摘\s*要[\s:：]*/
const ABSTRACT_END_MARKERS = /^(?:keywords?|index terms|\d+\.?\s*(?:introduction|related work|background|method|methodology|preliminar|related\s+work)|ccs\s+concepts?|categories\s+and\s+subject|acm\s+(?:reference|computing\s+classification)|1\s+introduction|1\.\s+introduction|i\.?\s+introduction|introduction\s*$|acknowledg|references|bibliography)\b/i
const ABSTRACT_NOISE_LINE = /^(?:fig(?:ure|\.)?\s*\d|table\s*\d|algorithm\s*\d|theorem\s*\d|lemma\s*\d|equation\s*\d|eq\.?\s*\d|section\s*\d|sec\.?\s*\d|corollary|proposition|definition|proof|©|copyright|published\s+as|received\s+\d|accepted\s+\d|revised\s+\d|available\s+online|article history|article info|a\s*r\s*t\s*i\s*c\s*l\s*e\s+i\s*n\s*f\s*o)\b/i

export function extractAbstractFromText(text: string): string | null {
  const rawLines = text.split('\n')
  const lines = rawLines.map((l) => l.trim())
  const textLen = lines.length

  for (let idx = 0; idx < Math.min(textLen, 80); idx++) {
    const line = lines[idx]
    if (line.length === 0) continue

    let rest: string | null = null
    const m1 = line.match(ABSTRACT_KEYWORD)
    const m2 = !m1 ? line.match(ABSTRACT_KEYWORD_SPACED) : null
    const m3 = !m1 && !m2 ? line.match(ABSTRACT_KEYWORD_CN) : null

    if (m1) rest = line.slice(m1[0].length)
    else if (m2) rest = line.slice(m2[0].length)
    else if (m3) rest = line.slice(m3[0].length)

    if (rest === null) continue

    const abstractLines: string[] = rest.length > 0 ? [rest] : []
    for (let i = idx + 1; i < Math.min(textLen, idx + 50); i++) {
      const l = lines[i]
      if (ABSTRACT_END_MARKERS.test(l)) break
      if (ABSTRACT_NOISE_LINE.test(l)) break
      if (l.length === 0) {
        if (abstractLines.length > 0) break
        continue
      }
      abstractLines.push(l)
    }
    const result = abstractLines.join(' ').replace(/\s+/g, ' ').trim()
    if (result.length > 15) return result.slice(0, 2000)
  }

  return extractAbstractByStructure(lines)
}

function extractAbstractByStructure(lines: string[]): string | null {
  if (lines.length < 6) return null

  const affiliationRegex = /\b(universit[yéeè]|institute|college|laborator[y]|research|corporation|inc\.?|gmbh|department|school of|faculty of|center|centre|facebook|google|microsoft|nvidia|apple|amazon|bytedance|openai|deepmind|anthropic)\b/i
  const authorLikeLine = /^[A-Z][a-zA-Z'`''-]+(?:\s+[A-Z][a-zA-Z'`''-]+)*(?:,?\s+(?:and|&)\s+[A-Z][a-zA-Z'`''-]+)*$/
  const nameWithAffiliation = /^[A-Z][a-zA-Z'`''-]+.*,\s+/

  let firstParagraphStart = -1
  let seenAuthorish = false

  for (let i = 1; i < Math.min(lines.length, 80); i++) {
    const line = lines[i]
    if (line.length === 0) continue
    if (ABSTRACT_END_MARKERS.test(line)) break
    if (ABSTRACT_NOISE_LINE.test(line)) continue

    if (affiliationRegex.test(line) || /^[\w.-]+@[\w.-]+\.\w+/.test(line) ||
        /^(?:Member|Senior Member|Fellow|Student Member),?\s+IEEE/i.test(line)) {
      seenAuthorish = true
      continue
    }
    if (/^\d+$/.test(line) || /^[†‡§¶∗○●▲△▼▽☆★◇◆■□♣♦♥♠∘]\.?\s*$/.test(line)) continue
    if (authorLikeLine.test(line) && line.length < 60) {
      seenAuthorish = true
      continue
    }
    if (nameWithAffiliation.test(line) && line.length < 80 && !line.endsWith('.')) {
      seenAuthorish = true
      continue
    }
    if (line.length < 3) continue

    if (seenAuthorish && line.length > 40 && /^[A-Z]/.test(line) && !line.endsWith(':')) {
      if (/\bFig\.?\s*\d/.test(line)) continue
      if (/[+]/.test(line) && /\d/.test(line)) continue
      const words = line.split(/\s+/)
      const capWords = words.filter((w) => /^[A-Z]/.test(w))
      if (words.length > 3 && capWords.length / words.length > 0.6) continue
      firstParagraphStart = i
      break
    }
  }

  if (firstParagraphStart === -1) return null

  const paragraph: string[] = []
  for (let j = firstParagraphStart; j < Math.min(lines.length, firstParagraphStart + 30); j++) {
    const pLine = lines[j]
    if (ABSTRACT_END_MARKERS.test(pLine)) break
    if (/^(?:[1-9]\.?\s|1\s+Introduction|I\.?\s+Introduction)\b/i.test(pLine)) break
    if (pLine.length === 0) {
      if (paragraph.length > 0) break
      continue
    }
    if (ABSTRACT_NOISE_LINE.test(pLine) && paragraph.length === 0) continue
    paragraph.push(pLine)
  }

  if (paragraph.length >= 2) {
    const result = paragraph.join(' ').replace(/\s+/g, ' ').trim()
    if (result.length > 60 && /^[A-Z]/.test(result)) {
      if (/\bFig\.?\s*\d/.test(result)) return null
      const sentences = result.split(/[.!?]\s+/)
      if (sentences.length >= 2) return result.slice(0, 2000)
      if (result.length > 150) return result.slice(0, 2000)
    }
  }

  return null
}

const AFFILIATION_SYMBOL_PATTERN = /^[†‡§¶∗○●▲△▼▽☆★◇◆■□♣♦♥♠∘]/u
const AFFILIATION_DEPT_KEYWORDS = /\b(department|dept|school of|institute|laboratory|lab|college|university|center|centre|centre for|faculty of|academy|hospital|corporation|inc|company|gmbh|division of|research group)\b/i
const AFFILIATION_ORG_KEYWORDS = /\b(research institutes|technologies|sciences|science|engineering|physics|electronics|automotive|energy)\b/i
const SUPERSCRIPT_MARKER = /^(?:[†‡§¶∗○●▲△▼▽☆★◇◆■□♣♦♥♠∘]|[a-z](?:,[a-z])*|\d+(?:,\d+)*|\*|•)\.?\s*$/

function isLikelyAffiliation(line: string): boolean {
  if (line.length < 5 || line.length > 300) return false
  if (/@/.test(line)) return false
  if (AFFILIATION_DEPT_KEYWORDS.test(line)) return true
  if (AFFILIATION_ORG_KEYWORDS.test(line) && /\b(University|Institute|College|Laboratory|Research|Corp|Inc|Ltd|GmbH|Company|Foundation)\b/i.test(line)) return true
  if (/\b[A-Z][a-zA-Z]+\s+Research\b/.test(line) && line.length < 80) return true
  if (/^[A-Z][a-zA-Z\s,&.'-]+(University|Institute|College|Laboratory|Corporation|Inc\.?|Ltd\.?|GmbH)\b/.test(line)) return true
  return false
}

export function extractAffiliationsFromText(text: string): string | null {
  const hasAbstract = /\babstract\b/i.test(text.slice(0, 3000))
  if (!hasAbstract) return null

  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  const head = lines.slice(0, 50)
  const affiliations: string[] = []
  const seen = new Set<string>()

  function tryAdd(value: string): void {
    const trimmed = value.trim()
    if (trimmed.length < 5) return
    const key = trimmed.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    affiliations.push(trimmed)
  }

  let inAffiliationBlock = false
  let blockEnded = false
  let expectAffiliationAfterMarker = false

  for (let i = 0; i < head.length; i++) {
    const line = head[i]

    if (blockEnded) break

    if (/^(abstract|keywords|introduction)\b/i.test(line)) {
      break
    }

    if (/^affiliations?\b/i.test(line) || /^\*?\s*author affiliations?\b/i.test(line)) {
      const rest = line.replace(/^.*?affiliations?\s*:?\s*/i, '').trim()
      if (rest.length > 0) {
        for (const part of rest.split(/[;|]/).map((s) => s.trim()).filter(Boolean)) {
          if (isLikelyAffiliation(part)) tryAdd(part)
        }
        inAffiliationBlock = true
      }
      continue
    }

    if (inAffiliationBlock) {
      if (line.length < 5) {
        blockEnded = true
        continue
      }
      if (isLikelyAffiliation(line)) {
        tryAdd(line)
        continue
      } else {
        blockEnded = true
        continue
      }
    }

    if (SUPERSCRIPT_MARKER.test(line)) {
      if (i + 1 < head.length) {
        const next = head[i + 1]
        if (isLikelyAffiliation(next)) {
          tryAdd(next)
          expectAffiliationAfterMarker = true
          i++
          continue
        }
      }
    }

    if (expectAffiliationAfterMarker && isLikelyAffiliation(line)) {
      tryAdd(line)
      continue
    }

    if (AFFILIATION_SYMBOL_PATTERN.test(line)) {
      const cleaned = line.replace(AFFILIATION_SYMBOL_PATTERN, '').replace(/^[a-z\d]+,?\s*/, '').replace(/^\d+\.?\s*/, '').trim()
      if (cleaned.length > 5 && isLikelyAffiliation(cleaned)) {
        tryAdd(cleaned)
        continue
      }
    }

    if (!inAffiliationBlock && isLikelyAffiliation(line)) {
      tryAdd(line)
    }
  }

  if (affiliations.length === 0) return null
  return affiliations.join('; ')
}

const CONFERENCE_VENUE_MAP: Record<string, string> = {
  ICLR: 'ICLR',
  ICML: 'ICML',
  NeurIPS: 'NeurIPS',
  NIPS: 'NeurIPS',
  ICCV: 'ICCV',
  CVPR: 'CVPR',
  ECCV: 'ECCV',
  AAAI: 'AAAI',
  ICASSP: 'ICASSP',
  SIGGRAPH: 'SIGGRAPH',
  ACL: 'ACL',
  EMNLP: 'EMNLP',
  NAACL: 'NAACL',
  COLING: 'COLING',
  KDD: 'KDD',
  WWW: 'WWW',
  SIGMOD: 'SIGMOD',
  VLDB: 'VLDB',
  ICDE: 'ICDE',
  SOSP: 'SOSP',
  OSDI: 'OSDI',
  NSDI: 'NSDI',
  EuroSys: 'EuroSys',
  ATC: 'USENIX ATC',
  CCS: 'CCS',
  SAndP: 'S&P',
  NDSS: 'NDSS',
  RSS: 'RSS',
  ICRA: 'ICRA',
  IROS: 'IROS',
  WACV: 'WACV',
  BMVC: 'BMVC',
  ACML: 'ACML'
}

const CONFERENCE_BANNER = /published as (?:a |an )?conference paper at\s+([A-Za-z][A-Za-z.&\s]*?)\s+(\d{4})/i
const UNDER_REVIEW_BANNER = /under review as (?:a |an )?conference paper at\s+([A-Za-z][A-Za-z.&\s]*?)\s+(\d{4})/i
const UNDER_REVIEW_BANNER_NO_YEAR = /under review (?:as|for)\b/i

export function extractVenueFromText(text: string): { venue: string; year: string } | null {
  const head = text.slice(0, 600)

  const m = head.match(CONFERENCE_BANNER)
  if (m) {
    const rawVenue = m[1].trim()
    const venue = normalizeVenueKey(rawVenue) ?? rawVenue
    return { venue, year: m[2] }
  }

  const reviewMatch = head.match(UNDER_REVIEW_BANNER)
  if (reviewMatch) {
    const rawVenue = reviewMatch[1].trim()
    const venue = normalizeVenueKey(rawVenue) ?? rawVenue
    return { venue, year: reviewMatch[2] }
  }

  if (UNDER_REVIEW_BANNER_NO_YEAR.test(head)) return null

  const ieeeMatch = head.match(/IEEE\s+(Transactions\s+on\s+[A-Z][A-Za-z\s]+?)[\s.,]\s*(?:\d|VOL|vol|$)/i)
  if (ieeeMatch) {
    const venue = 'IEEE ' + ieeeMatch[1].trim()
    return { venue, year: '' }
  }

  return null
}

function normalizeVenueKey(rawVenue: string): string | null {
  const key = Object.keys(CONFERENCE_VENUE_MAP).find(
    (k) => rawVenue.toLowerCase() === k.toLowerCase()
  )
  return key ? CONFERENCE_VENUE_MAP[key] : null
}

const TITLE_NOISE_PATTERNS = /^(\s*(published as a|formatting instructions|instructions for authors)\b|\d{4}\s*(©|\(c\))\b|copyright\b|vol\.?\s*\d|article\b|contents lists available\b|journal homepage\b|science\s?direct\b|elsevier\b|springer\b|ieee\b|acm\b|arxiv:\s*\d|preliminary version|do not cite|work in progress|draft version|preprint version|under review)\b/i
const JOURNAL_RUNNING_HEADER = /\b\w+\s+\d+\s*\(\d{4}\)\s*\d+\s*$/i
const TITLE_NOISE_ANYWHERE = /\b(formatting instructions|instructions for authors|published as a conference paper|preliminary version|do not cite|work in progress|draft version|preprint version)\b/i

function isTitleNoiseLine(line: string): boolean {
  const lower = line.toLowerCase()
  if (lower === 'arxiv' || lower.startsWith('arxiv:')) return true
  if (lower === 'abstract' || lower.startsWith('abstract')) return true
  if (lower.startsWith('http') || lower.startsWith('www.')) return true
  if (lower.startsWith('doi') || DOI_REGEX.test(line)) return true
  if (line.includes('@') && line.includes('.')) return true
  if (TITLE_NOISE_PATTERNS.test(line)) return true
  if (TITLE_NOISE_ANYWHERE.test(line)) return true
  if (JOURNAL_RUNNING_HEADER.test(line)) return true
  return false
}

function isLikelyTitleLine(line: string): boolean {
  if (line.length < 8) return false
  if (isTitleNoiseLine(line)) return false
  return true
}

const TITLE_CONTINUATION_END = /\b(for|and|the|of|with|using|via|in|on|to|a|an|from|by|as|over|into|towards|toward|based|via|through|across|against|with)\s*$/i
const ENDS_SENTENCE = /[.!?]$/

function looksLikeContinuation(prev: string, next: string): boolean {
  if (ENDS_SENTENCE.test(prev)) return false
  if (TITLE_CONTINUATION_END.test(prev)) return true
  if (/[:(\-—]$/.test(prev)) return true
  if (/^[a-z]/.test(next) && next.length < 80 && !/^(this|we|our|the|in|abstract)\b/i.test(next)) return true
  return false
}

const JOURNAL_HEADER_CONTEXT = /^(contents lists available|journal homepage|www\.)\b/i

function inJournalHeaderCluster(head: string[], i: number): boolean {
  for (let k = i + 1; k <= Math.min(head.length - 1, i + 3); k++) {
    if (JOURNAL_HEADER_CONTEXT.test(head[k])) return true
  }
  return false
}

export function extractTitleFromText(text: string): string | null {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  const head = lines.slice(0, 12)
  for (let i = 0; i < head.length; i++) {
    const line = head[i]
    if (!isLikelyTitleLine(line)) continue
    if (inJournalHeaderCluster(head, i)) continue
    const titleLines = [line]
    for (let j = i + 1; j < head.length && titleLines.length < 4; j++) {
      const next = head[j]
      if (!isLikelyTitleLine(next)) break
      const last = titleLines[titleLines.length - 1]
      if (!looksLikeContinuation(last, next)) break
      titleLines.push(next)
    }
    return titleLines.join(' ').replace(/\s+/g, ' ').trim()
  }
  return null
}

const POSTER_KEYWORDS = /\b(poster|slide[s]?|presentation|keynote|tutorial|syllabus|preface|foreword|table of contents|index|appendix|chapter)\b/i
const NOISE_TITLE_PATTERNS = /^(figure|fig\.?|table|tab\.?|algorithm|theorem|lemma|proof|equation|eq\.?|section|sec\.?)\s*\d+/i

export function looksLikePosterOrNonPaper(text: string): boolean {
  const head = text.slice(0, 600).toLowerCase()
  if (POSTER_KEYWORDS.test(head)) return true
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length < 12) return false
  const headLines = lines.slice(0, 40)
  const shortLines = headLines.filter((l) => l.length > 0 && l.length < 40)
  if (shortLines.length / headLines.length > 0.8 && !/abstract/i.test(head)) {
    return true
  }
  return false
}

export function isReliableTitle(title: string | null, text: string): boolean {
  if (!title || title.trim().length === 0) return false
  const trimmed = title.trim()
  if (trimmed.length < 8) return false
  if (trimmed.length > 300) return false
  if (NOISE_TITLE_PATTERNS.test(trimmed)) return false
  if (looksLikePosterOrNonPaper(text)) return false
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length
  if (wordCount < 2) return false
  const alphaRatio = (trimmed.match(/[a-zA-Z]/g) ?? []).length / trimmed.length
  if (alphaRatio < 0.5) return false
  if (DOI_REGEX.test(trimmed)) return false
  return true
}

export function titleFromFileName(fileName: string): string | null {
  let base = fileName.replace(/\.pdf$/i, '').trim()
  if (base.length === 0) return null
  base = base.replace(/[_]+/g, ' ')
  base = base.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  base = base.replace(/(\d{4})([A-Za-z])/g, '$1 $2')
  base = base.replace(/([A-Za-z])(\d{4})/g, '$1 $2')
  base = base.replace(/\s+/g, ' ').trim()
  if (base.length === 0) return null
  const words = base.split(' ').filter(Boolean)
  if (words.length === 0) return null
  if (/^\d+$/.test(words[0]) && words.length > 1) {
    words.shift()
  }
  const result = words.join(' ')
  if (result.length === 0) return null
  return result.charAt(0).toUpperCase() + result.slice(1)
}

export function normalizeAuthors(raw: string | null): string | null {
  if (!raw || raw.trim().length === 0) return null
  const parts = raw.split(';').map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return null
  return parts.map((p) => {
    if (p.includes(',')) return p
    const spaceIdx = p.lastIndexOf(' ')
    if (spaceIdx === -1) return p
    return p.slice(spaceIdx + 1) + ', ' + p.slice(0, spaceIdx)
  }).join('; ')
}

export function mergeMetadata(
  current: Document,
  fetched: Partial<Document>
): { patch: DocumentPatch; remoteValues: RemoteValues } {
  const editableFields: EditableField[] = [
    'title', 'authors', 'year', 'venue', 'volume', 'issue', 'pages',
    'abstract', 'keywords', 'url', 'doi', 'arxivId', 'note', 'affiliations'
  ]
  const patch: DocumentPatch = {}
  const remoteValues: RemoteValues = {}
  const edited = new Set(current.editedFields)

  for (const field of editableFields) {
    const fetchedVal = fetched[field]
    if (fetchedVal === undefined || fetchedVal === null) continue
    if (typeof fetchedVal === 'string' && fetchedVal.trim().length === 0) continue

    const source: MetadataSource = fetched.metadataSource ?? 'crossref'
    remoteValues[field] = { value: String(fetchedVal), source }

    if (edited.has(field)) {
      const currentVal = current[field]
      if (currentVal !== null && currentVal !== undefined && currentVal !== '') continue
    }

    patch[field] = fetchedVal
  }

  return { patch, remoteValues }
}

export function parseCrossrefMessage(msg: {
  title?: string[]
  author?: Array<{ family?: string; given?: string; name?: string; affiliation?: Array<{ name?: string }> }>
  'published-print'?: { 'date-parts'?: number[][] }
  'published-online'?: { 'date-parts'?: number[][] }
  'container-title'?: string[]
  volume?: string
  issue?: string
  page?: string
  abstract?: string
  subject?: string[]
  URL?: string
  DOI?: string
}): Partial<Document> | null {
  const title = msg.title?.[0] ?? null
  const authors = msg.author
    ? msg.author.map((a) => {
      const family = a.family ?? ''
      const given = a.given ?? ''
      if (family && given) return `${family}, ${given}`
      return a.name ?? ''
    }).filter(Boolean).join('; ')
    : null
  const affiliationSet = new Set<string>()
  if (msg.author) {
    for (const a of msg.author) {
      if (a.affiliation) {
        for (const aff of a.affiliation) {
          if (aff.name && aff.name.trim()) affiliationSet.add(aff.name.trim())
        }
      }
    }
  }
  const affiliations = affiliationSet.size > 0 ? Array.from(affiliationSet).join('; ') : null
  const dateParts = msg['published-print']?.['date-parts']?.[0] ?? msg['published-online']?.['date-parts']?.[0]
  const year = dateParts?.[0]?.toString() ?? null
  const venue = msg['container-title']?.[0] ?? null
  const normalizedVenue = venue ? normalizeVenue(venue) : null
  const volume = msg.volume ?? null
  const issue = msg.issue ?? null
  const pages = msg.page ?? null
  const abstractText = msg.abstract ?? null
  const keywords = msg.subject?.join(', ') ?? null
  const url = msg.URL ?? null
  const doiVal = msg.DOI ?? null

  const data: Partial<Document> = { metadataSource: 'crossref' as MetadataSource }
  if (title) data.title = title
  if (authors) data.authors = normalizeAuthors(authors)
  if (year) data.year = year
  if (normalizedVenue) data.venue = normalizedVenue
  if (volume) data.volume = volume
  if (issue) data.issue = issue
  if (pages) data.pages = pages
  if (abstractText) data.abstract = abstractText
  if (keywords) data.keywords = keywords
  if (url) data.url = url
  if (doiVal) data.doi = doiVal
  if (affiliations) data.affiliations = affiliations
  return Object.keys(data).length > 1 ? data : null
}

async function fetchCrossref(doi: string, mailto: string): Promise<{ data: Partial<Document> } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NET_TIMEOUT_MS)

  let body: { message?: Parameters<typeof parseCrossrefMessage>[0] }
  try {
    const userAgent = mailto
      ? `Refora/0.1 (mailto:${mailto})`
      : 'Refora/0.1 (mailto:support@refora.app)'
    const response = await net.fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': userAgent }
    })
    if (!response.ok) return null
    body = await response.json() as { message?: Parameters<typeof parseCrossrefMessage>[0] }
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
  }

  const msg = body.message
  if (!msg) return null
  const data = parseCrossrefMessage(msg)
  return data ? { data } : null
}

async function fetchCrossrefByTitle(title: string, mailto: string): Promise<{ data: Partial<Document>; confidence: number } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NET_TIMEOUT_MS)

  let body: { message?: { items?: Array<Parameters<typeof parseCrossrefMessage>[0]> } }
  try {
    const userAgent = mailto
      ? `Refora/0.1 (mailto:${mailto})`
      : 'Refora/0.1 (mailto:support@refora.app)'
    const params = new URLSearchParams({
      'query.title': title,
      rows: '3',
      select: 'title,author,container-title,volume,issue,page,published-print,published-online,subject,URL,DOI,abstract'
    })
    const response = await net.fetch(`https://api.crossref.org/works?${params.toString()}`, {
      signal: controller.signal,
      headers: { 'User-Agent': userAgent }
    })
    if (!response.ok) return null
    body = await response.json() as { message?: { items?: Array<Parameters<typeof parseCrossrefMessage>[0]> } }
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
  }

  const items = body.message?.items
  if (!items || items.length === 0) return null

  let best: { data: Partial<Document> | null; confidence: number } = { data: null, confidence: 0 }
  for (const item of items) {
    const data = parseCrossrefMessage(item)
    if (!data?.title) continue
    const confidence = titleSimilarity(title, data.title)
    if (confidence > best.confidence) best = { data, confidence }
  }
  if (!best.data) return null
  return { data: best.data, confidence: best.confidence }
}

const arxivXmlParser = new XMLParser({ parseTagValue: false, trimValues: true })

export interface ParsedArxivEntry {
  title: string
  authors: string | null
  year: string | null
  abstract: string | null
  id: string | null
  arxivId: string
  doi: string | null
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

export function parseArxivEntries(xml: string): ParsedArxivEntry[] {
  try {
    const parsed = arxivXmlParser.parse(xml) as Record<string, unknown>
    const feed = parsed?.feed
    if (!feed || typeof feed !== 'object') return []
    const feedObj = feed as Record<string, unknown>
    const entries = asArray(feedObj.entry as Record<string, unknown> | Record<string, unknown>[] | undefined)
    const result: ParsedArxivEntry[] = []
    for (const e of entries) {
      const title = typeof e.title === 'string' ? e.title.replace(/\s+/g, ' ').trim() : null
      const idValue = typeof e.id === 'string' ? e.id.trim() : null
      const arxivId = idValue ? normalizeArxivId(idValue) : null
      if (!title || !arxivId) continue

      const rawAuthors = asArray(e.author as Record<string, unknown> | Record<string, unknown>[] | undefined)
      const authors = rawAuthors
        .map((a) => (typeof a.name === 'string' ? a.name.trim() : ''))
        .filter(Boolean)
        .join('; ') || null
      const published = typeof e.published === 'string' ? e.published : null
      const year = published ? published.slice(0, 4) : null
      const abstract = typeof e.summary === 'string' ? e.summary.replace(/\s+/g, ' ').trim() : null
      const doi = nonEmptyString(e['arxiv:doi'])
      result.push({ title, authors, year, abstract, id: idValue, arxivId, doi })
    }
    return result
  } catch {
    return []
  }
}

export function parseArxivEntry(xml: string): ParsedArxivEntry | null {
  return parseArxivEntries(xml)[0] ?? null
}

async function fetchArxiv(id: string): Promise<{
  data: Partial<Document>
  confidence: number
  entry: ParsedArxivEntry
} | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NET_TIMEOUT_MS)

  let text: string
  try {
    const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`
    const response = await net.fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    text = await response.text()
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
  }

  const entry = parseArxivEntry(text)
  const requestedId = normalizeArxivId(id)
  if (!entry || !requestedId || baseArxivId(entry.arxivId) !== baseArxivId(requestedId)) return null

  const arxivUrl = entry.id ?? `https://arxiv.org/abs/${id}`

  return {
    data: {
      title: entry.title,
      authors: normalizeAuthors(entry.authors),
      year: entry.year,
      abstract: entry.abstract,
      url: arxivUrl,
      doi: entry.doi ?? undefined,
      metadataSource: 'arxiv' as MetadataSource
    },
    confidence: 1,
    entry
  }
}

function normalizeTitleForMatch(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitleForMatch(a)
  const nb = normalizeTitleForMatch(b)
  if (na.length === 0 || nb.length === 0) return 0
  if (na === nb) return 1

  const wordsA = na.split(' ').filter((w) => w.length > 0)
  const wordsB = nb.split(' ').filter((w) => w.length > 0)
  if (wordsA.length === 0 || wordsB.length === 0) return 0

  const setA = new Set(wordsA)
  const common = wordsB.filter((w) => setA.has(w)).length
  const minLen = Math.min(wordsA.length, wordsB.length)
  const overlap = common / minLen

  const shorter = na.length < nb.length ? na : nb
  const longer = na.length < nb.length ? nb : na
  let prefixScore = 0
  if (longer.startsWith(shorter)) {
    prefixScore = shorter.length / longer.length
  }

  let lengthPenalty = 1
  if (shorter.length < longer.length * 0.5) {
    lengthPenalty = shorter.length / (longer.length * 0.5)
  }

  return Math.max(overlap, prefixScore) * lengthPenalty
}

const TITLE_SIMILARITY_THRESHOLD = 0.6
const TITLE_USE_THRESHOLD = 0.75

function normalizeDoi(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi\s*:\s*/i, '')
    .toLowerCase()
  return normalized || null
}

function authorKeys(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(';')
    .map((author) => {
      const trimmed = author.trim().toLowerCase()
      const family = trimmed.includes(',')
        ? trimmed.slice(0, trimmed.indexOf(','))
        : trimmed.split(/\s+/).at(-1) ?? ''
      return family.replace(/[^a-z0-9]/g, '')
    })
    .filter(Boolean)
}

function authorsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = authorKeys(a)
  const right = authorKeys(b)
  if (left.length === 0 || right.length === 0) return false
  const rightSet = new Set(right)
  const overlap = left.filter((author) => rightSet.has(author)).length
  return overlap > 0 && (left[0] === right[0] || overlap / Math.min(left.length, right.length) >= 0.5)
}

export function isArxivCandidateVerified(
  reference: Pick<Partial<Document>, 'title' | 'authors' | 'year' | 'doi'>,
  candidate: ParsedArxivEntry,
  directIdEvidence = false
): boolean {
  const referenceDoi = normalizeDoi(reference.doi)
  const candidateDoi = normalizeDoi(candidate.doi)
  const canonicalArxivDoi = normalizeDoi(deriveDoiFromArxivId(candidate.arxivId))
  const referenceIsCanonicalArxivDoi = referenceDoi?.startsWith('10.48550/arxiv.') ?? false
  if (referenceIsCanonicalArxivDoi && referenceDoi !== canonicalArxivDoi) return false
  if (
    referenceDoi !== null &&
    candidateDoi !== null &&
    referenceDoi !== canonicalArxivDoi &&
    referenceDoi !== candidateDoi
  ) return false
  const doiMatch = referenceDoi !== null &&
    (referenceDoi === candidateDoi || referenceDoi === canonicalArxivDoi)
  const titleScore = reference.title
    ? titleSimilarity(reference.title, candidate.title)
    : 0

  if (doiMatch) return !reference.title || titleScore >= TITLE_SIMILARITY_THRESHOLD
  if (titleScore < TITLE_USE_THRESHOLD) return false
  if (directIdEvidence) return true

  const yearMatch = Boolean(reference.year && candidate.year && reference.year === candidate.year)
  return yearMatch || authorsMatch(reference.authors, candidate.authors)
}

export function titlesMatch(a: string, b: string): boolean {
  return titleSimilarity(a, b) >= TITLE_SIMILARITY_THRESHOLD
}

async function fetchDblpByTitle(title: string): Promise<{ data: Partial<Document>; confidence: number } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NET_TIMEOUT_MS)

  let body: {
    result?: {
      hits?: {
        hit?: Array<{
          '@score'?: string
          info?: {
            title?: string
            authors?: { author?: Array<{ text?: string }> | { text?: string } }
            year?: string
            venue?: string
            volume?: string
            pages?: string
            doi?: string
            ee?: string
            type?: string
          }
        }>
      }
    }
  }
  try {
    const url = `https://dblp.org/search/publ/api?q=${encodeURIComponent(title)}&format=json&h=1`
    const response = await net.fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Refora/0.1 (mailto:support@refora.app)' }
    })
    if (!response.ok) return null
    body = await response.json() as typeof body
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
  }

  const hits = body.result?.hits?.hit
  if (!hits || hits.length === 0) return null
  const hit = hits[0]
  const info = hit.info
  if (!info?.title) return null

  const confidence = titleSimilarity(title, info.title)
  if (confidence < TITLE_SIMILARITY_THRESHOLD) return null

  const rawAuthors = info.authors?.author
  let authors: string | null = null
  if (Array.isArray(rawAuthors)) {
    authors = rawAuthors.map((a) => a.text ?? '').filter(Boolean).join('; ') || null
  } else if (rawAuthors?.text) {
    authors = rawAuthors.text
  }

  const year = nonEmptyString(info.year) ?? null
  const venue = nonEmptyString(info.venue) ?? null
  const normalizedVenue = venue ? normalizeVenue(venue) : null
  const volume = nonEmptyString(info.volume) ?? null
  const pages = nonEmptyString(info.pages) ?? null
  const doi = nonEmptyString(info.doi) ?? null
  const ee = nonEmptyString(info.ee) ?? null
  const url2 = ee ?? doi ? (doi ? `https://doi.org/${doi}` : ee ?? null) : null

  const data: Partial<Document> = { metadataSource: 'dblp' as MetadataSource }
  data.title = info.title.replace(/\.\s*$/, '')
  if (authors) data.authors = normalizeAuthors(authors)
  if (year) data.year = year
  if (normalizedVenue) data.venue = normalizedVenue
  if (volume) data.volume = volume
  if (pages) data.pages = pages
  if (doi) data.doi = doi
  if (url2) data.url = url2

  return { data, confidence }
}

interface ArxivTitleResult {
  data: Partial<Document>
  confidence: number
  entry: ParsedArxivEntry
}

async function fetchArxivByTitle(title: string): Promise<ArxivTitleResult[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NET_TIMEOUT_MS)

  let text: string
  try {
    const url = `https://export.arxiv.org/api/query?search_query=ti:${encodeURIComponent(`"${title}"`)}&max_results=5`
    const response = await net.fetch(url, { signal: controller.signal })
    if (!response.ok) return []
    text = await response.text()
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
  }

  const candidates = parseArxivEntries(text)
  return candidates
    .map((candidate) => ({ candidate, score: titleSimilarity(title, candidate.title) }))
    .filter((entry) => entry.score >= TITLE_SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .map((entry) => ({
      data: {
        title: entry.candidate.title,
        authors: normalizeAuthors(entry.candidate.authors),
        year: entry.candidate.year,
        abstract: entry.candidate.abstract,
        url: entry.candidate.id,
        metadataSource: 'arxiv' as MetadataSource
      },
      confidence: entry.score,
      entry: entry.candidate
    }))
}

export async function findVerifiedArxivMetadata(
  reference: Pick<Partial<Document>, 'title' | 'authors' | 'year' | 'doi'>
): Promise<Partial<Document> | null> {
  if (!reference.title) return null
  const results = await fetchArxivByTitle(reference.title)
  const result = results.find((candidate) => isArxivCandidateVerified(reference, candidate.entry))
  if (!result) return null
  return {
    ...result.data,
    arxivId: result.entry.arxivId,
    doi: result.entry.doi ?? reference.doi
  }
}

export function createMetadataService(repos: Repositories, win: BrowserWindow | (() => BrowserWindow | null)) {
  let worker: ReturnType<typeof utilityProcess.fork> | null = null
  let workerKilled = false
  let destroyed = false
  let workerIdleTimer: ReturnType<typeof setTimeout> | null = null
  const pending = new Map<string, PendingRequest>()
  const jobQueue: MetadataJob[] = []
  let activeJobs = 0
  const MAX_CONCURRENT = 3
  let lastCrossrefMs = 0
  let lastArxivMs = 0
  let lastDblpMs = 0
  let arxivGateTail: Promise<void> = Promise.resolve()

  const getWin = (): BrowserWindow | null => {
    const w = typeof win === 'function' ? win() : win
    if (!w || w.isDestroyed()) return null
    return w
  }

  function emitFailedUpdate(docId: string): void {
    const w = getWin()
    if (!w) return
    const updated = repos.documents.get(docId)
    if (updated) emitDocumentUpdated(w, updated)
  }

  function scheduleIdleKill(): void {
    if (workerIdleTimer) clearTimeout(workerIdleTimer)
    workerIdleTimer = setTimeout(() => {
      if (pending.size === 0 && activeJobs === 0) {
        if (worker && !workerKilled) {
          logger.info('metadata-worker:idle-kill')
          worker.kill()
          workerKilled = true
          worker = null
        }
      }
    }, WORKER_IDLE_TIMEOUT_MS)
  }

  function ensureWorker(): ReturnType<typeof utilityProcess.fork> {
    if (workerIdleTimer) {
      clearTimeout(workerIdleTimer)
      workerIdleTimer = null
    }
    if (worker && !workerKilled) return worker
    worker = utilityProcess.fork(join(__dirname, 'worker/pdf-worker.js'), [], {
      serviceName: 'Metadata Worker',
      stdio: 'pipe'
    })
    workerKilled = false
    worker.on('message', (msg: WorkerResponse) => {
      logger.info(`metadata-worker:message corr=${msg.correlationId}${msg.error ? ` error=${msg.error.type}` : ''}`)
      const req = pending.get(msg.correlationId)
      if (req) {
        clearTimeout(req.timer)
        pending.delete(msg.correlationId)
        req.resolve(msg)
      }
    })
    worker.on('exit', (code) => {
      logger.warn(`metadata-worker:exit code=${code} pending=${pending.size}`)
      if (workerIdleTimer) {
        clearTimeout(workerIdleTimer)
        workerIdleTimer = null
      }
      for (const [, req] of pending) {
        clearTimeout(req.timer)
        req.reject(new Error('Metadata worker exited unexpectedly'))
      }
      pending.clear()
      worker = null
      workerKilled = true
    })
    if (worker.stderr) {
      worker.stderr.on('data', (chunk: Buffer) => {
        logger.error(`metadata-worker:stderr ${chunk.toString().trim()}`)
      })
    }
    logger.info('metadata-worker:started')
    return worker
  }

  function requestParse(filePath: string): Promise<WorkerResponse> {
    const w = ensureWorker()
    const correlationId = newId()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(correlationId)
        reject(new Error(`Metadata worker request timed out: ${filePath}`))
      }, WORKER_TIMEOUT_MS)
      pending.set(correlationId, { resolve, reject, timer })
      w.postMessage({ correlationId, filePath })
    })
  }

  async function rateGate(source: MetadataSource): Promise<void> {
    if (source === 'arxiv') {
      const turn = arxivGateTail.then(async () => {
        const elapsed = Date.now() - lastArxivMs
        if (elapsed < 3000) {
          await new Promise((r) => setTimeout(r, 3000 - elapsed))
        }
        lastArxivMs = Date.now()
      })
      arxivGateTail = turn.catch(() => undefined)
      await turn
    } else if (source === 'dblp') {
      const now = Date.now()
      const elapsed = now - lastDblpMs
      if (elapsed < 1000) {
        await new Promise((r) => setTimeout(r, 1000 - elapsed))
      }
      lastDblpMs = Date.now()
    } else {
      const now = Date.now()
      const elapsed = now - lastCrossrefMs
      if (elapsed < 1000) {
        await new Promise((r) => setTimeout(r, 1000 - elapsed))
      }
      lastCrossrefMs = Date.now()
    }
  }

  async function updateVerifiedArxivId(docId: string, input: string): Promise<Document> {
    const doc = repos.documents.get(docId)
    if (!doc) throw new RepoError('not_found', `document not found: ${docId}`)
    if (input.trim() === '') return repos.documents.update(docId, { arxivId: '' })

    const arxivId = normalizeArxivId(input)
    if (!arxivId) {
      throw new RepoError('invalid_arxiv_id', 'Invalid arXiv ID format', 'arxivId')
    }
    if (doc.arxivId === arxivId) return doc

    await rateGate('arxiv')
    let result: Awaited<ReturnType<typeof fetchArxiv>>
    try {
      result = await fetchArxiv(arxivId)
    } catch (error) {
      if (isNetworkError(error)) {
        throw new RepoError('arxiv_unreachable', 'Could not reach arXiv to verify this ID', 'arxivId')
      }
      throw error
    }
    if (!result) {
      throw new RepoError('invalid_arxiv_id', 'arXiv did not return a matching record', 'arxivId')
    }

    const urlArxivId = doc.url ? normalizeArxivId(doc.url) : null
    if (!isArxivCandidateVerified(doc, result.entry, urlArxivId === arxivId)) {
      throw new RepoError(
        'arxiv_metadata_mismatch',
        'The arXiv record does not match this paper metadata',
        'arxivId'
      )
    }
    return repos.documents.update(docId, { arxivId })
  }

  async function processJob(docId: string): Promise<void> {
    const doc = repos.documents.get(docId)
    if (!doc) {
      logger.warn(`metadata:processJob doc-not-found id=${docId}`)
      return
    }

    const existingStatus = doc.metadataStatus
    if (existingStatus === 'done') {
      logger.info(`metadata:processJob skip-done id=${docId}`)
      return
    }
    logger.info(`metadata:processJob start id=${docId} status=${existingStatus} path=${doc.filePath}`)

    let workerResponse: WorkerResponse
    try {
      workerResponse = await requestParse(doc.filePath)
    } catch (e) {
      if (destroyed) return
      logger.warn(`metadata:processJob parse-failed id=${docId}: ${e instanceof Error ? e.message : String(e)}`)
      repos.documents.incrementMetadataAttempts(docId)
      repos.documents.setMetadataStatus(docId, 'failed')
      emitFailedUpdate(docId)
      return
    }

    if (destroyed) return

    if (workerResponse.error) {
      logger.warn(`metadata:processJob worker-error id=${docId} type=${workerResponse.error.type} msg=${workerResponse.error.message}`)
      repos.documents.incrementMetadataAttempts(docId)
      repos.documents.setMetadataStatus(docId, 'failed')
      emitFailedUpdate(docId)
      return
    }

    const info = workerResponse.info ?? {}
    const text = workerResponse.text ?? ''
    const titleCandidate = workerResponse.titleCandidate ?? null

    let doi = extractDoiFromInfo(info)
    if (!doi) {
      doi = extractDoiFromText(text)
    }
    const arxivIdFromText = extractArxivFromText(text)
    const derivedDoi = !doi && arxivIdFromText ? deriveDoiFromArxivId(arxivIdFromText) : null
    logger.info(`metadata:processJob parsed id=${docId} doi=${doi} arxiv=${arxivIdFromText} textLen=${text.length} candidate=${JSON.stringify(titleCandidate).slice(0, 60)}`)

    const infoTitle = nonEmptyString(info['Title']) ?? nonEmptyString(info['title'])
    const candidateTitle = isReliableTitle(titleCandidate, text) ? titleCandidate : null
    const infoTitleIsTemplate = infoTitle !== null && isTemplateNoiseTitle(infoTitle)
    const effectiveInfoTitle = infoTitleIsTemplate ? null : infoTitle
    const textTitle = effectiveInfoTitle ?? candidateTitle ?? extractTitleFromText(text)
    const fileNameTitle = titleFromFileName(doc.fileName)
    const reliable = isReliableTitle(textTitle, text)
    const searchTitle = reliable ? textTitle : null
    const fallbackTitle = reliable ? (textTitle ?? fileNameTitle) : (fileNameTitle ?? textTitle)
    logger.info(`metadata:processJob title id=${docId} text=${JSON.stringify(textTitle).slice(0, 60)} candidate=${JSON.stringify(candidateTitle).slice(0, 60)} file=${JSON.stringify(fileNameTitle).slice(0, 60)} reliable=${reliable}`)

    let fetchedData: Partial<Document> | null = null
    let source: MetadataSource = 'pdf'
    let networkFailed = false

    if (doi) {
      await rateGate('crossref')
      const mailto = repos.settings.get<string>('crossrefMailto', '')
      let result: { data: Partial<Document> } | null = null
      try {
        result = await fetchCrossref(doi, mailto)
      } catch (e) {
        if (isNetworkError(e)) networkFailed = true
        else throw e
      }
      logger.info(`metadata:processJob crossref id=${docId} ok=${!!result}`)
      if (result) {
        fetchedData = result.data
        source = 'crossref'
      }
    }

    if (arxivIdFromText) {
      await rateGate('arxiv')
      let result: Awaited<ReturnType<typeof fetchArxiv>> = null
      try {
        result = await fetchArxiv(arxivIdFromText)
      } catch (e) {
        if (isNetworkError(e)) networkFailed = true
        else throw e
      }
      const arxivReference = {
        title: textTitle ?? fetchedData?.title ?? doc.title,
        authors: fetchedData?.authors ?? nonEmptyString(info['Author']) ?? doc.authors,
        year: fetchedData?.year ?? doc.year,
        doi: fetchedData?.doi ?? doi ?? doc.doi
      }
      const verified = result !== null &&
        isReliableTitle(result.data.title ?? null, text) &&
        isArxivCandidateVerified(arxivReference, result.entry, true)
      logger.info(`metadata:processJob arxiv id=${docId} ok=${!!result} verified=${verified}`)
      if (result && verified) {
        if (fetchedData) {
          fetchedData.arxivId = result.entry.arxivId
        } else {
          fetchedData = { ...result.data, arxivId: result.entry.arxivId }
          source = 'arxiv'
        }
      } else if (result && textTitle) {
        logger.info(`metadata:processJob arxiv id=${docId} mismatch title=${JSON.stringify(result.data.title).slice(0, 60)} vs text=${JSON.stringify(textTitle).slice(0, 60)}`)
      }
    }

    if (!fetchedData && searchTitle) {
      logger.info(`metadata:processJob title-search id=${docId} title=${JSON.stringify(searchTitle).slice(0, 80)}`)
      let weakMatch = false
      await rateGate('dblp')
      let dblpResult: { data: Partial<Document>; confidence: number } | null = null
      try {
        dblpResult = await fetchDblpByTitle(searchTitle)
      } catch (e) {
        if (isNetworkError(e)) networkFailed = true
        else throw e
      }
      logger.info(`metadata:processJob dblp id=${docId} ok=${!!dblpResult}${dblpResult ? ` confidence=${dblpResult.confidence.toFixed(2)}` : ''}`)
      if (dblpResult) {
        if (dblpResult.confidence >= TITLE_USE_THRESHOLD) {
          fetchedData = dblpResult.data
          source = 'dblp'
        } else {
          weakMatch = true
        }
      }
      if (!fetchedData) {
        await rateGate('arxiv')
        let arxivResults: Awaited<ReturnType<typeof fetchArxivByTitle>> = []
        try {
          arxivResults = await fetchArxivByTitle(searchTitle)
        } catch (e) {
          if (isNetworkError(e)) networkFailed = true
          else throw e
        }
        const reference = {
          title: searchTitle,
          authors: nonEmptyString(info['Author']) ?? doc.authors,
          year: doc.year,
          doi: doc.doi
        }
        const verifiedArxivResult = arxivResults.find((candidate) =>
          isArxivCandidateVerified(reference, candidate.entry)
        ) ?? null
        const arxivResult = verifiedArxivResult ?? arxivResults[0] ?? null
        logger.info(`metadata:processJob arxiv-title id=${docId} ok=${!!arxivResult}${arxivResult ? ` confidence=${arxivResult.confidence.toFixed(2)}` : ''}`)
        if (arxivResult) {
          if (arxivResult.confidence >= TITLE_USE_THRESHOLD) {
            fetchedData = {
              ...arxivResult.data,
              arxivId: verifiedArxivResult?.entry.arxivId
            }
            source = 'arxiv'
          } else {
            weakMatch = true
          }
        }
      }
      if (weakMatch) {
        logger.info(`metadata:processJob weak-match id=${docId} will use filename`)
      }
    }

    if (destroyed) return

    if (!fetchedData && networkFailed) {
      logger.info(`metadata:processJob network-failed id=${docId}`)
      repos.documents.incrementMetadataAttempts(docId)
      repos.documents.setMetadataStatus(docId, 'failed')
      emitFailedUpdate(docId)
      return
    }

    if (!fetchedData) {
      const authorsFromInfo = nonEmptyString(info['Author']) ?? nonEmptyString(info['author'])
      const finalTitle = fileNameTitle ?? fallbackTitle
      fetchedData = {
        title: finalTitle,
        authors: authorsFromInfo,
        metadataSource: 'pdf' as MetadataSource
      }
      source = 'pdf'
    }

    if (destroyed) return

    try {
      await supplementVenueFields(docId, fetchedData, {
        searchTitle,
        text,
        mailto: repos.settings.get<string>('crossrefMailto', '')
      })
    } catch (e) {
      if (!isNetworkError(e)) throw e
      logger.info(`metadata:processJob supplement-network-failed id=${docId}`)
    }

    if (destroyed) return

    let affiliationsFromText = false
    if (!fetchedData.affiliations) {
      const textAffiliations = extractAffiliationsFromText(text)
      if (textAffiliations) {
        fetchedData.affiliations = textAffiliations
        affiliationsFromText = true
      }
    }

    if (!fetchedData.abstract) {
      const textAbstract = extractAbstractFromText(text)
      if (textAbstract) {
        fetchedData.abstract = textAbstract
      }
    }

    if (!fetchedData.doi && derivedDoi) {
      fetchedData.doi = derivedDoi
    }

    if (destroyed) return

    const current = repos.documents.get(docId)
    if (!current) return

    const { patch, remoteValues } = mergeMetadata(current, fetchedData)
    if (affiliationsFromText && remoteValues.affiliations) {
      remoteValues.affiliations = { value: remoteValues.affiliations.value, source: 'pdf' }
    }
    if (remoteValues.arxivId) {
      remoteValues.arxivId = { value: remoteValues.arxivId.value, source: 'arxiv' }
    }
    logger.info(`metadata:processJob merge id=${docId} patchKeys=${Object.keys(patch).join(',') || 'none'} remoteKeys=${Object.keys(remoteValues).join(',') || 'none'} source=${source}`)
    repos.documents.applyMetadataFields(docId, patch, remoteValues, 'done', source)

    const updated = repos.documents.get(docId)
    const w = getWin()
    if (updated && w) {
      emitDocumentUpdated(w, updated)
    }

    if (!arxivIdFromText && fetchedData.title && fetchedData.doi) {
      void enrichVerifiedArxivId(docId, fetchedData).catch((error) => {
        logger.warn(`metadata:arxiv-crosscheck failed id=${docId}: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
  }

  async function enrichVerifiedArxivId(
    docId: string,
    reference: Pick<Partial<Document>, 'title' | 'authors' | 'year' | 'doi'>
  ): Promise<void> {
    await rateGate('arxiv')
    const result = await findVerifiedArxivMetadata(reference)
    if (!result?.arxivId || destroyed) return
    const current = repos.documents.get(docId)
    if (!current || current.arxivId) return
    const { patch, remoteValues } = mergeMetadata(current, {
      arxivId: result.arxivId,
      metadataSource: 'arxiv'
    })
    const combinedRemoteValues = {
      ...(current.remoteValues ?? {}),
      ...remoteValues
    }
    const updated = repos.documents.applyMetadataFields(
      docId,
      patch,
      combinedRemoteValues,
      current.metadataStatus,
      null
    )
    const w = getWin()
    if (w) emitDocumentUpdated(w, updated)
    logger.info(`metadata:arxiv-crosscheck id=${docId} arxiv=${result.arxivId}`)
  }

  async function supplementVenueFields(
    docId: string,
    fetchedData: Partial<Document>,
    ctx: { searchTitle: string | null; text: string; mailto: string }
  ): Promise<void> {
    const hasVenue = nonEmptyString(fetchedData.venue) !== null
    const hasVolume = nonEmptyString(fetchedData.volume) !== null
    const hasYear = nonEmptyString(fetchedData.year) !== null
    const hasDoi = nonEmptyString(fetchedData.doi) !== null
    const hasIssue = nonEmptyString(fetchedData.issue) !== null
    const hasPages = nonEmptyString(fetchedData.pages) !== null

    if (hasVenue && hasVolume && hasYear && hasDoi) return

    if (!hasVenue) {
      const banner = extractVenueFromText(ctx.text)
      if (banner) {
        logger.info(`metadata:processJob venue-banner id=${docId} venue=${banner.venue} year=${banner.year}`)
        fetchedData.venue = banner.venue
        if (!hasYear) fetchedData.year = banner.year
        return
      }
    }

    if (!ctx.searchTitle) return

    await rateGate('crossref')
    const result = await fetchCrossrefByTitle(ctx.searchTitle, ctx.mailto)
    logger.info(`metadata:processJob crossref-title id=${docId} ok=${!!result}${result ? ` confidence=${result.confidence.toFixed(2)}` : ''}`)
    if (!result || result.confidence < TITLE_USE_THRESHOLD) return

    const cr = result.data
    const fillingVenue = !hasVenue && cr.venue !== undefined
    if (fillingVenue) {
      fetchedData.venue = cr.venue
      if (cr.year) fetchedData.year = cr.year
    }
    if (!hasVolume && cr.volume) fetchedData.volume = cr.volume
    if (!hasIssue && cr.issue) fetchedData.issue = cr.issue
    if (!hasPages && cr.pages) fetchedData.pages = cr.pages
    if (!hasDoi && cr.doi) fetchedData.doi = cr.doi
    if (!fetchedData.abstract && cr.abstract) fetchedData.abstract = cr.abstract
    if (!fetchedData.keywords && cr.keywords) fetchedData.keywords = cr.keywords
  }

  function processQueue(): void {
    if (destroyed) return
    while (activeJobs < MAX_CONCURRENT && jobQueue.length > 0) {
      const job = jobQueue.shift()
      if (!job) break
      activeJobs++
      job()
        .catch((e) => {
          logger.error(`metadata:job-error: ${e instanceof Error ? e.message : String(e)}`)
        })
        .finally(() => {
          activeJobs--
          if (activeJobs === 0 && jobQueue.length === 0) {
            scheduleIdleKill()
          }
          processQueue()
        })
    }
  }

  function enqueue(docId: string): void {
    const doc = repos.documents.get(docId)
    if (!doc) return
    if (doc.metadataStatus === 'done') return

    jobQueue.push(async () => {
      await processJob(docId)
    })
    processQueue()
  }

  function refreshMetadata(docId: string): void {
    repos.documents.setMetadataStatus(docId, 'pending')
    enqueue(docId)
  }

  function bulkRefreshMetadata(ids: string[]): void {
    for (const id of ids) {
      repos.documents.setMetadataStatus(id, 'pending')
      enqueue(id)
    }
  }

  function resumeOnStartup(): void {
    const rows = repos.documents.getResumableMetadataRows()
    logger.info(`metadata:resume ${rows.length} rows`)
    for (const row of rows) {
      enqueue(row.id)
    }
  }

  function destroy(): void {
    destroyed = true
    if (workerIdleTimer) {
      clearTimeout(workerIdleTimer)
      workerIdleTimer = null
    }
    for (const [, req] of pending) {
      clearTimeout(req.timer)
      req.reject(new Error('Metadata service destroyed'))
    }
    pending.clear()
    if (worker && !workerKilled) {
      worker.kill()
      workerKilled = true
      worker = null
    }
    jobQueue.length = 0
  }

  return {
    enqueue,
    updateVerifiedArxivId,
    refreshMetadata,
    bulkRefreshMetadata,
    resumeOnStartup,
    destroy
  }
}
