import { posix } from 'node:path'
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

export function readReforaWorkspaceMemories(
  repos: Repositories,
  workspaceId: string | null
): Record<string, string> {
  const scope = scopeFor(workspaceId)
  return Object.fromEntries(
    repos.agentMemories
      .list(scope.scope, scope.scopeId)
      .map((entry) => [entry.path, entry.content])
  )
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
