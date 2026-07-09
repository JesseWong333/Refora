import { existsSync, readdirSync, statSync } from 'node:fs'
import { resolve as resolvePath, parse as parsePath, join } from 'node:path'
import { shell, type BrowserWindow } from 'electron'
import type { Repositories } from '../db/repositories'
import type { Document } from '../../shared/ipc-types'
import { RepoError } from '../db/repositories/errors'
import { emitDocumentUpdated } from '../ipc/events'
import { logger } from './logger'

export function findPdfsRecursively(
  dir: string,
  opts?: { skipHidden?: boolean }
): string[] {
  const skipHidden = opts?.skipHidden ?? true
  const results: string[] = []
  try {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      if (skipHidden && (entry === '.git' || entry.startsWith('.'))) continue
      const full = resolvePath(join(dir, entry))
      try {
        const st = statSync(full)
        if (st.isDirectory()) {
          results.push(...findPdfsRecursively(full, opts))
        } else if (st.isFile() && full.toLowerCase().endsWith('.pdf')) {
          results.push(full)
        }
      } catch {
        continue
      }
    }
  } catch {
    return []
  }
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

export function relocate(
  repos: Repositories,
  id: string,
  newPath: string
): Document {
  const resolved = resolvePath(newPath)
  if (!resolved.toLowerCase().endsWith('.pdf')) {
    throw new RepoError('invalid_path', 'Selected file must be a PDF')
  }
  if (!existsSync(resolved)) {
    throw new RepoError('invalid_path', `File not found: ${resolved}`)
  }
  const doc = repos.documents.get(id)
  if (!doc) throw new RepoError('not_found', `Document ${id} not found`)

  const fileName = parsePath(resolved).base
  repos.documents.updateFilePath(id, resolved, fileName)
  repos.documents.setFileMissing(id, false)

  return repos.documents.get(id) as Document
}

async function trashFile(filePath: string): Promise<void> {
  const resolved = resolvePath(filePath)
  if (!existsSync(resolved)) return
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
  repos.documents.delete(id)
}

export async function bulkDeleteDocuments(
  repos: Repositories,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return
  const trashEntries: Array<{ id: string; filePath: string }> = []
  const fileMissingIds = new Set<string>()
  for (const id of ids) {
    const doc = repos.documents.get(id)
    if (!doc) continue
    if (doc.fileMissing) {
      fileMissingIds.add(id)
    } else {
      trashEntries.push({ id, filePath: doc.filePath })
    }
  }
  const results = await Promise.allSettled(
    trashEntries.map((d) => trashFile(d.filePath))
  )
  const trashed = new Set<string>()
  results.forEach((result, index) => {
    const { id, filePath } = trashEntries[index]
    if (result.status === 'fulfilled') {
      trashed.add(id)
    } else {
      logger.warn(
        `bulkDelete:trash-failed ${filePath}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
      )
    }
  })
  const deletable = ids.filter((id) => fileMissingIds.has(id) || trashed.has(id))
  if (deletable.length > 0) repos.documents.bulkDelete(deletable)
}
