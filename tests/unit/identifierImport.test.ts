import { describe, it, expect } from 'vitest'
import {
  detectIdentifierType,
  extractArxivId,
  extractDoi,
  sanitizeFileName,
  isSafeUrl
} from '../../src/main/services/identifierImport'

describe('detectIdentifierType', () => {
  it('detects DOI strings', () => {
    expect(detectIdentifierType('10.1145/3292500.3330919')).toBe('doi')
    expect(detectIdentifierType('10.1000/182')).toBe('doi')
  })

  it('detects DOI URLs', () => {
    expect(detectIdentifierType('https://doi.org/10.1145/3292500.3330919')).toBe('doi')
    expect(detectIdentifierType('https://dx.doi.org/10.1000/182')).toBe('doi')
  })

  it('detects arXiv IDs', () => {
    expect(detectIdentifierType('2401.12345')).toBe('arxiv')
    expect(detectIdentifierType('2401.12345v3')).toBe('arxiv')
  })

  it('detects arXiv URLs', () => {
    expect(detectIdentifierType('https://arxiv.org/abs/2401.12345')).toBe('arxiv')
    expect(detectIdentifierType('https://arxiv.org/pdf/2401.12345')).toBe('arxiv')
  })

  it('detects ISBN', () => {
    expect(detectIdentifierType('978-3-16-148410-0')).toBe('isbn')
    expect(detectIdentifierType('030640615X')).toBe('isbn')
  })

  it('detects generic URLs', () => {
    expect(detectIdentifierType('https://example.com/paper.pdf')).toBe('url')
    expect(detectIdentifierType('http://www.example.org/doc')).toBe('url')
  })

  it('returns null for unrecognizable input', () => {
    expect(detectIdentifierType('')).toBeNull()
    expect(detectIdentifierType('   ')).toBeNull()
    expect(detectIdentifierType('not-an-identifier')).toBeNull()
  })
})

describe('extractArxivId', () => {
  it('extracts from plain ID', () => {
    expect(extractArxivId('2401.12345')).toBe('2401.12345')
    expect(extractArxivId('2401.12345v3')).toBe('2401.12345v3')
  })

  it('extracts from abs URL', () => {
    expect(extractArxivId('https://arxiv.org/abs/2401.12345')).toBe('2401.12345')
  })

  it('extracts from pdf URL', () => {
    expect(extractArxivId('https://arxiv.org/pdf/2401.12345')).toBe('2401.12345')
    expect(extractArxivId('https://arxiv.org/pdf/2401.12345v2.pdf')).toBe('2401.12345v2')
  })

  it('returns null for non-arXiv input', () => {
    expect(extractArxivId('https://example.com/12345')).toBeNull()
  })
})

describe('extractDoi', () => {
  it('extracts from plain DOI', () => {
    expect(extractDoi('10.1145/3292500.3330919')).toBe('10.1145/3292500.3330919')
  })

  it('extracts from doi.org URL', () => {
    expect(extractDoi('https://doi.org/10.1145/3292500.3330919')).toBe('10.1145/3292500.3330919')
  })

  it('extracts DOI from text containing it', () => {
    expect(extractDoi('see 10.1000/182 for details')).toBe('10.1000/182')
  })

  it('returns null for non-DOI input', () => {
    expect(extractDoi('https://example.com')).toBeNull()
  })
})

describe('sanitizeFileName', () => {
  it('removes invalid characters', () => {
    expect(sanitizeFileName('paper:title/with*bad?chars')).toBe('papertitlewithbadchars')
  })

  it('collapses whitespace', () => {
    expect(sanitizeFileName('hello   world  test')).toBe('hello world test')
  })

  it('truncates long titles', () => {
    const long = 'a'.repeat(300)
    expect(sanitizeFileName(long).length).toBe(180)
  })

  it('falls back to "download" for empty result', () => {
    expect(sanitizeFileName(':::***')).toBe('download')
  })
})

describe('isSafeUrl', () => {
  it('rejects non-http schemes', async () => {
    expect(await isSafeUrl('file:///etc/passwd')).toBe(false)
    expect(await isSafeUrl('ftp://example.com/file.pdf')).toBe(false)
  })

  it('rejects localhost', async () => {
    expect(await isSafeUrl('http://localhost/file.pdf')).toBe(false)
    expect(await isSafeUrl('http://127.0.0.1/file.pdf')).toBe(false)
  })

  it('rejects private IP ranges', async () => {
    expect(await isSafeUrl('http://10.0.0.1/file.pdf')).toBe(false)
    expect(await isSafeUrl('http://192.168.1.1/file.pdf')).toBe(false)
    expect(await isSafeUrl('http://172.16.0.1/file.pdf')).toBe(false)
    expect(await isSafeUrl('http://169.254.169.254/latest/meta-data/')).toBe(false)
  })

  it('rejects malformed URLs', async () => {
    expect(await isSafeUrl('not-a-url')).toBe(false)
    expect(await isSafeUrl('')).toBe(false)
  })

  it('accepts public http(s) URLs', async () => {
    expect(await isSafeUrl('https://arxiv.org/pdf/2401.12345')).toBe(true)
    expect(await isSafeUrl('https://example.com/paper.pdf')).toBe(true)
  })
})
