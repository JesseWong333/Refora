import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { useWorkspaceStore } from '../../store/workspaceStore'
import ResizeDivider from '../ResizeDivider'
import Board from './Board'
import ChatPanel from './ChatPanel'

const CHAT_MIN = 280
const CHAT_MAX = 520

export default function WorkspacePanel() {
  const { t } = useTranslation()
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const fullscreen = useWorkspaceStore((s) => s.fullscreen)
  const toggleFullscreen = useWorkspaceStore((s) => s.toggleFullscreen)
  const closePanel = useWorkspaceStore((s) => s.closePanel)

  const [chatWidth, setChatWidth] = useState(360)

  const handleChatResize = useCallback((delta: number) => {
    setChatWidth((w) => Math.max(CHAT_MIN, Math.min(CHAT_MAX, w - delta)))
  }, [])

  const isMac = document.documentElement.dataset.platform === 'mac'
  const active = workspaces.find((w) => w.id === activeWorkspaceId)
  const name = active?.name ?? t('workspace.untitled')

  return (
    <div className="flex h-full w-full flex-col">
      <div
        className={`drag-region flex h-10 shrink-0 items-center px-2 ${isMac ? 'pl-[68px]' : ''}`}
      >
        <span className="truncate text-sm font-medium text-foreground">{name}</span>
        <div className="ml-auto flex items-center gap-1 no-drag">
          <button
            className="sidebar-header-btn"
            onClick={toggleFullscreen}
            title={fullscreen ? t('workspace.exitFullscreen') : t('workspace.enterFullscreen')}
            aria-label={fullscreen ? t('workspace.exitFullscreen') : t('workspace.enterFullscreen')}
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            className="sidebar-header-btn"
            onClick={closePanel}
            title={t('workspace.close')}
            aria-label={t('workspace.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <Board />
        </div>
        <ResizeDivider onResize={handleChatResize} variant="line" />
        <div style={{ width: `${chatWidth}px` }} className="shrink-0 border-l border-border">
          <ChatPanel />
        </div>
      </div>
    </div>
  )
}
