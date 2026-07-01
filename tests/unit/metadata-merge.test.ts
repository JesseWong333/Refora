import { describe, it, expect } from 'vitest'
import {
  mergeMetadata,
  extractDoiFromText,
  extractDoiFromInfo,
  extractArxivFromText,
  normalizeAuthors
} from '../../src/main/services/metadata'
import type { Document, EditableField } from '../../src/shared/ipc-types'

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'test-1',
    filePath: '/abs/test.pdf',
    originalFolderPath: '/abs',
    fileName: 'test.pdf',
    fileSize: 100,
    fileHash: null,
    title: 'Original Title',
    authors: 'Smith, John',
    year: '2020',
    venue: 'Original Venue',
    volume: null,
    abstract: null,
    keywords: null,
    url: null,
    doi: null,
    note: null,
    starred: 0,
    addedAt: 1000,
    lastReadAt: null,
    updatedAt: 1000,
    metadataSource: null,
    metadataStatus: 'pending',
    metadataAttempts: 0,
    editedFields: [],
    remoteValues: null,
    fileMissing: 0,
    ...overrides
  }
}

describe('mergeMetadata', () => {
  it('fills empty fields from fetched data', () => {
    const current = makeDoc({ title: null, year: null })
    const fetched = { title: 'New Title', year: '2024', metadataSource: 'crossref' as const }
    const { patch, remoteValues } = mergeMetadata(current, fetched)
    expect(patch.title).toBe('New Title')
    expect(patch.year).toBe('2024')
    expect(remoteValues.title?.value).toBe('New Title')
    expect(remoteValues.year?.value).toBe('2024')
  })

  it('does not overwrite editedFields when the current value is non-empty', () => {
    const current = makeDoc({
      title: 'User Edited Title',
      editedFields: ['title' as EditableField]
    })
    const fetched = { title: 'Fetched Title', metadataSource: 'crossref' as const }
    const { patch, remoteValues } = mergeMetadata(current, fetched)
    expect(patch.title).toBeUndefined()
    expect(remoteValues.title?.value).toBe('Fetched Title')
  })

  it('overwrites edited field when current value is empty (user cleared it)', () => {
    const current = makeDoc({
      title: '',
      editedFields: [] as EditableField[]
    })
    const fetched = { title: 'Fetched Title', metadataSource: 'crossref' as const }
    const { patch } = mergeMetadata(current, fetched)
    expect(patch.title).toBe('Fetched Title')
  })

  it('overwrites edited field when current value is null (never set)', () => {
    const current = makeDoc({
      title: null,
      editedFields: ['title' as EditableField]
    })
    const fetched = { title: 'Fetched Title', metadataSource: 'crossref' as const }
    const { patch } = mergeMetadata(current, fetched)
    expect(patch.title).toBe('Fetched Title')
  })

  it('overwrites non-edited fields with new fetched values', () => {
    const current = makeDoc({
      title: 'Old Title',
      venue: 'Old Venue',
      editedFields: ['venue' as EditableField]
    })
    const fetched = { title: 'New Title', venue: 'New Venue', metadataSource: 'crossref' as const }
    const { patch } = mergeMetadata(current, fetched)
    expect(patch.title).toBe('New Title')
    expect(patch.venue).toBeUndefined()
  })

  it('always writes fetched values to remoteValues regardless of merge', () => {
    const current = makeDoc({
      title: 'User Title',
      editedFields: ['title' as EditableField]
    })
    const fetched = { title: 'Fetched Title', year: '2024', metadataSource: 'crossref' as const }
    const { remoteValues } = mergeMetadata(current, fetched)
    expect(remoteValues.title?.value).toBe('Fetched Title')
    expect(remoteValues.year?.value).toBe('2024')
    expect(remoteValues.year?.source).toBe('crossref')
  })

  it('skips null/undefined fetched values', () => {
    const current = makeDoc({ title: null })
    const fetched = { title: null, year: '2024', metadataSource: 'crossref' as const }
    const { patch } = mergeMetadata(current, fetched)
    expect(patch.title).toBeUndefined()
    expect(patch.year).toBe('2024')
  })
})

describe('normalizeAuthors', () => {
  it('normalizes "Given Family" to "Family, Given"', () => {
    expect(normalizeAuthors('John Smith')).toBe('Smith, John')
  })

  it('keeps "Family, Given" format unchanged', () => {
    expect(normalizeAuthors('Smith, John')).toBe('Smith, John')
  })

  it('handles semicolon-separated authors', () => {
    expect(normalizeAuthors('John Smith; Jane Doe')).toBe('Smith, John; Doe, Jane')
  })

  it('handles comma-separated author list as semicolons', () => {
    const result = normalizeAuthors('Smith, John; Doe, Jane')
    expect(result).toBe('Smith, John; Doe, Jane')
  })

  it('returns null for empty/whitespace input', () => {
    expect(normalizeAuthors('')).toBeNull()
    expect(normalizeAuthors('  ')).toBeNull()
    expect(normalizeAuthors(null)).toBeNull()
  })

  it('keeps single-name authors', () => {
    expect(normalizeAuthors('Aristotle')).toBe('Aristotle')
  })
})

describe('DOI extraction', () => {
  it('extracts DOI from info dict with priority over text', () => {
    const info = { doi: '10.1234/from-info' }
    const text = 'This document contains DOI: 10.5678/from-text'
    expect(extractDoiFromInfo(info)).toBe('10.1234/from-info')
    expect(extractDoiFromText(text)).toBe('10.5678/from-text')
  })

  it('ignores DOIs after references heading in text', () => {
    const text = `Title page text with DOI: 10.1234/main-doi
References
1. Some paper. DOI: 10.5678/cited-doi`
    const doi = extractDoiFromText(text)
    expect(doi).toBe('10.1234/main-doi')
  })

  it('handles Chinese references heading 参考文献', () => {
    const text = `Abstract text with DOI: 10.1234/main
参考文献
[1] Author. DOI: 10.5678/ref`
    const doi = extractDoiFromText(text)
    expect(doi).toBe('10.1234/main')
  })

  it('handles "References" heading case-insensitively', () => {
    const text = `DOI: 10.1234/main
REFERENCES
DOI: 10.5678/ref`
    const doi = extractDoiFromText(text)
    expect(doi).toBe('10.1234/main')
  })

  it('handles "bibliography" heading', () => {
    const text = `DOI: 10.1234/main
Bibliography
DOI: 10.5678/ref`
    const doi = extractDoiFromText(text)
    expect(doi).toBe('10.1234/main')
  })

  it('picks the topmost DOI match when no reference section', () => {
    const text = `First DOI: 10.1234/first
Second DOI: 10.5678/second`
    const doi = extractDoiFromText(text)
    expect(doi).toBe('10.1234/first')
  })

  it('returns null when no DOI found', () => {
    expect(extractDoiFromText('No DOI here')).toBeNull()
    expect(extractDoiFromInfo({})).toBeNull()
  })

  it('handles lowercase doi in info dict', () => {
    expect(extractDoiFromInfo({ doi: '10.1234/test' })).toBe('10.1234/test')
  })

  it('handles uppercase DOI in info dict', () => {
    expect(extractDoiFromInfo({ DOI: '10.1234/upper' })).toBe('10.1234/upper')
  })

  it('handles mixed case Doi in info dict', () => {
    expect(extractDoiFromInfo({ Doi: '10.1234/mixed' })).toBe('10.1234/mixed')
  })
})

describe('arXiv extraction', () => {
  it('extracts arXiv ID with arxiv: prefix', () => {
    const text = 'This paper is also available as arxiv:2301.12345'
    const id = extractArxivFromText(text)
    expect(id).toBe('2301.12345')
  })

  it('extracts arXiv ID from arxiv.org URL', () => {
    const text = 'Preprint at https://arxiv.org/abs/2301.12345v1'
    const id = extractArxivFromText(text)
    expect(id).toBe('2301.12345v1')
  })

  it('returns null when no arXiv ID found', () => {
    expect(extractArxivFromText('No arXiv ID here')).toBeNull()
  })
})
