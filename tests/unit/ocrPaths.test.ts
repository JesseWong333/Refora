import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getOcrPublishBackupRoot,
  getOcrResultRoot,
  getOcrRoot,
  getOcrStagingRoot,
  resolveOcrResultFile,
  toLibraryRelativePath
} from '../../src/main/services/ocrPaths'

const directories: string[] = []

function temporaryLibrary(): string {
  const directory = mkdtempSync(join(tmpdir(), 'refora-ocr-paths-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })))
})

describe('OCR paths', () => {
  it('places results under the Library derived OCR directory', () => {
    const library = temporaryLibrary()
    expect(getOcrResultRoot(library, 'doc-1', 'result_1')).toBe(
      join(library, '.refora', 'derived', 'OCR', 'doc-1', 'result_1')
    )
  })

  it('rejects unsafe document IDs and result keys', () => {
    const library = temporaryLibrary()
    expect(() => getOcrResultRoot(library, '../doc', 'result')).toThrow('Invalid OCR document ID')
    expect(() => getOcrResultRoot(library, 'doc', '../../result')).toThrow('Invalid OCR result key')
  })

  it('resolves only regular files within the managed directory', () => {
    const library = temporaryLibrary()
    const resultRoot = getOcrResultRoot(library, 'doc', 'result')
    mkdirSync(resultRoot, { recursive: true })
    const markdown = join(resultRoot, 'document.md')
    writeFileSync(markdown, '# Parsed')
    const relative = toLibraryRelativePath(library, markdown)
    expect(resolveOcrResultFile(library, relative)).toBe(markdown)
    expect(() => resolveOcrResultFile(library, '../outside.md')).toThrow(
      'outside the managed directory'
    )
  })

  it('rejects symbolic links in the managed directory chain', () => {
    const library = temporaryLibrary()
    const outside = temporaryLibrary()
    symlinkSync(outside, join(library, '.refora'))
    expect(() => getOcrRoot(library)).toThrow('cannot be symbolic links')
  })

  it('rejects symbolic links below the OCR root', () => {
    const library = temporaryLibrary()
    const outside = temporaryLibrary()
    const root = getOcrRoot(library)
    mkdirSync(root, { recursive: true })
    symlinkSync(outside, join(root, 'doc'))
    expect(() => getOcrResultRoot(library, 'doc', 'result')).toThrow(
      'cannot be symbolic links'
    )
  })

  it('rejects a symbolic-link staging directory', () => {
    const library = temporaryLibrary()
    const outside = temporaryLibrary()
    const documentRoot = getOcrResultRoot(library, 'doc', 'placeholder')
    mkdirSync(join(documentRoot, '..'), { recursive: true })
    symlinkSync(outside, join(documentRoot, '..', '.staging'))
    expect(() => getOcrStagingRoot(library, 'doc', 'job')).toThrow(
      'cannot be symbolic links'
    )
  })

  it('rejects a symbolic-link publication backup directory', () => {
    const library = temporaryLibrary()
    const outside = temporaryLibrary()
    const documentRoot = getOcrResultRoot(library, 'doc', 'placeholder')
    mkdirSync(join(documentRoot, '..'), { recursive: true })
    symlinkSync(outside, join(documentRoot, '..', '.backup'))
    expect(() => getOcrPublishBackupRoot(library, 'doc', 'job')).toThrow(
      'cannot be symbolic links'
    )
  })
})
