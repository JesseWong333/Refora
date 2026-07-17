import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  documentState: {
    focusedDocId: null as string | null,
    selectedIds: [] as string[],
    init: vi.fn(),
    destroy: vi.fn()
  },
  workspaceState: {
    panelOpen: true,
    fullscreen: false,
    init: vi.fn(),
    destroy: vi.fn()
  },
  settingsGet: vi.fn(),
  settingsSet: vi.fn()
}))

vi.mock('@lobehub/ui', () => ({
  ContextMenuHost: () => null,
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children
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
  default: () => <div data-testid="document-list" />
}))
vi.mock('@renderer/components/DetailPanel', () => ({
  default: () => <div data-testid="detail-panel" />
}))
vi.mock('@renderer/components/workspace/WorkspacePanel', () => ({
  default: () => <div data-testid="workspace-panel" />
}))
vi.mock('@renderer/components/ResizeDivider', () => ({
  default: () => <div data-testid="resize-divider" />
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
    mocks.workspaceState.panelOpen = true
    mocks.workspaceState.fullscreen = false
    mocks.settingsGet.mockImplementation((_key: string, fallback: unknown) => Promise.resolve(fallback))
    mocks.settingsSet.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
  })

  it('keeps the sidebar outside the search bar and all main panels below it', async () => {
    render(<App listColumnState={null} sidebarCollapsed={false} firstRun={false} />)

    const mainLayer = screen.getByTestId('app-main-layer')
    const topBar = screen.getByTestId('app-top-bar')
    const panelLayer = screen.getByTestId('app-panel-layer')

    expect(mainLayer).toHaveClass('flex', 'flex-1', 'flex-col')
    expect(topBar.parentElement).toBe(mainLayer)
    expect(topBar).toHaveClass('drag-region', 'h-12', 'shrink-0', 'z-[60]')
    expect(panelLayer).toHaveClass('min-h-0', 'flex-1', 'overflow-hidden')
    expect(within(topBar).getByTestId('global-search')).toBeInTheDocument()
    expect(screen.getByTestId('app-sidebar-layer')).toContainElement(screen.getByTestId('sidebar'))
    expect(within(mainLayer).queryByTestId('sidebar')).not.toBeInTheDocument()
    expect(within(panelLayer).getByTestId('document-list')).toBeInTheDocument()
    expect(within(panelLayer).getByTestId('detail-panel')).toBeInTheDocument()
    expect(within(panelLayer).getByTestId('workspace-panel')).toBeInTheDocument()
    expect(within(panelLayer).getAllByTestId('resize-divider').length).toBeGreaterThan(0)
    expect(within(topBar).queryByTestId('resize-divider')).not.toBeInTheDocument()
    expect(topBar.compareDocumentPosition(panelLayer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await waitFor(() => expect(mocks.documentState.init).toHaveBeenCalled())
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
