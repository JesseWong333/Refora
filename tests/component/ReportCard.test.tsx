import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import type { AiReport, Document, WorkspaceNote } from '../../src/shared/ipc-types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() }
  })
}))

const mockShowContextMenu = vi.fn()
const mockBoardCreateNote = vi.hoisted(() => vi.fn())
const mockWorkspacePanelState = vi.hoisted(() => ({
  workspaces: [
    { id: 'ws-1', name: 'Research', createdAt: 1, updatedAt: 1 },
    { id: 'ws-2', name: 'Reading notes', createdAt: 2, updatedAt: 2 }
  ],
  activeWorkspaceId: 'ws-1' as string | null,
  fullscreen: false,
  chatStreaming: false,
  reports: [] as AiReport[],
  notes: [] as WorkspaceNote[],
  markdownCardRequest: null as { kind: 'report' | 'note'; id: string } | null,
  setActiveWorkspace: vi.fn(),
  toggleFullscreen: vi.fn(),
  closePanel: vi.fn(),
  clearMarkdownCardRequest: vi.fn(),
  updateNote: vi.fn(),
  updateReport: vi.fn()
}))

vi.mock('../../src/renderer/store/workspaceStore', () => ({
  useWorkspaceStore: (selector: (state: typeof mockWorkspacePanelState) => unknown) => selector(mockWorkspacePanelState)
}))

vi.mock('../../src/renderer/components/workspace/Board', async () => {
  const React = await import('react')
  return {
    default: React.forwardRef(function MockBoard(
      props: { onOpenMarkdownCard?: (card: { kind: 'report'; id: string }) => void },
      ref
    ) {
      React.useImperativeHandle(ref, () => ({ createNote: mockBoardCreateNote, addFiles: vi.fn() }))
      return React.createElement(
        'div',
        null,
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => props.onOpenMarkdownCard?.({ kind: 'report', id: 'report-1' })
          },
          'Open report card'
        ),
        'Board'
      )
    })
  }
})

vi.mock('../../src/renderer/components/workspace/ChatPanel', () => ({
  default: () => <div>Chat panel</div>
}))

vi.mock('../../src/renderer/components/ResizeDivider', () => ({
  default: ({ orientation = 'vertical' }: { orientation?: 'vertical' | 'horizontal' }) => (
    <div data-testid="resize-divider" data-orientation={orientation}>Resize divider</div>
  )
}))

vi.mock('@lobehub/ui', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
  Button: ({ children, onClick, danger, disabled }: {
    children: React.ReactNode
    onClick?: () => void
    danger?: boolean
    disabled?: boolean
  }) => (
    <button data-testid={danger ? 'modal-btn-danger' : 'modal-btn'} disabled={disabled} onClick={onClick}>
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
  },
  MotionConfig: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

const ReportCardModule = await import('../../src/renderer/components/workspace/ReportCard')
const ReportCard = ReportCardModule.default
const PaperCard = (await import('../../src/renderer/components/workspace/PaperCard')).default
const NoteCard = (await import('../../src/renderer/components/workspace/NoteCard')).default
const StickyNoteCard = (await import('../../src/renderer/components/workspace/StickyNoteCard')).default
const ResizableCard = (await import('../../src/renderer/components/workspace/ResizableCard')).default
const WorkspacePanel = (await import('../../src/renderer/components/workspace/WorkspacePanel')).default

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
  mockBoardCreateNote.mockReset()
  mockWorkspacePanelState.workspaces = [
    { id: 'ws-1', name: 'Research', createdAt: 1, updatedAt: 1 },
    { id: 'ws-2', name: 'Reading notes', createdAt: 2, updatedAt: 2 }
  ]
  mockWorkspacePanelState.activeWorkspaceId = 'ws-1'
  mockWorkspacePanelState.fullscreen = false
  mockWorkspacePanelState.chatStreaming = false
  mockWorkspacePanelState.reports = []
  mockWorkspacePanelState.notes = []
  mockWorkspacePanelState.markdownCardRequest = null
  mockWorkspacePanelState.setActiveWorkspace.mockReset()
  mockWorkspacePanelState.closePanel.mockReset()
  mockWorkspacePanelState.clearMarkdownCardRequest.mockReset()
  mockWorkspacePanelState.updateNote.mockReset().mockResolvedValue(true)
  mockWorkspacePanelState.updateReport.mockReset().mockResolvedValue(true)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ReportCard', () => {
  it('renders the report title and preview content', () => {
    render(<ReportCard report={makeReport()} onDelete={() => {}} onUpdate={async () => true} />)
    expect(screen.getByText('Test Report')).toBeTruthy()
    expect(screen.getByText(/Paragraph one/)).toBeTruthy()
  })

  it('renders formatted date', () => {
    render(<ReportCard report={makeReport({ createdAt: 1700000000000 })} onDelete={() => {}} onUpdate={async () => true} />)
    expect(screen.getByText('2023-11-14')).toBeTruthy()
  })

  it('shows context menu on right-click with copy, edit, export, and delete options', () => {
    const { container } = render(<ReportCard report={makeReport()} onDelete={() => {}} onUpdate={async () => true} />)
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
    expect(items).toHaveLength(4)
    expect(items[0].key).toBe('copy')
    expect(items[0].label).toBe('workspace.cardCopy')
    expect(items[1].key).toBe('edit')
    expect(items[1].label).toBe('workspace.reportEdit')
    expect(items[2].key).toBe('export')
    expect(items[2].label).toBe('workspace.reportExportMd')
    expect(items[3].key).toBe('delete')
    expect(items[3].danger).toBe(true)
    expect(items[3].label).toBe('workspace.reportDelete')
  })

  it('copies a report from its context menu', () => {
    const onCopy = vi.fn()
    const { container } = render(
      <ReportCard report={makeReport()} onDelete={() => {}} onUpdate={async () => true} onCopy={onCopy} />
    )
    fireEvent.contextMenu(container.querySelector('.card') as HTMLElement)
    const items = mockShowContextMenu.mock.calls[0][0] as Array<{ key: string; onClick: () => void }>
    act(() => items.find((item) => item.key === 'copy')?.onClick())
    expect(onCopy).toHaveBeenCalledOnce()
  })

  it('opens modal when context menu delete action is clicked', () => {
    const { container } = render(<ReportCard report={makeReport()} onDelete={() => {}} onUpdate={async () => true} />)
    const card = container.querySelector('.card') as HTMLElement
    fireEvent.contextMenu(card)
    const items = mockShowContextMenu.mock.calls[0][0] as Array<{ onClick: () => void }>
    act(() => {
      items[3].onClick()
    })
    expect(screen.getByTestId('modal')).toBeTruthy()
  })

  it('confirms a context-menu delete before calling onDelete', () => {
    const onDelete = vi.fn()
    const { container } = render(<ReportCard report={makeReport()} onDelete={onDelete} onUpdate={async () => true} />)
    const card = container.querySelector('.card') as HTMLElement
    fireEvent.contextMenu(card)
    const items = mockShowContextMenu.mock.calls[0][0] as Array<{ onClick: () => void }>
    act(() => {
      items[3].onClick()
    })
    const dangerBtn = screen.getByTestId('modal-btn-danger')
    expect(dangerBtn.textContent).toContain('common.confirm')
    fireEvent.click(dangerBtn)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('shows source papers and opens an available source', () => {
    const onOpenSource = vi.fn()
    render(
      <ReportCard
        report={makeReport({ sourceDocIds: ['doc-1'] })}
        sourceDocuments={new Map([['doc-1', { id: 'doc-1', title: 'Source Paper', fileName: 'source.pdf' } as never]])}
        onOpenSource={onOpenSource}
        onDelete={() => {}}
        onUpdate={async () => true}
      />
    )

    fireEvent.click(screen.getByText('Test Report'))
    fireEvent.click(screen.getByRole('button', { name: 'Source Paper' }))
    expect(onOpenSource).toHaveBeenCalledWith('doc-1')
  })
})

describe('Workspace card types', () => {
  it('copies a paper as Markdown from its context menu', () => {
    const onCopy = vi.fn()
    const paper = { id: 'doc-1', fileName: 'paper.pdf', title: 'Paper title' } as Document
    const { container } = render(
      <PaperCard
        doc={paper}
        summary={null}
        summarizing={false}
        summaryError={null}
        onSummarize={() => {}}
        onOpenPdf={() => {}}
        onRemove={() => {}}
        onCopy={onCopy}
      />
    )

    fireEvent.contextMenu(container.querySelector('.card') as HTMLElement)
    const items = mockShowContextMenu.mock.calls[0][0] as Array<{ key: string; onClick: () => void }>
    act(() => items.find((item) => item.key === 'copy')?.onClick())
    expect(onCopy).toHaveBeenCalledOnce()
  })

  it('keeps all summary sections in the card preview so resizing can reveal more content', () => {
    const paper = { id: 'doc-1', fileName: 'paper.pdf', title: 'Paper title' } as Document
    render(
      <PaperCard
        doc={paper}
        summary={{
          docId: 'doc-1',
          model: 'test',
          content: {
            core: 'Core summary',
            keyPoints: ['Point one', 'Point two', 'Point three', 'Point four'],
            methods: 'Methods section',
            contribution: 'Contribution section'
          },
          createdAt: 1,
          updatedAt: 1
        }}
        summarizing={false}
        summaryError={null}
        onSummarize={() => {}}
        onOpenPdf={() => {}}
        onRemove={() => {}}
      />
    )

    expect(screen.getByText('Point four')).toBeInTheDocument()
    expect(screen.getByText('Methods section')).toBeInTheDocument()
    expect(screen.getByText('Contribution section')).toBeInTheDocument()
  })

  it('keeps card bodies independently scrollable without passing the wheel to the canvas', () => {
    const onWheel = vi.fn()
    const paper = { id: 'doc-1', fileName: 'paper.pdf', title: 'Paper title' } as Document
    const { container } = render(
      <div onWheel={onWheel}>
        <PaperCard
          doc={paper}
          summary={{
            docId: 'doc-1',
            model: 'test',
            content: {
              core: 'Core summary',
              keyPoints: ['Point one'],
              methods: 'Methods section',
              contribution: 'Contribution section'
            },
            createdAt: 1,
            updatedAt: 1
          }}
          summarizing={false}
          summaryError={null}
          onSummarize={() => {}}
          onOpenPdf={() => {}}
          onRemove={() => {}}
        />
      </div>
    )

    const scrollBody = container.querySelector('[data-card-scroll]') as HTMLElement
    expect(scrollBody).toHaveClass('overflow-y-auto', 'overscroll-contain')
    fireEvent.wheel(scrollBody, { deltaY: 120 })
    expect(onWheel).not.toHaveBeenCalled()
  })

  it('gives papers, reports, and notes distinct visible type treatments', () => {
    const paper: Document = {
      id: 'doc-1',
      fileName: 'paper.pdf',
      title: 'Paper title'
    } as Document
    const note: WorkspaceNote = {
      id: 'note-1',
      workspaceId: 'ws-1',
      noteType: 'markdown',
      title: 'Note title',
      contentMd: 'Note content',
      createdAt: 1,
      updatedAt: 1
    }

    const { container: paperContainer } = render(
      <PaperCard
        doc={paper}
        summary={null}
        summarizing={false}
        summaryError={null}
        onSummarize={() => {}}
        onOpenPdf={() => {}}
        onRemove={() => {}}
      />
    )
    const { container: reportContainer } = render(
      <ReportCard report={makeReport()} onDelete={() => {}} onUpdate={async () => true} />
    )
    const { container: noteContainer } = render(
      <NoteCard note={note} onDelete={() => {}} onUpdate={async () => true} />
    )
    const { container: stickyContainer } = render(
      <StickyNoteCard
        note={{ ...note, id: 'sticky-1', noteType: 'plain', contentMd: 'Sticky text' }}
        onDelete={() => {}}
        onUpdate={async () => true}
      />
    )

    expect(paperContainer.querySelector('[data-card-kind="document"]')).toHaveClass('workspace-content-card--document')
    expect(reportContainer.querySelector('[data-card-kind="report"]')).toHaveClass('workspace-content-card--report')
    expect(noteContainer.querySelector('[data-card-kind="note"]')).toHaveClass('workspace-content-card--note')
    expect(stickyContainer.querySelector('[data-card-kind="sticky"]')).toHaveClass('workspace-content-card--sticky')
    expect(paperContainer.querySelector('[data-card-scroll]')).toHaveClass('workspace-card-scroll')
    expect(reportContainer.querySelector('[data-card-scroll]')).toHaveClass('workspace-card-scroll')
    expect(noteContainer.querySelector('[data-card-scroll]')).toHaveClass('workspace-card-scroll')
    expect(stickyContainer.querySelector('[data-card-scroll]')).toHaveClass('workspace-card-scroll')
    expect(screen.getByText('workspace.cardTypePaper')).toBeInTheDocument()
    expect(screen.getByText('workspace.cardTypeReport')).toBeInTheDocument()
    expect(screen.getByText('workspace.cardTypeNote')).toBeInTheDocument()
    expect(screen.getByText('workspace.cardTypeSticky')).toBeInTheDocument()
  })
})

describe('WorkspacePanel tab header', () => {
  it('keeps the board content inside the workspace panel without the AI chat bar', () => {
    render(<WorkspacePanel />)

    expect(screen.getByText('Board')).toBeInTheDocument()
    expect(screen.queryByText('Chat panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('resize-divider')).not.toBeInTheDocument()
  })

  it('keeps the workspace toolbar draggable while preserving interactive controls', () => {
    render(<WorkspacePanel />)

    const toolbar = screen.getByText('Research').closest('[data-testid="panel-tab-header"]')
    expect(toolbar).toHaveClass('drag-region')
    expect(screen.getByText('Research').closest('[data-testid="panel-tab"]')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'workspace.switchWorkspace' })).not.toBeInTheDocument()
  })

  it('replaces the board with a Markdown reader without mounting the app-level chat panel', () => {
    mockWorkspacePanelState.reports = [makeReport({ id: 'report-1' })]
    render(<WorkspacePanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Open report card' }))

    expect(screen.getByRole('button', { name: 'workspace.navigateBack' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'workspace.navigateForward' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'workspace.markdownRead' })).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getAllByText('Test Report').some((title) => title.closest('[data-testid="panel-tab"]'))
    ).toBe(true)
    expect(screen.getByRole('button', { name: 'workspace.close' })).toBeInTheDocument()
    expect(screen.queryByText('Chat panel')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'workspace.navigateBack' }))

    expect(screen.getByText('Board')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'workspace.navigateBack' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'workspace.navigateForward' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'workspace.navigateForward' }))

    expect(screen.getByRole('button', { name: 'workspace.markdownRead' })).toBeInTheDocument()
  })

  it('opens a Markdown card requested by global search', () => {
    mockWorkspacePanelState.reports = [makeReport({ id: 'report-1' })]
    mockWorkspacePanelState.markdownCardRequest = { kind: 'report', id: 'report-1' }

    render(<WorkspacePanel />)

    expect(screen.getByRole('button', { name: 'workspace.navigateBack' })).toBeInTheDocument()
    expect(mockWorkspacePanelState.clearMarkdownCardRequest).toHaveBeenCalledOnce()
  })

  it('saves Markdown body edits before closing the workspace tab', async () => {
    mockWorkspacePanelState.reports = [makeReport({ id: 'report-1' })]
    render(<WorkspacePanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Open report card' }))
    fireEvent.click(screen.getByRole('button', { name: 'workspace.markdownEdit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'workspace.reportContentLabel' }), {
      target: { value: 'Updated immediately before close' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'workspace.close' }))

    await waitFor(() => {
      expect(mockWorkspacePanelState.updateReport).toHaveBeenCalledWith('report-1', {
        title: 'Test Report',
        contentMd: 'Updated immediately before close'
      })
      expect(mockWorkspacePanelState.closePanel).toHaveBeenCalledTimes(1)
    })
  })

  it('removes workspace switching from the header', () => {
    render(<WorkspacePanel />)

    expect(screen.getByText('Research')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'workspace.switchWorkspace' })).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: 'workspace.switchWorkspace' })).not.toBeInTheDocument()
  })

  it('closes the workspace from the tab', () => {
    render(<WorkspacePanel />)

    const close = screen.getByRole('button', { name: 'workspace.close' })
    expect(screen.getByTestId('panel-tab')).toContainElement(close)
    fireEvent.click(close)

    expect(mockWorkspacePanelState.closePanel).toHaveBeenCalledTimes(1)
  })

  it('keeps the workspace close tab available while chat is streaming', () => {
    mockWorkspacePanelState.chatStreaming = true

    render(<WorkspacePanel />)

    expect(screen.queryByRole('button', { name: 'workspace.switchWorkspace' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'workspace.close' })).toBeEnabled()
  })

  it('creates Markdown notes and sticky notes from the title bar', () => {
    render(<WorkspacePanel />)

    fireEvent.click(screen.getByRole('button', { name: 'workspace.createNote' }))
    fireEvent.click(screen.getByRole('button', { name: 'workspace.createStickyNote' }))

    expect(mockBoardCreateNote).toHaveBeenNthCalledWith(1, 'markdown')
    expect(mockBoardCreateNote).toHaveBeenNthCalledWith(2, 'plain')
    expect(screen.getByTestId('panel-tab-actions')).toContainElement(
      screen.getByRole('button', { name: 'workspace.createNote' })
    )
  })
})

describe('NoteCard', () => {
  const note: WorkspaceNote = {
    id: 'note-1',
    workspaceId: 'ws-1',
    noteType: 'markdown',
    title: 'Original',
    contentMd: 'Original content',
    createdAt: 1,
    updatedAt: 1
  }

  it('copies a Markdown note from its context menu', () => {
    const onCopy = vi.fn()
    const { container } = render(
      <NoteCard note={note} onDelete={() => {}} onUpdate={async () => true} onCopy={onCopy} />
    )

    fireEvent.contextMenu(container.querySelector('.card') as HTMLElement)
    const items = mockShowContextMenu.mock.calls[0][0] as Array<{ key: string; onClick: () => void }>
    act(() => items.find((item) => item.key === 'copy')?.onClick())
    expect(onCopy).toHaveBeenCalledOnce()
  })

  it('keeps the edited draft open when saving fails', async () => {
    const onUpdate = vi.fn().mockResolvedValue(false)
    render(
      <NoteCard
        note={note}
        autoEdit
        onDelete={() => {}}
        onUpdate={onUpdate}
      />
    )

    const title = screen.getByRole('textbox', { name: 'workspace.noteTitleLabel' })
    const content = screen.getByRole('textbox', { name: 'workspace.noteContentLabel' })
    fireEvent.change(title, { target: { value: 'Edited title' } })
    fireEvent.change(content, { target: { value: '# Edited content' } })
    fireEvent.click(screen.getByRole('button', { name: 'workspace.noteSave' }))

    await waitFor(() => {
      expect(screen.getByText('workspace.noteSaveFailed')).toBeInTheDocument()
    })
    expect(title).toHaveValue('Edited title')
    expect(content).toHaveValue('# Edited content')
    expect(onUpdate).toHaveBeenCalledWith('note-1', {
      title: 'Edited title',
      contentMd: '# Edited content'
    })
  })
})

describe('StickyNoteCard', () => {
  const note: WorkspaceNote = {
    id: 'sticky-1',
    workspaceId: 'ws-1',
    noteType: 'plain',
    title: 'Sticky note',
    contentMd: 'Original text',
    createdAt: 1,
    updatedAt: 1
  }

  it('copies the current plain-text draft from its context menu', () => {
    const onCopy = vi.fn()
    const { container } = render(
      <StickyNoteCard note={note} onDelete={() => {}} onUpdate={async () => true} onCopy={onCopy} />
    )
    const content = screen.getByRole('textbox', { name: 'workspace.stickyNoteContentLabel' })
    fireEvent.change(content, { target: { value: 'Current unsaved text' } })
    fireEvent.contextMenu(container.querySelector('.card') as HTMLElement)
    const items = mockShowContextMenu.mock.calls[0][0] as Array<{ key: string; onClick?: () => void }>
    act(() => items.find((item) => item.key === 'copy')?.onClick?.())
    expect(onCopy).toHaveBeenCalledWith('Current unsaved text')
  })

  it('edits plain text directly on the card without opening a modal', async () => {
    const onUpdate = vi.fn().mockResolvedValue(true)
    render(
      <StickyNoteCard
        note={note}
        onDelete={() => {}}
        onUpdate={onUpdate}
      />
    )

    const content = screen.getByRole('textbox', { name: 'workspace.stickyNoteContentLabel' })
    fireEvent.change(content, { target: { value: 'Edited plain text' } })
    fireEvent.blur(content)

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith('sticky-1', { contentMd: 'Edited plain text' })
    })
    expect(screen.queryByTestId('modal')).not.toBeInTheDocument()
    expect(content).toHaveValue('Edited plain text')
  })

  it('keeps the inline draft visible when autosave fails', async () => {
    const onUpdate = vi.fn().mockResolvedValue(false)
    render(
      <StickyNoteCard
        note={note}
        onDelete={() => {}}
        onUpdate={onUpdate}
      />
    )

    const content = screen.getByRole('textbox', { name: 'workspace.stickyNoteContentLabel' })
    fireEvent.change(content, { target: { value: 'Unsaved text' } })
    fireEvent.blur(content)

    await waitFor(() => {
      expect(screen.getByText('workspace.stickyNoteSaveFailed')).toBeInTheDocument()
    })
    expect(content).toHaveValue('Unsaved text')
  })
})

describe('ResizableCard', () => {
  it('supports keyboard positioning from the card without rendering a move handle', () => {
    const onPositionChange = vi.fn()
    const onPositionCommit = vi.fn()
    render(
      <ResizableCard
        sizeKey="item-1"
        size={{ width: 300, height: 200 }}
        position={{ x: 100, y: 200, zIndex: 2 }}
        scale={1}
        frontZIndex={5}
        onSizeChange={() => {}}
        onSizeCommit={() => {}}
        onPositionChange={onPositionChange}
        onPositionCommit={onPositionCommit}
        moveLabel="Move card"
      >
        <div>Content</div>
      </ResizableCard>
    )

    const card = screen.getByRole('group', { name: 'Move card' })
    expect(screen.queryByRole('button', { name: 'Move card' })).toBeNull()
    fireEvent.keyDown(card, { key: 'ArrowLeft' })
    fireEvent.keyDown(card, { key: 'ArrowDown', shiftKey: true })

    expect(onPositionCommit).toHaveBeenNthCalledWith(1, 'item-1', { x: 90, y: 200, zIndex: 5 })
    expect(onPositionCommit).toHaveBeenNthCalledWith(2, 'item-1', { x: 100, y: 250, zIndex: 5 })
  })

  it('commits the final size in world coordinates when resizing a zoomed canvas', () => {
    const onSizeChange = vi.fn()
    const onSizeCommit = vi.fn()
    const { container } = render(
      <ResizableCard
        sizeKey="item-1"
        size={{ width: 300, height: 200 }}
        position={{ x: 0, y: 0, zIndex: 0 }}
        scale={2}
        frontZIndex={1}
        onSizeChange={onSizeChange}
        onSizeCommit={onSizeCommit}
        onPositionChange={() => {}}
        onPositionCommit={() => {}}
      >
        <div>Content</div>
      </ResizableCard>
    )
    const corner = container.querySelector('.cursor-nwse-resize') as HTMLElement

    fireEvent.mouseDown(corner, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 180, clientY: 150 })
    fireEvent.mouseUp(document)

    expect(onSizeChange).toHaveBeenLastCalledWith('item-1', { width: 340, height: 225 })
    expect(onSizeCommit).toHaveBeenCalledWith('item-1', { width: 340, height: 225 })
  })

  it('starts moving after the pointer crosses the drag threshold and converts through canvas scale', () => {
    const onPositionChange = vi.fn()
    const onPositionCommit = vi.fn()
    render(
      <ResizableCard
        sizeKey="item-1"
        size={{ width: 300, height: 200 }}
        position={{ x: -20, y: 40, zIndex: 1 }}
        scale={0.5}
        frontZIndex={8}
        onSizeChange={() => {}}
        onSizeCommit={() => {}}
        onPositionChange={onPositionChange}
        onPositionCommit={onPositionCommit}
        moveLabel="Move card"
      >
        <div>Content</div>
      </ResizableCard>
    )

    const content = screen.getByText('Content')
    fireEvent.mouseDown(content, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 103, clientY: 102 })
    expect(onPositionChange).not.toHaveBeenCalled()
    fireEvent.mouseMove(document, { clientX: 130, clientY: 80 })
    fireEvent.mouseUp(document)

    expect(onPositionChange).toHaveBeenLastCalledWith('item-1', { x: 40, y: 0, zIndex: 8 })
    expect(onPositionCommit).toHaveBeenCalledWith('item-1', { x: 40, y: 0, zIndex: 8 })
  })

  it('keeps a normal click from becoming a drag when movement stays below the threshold', () => {
    const onPositionChange = vi.fn()
    const onPositionCommit = vi.fn()
    render(
      <ResizableCard
        sizeKey="item-1"
        size={{ width: 300, height: 200 }}
        position={{ x: 0, y: 0, zIndex: 0 }}
        scale={1}
        frontZIndex={1}
        onSizeChange={() => {}}
        onSizeCommit={() => {}}
        onPositionChange={onPositionChange}
        onPositionCommit={onPositionCommit}
        moveLabel="Move card"
      >
        <div>Content</div>
      </ResizableCard>
    )

    fireEvent.mouseDown(screen.getByText('Content'), { button: 0, clientX: 10, clientY: 10 })
    fireEvent.mouseMove(document, { clientX: 14, clientY: 10 })
    fireEvent.mouseUp(document)

    expect(onPositionChange).not.toHaveBeenCalled()
    expect(onPositionCommit).not.toHaveBeenCalled()
  })

  it('does not start a drag from an interactive control', () => {
    const onPositionChange = vi.fn()
    render(
      <ResizableCard
        sizeKey="item-1"
        size={{ width: 300, height: 200 }}
        position={{ x: 0, y: 0, zIndex: 0 }}
        scale={1}
        frontZIndex={1}
        onSizeChange={() => {}}
        onSizeCommit={() => {}}
        onPositionChange={onPositionChange}
        onPositionCommit={() => {}}
        moveLabel="Move card"
      >
        <button type="button">Open</button>
      </ResizableCard>
    )

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Open' }), { button: 0, clientX: 10, clientY: 10 })
    fireEvent.mouseMove(document, { clientX: 50, clientY: 50 })
    fireEvent.mouseUp(document)

    expect(onPositionChange).not.toHaveBeenCalled()
  })
})
