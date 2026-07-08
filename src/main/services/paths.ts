import { resolve as resolvePath, relative, isAbsolute, join, sep } from 'node:path'

const CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32'

function normEndSep(p: string): string {
  return p.endsWith(sep) ? p : p + sep
}

function startsWithDir(parent: string, child: string): boolean {
  const p = normEndSep(parent)
  const c = normEndSep(child)
  return CASE_INSENSITIVE ? c.toLowerCase().startsWith(p.toLowerCase()) : c.startsWith(p)
}

function samePath(a: string, b: string): boolean {
  return CASE_INSENSITIVE ? a.toLowerCase() === b.toLowerCase() : a === b
}

export function toLibraryRelative(absPath: string, libraryFolder: string): string {
  if (!libraryFolder) return absPath
  if (!isAbsolute(absPath)) return absPath
  const normLib = resolvePath(libraryFolder)
  const rel = relative(normLib, absPath)
  if (!rel || rel === '..' || rel.startsWith('..' + sep)) return absPath
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
  const normLib = resolvePath(libraryFolder)
  const normAbs = resolvePath(absPath)
  return samePath(normAbs, normLib) || startsWithDir(normLib, normAbs)
}

export function containsLibrary(parentPath: string, libraryFolder: string): boolean {
  if (!parentPath || !libraryFolder) return false
  const normParent = resolvePath(parentPath)
  const normLib = resolvePath(libraryFolder)
  if (samePath(normParent, normLib)) return false
  return startsWithDir(normParent, normLib)
}