import { describe, expect, it } from 'vitest'
import {
  activeDuplicateFiles,
  libraryDocumentSignature,
  normalizedLibraryFileKey,
  sameDuplicateFingerprint,
  type LibraryDuplicateFileCache
} from '../../src/main/services/libraryDuplicateCache'

describe('library duplicate cache', () => {
  it('normalizes equivalent Unicode paths to the same cache key', () => {
    const composed = normalizedLibraryFileKey('/library/caf\u00e9.pdf')
    const decomposed = normalizedLibraryFileKey('/library/cafe\u0301.pdf')

    expect(composed).toBe(decomposed)
  })

  it('keeps a document signature stable across repository ordering', () => {
    const first = libraryDocumentSignature([
      { id: 'a', fileHash: 'hash-a' },
      { id: 'b', fileHash: 'hash-b' }
    ])
    const second = libraryDocumentSignature([
      { id: 'b', fileHash: 'hash-b' },
      { id: 'a', fileHash: 'hash-a' }
    ])

    expect(first).toBe(second)
  })

  it('invalidates cached duplicates when the document set changes', () => {
    const signature = libraryDocumentSignature([{ id: 'a', fileHash: 'hash-a' }])
    const cache: LibraryDuplicateFileCache = {
      documentSignature: signature,
      files: { '/library/duplicate.pdf': { size: 42, mtimeMs: 100 } }
    }

    expect(activeDuplicateFiles(cache, signature)).toEqual(cache.files)
    expect(activeDuplicateFiles(cache, libraryDocumentSignature([]))).toEqual({})
  })

  it('requires both size and modification time to match', () => {
    const cached = { size: 42, mtimeMs: 100 }

    expect(sameDuplicateFingerprint(cached, { size: 42, mtimeMs: 100 })).toBe(true)
    expect(sameDuplicateFingerprint(cached, { size: 43, mtimeMs: 100 })).toBe(false)
    expect(sameDuplicateFingerprint(cached, { size: 42, mtimeMs: 101 })).toBe(false)
  })
})
