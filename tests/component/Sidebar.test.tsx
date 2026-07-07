import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ListFilter, Category, Document } from '../../src/shared/ipc-types'

const defaultCategories: Category[] = [
  { id: 'cat1', name: 'ML', sortOrder: 0, moveToLibrary: null, createdAt: 0, count: 5 },
  { id: 'cat2', name: 'NLP', sortOrder: 1, moveToLibrary: null, createdAt: 0, count: 3 },
  { id: 'cat3', name: 'Vision', sortOrder: 2, moveToLibrary: null, createdAt: 0, count: 7 },
]

const mocks = vi.hoisted(() => {
  const setListMode = vi.fn()
  const fetchCategories = vi.fn()
  const createCategory = vi.fn()
  const renameCategory = vi.fn()
  const deleteCategory = vi.fn()
  const fetchDocuments = vi.fn()

  const state: Record<string, unknown> = {
    categories: [] as Category[],
    listMode: { mode: 'all' } as ListFilter,
    focusedDocId: null as string | null,
    selectedIds: [] as string[],
    documents: [] as Document[],
    importProgress: null as { current: number; total: number } | null,
    pendingMetadataCount: 0,
    setListMode,
    fetchCategories,
    createCategory,
    renameCategory,
    deleteCategory,
    fetchDocuments,
  }

  return { setListMode, fetchCategories, createCategory, renameCategory, deleteCategory, fetchDocuments, state }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: () => new Promise<void>(() => {}) },
  }),
}))

vi.mock('@renderer/store/documentStore', () => ({
  useDocumentStore: Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) => (selector ? selector(mocks.state) : mocks.state),
    {
      getState: () => mocks.state,
      setState: (partial: Record<string, unknown>) => void Object.assign(mocks.state, partial),
    }
  ),
}))

vi.mock('../../src/renderer/components/SettingsModal', () => ({
  default: vi.fn(() => null)
}))

import Sidebar from '../../src/renderer/components/Sidebar'
import { AppThemeProvider } from '../../src/renderer/hooks/useTheme'

const renderWithTheme = (ui: React.ReactElement) =>
  render(ui, { wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider> })

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.categories = defaultCategories
    mocks.state.listMode = { mode: 'all' }
    mocks.state.focusedDocId = null
    mocks.state.documents = []
    mocks.state.importProgress = null
    mocks.state.pendingMetadataCount = 0
  })

  afterEach(() => {
    cleanup()
  })

  it('renders without crashing', () => {
    renderWithTheme(<Sidebar collapsed={false} onToggleCollapse={vi.fn()} />)
    expect(screen.getByText('sidebar.allFiles')).toBeInTheDocument()
  })

  it('renders all 4 smart list items', () => {
    renderWithTheme(<Sidebar collapsed={false} onToggleCollapse={vi.fn()} />)
    expect(screen.getByText('sidebar.allFiles')).toBeInTheDocument()
    expect(screen.getByText('sidebar.recentlyRead')).toBeInTheDocument()
    expect(screen.getByText('sidebar.recentlyAdded')).toBeInTheDocument()
    expect(screen.getByText('sidebar.starred')).toBeInTheDocument()
  })

  it('calls setListMode with { mode: "all" } when All Files is clicked', async () => {
    renderWithTheme(<Sidebar collapsed={false} onToggleCollapse={vi.fn()} />)
    await userEvent.click(screen.getByText('sidebar.allFiles'))
    expect(mocks.setListMode).toHaveBeenCalledWith({ mode: 'all' })
  })

  it('renders categories section with names and counts', () => {
    renderWithTheme(<Sidebar collapsed={false} onToggleCollapse={vi.fn()} />)
    expect(screen.getByText('sidebar.categories')).toBeInTheDocument()
    expect(screen.getByText('ML (5)')).toBeInTheDocument()
    expect(screen.getByText('NLP (3)')).toBeInTheDocument()
    expect(screen.getByText('Vision (7)')).toBeInTheDocument()
  })

  it('shows empty state placeholder when categories array is empty', () => {
    mocks.state.categories = []
    renderWithTheme(<Sidebar collapsed={false} onToggleCollapse={vi.fn()} />)
    const emptyMessages = screen.getAllByText('sidebar.emptyCategories')
    expect(emptyMessages.length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('ML (5)')).not.toBeInTheDocument()
  })

  it('calls setListMode with category mode and correct categoryId on category click', async () => {
    renderWithTheme(<Sidebar collapsed={false} onToggleCollapse={vi.fn()} />)
    await userEvent.click(screen.getByText('ML (5)'))
    expect(mocks.setListMode).toHaveBeenCalledWith({ mode: 'category', categoryId: 'cat1' })
  })

  it('applies sidebar-item-active class to the active smart list item', () => {
    mocks.state.listMode = { mode: 'starred' }
    renderWithTheme(<Sidebar collapsed={false} onToggleCollapse={vi.fn()} />)

    const starredItem = screen.getByText('sidebar.starred').closest('[class*="sidebar-item"]')
    expect(starredItem?.className).toContain('sidebar-item-active')

    const allFilesItem = screen.getByText('sidebar.allFiles').closest('[class*="sidebar-item"]')
    expect(allFilesItem?.className).not.toContain('sidebar-item-active')
  })

  it('applies sidebar-item-active class to the active category item', () => {
    mocks.state.listMode = { mode: 'category', categoryId: 'cat2' }
    renderWithTheme(<Sidebar collapsed={false} onToggleCollapse={vi.fn()} />)

    const nlpItem = screen.getByText('NLP (3)').closest('[class*="sidebar-item"]')
    expect(nlpItem?.className).toContain('sidebar-item-active')

    const mlItem = screen.getByText('ML (5)').closest('[class*="sidebar-item"]')
    expect(mlItem?.className).not.toContain('sidebar-item-active')
  })

  describe('metadata refresh indicator', () => {
    it('shows the refresh indicator when pendingMetadataCount > 0 and no import progress', () => {
      mocks.state.pendingMetadataCount = 2
      mocks.state.importProgress = null
      renderWithTheme(<Sidebar collapsed={false} onToggleCollapse={vi.fn()} />)
      expect(screen.getByText('topbar.refreshingMetadata')).toBeInTheDocument()
    })

    it('hides the refresh indicator when pendingMetadataCount is 0', () => {
      mocks.state.pendingMetadataCount = 0
      mocks.state.importProgress = null
      renderWithTheme(<Sidebar collapsed={false} onToggleCollapse={vi.fn()} />)
      expect(screen.queryByText('topbar.refreshingMetadata')).not.toBeInTheDocument()
    })

    it('hides the refresh indicator while import progress is active', () => {
      mocks.state.pendingMetadataCount = 5
      mocks.state.importProgress = { current: 1, total: 3 }
      renderWithTheme(<Sidebar collapsed={false} onToggleCollapse={vi.fn()} />)
      expect(screen.queryByText('topbar.refreshingMetadata')).not.toBeInTheDocument()
      expect(screen.getByText('topbar.importing')).toBeInTheDocument()
    })
  })
})
