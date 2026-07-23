import { posix } from 'node:path'
import type {
  BackendProtocolV2,
  DeleteResult,
  EditResult,
  FileDownloadResponse,
  FileInfo,
  FileUploadResponse,
  GlobResult,
  GrepMatch,
  GrepResult,
  LsResult,
  ReadRawResult,
  ReadResult,
  WriteResult
} from 'deepagents'
import type { Repositories } from '../db/repositories'

export const WORKSPACE_MEMORY_PATHS = [
  '/brief.md',
  '/preferences.md',
  '/decisions.md',
  '/glossary.md',
  '/research.md'
] as const

export const MAX_WORKSPACE_MEMORY_FILE_CHARS = 16_384
export const MAX_WORKSPACE_MEMORY_TOTAL_CHARS = 65_536

interface MemoryScope {
  scope: 'workspace' | 'global'
  scopeId: string
  workspaceId: string | null
}

function normalizeMemoryPath(path: string): string | null {
  const normalized = posix.normalize(path.startsWith('/') ? path : `/${path}`)
  if (!WORKSPACE_MEMORY_PATHS.includes(normalized as typeof WORKSPACE_MEMORY_PATHS[number])) {
    return null
  }
  return normalized
}

function scopeFor(workspaceId: string | null): MemoryScope {
  return workspaceId
    ? { scope: 'workspace', scopeId: workspaceId, workspaceId }
    : { scope: 'global', scopeId: 'global', workspaceId: null }
}

export function createReforaWorkspaceMemoryBackend(
  repos: Repositories,
  workspaceId: string | null
): BackendProtocolV2 {
  const scope = scopeFor(workspaceId)

  function memory(path: string) {
    const normalized = normalizeMemoryPath(path)
    if (!normalized) return null
    return repos.agentMemories.get(scope.scope, scope.scopeId, normalized)
  }

  return {
    ls(path: string): LsResult {
      if (path !== '/' && path !== '.') return { error: 'Memory paths are limited to /' }
      const files: FileInfo[] = repos.agentMemories.list(scope.scope, scope.scopeId).map((entry) => ({
        path: entry.path,
        is_dir: false,
        size: entry.content.length,
        modified_at: new Date(entry.updatedAt).toISOString()
      }))
      return { files }
    },
    read(path: string, offset = 0, limit = 500): ReadResult {
      const entry = memory(path)
      if (!entry) return { error: `Memory file not found: ${path}` }
      const lines = entry.content.split('\n')
      const start = Math.max(0, offset)
      const count = Math.max(1, limit)
      return {
        content: lines
          .slice(start, start + count)
          .map((line, index) => `${start + index + 1}: ${line}`)
          .join('\n'),
        mimeType: 'text/markdown'
      }
    },
    readRaw(path: string): ReadRawResult {
      const entry = memory(path)
      if (!entry) return { error: `Memory file not found: ${path}` }
      return {
        data: {
          content: entry.content,
          mimeType: 'text/markdown',
          created_at: new Date(entry.createdAt).toISOString(),
          modified_at: new Date(entry.updatedAt).toISOString()
        }
      }
    },
    write(): WriteResult {
      return { error: 'Workspace memory is read-only. Use propose_workspace_memory_update.' }
    },
    edit(): EditResult {
      return { error: 'Workspace memory is read-only. Use propose_workspace_memory_update.' }
    },
    delete(): DeleteResult {
      return { error: 'Workspace memory is read-only. Manage memory from Refora settings.' }
    },
    grep(pattern: string): GrepResult {
      const matches: GrepMatch[] = []
      for (const entry of repos.agentMemories.list(scope.scope, scope.scopeId)) {
        entry.content.split('\n').forEach((line, index) => {
          if (line.includes(pattern)) matches.push({ path: entry.path, line: index + 1, text: line })
        })
      }
      return { matches }
    },
    glob(pattern: string): GlobResult {
      const paths = repos.agentMemories.list(scope.scope, scope.scopeId)
      const files = paths
        .filter((entry) => pattern === '*' || pattern === '**/*' || pattern === '*.md' || pattern === entry.path)
        .map((entry) => ({ path: entry.path, is_dir: false, size: entry.content.length }))
      return { files }
    },
    uploadFiles(files): FileUploadResponse[] {
      return files.map(([path]) => ({ path, error: 'permission_denied' }))
    },
    downloadFiles(paths): FileDownloadResponse[] {
      return paths.map((path) => {
        const entry = memory(path)
        return entry
          ? { path, content: new TextEncoder().encode(entry.content), error: null }
          : { path, content: null, error: 'file_not_found' }
      })
    }
  }
}

export function ensureWorkspaceMemoryFiles(repos: Repositories, workspaceId: string | null): void {
  const scope = scopeFor(workspaceId)
  for (const path of WORKSPACE_MEMORY_PATHS) {
    if (path === '/research.md' && workspaceId === null) continue
    if (repos.agentMemories.get(scope.scope, scope.scopeId, path)) continue
    repos.agentMemories.upsert({ ...scope, path, content: '' })
  }
}

export function updateWorkspaceMemory(
  repos: Repositories,
  input: {
    workspaceId: string | null
    path: string
    content: string
    sourceThreadId?: string | null
    sourceRunId?: string | null
  }
) {
  const path = normalizeMemoryPath(input.path)
  if (!path) throw new Error('Unsupported workspace memory path')
  if (path === '/research.md' && input.workspaceId === null) {
    throw new Error('Research memory requires a Workspace')
  }
  if (input.content.length > MAX_WORKSPACE_MEMORY_FILE_CHARS) {
    throw new Error('Workspace memory file is too large')
  }
  const scope = scopeFor(input.workspaceId)
  const total = repos.agentMemories
    .list(scope.scope, scope.scopeId)
    .filter((entry) => entry.path !== path)
    .reduce((sum, entry) => sum + entry.content.length, input.content.length)
  if (total > MAX_WORKSPACE_MEMORY_TOTAL_CHARS) {
    throw new Error('Workspace memory limit exceeded')
  }
  return repos.agentMemories.upsert({
    ...scope,
    path,
    content: input.content,
    sourceThreadId: input.sourceThreadId ?? null,
    sourceRunId: input.sourceRunId ?? null
  })
}
