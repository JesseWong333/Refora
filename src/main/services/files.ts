import { existsSync } from 'node:fs'
import { resolve as resolvePath, parse as parsePath } from 'node:path'
import { shell, type BrowserWindow } from 'electron'
import type { Repositories } from '../db/repositories'
import type { Document } from '../../shared/ipc-types'
import { RepoError } from '../db/repositories/errors'
import { emitDocumentUpdated } from '../ipc/events'
import { logger } from './logger'

export function checkMissing(
  repos: Repositories,
  win: BrowserWindow | null
): void {
  const docs = repos.documents.list({ mode: 'all' })
  const batchSize = 50
  let i = 0

  function processBatch() {
    const end = Math.min(i + batchSize, docs.length)
    for (; i < end; i++) {
      const doc = docs[i]
      const exists = existsSync(doc.filePath)
      const currentlyMissing = doc.fileMissing === 1
      if (!exists && !currentlyMissing) {
        repos.documents.setFileMissing(doc.id, true)
        if (win) {
          const updated = repos.documents.get(doc.id)
          if (updated) emitDocumentUpdated(win, updated)
        }
      } else if (exists && currentlyMissing) {
        repos.documents.setFileMissing(doc.id, false)
        if (win) {
          const updated = repos.documents.get(doc.id)
          if (updated) emitDocumentUpdated(win, updated)
        }
      }
    }
    if (i < docs.length) {
      setImmediate(processBatch)
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
  try {
    await shell.trashItem(resolved)
  } catch (e) {
    logger.warn(
      `delete:trash-failed ${resolved}: ${e instanceof Error ? e.message : String(e)}`
    )
  }
}

export async function deleteDocument(repos: Repositories, id: string): Promise<void> {
  const doc = repos.documents.get(id)
  if (doc && !doc.fileMissing) {
    await trashFile(doc.filePath)
  }
  repos.documents.delete(id)
}

export async function bulkDeleteDocuments(
  repos: Repositories,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return
  const docs = ids
    .map((id) => repos.documents.get(id))
    .filter((d): d is Document => d !== null && !d.fileMissing)
  await Promise.all(docs.map((d) => trashFile(d.filePath)))
  repos.documents.bulkDelete(ids)
}
