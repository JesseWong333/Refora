import { resolve as resolvePath, relative, isAbsolute, join, sep } from 'node:path'

export function toLibraryRelative(absPath: string, libraryFolder: string): string {
  if (!libraryFolder) return absPath
  if (!isAbsolute(absPath)) return absPath
  const normLib = resolvePath(libraryFolder)
  const rel = relative(normLib, absPath)
  if (!rel || rel.startsWith('..' + sep) || rel === '..') return absPath
  return rel
}

export function resolveFromLibrary(relOrAbs: string, libraryFolder: string): string {
  if (!relOrAbs) return relOrAbs
  if (isAbsolute(relOrAbs)) return relOrAbs
  if (!libraryFolder) return relOrAbs
  return resolvePath(join(libraryFolder, relOrAbs))
}

export function isInsideLibrary(absPath: string, libraryFolder: string): boolean {
  if (!absPath || !libraryFolder) return false
  const normLib = resolvePath(libraryFolder) + sep
  return resolvePath(absPath) + sep === normLib || resolvePath(absPath).startsWith(normLib)
}