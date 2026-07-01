import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ListFilter, Category } from '../../src/shared/ipc-types'

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

import Sidebar from '../../src/renderer/components/Sidebar'

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.categories = defaultCategories
    mocks.state.listMode = { mode: 'all' }
    mocks.state.focusedDocId = null
    ;(window.api as Record<string, unknown> & { documents: { folderGroups: () => Promise<unknown> } }).documents.folderGroups = async () => []
  })

  afterEach(() => {
    cleanup()
  })

  it('renders without crashing', () => {
    render(<Sidebar collapsed={false} />)
    expect(screen.getByText('sidebar.allFiles')).toBeInTheDocument()
  })

  it('renders all 4 smart list items', () => {
    render(<Sidebar collapsed={false} />)
    expect(screen.getByText('sidebar.allFiles')).toBeInTheDocument()
    expect(screen.getByText('sidebar.recentlyRead')).toBeInTheDocument()
    expect(screen.getByText('sidebar.recentlyAdded')).toBeInTheDocument()
    expect(screen.getByText('sidebar.starred')).toBeInTheDocument()
  })

  it('calls setListMode with { mode: "all" } when All Files is clicked', async () => {
    render(<Sidebar collapsed={false} />)
    await userEvent.click(screen.getByText('sidebar.allFiles'))
    expect(mocks.setListMode).toHaveBeenCalledWith({ mode: 'all' })
  })

  it('renders categories section with names and counts', () => {
    render(<Sidebar collapsed={false} />)
    expect(screen.getByText('sidebar.categories')).toBeInTheDocument()
    expect(screen.getByText('ML (5)')).toBeInTheDocument()
    expect(screen.getByText('NLP (3)')).toBeInTheDocument()
    expect(screen.getByText('Vision (7)')).toBeInTheDocument()
  })

  it('shows empty state placeholder when categories array is empty', () => {
    mocks.state.categories = []
    render(<Sidebar collapsed={false} />)
    const emptyMessages = screen.getAllByText('sidebar.emptyCategories')
    expect(emptyMessages.length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('ML (5)')).not.toBeInTheDocument()
  })

  it('calls setListMode with category mode and correct categoryId on category click', async () => {
    render(<Sidebar collapsed={false} />)
    await userEvent.click(screen.getByText('ML (5)'))
    expect(mocks.setListMode).toHaveBeenCalledWith({ mode: 'category', categoryId: 'cat1' })
  })

  it('applies bg-active class to the active smart list item', () => {
    mocks.state.listMode = { mode: 'starred' }
    render(<Sidebar collapsed={false} />)

    const starredItem = screen.getByText('sidebar.starred')
    expect(starredItem.className).toContain('bg-active')

    const allFilesItem = screen.getByText('sidebar.allFiles')
    expect(allFilesItem.className).not.toContain('bg-active')
  })

  it('applies bg-active class to the active category item', () => {
    mocks.state.listMode = { mode: 'category', categoryId: 'cat2' }
    render(<Sidebar collapsed={false} />)

    const nlpItem = screen.getByText('NLP (3)')
    expect(nlpItem.className).toContain('bg-active')

    const mlItem = screen.getByText('ML (5)')
    expect(mlItem.className).not.toContain('bg-active')
  })
})
