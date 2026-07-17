import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  WORKSPACE_CARD_DEFAULT_HEIGHT,
  WORKSPACE_CARD_DEFAULT_WIDTH,
  WORKSPACE_CARD_MAX_HEIGHT,
  WORKSPACE_CARD_MAX_WIDTH,
  WORKSPACE_CARD_MIN_HEIGHT,
  WORKSPACE_CARD_MIN_WIDTH
} from '../../../shared/ipc-types'
import type { WorkspaceConnectionAnchor } from '../../../shared/ipc-types'

export interface CardSize {
  width: number
  height: number
}

export interface CardPosition {
  x: number
  y: number
  zIndex: number
}

interface ResizableCardProps {
  sizeKey: string
  size: CardSize
  position: CardPosition
  scale: number
  frontZIndex: number
  onSizeChange: (sizeKey: string, size: CardSize) => void
  onSizeCommit: (sizeKey: string, size: CardSize) => void
  onPositionChange: (sizeKey: string, position: CardPosition) => void
  onPositionCommit: (sizeKey: string, position: CardPosition) => void
  onConnectionStart?: (
    sizeKey: string,
    anchor: WorkspaceConnectionAnchor,
    event: React.MouseEvent<HTMLButtonElement>
  ) => void
  connectionLabel?: string
  moveLabel?: string
  children: ReactNode
  className?: string
}

type Edge = 'e' | 's' | 'se'
const DRAG_START_DISTANCE = 5

export default function ResizableCard({
  sizeKey,
  size,
  position,
  scale,
  frontZIndex,
  onSizeChange,
  onSizeCommit,
  onPositionChange,
  onPositionCommit,
  onConnectionStart,
  connectionLabel,
  moveLabel,
  children,
  className = ''
}: ResizableCardProps) {
  const resizeStartRef = useRef({ x: 0, y: 0, w: 0, h: 0, edge: 'se' as Edge })
  const moveStartRef = useRef({ x: 0, y: 0, cardX: 0, cardY: 0, zIndex: 0 })
  const latestSizeRef = useRef(size)
  const latestPositionRef = useRef(position)
  const moveCleanupRef = useRef<(() => void) | null>(null)
  const suppressClickUntilRef = useRef(0)
  const [resizing, setResizing] = useState(false)
  const [moving, setMoving] = useState(false)

  useEffect(() => {
    return () => {
      moveCleanupRef.current?.()
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const startPointerDrag = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('button, a, input, textarea, select, audio, video, [contenteditable="true"], [role="button"], [role="link"], [data-card-resize]')) return
    moveCleanupRef.current?.()
    moveStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      cardX: position.x,
      cardY: position.y,
      zIndex: frontZIndex
    }
    let activated = false

    const cleanup = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (moveCleanupRef.current === cleanup) moveCleanupRef.current = null
    }

    const activate = () => {
      activated = true
      const initial = { x: position.x, y: position.y, zIndex: frontZIndex }
      latestPositionRef.current = initial
      onPositionChange(sizeKey, initial)
      setMoving(true)
      window.getSelection()?.removeAllRanges()
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
    }

    const onMove = (ev: MouseEvent) => {
      if (!activated) {
        if (Math.hypot(ev.clientX - moveStartRef.current.x, ev.clientY - moveStartRef.current.y) < DRAG_START_DISTANCE) return
        activate()
      }
      ev.preventDefault()
      const next = {
        x: Math.round(moveStartRef.current.cardX + (ev.clientX - moveStartRef.current.x) / scale),
        y: Math.round(moveStartRef.current.cardY + (ev.clientY - moveStartRef.current.y) / scale),
        zIndex: moveStartRef.current.zIndex
      }
      latestPositionRef.current = next
      onPositionChange(sizeKey, next)
    }

    const onUp = () => {
      const shouldCommit = activated
      cleanup()
      if (!shouldCommit) return
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setMoving(false)
      suppressClickUntilRef.current = Date.now() + 250
      onPositionCommit(sizeKey, latestPositionRef.current)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [frontZIndex, onPositionChange, onPositionCommit, position, scale, sizeKey])

  const startResize = useCallback(
    (edge: Edge, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      resizeStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        w: size.width,
        h: size.height,
        edge
      }
      latestSizeRef.current = size
      setResizing(true)

      const onMove = (ev: MouseEvent) => {
        const dx = (ev.clientX - resizeStartRef.current.x) / scale
        const dy = (ev.clientY - resizeStartRef.current.y) / scale
        let nextW = resizeStartRef.current.w
        let nextH = resizeStartRef.current.h
        if (resizeStartRef.current.edge === 'e' || resizeStartRef.current.edge === 'se') {
          nextW = Math.max(WORKSPACE_CARD_MIN_WIDTH, Math.min(WORKSPACE_CARD_MAX_WIDTH, Math.round(resizeStartRef.current.w + dx)))
        }
        if (resizeStartRef.current.edge === 's' || resizeStartRef.current.edge === 'se') {
          nextH = Math.max(WORKSPACE_CARD_MIN_HEIGHT, Math.min(WORKSPACE_CARD_MAX_HEIGHT, Math.round(resizeStartRef.current.h + dy)))
        }
        latestSizeRef.current = { width: nextW, height: nextH }
        onSizeChange(sizeKey, latestSizeRef.current)
      }

      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        setResizing(false)
        onSizeCommit(sizeKey, latestSizeRef.current)
      }

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      document.body.style.cursor =
        edge === 'e' ? 'ew-resize' : edge === 's' ? 'ns-resize' : 'nwse-resize'
      document.body.style.userSelect = 'none'
    },
    [onSizeChange, onSizeCommit, scale, size, sizeKey]
  )

  const moveByKeyboard = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const step = e.shiftKey ? 50 : 10
    let next: CardPosition | null = null
    if (e.key === 'ArrowLeft') next = { x: position.x - step, y: position.y, zIndex: frontZIndex }
    if (e.key === 'ArrowRight') next = { x: position.x + step, y: position.y, zIndex: frontZIndex }
    if (e.key === 'ArrowUp') next = { x: position.x, y: position.y - step, zIndex: frontZIndex }
    if (e.key === 'ArrowDown') next = { x: position.x, y: position.y + step, zIndex: frontZIndex }
    if (!next) return
    e.preventDefault()
    onPositionChange(sizeKey, next)
    onPositionCommit(sizeKey, next)
  }

  return (
    <div
      data-workspace-card
      data-workspace-card-id={sizeKey}
      role="group"
      tabIndex={0}
      aria-label={moveLabel}
      title={moveLabel}
      className={`resizable-card group/card absolute outline-none focus-visible:ring-2 focus-visible:ring-accent ${moving ? 'cursor-grabbing' : ''} ${className}`}
      onMouseDown={startPointerDrag}
      onKeyDown={moveByKeyboard}
      onClickCapture={(e) => {
        if (Date.now() >= suppressClickUntilRef.current) return
        e.preventDefault()
        e.stopPropagation()
      }}
      style={{
        left: position.x,
        top: position.y,
        zIndex: resizing || moving ? Math.max(position.zIndex, frontZIndex) + 100000 : position.zIndex,
        width: size.width,
        height: size.height,
        minWidth: WORKSPACE_CARD_MIN_WIDTH,
        minHeight: WORKSPACE_CARD_MIN_HEIGHT
      }}
    >
      <div className="h-full w-full">{children}</div>
      {onConnectionStart && (['top', 'right', 'bottom', 'left'] as const).map((anchor) => (
        <button
          key={anchor}
          type="button"
          data-connection-handle={anchor}
          className={`workspace-connection-handle workspace-connection-handle--${anchor}`}
          aria-label={connectionLabel}
          title={connectionLabel}
          onMouseDown={(event) => onConnectionStart(sizeKey, anchor, event)}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        />
      ))}
      <div
        data-card-resize
        className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize opacity-0 transition-opacity group-hover/card:opacity-100"
        onMouseDown={(e) => startResize('e', e)}
        aria-hidden
      />
      <div
        data-card-resize
        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 transition-opacity group-hover/card:opacity-100"
        onMouseDown={(e) => startResize('s', e)}
        aria-hidden
      />
      <div
        data-card-resize
        className="absolute bottom-0 right-0 h-3.5 w-3.5 cursor-nwse-resize opacity-0 transition-opacity group-hover/card:opacity-100"
        onMouseDown={(e) => startResize('se', e)}
        aria-hidden
      >
        <span className="absolute bottom-1 right-1 h-2 w-2 rounded-sm border-b-2 border-r-2 border-muted" />
      </div>
    </div>
  )
}

export function defaultCardSize(): CardSize {
  return { width: WORKSPACE_CARD_DEFAULT_WIDTH, height: WORKSPACE_CARD_DEFAULT_HEIGHT }
}

export function clampCardSize(size: Partial<CardSize> | undefined): CardSize {
  return {
    width: Math.max(
      WORKSPACE_CARD_MIN_WIDTH,
      Math.min(WORKSPACE_CARD_MAX_WIDTH, size?.width ?? WORKSPACE_CARD_DEFAULT_WIDTH)
    ),
    height: Math.max(
      WORKSPACE_CARD_MIN_HEIGHT,
      Math.min(WORKSPACE_CARD_MAX_HEIGHT, size?.height ?? WORKSPACE_CARD_DEFAULT_HEIGHT)
    )
  }
}
