import { beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSync, lstatSync, statSync } = vi.hoisted(() => ({
  existsSync: vi.fn(),
  lstatSync: vi.fn(),
  statSync: vi.fn()
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    default: { ...actual, existsSync, lstatSync, statSync },
    existsSync,
    lstatSync,
    statSync
  }
})

import { sanitizeImportedDoc } from '../../src/main/services/export'

function importedDoc(filePath: string): Record<string, unknown> {
  return {
    id: 'doc-1',
    filePath,
    fileName: 'untrusted-name',
    originalFolderPath: '/original',
    addedAt: 1,
    updatedAt: 1
  }
}

describe('JSON document path sanitization', () => {
  beforeEach(() => {
    existsSync.mockReset().mockReturnValue(false)
    lstatSync.mockReset().mockReturnValue({ isSymbolicLink: () => false })
    statSync.mockReset().mockReturnValue({ isFile: () => true, size: 42 })
  })

  it('rejects non-PDF paths and relative paths that escape the library', () => {
    expect(sanitizeImportedDoc(importedDoc('/tmp/private.txt'), '/library')).toBeNull()
    expect(sanitizeImportedDoc(importedDoc('../outside.pdf'), '/library')).toBeNull()
  })

  it('normalizes safe missing PDFs and derives the missing state and filename', () => {
    const result = sanitizeImportedDoc(importedDoc('nested/paper.pdf'), '/library')
    expect(result).toMatchObject({
      filePath: '/library/nested/paper.pdf',
      fileName: 'paper.pdf',
      fileMissing: 1
    })
  })

  it('rejects existing symbolic links and non-files', () => {
    existsSync.mockReturnValue(true)
    lstatSync.mockReturnValue({ isSymbolicLink: () => true })
    expect(sanitizeImportedDoc(importedDoc('/library/link.pdf'), '/library')).toBeNull()

    lstatSync.mockReturnValue({ isSymbolicLink: () => false })
    statSync.mockReturnValue({ isFile: () => false, size: 0 })
    expect(sanitizeImportedDoc(importedDoc('/library/folder.pdf'), '/library')).toBeNull()
  })
})
