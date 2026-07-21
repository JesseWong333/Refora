import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { RepoError } from '../db/repositories/errors'

const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/

function requireSegment(value: string, label: string): string {
  if (!SAFE_SEGMENT.test(value)) {
    throw new RepoError('invalid_path', `Invalid OCR ${label}`)
  }
  return value
}

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function requireSafeManagedPath(root: string, candidate: string): string {
  const resolvedRoot = resolve(root)
  const resolvedCandidate = resolve(candidate)
  if (!isWithin(resolvedRoot, resolvedCandidate)) {
    throw new RepoError('invalid_path', 'OCR path is outside the managed directory')
  }
  let current = resolvedRoot
  for (const segment of relative(resolvedRoot, resolvedCandidate).split(sep).filter(Boolean)) {
    current = join(current, segment)
    if (!existsSync(current)) break
    const entry = lstatSync(current)
    if (entry.isSymbolicLink()) {
      throw new RepoError('invalid_path', 'OCR managed directories cannot be symbolic links')
    }
  }
  return resolvedCandidate
}

export function getOcrRoot(libraryFolder: string): string {
  if (!libraryFolder || !isAbsolute(libraryFolder)) {
    throw new RepoError('invalid_path', 'Library folder must be an absolute path')
  }
  const library = resolve(libraryFolder)
  let current = library
  for (const segment of ['.refora', 'derived', 'OCR']) {
    current = join(current, segment)
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new RepoError('invalid_path', 'OCR managed directories cannot be symbolic links')
    }
  }
  return current
}

export function getOcrDocumentRoot(libraryFolder: string, documentId: string): string {
  const root = getOcrRoot(libraryFolder)
  return requireSafeManagedPath(root, join(root, requireSegment(documentId, 'document ID')))
}

export function getOcrResultRoot(
  libraryFolder: string,
  documentId: string,
  resultKey: string
): string {
  const documentRoot = getOcrDocumentRoot(libraryFolder, documentId)
  return requireSafeManagedPath(
    documentRoot,
    join(documentRoot, requireSegment(resultKey, 'result key'))
  )
}

export function getOcrStagingRoot(
  libraryFolder: string,
  documentId: string,
  jobId: string
): string {
  const documentRoot = getOcrDocumentRoot(libraryFolder, documentId)
  return requireSafeManagedPath(
    documentRoot,
    join(documentRoot, '.staging', requireSegment(jobId, 'job ID'))
  )
}

export function getOcrPublishBackupRoot(
  libraryFolder: string,
  documentId: string,
  jobId: string
): string {
  const documentRoot = getOcrDocumentRoot(libraryFolder, documentId)
  return requireSafeManagedPath(
    documentRoot,
    join(documentRoot, '.backup', requireSegment(jobId, 'job ID'))
  )
}

export function toLibraryRelativePath(libraryFolder: string, absolutePath: string): string {
  const root = resolve(libraryFolder)
  const candidate = resolve(absolutePath)
  if (!isWithin(root, candidate)) {
    throw new RepoError('invalid_path', 'OCR result is outside the Library folder')
  }
  return relative(root, candidate)
}

export function resolveOcrResultFile(libraryFolder: string, relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath)) {
    throw new RepoError('invalid_path', 'OCR result path must be Library-relative')
  }
  const root = getOcrRoot(libraryFolder)
  const candidate = resolve(libraryFolder, relativePath)
  if (!isWithin(root, candidate)) {
    throw new RepoError('invalid_path', 'OCR result path is outside the managed directory')
  }
  if (!existsSync(candidate)) {
    throw new RepoError('file_missing', `OCR result file not found: ${candidate}`)
  }
  if (lstatSync(candidate).isSymbolicLink() || !statSync(candidate).isFile()) {
    throw new RepoError('invalid_path', 'OCR result path must be a regular file')
  }
  const realRoot = realpathSync(root)
  const realCandidate = realpathSync(candidate)
  if (!isWithin(realRoot, realCandidate)) {
    throw new RepoError('invalid_path', 'OCR result path resolves outside the managed directory')
  }
  return candidate
}
