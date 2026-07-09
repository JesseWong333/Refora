import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import type { AiReport } from '../../src/shared/ipc-types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() }
  })
}))

const mockShowContextMenu = vi.fn()

vi.mock('@lobehub/ui', () => ({
  Modal: ({ children, open, title, footer }: {
    children: React.ReactNode
    open: boolean
    title: string
    footer: React.ReactNode
  }) => (
    <div data-testid="modal-root" data-open={String(open)}>
      {open && (
        <div data-testid="modal">
          <div data-testid="modal-title">{title}</div>
          <div data-testid="modal-body">{children}</div>
          <div data-testid="modal-footer">{footer}</div>
        </div>
      )}
    </div>
  ),
  Button: ({ children, onClick, danger }: { children: React.ReactNode; onClick?: () => void; danger?: boolean }) => (
    <button data-testid={danger ? 'modal-btn-danger' : 'modal-btn'} onClick={onClick}>
      {children}
    </button>
  ),
  showContextMenu: (...args: unknown[]) => mockShowContextMenu(...args)
}))

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) => (
      <div {...props}>{children}</div>
    )
  }
}))

const ReportCardModule = await import('../../src/renderer/components/workspace/ReportCard')
const ReportCard = ReportCardModule.default

function makeReport(overrides: Partial<AiReport> = {}): AiReport {
  return {
    id: 'r1',
    workspaceId: 'ws-1',
    title: 'Test Report',
    contentMd: 'Paragraph one.\n\nParagraph two.',
    sourceDocIds: [],
    model: 'gpt-4o',
    createdAt: 1700000000000,
    ...overrides
  }
}

beforeEach(() => {
  mockShowContextMenu.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ReportCard', () => {
  it('renders the report title and preview content', () => {
    render(<ReportCard report={makeReport()} onDelete={() => {}} />)
    expect(screen.getByText('Test Report')).toBeTruthy()
    expect(screen.getByText(/Paragraph one/)).toBeTruthy()
  })

  it('renders formatted date', () => {
    render(<ReportCard report={makeReport({ createdAt: 1700000000000 })} onDelete={() => {}} />)
    expect(screen.getByText('2023-11-14')).toBeTruthy()
  })

  it('shows context menu on right-click with a single delete option', () => {
    const { container } = render(<ReportCard report={makeReport()} onDelete={() => {}} />)
    const card = container.querySelector('.card') as HTMLElement
    expect(card).toBeTruthy()
    fireEvent.contextMenu(card)
    expect(mockShowContextMenu).toHaveBeenCalledTimes(1)
    const items = mockShowContextMenu.mock.calls[0][0] as Array<{
      key: string
      label: string
      danger?: boolean
      onClick: () => void
    }>
    expect(items).toHaveLength(1)
    expect(items[0].key).toBe('delete')
    expect(items[0].danger).toBe(true)
    expect(items[0].label).toBe('workspace.reportDelete')
  })

  it('opens modal when context menu delete action is clicked', () => {
    const { container } = render(<ReportCard report={makeReport()} onDelete={() => {}} />)
    const card = container.querySelector('.card') as HTMLElement
    fireEvent.contextMenu(card)
    const items = mockShowContextMenu.mock.calls[0][0] as Array<{ onClick: () => void }>
    act(() => {
      items[0].onClick()
    })
    expect(screen.getByTestId('modal')).toBeTruthy()
  })

  it('triggers onDelete on second click of danger button (two-step confirm)', () => {
    const onDelete = vi.fn()
    const { container } = render(<ReportCard report={makeReport()} onDelete={onDelete} />)
    const card = container.querySelector('.card') as HTMLElement
    fireEvent.contextMenu(card)
    const items = mockShowContextMenu.mock.calls[0][0] as Array<{ onClick: () => void }>
    act(() => {
      items[0].onClick()
    })
    const dangerBtn = screen.getByTestId('modal-btn-danger')
    expect(dangerBtn.textContent).toContain('workspace.reportDelete')
    fireEvent.click(dangerBtn)
    expect(onDelete).not.toHaveBeenCalled()
    expect(dangerBtn.textContent).toContain('common.confirm')
    fireEvent.click(dangerBtn)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
