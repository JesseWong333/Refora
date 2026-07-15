import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k })
}))

import { PanelHeader } from '../../src/renderer/components/ui/PanelHeader'

afterEach(cleanup)

describe('PanelHeader', () => {
  it('renders title when provided', () => {
    render(<PanelHeader title="My Panel" />)
    expect(screen.getByText('My Panel')).toBeInTheDocument()
  })

  it('renders a spacer when no title', () => {
    const { container } = render(<PanelHeader />)
    expect(container.querySelector('.flex-1')).toBeInTheDocument()
  })

  it('renders actions node', () => {
    render(<PanelHeader actions={<button>Act</button>} />)
    expect(screen.getByText('Act')).toBeInTheDocument()
  })

  it('renders close button when onClose given', () => {
    const onClose = vi.fn()
    render(<PanelHeader onClose={onClose} />)
    const btn = screen.getByRole('button', { name: 'common.close' })
    fireEvent.click(btn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not render close button when no onClose', () => {
    render(<PanelHeader title="x" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
