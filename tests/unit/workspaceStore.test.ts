import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useWorkspaceStore } from '../../src/renderer/store/workspaceStore'
import { useDocumentStore } from '../../src/renderer/store/documentStore'
import type { AiReport, WorkspaceItemsChangedEvent } from '../../src/shared/ipc-types'

function makeReport(overrides: Partial<AiReport> = {}): AiReport {
  return {
    id: 'r1',
    workspaceId: 'ws-1',
    title: 'Test Report',
    contentMd: 'Some content',
    sourceDocIds: [],
    model: 'gpt-4o',
    createdAt: 1700000000000,
    ...overrides
  }
}

const mockReportsList = vi.fn()
const mockReportsDelete = vi.fn()
const mockChatThreads = vi.fn()
const mockEventsOff = vi.fn()
const mockOnWorkspaceItemsChanged = vi.fn()
const mockOnAiSummaryUpdated = vi.fn()
const mockOnAiReportCreated = vi.fn()
const mockWorkspacesList = vi.fn()
const mockWorkspaceItemsList = vi.fn()

function resetStoreState(): void {
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    activeThreadId: null,
    panelOpen: false,
    fullscreen: false,
    items: [],
    reports: [],
    threads: [],
    initialized: false
  })
}

beforeEach(() => {
  mockReportsList.mockReset()
  mockReportsDelete.mockReset()
  mockChatThreads.mockReset()
  mockEventsOff.mockReset()
  mockOnWorkspaceItemsChanged.mockReset()
  mockOnAiSummaryUpdated.mockReset()
  mockOnAiReportCreated.mockReset()
  mockWorkspacesList.mockReset()
  mockWorkspaceItemsList.mockReset()

  mockReportsList.mockResolvedValue([])
  mockReportsDelete.mockResolvedValue(undefined)
  mockChatThreads.mockResolvedValue([])
  mockWorkspacesList.mockResolvedValue([])
  mockWorkspaceItemsList.mockResolvedValue([])

  const api = window.api as unknown as Record<string, unknown>
  const reports = api.reports as Record<string, unknown>
  reports.list = mockReportsList
  reports.delete = mockReportsDelete

  const ai = api.ai as Record<string, unknown>
  ai.chatThreads = mockChatThreads

  const events = api.events as Record<string, unknown>
  events.off = mockEventsOff
  events.onWorkspaceItemsChanged = mockOnWorkspaceItemsChanged
  events.onAiSummaryUpdated = mockOnAiSummaryUpdated
  events.onAiReportCreated = mockOnAiReportCreated

  const workspaces = api.workspaces as Record<string, unknown>
  workspaces.list = mockWorkspacesList

  const workspaceItems = api.workspaceItems as Record<string, unknown>
  workspaceItems.list = mockWorkspaceItemsList

  useDocumentStore.setState({ showToast: vi.fn() })

  resetStoreState()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('WorkspaceStore', () => {
  describe('deleteReport', () => {
    it('optimistically removes the report from state', async () => {
      const r1 = makeReport({ id: 'r1' })
      const r2 = makeReport({ id: 'r2', title: 'Second' })
      useWorkspaceStore.setState({ reports: [r1, r2] })
      mockReportsDelete.mockResolvedValue(undefined)

      const promise = useWorkspaceStore.getState().deleteReport('r1')
      expect(useWorkspaceStore.getState().reports).toEqual([r2])
      await promise
      expect(mockReportsDelete).toHaveBeenCalledWith('r1')
      expect(useWorkspaceStore.getState().reports).toEqual([r2])
    })

    it('restores the report on failure', async () => {
      const r1 = makeReport({ id: 'r1' })
      const r2 = makeReport({ id: 'r2', title: 'Second' })
      useWorkspaceStore.setState({ reports: [r1, r2] })
      mockReportsDelete.mockRejectedValue(new Error('network'))

      await useWorkspaceStore.getState().deleteReport('r1')

      expect(useWorkspaceStore.getState().reports).toEqual([r1, r2])
    })
  })

  describe('fetchReports', () => {
    it('populates reports from api', async () => {
      const reports = [makeReport({ id: 'r1' })]
      mockReportsList.mockResolvedValue(reports)
      useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1' })

      await useWorkspaceStore.getState().fetchReports()

      expect(mockReportsList).toHaveBeenCalledWith('ws-1')
      expect(useWorkspaceStore.getState().reports).toEqual(reports)
    })

    it('clears reports when no active workspace', async () => {
      useWorkspaceStore.setState({ activeWorkspaceId: null, reports: [makeReport()] })
      await useWorkspaceStore.getState().fetchReports()
      expect(useWorkspaceStore.getState().reports).toEqual([])
    })
  })

  describe('setActiveWorkspace', () => {
    it('sets active workspace and fetches the latest thread', async () => {
      mockChatThreads.mockResolvedValue([
        { id: 'thread-1', workspaceId: 'ws-1', providerId: 'p1', createdAt: 0 }
      ])

      useWorkspaceStore.getState().setActiveWorkspace('ws-1')

      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-1')
      expect(useWorkspaceStore.getState().panelOpen).toBe(true)
      await vi.waitFor(() => {
        expect(useWorkspaceStore.getState().activeThreadId).toBe('thread-1')
      })
    })

    it('sets activeThreadId to null when no threads exist', async () => {
      mockChatThreads.mockResolvedValue([])

      useWorkspaceStore.getState().setActiveWorkspace('ws-1')

      await vi.waitFor(() => {
        expect(useWorkspaceStore.getState().activeThreadId).toBe(null)
      })
    })
  })

  describe('startNewChat', () => {
    it('clears the active thread id', () => {
      useWorkspaceStore.setState({ activeThreadId: 'thread-1' })
      useWorkspaceStore.getState().startNewChat()
      expect(useWorkspaceStore.getState().activeThreadId).toBe(null)
    })
  })

  describe('onWorkspaceItemsChanged', () => {
    it('fetches items when workspaceId matches active workspace', async () => {
      useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1' })
      useWorkspaceStore.getState().init()

      expect(mockOnWorkspaceItemsChanged).toHaveBeenCalledTimes(1)
      const cb = mockOnWorkspaceItemsChanged.mock.calls[0][0] as (
        payload: WorkspaceItemsChangedEvent
      ) => void
      cb({ workspaceId: 'ws-1', reason: 'agent_add_docs' })

      await vi.waitFor(() => {
        expect(mockWorkspaceItemsList).toHaveBeenCalledWith('ws-1')
      })
    })

    it('does not fetch items when workspaceId does not match', async () => {
      useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1' })
      useWorkspaceStore.getState().init()

      const cb = mockOnWorkspaceItemsChanged.mock.calls[0][0] as (
        payload: WorkspaceItemsChangedEvent
      ) => void
      cb({ workspaceId: 'ws-other', reason: 'user' })

      await new Promise((r) => setTimeout(r, 50))
      expect(mockWorkspaceItemsList).not.toHaveBeenCalled()
    })
  })
})
