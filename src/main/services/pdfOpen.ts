import { shell, type BrowserWindow } from 'electron'
import type { Repositories } from '../db/repositories'
import { emitDocumentUpdated } from '../ipc/events'
import type { Document } from '../../shared/ipc-types'
import { RepoError } from '../db/repositories/errors'

export async function openPdf(repos: Repositories, win: BrowserWindow | null, docId: string): Promise<Document> {
  const doc = repos.documents.get(docId)
  if (!doc) throw new RepoError('not_found', `Document ${docId} not found`)
  if (doc.fileMissing) throw new RepoError('file_missing', 'Source PDF file is missing')

  const errMsg = await shell.openPath(doc.filePath)
  if (errMsg !== '') {
    throw new RepoError('open_failed', errMsg)
  }

  repos.documents.setLastReadAt(docId, Date.now())
  const updated = repos.documents.get(docId) as Document
  if (win) emitDocumentUpdated(win, updated)
  return updated
}
