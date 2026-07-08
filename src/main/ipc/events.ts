import type { BrowserWindow } from 'electron'
import { IpcChannel } from '../../shared/ipc-channels'
import type { Document, ImportProgress, LibrarySwitchResult } from '../../shared/ipc-types'

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

export function emitLibraryScanning(win: BrowserWindow, payload: ImportProgress): void {
  if (!win.isDestroyed()) {
    win.webContents.send(IpcChannel.EventLibraryScanning, payload)
  }
}

export function emitLibrarySwitched(win: BrowserWindow, payload: LibrarySwitchResult): void {
  if (!win.isDestroyed()) {
    win.webContents.send(IpcChannel.EventLibrarySwitched, payload)
  }
}
