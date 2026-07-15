import { renameSync, existsSync, statSync, copyFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { isAbsolute, parse, join, resolve as resolvePath } from 'node:path'
import type { Repositories } from '../db/repositories'
import { RepoError } from '../db/repositories/errors'
import { resolvePdfFilePath } from './pdfPath'

function collisionSafePath(destPath: string): string {
  if (!existsSync(destPath)) return destPath
  const { dir, name, ext } = parse(destPath)
  let counter = 1
  let candidate = join(dir, `${name} (${counter})${ext}`)
  while (existsSync(candidate)) {
    counter++
    candidate = join(dir, `${name} (${counter})${ext}`)
  }
  return candidate
}

function moveFile(filePath: string, destPath: string): void {
  try {
    renameSync(filePath, destPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    copyFileSync(filePath, destPath)
    unlinkSync(filePath)
  }
}

export function moveToLibrary(filePath: string, libraryFolder: string): string {
  if (!existsSync(libraryFolder)) {
    mkdirSync(libraryFolder, { recursive: true })
  }
  const fileName = parse(filePath).base
  const destPath = collisionSafePath(join(libraryFolder, fileName))
  moveFile(filePath, destPath)
  return destPath
}

export function copyToLibrary(filePath: string, libraryFolder: string): string {
  if (!existsSync(libraryFolder)) {
    mkdirSync(libraryFolder, { recursive: true })
  }
  const fileName = parse(filePath).base
  const destPath = collisionSafePath(join(libraryFolder, fileName))
  copyFileSync(filePath, destPath)
  return destPath
}

export function restoreToOriginal(
  repos: Repositories,
  docId: string
): string {
  const doc = repos.documents.get(docId)
  if (!doc) throw new RepoError('not_found', `Document ${docId} not found`)
  if (!doc.originalFolderPath) {
    throw new RepoError('invalid_state', 'Document has no original folder path')
  }
  const sourcePath = resolvePdfFilePath(doc.filePath)
  if (!isAbsolute(doc.originalFolderPath)) {
    throw new RepoError('invalid_state', 'Original folder path must be absolute')
  }
  const originalFolderPath = resolvePath(doc.originalFolderPath)
  try {
    if (!statSync(originalFolderPath).isDirectory()) {
      throw new RepoError('invalid_state', 'Original folder no longer exists')
    }
  } catch {
    throw new RepoError('invalid_state', 'Original folder no longer exists')
  }
  const fileName = parse(sourcePath).base
  const destPath = collisionSafePath(join(originalFolderPath, fileName))
  moveFile(sourcePath, destPath)
  repos.documents.updateFilePath(docId, destPath, parse(destPath).base)
  return destPath
}
