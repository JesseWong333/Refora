import type { BrowserWindow } from 'electron'
import { IpcChannel } from '../../shared/ipc-channels'
import type { Document, ImportProgress } from '../../shared/ipc-types'

export function emitDocumentUpdated(win: BrowserWindow, doc: Document): void {
  if (!win.isDestroyed()) {
    win.webContents.send(IpcChannel.EventDocumentUpdated, doc)
  }
}

export function emitImportProgress(win: BrowserWindow, payload: ImportProgress): void {
  if (!win.isDestroyed()) {
    win.webContents.send(IpcChannel.EventImportProgress, payload)
  }
}
