import { randomUUID } from 'node:crypto'
import { constants, existsSync, lstatSync, statSync } from 'node:fs'
import { copyFile, mkdir, open as openFile, rm } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import { shell } from 'electron'
import type { Repositories } from '../db/repositories'
import { RepoError } from '../db/repositories/errors'
import {
  WORKSPACE_ASSET_DIRECTORY,
  type WorkspaceAsset,
  type WorkspaceAssetImportResult,
  type WorkspaceAssetPreviewKind,
  type WorkspaceAssetTextPreview,
  type WorkspaceItemPlacement
} from '../../shared/ipc-types'
import { streamFileHash } from './fileHash'
import { resolveFromLibrary, toLibraryRelative } from './paths'
import { logger } from './logger'

export const WORKSPACE_ASSET_TEXT_PREVIEW_LIMIT = 256 * 1024

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon'
}

const AUDIO_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg'
}

const VIDEO_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm'
}

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.xml', '.yaml', '.yml',
  '.toml', '.ini', '.log', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss',
  '.less', '.html', '.htm', '.py', '.rb', '.rs', '.go', '.java', '.kt', '.swift', '.c', '.h',
  '.cpp', '.hpp', '.cs', '.php', '.sh', '.zsh', '.fish', '.sql', '.bib', '.tex', '.rtf'
])

export function workspaceAssetMediaType(fileName: string): {
  mimeType: string
  previewKind: WorkspaceAssetPreviewKind
} {
  const extension = extname(fileName).toLowerCase()
  if (IMAGE_TYPES[extension]) return { mimeType: IMAGE_TYPES[extension], previewKind: 'image' }
  if (AUDIO_TYPES[extension]) return { mimeType: AUDIO_TYPES[extension], previewKind: 'audio' }
  if (VIDEO_TYPES[extension]) return { mimeType: VIDEO_TYPES[extension], previewKind: 'video' }
  if (TEXT_EXTENSIONS.has(extension)) {
    const mimeType = extension === '.json' || extension === '.jsonl'
      ? 'application/json'
      : extension === '.md' || extension === '.markdown'
        ? 'text/markdown'
        : extension === '.csv'
          ? 'text/csv'
          : extension === '.tsv'
            ? 'text/tab-separated-values'
            : 'text/plain'
    return { mimeType, previewKind: 'text' }
  }
  if (extension === '.pdf') return { mimeType: 'application/pdf', previewKind: 'none' }
  return { mimeType: 'application/octet-stream', previewKind: 'none' }
}

function requireLibraryFolder(repos: Repositories): string {
  const libraryFolder = repos.settings.get<string>('libraryFolderPath', '')
  if (!libraryFolder) throw new RepoError('library_not_configured', 'Library folder is not configured')
  const resolved = resolvePath(libraryFolder)
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new RepoError('invalid_library', `Library folder is unavailable: ${resolved}`)
  }
  return resolved
}

function validateSourceFile(rawPath: string): string {
  if (!rawPath || !isAbsolute(rawPath)) {
    throw new RepoError('invalid_path', 'Workspace asset path must be absolute')
  }
  const resolved = resolvePath(rawPath)
  if (!existsSync(resolved)) throw new RepoError('file_missing', `File not found: ${resolved}`)
  try {
    if (lstatSync(resolved).isSymbolicLink() || !statSync(resolved).isFile()) {
      throw new RepoError('invalid_path', 'Workspace assets must be regular files')
    }
  } catch (error) {
    if (error instanceof RepoError) throw error
    throw new RepoError('invalid_path', `Unable to inspect file: ${resolved}`)
  }
  return resolved
}

export function resolveWorkspaceAssetPath(repos: Repositories, asset: WorkspaceAsset): string {
  const libraryFolder = requireLibraryFolder(repos)
  const assetDirectory = resolvePath(libraryFolder, WORKSPACE_ASSET_DIRECTORY, asset.id)
  const resolved = resolvePath(resolveFromLibrary(asset.filePath, libraryFolder))
  const relativeToDirectory = relative(assetDirectory, resolved)
  if (
    dirname(resolved) !== assetDirectory ||
    basename(resolved) !== asset.fileName ||
    relativeToDirectory.startsWith('..') ||
    isAbsolute(relativeToDirectory)
  ) {
    throw new RepoError('invalid_path', 'Workspace asset path is outside its managed directory')
  }
  return resolved
}

export function requireWorkspaceAssetFile(repos: Repositories, id: string): {
  asset: WorkspaceAsset
  filePath: string
} {
  const asset = repos.workspaceAssets.get(id)
  if (!asset) throw new RepoError('not_found', `workspace asset not found: ${id}`)
  const filePath = resolveWorkspaceAssetPath(repos, asset)
  try {
    if (!existsSync(filePath) || lstatSync(filePath).isSymbolicLink() || !statSync(filePath).isFile()) {
      if (asset.fileMissing !== 1) repos.workspaceAssets.setFileMissing(id, true)
      throw new RepoError('file_missing', `Workspace asset is missing: ${asset.fileName}`)
    }
  } catch (error) {
    if (error instanceof RepoError) throw error
    if (asset.fileMissing !== 1) repos.workspaceAssets.setFileMissing(id, true)
    throw new RepoError('invalid_path', `Unable to inspect workspace asset: ${asset.fileName}`)
  }
  if (asset.fileMissing !== 0) repos.workspaceAssets.setFileMissing(id, false)
  return { asset: repos.workspaceAssets.get(id) as WorkspaceAsset, filePath }
}

export function listWorkspaceAssets(repos: Repositories, workspaceId: string): WorkspaceAsset[] {
  const assets = repos.workspaceAssets.list(workspaceId)
  return assets.map((asset) => {
    try {
      return requireWorkspaceAssetFile(repos, asset.id).asset
    } catch {
      return repos.workspaceAssets.get(asset.id) as WorkspaceAsset
    }
  })
}

export async function importWorkspaceAssets(
  repos: Repositories,
  workspaceId: string,
  paths: string[],
  placement?: WorkspaceItemPlacement
): Promise<WorkspaceAssetImportResult> {
  if (!repos.workspaces.list().some((workspace) => workspace.id === workspaceId)) {
    throw new RepoError('not_found', `workspace not found: ${workspaceId}`)
  }
  const libraryFolder = requireLibraryFolder(repos)
  const imported: WorkspaceAsset[] = []
  const errors: Array<{ path: string; message: string }> = []
  const uniquePaths = [...new Set(paths.filter((path): path is string => typeof path === 'string' && path.length > 0))]

  for (const rawPath of uniquePaths) {
    const id = randomUUID()
    const assetDirectory = join(libraryFolder, WORKSPACE_ASSET_DIRECTORY, id)
    try {
      const sourcePath = validateSourceFile(rawPath)
      const fileName = basename(sourcePath)
      const destination = join(assetDirectory, fileName)
      await mkdir(assetDirectory, { recursive: true })
      await copyFile(sourcePath, destination, constants.COPYFILE_EXCL)
      const fileSize = statSync(destination).size
      const fileHash = await streamFileHash(destination)
      const mediaType = workspaceAssetMediaType(fileName)
      const now = Date.now()
      const asset: WorkspaceAsset = {
        id,
        workspaceId,
        fileName,
        filePath: toLibraryRelative(destination, libraryFolder),
        sourcePath,
        mimeType: mediaType.mimeType,
        previewKind: mediaType.previewKind,
        fileSize,
        fileHash,
        fileMissing: 0,
        createdAt: now,
        updatedAt: now
      }
      const saved = repos.transaction(() => {
        const created = repos.workspaceAssets.insert(asset)
        const offset = imported.length
        const itemPlacement = placement
          ? { x: placement.x + (offset % 3) * 28, y: placement.y + Math.floor(offset / 3) * 28 }
          : undefined
        repos.workspaceItems.add(workspaceId, 'asset', [created.id], itemPlacement)
        return created
      })
      imported.push(saved)
    } catch (error) {
      await rm(assetDirectory, { recursive: true, force: true }).catch(() => undefined)
      errors.push({
        path: rawPath,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return { imported, errors }
}

export async function getWorkspaceAssetTextPreview(
  repos: Repositories,
  id: string
): Promise<WorkspaceAssetTextPreview> {
  const { asset, filePath } = requireWorkspaceAssetFile(repos, id)
  if (asset.previewKind !== 'text') {
    throw new RepoError('preview_not_supported', 'This file does not support text preview')
  }
  const handle = await openFile(filePath, 'r')
  try {
    const buffer = Buffer.alloc(WORKSPACE_ASSET_TEXT_PREVIEW_LIMIT + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const truncated = bytesRead > WORKSPACE_ASSET_TEXT_PREVIEW_LIMIT
    const length = Math.min(bytesRead, WORKSPACE_ASSET_TEXT_PREVIEW_LIMIT)
    return { content: buffer.subarray(0, length).toString('utf8'), truncated }
  } finally {
    await handle.close()
  }
}

export async function openWorkspaceAsset(repos: Repositories, id: string): Promise<void> {
  const { filePath } = requireWorkspaceAssetFile(repos, id)
  const message = await shell.openPath(filePath)
  if (message) throw new RepoError('open_failed', message)
}

export function revealWorkspaceAsset(repos: Repositories, id: string): void {
  const { filePath } = requireWorkspaceAssetFile(repos, id)
  shell.showItemInFolder(filePath)
}

export async function deleteWorkspaceAsset(repos: Repositories, id: string): Promise<void> {
  const asset = repos.workspaceAssets.get(id)
  if (!asset) throw new RepoError('not_found', `workspace asset not found: ${id}`)
  const filePath = resolveWorkspaceAssetPath(repos, asset)
  const assetDirectory = dirname(filePath)
  if (existsSync(assetDirectory)) {
    try {
      await shell.trashItem(assetDirectory)
    } catch (error) {
      logger.warn(`workspaceAsset:trash-failed ${assetDirectory}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  repos.transaction(() => {
    repos.workspaceItems.removeByAssetId(id)
    repos.workspaceAssets.delete(id)
  })
}

export async function deleteWorkspaceWithAssets(repos: Repositories, workspaceId: string): Promise<void> {
  const assets = repos.workspaceAssets.list(workspaceId)
  for (const asset of assets) {
    const assetDirectory = dirname(resolveWorkspaceAssetPath(repos, asset))
    if (!existsSync(assetDirectory)) continue
    try {
      await shell.trashItem(assetDirectory)
    } catch (error) {
      logger.warn(`workspaceAsset:trash-failed ${assetDirectory}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  repos.workspaces.delete(workspaceId)
}
