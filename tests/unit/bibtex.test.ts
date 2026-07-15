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
    issue: null,
    pages: null,
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
    expect(result).toContain('keywords')
    expect(result).toContain('url')
    expect(result).toContain('doi')
    expect(result).not.toContain('abstract')
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

  it('generates @inproceedings with booktitle for a conference venue', () => {
    const doc = makeDoc({ title: 'YOLO', authors: 'Redmon, Joseph', year: '2016', venue: 'CVPR' })
    const result = toBibtex([doc])
    expect(result).toContain('@inproceedings{')
    expect(result).not.toContain('@article{')
    expect(result).toContain('booktitle')
    expect(result).not.toContain('journal')
  })

  it('generates @inproceedings for ICLR/NeurIPS/ICML venues', () => {
    for (const venue of ['ICLR', 'NeurIPS', 'ICML']) {
      const doc = makeDoc({ title: 'Paper', authors: 'Doe, Jane', year: '2020', venue })
      expect(toBibtex([doc])).toContain('@inproceedings{')
    }
  })

  it('generates @article with journal for a journal venue', () => {
    const doc = makeDoc({ title: 'Test', authors: 'Doe, John', year: '2020', venue: 'IEEE Transactions on Pattern Analysis' })
    const result = toBibtex([doc])
    expect(result).toContain('@article{')
    expect(result).toContain('journal')
    expect(result).not.toContain('booktitle')
  })

  it('includes pages and number (issue) fields when present', () => {
    const doc = makeDoc({
      title: 'Journal Paper',
      authors: 'Doe, John',
      year: '2024',
      venue: 'Test Journal',
      volume: '10',
      issue: '3',
      pages: '100--120'
    })
    const result = toBibtex([doc])
    expect(result).toContain('pages')
    expect(result).toContain('100--120')
    expect(result).toContain('number')
    expect(result).toContain('3')
  })

  it('uses pages and booktitle together for a conference paper', () => {
    const doc = makeDoc({
      title: 'Conf Paper',
      authors: 'Doe, John',
      year: '2024',
      venue: 'ICCV',
      pages: '1--10'
    })
    const result = toBibtex([doc])
    expect(result).toContain('@inproceedings{')
    expect(result).toContain('booktitle')
    expect(result).toContain('pages')
  })

  it('generates @misc when only a title and doi are present', () => {
    const doc = makeDoc({ title: 'Preprint', authors: 'Doe, John', year: '2024', doi: '10.1234/preprint' })
    const result = toBibtex([doc])
    expect(result).toContain('@misc{')
  })

  it('classifies verbose AAAI proceedings as @inproceedings with canonical booktitle', () => {
    const doc = makeDoc({
      title: 'Some Paper',
      authors: 'Doe, John',
      year: '2023',
      venue: 'Proceedings of the AAAI Conference on Artificial Intelligence',
      pages: '100--108'
    })
    const result = toBibtex([doc])
    expect(result).toContain('@inproceedings{')
    expect(result).not.toContain('@article{')
    expect(result).toContain('booktitle')
    expect(result).toContain('AAAI')
  })

  it('normalizes verbose CVPR venue to canonical booktitle', () => {
    const doc = makeDoc({
      title: 'Paper',
      authors: 'Doe, John',
      year: '2016',
      venue: '2016 IEEE Conference on Computer Vision and Pattern Recognition (CVPR)'
    })
    const result = toBibtex([doc])
    expect(result).toContain('@inproceedings{')
    expect(result).toContain('booktitle')
    expect(result).toContain('{CVPR}')
  })

  it('classifies IEEE Transactions journal as @article with journal field', () => {
    const doc = makeDoc({
      title: 'Paper',
      authors: 'Doe, John',
      year: '2020',
      venue: 'IEEE Transactions on Pattern Analysis and Machine Intelligence',
      volume: '42',
      issue: '5',
      pages: '100--120'
    })
    const result = toBibtex([doc])
    expect(result).toContain('@article{')
    expect(result).toContain('journal')
    expect(result).toContain('number')
    expect(result).toContain('pages')
  })

  it('does not include abstract in the exported entry', () => {
    const doc = makeDoc({
      title: 'Paper',
      authors: 'Doe, John',
      year: '2020',
      venue: 'CVPR',
      abstract: 'A long abstract that should not appear in the bib output.'
    })
    const result = toBibtex([doc])
    expect(result).not.toContain('abstract')
    expect(result).not.toContain('A long abstract')
  })
})
