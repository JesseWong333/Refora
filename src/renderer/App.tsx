import { useState, useEffect, useCallback } from 'react'
import clsx from 'clsx'
import { ThemeProvider, ContextMenuHost } from '@lobehub/ui'
import { theme as antdTheme } from 'antd'
import Sidebar from './components/Sidebar'
import DocumentList from './components/DocumentList'
import DetailPanel from './components/DetailPanel'
import WorkspacePanel from './components/workspace/WorkspacePanel'
import ResizeDivider from './components/ResizeDivider'
import ConfirmDialog from './components/ConfirmDialog'
import FirstRunWizard from './components/FirstRunWizard'
import { useAppShortcuts } from './hooks/useAppShortcuts'
import { useTheme, AppThemeProvider } from './hooks/useTheme'
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
  const [sidebarWidth, setSidebarWidth] = useState(224)
  const [detailWidth, setDetailWidth] = useState(384)
  const [workspaceWidth, setWorkspaceWidth] = useState(480)
  const { mode: themeMode, resolvedTheme } = useTheme()
  useAppShortcuts()

  const isDark = resolvedTheme === 'dark'

  const tokenOverrides = {
    colorPrimary: isDark ? '#1f7ae0' : '#007aff',
    colorPrimaryHover: isDark ? '#3a8de8' : '#0062cc',
    colorBgLayout: isDark ? '#141416' : '#f5f5f5',
    colorBgContainer: isDark ? '#1e1e20' : '#ffffff',
    colorBgElevated: isDark ? '#28282a' : '#f0f0f0',
    colorBgSpotlight: isDark ? '#28282a' : '#f0f0f0',
    colorText: isDark ? '#d4d4d4' : '#1d1d1f',
    colorTextSecondary: isDark ? '#9a9a9a' : '#6e6e73',
    colorTextTertiary: isDark ? '#6e6e73' : '#8e8e93',
    colorBorder: isDark ? '#3a3a3c' : '#d2d2d7',
    colorBorderSecondary: isDark ? '#2d2d2d' : '#e5e5ea',
    colorFill: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    colorFillSecondary: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    colorFillTertiary: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
    colorError: isDark ? '#ff6b5b' : '#ff3b30',
    colorSuccess: isDark ? '#4ade80' : '#34c759',
    colorWarning: isDark ? '#cca700' : '#ff9f0a',
    borderRadius: 10,
    borderRadiusLG: 14,
    borderRadiusSM: 6,
    fontSize: 13,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', Helvetica, Arial, sans-serif",
    controlHeight: 32,
    controlHeightSM: 28,
  }

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
    <ThemeProvider
      appearance={resolvedTheme}
      themeMode={themeMode === 'system' ? 'auto' : themeMode}
      theme={{
        token: tokenOverrides,
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      }}
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
            <div style={sidebarStyle} className="relative z-30 shrink-0 overflow-hidden">
              <div className="h-full min-h-0 py-0">
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
                'relative z-20 shrink-0 overflow-hidden transition-[width] duration-200',
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
                className="relative z-20 min-h-0 min-w-0 shrink-0 overflow-hidden border-l border-border/50"
              >
                <WorkspacePanel />
              </div>
            )}
          </div>
        )}
        <ConfirmDialog />
      </div>
    </ThemeProvider>
  )
}
