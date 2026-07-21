import { statSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { AgentPublishedArtifact, WorkspaceItemPlacement } from '../../shared/ipc-types'
import type { Repositories } from '../db/repositories'
import { RepoError } from '../db/repositories/errors'
import { emitWorkspaceItemsChanged } from '../ipc/events'
import type { AgentSandboxService } from './agentSandbox'
import { importWorkspaceAssets } from './workspaceAssets'

const MAX_ARTIFACTS = 20
const MAX_ARTIFACT_SIZE = 256 * 1024 * 1024

interface AgentArtifactPublisherDeps {
  repos: Repositories
  sandboxService: AgentSandboxService
  win: () => BrowserWindow | null
}

export function createAgentArtifactPublisher(deps: AgentArtifactPublisherDeps) {
  async function publish(
    workspaceId: string | null | undefined,
    paths: string[],
    placement?: WorkspaceItemPlacement
  ): Promise<{ published: AgentPublishedArtifact[]; errors: Array<{ path: string; message: string }> }> {
    if (!workspaceId) {
      return {
        published: [],
        errors: paths.map((path) => ({ path, message: 'No workspace is selected; artifact remains in the default sandbox.' }))
      }
    }
    const unique = [...new Set(paths.map((path) => path.trim()).filter(Boolean))]
    if (unique.length === 0) throw new RepoError('invalid_request', 'No artifact paths were provided')
    if (unique.length > MAX_ARTIFACTS) {
      throw new RepoError('invalid_request', `A maximum of ${MAX_ARTIFACTS} artifacts can be published at once`)
    }
    const resolved: Array<{ relativePath: string; filePath: string }> = []
    const validationErrors: Array<{ path: string; message: string }> = []
    const outputsRoot = deps.sandboxService.paths(workspaceId).outputsRoot
    for (const path of unique) {
      try {
        const filePath = deps.sandboxService.requireRegularFile(workspaceId, path)
        const relativeToOutputs = relative(outputsRoot, filePath)
        if (relativeToOutputs === '..' || relativeToOutputs.startsWith(`..${sep}`) || isAbsolute(relativeToOutputs)) {
          throw new RepoError('invalid_path', 'Only files under the sandbox outputs directory can be published')
        }
        const size = statSync(filePath).size
        if (size > MAX_ARTIFACT_SIZE) {
          throw new RepoError('file_too_large', `Artifact exceeds ${MAX_ARTIFACT_SIZE} bytes`)
        }
        resolved.push({ relativePath: path, filePath })
      } catch (error) {
        validationErrors.push({ path, message: error instanceof Error ? error.message : String(error) })
      }
    }
    const result = resolved.length > 0
      ? await importWorkspaceAssets(deps.repos, workspaceId, resolved.map((entry) => entry.filePath), placement)
      : { imported: [], errors: [] }
    const published = result.imported.map((asset) => ({
      path: resolved.find((entry) => entry.filePath === asset.sourcePath)?.relativePath ?? asset.sourcePath,
      assetId: asset.id,
      fileName: asset.fileName
    }))
    const win = deps.win()
    if (published.length > 0 && win && !win.isDestroyed()) {
      emitWorkspaceItemsChanged(win, { workspaceId, reason: 'other' })
    }
    return { published, errors: [...validationErrors, ...result.errors] }
  }

  return { publish }
}

export type AgentArtifactPublisher = ReturnType<typeof createAgentArtifactPublisher>
