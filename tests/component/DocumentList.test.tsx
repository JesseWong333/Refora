import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DocumentList from '@renderer/components/DocumentList'
import type { Document } from '@shared/ipc-types'

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    filePath: '/pdfs/doc1.pdf',
    originalFolderPath: '/pdfs',
    fileName: 'doc1.pdf',
    fileSize: 1024,
    fileHash: 'abc',
    title: 'Test Title',
    authors: 'Author A',
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
    metadataStatus: 'success',
    metadataAttempts: 0,
    editedFields: [],
    remoteValues: null,
    fileMissing: 0,
    ...overrides
  }
}

const defaultColumns = [
  { id: 'title' as const, visible: true, width: 256, order: 0 },
  { id: 'authors' as const, visible: true, width: 192, order: 1 },
  { id: 'year' as const, visible: true, width: 64, order: 2 },
  { id: 'venue' as const, visible: true, width: 128, order: 3 },
  { id: 'addedAt' as const, visible: true, width: 96, order: 4 },
  { id: 'filePath' as const, visible: true, width: 192, order: 5 }
]

let mockState: {
  documents: Document[]
  isLoading: boolean
  isSearching: boolean
  searchResults: Document[]
  setSort: ReturnType<typeof vi.fn>
  setColumns: ReturnType<typeof vi.fn>
  toggleSelect: ReturnType<typeof vi.fn>
  setFocusedDoc: ReturnType<typeof vi.fn>
  toggleStar: ReturnType<typeof vi.fn>
  categories: { id: string; name: string; count: number }[]
  createCategory: ReturnType<typeof vi.fn>
}

vi.mock('@renderer/store/documentStore', () => ({
  useDocumentStore: Object.assign(
    (selector?: (state: Record<string, unknown>) => unknown) => {
      if (selector) return selector({
        documents: mockState.documents,
        isLoading: mockState.isLoading,
        listColumnState: {
          columns: defaultColumns,
          sort: { field: 'addedAt' as const, dir: 'desc' as const }
        },
        listMode: { mode: 'all' },
        selectedIds: [],
        focusedDocId: null,
        isSearching: mockState.isSearching,
        searchResults: mockState.searchResults,
        setSort: mockState.setSort,
        setColumns: mockState.setColumns,
        toggleSelect: mockState.toggleSelect,
        setFocusedDoc: mockState.setFocusedDoc,
        toggleStar: mockState.toggleStar,
        openPdf: vi.fn(),
        openInFinder: vi.fn(),
        requestDeleteConfirm: vi.fn(),
        refreshMetadata: vi.fn(),
        categories: mockState.categories,
        createCategory: mockState.createCategory
      })
      return mockState
    },
    {
      getState: () => ({ showToast: vi.fn() })
    }
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn() }
  })
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => {
    const size = 28
    const count = opts?.count ?? 0
    const items = Array.from({ length: count }, (_, i) => ({
      key: `row-${i}`,
      index: i,
      start: i * size,
      size,
      end: (i + 1) * size
    }))
    return {
      getTotalSize: () => count * size,
      getVirtualItems: () => items,
      measureElement: vi.fn()
    }
  }
}))

function setupDefaultState() {
  mockState = {
    documents: [],
    isLoading: false,
    isSearching: false,
    searchResults: [],
    setSort: vi.fn(),
    setColumns: vi.fn(),
    toggleSelect: vi.fn(),
    setFocusedDoc: vi.fn(),
    toggleStar: vi.fn(),
    categories: [],
    createCategory: vi.fn()
  }
}

describe('DocumentList', () => {
  beforeEach(() => {
    setupDefaultState()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders empty state when store has 0 documents', () => {
    render(<DocumentList />)

    expect(screen.getByText('common.emptyLibrary')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('renders 5 document rows when store has 5 documents', () => {
    mockState.documents = [
      makeDoc({ id: '1', title: 'Alpha Paper', authors: 'Alice', year: '2023', venue: 'Nature' }),
      makeDoc({ id: '2', title: 'Beta Study', authors: 'Bob', year: '2022', venue: 'Science' }),
      makeDoc({ id: '3', title: 'Gamma Review', authors: 'Charlie', year: '2021', venue: 'Cell' }),
      makeDoc({ id: '4', title: 'Delta Report', authors: 'Dana', year: '2020', venue: 'PNAS' }),
      makeDoc({ id: '5', title: 'Epsilon Note', authors: 'Evan', year: '2019', venue: 'arXiv' })
    ]

    render(<DocumentList />)

    expect(screen.getByText('Alpha Paper')).toBeInTheDocument()
    expect(screen.getByText('Beta Study')).toBeInTheDocument()
    expect(screen.getByText('Gamma Review')).toBeInTheDocument()
    expect(screen.getByText('Delta Report')).toBeInTheDocument()
    expect(screen.getByText('Epsilon Note')).toBeInTheDocument()

    expect(screen.getAllByRole('checkbox')).toHaveLength(5)
  })

  it('renders loading skeleton when isLoading is true', () => {
    mockState.isLoading = true

    render(<DocumentList />)

    const skeletons = document.querySelectorAll('.skeleton-shimmer')
    expect(skeletons.length).toBeGreaterThan(0)

    expect(screen.queryByText('common.emptyLibrary')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('calls setFocusedDoc when a document row is clicked', async () => {
    mockState.documents = [makeDoc({ id: 'doc-1', title: 'Alpha Paper' })]

    render(<DocumentList />)

    const row = screen.getByText('Alpha Paper').closest('[class*="flex items-center"][class*="cursor-pointer"]')
    expect(row).not.toBeNull()

    await userEvent.click(row!)

    expect(mockState.setFocusedDoc).toHaveBeenCalledWith('doc-1')
  })

  it('calls setSort when a column header is clicked', async () => {
    mockState.documents = [makeDoc({ id: 'doc-1', title: 'Alpha Paper' })]

    render(<DocumentList />)

    const titleHeader = screen.getByText('list.title')
    await userEvent.click(titleHeader)

    expect(mockState.setSort).toHaveBeenCalledWith('title')
  })

  it('calls toggleStar when star button on a row is clicked', async () => {
    mockState.documents = [makeDoc({ id: 'doc-1', title: 'Alpha Paper', starred: 0 })]

    render(<DocumentList />)

    const starButton = screen.getByRole('button', { name: 'sidebar.starred' })
    await userEvent.click(starButton)

    expect(mockState.toggleStar).toHaveBeenCalledWith('doc-1')
  })

  it('renders filled star when document is starred', () => {
    mockState.documents = [makeDoc({ id: 'doc-1', title: 'Alpha Paper', starred: 1 })]

    render(<DocumentList />)

    const starBtn = screen.getByRole('button', { name: 'sidebar.starred' })
    const starSvg = starBtn.querySelector('svg')
    expect(starSvg).toBeTruthy()
    expect(starSvg!.className.baseVal || starSvg!.getAttribute('class')).toContain('fill-yellow-400')
  })

  it('renders column headers with sort indicators', () => {
    mockState.documents = [makeDoc()]

    render(<DocumentList />)

    expect(screen.getByText('list.title')).toBeInTheDocument()
    expect(screen.getByText('list.authors')).toBeInTheDocument()
    expect(screen.getByText('list.year')).toBeInTheDocument()
    expect(screen.getByText('list.venue')).toBeInTheDocument()
    expect(screen.getByText('list.addedAt')).toBeInTheDocument()
    expect(screen.getByText('list.filePath')).toBeInTheDocument()

    const sortIndicator = document.querySelector('svg.h-3.w-3')
    expect(sortIndicator).toBeInTheDocument()
  })
})
