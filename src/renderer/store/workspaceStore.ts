import { create } from 'zustand'
import type {
  Workspace,
  WorkspaceItem,
  WorkspaceItemKind,
  WorkspaceItemPlacement,
  AiReport,
  WorkspaceNote,
  WorkspaceNoteType,
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
  chatStreaming: boolean
  items: WorkspaceItem[]
  reports: AiReport[]
  notes: WorkspaceNote[]
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
  setChatStreaming: (streaming: boolean) => void
  deleteThread: (threadId: string) => Promise<void>
  renameThread: (threadId: string, title: string) => Promise<void>
  fetchThreads: () => Promise<void>
  startNewChat: () => void
  openPanel: () => void
  closePanel: () => void
  toggleFullscreen: () => void
  fetchItems: () => Promise<void>
  addDocs: (docIds: string[], placement?: WorkspaceItemPlacement) => Promise<void>
  removeItem: (itemId: string) => Promise<void>
  reorderItems: (orderedIds: string[]) => Promise<void>
  resizeItem: (itemId: string, width: number, height: number) => Promise<boolean>
  moveItem: (itemId: string, x: number, y: number, zIndex: number) => Promise<boolean>
  fetchReports: () => Promise<void>
  deleteReport: (id: string) => Promise<void>
  updateReport: (id: string, patch: { title?: string; contentMd?: string }) => Promise<boolean>
  fetchNotes: () => Promise<void>
  createNote: (title: string, contentMd: string, noteType: WorkspaceNoteType, placement?: WorkspaceItemPlacement) => Promise<WorkspaceNote | null>
  deleteNote: (id: string) => Promise<void>
  updateNote: (id: string, patch: { title?: string; contentMd?: string }) => Promise<boolean>
  addItem: (kind: WorkspaceItemKind, ids: string[], placement?: WorkspaceItemPlacement) => Promise<void>
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
  chatStreaming: false,
  items: [],
  reports: [],
  notes: [],
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
        set((s) => ({
          reports: s.reports.some((current) => current.id === report.id)
            ? s.reports.map((current) => current.id === report.id ? report : current)
            : [...s.reports, report]
        }))
        void get().fetchItems()
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
                notes: [],
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
    if (get().chatStreaming) return
    set({
      activeWorkspaceId: id,
      activeThreadId: null,
      panelOpen: true,
      items: [],
      reports: [],
      notes: [],
      threads: []
    })
    void get().fetchItems()
    void get().fetchReports()
    void get().fetchNotes()
    void get().fetchThreads()
  },

  setActiveThreadId: (id: string | null) => {
    set({ activeThreadId: id })
  },

  setChatStreaming: (streaming: boolean) => {
    set({ chatStreaming: streaming })
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

  renameThread: async (threadId: string, title: string) => {
    const prev = get().threads
    set((s) => ({
      threads: s.threads.map((t) => (t.id === threadId ? { ...t, title } : t))
    }))
    try {
      await api.ai.renameThread(threadId, title)
    } catch (e) {
      set({ threads: prev })
      toast(errorMessage(e, 'Failed to rename thread'))
    }
  },

  fetchThreads: async () => {
    const id = get().activeWorkspaceId
    if (!id) {
      set({ threads: [], activeThreadId: null })
      return
    }
    try {
      const list = await api.ai.chatThreads(id)
      if (get().activeWorkspaceId !== id) return
      const latest = list.length > 0 ? list[0] : null
      set({ threads: list, activeThreadId: latest ? latest.id : null })
    } catch {
      if (get().activeWorkspaceId !== id) return
      set({ threads: [], activeThreadId: null })
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
      if (get().activeWorkspaceId !== id) return
      set({ items: list })
    } catch (e) {
      if (get().activeWorkspaceId !== id) return
      toast(errorMessage(e, 'Failed to load workspace items'))
    }
  },

  addDocs: async (docIds: string[], placement?: WorkspaceItemPlacement) => {
    const id = get().activeWorkspaceId
    if (!id || docIds.length === 0) return
    try {
      if (placement) await api.workspaceItems.add(id, 'document', docIds, placement)
      else await api.workspaceItems.add(id, 'document', docIds)
      await get().fetchItems()
    } catch (e) {
      toast(errorMessage(e, 'Failed to add documents to workspace'))
      throw e
    }
  },

  addItem: async (kind: WorkspaceItemKind, ids: string[], placement?: WorkspaceItemPlacement) => {
    const id = get().activeWorkspaceId
    if (!id || ids.length === 0) return
    try {
      if (placement) await api.workspaceItems.add(id, kind, ids, placement)
      else await api.workspaceItems.add(id, kind, ids)
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

  reorderItems: async (orderedIds: string[]) => {
    const workspaceId = get().activeWorkspaceId
    if (!workspaceId) return
    const previous = get().items
    const byId = new Map(previous.map((item) => [item.id, item]))
    const reordered = orderedIds
      .map((id, index) => {
        const item = byId.get(id)
        return item ? { ...item, sortOrder: index } : null
      })
      .filter((item): item is WorkspaceItem => item !== null)
    if (reordered.length !== previous.length) return
    set({ items: reordered })
    try {
      const saved = await api.workspaceItems.reorder(workspaceId, orderedIds)
      if (get().activeWorkspaceId === workspaceId) set({ items: saved })
    } catch (e) {
      if (get().activeWorkspaceId === workspaceId) set({ items: previous })
      toast(errorMessage(e, 'Failed to reorder workspace items'))
    }
  },

  resizeItem: async (itemId: string, width: number, height: number) => {
    const workspaceId = get().activeWorkspaceId
    if (!workspaceId) return false
    const previous = get().items
    set((s) => ({
      items: s.items.map((item) => item.id === itemId ? { ...item, width, height } : item)
    }))
    try {
      const saved = await api.workspaceItems.resize(itemId, width, height)
      if (get().activeWorkspaceId !== workspaceId) return true
      set((s) => ({
        items: s.items.map((item) => item.id === itemId ? saved : item)
      }))
      return true
    } catch (e) {
      if (get().activeWorkspaceId === workspaceId) set({ items: previous })
      toast(errorMessage(e, 'Failed to save card size'))
      return false
    }
  },

  moveItem: async (itemId: string, x: number, y: number, zIndex: number) => {
    const workspaceId = get().activeWorkspaceId
    if (!workspaceId) return false
    const previous = get().items
    set((s) => ({
      items: s.items.map((item) => item.id === itemId ? { ...item, x, y, zIndex } : item)
    }))
    try {
      const saved = await api.workspaceItems.move(itemId, x, y, zIndex)
      if (get().activeWorkspaceId !== workspaceId) return true
      set((s) => ({
        items: s.items.map((item) => item.id === itemId ? saved : item)
      }))
      return true
    } catch (e) {
      if (get().activeWorkspaceId === workspaceId) set({ items: previous })
      toast(errorMessage(e, 'Failed to save card position'))
      return false
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
      if (get().activeWorkspaceId !== id) return
      set({ reports: list })
    } catch (e) {
      if (get().activeWorkspaceId !== id) return
      toast(errorMessage(e, 'Failed to load reports'))
    }
  },

  deleteReport: async (id: string) => {
    const workspaceId = get().activeWorkspaceId
    const previousReports = get().reports
    const previousItems = get().items
    set((s) => ({
      reports: s.reports.filter((r) => r.id !== id),
      items: s.items.filter((item) => item.reportId !== id)
    }))
    try {
      await api.reports.delete(id)
    } catch (e) {
      if (get().activeWorkspaceId === workspaceId) {
        set({ reports: previousReports, items: previousItems })
      }
      toast(errorMessage(e, 'Failed to delete report'))
    }
  },

  updateReport: async (id: string, patch: { title?: string; contentMd?: string }) => {
    const workspaceId = get().activeWorkspaceId
    const prev = get().reports
    try {
      const updated = await api.reports.update(id, patch)
      if (get().activeWorkspaceId !== workspaceId) return true
      set((s) => ({ reports: s.reports.map((r) => (r.id === id ? updated : r)) }))
      return true
    } catch (e) {
      toast(errorMessage(e, 'Failed to update report'))
      set({ reports: prev })
      return false
    }
  },

  fetchNotes: async () => {
    const id = get().activeWorkspaceId
    if (!id) {
      set({ notes: [] })
      return
    }
    try {
      const list = await api.workspaceNotes.list(id)
      if (get().activeWorkspaceId !== id) return
      set({ notes: list })
    } catch (e) {
      if (get().activeWorkspaceId !== id) return
      toast(errorMessage(e, 'Failed to load workspace notes'))
    }
  },

  createNote: async (
    title: string,
    contentMd: string,
    noteType: WorkspaceNoteType,
    placement?: WorkspaceItemPlacement
  ) => {
    const workspaceId = get().activeWorkspaceId
    if (!workspaceId) return null
    try {
      const note = placement
        ? await api.workspaceNotes.create(workspaceId, title, contentMd, noteType, placement)
        : await api.workspaceNotes.create(workspaceId, title, contentMd, noteType)
      if (get().activeWorkspaceId !== workspaceId) return null
      set((s) => ({ notes: [...s.notes, note] }))
      await get().fetchItems()
      return note
    } catch (e) {
      toast(errorMessage(e, 'Failed to create workspace note'))
      return null
    }
  },

  deleteNote: async (id: string) => {
    const workspaceId = get().activeWorkspaceId
    const previousNotes = get().notes
    const previousItems = get().items
    set((s) => ({
      notes: s.notes.filter((note) => note.id !== id),
      items: s.items.filter((item) => item.noteId !== id)
    }))
    try {
      await api.workspaceNotes.delete(id)
    } catch (e) {
      if (get().activeWorkspaceId === workspaceId) {
        set({ notes: previousNotes, items: previousItems })
      }
      toast(errorMessage(e, 'Failed to delete workspace note'))
    }
  },

  updateNote: async (id: string, patch: { title?: string; contentMd?: string }) => {
    const workspaceId = get().activeWorkspaceId
    const previous = get().notes
    try {
      const updated = await api.workspaceNotes.update(id, patch)
      if (get().activeWorkspaceId !== workspaceId) return true
      set((s) => ({ notes: s.notes.map((note) => note.id === id ? updated : note) }))
      return true
    } catch (e) {
      set({ notes: previous })
      toast(errorMessage(e, 'Failed to update workspace note'))
      return false
    }
  }
}))
