import type { BrowserWindow } from 'electron'
import { IpcChannel } from '../../shared/ipc-channels'
import type {
  AiReport,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatTokenEvent,
  ChatTraceEvent,
  Document,
  ImportProgress,
  LibrarySwitchResult,
  SummaryErrorEvent,
  WorkspaceItemsChangedEvent
} from '../../shared/ipc-types'

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

export function emitAiSummaryUpdated(win: BrowserWindow, docId: string): void {
  if (!win.isDestroyed()) {
    win.webContents.send(IpcChannel.EventAiSummaryUpdated, docId)
  }
}

export function emitAiSummaryError(win: BrowserWindow, payload: SummaryErrorEvent): void {
  if (!win.isDestroyed()) {
    win.webContents.send(IpcChannel.EventAiSummaryError, payload)
  }
}

export function emitAiChatToken(win: BrowserWindow, payload: ChatTokenEvent): void {
  if (!win.isDestroyed()) {
    win.webContents.send(IpcChannel.EventAiChatToken, payload)
  }
}

export function emitAiChatDone(win: BrowserWindow, payload: ChatDoneEvent): void {
  if (!win.isDestroyed()) {
    win.webContents.send(IpcChannel.EventAiChatDone, payload)
  }
}

export function emitAiChatError(win: BrowserWindow, payload: ChatErrorEvent): void {
  if (!win.isDestroyed()) {
    win.webContents.send(IpcChannel.EventAiChatError, payload)
  }
}

export function emitAiChatTrace(win: BrowserWindow, payload: ChatTraceEvent): void {
  if (!win.isDestroyed()) {
    win.webContents.send(IpcChannel.EventAiChatTrace, payload)
  }
}

export function emitAiReportCreated(win: BrowserWindow, report: AiReport): void {
  if (!win.isDestroyed()) {
    win.webContents.send(IpcChannel.EventAiReportCreated, report)
  }
}

export function emitWorkspaceItemsChanged(win: BrowserWindow, payload: WorkspaceItemsChangedEvent): void {
  if (!win.isDestroyed()) {
    win.webContents.send(IpcChannel.EventWorkspaceItemsChanged, payload)
  }
}
