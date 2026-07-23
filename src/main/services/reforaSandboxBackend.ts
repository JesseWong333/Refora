import { FilesystemBackend } from 'deepagents'
import type {
  DeleteResult,
  EditResult,
  ExecuteResponse,
  FileDownloadResponse,
  FileUploadResponse,
  GlobResult,
  GrepResult,
  LsResult,
  ReadRawResult,
  ReadResult,
  SandboxBackendProtocolV2,
  WriteResult
} from 'deepagents'
import type { AgentExecutionService } from './agentExecution'
import type { AgentSandboxService } from './agentSandbox'

interface ReforaSandboxBackendDeps {
  workspaceId: string | null
  signal: AbortSignal
  executionService: AgentExecutionService
  sandboxService: AgentSandboxService
}

export async function createReforaSandboxBackend(
  deps: ReforaSandboxBackendDeps
): Promise<SandboxBackendProtocolV2> {
  const paths = await deps.sandboxService.ensure(deps.workspaceId)
  const files = new FilesystemBackend({
    rootDir: paths.sandboxRoot,
    virtualMode: true,
    maxFileSizeMb: 25
  })

  return {
    id: deps.workspaceId ? `workspace:${deps.workspaceId}` : 'global',
    async execute(command: string): Promise<ExecuteResponse> {
      try {
        const result = await deps.executionService.execute({
          workspaceId: deps.workspaceId,
          script: command,
          cwd: '.',
          timeoutSeconds: 300,
          signal: deps.signal
        })
        const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
        return {
          output,
          exitCode: result.exitCode,
          truncated: result.truncated
        }
      } catch (error) {
        return {
          output: error instanceof Error ? error.message : String(error),
          exitCode: null,
          truncated: false
        }
      }
    },
    ls(path: string): Promise<LsResult> {
      return files.ls(path)
    },
    read(path: string, offset?: number, limit?: number): Promise<ReadResult> {
      return files.read(path, offset, limit)
    },
    readRaw(path: string): Promise<ReadRawResult> {
      return files.readRaw(path)
    },
    write(path: string, content: string): Promise<WriteResult> {
      return files.write(path, content)
    },
    edit(
      path: string,
      oldString: string,
      newString: string,
      replaceAll?: boolean
    ): Promise<EditResult> {
      return files.edit(path, oldString, newString, replaceAll)
    },
    delete(path: string): Promise<DeleteResult> {
      return files.delete(path)
    },
    grep(pattern: string, path?: string | null, glob?: string | null): Promise<GrepResult> {
      return files.grep(pattern, path ?? undefined, glob)
    },
    glob(pattern: string, path?: string): Promise<GlobResult> {
      return files.glob(pattern, path)
    },
    uploadFiles(filesToUpload: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
      return files.uploadFiles(filesToUpload)
    },
    downloadFiles(pathsToDownload: string[]): Promise<FileDownloadResponse[]> {
      return files.downloadFiles(pathsToDownload)
    }
  }
}
