import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowsOutSimple, ArrowsInSimple, CaretDown, Check, FilePlus, NotePencil, SquaresFour, Sticker, X } from '@phosphor-icons/react'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useClickOutside } from '../../hooks/useClickOutside'
import { api } from '../../ipc'
import ResizeDivider from '../ResizeDivider'
import Board, { type BoardHandle } from './Board'
import ChatPanel from './ChatPanel'

const CHAT_MIN = 300
const CHAT_MAX = 560
const CHAT_DEFAULT = 380

export default function WorkspacePanel() {
  const { t } = useTranslation()
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace)
  const fullscreen = useWorkspaceStore((s) => s.fullscreen)
  const chatStreaming = useWorkspaceStore((s) => s.chatStreaming)
  const toggleFullscreen = useWorkspaceStore((s) => s.toggleFullscreen)
  const closePanel = useWorkspaceStore((s) => s.closePanel)

  const [chatWidth, setChatWidth] = useState(CHAT_DEFAULT)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null)
  const boardRef = useRef<BoardHandle | null>(null)

  useClickOutside(workspaceMenuRef, () => setWorkspaceMenuOpen(false), workspaceMenuOpen)

  useEffect(() => {
    void api.settings.get<number>('workspaceChatWidth', CHAT_DEFAULT).then((width) => {
      setChatWidth(Math.max(CHAT_MIN, Math.min(CHAT_MAX, width)))
    })
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      void api.settings.set('workspaceChatWidth', chatWidth)
    }, 500)
    return () => clearTimeout(timer)
  }, [chatWidth])

  const handleChatResize = useCallback((delta: number) => {
    setChatWidth((width) => Math.max(CHAT_MIN, Math.min(CHAT_MAX, width - delta)))
  }, [])

  const isMac = document.documentElement.dataset.platform === 'mac'
  const active = workspaces.find((w) => w.id === activeWorkspaceId)
  const name = active?.name ?? t('workspace.untitled')
  const padTrafficLights = isMac && fullscreen

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
      <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <Board ref={boardRef} />
        </div>
        <ResizeDivider onResize={handleChatResize} orientation="vertical" variant="line" />
        <div
          style={{ width: `min(${chatWidth}px, 48%)` }}
          className="min-h-0 min-w-0 shrink-0 overflow-hidden bg-background"
        >
          <ChatPanel />
        </div>
      </div>
    </div>
  )
}
