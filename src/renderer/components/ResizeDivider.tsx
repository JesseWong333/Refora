import { useRef, useCallback, useEffect } from 'react'

interface ResizeDividerProps {
  onResize: (delta: number) => void
  onResizeStart?: () => void
  onResizeEnd?: () => void
  orientation?: 'vertical' | 'horizontal'
  variant?: 'gap' | 'line' | 'soft'
}

export default function ResizeDivider({
  onResize,
  onResizeStart,
  onResizeEnd,
  orientation = 'vertical',
  variant = 'line'
}: ResizeDividerProps) {
  const startRef = useRef({ pos: 0 })
  const finishResizeRef = useRef<(() => void) | null>(null)

  useEffect(() => () => {
    finishResizeRef.current?.()
  }, [])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      finishResizeRef.current?.()
      e.preventDefault()
      e.stopPropagation()
      startRef.current = { pos: orientation === 'vertical' ? e.clientX : e.clientY }
      onResizeStart?.()

      const onMouseMove = (ev: MouseEvent) => {
        const current = orientation === 'vertical' ? ev.clientX : ev.clientY
        const delta = current - startRef.current.pos
        startRef.current = { pos: current }
        onResize(delta)
      }

      const finishResize = () => {
        if (finishResizeRef.current !== finishResize) return
        finishResizeRef.current = null
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', finishResize)
        window.removeEventListener('blur', finishResize)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        onResizeEnd?.()
      }

      finishResizeRef.current = finishResize
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', finishResize)
      window.addEventListener('blur', finishResize)
      document.body.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [onResize, onResizeEnd, onResizeStart, orientation]
  )

  const isGap = variant === 'gap'
  const isSoft = variant === 'soft'
  const isVertical = orientation === 'vertical'

  if (isSoft) {
    return (
      <div
        className={`group relative z-20 shrink-0 ${
          isVertical ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize'
        }`}
        onMouseDown={handleMouseDown}
        role="separator"
        aria-orientation={isVertical ? 'vertical' : 'horizontal'}
      >
        <div className={isVertical ? 'absolute inset-y-0 -left-1 -right-1' : 'absolute inset-x-0 -top-1 -bottom-1'} />
      </div>
    )
  }

  const gapStyle = isGap
    ? isVertical
      ? { width: '0px' }
      : { height: '0px' }
    : undefined

  const containerClass = isGap
    ? isVertical
      ? 'group relative z-20 shrink-0 cursor-col-resize'
      : 'group relative z-20 shrink-0 cursor-row-resize'
    : isVertical
      ? 'group relative z-20 w-px shrink-0 cursor-col-resize bg-border'
      : 'group relative z-20 h-px shrink-0 cursor-row-resize bg-border'

  const hitClass = isVertical
    ? 'absolute inset-y-0 -left-1 -right-1'
    : 'absolute inset-x-0 -top-1 -bottom-1'

  return (
    <div className={containerClass} style={gapStyle} onMouseDown={handleMouseDown}>
      <div className={hitClass} />
    </div>
  )
}
