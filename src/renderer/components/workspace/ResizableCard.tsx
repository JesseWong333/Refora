import { useCallback, useRef, useState, type ReactNode } from 'react'

const MIN_W = 220
const MIN_H = 140
const MAX_W = 640
const MAX_H = 520
const DEFAULT_W = 300
const DEFAULT_H = 200

export interface CardSize {
  width: number
  height: number
}

interface ResizableCardProps {
  sizeKey: string
  size: CardSize
  onSizeChange: (sizeKey: string, size: CardSize) => void
  children: ReactNode
  className?: string
}

type Edge = 'e' | 's' | 'se'

export default function ResizableCard({
  sizeKey,
  size,
  onSizeChange,
  children,
  className = ''
}: ResizableCardProps) {
  const startRef = useRef({ x: 0, y: 0, w: 0, h: 0, edge: 'se' as Edge })
  const [resizing, setResizing] = useState(false)

  const startResize = useCallback(
    (edge: Edge, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      startRef.current = {
        x: e.clientX,
        y: e.clientY,
        w: size.width,
        h: size.height,
        edge
      }
      setResizing(true)

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startRef.current.x
        const dy = ev.clientY - startRef.current.y
        let nextW = startRef.current.w
        let nextH = startRef.current.h
        if (startRef.current.edge === 'e' || startRef.current.edge === 'se') {
          nextW = Math.max(MIN_W, Math.min(MAX_W, startRef.current.w + dx))
        }
        if (startRef.current.edge === 's' || startRef.current.edge === 'se') {
          nextH = Math.max(MIN_H, Math.min(MAX_H, startRef.current.h + dy))
        }
        onSizeChange(sizeKey, { width: nextW, height: nextH })
      }

      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        setResizing(false)
      }

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      document.body.style.cursor =
        edge === 'e' ? 'ew-resize' : edge === 's' ? 'ns-resize' : 'nwse-resize'
      document.body.style.userSelect = 'none'
    },
    [onSizeChange, size.height, size.width, sizeKey]
  )

  return (
    <div
      className={`resizable-card group/card relative ${resizing ? 'z-10' : ''} ${className}`}
      style={{
        width: size.width,
        height: size.height,
        minWidth: MIN_W,
        minHeight: MIN_H
      }}
    >
      <div className="h-full w-full overflow-hidden">{children}</div>
      <div
        className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize opacity-0 transition-opacity group-hover/card:opacity-100"
        onMouseDown={(e) => startResize('e', e)}
        aria-hidden
      />
      <div
        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 transition-opacity group-hover/card:opacity-100"
        onMouseDown={(e) => startResize('s', e)}
        aria-hidden
      />
      <div
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
  return { width: DEFAULT_W, height: DEFAULT_H }
}

export function clampCardSize(size: Partial<CardSize> | undefined): CardSize {
  return {
    width: Math.max(MIN_W, Math.min(MAX_W, size?.width ?? DEFAULT_W)),
    height: Math.max(MIN_H, Math.min(MAX_H, size?.height ?? DEFAULT_H))
  }
}
