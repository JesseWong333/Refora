import { beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSync, lstatSync, statSync } = vi.hoisted(() => ({
  existsSync: vi.fn(),
  lstatSync: vi.fn(),
  statSync: vi.fn()
}))

vi.mock('node:fs', () => ({
  default: { existsSync, lstatSync, statSync },
  existsSync,
  lstatSync,
  statSync
}))

import { resolvePdfFilePath } from '../../src/main/services/pdfPath'

describe('resolvePdfFilePath', () => {
  beforeEach(() => {
    existsSync.mockReset().mockReturnValue(true)
    lstatSync.mockReset().mockReturnValue({ isSymbolicLink: () => false })
    statSync.mockReset().mockReturnValue({ isFile: () => true })
  })

  it('returns a validated absolute PDF path', () => {
    expect(resolvePdfFilePath('/library/paper.pdf')).toBe('/library/paper.pdf')
  })

  it('rejects relative, non-PDF, missing, symbolic-link, and directory paths', () => {
    expect(() => resolvePdfFilePath('../paper.pdf')).toThrow('absolute')
    expect(() => resolvePdfFilePath('/library/paper.txt')).toThrow('PDF')

    existsSync.mockReturnValue(false)
    expect(() => resolvePdfFilePath('/library/missing.pdf')).toThrow('File not found')

    existsSync.mockReturnValue(true)
    lstatSync.mockReturnValue({ isSymbolicLink: () => true })
    expect(() => resolvePdfFilePath('/library/link.pdf')).toThrow('regular PDF')

    lstatSync.mockReturnValue({ isSymbolicLink: () => false })
    statSync.mockReturnValue({ isFile: () => false })
    expect(() => resolvePdfFilePath('/library/folder.pdf')).toThrow('regular PDF')
  })
})
