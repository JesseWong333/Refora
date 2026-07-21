import { describe, it, expect } from 'vitest'
import {
  mergeMetadata,
  extractDoiFromText,
  extractDoiFromInfo,
  extractArxivFromText,
  isArxivCandidateVerified,
  normalizeArxivId,
  normalizeAuthors,
  parseArxivEntry,
  titlesMatch,
  titleSimilarity,
  titleFromFileName,
  isReliableTitle,
  looksLikePosterOrNonPaper
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
    issue: null,
    pages: null,
    abstract: null,
    keywords: null,
    url: null,
    doi: null,
    arxivId: null,
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

  it('skips empty/whitespace-only fetched values so they do not clobber real data', () => {
    const current = makeDoc({ title: 'Real Title From Somewhere' })
    const fetched = {
      title: '',
      authors: '   ',
      year: '2024',
      metadataSource: 'pdf' as const
    }
    const { patch, remoteValues } = mergeMetadata(current, fetched)
    expect(patch.title).toBeUndefined()
    expect(patch.authors).toBeUndefined()
    expect(patch.year).toBe('2024')
    expect(remoteValues.title).toBeUndefined()
    expect(remoteValues.authors).toBeUndefined()
    expect(remoteValues.year?.value).toBe('2024')
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

  it('normalizes modern and legacy arXiv identifiers', () => {
    expect(normalizeArxivId('arXiv:2401.12345v2')).toBe('2401.12345v2')
    expect(normalizeArxivId('https://arxiv.org/pdf/hep-th/9901001v3.pdf')).toBe('hep-th/9901001v3')
    expect(normalizeArxivId('not-an-arxiv-id')).toBeNull()
  })

  it('parses the canonical ID and DOI from an arXiv Atom entry', () => {
    const entry = parseArxivEntry(`<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
      <entry>
        <title>Verified Paper</title>
        <author><name>Jane Doe</name></author>
        <published>2024-01-01T00:00:00Z</published>
        <summary>Abstract</summary>
        <id>https://arxiv.org/abs/2401.12345v2</id>
        <arxiv:doi>10.1000/verified</arxiv:doi>
      </entry>
    </feed>`)

    expect(entry).toMatchObject({
      arxivId: '2401.12345v2',
      doi: '10.1000/verified'
    })
  })

  it('requires a DOI match or title plus a second metadata signal', () => {
    const candidate = {
      title: 'Verified Paper',
      authors: 'Jane Doe; John Smith',
      year: '2024',
      abstract: null,
      id: 'https://arxiv.org/abs/2401.12345',
      arxivId: '2401.12345',
      doi: '10.1000/verified'
    }

    expect(isArxivCandidateVerified({
      title: 'Verified Paper',
      authors: 'Doe, Jane',
      year: '2023',
      doi: null
    }, candidate)).toBe(true)
    expect(isArxivCandidateVerified({
      title: 'Unrelated local title',
      authors: null,
      year: null,
      doi: '10.1000/verified'
    }, candidate)).toBe(false)
    expect(isArxivCandidateVerified({
      title: 'Verified Paper',
      authors: null,
      year: null,
      doi: null
    }, candidate)).toBe(false)
    expect(isArxivCandidateVerified({
      title: 'Verified Paper',
      authors: null,
      year: null,
      doi: '10.1000/verified'
    }, candidate)).toBe(true)
    expect(isArxivCandidateVerified({
      title: 'Verified Paper',
      authors: 'Doe, Jane',
      year: '2024',
      doi: '10.1000/different'
    }, candidate)).toBe(false)
    expect(isArxivCandidateVerified({
      title: 'Verified Paper',
      authors: 'Doe, Jane',
      year: '2024',
      doi: '10.48550/arXiv.2401.99999'
    }, { ...candidate, doi: null })).toBe(false)
  })
})

describe('titlesMatch', () => {
  it('matches identical titles', () => {
    expect(titlesMatch('Cross-view Transformers', 'Cross-view Transformers')).toBe(true)
  })

  it('matches ignoring trailing period and case', () => {
    expect(titlesMatch(
      'Cross-view Transformers for real-time Map-view Semantic Segmentation',
      'Cross-view Transformers for real-time Map-view Semantic Segmentation.'
    )).toBe(true)
  })

  it('matches when one title is a prefix of the other (subtitle split)', () => {
    expect(titlesMatch(
      'SCube: Instant Large-Scale Scene Reconstruction',
      'SCube: Instant Large-Scale Scene Reconstruction using VoxSplats'
    )).toBe(true)
  })

  it('matches with high word overlap even if not prefix', () => {
    expect(titlesMatch(
      'Attention Is All You Need',
      'Attention Is All You Need: a transformer model'
    )).toBe(true)
  })

  it('rejects unrelated titles', () => {
    expect(titlesMatch(
      'Cross-view Transformers for real-time Map-view Semantic Segmentation',
      'A Survey of Graph Neural Networks'
    )).toBe(false)
  })

  it('rejects empty input', () => {
    expect(titlesMatch('', 'Some Title')).toBe(false)
    expect(titlesMatch('   ', 'Some Title')).toBe(false)
  })
})

describe('titleSimilarity', () => {
  it('returns 1.0 for identical titles', () => {
    expect(titleSimilarity('Attention Is All You Need', 'Attention Is All You Need')).toBe(1)
  })

  it('returns high similarity for near-identical titles (trailing period)', () => {
    const s = titleSimilarity(
      'Cross-view Transformers for real-time Map-view Semantic Segmentation',
      'Cross-view Transformers for real-time Map-view Semantic Segmentation.'
    )
    expect(s).toBeGreaterThan(0.9)
  })

  it('returns high similarity for prefix/subtitle match', () => {
    const s = titleSimilarity(
      'SCube: Instant Large-Scale Scene Reconstruction',
      'SCube: Instant Large-Scale Scene Reconstruction using VoxSplats'
    )
    expect(s).toBeGreaterThan(0.75)
  })

  it('returns low similarity for unrelated titles', () => {
    const s = titleSimilarity(
      'Cross-view Transformers for real-time Map-view Semantic Segmentation',
      'A Survey of Graph Neural Networks'
    )
    expect(s).toBeLessThan(0.3)
  })

  it('returns a middling value for partial overlap (below use threshold)', () => {
    const s = titleSimilarity(
      'Image Segmentation',
      'Image Segmentation Methods and Applications Survey Review'
    )
    expect(s).toBeGreaterThanOrEqual(0.6)
    expect(s).toBeLessThan(0.75)
  })

  it('penalizes large length mismatch', () => {
    const s = titleSimilarity('Cat', 'Cat Dog Bird Fish Tree House Car Book Pen Lamp')
    expect(s).toBeLessThan(0.5)
  })

  it('returns 0 for empty input', () => {
    expect(titleSimilarity('', 'Some Title')).toBe(0)
  })
})

describe('titleFromFileName', () => {
  it('strips .pdf and underscores, capitalizes', () => {
    expect(titleFromFileName('zhou2022crossview.pdf')).toBe('Zhou 2022 crossview')
  })

  it('splits camelCase boundaries', () => {
    expect(titleFromFileName('CrossViewTransformers.pdf')).toBe('Cross View Transformers')
  })

  it('handles already-readable filenames', () => {
    expect(titleFromFileName('SCube Instant Large-Scale Scene Reconstruction.pdf')).toBe('SCube Instant Large-Scale Scene Reconstruction')
  })

  it('returns null for empty filename', () => {
    expect(titleFromFileName('.pdf')).toBeNull()
    expect(titleFromFileName('')).toBeNull()
  })

  it('handles simple keyword filenames', () => {
    expect(titleFromFileName('scube.pdf')).toBe('Scube')
  })

  it('drops a leading pure-number token', () => {
    expect(titleFromFileName('2022_crossview_transformers.pdf')).toBe('Crossview transformers')
  })
})

describe('looksLikePosterOrNonPaper', () => {
  it('detects poster keyword in head text', () => {
    expect(looksLikePosterOrNonPaper('Conference Poster\nDeep Learning for Vision')).toBe(true)
  })

  it('detects slides keyword', () => {
    expect(looksLikePosterOrNonPaper('Lecture Slides\nSlide 1\nIntroduction')).toBe(true)
  })

  it('returns false for a normal paper abstract', () => {
    const paper = 'Cross-view Transformers for real-time Map-view Semantic Segmentation\n Brady Zhou\n Abstract\n We present cross-view transformers, an efficient attention-based model for map-view semantic segmentation from multiple cameras. Our architecture implicitly learns a mapping from individual camera views into a canonical map-view representation using a camera-aware cross-view attention mechanism. Each camera uses positional embeddings that depend on its intrinsic and extrinsic calibration.'
    expect(looksLikePosterOrNonPaper(paper)).toBe(false)
  })

  it('returns false for normal prose text', () => {
    expect(looksLikePosterOrNonPaper('This is a long sentence of normal academic prose that fills up the first few lines of the document without any short fragment lines.')).toBe(false)
  })
})

describe('isReliableTitle', () => {
  it('accepts a real paper title', () => {
    const text = 'Cross-view Transformers for real-time Map-view Semantic Segmentation\n Abstract\n We present cross-view transformers.'
    expect(isReliableTitle('Cross-view Transformers for real-time Map-view Semantic Segmentation', text)).toBe(true)
  })

  it('rejects null/empty/short titles', () => {
    expect(isReliableTitle(null, 'some text')).toBe(false)
    expect(isReliableTitle('', 'some text')).toBe(false)
    expect(isReliableTitle('Hi', 'some text')).toBe(false)
  })

  it('rejects figure/table noise lines', () => {
    expect(isReliableTitle('Figure 1: Overview of the architecture', 'Figure 1: Overview')).toBe(false)
    expect(isReliableTitle('Table 3 Results', 'Table 3')).toBe(false)
  })

  it('rejects titles that are actually DOIs', () => {
    expect(isReliableTitle('10.1109/CVPR52688.2022.01339', '10.1109/CVPR52688.2022.01339')).toBe(false)
  })

  it('rejects titles when the text looks like a poster', () => {
    expect(isReliableTitle('Some Reasonable Title Here', 'Conference Poster\nDeep Learning')).toBe(false)
  })

  it('rejects titles with too few words', () => {
    expect(isReliableTitle('Oneword', 'Oneword\n Abstract\n long body text here with abstract keyword.')).toBe(false)
  })

  it('rejects titles with low alphabetic ratio', () => {
    expect(isReliableTitle('1234567890!@#$%^&*()', '1234567890!@#$%^&*()')).toBe(false)
  })
})
