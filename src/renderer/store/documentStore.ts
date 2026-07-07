import { create } from 'zustand'
import type {
  Document,
  DocumentPatch,
  ImportProgress,
  ListColumn,
  ListColumnState,
  ListFilter,
  SortField,
  Category
} from '../../shared/ipc-types'
import { api } from '../ipc'
import i18n from '../i18n'

const DEFAULT_COLUMNS: ListColumn[] = [
  { id: 'title', visible: true, width: 300, order: 0 },
  { id: 'authors', visible: true, width: 192, order: 1 },
  { id: 'year', visible: true, width: 64, order: 2 },
  { id: 'venue', visible: true, width: 128, order: 3 },
  { id: 'addedAt', visible: true, width: 96, order: 4 },
  { id: 'filePath', visible: true, width: 192, order: 5 }
]

function defaultColumnState(): ListColumnState {
  return { columns: DEFAULT_COLUMNS, sort: { field: 'addedAt', dir: 'desc' } }
}

let persistTimeout: ReturnType<typeof setTimeout> | null = null

function persistColumnState(state: ListColumnState): void {
  if (persistTimeout) clearTimeout(persistTimeout)
  persistTimeout = setTimeout(() => {
    api.settings.set('listColumnState', state).catch(() => {})
  }, 500)
}

interface DocumentState {
  documents: Document[]
  listMode: ListFilter
  listColumnState: ListColumnState
  selectedIds: string[]
  focusedDocId: string | null
  toastMessage: string | null
  confirmDelete: { ids: string[]; message: string } | null
  isImporting: boolean
  importProgress: { current: number; total: number } | null
  pendingMetadataCount: number
  isLoading: boolean
  initialized: boolean
  categories: Category[]
  isSearching: boolean
  searchQuery: string
  searchResults: Document[]
  fetchDocuments: (filter?: ListFilter) => Promise<void>
  setListMode: (filter: ListFilter) => void
  setListColumnState: (state: ListColumnState) => void
  setSort: (field: SortField) => void
  setColumns: (columns: ListColumn[]) => void
  setFocusedDoc: (docId: string | null) => void
  toggleSelect: (docId: string) => void
  selectAll: () => void
  clearSelection: () => void
  toggleStar: (docId: string) => Promise<void>
  openPdf: (docId: string) => Promise<void>
  openInFinder: (docId: string) => Promise<void>
  deleteDoc: (docId: string) => Promise<void>
  bulkDelete: (ids: string[]) => Promise<void>
  bulkRefreshMetadata: (ids: string[]) => Promise<void>
  bulkCategorize: (ids: string[], catId: string) => Promise<void>
  updateDocument: (id: string, patch: DocumentPatch) => Promise<Document>
  refreshMetadata: (docId: string) => Promise<boolean>
  showToast: (message: string) => void
  clearToast: () => void
  requestDeleteConfirm: (ids: string[], message: string) => void
  confirmDeleteAction: () => Promise<void>
  cancelDelete: () => void
  patchDocument: (id: string, doc: Document) => void
  refreshPendingMetadataCount: () => void
  startImport: (total: number) => void
  updateImportProgress: (payload: ImportProgress) => void
  endImport: () => void
  init: (listColumnState: ListColumnState | null) => void
  destroy: () => void
  fetchCategories: () => Promise<void>
  createCategory: (name: string) => Promise<Category | null>
  renameCategory: (id: string, name: string) => Promise<void>
  deleteCategory: (id: string) => Promise<void>
  performSearch: (q: string) => void
  clearSearch: () => void
}

const docUpdatedCb: Array<null | ((doc: Document) => void)> = [null]
const importProgressCb: Array<null | ((payload: ImportProgress) => void)> = [null]
const importToastCb: Array<null | ((message: string) => void)> = [null]
const menuExportBibtexCb: Array<null | (() => void)> = [null]

let toastTimeout: ReturnType<typeof setTimeout> | null = null
let searchTimeout: ReturnType<typeof setTimeout> | null = null
let pendingMetadataTimeout: ReturnType<typeof setTimeout> | null = null

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: [],
  listMode: { mode: 'all' },
  listColumnState: defaultColumnState(),
  selectedIds: [],
  focusedDocId: null,
  toastMessage: null,
  confirmDelete: null,
  isImporting: false,
  importProgress: null,
  pendingMetadataCount: 0,
  isLoading: false,
  initialized: false,
  categories: [],
  isSearching: false,
  searchQuery: '',
  searchResults: [],

  fetchDocuments: async (filter?: ListFilter) => {
    const f = filter ?? get().listMode
    const sort = get().listColumnState.sort
    set({ isLoading: true })
    try {
      const docs = await api.documents.list({ ...f, sort })
      set({ documents: docs })
    } finally {
      set({ isLoading: false })
    }
  },

  setListMode: (filter: ListFilter) => {
    set({ listMode: filter, selectedIds: [], focusedDocId: null })
    void get().fetchDocuments(filter)
  },

  setListColumnState: (state: ListColumnState) => {
    set({ listColumnState: state })
    persistColumnState(state)
  },

  setSort: (field: SortField) => {
    set((s) => {
      const cs = s.listColumnState
      const curSort = cs.sort
      if (curSort.field === field && curSort.dir === 'asc') {
        const newState = { ...cs, sort: { field, dir: 'desc' as const } }
        persistColumnState(newState)
        return { listColumnState: newState }
      }
      if (curSort.field === field && curSort.dir === 'desc') {
        const newState = { ...cs, sort: { field: 'addedAt' as SortField, dir: 'desc' as const } }
        persistColumnState(newState)
        return { listColumnState: newState }
      }
      const newState = { ...cs, sort: { field, dir: 'asc' as const } }
      persistColumnState(newState)
      return { listColumnState: newState }
    })
    void get().fetchDocuments()
  },

  setColumns: (columns: ListColumn[]) => {
    set((s) => {
      const newState = { ...s.listColumnState, columns }
      persistColumnState(newState)
      return { listColumnState: newState }
    })
  },

  setFocusedDoc: (docId: string | null) => {
    set({ focusedDocId: docId })
  },

  toggleSelect: (docId: string) => {
    set((s) => {
      const idx = s.selectedIds.indexOf(docId)
      if (idx === -1) {
        return { selectedIds: [...s.selectedIds, docId] }
      }
      return { selectedIds: s.selectedIds.filter((id) => id !== docId) }
    })
  },

  selectAll: () => {
    set((s) => ({ selectedIds: s.documents.map((d) => d.id) }))
  },

  clearSelection: () => {
    set({ selectedIds: [] })
  },

  toggleStar: async (docId: string) => {
    const doc = get().documents.find((d) => d.id === docId)
    if (!doc) return
    const newValue = !doc.starred
    get().patchDocument(docId, { ...doc, starred: newValue ? 1 : 0 })
    try {
      await api.documents.setStarred(docId, newValue)
    } catch {
      get().patchDocument(docId, doc)
      get().showToast('Failed to update star')
    }
  },

  openPdf: async (docId: string) => {
    const doc = get().documents.find((d) => d.id === docId)
    if (!doc || doc.fileMissing) return
    try {
      const updated = await api.documents.openPdf(docId)
      get().patchDocument(docId, updated)
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Failed to open PDF'
      get().showToast(msg)
    }
  },

  openInFinder: async (docId: string) => {
    try {
      await api.documents.openInFinder(docId)
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Failed to open in Finder'
      get().showToast(msg)
    }
  },

  deleteDoc: async (docId: string) => {
    const doc = get().documents.find((d) => d.id === docId)
    if (!doc) return
    set((s) => ({
      documents: s.documents.filter((d) => d.id !== docId),
      selectedIds: s.selectedIds.filter((id) => id !== docId),
      focusedDocId: s.focusedDocId === docId ? null : s.focusedDocId
    }))
    try {
      await api.documents.delete(docId)
      get().showToast(i18n.t('common.movedToTrash', { count: 1 }))
      void get().fetchCategories()
    } catch {
      if (doc) {
        set((s) => ({ documents: [...s.documents, doc] }))
      }
      get().showToast(i18n.t('common.deleteFailed'))
    }
  },

  refreshMetadata: async (docId: string) => {
    try {
      const updated = await api.documents.refreshMetadata(docId)
      get().patchDocument(docId, updated)
      return true
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Failed to refresh metadata'
      get().showToast(msg)
      return false
    }
  },

  bulkDelete: async (ids: string[]) => {
    const prev = get().documents.filter((d) => ids.includes(d.id))
    set((s) => ({
      documents: s.documents.filter((d) => !ids.includes(d.id)),
      selectedIds: [],
      focusedDocId: ids.includes(s.focusedDocId ?? '') ? null : s.focusedDocId
    }))
    try {
      await api.documents.bulkDelete(ids)
      get().showToast(i18n.t('common.movedToTrash', { count: ids.length }))
      void get().fetchCategories()
    } catch {
      set((s) => {
        const current = new Set(s.documents.map((d) => d.id))
        const restored = prev.filter((d) => !current.has(d.id))
        return { documents: [...s.documents, ...restored] }
      })
      get().showToast(i18n.t('common.deleteFailed'))
    }
  },

  bulkRefreshMetadata: async (ids: string[]) => {
    set((s) => ({
      documents: s.documents.map((d) =>
        ids.includes(d.id) ? { ...d, metadataStatus: 'pending' } : d
      )
    }))
    try {
      await api.documents.bulkRefreshMetadata(ids)
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Failed to refresh metadata'
      get().showToast(msg)
    }
  },

  bulkCategorize: async (ids: string[], catId: string) => {
    try {
      await api.documents.bulkCategorize(ids, catId)
      get().clearSelection()
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Failed to categorize'
      get().showToast(msg)
    }
  },

  updateDocument: async (id: string, patch: DocumentPatch): Promise<Document> => {
    const updated = await api.documents.update(id, patch)
    get().patchDocument(id, updated)
    return updated
  },

  showToast: (message: string) => {
    if (toastTimeout) clearTimeout(toastTimeout)
    set({ toastMessage: message })
    toastTimeout = setTimeout(() => set({ toastMessage: null }), 4000)
  },

  clearToast: () => {
    if (toastTimeout) clearTimeout(toastTimeout)
    set({ toastMessage: null })
  },

  requestDeleteConfirm: (ids: string[], message: string) => {
    set({ confirmDelete: { ids, message } })
  },

  confirmDeleteAction: async () => {
    const cd = get().confirmDelete
    if (!cd) return
    set({ confirmDelete: null })
    if (cd.ids.length === 1) {
      await get().deleteDoc(cd.ids[0])
    } else {
      await get().bulkDelete(cd.ids)
    }
  },

  cancelDelete: () => {
    set({ confirmDelete: null })
  },

  patchDocument: (id: string, doc: Document) => {
    set((state) => ({
      documents: state.documents.map((d) => (d.id === id ? doc : d)),
      searchResults: state.isSearching
        ? state.searchResults.map((d) => (d.id === id ? doc : d))
        : state.searchResults
    }))
  },

  refreshPendingMetadataCount: () => {
    if (pendingMetadataTimeout) clearTimeout(pendingMetadataTimeout)
    pendingMetadataTimeout = setTimeout(async () => {
      try {
        const count = await api.documents.countPendingMetadata()
        set({ pendingMetadataCount: count })
      } catch {
        void 0
      }
    }, 300)
  },

  startImport: (total: number) => {
    set({ isImporting: true, importProgress: { current: 0, total } })
  },

  updateImportProgress: (payload: ImportProgress) => {
    if (payload.current >= payload.total) {
      if (!get().isImporting) return
      set({ importProgress: { current: payload.current, total: payload.total } })
      set({ isImporting: false, importProgress: null })
      void get().fetchDocuments()
      get().refreshPendingMetadataCount()
      return
    }
    set({ importProgress: { current: payload.current, total: payload.total } })
  },

  endImport: () => {
    set({ isImporting: false, importProgress: null })
    void get().fetchDocuments()
    get().refreshPendingMetadataCount()
  },

  init: (listColumnState: ListColumnState | null) => {
    if (get().initialized) return
    set({
      initialized: true,
      listColumnState: listColumnState ?? defaultColumnState()
    })

    docUpdatedCb[0] = (doc: Document) => {
      set((state) => {
        const inResults = state.searchResults.some((d) => d.id === doc.id)
        if (state.isSearching && !inResults) return {}
        return {
          documents: state.documents.map((d) => (d.id === doc.id ? doc : d)),
          searchResults: state.isSearching
            ? state.searchResults.map((d) => (d.id === doc.id ? doc : d))
            : state.searchResults
        }
      })
      get().refreshPendingMetadataCount()
    }
    api.events.onDocumentUpdated(docUpdatedCb[0])

    importProgressCb[0] = (payload: ImportProgress) => {
      if (!get().isImporting) {
        get().startImport(payload.total)
      }
      get().updateImportProgress(payload)
    }
    api.events.onImportProgress(importProgressCb[0])

    importToastCb[0] = (message: string) => {
      get().showToast(message)
    }
    api.events.onImportToast(importToastCb[0])

    menuExportBibtexCb[0] = () => {
      const ids = get().selectedIds
      if (ids.length === 0) return
      void api.export.toBibtex(ids)
    }
    api.events.onMenuExportBibtex(menuExportBibtexCb[0])

    void get().fetchDocuments()
    get().refreshPendingMetadataCount()
  },

  fetchCategories: async () => {
    try {
      const cats = await api.categories.list()
      set({ categories: cats })
    } catch {
      void 0
    }
  },

  createCategory: async (name: string): Promise<Category | null> => {
    try {
      const cat = await api.categories.create(name)
      set((s) => ({ categories: [...s.categories, { ...cat, count: 0 }] }))
      return cat
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Failed to create category'
      get().showToast(msg)
      return null
    }
  },

  renameCategory: async (id: string, name: string) => {
    try {
      await api.categories.rename(id, name)
      set((s) => ({
        categories: s.categories.map((c) => (c.id === id ? { ...c, name } : c))
      }))
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Failed to rename category'
      get().showToast(msg)
    }
  },

  deleteCategory: async (id: string) => {
    try {
      await api.categories.delete(id)
      set((s) => ({
        categories: s.categories.filter((c) => c.id !== id)
      }))
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Failed to delete category'
      get().showToast(msg)
    }
  },

  performSearch: (q: string) => {
    const trimmed = q.trim()
    if (searchTimeout) clearTimeout(searchTimeout)
    if (!trimmed) {
      get().clearSearch()
      return
    }
    set({ searchQuery: q, isSearching: true })
    searchTimeout = setTimeout(async () => {
      try {
        const results = await api.documents.search(trimmed)
        set({ searchResults: results })
      } catch {
        set({ searchResults: [] })
      }
    }, 200)
  },

  clearSearch: () => {
    if (searchTimeout) clearTimeout(searchTimeout)
    set({ isSearching: false, searchQuery: '', searchResults: [] })
    void get().fetchDocuments()
  },

  destroy: () => {
    if (docUpdatedCb[0]) {
      api.events.off('document:updated', docUpdatedCb[0])
      docUpdatedCb[0] = null
    }
    if (importProgressCb[0]) {
      api.events.off('import:progress', importProgressCb[0])
      importProgressCb[0] = null
    }
    if (importToastCb[0]) {
      api.events.off('import:toast', importToastCb[0])
      importToastCb[0] = null
    }
    if (menuExportBibtexCb[0]) {
      api.events.off('menu:export-bibtex', menuExportBibtexCb[0])
      menuExportBibtexCb[0] = null
    }
    if (toastTimeout) clearTimeout(toastTimeout)
    if (pendingMetadataTimeout) clearTimeout(pendingMetadataTimeout)
    set({ initialized: false })
  }
}))
