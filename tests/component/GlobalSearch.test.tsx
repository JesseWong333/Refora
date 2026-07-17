import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Document, GlobalSearchResult, LibrarySwitchResult, ReforaApi } from '@shared/ipc-types'

const mocks = vi.hoisted(() => ({
  documentSetState: vi.fn(),
  clearSearch: vi.fn(),
  openPdf: vi.fn(),
  showToast: vi.fn(),
  setActiveWorkspace: vi.fn(),
  openPanel: vi.fn(),
  setActiveThreadId: vi.fn(),
  workspaceState: {
    activeWorkspaceId: 'ws-current',
    chatStreaming: false
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@renderer/store/documentStore', () => ({
  useDocumentStore: {
    setState: mocks.documentSetState,
    getState: () => ({
      clearSearch: mocks.clearSearch,
      openPdf: mocks.openPdf,
      showToast: mocks.showToast
    })
  }
}))

vi.mock('@renderer/store/workspaceStore', () => {
  const getState = () => ({
    activeWorkspaceId: mocks.workspaceState.activeWorkspaceId,
    chatStreaming: mocks.workspaceState.chatStreaming,
    setActiveWorkspace: mocks.setActiveWorkspace,
    openPanel: mocks.openPanel,
    setActiveThreadId: mocks.setActiveThreadId
  })
  return {
    useWorkspaceStore: Object.assign(
      (selector: (state: ReturnType<typeof getState>) => unknown) => selector(getState()),
      { getState }
    )
  }
})

import GlobalSearch from '@renderer/components/GlobalSearch'

const paper = {
  id: 'paper-1',
  fileName: 'transformer.pdf',
  title: 'Transformer Research',
  authors: 'Ada Lovelace',
  year: '2025',
  venue: 'NeurIPS'
} as Document

const results: GlobalSearchResult = {
  documents: [paper],
  workspaceFiles: [{
    id: 'asset-1',
    workspaceId: 'ws-files',
    workspaceName: 'Experiments',
    fileName: 'transformer-data.csv',
    mimeType: 'text/csv',
    previewKind: 'text',
    fileMissing: 0,
    updatedAt: 10
  }],
  chats: [{
    threadId: 'thread-1',
    workspaceId: 'ws-chat',
    workspaceName: 'Reading notes',
    title: 'Transformer discussion',
    snippet: 'What is sparse attention?',
    role: 'user',
    matchedAt: 20
  }]
}

const api = window.api as ReforaApi
const originalGlobalSearch = api.search.global
const originalOpenAsset = api.workspaceAssets.open
const originalOnLibrarySwitched = api.events.onLibrarySwitched
const originalEventsOff = api.events.off
let librarySwitchedCallback: ((payload: LibrarySwitchResult) => void) | null = null

describe('GlobalSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workspaceState.activeWorkspaceId = 'ws-current'
    mocks.workspaceState.chatStreaming = false
    librarySwitchedCallback = null
    api.search.global = vi.fn().mockResolvedValue(results)
    api.workspaceAssets.open = vi.fn().mockResolvedValue(undefined)
    api.events.onLibrarySwitched = vi.fn((callback) => {
      librarySwitchedCallback = callback
    })
    api.events.off = vi.fn()
  })

  afterEach(() => {
    cleanup()
    api.search.global = originalGlobalSearch
    api.workspaceAssets.open = originalOpenAsset
    api.events.onLibrarySwitched = originalOnLibrarySwitched
    api.events.off = originalEventsOff
  })

  it('renders above every panel and groups all three result types', async () => {
    const { container } = render(<GlobalSearch />)
    const input = screen.getByRole('combobox', { name: 'globalSearch.label' })

    expect(container.firstElementChild).toHaveClass(
      'absolute',
      'left-1/2',
      'top-2.5',
      '-translate-x-1/2',
      'z-10',
      'isolate',
      'no-drag',
      'pointer-events-auto'
    )
    expect(container.firstElementChild).not.toHaveClass('fixed', 'pointer-events-none', 'inset-x-0')
    expect(input).toHaveClass('h-7', 'rounded-lg', 'bg-background')
    expect(screen.getByText('⌘F')).toHaveClass('pointer-events-none')
    fireEvent.mouseDown(input.parentElement as HTMLElement)
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: 'transformer' } })

    await waitFor(() => expect(api.search.global).toHaveBeenCalledWith('transformer'))
    expect(await screen.findByText('globalSearch.papers · 1')).toBeInTheDocument()
    expect(screen.getByRole('listbox')).toHaveClass('bg-panel')
    expect(screen.getByRole('listbox')).not.toHaveClass('bg-panel/95', 'backdrop-blur-xl')
    expect(screen.getByText('globalSearch.workspaceFiles · 1')).toBeInTheDocument()
    expect(screen.getByText('globalSearch.chats · 1')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'globalSearch.openPaper: Transformer Research' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'globalSearch.openWorkspaceFile: transformer-data.csv' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'globalSearch.openChat: Transformer discussion' })).toBeInTheDocument()
  })

  it('opens papers and preserves the full paper result set in the document list', async () => {
    render(<GlobalSearch />)
    const input = screen.getByRole('combobox', { name: 'globalSearch.label' })
    fireEvent.change(input, { target: { value: 'transformer' } })
    const option = await screen.findByRole('option', { name: 'globalSearch.openPaper: Transformer Research' })

    fireEvent.click(option)

    expect(mocks.documentSetState).toHaveBeenCalledWith({
      focusedDocId: 'paper-1',
      isSearching: true,
      searchQuery: 'transformer',
      searchResults: [paper]
    })
    expect(mocks.openPdf).toHaveBeenCalledWith('paper-1')
  })

  it('navigates workspace-file and chat results to their owning workspaces', async () => {
    render(<GlobalSearch />)
    const input = screen.getByRole('combobox', { name: 'globalSearch.label' })
    fireEvent.change(input, { target: { value: 'transformer' } })
    const fileOption = await screen.findByRole('option', { name: 'globalSearch.openWorkspaceFile: transformer-data.csv' })

    fireEvent.click(fileOption)
    expect(mocks.setActiveWorkspace).toHaveBeenCalledWith('ws-files')
    expect(api.workspaceAssets.open).toHaveBeenCalledWith('asset-1')

    fireEvent.focus(input)
    const chatOption = await screen.findByRole('option', { name: 'globalSearch.openChat: Transformer discussion' })
    fireEvent.click(chatOption)

    expect(mocks.setActiveWorkspace).toHaveBeenCalledWith('ws-chat')
    expect(mocks.setActiveThreadId).toHaveBeenCalledWith('thread-1')
  })

  it('supports keyboard selection and clears document search state', async () => {
    render(<GlobalSearch />)
    const input = screen.getByRole('combobox', { name: 'globalSearch.label' })
    fireEvent.change(input, { target: { value: 'transformer' } })
    await screen.findByRole('option', { name: 'globalSearch.openPaper: Transformer Research' })

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mocks.openPdf).toHaveBeenCalledWith('paper-1')

    fireEvent.click(screen.getByRole('button', { name: 'globalSearch.clear' }))
    expect(input).toHaveValue('')
    expect(mocks.clearSearch).toHaveBeenCalledOnce()
  })

  it('clears local results when the active library changes', async () => {
    render(<GlobalSearch />)
    const input = screen.getByRole('combobox', { name: 'globalSearch.label' })
    fireEvent.change(input, { target: { value: 'transformer' } })
    await screen.findByRole('option', { name: 'globalSearch.openPaper: Transformer Research' })

    act(() => {
      librarySwitchedCallback?.({
        libraryFolderPath: '/next-library',
        dbExisted: true,
        scanned: 0,
        imported: 0,
        skipped: 0,
        errors: []
      })
    })

    expect(input).toHaveValue('')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('reports workspace file open failures', async () => {
    api.workspaceAssets.open = vi.fn().mockRejectedValue(new Error('Cannot open asset'))
    render(<GlobalSearch />)
    const input = screen.getByRole('combobox', { name: 'globalSearch.label' })
    fireEvent.change(input, { target: { value: 'transformer' } })
    const option = await screen.findByRole('option', { name: 'globalSearch.openWorkspaceFile: transformer-data.csv' })

    fireEvent.click(option)

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Cannot open asset'))
  })

  it('focuses missing papers and explains why they cannot be opened', async () => {
    api.search.global = vi.fn().mockResolvedValue({
      ...results,
      documents: [{ ...paper, fileMissing: 1 }]
    })
    render(<GlobalSearch />)
    const input = screen.getByRole('combobox', { name: 'globalSearch.label' })
    fireEvent.change(input, { target: { value: 'transformer' } })
    const option = await screen.findByRole('option', { name: 'globalSearch.openPaper: Transformer Research' })

    fireEvent.click(option)

    expect(mocks.documentSetState).toHaveBeenCalled()
    expect(mocks.openPdf).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith('globalSearch.paperFileMissing')
  })

  it('disables context switches while AI chat is streaming', async () => {
    mocks.workspaceState.chatStreaming = true
    render(<GlobalSearch />)
    const input = screen.getByRole('combobox', { name: 'globalSearch.label' })
    fireEvent.change(input, { target: { value: 'transformer' } })
    const fileOption = await screen.findByRole('option', { name: 'globalSearch.openWorkspaceFile: transformer-data.csv' })
    const chatOption = screen.getByRole('option', { name: 'globalSearch.openChat: Transformer discussion' })

    expect(fileOption).toBeDisabled()
    expect(chatOption).toBeDisabled()
    expect(fileOption).toHaveAttribute('title', 'globalSearch.unavailableWhileStreaming')
    fireEvent.click(fileOption)
    fireEvent.click(chatOption)
    expect(mocks.setActiveWorkspace).not.toHaveBeenCalled()
    expect(mocks.setActiveThreadId).not.toHaveBeenCalled()
    expect(api.workspaceAssets.open).not.toHaveBeenCalled()
  })
})
