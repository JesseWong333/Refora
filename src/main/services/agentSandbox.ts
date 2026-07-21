import { existsSync, lstatSync, statSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path'
import type { Repositories } from '../db/repositories'
import { RepoError } from '../db/repositories/errors'
import { AGENT_SANDBOX_DIRECTORY } from '../../shared/ipc-types'

export interface AgentSandboxPaths {
  libraryRoot: string
  agentRoot: string
  sharedRoot: string
  databaseRoot: string
  databaseSnapshot: string
  runtimeRoot: string
  uvStore: string
  pnpmStore: string
  sandboxRoot: string
  workRoot: string
  scriptsRoot: string
  outputsRoot: string
  tempRoot: string
  environmentRoot: string
}

interface AgentSandboxServiceDeps {
  repos: Repositories
  dbPath: string
  trashItem?: (path: string) => Promise<void>
}

const SANDBOX_DIRECTORIES = ['work', 'scripts', 'outputs', 'tmp', 'env'] as const

function normalizedLibraryRoot(repos: Repositories, dbPath: string): string {
  const configured = repos.settings.get<string>('libraryFolderPath', '').trim()
  return resolvePath(configured || dirname(dbPath))
}

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

export function createAgentSandboxService(deps: AgentSandboxServiceDeps) {
  const libraryRoot = normalizedLibraryRoot(deps.repos, deps.dbPath)
  const agentRoot = join(libraryRoot, AGENT_SANDBOX_DIRECTORY)
  const sharedRoot = join(agentRoot, 'shared')

  function paths(workspaceId?: string | null): AgentSandboxPaths {
    const sandboxRoot = workspaceId
      ? join(agentRoot, 'workspaces', workspaceId)
      : join(agentRoot, 'default')
    if (!isWithin(agentRoot, sandboxRoot)) {
      throw new RepoError('invalid_path', 'Agent sandbox path is outside the managed root')
    }
    return {
      libraryRoot,
      agentRoot,
      sharedRoot,
      databaseRoot: join(sharedRoot, 'database'),
      databaseSnapshot: join(sharedRoot, 'database', 'refora-readonly.db'),
      runtimeRoot: join(sharedRoot, 'runtimes'),
      uvStore: join(sharedRoot, 'stores', 'uv'),
      pnpmStore: join(sharedRoot, 'stores', 'pnpm'),
      sandboxRoot,
      workRoot: join(sandboxRoot, 'work'),
      scriptsRoot: join(sandboxRoot, 'scripts'),
      outputsRoot: join(sandboxRoot, 'outputs'),
      tempRoot: join(sandboxRoot, 'tmp'),
      environmentRoot: join(sandboxRoot, 'env')
    }
  }

  async function ensureShared(): Promise<AgentSandboxPaths> {
    const resolved = paths(null)
    await Promise.all([
      mkdir(resolved.databaseRoot, { recursive: true, mode: 0o700 }),
      mkdir(join(resolved.runtimeRoot, 'python'), { recursive: true, mode: 0o700 }),
      mkdir(join(resolved.runtimeRoot, 'node'), { recursive: true, mode: 0o700 }),
      mkdir(join(resolved.runtimeRoot, 'tools'), { recursive: true, mode: 0o700 }),
      mkdir(resolved.uvStore, { recursive: true, mode: 0o700 }),
      mkdir(resolved.pnpmStore, { recursive: true, mode: 0o700 })
    ])
    return resolved
  }

  async function ensure(workspaceId?: string | null): Promise<AgentSandboxPaths> {
    await ensureShared()
    const resolved = paths(workspaceId)
    await Promise.all(
      SANDBOX_DIRECTORIES.map((directory) =>
        mkdir(join(resolved.sandboxRoot, directory), { recursive: true, mode: 0o700 })
      )
    )
    return resolved
  }

  function resolveInside(workspaceId: string | null | undefined, relativePath: string): string {
    if (!relativePath || isAbsolute(relativePath)) {
      throw new RepoError('invalid_path', 'Agent paths must be non-empty and relative')
    }
    const root = paths(workspaceId).sandboxRoot
    const resolved = resolvePath(root, relativePath)
    if (!isWithin(root, resolved)) {
      throw new RepoError('invalid_path', 'Agent path is outside the current sandbox')
    }
    return resolved
  }

  function requireRegularFile(workspaceId: string | null | undefined, relativePath: string): string {
    const resolved = resolveInside(workspaceId, relativePath)
    if (!existsSync(resolved)) throw new RepoError('file_missing', `File not found: ${relativePath}`)
    const info = lstatSync(resolved)
    if (info.isSymbolicLink() || !statSync(resolved).isFile()) {
      throw new RepoError('invalid_path', 'Agent artifacts must be regular files')
    }
    return resolved
  }

  async function deleteWorkspace(workspaceId: string): Promise<void> {
    const root = paths(workspaceId).sandboxRoot
    if (!existsSync(root)) return
    if (deps.trashItem) {
      await deps.trashItem(root)
      return
    }
    await rm(root, { recursive: true, force: true })
  }

  function ownsPath(candidate: string): boolean {
    return isWithin(agentRoot, resolvePath(candidate))
  }

  return {
    paths,
    ensureShared,
    ensure,
    resolveInside,
    requireRegularFile,
    deleteWorkspace,
    ownsPath
  }
}

export type AgentSandboxService = ReturnType<typeof createAgentSandboxService>
