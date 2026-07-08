import { renameSync, existsSync, statSync, copyFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { parse, join } from 'node:path'
import type { Repositories } from '../db/repositories'
import { RepoError } from '../db/repositories/errors'

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

export function moveToLibrary(filePath: string, libraryFolder: string): string {
  const fileName = parse(filePath).base
  const destPath = collisionSafePath(join(libraryFolder, fileName))
  try {
    renameSync(filePath, destPath)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
      copyFileSync(filePath, destPath)
      unlinkSync(filePath)
    } else {
      throw e
    }
  }
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
  try {
    if (!statSync(doc.originalFolderPath).isDirectory()) {
      throw new RepoError('invalid_state', 'Original folder no longer exists')
    }
  } catch {
    throw new RepoError('invalid_state', 'Original folder no longer exists')
  }
  const fileName = parse(doc.filePath).base
  const destPath = collisionSafePath(join(doc.originalFolderPath, fileName))
  renameSync(doc.filePath, destPath)
  repos.documents.updateFilePath(docId, destPath, parse(destPath).base)
  return destPath
}
