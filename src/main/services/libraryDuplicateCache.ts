import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

const CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32'

export interface LibraryDuplicateFileFingerprint {
  size: number
  mtimeMs: number
}

export interface LibraryDuplicateFileCache {
  documentSignature: string
  files: Record<string, LibraryDuplicateFileFingerprint>
}

export function normalizedLibraryFileKey(filePath: string): string {
  const normalized = resolvePath(filePath).normalize('NFC')
  return CASE_INSENSITIVE ? normalized.toLowerCase() : normalized
}

export function libraryDocumentSignature(
  documents: Array<{ id: string; fileHash: string | null }>
): string {
  const hash = createHash('sha256')
  for (const value of documents.map((document) => `${document.id}\0${document.fileHash ?? ''}`).sort()) {
    hash.update(value)
    hash.update('\n')
  }
  return hash.digest('hex')
}

export function duplicateFileFingerprint(filePath: string): LibraryDuplicateFileFingerprint | null {
  try {
    const stats = statSync(filePath)
    if (!stats.isFile()) return null
    return { size: stats.size, mtimeMs: stats.mtimeMs }
  } catch {
    return null
  }
}

export function sameDuplicateFingerprint(
  left: LibraryDuplicateFileFingerprint | undefined,
  right: LibraryDuplicateFileFingerprint | null
): boolean {
  return Boolean(left && right && left.size === right.size && left.mtimeMs === right.mtimeMs)
}

export function activeDuplicateFiles(
  cache: LibraryDuplicateFileCache | null,
  documentSignature: string
): Record<string, LibraryDuplicateFileFingerprint> {
  return cache?.documentSignature === documentSignature ? cache.files : {}
}
