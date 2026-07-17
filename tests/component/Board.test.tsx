import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { showContextMenu } from '@lobehub/ui'
import Board from '@renderer/components/workspace/Board'
import type { AiReport, AiSummary, Document, WorkspaceAsset, WorkspaceItem, WorkspaceNote } from '@shared/ipc-types'

const DOC_MIME = 'application/x-refora-docids'

const mockAddDocs = vi.fn()
const mockAddAssets = vi.fn()
const mockDeleteAsset = vi.fn()
const mockFetchItems = vi.fn()
const mockRemoveItem = vi.fn()
const mockDeleteReport = vi.fn()
const mockResizeItem = vi.fn()
const mockMoveItem = vi.fn()
const mockCreateNote = vi.fn()
const mockDeleteNote = vi.fn()
const mockUpdateNote = vi.fn()
const mockUpdateReport = vi.fn()
const mockConnectionsList = vi.fn()
const mockConnectionsCreate = vi.fn()
const mockConnectionsDelete = vi.fn()
const mockCopyWorkspaceAsset = vi.fn()
const mockCopyMarkdown = vi.fn()
const mockWriteClipboardText = vi.fn()
const { mockShowToast, mockTranslate } = vi.hoisted(() => ({
  mockShowToast: vi.fn(),
  mockTranslate: (key: string, fallback?: string) => fallback ?? key
}))

let mockItems: WorkspaceItem[] = []
let mockReports: unknown[] = []
let mockNotes: unknown[] = []
let mockAssets: WorkspaceAsset[] = []
let mockActiveWorkspaceId: string | null = 'ws-1'

vi.mock('@renderer/store/workspaceStore', () => ({
  useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      items: mockItems,
      reports: mockReports,
      notes: mockNotes,
      assets: mockAssets,
      activeWorkspaceId: mockActiveWorkspaceId,
      addDocs: mockAddDocs,
      addAssets: mockAddAssets,
      deleteAsset: mockDeleteAsset,
      fetchItems: mockFetchItems,
      removeItem: mockRemoveItem,
      deleteReport: mockDeleteReport,
      resizeItem: mockResizeItem,
      moveItem: mockMoveItem,
      createNote: mockCreateNote,
      deleteNote: mockDeleteNote,
      updateNote: mockUpdateNote,
      updateReport: mockUpdateReport
    })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate
  })
}))

vi.mock('@renderer/store/documentStore', () => ({
  useDocumentStore: {
    getState: () => ({ showToast: mockShowToast })
  }
}))

vi.mock('@lobehub/ui', async () => import('../mocks/lobehub-ui'))

beforeEach(() => {
  vi.mocked(showContextMenu).mockReset()
  mockAddDocs.mockReset().mockResolvedValue(undefined)
  mockAddAssets.mockReset().mockResolvedValue(undefined)
  mockDeleteAsset.mockReset().mockResolvedValue(undefined)
  mockFetchItems.mockReset().mockResolvedValue(undefined)
  mockRemoveItem.mockReset()
  mockDeleteReport.mockReset()
  mockResizeItem.mockReset().mockResolvedValue(true)
  mockMoveItem.mockReset().mockResolvedValue(true)
  mockCreateNote.mockReset().mockResolvedValue(null)
  mockDeleteNote.mockReset()
  mockUpdateNote.mockReset().mockResolvedValue(true)
  mockUpdateReport.mockReset().mockResolvedValue(true)
  mockConnectionsList.mockReset().mockResolvedValue([])
  mockConnectionsCreate.mockReset()
  mockConnectionsDelete.mockReset().mockResolvedValue(undefined)
  mockCopyWorkspaceAsset.mockReset().mockResolvedValue(undefined)
  mockCopyMarkdown.mockReset().mockResolvedValue(undefined)
  mockWriteClipboardText.mockReset().mockResolvedValue(undefined)
  mockShowToast.mockReset()
  mockItems = []
  mockReports = []
  mockNotes = []
  mockAssets = []
  mockActiveWorkspaceId = 'ws-1'

  const api = window.api as unknown as Record<string, unknown>
  const documents = api.documents as Record<string, unknown>
  documents.get = vi.fn().mockResolvedValue(null)
  const ai = api.ai as Record<string, unknown>
  ai.summaryGet = vi.fn().mockResolvedValue(null)
  const workspaceConnections = api.workspaceConnections as Record<string, unknown>
  workspaceConnections.list = mockConnectionsList
  workspaceConnections.create = mockConnectionsCreate
  workspaceConnections.delete = mockConnectionsDelete
  api.getPathForFile = vi.fn((file: { name?: string }) => file.name ? `/tmp/${file.name}` : '')
  const workspaceAssets = api.workspaceAssets as Record<string, unknown>
  workspaceAssets.textPreview = vi.fn().mockResolvedValue({ content: '', truncated: false })
  workspaceAssets.previewUrl = vi.fn((id: string) => `refora-asset://asset/${id}`)
  workspaceAssets.open = vi.fn().mockResolvedValue(undefined)
  workspaceAssets.reveal = vi.fn().mockResolvedValue(undefined)
  api.clipboard = {
    copyWorkspaceAsset: mockCopyWorkspaceAsset,
    copyMarkdown: mockCopyMarkdown,
    writeText: mockWriteClipboardText
  }
})

afterEach(() => {
  cleanup()
})

function makeItem(id: string, docId: string, x: number): WorkspaceItem {
  return {
    id,
    workspaceId: 'ws-1',
    kind: 'document',
    docId,
    reportId: null,
    noteId: null,
    assetId: null,
    sortOrder: x,
    width: 300,
    height: 200,
    x,
    y: 0,
    zIndex: x,
    addedAt: x
  }
}

describe('Board drag-and-drop', () => {
  it('shows empty drag hint when board has no items', () => {
    render(<Board />)
    expect(screen.getByText('workspace.dragPapersHint')).toBeInTheDocument()
  })

  it('accepts document drops via DOC_MIME and calls addDocs', async () => {
    const { container } = render(<Board />)
    const board = container.firstElementChild as HTMLElement

    const dataTransfer = {
      types: [DOC_MIME],
      dropEffect: 'none',
      getData: (type: string) =>
        type === DOC_MIME ? JSON.stringify(['doc-a', 'doc-b']) : '',
      setData: vi.fn()
    }

    fireEvent.dragOver(board, { dataTransfer })
    const dropEvent = new MouseEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX: 320,
      clientY: 240
    })
    Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })
    fireEvent(board, dropEvent)

    await waitFor(() => {
      expect(mockAddDocs).toHaveBeenCalledWith(['doc-a', 'doc-b'], { x: 170, y: 140 })
    })
  })

  it('ignores text/plain payloads without the document MIME type', () => {
    const { container } = render(<Board />)
    const board = container.firstElementChild as HTMLElement

    const dataTransfer = {
      types: ['text/plain'],
      dropEffect: 'none',
      getData: (type: string) => (type === 'text/plain' ? 'doc-x,doc-y' : ''),
      setData: vi.fn()
    }

    fireEvent.drop(board, { dataTransfer })
    expect(mockAddDocs).not.toHaveBeenCalled()
  })

  it('accepts Finder file drops and calls addAssets with managed paths', async () => {
    const { container } = render(<Board />)
    const board = container.firstElementChild as HTMLElement

    const dataTransfer = {
      types: ['Files'],
      dropEffect: 'none',
      files: [{ name: 'notes.md' }, { name: 'image.png' }],
      getData: () => '',
      setData: vi.fn()
    }

    const dropEvent = new MouseEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX: 320,
      clientY: 240
    })
    Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })
    fireEvent(board, dropEvent)

    await waitFor(() => {
      expect(mockAddAssets).toHaveBeenCalledWith(
        ['/tmp/notes.md', '/tmp/image.png'],
        { x: 170, y: 140 }
      )
    })
  })
})

describe('Board card clipboard actions', () => {
  it('opens Markdown notes and reports in the workspace Markdown view', () => {
    const report: AiReport = {
      id: 'report-1',
      workspaceId: 'ws-1',
      title: 'Research report',
      contentMd: 'Report body',
      sourceDocIds: [],
      model: null,
      createdAt: 1
    }
    const note: WorkspaceNote = {
      id: 'note-1',
      workspaceId: 'ws-1',
      noteType: 'markdown',
      title: 'Markdown note',
      contentMd: '- Item',
      createdAt: 1,
      updatedAt: 1
    }
    const onOpenMarkdownCard = vi.fn()
    mockReports = [report]
    mockNotes = [note]
    mockItems = [
      {
        ...makeItem('item-report', '', 0),
        kind: 'report',
        docId: null,
        reportId: report.id
      },
      {
        ...makeItem('item-note', '', 1),
        kind: 'note',
        docId: null,
        noteId: note.id
      }
    ]

    const { container } = render(<Board onOpenMarkdownCard={onOpenMarkdownCard} />)
    fireEvent.click(container.querySelector('[data-card-kind="report"]') as HTMLElement)
    fireEvent.click(container.querySelector('[data-card-kind="note"]') as HTMLElement)

    expect(onOpenMarkdownCard).toHaveBeenNthCalledWith(1, { kind: 'report', id: report.id })
    expect(onOpenMarkdownCard).toHaveBeenNthCalledWith(2, { kind: 'note', id: note.id })

    fireEvent.contextMenu(container.querySelector('[data-card-kind="report"]') as HTMLElement)
    const items = vi.mocked(showContextMenu).mock.calls.at(-1)?.[0] as Array<{
      key: string
      onClick?: () => void
    }>
    items.find((item) => item.key === 'edit')?.onClick?.()

    expect(onOpenMarkdownCard).toHaveBeenLastCalledWith(
      { kind: 'report', id: report.id },
      'edit'
    )
  })

  it('opens a document AI summary in the workspace Markdown reader', async () => {
    const document = {
      id: 'doc-1',
      fileName: 'paper.pdf',
      title: 'Paper title'
    } as Document
    const summary: AiSummary = {
      docId: document.id,
      model: 'test',
      content: {
        core: 'Core summary',
        keyPoints: ['Point one'],
        methods: 'Methods',
        contribution: 'Contribution'
      },
      createdAt: 1,
      updatedAt: 2
    }
    const onOpenMarkdownCard = vi.fn()
    mockItems = [makeItem('item-paper', document.id, 0)]
    const api = window.api as unknown as Record<string, unknown>
    const documents = api.documents as Record<string, unknown>
    const ai = api.ai as Record<string, unknown>
    documents.get = vi.fn().mockResolvedValue(document)
    ai.summaryGet = vi.fn().mockResolvedValue(summary)

    const { container } = render(<Board onOpenMarkdownCard={onOpenMarkdownCard} />)
    await waitFor(() => expect(screen.getByText('Paper title')).toBeInTheDocument())
    fireEvent.click(container.querySelector('[data-card-kind="document"]') as HTMLElement)

    expect(onOpenMarkdownCard).toHaveBeenCalledWith({
      kind: 'summary',
      doc: document,
      summary
    })
  })

  it('copies reports and Markdown notes as Markdown files', () => {
    const report: AiReport = {
      id: 'report-1',
      workspaceId: 'ws-1',
      title: 'Research report',
      contentMd: 'Report body',
      sourceDocIds: [],
      model: null,
      createdAt: 1
    }
    const note: WorkspaceNote = {
      id: 'note-1',
      workspaceId: 'ws-1',
      noteType: 'markdown',
      title: 'Markdown note',
      contentMd: '- Item',
      createdAt: 1,
      updatedAt: 1
    }
    mockReports = [report]
    mockNotes = [note]
    mockItems = [
      {
        ...makeItem('item-report', '', 0),
        kind: 'report',
        docId: null,
        reportId: report.id
      },
      {
        ...makeItem('item-note', '', 1),
        kind: 'note',
        docId: null,
        noteId: note.id
      }
    ]

    const { container } = render(<Board />)
    for (const kind of ['report', 'note']) {
      fireEvent.contextMenu(container.querySelector(`[data-card-kind="${kind}"]`) as HTMLElement)
      const items = vi.mocked(showContextMenu).mock.calls.at(-1)?.[0] as Array<{
        key: string
        onClick?: () => void
      }>
      items.find((item) => item.key === 'copy')?.onClick?.()
    }

    expect(mockCopyMarkdown).toHaveBeenNthCalledWith(1, 'Research report', '# Research report\n\nReport body\n')
    expect(mockCopyMarkdown).toHaveBeenNthCalledWith(2, 'Markdown note', '# Markdown note\n\n- Item\n')
  })

  it('copies the current sticky-note draft as plain text', () => {
    const note: WorkspaceNote = {
      id: 'sticky-1',
      workspaceId: 'ws-1',
      noteType: 'plain',
      title: 'Sticky note',
      contentMd: 'Saved text',
      createdAt: 1,
      updatedAt: 1
    }
    mockNotes = [note]
    mockItems = [{
      ...makeItem('item-sticky', '', 0),
      kind: 'note',
      docId: null,
      noteId: note.id
    }]

    const { container } = render(<Board />)
    fireEvent.change(screen.getByRole('textbox', { name: 'workspace.stickyNoteContentLabel' }), {
      target: { value: 'Unsaved current text' }
    })
    fireEvent.contextMenu(container.querySelector('[data-card-kind="sticky"]') as HTMLElement)
    const items = vi.mocked(showContextMenu).mock.calls[0][0] as Array<{
      key: string
      onClick?: () => void
    }>
    items.find((item) => item.key === 'copy')?.onClick?.()

    expect(mockWriteClipboardText).toHaveBeenCalledWith('Unsaved current text')
  })

  it('copies a paper card as a generated Markdown file', async () => {
    const doc = {
      id: 'doc-1',
      title: 'Paper title',
      fileName: 'paper.pdf',
      authors: 'Ada Lovelace',
      year: '2026',
      abstract: 'Abstract body'
    } as Document
    mockItems = [makeItem('item-paper', doc.id, 0)]
    const api = window.api as unknown as Record<string, unknown>
    const documents = api.documents as Record<string, unknown>
    documents.get = vi.fn().mockResolvedValue(doc)

    const { container } = render(<Board />)
    await waitFor(() => expect(container.querySelector('[data-card-kind="document"]')).toBeInTheDocument())
    fireEvent.contextMenu(container.querySelector('[data-card-kind="document"]') as HTMLElement)
    const items = vi.mocked(showContextMenu).mock.calls[0][0] as Array<{
      key: string
      onClick?: () => void
    }>
    items.find((item) => item.key === 'copy')?.onClick?.()

    expect(mockCopyMarkdown).toHaveBeenCalledOnce()
    expect(mockCopyMarkdown.mock.calls[0][0]).toBe('Paper title')
    expect(mockCopyMarkdown.mock.calls[0][1]).toContain('# Paper title')
    expect(mockCopyMarkdown.mock.calls[0][1]).toContain('**Authors:** Ada Lovelace')
    expect(mockCopyMarkdown.mock.calls[0][1]).toContain('## Abstract')
  })
})

describe('Board workspace assets', () => {
  it.each([
    ['image', 'image/png', 'figure.png', 'img'],
    ['video', 'video/mp4', 'demo.mp4', 'video']
  ] as const)('renders a %s as an edge-to-edge media card with hover details', (previewKind, mimeType, fileName, elementName) => {
    const asset: WorkspaceAsset = {
      id: `asset-${previewKind}`,
      workspaceId: 'ws-1',
      fileName,
      filePath: `refora-assets/asset-${previewKind}/${fileName}`,
      sourcePath: `/tmp/${fileName}`,
      mimeType,
      previewKind,
      fileSize: 2048,
      fileHash: 'hash',
      fileMissing: 0,
      createdAt: 0,
      updatedAt: 0
    }
    mockAssets = [asset]
    mockItems = [{
      ...makeItem(`item-${previewKind}`, '', 0),
      kind: 'asset',
      docId: null,
      assetId: asset.id
    }]

    const { container } = render(<Board />)

    const card = container.querySelector('[data-card-kind="asset"]') as HTMLElement
    expect(card).toHaveClass('workspace-content-card--media', 'p-0')
    expect(card).toHaveAttribute('data-asset-preview-kind', previewKind)
    expect(card.querySelector('[data-card-scroll]')).toBeNull()
    expect(card.querySelector('[data-asset-media-overlay]')).toHaveClass(
      'workspace-asset-media-overlay',
      'inset-x-0',
      'top-0'
    )
    const media = card.querySelector(elementName) as HTMLImageElement | HTMLVideoElement
    expect(media).toHaveClass('workspace-asset-media', 'object-cover')
    expect(media).toHaveAttribute('src', `refora-asset://asset/${asset.id}`)
    expect(screen.getByText(fileName)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'workspace.assetOpen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'workspace.assetReveal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'workspace.assetDelete' })).toBeInTheDocument()

    fireEvent.contextMenu(card)
    const contextItems = vi.mocked(showContextMenu).mock.calls[0][0] as Array<{
      key: string
      onClick?: () => void
    }>
    contextItems.find((item) => item.key === 'copy')?.onClick?.()
    expect(mockCopyWorkspaceAsset).toHaveBeenCalledWith(asset.id)

    if (media instanceof HTMLVideoElement) {
      expect(media).not.toHaveAttribute('controls')
      fireEvent.mouseEnter(card)
      expect(media).toHaveAttribute('controls')
      fireEvent.mouseLeave(card)
      expect(media).not.toHaveAttribute('controls')
    }
  })

  it('renders a managed text file preview on an asset card', async () => {
    const asset: WorkspaceAsset = {
      id: 'asset-1',
      workspaceId: 'ws-1',
      fileName: 'notes.md',
      filePath: 'refora-assets/asset-1/notes.md',
      sourcePath: '/tmp/notes.md',
      mimeType: 'text/markdown',
      previewKind: 'text',
      fileSize: 20,
      fileHash: 'hash',
      fileMissing: 0,
      createdAt: 0,
      updatedAt: 0
    }
    mockAssets = [asset]
    mockItems = [{
      ...makeItem('item-asset', '', 0),
      kind: 'asset',
      docId: null,
      assetId: asset.id
    }]
    const api = window.api as unknown as Record<string, unknown>
    const workspaceAssets = api.workspaceAssets as Record<string, unknown>
    workspaceAssets.textPreview = vi.fn().mockResolvedValue({
      content: '# Managed file\n\nPreview body',
      truncated: false
    })

    const { container } = render(<Board />)

    expect(container.querySelector('[data-card-kind="asset"]')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('Managed file')).toBeInTheDocument()
      expect(screen.getByText('Preview body')).toBeInTheDocument()
    })
  })
})

describe('Board error handling', () => {
  it('reports document loading failures through the toast', async () => {
    mockItems = [
      {
        id: 'item-1',
        workspaceId: 'ws-1',
        kind: 'document',
        docId: 'doc-1',
        reportId: null,
        sortOrder: 0,
        addedAt: 0
      }
    ]
    const api = window.api as unknown as Record<string, unknown>
    const documents = api.documents as Record<string, unknown>
    documents.get = vi.fn().mockRejectedValue(new Error('DB error'))

    render(<Board />)
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('DB error')
    })
  })
})

describe('Board canvas controls and connections', () => {
  it('keeps an explicit Reset button after changing the zoom level', () => {
    render(<Board />)

    fireEvent.click(screen.getByRole('button', { name: 'workspace.canvasZoomIn' }))

    expect(screen.getByRole('button', { name: 'workspace.canvasReset' })).toHaveTextContent('Reset')
  })

  it('creates a persisted arrow connection by dragging a card-edge handle to another card', async () => {
    mockItems = [makeItem('item-1', 'doc-1', 0), makeItem('item-2', 'doc-2', 400)]
    mockConnectionsCreate.mockResolvedValue({
      id: 'connection-1',
      workspaceId: 'ws-1',
      sourceItemId: 'item-1',
      targetItemId: 'item-2',
      sourceAnchor: 'right',
      targetAnchor: 'left',
      createdAt: 1
    })
    const { container } = render(<Board />)
    const sourceHandle = container.querySelector(
      '[data-workspace-card-id="item-1"] [data-connection-handle="right"]'
    ) as HTMLButtonElement
    expect(sourceHandle.closest('[data-workspace-card]')).toHaveClass(
      'workspace-connection-accent--document'
    )
    const targetCard = container.querySelector('[data-workspace-card-id="item-2"]') as HTMLElement
    const originalElementsFromPoint = document.elementsFromPoint
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [targetCard]
    })

    fireEvent.mouseDown(sourceHandle, { button: 0, clientX: 300, clientY: 100 })
    fireEvent.mouseMove(document, { clientX: 410, clientY: 100 })
    fireEvent.mouseUp(document, { clientX: 410, clientY: 100 })

    await waitFor(() => {
      expect(mockConnectionsCreate).toHaveBeenCalledWith(
        'ws-1',
        'item-1',
        'item-2',
        'right',
        'left'
      )
    })
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint
    })
  })
})
