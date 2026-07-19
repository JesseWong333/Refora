import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ResizeDivider from '../../src/renderer/components/ResizeDivider'

afterEach(() => {
  cleanup()
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
})

describe('ResizeDivider', () => {
  it('reports incremental horizontal pointer movement for a vertical divider', () => {
    const onResize = vi.fn()
    const { container } = render(<ResizeDivider onResize={onResize} />)
    const divider = container.firstElementChild as HTMLElement

    fireEvent.mouseDown(divider, { clientX: 10 })
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')

    fireEvent.mouseMove(document, { clientX: 25 })
    fireEvent.mouseMove(document, { clientX: 20 })
    expect(onResize).toHaveBeenNthCalledWith(1, 15)
    expect(onResize).toHaveBeenNthCalledWith(2, -5)

    fireEvent.mouseUp(document)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })

  it('uses vertical pointer movement and gap sizing for a horizontal divider', () => {
    const onResize = vi.fn()
    const { container } = render(
      <ResizeDivider orientation="horizontal" variant="gap" onResize={onResize} />
    )
    const divider = container.firstElementChild as HTMLElement

    expect(divider).toHaveStyle({ height: '0px' })
    fireEvent.mouseDown(divider, { clientY: 40 })
    expect(document.body.style.cursor).toBe('row-resize')
    fireEvent.mouseMove(document, { clientY: 55 })
    expect(onResize).toHaveBeenCalledWith(15)
    fireEvent.mouseUp(document)
  })

  it('reports the start and end of a resize gesture', () => {
    const onResizeStart = vi.fn()
    const onResizeEnd = vi.fn()
    const { container } = render(
      <ResizeDivider
        onResize={vi.fn()}
        onResizeStart={onResizeStart}
        onResizeEnd={onResizeEnd}
      />
    )
    const divider = container.firstElementChild as HTMLElement

    fireEvent.mouseDown(divider, { clientX: 10 })
    expect(onResizeStart).toHaveBeenCalledOnce()
    expect(onResizeEnd).not.toHaveBeenCalled()

    fireEvent.mouseUp(document)
    expect(onResizeEnd).toHaveBeenCalledOnce()
  })

  it('finishes an active resize when the window loses focus', () => {
    const onResizeEnd = vi.fn()
    const { container } = render(
      <ResizeDivider onResize={vi.fn()} onResizeEnd={onResizeEnd} />
    )
    const divider = container.firstElementChild as HTMLElement

    fireEvent.mouseDown(divider, { clientX: 10 })
    fireEvent(window, new Event('blur'))

    expect(onResizeEnd).toHaveBeenCalledOnce()
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')

    fireEvent.mouseUp(document)
    expect(onResizeEnd).toHaveBeenCalledOnce()
  })

  it('finishes an active resize when the divider unmounts', () => {
    const onResize = vi.fn()
    const onResizeEnd = vi.fn()
    const { container, unmount } = render(
      <ResizeDivider onResize={onResize} onResizeEnd={onResizeEnd} />
    )
    const divider = container.firstElementChild as HTMLElement

    fireEvent.mouseDown(divider, { clientX: 10 })
    unmount()

    expect(onResizeEnd).toHaveBeenCalledOnce()
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')

    fireEvent.mouseMove(document, { clientX: 20 })
    expect(onResize).not.toHaveBeenCalled()
  })

  it('renders accessible soft dividers in both orientations', () => {
    const { rerender } = render(<ResizeDivider variant="soft" onResize={vi.fn()} />)
    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical')

    rerender(<ResizeDivider variant="soft" orientation="horizontal" onResize={vi.fn()} />)
    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'horizontal')
  })
})
