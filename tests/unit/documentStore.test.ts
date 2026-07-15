import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useDocumentStore } from '../../src/renderer/store/documentStore'
import type { Document } from '../../src/shared/ipc-types'

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    filePath: '/tmp/test.pdf',
    originalFolderPath: '/tmp',
    fileName: 'test.pdf',
    fileSize: 1024,
    fileHash: 'abc',
    title: 'Test Title',
    authors: 'Author',
    affiliations: null,
    year: '2024',
    venue: 'Test Venue',
    volume: null,
    issue: null,
    pages: null,
    abstract: null,
    keywords: null,
    url: null,
    doi: null,
    note: null,
    starred: 0,
    addedAt: 1700000000000,
    lastReadAt: null,
    updatedAt: 1700000000000,
    metadataSource: null,
    metadataStatus: 'pending',
    metadataAttempts: 0,
    editedFields: [],
    remoteValues: null,
    fileMissing: 0,
    ...overrides
  }
}

const mockList = vi.fn()
const mockSearch = vi.fn()
const mockSetStarred = vi.fn()
const mockOnDocUpdated = vi.fn()
const mockOnImportProgress = vi.fn()
const mockOnImportToast = vi.fn()
const mockOnMenuExportBibtex = vi.fn()
const mockOnLibrarySwitched = vi.fn()
const mockFetchCategories = vi.fn()
const mockEventsOff = vi.fn()

function resetStoreState(): void {
  useDocumentStore.setState({
    documents: [],
    selectedIds: [],
    focusedDocId: null,
    initialized: false,
    isSearching: false,
    searchQuery: '',
    searchResults: [],
    isLoading: false,
    listMode: { mode: 'all' },
    isImporting: false,
    importProgress: null
  })
}

beforeEach(() => {
  mockList.mockReset()
  mockSearch.mockReset()
  mockSetStarred.mockReset()
  mockOnDocUpdated.mockReset()
  mockOnImportProgress.mockReset()
  mockOnImportToast.mockReset()
  mockOnMenuExportBibtex.mockReset()
  mockOnLibrarySwitched.mockReset()
  mockFetchCategories.mockReset()
  mockEventsOff.mockReset()

  mockList.mockResolvedValue([])
  mockSearch.mockResolvedValue([])
  mockSetStarred.mockResolvedValue(undefined)
  mockFetchCategories.mockResolvedValue(undefined)

  const api = window.api as unknown as Record<string, unknown>
  const docs = api.documents as Record<string, unknown>
  docs.list = mockList
  docs.search = mockSearch
  docs.setStarred = mockSetStarred

  const events = api.events as Record<string, unknown>
  events.onDocumentUpdated = mockOnDocUpdated
  events.onImportProgress = mockOnImportProgress
  events.onImportToast = mockOnImportToast
  events.onMenuExportBibtex = mockOnMenuExportBibtex
  events.onLibrarySwitched = mockOnLibrarySwitched
  events.off = mockEventsOff

  resetStoreState()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllTimers()
})

describe('DocumentStore', () => {
  describe('fetchDocuments', () => {
    it('sets isLoading true during the call and false after', async () => {
      const docs = [makeDoc()]
      mockList.mockResolvedValue(docs)

      const promise = useDocumentStore.getState().fetchDocuments()
      expect(useDocumentStore.getState().isLoading).toBe(true)

      await promise
      expect(useDocumentStore.getState().isLoading).toBe(false)
    })

    it('populates documents and passes filter + sort to api', async () => {
      const docs = [makeDoc(), makeDoc({ id: 'doc-2', title: 'Second' })]
      mockList.mockResolvedValue(docs)

      await useDocumentStore.getState().fetchDocuments()

      expect(useDocumentStore.getState().documents).toEqual(docs)
      expect(mockList).toHaveBeenCalledWith({
        mode: 'all',
        sort: { field: 'addedAt', dir: 'desc' }
      })
    })

    it('sets isLoading to false on error and keeps documents unchanged', async () => {
      useDocumentStore.setState({ documents: [makeDoc()] })
      mockList.mockRejectedValue({ code: 'ERR', message: 'fail' })

      await expect(useDocumentStore.getState().fetchDocuments()).rejects.toEqual({
        code: 'ERR',
        message: 'fail'
      })

      expect(useDocumentStore.getState().isLoading).toBe(false)
      expect(useDocumentStore.getState().documents).toHaveLength(1)
    })
  })

  describe('performSearch', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('calls api.documents.search with trimmed query after debounce', async () => {
      const results = [makeDoc({ title: 'Found' })]
      mockSearch.mockResolvedValue(results)

      useDocumentStore.getState().performSearch('  hello  ')

      expect(useDocumentStore.getState().isSearching).toBe(true)
      expect(useDocumentStore.getState().searchQuery).toBe('  hello  ')

      await vi.advanceTimersByTimeAsync(200)

      expect(mockSearch).toHaveBeenCalledTimes(1)
      expect(mockSearch).toHaveBeenCalledWith('hello')
      expect(useDocumentStore.getState().searchResults).toEqual(results)
    })

    it('debounces multiple rapid calls and only dispatches the last query', async () => {
      useDocumentStore.getState().performSearch('a')
      useDocumentStore.getState().performSearch('ab')
      useDocumentStore.getState().performSearch('abc')

      await vi.advanceTimersByTimeAsync(200)

      expect(mockSearch).toHaveBeenCalledTimes(1)
      expect(mockSearch).toHaveBeenCalledWith('abc')
    })

    it('clears search and falls back to list mode on empty query', () => {
      mockList.mockResolvedValue([makeDoc()])

      useDocumentStore.getState().performSearch('')

      expect(useDocumentStore.getState().isSearching).toBe(false)
      expect(useDocumentStore.getState().searchQuery).toBe('')
      expect(useDocumentStore.getState().searchResults).toEqual([])
      expect(mockList).toHaveBeenCalled()
    })

    it('sets searchResults to empty array on api error', async () => {
      mockSearch.mockRejectedValue(new Error('search failed'))

      useDocumentStore.getState().performSearch('error')
      await vi.advanceTimersByTimeAsync(200)

      expect(useDocumentStore.getState().searchResults).toEqual([])
    })
  })

  describe('init', () => {
    it('subscribes to all event channels and sets initialized', () => {
      useDocumentStore.getState().init()

      expect(mockOnDocUpdated).toHaveBeenCalledWith(expect.any(Function))
      expect(mockOnImportProgress).toHaveBeenCalledWith(expect.any(Function))
      expect(mockOnImportToast).toHaveBeenCalledWith(expect.any(Function))
      expect(mockOnMenuExportBibtex).toHaveBeenCalledWith(expect.any(Function))
      expect(useDocumentStore.getState().initialized).toBe(true)
    })

    it('calls fetchDocuments on init', () => {
      useDocumentStore.getState().init()
      expect(mockList).toHaveBeenCalled()
    })

    it('does not re-subscribe if already initialized', () => {
      useDocumentStore.getState().init()
      const listCalls = mockList.mock.calls.length

      useDocumentStore.getState().init()

      expect(mockList).toHaveBeenCalledTimes(listCalls)
    })
  })

  describe('destroy', () => {
    it('unsubscribes all event channels and sets initialized to false', () => {
      useDocumentStore.getState().init()
      useDocumentStore.getState().destroy()

      expect(mockEventsOff).toHaveBeenCalledWith('document:updated', expect.any(Function))
      expect(mockEventsOff).toHaveBeenCalledWith('import:progress', expect.any(Function))
      expect(mockEventsOff).toHaveBeenCalledWith('import:toast', expect.any(Function))
      expect(mockEventsOff).toHaveBeenCalledWith('menu:export-bibtex', expect.any(Function))
      expect(mockEventsOff).toHaveBeenCalledWith('menu:import-zotero', expect.any(Function))
      expect(mockEventsOff).toHaveBeenCalledWith('menu:import-mendeley', expect.any(Function))
      expect(mockEventsOff).toHaveBeenCalledWith('library:switched', expect.any(Function))
      expect(mockEventsOff).toHaveBeenCalledTimes(7)
      expect(useDocumentStore.getState().initialized).toBe(false)
    })

    it('library:switched event refetches documents and clears selection', async () => {
      const fetchedDocs = [makeDoc({ id: 'a1' }), makeDoc({ id: 'a2' })]
      mockList.mockResolvedValue(fetchedDocs)
      useDocumentStore.setState({
        selectedIds: ['old'],
        focusedDocId: 'old',
        documents: [makeDoc({ id: 'old' })]
      })

      useDocumentStore.getState().init()
      const cb = mockOnLibrarySwitched.mock.calls[0]?.[0] as (() => void) | undefined
      expect(cb).toBeDefined()
      cb!()

      expect(useDocumentStore.getState().selectedIds).toEqual([])
      expect(useDocumentStore.getState().focusedDocId).toBeNull()
      await Promise.resolve()
      await Promise.resolve()
      expect(mockList).toHaveBeenCalled()
    })
  })

  describe('startImport / updateImportProgress', () => {
    it('startImport sets isImporting and importProgress', () => {
      useDocumentStore.getState().startImport(5)
      expect(useDocumentStore.getState().isImporting).toBe(true)
      expect(useDocumentStore.getState().importProgress).toEqual({ current: 0, total: 5 })
    })

    it('updateImportProgress updates current without completing when current < total', () => {
      useDocumentStore.getState().startImport(3)
      mockList.mockClear()

      useDocumentStore.getState().updateImportProgress({ current: 1, total: 3 })

      expect(useDocumentStore.getState().importProgress).toEqual({ current: 1, total: 3 })
      expect(useDocumentStore.getState().isImporting).toBe(true)
      expect(mockList).not.toHaveBeenCalled()
    })

    it('clears import state and fetches documents when current reaches total', async () => {
      useDocumentStore.getState().startImport(2)
      mockList.mockClear()
      mockList.mockResolvedValue([makeDoc({ id: 'imported-1' })])

      useDocumentStore.getState().updateImportProgress({ current: 2, total: 2 })

      expect(useDocumentStore.getState().isImporting).toBe(false)
      expect(useDocumentStore.getState().importProgress).toBeNull()
      expect(mockList).toHaveBeenCalledTimes(1)
    })

    it('does not re-trigger fetchDocuments on a second completion event', async () => {
      useDocumentStore.getState().startImport(2)
      mockList.mockClear()
      mockList.mockResolvedValue([])

      useDocumentStore.getState().updateImportProgress({ current: 2, total: 2 })
      await new Promise((r) => setTimeout(r, 0))
      const callsAfterFirst = mockList.mock.calls.length

      useDocumentStore.getState().updateImportProgress({ current: 0, total: 0 })

      await new Promise((r) => setTimeout(r, 0))
      expect(mockList.mock.calls.length).toBe(callsAfterFirst)
    })

    it('fetches documents on completion even when nothing was imported (total=0)', async () => {
      useDocumentStore.getState().startImport(0)
      mockList.mockClear()
      mockList.mockResolvedValue([])

      useDocumentStore.getState().updateImportProgress({ current: 0, total: 0 })

      expect(useDocumentStore.getState().isImporting).toBe(false)
      expect(mockList).toHaveBeenCalledTimes(1)
    })
  })

  describe('setFocusedDoc', () => {
    it('updates focusedDocId', () => {
      useDocumentStore.getState().setFocusedDoc('doc-1')
      expect(useDocumentStore.getState().focusedDocId).toBe('doc-1')
    })

    it('clears focusedDocId when passed null', () => {
      useDocumentStore.getState().setFocusedDoc('doc-1')
      useDocumentStore.getState().setFocusedDoc(null)
      expect(useDocumentStore.getState().focusedDocId).toBeNull()
    })
  })

  describe('toggleSelect', () => {
    it('adds docId to selectedIds array', () => {
      useDocumentStore.getState().toggleSelect('doc-1')
      expect(useDocumentStore.getState().selectedIds).toEqual(['doc-1'])
    })

    it('removes docId from selectedIds on second call', () => {
      useDocumentStore.getState().toggleSelect('doc-1')
      useDocumentStore.getState().toggleSelect('doc-1')
      expect(useDocumentStore.getState().selectedIds).toEqual([])
    })

    it('supports selecting multiple documents', () => {
      useDocumentStore.getState().toggleSelect('doc-1')
      useDocumentStore.getState().toggleSelect('doc-2')
      expect(useDocumentStore.getState().selectedIds).toEqual(['doc-1', 'doc-2'])
    })
  })

  describe('toggleStar', () => {
    it('optimistically updates starred field and calls api', async () => {
      useDocumentStore.setState({ documents: [makeDoc({ starred: 0 })] })

      const promise = useDocumentStore.getState().toggleStar('doc-1')

      expect(useDocumentStore.getState().documents[0].starred).toBe(1)

      await promise

      expect(mockSetStarred).toHaveBeenCalledWith('doc-1', true)
      expect(useDocumentStore.getState().documents[0].starred).toBe(1)
    })

    it('reverts starred field on api failure and shows toast', async () => {
      useDocumentStore.setState({ documents: [makeDoc({ starred: 0 })] })
      mockSetStarred.mockRejectedValue(new Error('fail'))

      await useDocumentStore.getState().toggleStar('doc-1')

      expect(useDocumentStore.getState().documents[0].starred).toBe(0)
      expect(useDocumentStore.getState().toastMessage).toBe('Failed to update star')
    })

    it('does nothing if docId is not in documents', async () => {
      await useDocumentStore.getState().toggleStar('nonexistent')

      expect(mockSetStarred).not.toHaveBeenCalled()
    })
  })
})
