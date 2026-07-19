import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { PanelTabHeader } from '../../src/renderer/components/ui/PanelTabHeader'

afterEach(cleanup)

describe('PanelTabHeader', () => {
  it('renders the title and close control inside the tab with actions at the right edge', () => {
    const onClose = vi.fn()
    render(
      <PanelTabHeader
        title="Research"
        onClose={onClose}
        closeLabel="Close workspace"
        leading={<button type="button">Go back</button>}
        actions={<button type="button">Add file</button>}
      />
    )

    const header = screen.getByTestId('panel-tab-header')
    const tab = screen.getByTestId('panel-tab')
    const actions = screen.getByTestId('panel-tab-actions')
    const leading = screen.getByTestId('panel-tab-leading')
    const close = screen.getByRole('button', { name: 'Close workspace' })

    expect(header).toHaveClass('h-8', 'border-b', 'drag-region')
    expect(tab).toHaveClass('h-8', 'rounded-tr-xl', 'border-l-0', 'border-t-0')
    expect(tab).not.toHaveClass('no-drag')
    expect(tab).not.toHaveClass('ml-3', 'rounded-t-xl')
    expect(tab).toContainElement(screen.getByText('Research'))
    expect(tab).toContainElement(leading)
    expect(leading).toHaveClass('no-drag')
    expect(leading).toContainElement(screen.getByRole('button', { name: 'Go back' }))
    expect(tab).toContainElement(close)
    expect(close).toHaveClass('no-drag')
    expect(actions).toContainElement(screen.getByRole('button', { name: 'Add file' }))
    expect(within(actions).queryByRole('button', { name: 'Close workspace' })).not.toBeInTheDocument()

    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('supports a disabled close control', () => {
    render(<PanelTabHeader title="Chat" onClose={() => {}} closeDisabled />)

    expect(screen.getByRole('button', { name: 'common.close' })).toBeDisabled()
  })

  it('keeps an interactive title outside the window drag region', () => {
    const onTitleClick = vi.fn()
    render(<PanelTabHeader title="Chat" onTitleClick={onTitleClick} />)

    const title = screen.getByRole('button', { name: 'Chat' })
    expect(title).toHaveClass('no-drag')
    fireEvent.click(title)
    expect(onTitleClick).toHaveBeenCalledTimes(1)
  })
})
