import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReforaApi } from '@shared/ipc-types'

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

vi.mock('@lobehub/ui', async () => import('../mocks/lobehub-ui'))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ mode: 'system', resolvedTheme: 'light', setMode: vi.fn() })
}))

vi.mock('@renderer/components/SettingsModal', () => ({
  default: ({ open }: { open: boolean }) => open ? <div role="dialog" aria-label="settings" /> : null
}))

vi.mock('@renderer/components/ImportByIdentifierDialog', () => ({
  default: ({ open }: { open: boolean }) => open ? <div role="dialog" aria-label="identifier import" /> : null
}))

import Sidebar from '@renderer/components/Sidebar'

const api = window.api as ReforaApi
const originalAddFiles = api.import.addFiles

const renderSidebar = (collapsed = false, onToggleCollapse = vi.fn()) =>
  render(<Sidebar collapsed={collapsed} onToggleCollapse={onToggleCollapse} />)

describe('Sidebar actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.importProgress = null
    mocks.state.categories = []
    mocks.state.documents = []
  })

  afterEach(() => {
    cleanup()
    api.import.addFiles = originalAddFiles
  })

  it('renders add file / identifier import / collapse buttons in header', () => {
    renderSidebar()
    expect(screen.getByLabelText('topbar.addFile')).toBeInTheDocument()
    expect(screen.getByLabelText('topbar.importFromIdentifier')).toBeInTheDocument()
    expect(screen.getByLabelText('settings.sidebarCollapsed')).toBeInTheDocument()
  })

  it('opens settings from the footer', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByTitle('topbar.settings'))
    expect(screen.getByRole('dialog', { name: 'settings' })).toBeInTheDocument()
    expect(screen.queryByText('topbar.exportJson')).not.toBeInTheDocument()
    expect(screen.queryByText('topbar.exportBibtex')).not.toBeInTheDocument()
  })

  it('shows import progress bar when importProgress is set', () => {
    mocks.state.importProgress = { current: 2, total: 5 }
    renderSidebar()
    expect(screen.getByText('topbar.importing')).toBeInTheDocument()
  })

  it('hides progress bar when importProgress is null', () => {
    mocks.state.importProgress = null
    renderSidebar()
    expect(screen.queryByText('topbar.importing')).not.toBeInTheDocument()
  })

  it('calls onToggleCollapse when collapse button is clicked', async () => {
    const user = userEvent.setup()
    const toggleSpy = vi.fn()
    renderSidebar(false, toggleSpy)
    await user.click(screen.getByLabelText('settings.sidebarCollapsed'))
    expect(toggleSpy).toHaveBeenCalledOnce()
  })

  it('renders expand button when collapsed', () => {
    renderSidebar(true)
    expect(screen.getByLabelText('settings.sidebarCollapsed')).toBeInTheDocument()
  })

  it('opens identifier import from the header', async () => {
    const user = userEvent.setup()
    renderSidebar()
    await user.click(screen.getByLabelText('topbar.importFromIdentifier'))
    expect(screen.getByRole('dialog', { name: 'identifier import' })).toBeInTheDocument()
  })

  it('calls api.import.addFiles when add file button is clicked', async () => {
    const user = userEvent.setup()
    const addFilesSpy = vi.fn().mockResolvedValue([])
    api.import.addFiles = addFilesSpy
    renderSidebar()
    await user.click(screen.getByLabelText('topbar.addFile'))
    expect(addFilesSpy).toHaveBeenCalledWith([])
  })
})
