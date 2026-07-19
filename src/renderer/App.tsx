import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import clsx from 'clsx'
import { ThemeProvider, ContextMenuHost } from '@lobehub/ui'
import { theme as antdTheme } from 'antd'
import { ChatCircleText, IconContext } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import Sidebar from './components/Sidebar'
import DocumentList from './components/DocumentList'
import DetailPanel from './components/DetailPanel'
import GlobalSearch from './components/GlobalSearch'
import WorkspacePanel from './components/workspace/WorkspacePanel'
import ChatPanel from './components/workspace/ChatPanel'
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
const WORKSPACE_MIN = 640
const WORKSPACE_MAX = 1200
const DOC_LIST_MIN = 280
const DOC_LIST_COMPACT_MIN = 240
const DOC_LIST_COMPACT_MAX = 480
const DOC_LIST_COMPACT_DEFAULT = 320
const DOC_LIST_COLLAPSE_THRESHOLD = 320
const DOC_LIST_EXPAND_THRESHOLD = 360
const SIDEBAR_DEFAULT = 224
const DETAIL_DEFAULT = 384
const WORKSPACE_DEFAULT = 800
const CHAT_MIN = 380
const CHAT_DEFAULT = 560

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
  const { t } = useTranslation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed)
  const [showWizard, setShowWizard] = useState(firstRun)
  const [rightPanelOpen, setRightPanelOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(
    () => useWorkspaceStore.getState().activeWorkspaceId !== null
  )
  const [documentListOpen, setDocumentListOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT)
  const [workspaceWidth, setWorkspaceWidth] = useState(WORKSPACE_DEFAULT)
  const [chatWidth, setChatWidth] = useState(CHAT_DEFAULT)
  const [documentListCompactWidth, setDocumentListCompactWidth] = useState(DOC_LIST_COMPACT_DEFAULT)
  const [documentListCompact, setDocumentListCompact] = useState(false)
  const documentListCompactWidthRef = useRef(DOC_LIST_COMPACT_DEFAULT)
  const documentListPanelRef = useRef<HTMLDivElement>(null)
  const workspacePanelRef = useRef<HTMLDivElement>(null)
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
  const listMode = useDocumentStore((s) => s.listMode)
  const workspacePanelOpen = useWorkspaceStore((s) => s.panelOpen)
  const workspaceFullscreen = useWorkspaceStore((s) => s.fullscreen)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const chatStreaming = useWorkspaceStore((s) => s.chatStreaming)
  const previousActiveWorkspaceIdRef = useRef(activeWorkspaceId)

  useEffect(() => {
    if (previousActiveWorkspaceIdRef.current === null && activeWorkspaceId !== null) {
      setChatOpen(true)
    }
    previousActiveWorkspaceIdRef.current = activeWorkspaceId
  }, [activeWorkspaceId])

  useEffect(() => {
    setDocumentListCompact(workspacePanelOpen)
    if (!workspacePanelOpen) setDocumentListOpen(true)
  }, [workspacePanelOpen])

  useEffect(() => {
    setDocumentListOpen(true)
  }, [listMode])

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
      api.settings.get<number>('workspaceChatWidth', CHAT_DEFAULT),
      api.settings.get<number>('documentListCompactWidth', DOC_LIST_COMPACT_DEFAULT),
    ]).then(([s, d, w, c, compactWidth]) => {
      setSidebarWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, s)))
      setDetailWidth(Math.max(DETAIL_MIN, Math.min(DETAIL_MAX, d)))
      setWorkspaceWidth(Math.max(WORKSPACE_MIN, Math.min(WORKSPACE_MAX, w)))
      setChatWidth(Math.max(CHAT_MIN, c))
      const nextCompactWidth = Math.max(
        DOC_LIST_COMPACT_MIN,
        Math.min(DOC_LIST_COMPACT_MAX, compactWidth)
      )
      documentListCompactWidthRef.current = nextCompactWidth
      setDocumentListCompactWidth(nextCompactWidth)
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

  useEffect(() => {
    const timer = setTimeout(() => {
      void api.settings.set('workspaceChatWidth', chatWidth)
    }, 500)
    return () => clearTimeout(timer)
  }, [chatWidth])

  useEffect(() => {
    const timer = setTimeout(() => {
      void api.settings.set('documentListCompactWidth', documentListCompactWidth)
    }, 500)
    return () => clearTimeout(timer)
  }, [documentListCompactWidth])

  const collapseDocumentListAtWidth = useCallback((width: number) => {
    if (!Number.isFinite(width) || width <= 0 || width > DOC_LIST_COLLAPSE_THRESHOLD) return
    const nextCompactWidth = Math.max(
      DOC_LIST_COMPACT_MIN,
      Math.min(DOC_LIST_COMPACT_MAX, width)
    )
    documentListCompactWidthRef.current = nextCompactWidth
    setDocumentListCompactWidth(nextCompactWidth)
    setDocumentListCompact(true)
  }, [])

  useEffect(() => {
    const element = documentListPanelRef.current
    if (!workspacePanelOpen || !documentListOpen || documentListCompact || !element) return
    const update = () => collapseDocumentListAtWidth(element.getBoundingClientRect().width)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [collapseDocumentListAtWidth, documentListCompact, documentListOpen, workspacePanelOpen])

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

    const currentDocumentListWidth = documentListPanelRef.current?.getBoundingClientRect().width
    if (!currentDocumentListWidth) return
    collapseDocumentListAtWidth(currentDocumentListWidth + delta)
  }, [collapseDocumentListAtWidth])

  const handleChatResize = useCallback((delta: number) => {
    setChatWidth((width) => Math.max(CHAT_MIN, width - delta))
  }, [])

  const handleDocumentListCompactResize = useCallback((delta: number) => {
    const nextWidth = Math.max(
      DOC_LIST_COMPACT_MIN,
      Math.min(DOC_LIST_COMPACT_MAX, documentListCompactWidthRef.current + delta)
    )
    documentListCompactWidthRef.current = nextWidth
    setDocumentListCompactWidth(nextWidth)
    if (nextWidth < DOC_LIST_EXPAND_THRESHOLD) return

    const currentWorkspaceWidth = workspacePanelRef.current?.getBoundingClientRect().width
    if (currentWorkspaceWidth) {
      setWorkspaceWidth(
        Math.max(WORKSPACE_MIN, Math.min(WORKSPACE_MAX, currentWorkspaceWidth - delta))
      )
    }
    setDocumentListCompact(false)
  }, [])

  const sidebarStyle = sidebarCollapsed
    ? { width: '0px' }
    : { width: `${sidebarWidth}px` }
  const chatVisible = chatOpen
  const chatToggleLabel = chatVisible
    ? t('workspace.chat.closePanel')
    : t('workspace.chat.openPanel')
  const workspaceNeedsLeadingBorder = rightPanelOpen || (documentListOpen && !documentListCompact)
  const chatPane = chatVisible ? (
    <>
      <ResizeDivider onResize={handleChatResize} orientation="vertical" variant="line" />
      <div
        style={{ width: `min(${chatWidth}px, 95%)` }}
        className="relative z-20 min-h-0 min-w-0 shrink-0 overflow-hidden bg-background"
        data-testid="app-chat-panel"
      >
        <ChatPanel onClose={() => setChatOpen(false)} />
      </div>
    </>
  ) : null

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
      <div className="app-root relative isolate flex h-screen w-screen overflow-hidden bg-background text-foreground">
        {showWizard && <FirstRunWizard onDone={() => setShowWizard(false)} />}
        {!workspaceFullscreen && !sidebarCollapsed && (
          <div style={sidebarStyle} className="relative z-30 shrink-0" data-testid="app-sidebar-layer">
            <div className="sidebar-vibrancy-frame" aria-hidden="true">
              <div className="sidebar-vibrancy-frame__mask" />
            </div>
            <div className="relative z-10 h-full min-h-0" style={{ padding: 'var(--sidebar-inset) 0 var(--sidebar-inset) var(--sidebar-inset)' }}>
              <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={handleToggleSidebar} />
            </div>
          </div>
        )}
        {!workspaceFullscreen && !sidebarCollapsed && (
          <ResizeDivider onResize={handleSidebarResize} variant="gap" />
        )}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" data-testid="app-main-layer">
          {!showWizard && (
            <div
              className="drag-region relative h-12 w-full shrink-0 bg-background"
              data-testid="app-top-bar"
            >
              {!workspaceFullscreen && sidebarCollapsed && (
                <Sidebar collapsed onToggleCollapse={handleToggleSidebar} />
              )}
              <GlobalSearch
                documentListOpen={documentListOpen}
                onOpenChat={() => setChatOpen(true)}
              />
              <div className="no-drag absolute right-3 top-2.5 z-[60] flex items-center">
                <button
                  type="button"
                  className={clsx(
                    'flex h-7 w-7 items-center justify-center rounded-lg transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40',
                    chatVisible
                      ? 'bg-active text-accent hover:bg-hover'
                      : 'text-muted hover:bg-hover hover:text-foreground'
                  )}
                  onClick={() => setChatOpen((open) => !open)}
                  disabled={chatStreaming && chatVisible}
                  title={chatToggleLabel}
                  aria-label={chatToggleLabel}
                  aria-pressed={chatVisible}
                >
                  <ChatCircleText className="h-4 w-4" />
                </button>
              </div>
              <div
                className="pointer-events-none absolute bottom-0 left-0 right-0 h-px"
                style={{ background: 'linear-gradient(to right, var(--color-background), var(--color-border) 100px)' }}
                data-testid="app-top-bar-separator"
              />
            </div>
          )}
          <div
            className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
            data-testid="app-panel-layer"
          >
            {workspaceFullscreen ? (
              <div className="relative z-40 flex h-full min-h-0 w-full min-w-0 overflow-hidden">
                <div className="min-h-0 min-w-0 flex-1 overflow-hidden" data-testid="app-workspace-panel">
                  <WorkspacePanel />
                </div>
                {chatPane}
              </div>
            ) : (
              <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
                <div
                  className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
                  data-testid="app-primary-panels"
                >
                  {documentListOpen && (
                    <div
                      ref={documentListPanelRef}
                      className={clsx(
                        'relative z-10 flex min-h-0 min-w-0 flex-col overflow-hidden transition-[width] duration-200',
                        workspacePanelOpen && documentListCompact ? 'shrink-0' : 'flex-1'
                      )}
                      style={
                        workspacePanelOpen && documentListCompact
                          ? { width: `${documentListCompactWidth}px`, minWidth: DOC_LIST_COMPACT_MIN }
                          : { minWidth: DOC_LIST_MIN }
                      }
                      data-testid="app-document-list-panel"
                    >
                      <DocumentList
                        compact={workspacePanelOpen && documentListCompact}
                        onClose={workspacePanelOpen && documentListCompact
                          ? () => setDocumentListOpen(false)
                          : undefined}
                      />
                    </div>
                  )}
                  {documentListOpen && (rightPanelOpen || (workspacePanelOpen && documentListCompact)) && (
                    <ResizeDivider
                      onResize={
                        workspacePanelOpen && documentListCompact
                          ? handleDocumentListCompactResize
                          : handleDetailResize
                      }
                      variant="line"
                    />
                  )}
                  <div
                    className={clsx(
                      'relative z-20 min-w-0 overflow-hidden transition-[width] duration-200',
                      !rightPanelOpen && 'w-0'
                    )}
                    style={rightPanelOpen ? { width: `${detailWidth}px`, minWidth: 0 } : { width: 0 }}
                  >
                    <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden">
                      <DetailPanel onClose={() => setRightPanelOpen(false)} />
                    </div>
                  </div>
                  {workspacePanelOpen && !documentListCompact && (
                    <ResizeDivider onResize={handleWorkspaceResize} variant="soft" />
                  )}
                  {workspacePanelOpen && (
                    <div
                      ref={workspacePanelRef}
                      style={documentListCompact ? undefined : { width: `${workspaceWidth}px` }}
                      className={clsx(
                        'relative z-20 min-h-0 min-w-0 overflow-hidden',
                        workspaceNeedsLeadingBorder && 'border-l border-border/50',
                        documentListCompact ? 'flex-1' : 'shrink-0'
                      )}
                      data-testid="app-workspace-panel"
                    >
                      <WorkspacePanel />
                    </div>
                  )}
                </div>
                {chatPane}
              </div>
            )}
          </div>
        </div>
        <ConfirmDialog />
        <Toast />
      </div>
    </ThemeProvider>
    </IconContext.Provider>
  )
}
