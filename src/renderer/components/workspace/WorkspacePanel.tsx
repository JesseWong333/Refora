import { useState, useCallback, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowsOutSimple, ArrowsInSimple, X } from '@phosphor-icons/react'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { api } from '../../ipc'
import ResizeDivider from '../ResizeDivider'
import Board from './Board'
import ChatPanel from './ChatPanel'

const CHAT_MIN = 220
const CHAT_DEFAULT = 280

export default function WorkspacePanel() {
  const { t } = useTranslation()
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const fullscreen = useWorkspaceStore((s) => s.fullscreen)
  const toggleFullscreen = useWorkspaceStore((s) => s.toggleFullscreen)
  const closePanel = useWorkspaceStore((s) => s.closePanel)

  const [chatHeight, setChatHeight] = useState(CHAT_DEFAULT)

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

  const handleChatResize = useCallback((delta: number) => {
    setChatHeight((h) => Math.max(CHAT_MIN, Math.min(chatMax, h - delta)))
  }, [chatMax])

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
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground no-drag">
          {name}
        </span>
        <div className="flex shrink-0 items-center gap-1 no-drag">
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
          <Board />
        </div>
        <ResizeDivider onResize={handleChatResize} orientation="horizontal" variant="soft" />
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
