import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import Board from '@renderer/components/workspace/Board'
import type { WorkspaceItem } from '@shared/ipc-types'

const DOC_MIME = 'application/x-refora-docids'

const mockAddDocs = vi.fn()
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
const { mockShowToast, mockTranslate } = vi.hoisted(() => ({
  mockShowToast: vi.fn(),
  mockTranslate: (key: string, fallback?: string) => fallback ?? key
}))

let mockItems: WorkspaceItem[] = []
let mockReports: unknown[] = []
let mockNotes: unknown[] = []
let mockActiveWorkspaceId: string | null = 'ws-1'

vi.mock('@renderer/store/workspaceStore', () => ({
  useWorkspaceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      items: mockItems,
      reports: mockReports,
      notes: mockNotes,
      activeWorkspaceId: mockActiveWorkspaceId,
      addDocs: mockAddDocs,
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
  mockAddDocs.mockReset().mockResolvedValue(undefined)
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
  mockShowToast.mockReset()
  mockItems = []
  mockReports = []
  mockNotes = []
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

  it('ignores drops with no document payload', () => {
    const { container } = render(<Board />)
    const board = container.firstElementChild as HTMLElement

    const dataTransfer = {
      types: ['Files'],
      dropEffect: 'none',
      getData: () => '',
      setData: vi.fn()
    }

    fireEvent.drop(board, { dataTransfer })
    expect(mockAddDocs).not.toHaveBeenCalled()
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
