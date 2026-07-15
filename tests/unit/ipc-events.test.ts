import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import {
  emitAiChatDone,
  emitAiChatError,
  emitAiChatReasoning,
  emitAiChatTitleUpdated,
  emitAiChatToken,
  emitAiChatTrace,
  emitAiReportCreated,
  emitAiSummaryError,
  emitAiSummaryUpdated,
  emitDocumentUpdated,
  emitImportProgress,
  emitLibraryScanning,
  emitLibrarySwitched,
  emitWorkspaceItemsChanged
} from '../../src/main/ipc/events'
import { IpcChannel } from '../../src/shared/ipc-channels'
import type { AgentTraceStep, AiReport, Document } from '../../src/shared/ipc-types'

function makeWindow(destroyed: boolean) {
  return {
    isDestroyed: vi.fn(() => destroyed),
    webContents: { send: vi.fn() }
  } as unknown as BrowserWindow
}

describe('main IPC event emitters', () => {
  it('sends every event on its shared channel', () => {
    const win = makeWindow(false)
    const document = { id: 'doc-1' } as Document
    const progress = { current: 1, total: 2 }
    const switchResult = {
      libraryFolderPath: '/library',
      dbExisted: true,
      scanned: 2,
      imported: 1,
      skipped: 1,
      errors: []
    }
    const report = { id: 'report-1' } as AiReport
    const trace = {
      threadId: 'thread-1',
      runId: 'run-1',
      step: { id: 'step-1' } as AgentTraceStep
    }

    const cases: Array<[string, unknown, () => void]> = [
      [IpcChannel.EventDocumentUpdated, document, () => emitDocumentUpdated(win, document)],
      [IpcChannel.EventImportProgress, progress, () => emitImportProgress(win, progress)],
      [IpcChannel.EventLibraryScanning, progress, () => emitLibraryScanning(win, progress)],
      [IpcChannel.EventLibrarySwitched, switchResult, () => emitLibrarySwitched(win, switchResult)],
      [IpcChannel.EventAiSummaryUpdated, 'doc-1', () => emitAiSummaryUpdated(win, 'doc-1')],
      [
        IpcChannel.EventAiSummaryError,
        { docId: 'doc-1', message: 'failed' },
        () => emitAiSummaryError(win, { docId: 'doc-1', message: 'failed' })
      ],
      [
        IpcChannel.EventAiChatToken,
        { threadId: 'thread-1', token: 'a' },
        () => emitAiChatToken(win, { threadId: 'thread-1', token: 'a' })
      ],
      [
        IpcChannel.EventAiChatReasoning,
        { threadId: 'thread-1', token: 'thinking' },
        () => emitAiChatReasoning(win, { threadId: 'thread-1', token: 'thinking' })
      ],
      [
        IpcChannel.EventAiChatDone,
        { threadId: 'thread-1', finalText: 'done' },
        () => emitAiChatDone(win, { threadId: 'thread-1', finalText: 'done' })
      ],
      [
        IpcChannel.EventAiChatError,
        { threadId: 'thread-1', message: 'failed' },
        () => emitAiChatError(win, { threadId: 'thread-1', message: 'failed' })
      ],
      [IpcChannel.EventAiChatTrace, trace, () => emitAiChatTrace(win, trace)],
      [
        IpcChannel.EventAiChatTitleUpdated,
        { threadId: 'thread-1', title: 'Title' },
        () => emitAiChatTitleUpdated(win, { threadId: 'thread-1', title: 'Title' })
      ],
      [IpcChannel.EventAiReportCreated, report, () => emitAiReportCreated(win, report)],
      [
        IpcChannel.EventWorkspaceItemsChanged,
        { workspaceId: 'workspace-1', reason: 'user' },
        () => emitWorkspaceItemsChanged(win, { workspaceId: 'workspace-1', reason: 'user' })
      ]
    ]

    for (const [channel, payload, emit] of cases) {
      emit()
      expect(win.webContents.send).toHaveBeenLastCalledWith(channel, payload)
    }
    expect(win.webContents.send).toHaveBeenCalledTimes(cases.length)
  })

  it('does not send to a destroyed window', () => {
    const win = makeWindow(true)

    emitDocumentUpdated(win, { id: 'doc-1' } as Document)
    emitAiSummaryUpdated(win, 'doc-1')
    emitWorkspaceItemsChanged(win, { workspaceId: 'workspace-1', reason: 'other' })

    expect(win.webContents.send).not.toHaveBeenCalled()
  })
})
