import { describe, it, expect } from 'vitest'
import { sep } from 'node:path'
import {
  toLibraryRelative,
  resolveFromLibrary,
  isInsideLibrary,
  containsLibrary
} from '../../src/main/services/paths'

const IS_MAC = process.platform === 'darwin'
const IS_WIN = process.platform === 'win32'
const CASE_INSENSITIVE = IS_MAC || IS_WIN

describe('isInsideLibrary', () => {
  it('returns true when absPath is a descendant of libraryFolder', () => {
    expect(isInsideLibrary('/lib/doc.pdf', '/lib')).toBe(true)
    expect(isInsideLibrary('/lib/sub/doc.pdf', '/lib')).toBe(true)
  })

  it('returns true when absPath equals libraryFolder', () => {
    expect(isInsideLibrary('/lib', '/lib')).toBe(true)
  })

  it('returns false for sibling directories with a shared prefix', () => {
    expect(isInsideLibrary('/library2/doc.pdf', '/lib')).toBe(false)
    expect(isInsideLibrary('/libXYZ/doc.pdf', '/lib')).toBe(false)
  })

  it('returns false for parent of libraryFolder', () => {
    expect(isInsideLibrary('/data', '/data/lib')).toBe(false)
  })

  it('returns false when either path is empty', () => {
    expect(isInsideLibrary('', '/lib')).toBe(false)
    expect(isInsideLibrary('/lib/doc.pdf', '')).toBe(false)
    expect(isInsideLibrary('', '')).toBe(false)
  })

  it('normalizes trailing separators', () => {
    expect(isInsideLibrary('/lib/doc.pdf', '/lib/')).toBe(true)
    expect(isInsideLibrary('/lib/doc.pdf', '/lib//')).toBe(true)
  })

  it('resolves relative paths before comparing', () => {
    expect(isInsideLibrary('/lib/sub/../doc.pdf', '/lib')).toBe(true)
  })

  it('is case-insensitive on darwin/win32', () => {
    if (!CASE_INSENSITIVE) return
    expect(isInsideLibrary('/Lib/Doc.PDF', '/lib')).toBe(true)
    expect(isInsideLibrary('/LIB/SUB/DOC.PDF', '/lib')).toBe(true)
    expect(isInsideLibrary('/lib', '/LIB')).toBe(true)
  })
})

describe('containsLibrary', () => {
  it('returns true when libraryFolder is a descendant of parentPath', () => {
    expect(containsLibrary('/watch', '/watch/lib')).toBe(true)
    expect(containsLibrary('/watch', '/watch/sub/lib')).toBe(true)
  })

  it('returns false when libraryFolder equals parentPath', () => {
    expect(containsLibrary('/data', '/data')).toBe(false)
  })

  it('returns false when libraryFolder is outside parentPath', () => {
    expect(containsLibrary('/watch', '/other/lib')).toBe(false)
  })

  it('returns false for sibling-prefix mismatch', () => {
    expect(containsLibrary('/watch2', '/watch/lib')).toBe(false)
  })

  it('returns false when either path is empty', () => {
    expect(containsLibrary('', '/lib')).toBe(false)
    expect(containsLibrary('/watch', '')).toBe(false)
  })

  it('is case-insensitive on darwin/win32', () => {
    if (!CASE_INSENSITIVE) return
    expect(containsLibrary('/Watch', '/watch/lib')).toBe(true)
    expect(containsLibrary('/watch', '/WATCH/LIB')).toBe(true)
  })
})

describe('toLibraryRelative', () => {
  it('returns the relative path for a file inside the library', () => {
    expect(toLibraryRelative('/lib/doc.pdf', '/lib')).toBe('doc.pdf')
    expect(toLibraryRelative('/lib/sub/doc.pdf', '/lib')).toBe(
      ['sub', 'doc.pdf'].join(sep)
    )
  })

  it('returns the absolute path when the file is outside the library', () => {
    expect(toLibraryRelative('/other/doc.pdf', '/lib')).toBe('/other/doc.pdf')
    expect(toLibraryRelative('/libXYZ/doc.pdf', '/lib')).toBe('/libXYZ/doc.pdf')
  })

  it('returns the absolute path when libraryFolder is empty', () => {
    expect(toLibraryRelative('/lib/doc.pdf', '')).toBe('/lib/doc.pdf')
  })

  it('returns the input when it is not absolute', () => {
    expect(toLibraryRelative('doc.pdf', '/lib')).toBe('doc.pdf')
    expect(toLibraryRelative('sub/doc.pdf', '/lib')).toBe('sub/doc.pdf')
  })

  it('normalizes trailing separators on libraryFolder', () => {
    expect(toLibraryRelative('/lib/doc.pdf', '/lib/')).toBe('doc.pdf')
  })

  it('rejects a sibling directory that shares the library prefix', () => {
    expect(toLibraryRelative('/libExtra/doc.pdf', '/lib')).toBe('/libExtra/doc.pdf')
    expect(toLibraryRelative('/lib2/doc.pdf', '/lib')).toBe('/lib2/doc.pdf')
  })
})

describe('resolveFromLibrary', () => {
  it('joins a relative path against the library folder', () => {
    expect(resolveFromLibrary('doc.pdf', '/lib')).toBe('/lib/doc.pdf')
    expect(resolveFromLibrary('sub/doc.pdf', '/lib')).toBe(
      ['/lib', 'sub', 'doc.pdf'].join(sep)
    )
  })

  it('returns an absolute path unchanged', () => {
    expect(resolveFromLibrary('/abs/doc.pdf', '/lib')).toBe('/abs/doc.pdf')
  })

  it('returns the input when libraryFolder is empty', () => {
    expect(resolveFromLibrary('doc.pdf', '')).toBe('doc.pdf')
  })

  it('returns the input when it is empty', () => {
    expect(resolveFromLibrary('', '/lib')).toBe('')
  })
})

describe('toLibraryRelative / resolveFromLibrary round-trip', () => {
  it('round-trips a path inside the library', () => {
    const lib = '/lib'
    const original = '/lib/sub/doc.pdf'
    const rel = toLibraryRelative(original, lib)
    expect(resolveFromLibrary(rel, lib)).toBe(original)
  })

  it('round-trips a path outside the library (stays absolute)', () => {
    const lib = '/lib'
    const original = '/other/doc.pdf'
    const rel = toLibraryRelative(original, lib)
    expect(rel).toBe(original)
    expect(resolveFromLibrary(rel, lib)).toBe(original)
  })
})
