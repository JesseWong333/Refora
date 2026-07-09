import { useRef, useCallback } from 'react'

interface ResizeDividerProps {
  onResize: (delta: number) => void
  orientation?: 'vertical' | 'horizontal'
  variant?: 'gap' | 'line' | 'soft'
}

export default function ResizeDivider({
  onResize,
  orientation = 'vertical',
  variant = 'line'
}: ResizeDividerProps) {
  const startRef = useRef({ pos: 0 })

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      startRef.current = { pos: orientation === 'vertical' ? e.clientX : e.clientY }

      const onMouseMove = (ev: MouseEvent) => {
        const current = orientation === 'vertical' ? ev.clientX : ev.clientY
        const delta = current - startRef.current.pos
        startRef.current = { pos: current }
        onResize(delta)
      }

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      document.body.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [onResize, orientation]
  )

  const isGap = variant === 'gap'
  const isSoft = variant === 'soft'
  const isVertical = orientation === 'vertical'

  if (isSoft) {
    return (
      <div
        className={`group relative z-20 shrink-0 ${
          isVertical ? 'w-3 cursor-col-resize' : 'h-3 cursor-row-resize'
        }`}
        onMouseDown={handleMouseDown}
        role="separator"
        aria-orientation={isVertical ? 'vertical' : 'horizontal'}
      >
        <div
          className={
            isVertical
              ? 'pointer-events-none absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-border to-transparent opacity-70 transition-opacity group-hover:opacity-100'
              : 'pointer-events-none absolute inset-x-6 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-border to-transparent opacity-70 transition-opacity group-hover:opacity-100'
          }
        />
        <div
          className={
            isVertical
              ? 'pointer-events-none absolute left-1/2 top-1/2 flex h-8 w-1 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-panel-2 opacity-0 shadow-sm ring-1 ring-border transition-opacity group-hover:opacity-100'
              : 'pointer-events-none absolute left-1/2 top-1/2 flex h-1 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-panel-2 opacity-0 shadow-sm ring-1 ring-border transition-opacity group-hover:opacity-100'
          }
        />
      </div>
    )
  }

  const gapStyle = isGap
    ? isVertical
      ? { width: 'var(--sidebar-inset)' }
      : { height: 'var(--sidebar-inset)' }
    : undefined

  const containerClass = isGap
    ? isVertical
      ? 'group relative z-20 shrink-0 cursor-col-resize'
      : 'group relative z-20 shrink-0 cursor-row-resize'
    : isVertical
      ? 'group relative z-20 w-px shrink-0 cursor-col-resize bg-border'
      : 'group relative z-20 h-px shrink-0 cursor-row-resize bg-border'

  const hitClass = isVertical
    ? isGap
      ? 'absolute inset-y-0 left-0 right-0'
      : 'absolute inset-y-0 -left-1 -right-1'
    : isGap
      ? 'absolute inset-x-0 top-0 bottom-0'
      : 'absolute inset-x-0 -top-1 -bottom-1'

  const accentClass = isVertical
    ? isGap
      ? 'pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-accent opacity-0 group-hover:opacity-100'
      : 'pointer-events-none absolute inset-y-0 left-0 w-px bg-accent opacity-0 group-hover:opacity-100'
    : isGap
      ? 'pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-accent opacity-0 group-hover:opacity-100'
      : 'pointer-events-none absolute inset-x-0 top-0 h-px bg-accent opacity-0 group-hover:opacity-100'

  return (
    <div className={containerClass} style={gapStyle} onMouseDown={handleMouseDown}>
      <div className={hitClass} />
      <div className={accentClass} />
    </div>
  )
}