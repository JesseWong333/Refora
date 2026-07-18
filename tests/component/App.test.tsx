import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  documentState: {
    focusedDocId: null as string | null,
    selectedIds: [] as string[],
    listMode: { mode: 'all' } as { mode: string },
    init: vi.fn(),
    destroy: vi.fn()
  },
  workspaceState: {
    activeWorkspaceId: 'ws-1' as string | null,
    panelOpen: true,
    fullscreen: false,
    chatStreaming: false,
    init: vi.fn(),
    destroy: vi.fn()
  },
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
  resizeObserverCallback: null as ResizeObserverCallback | null
}))

class ResizeObserverTestMock {
  constructor(callback: ResizeObserverCallback) {
    mocks.resizeObserverCallback = callback
  }

  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('@lobehub/ui', () => ({
  ContextMenuHost: () => null,
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('antd', () => ({
  theme: {
    darkAlgorithm: {},
    defaultAlgorithm: {}
  }
}))

vi.mock('@renderer/hooks/useAppShortcuts', () => ({
  useAppShortcuts: vi.fn()
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  AppThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  useTheme: () => ({ mode: 'system', resolvedTheme: 'light' })
}))

vi.mock('@renderer/theme/tokens', () => ({
  getAntdTokenOverrides: () => ({})
}))

vi.mock('@renderer/store/documentStore', () => ({
  useDocumentStore: Object.assign(
    (selector: (state: typeof mocks.documentState) => unknown) => selector(mocks.documentState),
    { getState: () => mocks.documentState }
  )
}))

vi.mock('@renderer/store/workspaceStore', () => ({
  useWorkspaceStore: Object.assign(
    (selector: (state: typeof mocks.workspaceState) => unknown) => selector(mocks.workspaceState),
    { getState: () => mocks.workspaceState }
  )
}))

vi.mock('@renderer/ipc', () => ({
  api: {
    settings: {
      get: mocks.settingsGet,
      set: mocks.settingsSet
    }
  }
}))

vi.mock('@renderer/components/GlobalSearch', () => ({
  default: () => <div data-testid="global-search" />
}))
vi.mock('@renderer/components/Sidebar', () => ({
  default: ({ collapsed }: { collapsed: boolean }) => (
    <div data-testid={collapsed ? 'collapsed-sidebar-toolbar' : 'sidebar'} />
  )
}))
vi.mock('@renderer/components/DocumentList', () => ({
  default: ({ compact, onClose }: { compact: boolean; onClose?: () => void }) => (
    <div data-testid="document-list" data-compact={compact ? 'true' : 'false'}>
      {onClose ? <button type="button" onClick={onClose}>document-tab-close</button> : null}
    </div>
  )
}))
vi.mock('@renderer/components/DetailPanel', () => ({
  default: () => <div data-testid="detail-panel" />
}))
vi.mock('@renderer/components/workspace/WorkspacePanel', () => ({
  default: () => <div data-testid="workspace-panel" />
}))
vi.mock('@renderer/components/workspace/ChatPanel', () => ({
  default: ({ onClose }: { onClose?: () => void }) => (
    <div data-testid="chat-panel">
      {onClose ? <button type="button" onClick={onClose}>chat-tab-close</button> : null}
    </div>
  )
}))
vi.mock('@renderer/components/ResizeDivider', () => ({
  default: ({
    onResize,
    variant = 'line'
  }: {
    onResize: (delta: number) => void
    variant?: string
  }) => (
    <button
      type="button"
      data-testid="resize-divider"
      data-variant={variant}
      onClick={(event) => onResize(Number(event.currentTarget.dataset.resizeDelta ?? 0))}
    />
  )
}))
vi.mock('@renderer/components/ConfirmDialog', () => ({
  default: () => null
}))
vi.mock('@renderer/components/FirstRunWizard', () => ({
  default: () => <div data-testid="first-run-wizard" />
}))
vi.mock('@renderer/components/ui', () => ({
  Toast: () => null
}))

import App from '@renderer/App'

describe('App root layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.documentState.focusedDocId = null
    mocks.documentState.selectedIds = []
    mocks.documentState.listMode = { mode: 'all' }
    mocks.workspaceState.activeWorkspaceId = 'ws-1'
    mocks.workspaceState.panelOpen = true
    mocks.workspaceState.fullscreen = false
    mocks.workspaceState.chatStreaming = false
    mocks.resizeObserverCallback = null
    mocks.settingsGet.mockImplementation((_key: string, fallback: unknown) => Promise.resolve(fallback))
    mocks.settingsSet.mockResolvedValue(undefined)
    vi.stubGlobal('ResizeObserver', ResizeObserverTestMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('keeps the sidebar outside the search bar and all main panels below it', async () => {
    render(<App listColumnState={null} sidebarCollapsed={false} firstRun={false} />)

    const mainLayer = screen.getByTestId('app-main-layer')
    const topBar = screen.getByTestId('app-top-bar')
    const panelLayer = screen.getByTestId('app-panel-layer')

    expect(mainLayer).toHaveClass('flex', 'flex-1', 'flex-col')
    expect(topBar.parentElement).toBe(mainLayer)
    expect(topBar).toHaveClass('drag-region', 'h-12', 'shrink-0')
    expect(topBar).not.toHaveClass('z-[60]', 'border-b')
    expect(within(topBar).getByTestId('app-top-bar-separator')).toHaveStyle({
      background: 'linear-gradient(to right, var(--color-background), var(--color-border) 100px)'
    })
    expect(panelLayer).toHaveClass('min-h-0', 'flex-1', 'overflow-hidden')
    expect(within(topBar).getByTestId('global-search')).toBeInTheDocument()
    expect(within(topBar).getByRole('button', { name: 'workspace.chat.closePanel' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('app-sidebar-layer')).toContainElement(screen.getByTestId('sidebar'))
    expect(within(mainLayer).queryByTestId('sidebar')).not.toBeInTheDocument()
    expect(within(panelLayer).getByTestId('document-list')).toBeInTheDocument()
    expect(within(panelLayer).getByTestId('detail-panel')).toBeInTheDocument()
    expect(within(panelLayer).getByTestId('workspace-panel')).toBeInTheDocument()
    expect(within(panelLayer).getByTestId('chat-panel')).toBeInTheDocument()
    expect(within(panelLayer).getAllByTestId('resize-divider').length).toBeGreaterThan(0)
    expect(within(topBar).queryByTestId('resize-divider')).not.toBeInTheDocument()
    expect(topBar.compareDocumentPosition(panelLayer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await waitFor(() => expect(mocks.documentState.init).toHaveBeenCalled())
  })

  it('places the workspace canvas and AI chat at the app panel level and toggles chat from the root bar', () => {
    render(<App listColumnState={null} sidebarCollapsed={false} firstRun={false} />)

    const workspacePanel = screen.getByTestId('app-workspace-panel')
    const chatPanel = screen.getByTestId('app-chat-panel')
    const primaryPanels = screen.getByTestId('app-primary-panels')
    expect(primaryPanels).toContainElement(workspacePanel)
    expect(primaryPanels.parentElement).toBe(chatPanel.parentElement)
    expect(primaryPanels).toHaveClass('min-w-0', 'flex-1', 'overflow-hidden')
    expect(chatPanel).toHaveClass('min-w-0', 'shrink-0')

    fireEvent.click(screen.getByRole('button', { name: 'workspace.chat.closePanel' }))
    expect(screen.queryByTestId('app-chat-panel')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'workspace.chat.openPanel' }))
    expect(screen.getByTestId('app-chat-panel')).toBeInTheDocument()
  })

  it('closes AI chat from its tab and reopens it from the root bar', () => {
    render(<App listColumnState={null} sidebarCollapsed={false} firstRun={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'chat-tab-close' }))
    expect(screen.queryByTestId('app-chat-panel')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'workspace.chat.openPanel' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'workspace.chat.openPanel' }))
    expect(screen.getByTestId('app-chat-panel')).toBeInTheDocument()
  })

  it('closes a compact document list and reopens it when a library view is selected', async () => {
    const view = render(<App listColumnState={null} sidebarCollapsed={false} firstRun={false} />)

    await waitFor(() => expect(screen.getByTestId('document-list')).toHaveAttribute('data-compact', 'true'))
    fireEvent.click(screen.getByRole('button', { name: 'document-tab-close' }))
    expect(screen.queryByTestId('app-document-list-panel')).not.toBeInTheDocument()

    mocks.documentState.listMode = { mode: 'starred' }
    view.rerender(<App listColumnState={null} sidebarCollapsed={false} firstRun={false} />)
    await waitFor(() => expect(screen.getByTestId('app-document-list-panel')).toBeInTheDocument())
  })

  it('switches the document list between compact and expanded states at resize thresholds', async () => {
    render(<App listColumnState={null} sidebarCollapsed={false} firstRun={false} />)

    const primaryPanels = screen.getByTestId('app-primary-panels')
    const documentList = screen.getByTestId('document-list')
    const documentListPanel = screen.getByTestId('app-document-list-panel')
    await waitFor(() => expect(documentList).toHaveAttribute('data-compact', 'true'))
    expect(documentListPanel).toHaveStyle({ width: '320px' })

    let divider = within(primaryPanels).getByTestId('resize-divider')
    divider.dataset.resizeDelta = '39'
    fireEvent.click(divider)
    expect(documentList).toHaveAttribute('data-compact', 'true')
    expect(documentListPanel).toHaveStyle({ width: '359px' })

    divider = within(primaryPanels).getByTestId('resize-divider')
    divider.dataset.resizeDelta = '1'
    fireEvent.click(divider)
    expect(documentList).toHaveAttribute('data-compact', 'false')
    expect(within(primaryPanels).getByTestId('resize-divider')).toHaveAttribute('data-variant', 'soft')

    vi.spyOn(documentListPanel, 'getBoundingClientRect').mockReturnValue({
      bottom: 0,
      height: 0,
      left: 0,
      right: 321,
      top: 0,
      width: 321,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })
    divider = within(primaryPanels).getByTestId('resize-divider')
    divider.dataset.resizeDelta = '-1'
    fireEvent.click(divider)
    expect(documentList).toHaveAttribute('data-compact', 'true')
    expect(documentListPanel).toHaveStyle({ width: '320px' })
  })

  it('returns to compact mode when layout changes squeeze an expanded document list', async () => {
    render(<App listColumnState={null} sidebarCollapsed={false} firstRun={false} />)

    const primaryPanels = screen.getByTestId('app-primary-panels')
    const documentList = screen.getByTestId('document-list')
    await waitFor(() => expect(documentList).toHaveAttribute('data-compact', 'true'))

    const compactDivider = within(primaryPanels).getByTestId('resize-divider')
    compactDivider.dataset.resizeDelta = '40'
    fireEvent.click(compactDivider)
    expect(documentList).toHaveAttribute('data-compact', 'false')

    act(() => {
      mocks.resizeObserverCallback?.([], {} as ResizeObserver)
    })
    expect(documentList).toHaveAttribute('data-compact', 'false')

    const documentListPanel = screen.getByTestId('app-document-list-panel')
    vi.spyOn(documentListPanel, 'getBoundingClientRect').mockReturnValue({
      bottom: 0,
      height: 0,
      left: 0,
      right: 280,
      top: 0,
      width: 280,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })
    act(() => {
      mocks.resizeObserverCallback?.([], {} as ResizeObserver)
    })
    expect(documentList).toHaveAttribute('data-compact', 'true')
    expect(documentListPanel).toHaveStyle({ width: '280px' })
  })

  it('keeps the root bar visible above a fullscreen workspace', () => {
    mocks.workspaceState.fullscreen = true

    render(<App listColumnState={null} sidebarCollapsed={false} firstRun={false} />)

    const topBar = screen.getByTestId('app-top-bar')
    const panelLayer = screen.getByTestId('app-panel-layer')
    expect(within(topBar).getByTestId('global-search')).toBeInTheDocument()
    expect(screen.queryByTestId('app-sidebar-layer')).not.toBeInTheDocument()
    expect(within(panelLayer).getByTestId('workspace-panel')).toBeInTheDocument()
    expect(within(panelLayer).queryByTestId('document-list')).not.toBeInTheDocument()
  })

  it('places the collapsed sidebar toolbar inside the root top bar', () => {
    render(<App listColumnState={null} sidebarCollapsed firstRun={false} />)

    const topBar = screen.getByTestId('app-top-bar')
    expect(within(topBar).getByTestId('collapsed-sidebar-toolbar')).toBeInTheDocument()
    expect(within(topBar).getByTestId('global-search')).toBeInTheDocument()
    expect(screen.queryByTestId('app-sidebar-layer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument()
  })
})
