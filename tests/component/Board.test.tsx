import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import Board from '@renderer/components/workspace/Board'
import type { WorkspaceItem } from '@shared/ipc-types'

const DOC_MIME = 'application/x-refora-docids'

const mockAddDocs = vi.fn()
const mockFetchItems = vi.fn()
const mockRemoveItem = vi.fn()
const mockDeleteReport = vi.fn()
const { mockTranslate } = vi.hoisted(() => ({
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
      deleteReport: mockDeleteReport
    })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate
  })
}))

beforeEach(() => {
  mockAddDocs.mockReset().mockResolvedValue(undefined)
  mockFetchItems.mockReset().mockResolvedValue(undefined)
  mockRemoveItem.mockReset()
  mockDeleteReport.mockReset()
  mockItems = []
  mockReports = []
  mockNotes = []
  mockActiveWorkspaceId = 'ws-1'

  const api = window.api as unknown as Record<string, unknown>
  const documents = api.documents as Record<string, unknown>
  documents.get = vi.fn().mockResolvedValue(null)
  const ai = api.ai as Record<string, unknown>
  ai.summaryGet = vi.fn().mockResolvedValue(null)
})

afterEach(() => {
  cleanup()
})

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

  it('ignores text/plain payloads without the document MIME type', async () => {
    const { container } = render(<Board />)
    const board = container.firstElementChild as HTMLElement

    const dataTransfer = {
      types: ['text/plain'],
      dropEffect: 'none',
      getData: (type: string) => (type === 'text/plain' ? 'doc-x,doc-y' : ''),
      setData: vi.fn()
    }

    fireEvent.drop(board, { dataTransfer })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mockAddDocs).not.toHaveBeenCalled()
  })

  it('ignores drops with no document payload', async () => {
    const { container } = render(<Board />)
    const board = container.firstElementChild as HTMLElement

    const dataTransfer = {
      types: ['Files'],
      dropEffect: 'none',
      getData: () => '',
      setData: vi.fn()
    }

    fireEvent.drop(board, { dataTransfer })
    await new Promise((r) => setTimeout(r, 20))
    expect(mockAddDocs).not.toHaveBeenCalled()
  })
})

describe('Board error handling', () => {
  it('does not crash when api.documents.get rejects', async () => {
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

    const { container } = render(<Board />)
    await waitFor(() => {
      expect(container.firstElementChild).toBeTruthy()
    })
  })
})
