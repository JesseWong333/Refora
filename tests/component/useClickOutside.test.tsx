import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { useClickOutside } from '../../src/renderer/hooks/useClickOutside'

function setup(isActive: boolean, onClose = vi.fn()) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const returned: { ref: React.RefObject<HTMLDivElement | null> } = { ref: { current: null } }
  const result = renderHook(() => {
    const ref = useRef<HTMLDivElement>(null)
    ref.current = el
    returned.ref = ref
    useClickOutside(ref, onClose, isActive)
    return ref
  })
  return { ...result, el, onClose, ...returned }
}

describe('useClickOutside', () => {
  it('calls onClose when clicking outside the ref element', () => {
    const onClose = vi.fn()
    const { el } = setup(true, onClose)
    const outside = document.createElement('div')
    const evt = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(evt, 'target', { value: outside })
    document.dispatchEvent(evt)
    expect(onClose).toHaveBeenCalledTimes(1)
    void el
  })

  it('does not call onClose when clicking inside the ref element', () => {
    const onClose = vi.fn()
    const { el } = setup(true, onClose)
    const inner = document.createElement('span')
    el.appendChild(inner)
    const evt = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(evt, 'target', { value: inner })
    document.dispatchEvent(evt)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn()
    setup(true, onClose)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose on non-Escape keys', () => {
    const onClose = vi.fn()
    setup(true, onClose)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not attach listeners when inactive', () => {
    const onClose = vi.fn()
    setup(false, onClose)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('cleans up listeners on unmount', () => {
    const onClose = vi.fn()
    const { unmount } = setup(true, onClose)
    unmount()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).not.toHaveBeenCalled()
  })
})
