import { existsSync, lstatSync, statSync } from 'node:fs'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import { RepoError } from '../db/repositories/errors'

export function resolvePdfFilePath(rawPath: string): string {
  if (!rawPath || !isAbsolute(rawPath)) {
    throw new RepoError('invalid_path', 'PDF path must be absolute')
  }
  const resolved = resolvePath(rawPath)
  if (!resolved.toLowerCase().endsWith('.pdf')) {
    throw new RepoError('invalid_path', 'Selected file must be a PDF')
  }
  if (!existsSync(resolved)) {
    throw new RepoError('file_missing', `File not found: ${resolved}`)
  }
  try {
    if (lstatSync(resolved).isSymbolicLink() || !statSync(resolved).isFile()) {
      throw new RepoError('invalid_path', 'Selected path must be a regular PDF file')
    }
  } catch (error) {
    if (error instanceof RepoError) throw error
    throw new RepoError('invalid_path', `Unable to inspect PDF file: ${resolved}`)
  }
  return resolved
}
