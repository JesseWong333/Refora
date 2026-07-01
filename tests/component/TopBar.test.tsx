import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TopBar from '@renderer/components/TopBar'

let mockState: {
  isImporting: boolean
  importProgress: { current: number; total: number } | null
  searchQuery: string
  selectedIds: string[]
  performSearch: ReturnType<typeof vi.fn>
  clearSearch: ReturnType<typeof vi.fn>
  fetchDocuments: ReturnType<typeof vi.fn>
}

vi.mock('@renderer/store/documentStore', () => ({
  useDocumentStore: (selector?: (state: typeof mockState) => unknown) => {
    if (selector) return selector(mockState)
    return mockState
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      if (vars) {
        return key.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''))
      }
      return key
    },
    i18n: { changeLanguage: vi.fn() }
  })
}))

vi.mock('@renderer/components/WatchFoldersSettings', () => ({
  default: () => null
}))

vi.mock('@renderer/components/SettingsModal', () => ({
  default: () => null
}))

function setupDefaultState() {
  mockState = {
    isImporting: false,
    importProgress: null,
    searchQuery: '',
    selectedIds: [],
    performSearch: vi.fn(),
    clearSearch: vi.fn(),
    fetchDocuments: vi.fn()
  }
}

function renderTopBar(extraProps?: Partial<{ sidebarCollapsed: boolean }>) {
  const props = {
    sidebarCollapsed: false,
    onToggleSidebar: vi.fn(),
    ...extraProps
  }
  return render(<TopBar {...props} />)
}

describe('TopBar', () => {
  beforeEach(() => {
    setupDefaultState()
    vi.spyOn(window.api.import, 'addFiles').mockResolvedValue({ ok: true, data: { added: [], skipped: [], errors: [] } })
    vi.spyOn(window.api.import, 'addFolder').mockResolvedValue({ ok: true, data: { added: [], skipped: [], errors: [] } })
    vi.spyOn(window.api.export, 'toJson').mockResolvedValue({ ok: true, data: undefined })
    vi.spyOn(window.api.export, 'toBibtex').mockResolvedValue({ ok: true, data: undefined })
  })

  afterEach(() => {
    cleanup()
  })

  it('mounts without crash', () => {
    expect(() => renderTopBar()).not.toThrow()
    expect(screen.getByText('topbar.addFile')).toBeInTheDocument()
  })

  it('renders Add File button and calls api.import.addFiles on click', async () => {
    renderTopBar()
    const btn = screen.getByText('topbar.addFile')
    expect(btn).not.toBeDisabled()

    await userEvent.click(btn)

    expect(window.api.import.addFiles).toHaveBeenCalledOnce()
  })

  it('renders Add Folder button and calls api.import.addFolder on click', async () => {
    renderTopBar()
    const btn = screen.getByText('topbar.addFolder')
    expect(btn).not.toBeDisabled()

    await userEvent.click(btn)

    expect(window.api.import.addFolder).toHaveBeenCalledOnce()
  })

  it('renders search input and calls performSearch on typing', async () => {
    renderTopBar()

    const input = screen.getByPlaceholderText('topbar.search')
    expect(input).toBeInTheDocument()

    await userEvent.type(input, 'hello')

    expect(mockState.performSearch).toHaveBeenCalled()
  })

  it('clears search on Escape key', () => {
    mockState.searchQuery = 'hello'
    renderTopBar()

    const input = screen.getByPlaceholderText('topbar.search') as HTMLInputElement
    expect(input.value).toBe('hello')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(mockState.clearSearch).toHaveBeenCalledOnce()
  })

  it('shows import progress bar and disables buttons when isImporting is true', () => {
    mockState.isImporting = true
    mockState.importProgress = { current: 2, total: 5 }
    renderTopBar()

    const progressText = screen.getByText('topbar.importing')
    expect(progressText).toBeInTheDocument()

    const addFileBtn = screen.getByText('topbar.addFile')
    const addFolderBtn = screen.getByText('topbar.addFolder')
    expect(addFileBtn).toBeDisabled()
    expect(addFolderBtn).toBeDisabled()
  })

  it('hides progress bar and enables buttons when isImporting is false', () => {
    mockState.isImporting = false
    mockState.importProgress = null
    renderTopBar()

    expect(screen.queryByText('topbar.importing')).not.toBeInTheDocument()

    expect(screen.getByText('topbar.addFile')).not.toBeDisabled()
    expect(screen.getByText('topbar.addFolder')).not.toBeDisabled()
  })

  it('disables Export BibTeX button when no documents selected', () => {
    mockState.selectedIds = []
    renderTopBar()

    const bibtexBtn = screen.getByText('topbar.exportBibtex')
    expect(bibtexBtn).toBeDisabled()
  })
})
