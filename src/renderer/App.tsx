import { useState, useEffect, useCallback, useMemo } from 'react'
import clsx from 'clsx'
import { ThemeProvider, ContextMenuHost } from '@lobehub/ui'
import { theme as antdTheme } from 'antd'
import { IconContext } from '@phosphor-icons/react'
import Sidebar from './components/Sidebar'
import DocumentList from './components/DocumentList'
import DetailPanel from './components/DetailPanel'
import WorkspacePanel from './components/workspace/WorkspacePanel'
import ResizeDivider from './components/ResizeDivider'
import ConfirmDialog from './components/ConfirmDialog'
import FirstRunWizard from './components/FirstRunWizard'
import { Toast } from './components/ui'
import { useAppShortcuts } from './hooks/useAppShortcuts'
import { useTheme, AppThemeProvider } from './hooks/useTheme'
import { getAntdTokenOverrides } from './theme/tokens'
import { useDocumentStore } from './store/documentStore'
import { useWorkspaceStore } from './store/workspaceStore'
import { api } from './ipc'
import type { ListColumnState } from '../shared/ipc-types'

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 400
const DETAIL_MIN = 320
const DETAIL_MAX = 640
const WORKSPACE_MIN = 360
const WORKSPACE_MAX = 900
const DOC_LIST_MIN = 280
const SIDEBAR_DEFAULT = 224
const DETAIL_DEFAULT = 384
const WORKSPACE_DEFAULT = 480

interface AppProps {
  listColumnState: ListColumnState | null
  sidebarCollapsed: boolean
  firstRun: boolean
}

export default function App(props: AppProps) {
  return (
    <AppThemeProvider>
      <AppInner {...props} />
    </AppThemeProvider>
  )
}

function AppInner({ listColumnState, sidebarCollapsed: initialSidebarCollapsed, firstRun }: AppProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed)
  const [showWizard, setShowWizard] = useState(firstRun)
  const [rightPanelOpen, setRightPanelOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT)
  const [workspaceWidth, setWorkspaceWidth] = useState(WORKSPACE_DEFAULT)
  const { mode: themeMode, resolvedTheme } = useTheme()
  useAppShortcuts()

  const themeConfig = useMemo(
    () => ({
      token: getAntdTokenOverrides(resolvedTheme),
      algorithm:
        resolvedTheme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    }),
    [resolvedTheme]
  )

  const focusedDocId = useDocumentStore((s) => s.focusedDocId)
  const selectedIds = useDocumentStore((s) => s.selectedIds)
  const workspacePanelOpen = useWorkspaceStore((s) => s.panelOpen)
  const workspaceFullscreen = useWorkspaceStore((s) => s.fullscreen)

  useEffect(() => {
    if (focusedDocId || selectedIds.length >= 2) {
      setRightPanelOpen(true)
    }
  }, [focusedDocId, selectedIds])

  useEffect(() => {
    if (!focusedDocId && selectedIds.length === 0) {
      setRightPanelOpen(false)
    }
  }, [focusedDocId, selectedIds])

  useEffect(() => {
    const store = useDocumentStore.getState()
    store.init(listColumnState)
    return () => {
      store.destroy()
    }
  }, [])

  useEffect(() => {
    const store = useWorkspaceStore.getState()
    store.init()
    return () => {
      store.destroy()
    }
  }, [])

  useEffect(() => {
    void Promise.all([
      api.settings.get<number>('sidebarWidth', SIDEBAR_DEFAULT),
      api.settings.get<number>('detailWidth', DETAIL_DEFAULT),
      api.settings.get<number>('workspaceWidth', WORKSPACE_DEFAULT),
    ]).then(([s, d, w]) => {
      setSidebarWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, s)))
      setDetailWidth(Math.max(DETAIL_MIN, Math.min(DETAIL_MAX, d)))
      setWorkspaceWidth(Math.max(WORKSPACE_MIN, Math.min(WORKSPACE_MAX, w)))
    })
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      void api.settings.set('sidebarWidth', sidebarWidth)
    }, 500)
    return () => clearTimeout(timer)
  }, [sidebarWidth])

  useEffect(() => {
    const timer = setTimeout(() => {
      void api.settings.set('detailWidth', detailWidth)
    }, 500)
    return () => clearTimeout(timer)
  }, [detailWidth])

  useEffect(() => {
    const timer = setTimeout(() => {
      void api.settings.set('workspaceWidth', workspaceWidth)
    }, 500)
    return () => clearTimeout(timer)
  }, [workspaceWidth])

  const handleToggleSidebar = () => {
    setSidebarCollapsed((v) => {
      const next = !v
      void api.settings.set('sidebarCollapsed', next ? '1' : '0')
      return next
    })
  }

  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth((w) => Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, w + delta)))
  }, [])

  const handleDetailResize = useCallback((delta: number) => {
    setDetailWidth((w) => Math.max(DETAIL_MIN, Math.min(DETAIL_MAX, w - delta)))
  }, [])

  const handleWorkspaceResize = useCallback((delta: number) => {
    setWorkspaceWidth((w) => Math.max(WORKSPACE_MIN, Math.min(WORKSPACE_MAX, w - delta)))
  }, [])

  const sidebarStyle = sidebarCollapsed
    ? { width: '0px' }
    : { width: `${sidebarWidth}px` }

  return (
    <IconContext.Provider value={{ weight: 'regular' }}>
    <ThemeProvider
      appearance={resolvedTheme}
      themeMode={themeMode === 'system' ? 'auto' : themeMode}
      theme={themeConfig}
      enableGlobalStyle={false}
      enableCustomFonts={false}
    >
      <ContextMenuHost />
      <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
        {showWizard && <FirstRunWizard onDone={() => setShowWizard(false)} />}
        {workspaceFullscreen ? (
          <div className="relative z-40 h-full min-h-0 w-full overflow-hidden">
            <WorkspacePanel />
          </div>
        ) : (
          <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
            <div style={sidebarStyle} className="relative z-30 shrink-0">
              <div className="h-full min-h-0" style={{ padding: 'var(--sidebar-inset) 0 var(--sidebar-inset) var(--sidebar-inset)' }}>
                <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={handleToggleSidebar} />
              </div>
            </div>
            {!sidebarCollapsed && (
              <ResizeDivider onResize={handleSidebarResize} variant="gap" />
            )}
            <div
              className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              style={{ minWidth: DOC_LIST_MIN }}
            >
              <DocumentList sidebarCollapsed={sidebarCollapsed} />
            </div>
            {rightPanelOpen && (
              <ResizeDivider onResize={handleDetailResize} variant="line" />
            )}
            <div
              className={clsx(
                'relative z-20 min-w-0 overflow-hidden transition-[width] duration-200',
                rightPanelOpen ? 'border-l border-border' : 'w-0 border-0'
              )}
              style={rightPanelOpen ? { width: `${detailWidth}px`, minWidth: 0 } : { width: 0 }}
            >
              <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden">
                <DetailPanel onClose={() => setRightPanelOpen(false)} />
              </div>
            </div>
            {workspacePanelOpen && (
              <ResizeDivider onResize={handleWorkspaceResize} variant="soft" />
            )}
            {workspacePanelOpen && (
              <div
                style={{ width: `${workspaceWidth}px` }}
                className="relative z-20 min-h-0 min-w-0 overflow-hidden border-l border-border/50"
              >
                <WorkspacePanel />
              </div>
            )}
          </div>
        )}
        <ConfirmDialog />
        <Toast />
      </div>
    </ThemeProvider>
    </IconContext.Provider>
  )
}
