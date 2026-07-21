import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowsOutSimple, ArrowsInSimple, FilePlus, FolderOpen, NotePencil, Sticker } from '@phosphor-icons/react'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { PanelTabHeader } from '../ui'
import Board, {
  type BoardHandle,
  type WorkspaceMarkdownCard,
  type WorkspaceMarkdownCardMode
} from './Board'
import WorkspaceMarkdownView from './WorkspaceMarkdownView'
import WorkspaceNavigationControls from './WorkspaceNavigationControls'
import { aiSummaryMarkdown } from '../../utils/workspaceCardMarkdown'

type ActiveMarkdownCard = WorkspaceMarkdownCard & { mode: WorkspaceMarkdownCardMode }

export default function WorkspacePanel() {
  const { t } = useTranslation()
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const fullscreen = useWorkspaceStore((s) => s.fullscreen)
  const reports = useWorkspaceStore((s) => s.reports)
  const notes = useWorkspaceStore((s) => s.notes)
  const markdownCardRequest = useWorkspaceStore((s) => s.markdownCardRequest)
  const toggleFullscreen = useWorkspaceStore((s) => s.toggleFullscreen)
  const closePanel = useWorkspaceStore((s) => s.closePanel)
  const clearMarkdownCardRequest = useWorkspaceStore((s) => s.clearMarkdownCardRequest)
  const updateNote = useWorkspaceStore((s) => s.updateNote)
  const updateReport = useWorkspaceStore((s) => s.updateReport)

  const [activeMarkdownCard, setActiveMarkdownCard] = useState<ActiveMarkdownCard | null>(null)
  const [forwardMarkdownCard, setForwardMarkdownCard] = useState<ActiveMarkdownCard | null>(null)
  const boardRef = useRef<BoardHandle | null>(null)

  useEffect(() => {
    setActiveMarkdownCard(null)
    setForwardMarkdownCard(null)
  }, [activeWorkspaceId])

  useEffect(() => {
    if (!markdownCardRequest) return
    setActiveMarkdownCard({ ...markdownCardRequest, mode: 'read' })
    setForwardMarkdownCard(null)
    clearMarkdownCardRequest()
  }, [clearMarkdownCardRequest, markdownCardRequest])

  const handleOpenMarkdownCard = useCallback((
    card: WorkspaceMarkdownCard,
    mode: WorkspaceMarkdownCardMode = 'read'
  ) => {
    setActiveMarkdownCard({ ...card, mode })
    setForwardMarkdownCard(null)
  }, [])

  const handleBackToBoard = useCallback(() => {
    if (!activeMarkdownCard) return
    setForwardMarkdownCard(activeMarkdownCard)
    setActiveMarkdownCard(null)
  }, [activeMarkdownCard])

  const handleForwardToReader = useCallback(() => {
    if (!forwardMarkdownCard) return
    setActiveMarkdownCard(forwardMarkdownCard)
    setForwardMarkdownCard(null)
  }, [forwardMarkdownCard])

  const handleOpenSandbox = useCallback(() => {
    if (!activeWorkspaceId) return
    void window.api.workspaces.openSandbox(activeWorkspaceId).catch(() => undefined)
  }, [activeWorkspaceId])

  const active = workspaces.find((w) => w.id === activeWorkspaceId)
  const name = active?.name ?? t('workspace.untitled')
  const activeNote = activeMarkdownCard?.kind === 'note'
    ? notes.find((note) => note.id === activeMarkdownCard.id) ?? null
    : null
  const activeReport = activeMarkdownCard?.kind === 'report'
    ? reports.find((report) => report.id === activeMarkdownCard.id) ?? null
    : null
  const activeSummary = activeMarkdownCard?.kind === 'summary'
    ? activeMarkdownCard
    : null

  let markdownView: ReactNode = null
  if (activeNote) {
    markdownView = (
      <WorkspaceMarkdownView
        key={`note:${activeNote.id}`}
        kind="note"
        id={activeNote.id}
        title={activeNote.title}
        contentMd={activeNote.contentMd}
        timestamp={activeNote.updatedAt}
        initialMode={activeMarkdownCard?.mode}
        fullscreen={fullscreen}
        onBack={handleBackToBoard}
        onClose={closePanel}
        onUpdate={updateNote}
      />
    )
  } else if (activeReport) {
    markdownView = (
      <WorkspaceMarkdownView
        key={`report:${activeReport.id}`}
        kind="report"
        id={activeReport.id}
        title={activeReport.title}
        contentMd={activeReport.contentMd}
        timestamp={activeReport.createdAt}
        initialMode={activeMarkdownCard?.mode}
        fullscreen={fullscreen}
        onBack={handleBackToBoard}
        onClose={closePanel}
        onUpdate={updateReport}
      />
    )
  } else if (activeSummary) {
    markdownView = (
      <WorkspaceMarkdownView
        key={'summary:' + activeSummary.doc.id + ':' + activeSummary.summary.updatedAt}
        kind="summary"
        id={activeSummary.doc.id}
        title={activeSummary.doc.title || activeSummary.doc.fileName}
        contentMd={aiSummaryMarkdown(activeSummary.summary)}
        timestamp={activeSummary.summary.updatedAt}
        fullscreen={fullscreen}
        onBack={handleBackToBoard}
        onClose={closePanel}
      />
    )
  }

  return (
    <div
      className={`flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background ${
        fullscreen ? 'workspace-fullscreen' : ''
      }`}
    >
      {!markdownView && (
        <PanelTabHeader
          title={name}
          onClose={closePanel}
          closeLabel={t('workspace.close')}
          leading={
            <WorkspaceNavigationControls
              onForward={forwardMarkdownCard ? handleForwardToReader : undefined}
            />
          }
          actions={
            <>
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
                onClick={handleOpenSandbox}
                disabled={!activeWorkspaceId}
                title={t('workspace.openSandbox')}
                aria-label={t('workspace.openSandbox')}
              >
                <FolderOpen className="h-4 w-4" />
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
            </>
          }
        />
      )}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {markdownView ?? <Board ref={boardRef} onOpenMarkdownCard={handleOpenMarkdownCard} />}
      </div>
    </div>
  )
}
