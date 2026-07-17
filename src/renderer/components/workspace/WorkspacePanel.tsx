import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowsOutSimple, ArrowsInSimple, CaretDown, Check, FilePlus, NotePencil, SquaresFour, Sticker, X } from '@phosphor-icons/react'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useClickOutside } from '../../hooks/useClickOutside'
import { api } from '../../ipc'
import ResizeDivider from '../ResizeDivider'
import Board, {
  type BoardHandle,
  type WorkspaceMarkdownCard,
  type WorkspaceMarkdownCardMode
} from './Board'
import ChatPanel from './ChatPanel'
import WorkspaceMarkdownView from './WorkspaceMarkdownView'
import { aiSummaryMarkdown } from '../../utils/workspaceCardMarkdown'

const CHAT_MIN = 220
const CHAT_DEFAULT = 280

type ActiveMarkdownCard = WorkspaceMarkdownCard & { mode: WorkspaceMarkdownCardMode }

export default function WorkspacePanel() {
  const { t } = useTranslation()
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace)
  const fullscreen = useWorkspaceStore((s) => s.fullscreen)
  const chatStreaming = useWorkspaceStore((s) => s.chatStreaming)
  const reports = useWorkspaceStore((s) => s.reports)
  const notes = useWorkspaceStore((s) => s.notes)
  const toggleFullscreen = useWorkspaceStore((s) => s.toggleFullscreen)
  const closePanel = useWorkspaceStore((s) => s.closePanel)
  const updateNote = useWorkspaceStore((s) => s.updateNote)
  const updateReport = useWorkspaceStore((s) => s.updateReport)

  const [chatHeight, setChatHeight] = useState(CHAT_DEFAULT)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [activeMarkdownCard, setActiveMarkdownCard] = useState<ActiveMarkdownCard | null>(null)
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null)
  const boardRef = useRef<BoardHandle | null>(null)

  useClickOutside(workspaceMenuRef, () => setWorkspaceMenuOpen(false), workspaceMenuOpen)

  const chatMax = useMemo(() => {
    if (typeof window === 'undefined') return 520
    return Math.max(CHAT_MIN, window.innerHeight - 48 - 24)
  }, [])

  useEffect(() => {
    void api.settings.get<number>('workspaceChatHeight', CHAT_DEFAULT).then((h) => {
      setChatHeight(Math.max(CHAT_MIN, Math.min(chatMax, h)))
    })
  }, [chatMax])

  useEffect(() => {
    const timer = setTimeout(() => {
      void api.settings.set('workspaceChatHeight', chatHeight)
    }, 500)
    return () => clearTimeout(timer)
  }, [chatHeight])

  useEffect(() => {
    setActiveMarkdownCard(null)
  }, [activeWorkspaceId])

  const handleChatResize = useCallback((delta: number) => {
    setChatHeight((h) => Math.max(CHAT_MIN, Math.min(chatMax, h - delta)))
  }, [chatMax])

  const handleOpenMarkdownCard = useCallback((
    card: WorkspaceMarkdownCard,
    mode: WorkspaceMarkdownCardMode = 'read'
  ) => {
    setWorkspaceMenuOpen(false)
    setActiveMarkdownCard({ ...card, mode })
  }, [])

  const isMac = document.documentElement.dataset.platform === 'mac'
  const active = workspaces.find((w) => w.id === activeWorkspaceId)
  const name = active?.name ?? t('workspace.untitled')
  const padTrafficLights = isMac && fullscreen
  const activeNote = activeMarkdownCard?.kind === 'note'
    ? notes.find((note) => note.id === activeMarkdownCard.id) ?? null
    : null
  const activeReport = activeMarkdownCard?.kind === 'report'
    ? reports.find((report) => report.id === activeMarkdownCard.id) ?? null
    : null
  const activeSummary = activeMarkdownCard?.kind === 'summary'
    ? activeMarkdownCard
    : null

  if (activeNote) {
    return (
      <WorkspaceMarkdownView
        key={`note:${activeNote.id}`}
        kind="note"
        id={activeNote.id}
        title={activeNote.title}
        contentMd={activeNote.contentMd}
        timestamp={activeNote.updatedAt}
        initialMode={activeMarkdownCard?.mode}
        fullscreen={fullscreen}
        padTrafficLights={padTrafficLights}
        onBack={() => setActiveMarkdownCard(null)}
        onUpdate={updateNote}
      />
    )
  }

  if (activeReport) {
    return (
      <WorkspaceMarkdownView
        key={`report:${activeReport.id}`}
        kind="report"
        id={activeReport.id}
        title={activeReport.title}
        contentMd={activeReport.contentMd}
        timestamp={activeReport.createdAt}
        initialMode={activeMarkdownCard?.mode}
        fullscreen={fullscreen}
        padTrafficLights={padTrafficLights}
        onBack={() => setActiveMarkdownCard(null)}
        onUpdate={updateReport}
      />
    )
  }

  if (activeSummary) {
    return (
      <WorkspaceMarkdownView
        key={'summary:' + activeSummary.doc.id + ':' + activeSummary.summary.updatedAt}
        kind="summary"
        id={activeSummary.doc.id}
        title={activeSummary.doc.title || activeSummary.doc.fileName}
        contentMd={aiSummaryMarkdown(activeSummary.summary)}
        timestamp={activeSummary.summary.updatedAt}
        fullscreen={fullscreen}
        padTrafficLights={padTrafficLights}
        onBack={() => setActiveMarkdownCard(null)}
      />
    )
  }

  return (
    <div
      className={`flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background ${
        fullscreen ? 'workspace-fullscreen' : ''
      }`}
    >
      <div
        className={`drag-region relative z-30 flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3 ${
          padTrafficLights ? 'pl-[86px]' : ''
        }`}
      >
        <div ref={workspaceMenuRef} className="relative flex min-w-0 flex-1 items-center gap-1">
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {name}
          </span>
          <button
            type="button"
            className="sidebar-header-btn no-drag h-6 w-6 shrink-0"
            onClick={() => setWorkspaceMenuOpen((open) => !open)}
            disabled={workspaces.length < 2 || chatStreaming}
            title={t('workspace.switchWorkspace')}
            aria-label={t('workspace.switchWorkspace')}
            aria-haspopup="listbox"
            aria-expanded={workspaceMenuOpen}
          >
            <CaretDown className={`h-3.5 w-3.5 transition-transform ${workspaceMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          {workspaceMenuOpen && (
            <div
              className="no-drag absolute left-0 top-full z-50 mt-1 max-h-64 w-64 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-border bg-panel p-1.5 shadow-lg"
              role="listbox"
              aria-label={t('workspace.switchWorkspace')}
              onKeyDown={(e) => {
                const options = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="option"]:not(:disabled)'))
                const currentIndex = options.findIndex((option) => option === document.activeElement)
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  options[Math.min(currentIndex + 1, options.length - 1)]?.focus()
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  options[Math.max(currentIndex - 1, 0)]?.focus()
                }
              }}
            >
              {workspaces.map((workspace) => {
                const isActive = workspace.id === activeWorkspaceId
                return (
                  <button
                    key={workspace.id}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition-colors duration-150 hover:bg-hover ${
                      isActive ? 'bg-active text-accent' : 'text-foreground'
                    }`}
                    onClick={() => {
                      if (!isActive) setActiveWorkspace(workspace.id)
                      setWorkspaceMenuOpen(false)
                    }}
                  >
                    <SquaresFour className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                    {isActive && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 no-drag">
          <button
            type="button"
            className="sidebar-header-btn"
            onClick={() => boardRef.current?.addFiles()}
            disabled={!activeWorkspaceId}
            title={t('workspace.assetAdd')}
            aria-label={t('workspace.assetAdd')}
          >
            <FilePlus className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="sidebar-header-btn"
            onClick={() => boardRef.current?.createNote('markdown')}
            disabled={!activeWorkspaceId}
            title={t('workspace.createNote')}
            aria-label={t('workspace.createNote')}
          >
            <NotePencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="sidebar-header-btn"
            onClick={() => boardRef.current?.createNote('plain')}
            disabled={!activeWorkspaceId}
            title={t('workspace.createStickyNote')}
            aria-label={t('workspace.createStickyNote')}
          >
            <Sticker className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="sidebar-header-btn"
            onClick={toggleFullscreen}
            title={fullscreen ? t('workspace.exitFullscreen') : t('workspace.enterFullscreen')}
            aria-label={fullscreen ? t('workspace.exitFullscreen') : t('workspace.enterFullscreen')}
          >
            {fullscreen ? <ArrowsInSimple className="h-4 w-4" /> : <ArrowsOutSimple className="h-4 w-4" />}
          </button>
          {!fullscreen && (
            <button
              type="button"
              className="sidebar-header-btn"
              onClick={closePanel}
              disabled={chatStreaming}
              title={t('workspace.close')}
              aria-label={t('workspace.close')}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <Board ref={boardRef} onOpenMarkdownCard={handleOpenMarkdownCard} />
        </div>
        <ResizeDivider onResize={handleChatResize} orientation="horizontal" variant="line" />
        <div
          style={{ height: `${chatHeight}px` }}
          className="min-h-0 shrink-0 overflow-hidden bg-background"
        >
          <ChatPanel />
        </div>
      </div>
    </div>
  )
}
