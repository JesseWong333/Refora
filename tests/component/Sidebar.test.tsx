import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ListFilter, Category, Document } from '../../src/shared/ipc-types'

const defaultCategories: Category[] = [
  { id: 'cat1', name: 'ML', sortOrder: 0, createdAt: 0, count: 5 },
  { id: 'cat2', name: 'NLP', sortOrder: 1, createdAt: 0, count: 3 },
  { id: 'cat3', name: 'Vision', sortOrder: 2, createdAt: 0, count: 7 },
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
    identifierImporting: 0 as number,
    setListMode,
    fetchCategories,
    createCategory,
    renameCategory,
    deleteCategory,
    fetchDocuments,
    showToast: vi.fn(),
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

vi.mock('@lobehub/ui', async () => import('../mocks/lobehub-ui'))

vi.mock('../../src/renderer/hooks/useTheme', () => ({
  useTheme: () => ({ mode: 'system', resolvedTheme: 'light', setMode: vi.fn() })
}))

vi.mock('../../src/renderer/components/SettingsModal', () => ({
  default: vi.fn(() => null)
}))

vi.mock('../../src/renderer/components/ImportByIdentifierDialog', () => ({
  default: vi.fn(() => null)
}))

import Sidebar from '../../src/renderer/components/Sidebar'

const renderSidebar = () => render(<Sidebar collapsed={false} onToggleCollapse={vi.fn()} />)

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.categories = defaultCategories
    mocks.state.listMode = { mode: 'all' }
    mocks.state.focusedDocId = null
    mocks.state.documents = []
    mocks.state.importProgress = null
    mocks.state.identifierImporting = 0
  })

  afterEach(() => {
    cleanup()
  })

  it('renders all smart list items', () => {
    renderSidebar()
    expect(screen.getByText('sidebar.allFiles')).toBeInTheDocument()
    expect(screen.getByText('sidebar.recentlyRead')).toBeInTheDocument()
    expect(screen.getByText('sidebar.recentlyAdded')).toBeInTheDocument()
    expect(screen.getByText('sidebar.starred')).toBeInTheDocument()
  })

  it('calls setListMode with { mode: "all" } when All Files is clicked', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByText('sidebar.allFiles'))
    expect(mocks.setListMode).toHaveBeenCalledWith({ mode: 'all' })
  })

  it('renders categories section with names and counts', () => {
    renderSidebar()
    expect(screen.getByText('sidebar.categories')).toBeInTheDocument()
    expect(screen.getByText('ML (5)')).toBeInTheDocument()
    expect(screen.getByText('NLP (3)')).toBeInTheDocument()
    expect(screen.getByText('Vision (7)')).toBeInTheDocument()
  })

  it('shows empty state placeholder when categories array is empty', () => {
    mocks.state.categories = []
    renderSidebar()
    expect(screen.getByText('sidebar.emptyCategories')).toBeInTheDocument()
    expect(screen.queryByText('ML (5)')).not.toBeInTheDocument()
  })

  it('shows an inline input when the create-category button is clicked', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByLabelText('sidebar.createCategory'))
    expect(screen.getByPlaceholderText('sidebar.categoryName')).toBeInTheDocument()
  })

  it('creates a category when typing and pressing Enter in the inline input', async () => {
    const user = userEvent.setup()
    mocks.createCategory.mockResolvedValue({ id: 'new', name: 'Foo', sortOrder: 0, createdAt: 0 })
    renderSidebar()
    await user.click(screen.getByLabelText('sidebar.createCategory'))
    const input = screen.getByPlaceholderText('sidebar.categoryName')
    await user.type(input, 'Foo{Enter}')
    await waitFor(() => expect(mocks.createCategory).toHaveBeenCalledWith('Foo'))
  })

  it('cancels inline create on Escape without creating', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByLabelText('sidebar.createCategory'))
    const input = screen.getByPlaceholderText('sidebar.categoryName')
    await user.type(input, 'Bar{Escape}')
    expect(mocks.createCategory).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('sidebar.categoryName')).not.toBeInTheDocument()
  })

  it('calls setListMode with category mode and correct categoryId on category click', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByText('ML (5)'))
    expect(mocks.setListMode).toHaveBeenCalledWith({ mode: 'category', categoryId: 'cat1' })
  })

  it('applies sidebar-item-active class to the active smart list item', () => {
    mocks.state.listMode = { mode: 'starred' }
    renderSidebar()

    const starredItem = screen.getByText('sidebar.starred').closest('[class*="sidebar-item"]')
    expect(starredItem).toHaveClass('sidebar-item-active')

    const allFilesItem = screen.getByText('sidebar.allFiles').closest('[class*="sidebar-item"]')
    expect(allFilesItem).not.toHaveClass('sidebar-item-active')
  })

  it('applies sidebar-item-active class to the active category item', () => {
    mocks.state.listMode = { mode: 'category', categoryId: 'cat2' }
    renderSidebar()

    const nlpItem = screen.getByText('NLP (3)').closest('[class*="sidebar-item"]')
    expect(nlpItem).toHaveClass('sidebar-item-active')

    const mlItem = screen.getByText('ML (5)').closest('[class*="sidebar-item"]')
    expect(mlItem).not.toHaveClass('sidebar-item-active')
  })
})
