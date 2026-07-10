import { create } from 'zustand'
import type {
  Workspace,
  WorkspaceItem,
  WorkspaceItemKind,
  AiReport,
  ChatThread,
  WorkspaceItemsChangedEvent
} from '../../shared/ipc-types'
import { errorMessage } from '../../shared/ipc-types'
import { api } from '../ipc'
import { useDocumentStore } from './documentStore'

interface WorkspaceState {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  activeThreadId: string | null
  panelOpen: boolean
  fullscreen: boolean
  items: WorkspaceItem[]
  reports: AiReport[]
  threads: ChatThread[]
  initialized: boolean
  init: () => void
  destroy: () => void
  fetchWorkspaces: () => Promise<void>
  createWorkspace: (name: string) => Promise<Workspace | null>
  renameWorkspace: (id: string, name: string) => Promise<void>
  deleteWorkspace: (id: string) => Promise<void>
  setActiveWorkspace: (id: string) => void
  setActiveThreadId: (id: string | null) => void
  deleteThread: (threadId: string) => Promise<void>
  fetchThreads: () => Promise<void>
  startNewChat: () => void
  openPanel: () => void
  closePanel: () => void
  toggleFullscreen: () => void
  fetchItems: () => Promise<void>
  addDocs: (docIds: string[]) => Promise<void>
  removeItem: (itemId: string) => Promise<void>
  fetchReports: () => Promise<void>
  deleteReport: (id: string) => Promise<void>
  updateReport: (id: string, patch: { title?: string; contentMd?: string }) => Promise<void>
  addItem: (kind: WorkspaceItemKind, ids: string[]) => Promise<void>
}

const aiSummaryUpdatedCb: Array<null | ((docId: string) => void)> = [null]
const aiReportCreatedCb: Array<null | ((report: AiReport) => void)> = [null]
const workspaceItemsChangedCb: Array<null | ((payload: WorkspaceItemsChangedEvent) => void)> = [null]

function toast(message: string): void {
  useDocumentStore.getState().showToast(message)
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  activeThreadId: null,
  panelOpen: false,
  fullscreen: false,
  items: [],
  reports: [],
  threads: [],
  initialized: false,

  init: () => {
    if (get().initialized) return
    set({ initialized: true })

    aiSummaryUpdatedCb[0] = (_docId: string) => {
      void get().fetchItems()
    }
    api.events.onAiSummaryUpdated(aiSummaryUpdatedCb[0])

    aiReportCreatedCb[0] = (report: AiReport) => {
      if (report.workspaceId === get().activeWorkspaceId) {
        set((s) => ({ reports: [...s.reports, report] }))
      }
    }
    api.events.onAiReportCreated(aiReportCreatedCb[0])

    workspaceItemsChangedCb[0] = (payload: WorkspaceItemsChangedEvent) => {
      if (payload.workspaceId === get().activeWorkspaceId) {
        void get().fetchItems()
      }
    }
    api.events.onWorkspaceItemsChanged(workspaceItemsChangedCb[0])

    void get().fetchWorkspaces()
  },

  destroy: () => {
    if (aiSummaryUpdatedCb[0]) {
      api.events.off('ai:summary:updated', aiSummaryUpdatedCb[0])
      aiSummaryUpdatedCb[0] = null
    }
    if (aiReportCreatedCb[0]) {
      api.events.off('ai:report:created', aiReportCreatedCb[0])
      aiReportCreatedCb[0] = null
    }
    if (workspaceItemsChangedCb[0]) {
      api.events.off('workspace:items:changed', workspaceItemsChangedCb[0])
      workspaceItemsChangedCb[0] = null
    }
    set({ initialized: false })
  },

  fetchWorkspaces: async () => {
    try {
      const list = await api.workspaces.list()
      set({ workspaces: list })
    } catch (e) {
      toast(errorMessage(e, 'Failed to load workspaces'))
    }
  },

  createWorkspace: async (name: string): Promise<Workspace | null> => {
    try {
      const ws = await api.workspaces.create(name)
      set((s) => ({ workspaces: [...s.workspaces, ws] }))
      return ws
    } catch (e) {
      toast(errorMessage(e, 'Failed to create workspace'))
      return null
    }
  },

  renameWorkspace: async (id: string, name: string) => {
    try {
      await api.workspaces.rename(id, name)
      set((s) => ({
        workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name } : w))
      }))
    } catch (e) {
      toast(errorMessage(e, 'Failed to rename workspace'))
    }
  },

  deleteWorkspace: async (id: string) => {
    try {
      await api.workspaces.delete(id)
      set((s) => {
        const activeCleared = s.activeWorkspaceId === id
        return {
          workspaces: s.workspaces.filter((w) => w.id !== id),
          ...(activeCleared
            ? {
                activeWorkspaceId: null,
                activeThreadId: null,
                panelOpen: false,
                items: [],
                reports: [],
                threads: []
              }
            : {})
        }
      })
    } catch (e) {
      toast(errorMessage(e, 'Failed to delete workspace'))
    }
  },

  setActiveWorkspace: (id: string) => {
    set({ activeWorkspaceId: id, panelOpen: true })
    void get().fetchItems()
    void get().fetchReports()
    void api.ai.chatThreads(id).then((threads) => {
      if (get().activeWorkspaceId !== id) return
      const latest = threads.length > 0 ? threads[0] : null
      set({ activeThreadId: latest ? latest.id : null })
    }).catch(() => {
      set({ activeThreadId: null })
    })
  },

  setActiveThreadId: (id: string | null) => {
    set({ activeThreadId: id })
  },

  deleteThread: async (threadId: string) => {
    try {
      await api.ai.chatDeleteThread(threadId)
      if (get().activeThreadId === threadId) {
        set({ activeThreadId: null })
      }
    } catch (e) {
      toast(errorMessage(e, 'Failed to delete thread'))
    }
  },

  fetchThreads: async () => {
    const id = get().activeWorkspaceId
    if (!id) {
      set({ threads: [] })
      return
    }
    try {
      const list = await api.ai.chatThreads(id)
      set({ threads: list })
    } catch {
      set({ threads: [] })
    }
  },

  startNewChat: () => {
    set({ activeThreadId: null })
  },

  openPanel: () => {
    set({ panelOpen: true })
  },

  closePanel: () => {
    set({ panelOpen: false })
  },

  toggleFullscreen: () => {
    set((s) => ({ fullscreen: !s.fullscreen }))
  },

  fetchItems: async () => {
    const id = get().activeWorkspaceId
    if (!id) {
      set({ items: [] })
      return
    }
    try {
      const list = await api.workspaceItems.list(id)
      set({ items: list })
    } catch (e) {
      toast(errorMessage(e, 'Failed to load workspace items'))
    }
  },

  addDocs: async (docIds: string[]) => {
    const id = get().activeWorkspaceId
    if (!id || docIds.length === 0) return
    try {
      await api.workspaceItems.add(id, 'document', docIds)
      await get().fetchItems()
    } catch (e) {
      toast(errorMessage(e, 'Failed to add documents to workspace'))
    }
  },

  addItem: async (kind: WorkspaceItemKind, ids: string[]) => {
    const id = get().activeWorkspaceId
    if (!id || ids.length === 0) return
    try {
      await api.workspaceItems.add(id, kind, ids)
      await get().fetchItems()
    } catch (e) {
      toast(errorMessage(e, 'Failed to add items to workspace'))
    }
  },

  removeItem: async (itemId: string) => {
    try {
      await api.workspaceItems.remove(itemId)
      await get().fetchItems()
    } catch (e) {
      toast(errorMessage(e, 'Failed to remove item'))
    }
  },

  fetchReports: async () => {
    const id = get().activeWorkspaceId
    if (!id) {
      set({ reports: [] })
      return
    }
    try {
      const list = await api.reports.list(id)
      set({ reports: list })
    } catch (e) {
      toast(errorMessage(e, 'Failed to load reports'))
    }
  },

  deleteReport: async (id: string) => {
    const prev = get().reports
    set((s) => ({ reports: s.reports.filter((r) => r.id !== id) }))
    try {
      await api.reports.delete(id)
    } catch (e) {
      set({ reports: prev })
      toast(errorMessage(e, 'Failed to delete report'))
    }
  },

  updateReport: async (id: string, patch: { title?: string; contentMd?: string }) => {
    const prev = get().reports
    try {
      const updated = await api.reports.update(id, patch)
      set((s) => ({ reports: s.reports.map((r) => (r.id === id ? updated : r)) }))
    } catch (e) {
      toast(errorMessage(e, 'Failed to update report'))
      set({ reports: prev })
    }
  }
}))
