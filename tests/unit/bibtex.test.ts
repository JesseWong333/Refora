import { describe, it, expect } from 'vitest'
import { toBibtex } from '../../src/main/services/export'
import type { Document } from '../../src/shared/ipc-types'

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: overrides.id ?? 'test-id-1234',
    filePath: '/test.pdf',
    originalFolderPath: '/',
    fileName: 'test.pdf',
    fileSize: 1000,
    fileHash: 'abc',
    title: null,
    authors: null,
    year: null,
    venue: null,
    volume: null,
    abstract: null,
    keywords: null,
    url: null,
    doi: null,
    note: null,
    starred: 0,
    addedAt: Date.now(),
    lastReadAt: null,
    updatedAt: Date.now(),
    metadataSource: null,
    metadataStatus: 'pending',
    metadataAttempts: 0,
    editedFields: [],
    remoteValues: null,
    fileMissing: 0,
    ...overrides
  }
}

describe('toBibtex', () => {
  it('returns empty string for empty array', () => {
    expect(toBibtex([])).toBe('')
  })

  it('generates @misc for doc without venue/volume', () => {
    const doc = makeDoc({ title: 'Test', authors: 'Doe, John', year: '2020' })
    const result = toBibtex([doc])
    expect(result).toContain('@misc{')
    expect(result).not.toContain('@article{')
  })

  it('generates @article for doc with venue', () => {
    const doc = makeDoc({ title: 'Test', authors: 'Doe, John', year: '2020', venue: 'Nature' })
    const result = toBibtex([doc])
    expect(result).toContain('@article{')
  })

  it('generates @article for doc with volume', () => {
    const doc = makeDoc({ title: 'Test', authors: 'Doe, John', year: '2020', volume: '42' })
    const result = toBibtex([doc])
    expect(result).toContain('@article{')
  })

  it('builds citekey from first author last name + year + title word', () => {
    const doc = makeDoc({ title: 'A novel approach to testing', authors: 'Smith, Alice; Jones, Bob', year: '2023' })
    const result = toBibtex([doc])
    expect(result).toContain('smith2023novel')
  })

  it('falls back to id slug when no author/year/title', () => {
    const doc = makeDoc({ id: 'abc12345-6789', title: '', authors: null, year: null, doi: '10.1234/fallback' })
    const result = toBibtex([doc])
    expect(result).toContain('@misc{abc12345')
    expect(result).toContain('doi')
  })

  it('deduplicates citekeys with suffix', () => {
    const doc1 = makeDoc({ id: '1', title: 'A novel method', authors: 'Doe, John', year: '2020' })
    const doc2 = makeDoc({ id: '2', title: 'A novel method part 2', authors: 'Doe, John', year: '2020' })
    const doc3 = makeDoc({ id: '3', title: 'A novel method part 3', authors: 'Doe, John', year: '2020' })
    const result = toBibtex([doc1, doc2, doc3])
    expect(result).toContain('doe2020novel,')
    expect(result).toContain('doe2020novela,')
    expect(result).toContain('doe2020novelb,')
  })

  it('formats authors as Family, Given joined with and', () => {
    const doc = makeDoc({ authors: 'Smith, Alice; Jones, Bob' })
    const result = toBibtex([doc])
    expect(result).toContain('author')
    expect(result).toContain('Smith, Alice and Jones, Bob')
  })

  it('omits empty fields', () => {
    const doc = makeDoc({ title: 'Only Title' })
    const result = toBibtex([doc])
    expect(result).not.toContain('author')
    expect(result).not.toContain('year')
    expect(result).not.toContain('journal')
  })

  it('includes all available fields', () => {
    const doc = makeDoc({
      title: 'Full Paper',
      authors: 'Doe, John',
      year: '2024',
      venue: 'Test Journal',
      volume: '10',
      abstract: 'An abstract.',
      keywords: 'key1, key2',
      url: 'https://example.com',
      doi: '10.1234/test'
    })
    const result = toBibtex([doc])
    expect(result).toContain('title')
    expect(result).toContain('author')
    expect(result).toContain('year')
    expect(result).toContain('journal')
    expect(result).toContain('volume')
    expect(result).toContain('abstract')
    expect(result).toContain('keywords')
    expect(result).toContain('url')
    expect(result).toContain('doi')
  })

  it('escapes special characters in values', () => {
    const doc = makeDoc({ title: 'Test {with} %braces & #special' })
    const result = toBibtex([doc])
    expect(result).toContain('\\{')
    expect(result).toContain('\\}')
    expect(result).toContain('\\%')
    expect(result).toContain('\\#')
  })

  it('braces non-ASCII characters', () => {
    const doc = makeDoc({ title: 'M\u00F6bius transformations' })
    const result = toBibtex([doc])
    expect(result).toContain('{ö}')
  })

  it('skips docs with no fields', () => {
    const doc = makeDoc({ title: null, authors: null, year: null, venue: null, volume: null })
    const result = toBibtex([doc])
    expect(result).toBe('')
  })

  it('generates 3 entries for 3 docs', () => {
    const docs = [makeDoc({ id: 'a', title: 'A' }), makeDoc({ id: 'b', title: 'B' }), makeDoc({ id: 'c', title: 'C' })]
    const result = toBibtex(docs)
    const entryCount = (result.match(/^@/gm) || []).length
    expect(entryCount).toBe(3)
  })
})
