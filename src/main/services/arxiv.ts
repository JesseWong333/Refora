import { XMLParser } from 'fast-xml-parser'

const ARXIV_MODERN_ID = /^\d{4}\.\d{4,5}(?:v\d+)?$/i
const ARXIV_LEGACY_ID = /^[a-z-]+(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?$/i

const arxivXmlParser = new XMLParser({
  parseTagValue: false,
  trimValues: true,
  ignoreAttributes: false,
  attributeNamePrefix: ''
})

export interface ParsedArxivEntry {
  title: string
  authors: string | null
  year: string | null
  abstract: string | null
  id: string | null
  arxivId: string
  doi: string | null
  published: string | null
  updated: string | null
  categories: string[]
}

export interface ParsedArxivFeed {
  total: number
  entries: ParsedArxivEntry[]
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

export function normalizeArxivId(input: string): string | null {
  let value = input.trim()
  value = value.replace(/^arxiv\s*:\s*/i, '')
  value = value.replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf|html)\//i, '')
  value = value.split(/[?#]/, 1)[0] ?? ''
  value = value.replace(/\.pdf$/i, '')
  if (!ARXIV_MODERN_ID.test(value) && !ARXIV_LEGACY_ID.test(value)) return null
  return value.replace(/v(\d+)$/i, 'v$1')
}

export function baseArxivId(arxivId: string): string {
  return arxivId.replace(/v\d+$/i, '')
}

export function parseArxivFeed(xml: string): ParsedArxivFeed {
  try {
    const parsed = arxivXmlParser.parse(xml) as Record<string, unknown>
    const feed = parsed.feed
    if (!feed || typeof feed !== 'object') return { total: 0, entries: [] }
    const feedObj = feed as Record<string, unknown>
    const rawTotal = feedObj['opensearch:totalResults']
    const totalValue = typeof rawTotal === 'string' || typeof rawTotal === 'number'
      ? Number.parseInt(String(rawTotal), 10)
      : 0
    const entries = asArray(
      feedObj.entry as Record<string, unknown> | Record<string, unknown>[] | undefined
    )
    const result: ParsedArxivEntry[] = []

    for (const entry of entries) {
      const title = typeof entry.title === 'string'
        ? entry.title.replace(/\s+/g, ' ').trim()
        : null
      const idValue = typeof entry.id === 'string' ? entry.id.trim() : null
      const arxivId = idValue ? normalizeArxivId(idValue) : null
      if (!title || !arxivId) continue

      const rawAuthors = asArray(
        entry.author as Record<string, unknown> | Record<string, unknown>[] | undefined
      )
      const authors = rawAuthors
        .map((author) => (typeof author.name === 'string' ? author.name.trim() : ''))
        .filter(Boolean)
        .join('; ') || null
      const published = nonEmptyString(entry.published)
      const updated = nonEmptyString(entry.updated)
      const categories = asArray(
        entry.category as Record<string, unknown> | Record<string, unknown>[] | undefined
      )
        .map((category) => nonEmptyString(category.term))
        .filter((category): category is string => category !== null)

      result.push({
        title,
        authors,
        year: published?.slice(0, 4) ?? null,
        abstract: typeof entry.summary === 'string'
          ? entry.summary.replace(/\s+/g, ' ').trim()
          : null,
        id: idValue,
        arxivId,
        doi: nonEmptyString(entry['arxiv:doi']),
        published,
        updated,
        categories
      })
    }

    return {
      total: Number.isFinite(totalValue) ? totalValue : result.length,
      entries: result
    }
  } catch {
    return { total: 0, entries: [] }
  }
}

export function parseArxivEntries(xml: string): ParsedArxivEntry[] {
  return parseArxivFeed(xml).entries
}

export function parseArxivEntry(xml: string): ParsedArxivEntry | null {
  return parseArxivEntries(xml)[0] ?? null
}
