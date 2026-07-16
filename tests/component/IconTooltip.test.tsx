import type { CSSProperties, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

interface MockTooltipProps {
  arrow?: boolean
  children?: ReactNode
  styles?: { root?: CSSProperties }
  title?: ReactNode
}

vi.mock('@lobehub/ui', () => ({
  Tooltip: ({ arrow, children, styles, title }: MockTooltipProps) => (
    <div
      data-arrow={String(arrow)}
      data-root-background={styles?.root?.background}
      data-testid="tooltip"
    >
      {title}
      {children}
    </div>
  ),
}))

import { IconTooltip } from '../../src/renderer/components/ui/Tooltip'

describe('IconTooltip', () => {
  it('uses the rounded sidebar appearance and shows the supplied macOS shortcut', () => {
    render(
      <IconTooltip label="Add PDF File" appearance="sidebar" shortcut="⌘I">
        <button type="button">Add</button>
      </IconTooltip>
    )

    const tooltip = screen.getByTestId('tooltip')
    expect(tooltip).toHaveAttribute('data-arrow', 'false')
    expect(tooltip).toHaveAttribute('data-root-background', 'var(--color-background)')
    expect(screen.getByText('⌘I').tagName).toBe('KBD')
  })
})
