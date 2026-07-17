import { existsSync, statSync } from 'node:fs'
import { opendir, realpath } from 'node:fs/promises'
import { resolve as resolvePath, parse as parsePath, join } from 'node:path'
import { shell, type BrowserWindow } from 'electron'
import type { Repositories } from '../db/repositories'
import type { Document } from '../../shared/ipc-types'
import { RepoError } from '../db/repositories/errors'
import { emitDocumentUpdated } from '../ipc/events'
import { logger } from './logger'
import { resolvePdfFilePath } from './pdfPath'
import { streamFileHash } from './fileHash'
import { WORKSPACE_ASSET_DIRECTORY } from '../../shared/ipc-types'

export async function findPdfsRecursively(
  dir: string,
  opts?: { skipHidden?: boolean; signal?: AbortSignal }
): Promise<string[]> {
  const skipHidden = opts?.skipHidden ?? true
  const results: string[] = []
  const visited = new Set<string>()

  async function walk(currentDir: string): Promise<void> {
    if (opts?.signal?.aborted) return
    try {
      const canonical = await realpath(currentDir)
      if (visited.has(canonical)) return
      visited.add(canonical)
      const entries = await opendir(currentDir)
      for await (const entry of entries) {
        if (opts?.signal?.aborted) return
        if (
          entry.name === WORKSPACE_ASSET_DIRECTORY ||
          (skipHidden && (entry.name === '.git' || entry.name.startsWith('.')))
        ) continue
        if (entry.isSymbolicLink()) continue
        const full = resolvePath(join(currentDir, entry.name))
        if (entry.isDirectory()) {
          await walk(full)
        } else if (entry.isFile() && full.toLowerCase().endsWith('.pdf')) {
          results.push(full)
        }
      }
    } catch {
      return
    }
  }

  await walk(resolvePath(dir))
  return results
}

export function checkMissing(
  repos: Repositories,
  win: BrowserWindow | null,
  signal?: AbortSignal
): void {
  const docs = repos.documents.list({ mode: 'all' })
  const batchSize = 50
  let i = 0
  const changed: Document[] = []

  function emitBatch() {
    if (signal?.aborted) return
    if (!win || changed.length === 0) return
    const slice = changed.splice(0, batchSize)
    for (const doc of slice) emitDocumentUpdated(win, doc)
    if (changed.length > 0) setImmediate(emitBatch)
  }

  function processBatch() {
    if (signal?.aborted) return
    const end = Math.min(i + batchSize, docs.length)
    for (; i < end; i++) {
      const doc = docs[i]
      const exists = existsSync(doc.filePath)
      const currentlyMissing = doc.fileMissing === 1
      if (!exists && !currentlyMissing) {
        repos.documents.setFileMissing(doc.id, true)
        const updated = repos.documents.get(doc.id)
        if (updated) changed.push(updated)
      } else if (exists && currentlyMissing) {
        repos.documents.setFileMissing(doc.id, false)
        const updated = repos.documents.get(doc.id)
        if (updated) changed.push(updated)
      }
    }
    if (i < docs.length) {
      setImmediate(processBatch)
    } else {
      emitBatch()
    }
  }

  processBatch()
}

export async function relocate(
  repos: Repositories,
  id: string,
  newPath: string
): Promise<Document> {
  const doc = repos.documents.get(id)
  if (!doc) throw new RepoError('not_found', `Document ${id} not found`)

  const resolved = resolvePdfFilePath(resolvePath(newPath))
  const fileName = parsePath(resolved).base
  const fileSize = statSync(resolved).size
  const fileHash = await streamFileHash(resolved)
  const fileChanged = doc.fileHash !== fileHash
  repos.transaction(() => {
    repos.documents.updateFileIdentity(id, resolved, fileName, fileSize, fileHash)
    if (fileChanged) {
      repos.aiSummaries.delete(id)
    }
  })

  return repos.documents.get(id) as Document
}

async function trashFile(filePath: string): Promise<void> {
  let resolved: string
  try {
    resolved = resolvePdfFilePath(filePath)
  } catch (error) {
    if (error instanceof RepoError && error.code === 'file_missing') return
    throw error
  }
  await shell.trashItem(resolved)
}

export async function deleteDocument(repos: Repositories, id: string): Promise<void> {
  const doc = repos.documents.get(id)
  if (doc && !doc.fileMissing) {
    try {
      await trashFile(doc.filePath)
    } catch (e) {
      logger.warn(
        `delete:trash-failed ${doc.filePath}: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }
  repos.transaction(() => {
    repos.documents.delete(id)
    repos.aiSummaries.delete(id)
    repos.workspaceItems.removeByDocId(id)
    repos.aiReports.removeDocFromSources(id)
  })
}

export async function bulkDeleteDocuments(
  repos: Repositories,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return
  const trashEntries: Array<{ id: string; filePath: string }> = []
  const knownIds = new Set<string>()
  for (const id of ids) {
    const doc = repos.documents.get(id)
    if (!doc) continue
    knownIds.add(id)
    if (!doc.fileMissing) {
      trashEntries.push({ id, filePath: doc.filePath })
    }
  }
  const results = await Promise.allSettled(
    trashEntries.map((d) => trashFile(d.filePath))
  )
  results.forEach((result, index) => {
    const { filePath } = trashEntries[index]
    if (result.status === 'rejected') {
      logger.warn(
        `bulkDelete:trash-failed ${filePath}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
      )
    }
  })
  const deletable = ids.filter((id) => knownIds.has(id))
  if (deletable.length > 0) {
    repos.transaction(() => {
      repos.documents.bulkDelete(deletable)
      for (const id of deletable) {
        repos.aiSummaries.delete(id)
        repos.workspaceItems.removeByDocId(id)
        repos.aiReports.removeDocFromSources(id)
      }
    })
  }
}
