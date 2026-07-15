import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import DetailPanel from '../../src/renderer/components/DetailPanel'
import type { Document, Category } from '../../src/shared/ipc-types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() }
  })
}))

const mockCat: Category = { id: 'c1', name: 'ML', sortOrder: 0, createdAt: 0 }

const mockDoc: Document = {
  id: '1',
  filePath: '/pdfs/test.pdf',
  originalFolderPath: '/pdfs',
  fileName: 'test.pdf',
  fileSize: 1024,
  fileHash: 'abc',
  title: 'Test Paper',
  authors: 'Smith, J.',
  year: '2024',
  venue: 'Nature',
  volume: '10',
  issue: '3',
  pages: '100--120',
  abstract: 'An important study.',
  keywords: 'ML, AI',
  url: 'https://example.com',
  doi: '10.1234/test',
  note: 'Good read',
  affiliations: 'MIT; Stanford University',
  starred: 1,
  addedAt: 1700000000000,
  lastReadAt: null,
  updatedAt: 1700000000000,
  metadataSource: null,
  metadataStatus: 'success',
  metadataAttempts: 0,
  editedFields: [],
  remoteValues: {},
  fileMissing: 0,
  categories: [mockCat]
}

const mockStoreState = vi.hoisted(() => ({
  focusedDocId: null as string | null,
  documents: [] as Document[],
  selectedIds: [] as string[],
  categories: [] as Category[],
  updateDocument: vi.fn().mockResolvedValue(undefined),
  fetchCategories: vi.fn().mockResolvedValue(undefined),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  openInFinder: vi.fn().mockResolvedValue(undefined),
  refreshMetadata: vi.fn().mockResolvedValue(undefined),
  requestDeleteConfirm: vi.fn(),
  showToast: vi.fn(),
  patchDocument: vi.fn(),
  toastMessage: null as string | null
}))

vi.mock('../../src/renderer/store/documentStore', () => ({
  useDocumentStore: Object.assign(
    (selector?: (s: typeof mockStoreState) => unknown) => {
      if (typeof selector === 'function') {
        return selector(mockStoreState)
      }
      return mockStoreState
    },
    { getState: () => mockStoreState }
  )
}))

function resetStore(): void {
  mockStoreState.focusedDocId = null
  mockStoreState.documents = []
  mockStoreState.selectedIds = []
  mockStoreState.categories = []
  mockStoreState.toastMessage = null
  mockStoreState.updateDocument.mockReset().mockResolvedValue(undefined)
  mockStoreState.fetchCategories.mockReset().mockResolvedValue(undefined)
  mockStoreState.requestDeleteConfirm.mockReset()
  mockStoreState.showToast.mockReset()
  mockStoreState.patchDocument.mockReset()
  mockStoreState.openInFinder.mockReset()
  mockStoreState.refreshMetadata.mockReset()
}

let mockUpdateDoc: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockUpdateDoc = vi.fn().mockResolvedValue(mockDoc)
  const winApi = (window as Record<string, unknown>).api as Record<string, unknown>
  if (winApi) {
    const docs = winApi.documents as Record<string, unknown>
    docs.update = mockUpdateDoc
    docs.relocateFile = vi.fn().mockResolvedValue(mockDoc)
    docs.restoreFile = vi.fn().mockResolvedValue(mockDoc)
    const cats = winApi.categories as Record<string, unknown>
    cats.assign = vi.fn().mockResolvedValue(undefined)
    cats.unassign = vi.fn().mockResolvedValue(undefined)
  }
  resetStore()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DetailPanel', () => {
  describe('no selection — empty state', () => {
    it('shows placeholder when focusedDocId is null', () => {
      mockStoreState.focusedDocId = null
      render(<DetailPanel />)
      expect(screen.getByText('common.selectDocHint')).toBeInTheDocument()
    })

    it('renders no InlineFields when no doc selected', () => {
      mockStoreState.focusedDocId = null
      render(<DetailPanel />)
      expect(screen.queryByText('detail.title')).not.toBeInTheDocument()
      expect(screen.queryByText('detail.authors')).not.toBeInTheDocument()
    })
  })

  describe('selected doc — fields rendered', () => {
    beforeEach(() => {
      mockStoreState.focusedDocId = '1'
      mockStoreState.documents = [mockDoc]
      mockStoreState.categories = [{ ...mockCat, count: 5 }]
    })

    it('renders all document fields', () => {
      render(<DetailPanel />)
      expect(screen.getByRole('button', { name: 'Test Paper' })).toBeInTheDocument()
      expect(screen.getByText('Smith, J.')).toBeInTheDocument()
      expect(screen.getByText('2024')).toBeInTheDocument()
      expect(screen.getByText('Nature')).toBeInTheDocument()
      expect(screen.getByText('10')).toBeInTheDocument()
      expect(screen.getByText('An important study.')).toBeInTheDocument()
      expect(screen.getByText('ML, AI')).toBeInTheDocument()
      expect(screen.getByText('https://example.com')).toBeInTheDocument()
      expect(screen.getByText('10.1234/test')).toBeInTheDocument()
      expect(screen.getByText('Good read')).toBeInTheDocument()
    })

    it('renders category chips', () => {
      render(<DetailPanel />)
      expect(screen.getByText('ML')).toBeInTheDocument()
    })

    it('renders semicolon-separated authors as individual chips', () => {
      mockStoreState.documents = [{
        ...mockDoc,
        authors: 'Pu, Yewen; Narasimhan, Karthik; Solar-Lezama, Armando'
      }]

      render(<DetailPanel />)

      expect(screen.getByText('Pu, Yewen')).toBeInTheDocument()
      expect(screen.getByText('Narasimhan, Karthik')).toBeInTheDocument()
      expect(screen.getByText('Solar-Lezama, Armando')).toBeInTheDocument()
    })

    it('places the close action in the document header', () => {
      const onClose = vi.fn()
      render(<DetailPanel onClose={onClose} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.close' }))

      expect(onClose).toHaveBeenCalledTimes(1)
      expect(screen.getAllByText('Test Paper')).toHaveLength(1)
    })

    it('does not clamp long abstracts', () => {
      const longAbstract = 'Long abstract '.repeat(80).trim()
      mockStoreState.documents = [{ ...mockDoc, abstract: longAbstract }]

      render(<DetailPanel />)

      expect(screen.getByRole('button', { name: longAbstract })).not.toHaveClass('line-clamp-[7]')
    })
  })

  describe('inline edit — blur saves', () => {
    beforeEach(() => {
      mockStoreState.focusedDocId = '1'
      mockStoreState.documents = [mockDoc]
      mockStoreState.categories = [{ ...mockCat, count: 5 }]
    })

    it('enters edit mode on click and saves on blur', async () => {
      mockUpdateDoc.mockResolvedValue({ ...mockDoc, title: 'New Title' })
      render(<DetailPanel />)

      const titleDisplay = screen.getByRole('button', { name: 'Test Paper' })
      await act(async () => {
        fireEvent.click(titleDisplay)
      })

      const input = screen.getByDisplayValue('Test Paper') as HTMLTextAreaElement
      expect(input.tagName).toBe('TEXTAREA')

      await act(async () => {
        fireEvent.change(input, { target: { value: 'New Title' } })
      })

      await act(async () => {
        fireEvent.blur(input)
      })

      expect(mockUpdateDoc).toHaveBeenCalledWith('1', { title: 'New Title' })
    })

    it('shows saved indicator after save', async () => {
      mockUpdateDoc.mockResolvedValue({ ...mockDoc, title: 'New Title' })
      render(<DetailPanel />)

      const titleDisplay = screen.getByRole('button', { name: 'Test Paper' })
      fireEvent.click(titleDisplay)

      const input = screen.getByDisplayValue('Test Paper') as HTMLTextAreaElement
      fireEvent.change(input, { target: { value: 'New Title' } })
      fireEvent.blur(input)

      await waitFor(() => {
        expect(screen.getByText('common.saved')).toBeInTheDocument()
      })
    })
  })

  describe('inline edit — Escape cancels', () => {
    beforeEach(() => {
      mockStoreState.focusedDocId = '1'
      mockStoreState.documents = [mockDoc]
      mockStoreState.categories = [{ ...mockCat, count: 5 }]
    })

    it('restores original value on Escape and does not call API', async () => {
      render(<DetailPanel />)

      const titleDisplay = screen.getByRole('button', { name: 'Test Paper' })
      await act(async () => {
        fireEvent.click(titleDisplay)
      })

      const input = screen.getByDisplayValue('Test Paper') as HTMLTextAreaElement
      await act(async () => {
        fireEvent.change(input, { target: { value: 'Changed Value' } })
        fireEvent.keyDown(input, { key: 'Escape' })
      })

      expect(screen.getByRole('button', { name: 'Test Paper' })).toBeInTheDocument()
      expect(screen.queryByDisplayValue('Changed Value')).not.toBeInTheDocument()
      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })
  })

  describe('inline edit — Enter saves', () => {
    beforeEach(() => {
      mockStoreState.focusedDocId = '1'
      mockStoreState.documents = [mockDoc]
      mockStoreState.categories = [{ ...mockCat, count: 5 }]
    })

    it('saves via API on Enter key', async () => {
      mockUpdateDoc.mockResolvedValue({ ...mockDoc, title: 'Enter Saved' })
      render(<DetailPanel />)

      const titleDisplay = screen.getByRole('button', { name: 'Test Paper' })
      await act(async () => {
        fireEvent.click(titleDisplay)
      })

      const input = screen.getByDisplayValue('Test Paper') as HTMLTextAreaElement
      await act(async () => {
        fireEvent.change(input, { target: { value: 'Enter Saved' } })
        fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
      })

      expect(mockUpdateDoc).toHaveBeenCalledWith('1', { title: 'Enter Saved' })
    })
  })

  describe('NoteField autosave', () => {
    beforeEach(() => {
      mockStoreState.focusedDocId = '1'
      mockStoreState.documents = [mockDoc]
      mockStoreState.categories = [{ ...mockCat, count: 5 }]
    })

    it('saves on blur after typing', async () => {
      mockUpdateDoc.mockResolvedValue({ ...mockDoc, note: 'Updated note' })
      render(<DetailPanel />)

      const textarea = screen.getByDisplayValue('Good read') as HTMLTextAreaElement

      await act(async () => {
        fireEvent.change(textarea, { target: { value: 'Updated note' } })
        fireEvent.blur(textarea)
      })

      expect(mockUpdateDoc).toHaveBeenCalledWith('1', { note: 'Updated note' })
    })

    it('debounces by clearing pending timeout on blur', async () => {
      vi.useFakeTimers()
      mockUpdateDoc.mockResolvedValue({ ...mockDoc, note: 'Saved' })
      render(<DetailPanel />)

      const textarea = screen.getByDisplayValue('Good read') as HTMLTextAreaElement

      await act(async () => {
        fireEvent.change(textarea, { target: { value: 'Saved' } })
      })

      await act(async () => {
        fireEvent.blur(textarea)
      })

      expect(mockUpdateDoc).toHaveBeenCalledTimes(1)
      expect(mockUpdateDoc).toHaveBeenCalledWith('1', { note: 'Saved' })

      vi.useRealTimers()
    })
  })

  describe('empty fields shown as placeholder', () => {
    it('displays em-dash for null abstract and allows click to edit', async () => {
      const docWithNull = { ...mockDoc, abstract: null }
      mockStoreState.focusedDocId = '1'
      mockStoreState.documents = [docWithNull]
      mockStoreState.categories = [{ ...mockCat, count: 5 }]

      render(<DetailPanel />)

      const placeholder = screen.getByText('\u2014')
      expect(placeholder).toBeInTheDocument()

      await act(async () => {
        fireEvent.click(placeholder)
      })

      const input = screen.getByDisplayValue('') as HTMLTextAreaElement
      expect(input).toBeInTheDocument()
    })
  })
})

export {}
