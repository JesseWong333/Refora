import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => {
  const state: Record<string, unknown> = {
    categories: [],
    listMode: { mode: 'all' },
    focusedDocId: null,
    selectedIds: [] as string[],
    documents: [],
    importProgress: null as { current: number; total: number } | null,
    setListMode: vi.fn(),
    fetchCategories: vi.fn(),
    fetchDocuments: vi.fn().mockResolvedValue(undefined),
    createCategory: vi.fn(),
    renameCategory: vi.fn(),
    deleteCategory: vi.fn(),
  }
  return { state }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      if (vars) {
        return key.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''))
      }
      return key
    },
    i18n: { changeLanguage: vi.fn() }
  }),
}))

vi.mock('@renderer/store/documentStore', () => ({
  useDocumentStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    if (selector) return selector(mocks.state)
    return mocks.state
  },
}))

vi.mock('@renderer/components/SettingsModal', () => ({
  default: () => null
}))

import Sidebar from '@renderer/components/Sidebar'
import { AppThemeProvider } from '@renderer/hooks/useTheme'

const renderWithTheme = (ui: React.ReactElement) =>
  render(ui, { wrapper: ({ children }) => <AppThemeProvider>{children}</AppThemeProvider> })

describe('Sidebar header actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.importProgress = null
    mocks.state.categories = []
    mocks.state.documents = []
  })

  afterEach(() => {
    cleanup()
  })

  it('renders add file / identifier import / collapse buttons in header', () => {
    renderWithTheme(<Sidebar collapsed={false} onToggleCollapse={vi.fn()} />)
    expect(screen.getByLabelText('topbar.addFile')).toBeInTheDocument()
    expect(screen.getByLabelText('topbar.importFromIdentifier')).toBeInTheDocument()
    expect(screen.getByLabelText('settings.sidebarCollapsed')).toBeInTheDocument()
  })

  it('renders settings and theme buttons in footer', () => {
    renderWithTheme(<Sidebar collapsed={false} onToggleCollapse={vi.fn()} />)
    expect(screen.getByTitle('topbar.settings')).toBeInTheDocument()
    expect(screen.queryByText('topbar.exportJson')).not.toBeInTheDocument()
    expect(screen.queryByText('topbar.exportBibtex')).not.toBeInTheDocument()
  })

  it('shows import progress bar when importProgress is set', () => {
    mocks.state.importProgress = { current: 2, total: 5 }
    renderWithTheme(<Sidebar collapsed={false} onToggleCollapse={vi.fn()} />)
    expect(screen.getByText('topbar.importing')).toBeInTheDocument()
  })

  it('hides progress bar when importProgress is null', () => {
    mocks.state.importProgress = null
    renderWithTheme(<Sidebar collapsed={false} onToggleCollapse={vi.fn()} />)
    expect(screen.queryByText('topbar.importing')).not.toBeInTheDocument()
  })

  it('calls onToggleCollapse when collapse button is clicked', async () => {
    const toggleSpy = vi.fn()
    renderWithTheme(<Sidebar collapsed={false} onToggleCollapse={toggleSpy} />)
    await userEvent.click(screen.getByLabelText('settings.sidebarCollapsed'))
    expect(toggleSpy).toHaveBeenCalledOnce()
  })

  it('renders expand button when collapsed', () => {
    renderWithTheme(<Sidebar collapsed={true} onToggleCollapse={vi.fn()} />)
    expect(screen.getByLabelText('settings.sidebarCollapsed')).toBeInTheDocument()
  })

  it('calls api.import.addFiles when add file button is clicked', async () => {
    const addFilesSpy = vi.fn().mockResolvedValue([])
    ;(window.api as Record<string, unknown> & { import: { addFiles: () => Promise<unknown> } }).import.addFiles = addFilesSpy
    renderWithTheme(<Sidebar collapsed={false} onToggleCollapse={vi.fn()} />)
    await userEvent.click(screen.getByLabelText('topbar.addFile'))
    expect(addFilesSpy).toHaveBeenCalled()
  })
})
