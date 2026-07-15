import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { useWorkspaceStore } from '../../src/renderer/store/workspaceStore'
import { useDocumentStore } from '../../src/renderer/store/documentStore'
import migrationSql from '../../src/main/db/migrations/0014_workspace_board.sql?raw'
import canvasMigrationSql from '../../src/main/db/migrations/0015_workspace_canvas.sql?raw'
import noteTypesMigrationSql from '../../src/main/db/migrations/0016_workspace_note_types.sql?raw'
import type {
  AiReport,
  WorkspaceItem,
  WorkspaceItemsChangedEvent,
  WorkspaceNote
} from '../../src/shared/ipc-types'

function makeReport(overrides: Partial<AiReport> = {}): AiReport {
  return {
    id: 'r1',
    workspaceId: 'ws-1',
    title: 'Test Report',
    contentMd: 'Some content',
    sourceDocIds: [],
    model: 'gpt-4o',
    createdAt: 1700000000000,
    ...overrides
  }
}

function makeItem(overrides: Partial<WorkspaceItem> = {}): WorkspaceItem {
  return {
    id: 'item-1',
    workspaceId: 'ws-1',
    kind: 'document',
    docId: 'doc-1',
    reportId: null,
    noteId: null,
    sortOrder: 0,
    width: 300,
    height: 200,
    x: 0,
    y: 0,
    zIndex: 0,
    addedAt: 0,
    ...overrides
  }
}

function makeNote(overrides: Partial<WorkspaceNote> = {}): WorkspaceNote {
  return {
    id: 'note-1',
    workspaceId: 'ws-1',
    noteType: 'markdown',
    title: 'Note',
    contentMd: '',
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

const mockReportsList = vi.fn()
const mockReportsDelete = vi.fn()
const mockReportsUpdate = vi.fn()
const mockChatThreads = vi.fn()
const mockEventsOff = vi.fn()
const mockOnWorkspaceItemsChanged = vi.fn()
const mockOnAiSummaryUpdated = vi.fn()
const mockOnAiReportCreated = vi.fn()
const mockWorkspacesList = vi.fn()
const mockWorkspaceItemsList = vi.fn()
const mockWorkspaceItemsReorder = vi.fn()
const mockWorkspaceItemsResize = vi.fn()
const mockWorkspaceItemsMove = vi.fn()
const mockWorkspaceNotesList = vi.fn()
const mockWorkspaceNotesCreate = vi.fn()
const mockWorkspaceNotesUpdate = vi.fn()

function resetStoreState(): void {
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    activeThreadId: null,
    panelOpen: false,
    fullscreen: false,
    items: [],
    reports: [],
    notes: [],
    threads: [],
    initialized: false
  })
}

beforeEach(() => {
  mockReportsList.mockReset()
  mockReportsDelete.mockReset()
  mockReportsUpdate.mockReset()
  mockChatThreads.mockReset()
  mockEventsOff.mockReset()
  mockOnWorkspaceItemsChanged.mockReset()
  mockOnAiSummaryUpdated.mockReset()
  mockOnAiReportCreated.mockReset()
  mockWorkspacesList.mockReset()
  mockWorkspaceItemsList.mockReset()
  mockWorkspaceItemsReorder.mockReset()
  mockWorkspaceItemsResize.mockReset()
  mockWorkspaceItemsMove.mockReset()
  mockWorkspaceNotesList.mockReset()
  mockWorkspaceNotesCreate.mockReset()
  mockWorkspaceNotesUpdate.mockReset()

  mockReportsList.mockResolvedValue([])
  mockReportsDelete.mockResolvedValue(undefined)
  mockReportsUpdate.mockResolvedValue(makeReport())
  mockChatThreads.mockResolvedValue([])
  mockWorkspacesList.mockResolvedValue([])
  mockWorkspaceItemsList.mockResolvedValue([])
  mockWorkspaceItemsReorder.mockResolvedValue([])
  mockWorkspaceItemsResize.mockImplementation(async (_id: string, width: number, height: number) =>
    makeItem({ width, height })
  )
  mockWorkspaceItemsMove.mockImplementation(async (id: string, x: number, y: number, zIndex: number) =>
    makeItem({ id, x, y, zIndex })
  )
  mockWorkspaceNotesList.mockResolvedValue([])
  mockWorkspaceNotesCreate.mockResolvedValue(makeNote())
  mockWorkspaceNotesUpdate.mockResolvedValue(makeNote())

  const api = window.api as unknown as Record<string, unknown>
  const reports = api.reports as Record<string, unknown>
  reports.list = mockReportsList
  reports.delete = mockReportsDelete
  reports.update = mockReportsUpdate

  const ai = api.ai as Record<string, unknown>
  ai.chatThreads = mockChatThreads

  const events = api.events as Record<string, unknown>
  events.off = mockEventsOff
  events.onWorkspaceItemsChanged = mockOnWorkspaceItemsChanged
  events.onAiSummaryUpdated = mockOnAiSummaryUpdated
  events.onAiReportCreated = mockOnAiReportCreated

  const workspaces = api.workspaces as Record<string, unknown>
  workspaces.list = mockWorkspacesList

  const workspaceItems = api.workspaceItems as Record<string, unknown>
  workspaceItems.list = mockWorkspaceItemsList
  workspaceItems.reorder = mockWorkspaceItemsReorder
  workspaceItems.resize = mockWorkspaceItemsResize
  workspaceItems.move = mockWorkspaceItemsMove

  const workspaceNotes = api.workspaceNotes as Record<string, unknown>
  workspaceNotes.list = mockWorkspaceNotesList
  workspaceNotes.create = mockWorkspaceNotesCreate
  workspaceNotes.update = mockWorkspaceNotesUpdate

  useDocumentStore.setState({ showToast: vi.fn() })

  resetStoreState()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('WorkspaceStore', () => {
  describe('deleteReport', () => {
    it('optimistically removes the report from state', async () => {
      const r1 = makeReport({ id: 'r1' })
      const r2 = makeReport({ id: 'r2', title: 'Second' })
      useWorkspaceStore.setState({ reports: [r1, r2] })
      mockReportsDelete.mockResolvedValue(undefined)

      const promise = useWorkspaceStore.getState().deleteReport('r1')
      expect(useWorkspaceStore.getState().reports).toEqual([r2])
      await promise
      expect(mockReportsDelete).toHaveBeenCalledWith('r1')
      expect(useWorkspaceStore.getState().reports).toEqual([r2])
    })

    it('restores the report on failure', async () => {
      const r1 = makeReport({ id: 'r1' })
      const r2 = makeReport({ id: 'r2', title: 'Second' })
      useWorkspaceStore.setState({ reports: [r1, r2] })
      mockReportsDelete.mockRejectedValue(new Error('network'))

      await useWorkspaceStore.getState().deleteReport('r1')

      expect(useWorkspaceStore.getState().reports).toEqual([r1, r2])
    })
  })

  describe('fetchReports', () => {
    it('populates reports from api', async () => {
      const reports = [makeReport({ id: 'r1' })]
      mockReportsList.mockResolvedValue(reports)
      useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1' })

      await useWorkspaceStore.getState().fetchReports()

      expect(mockReportsList).toHaveBeenCalledWith('ws-1')
      expect(useWorkspaceStore.getState().reports).toEqual(reports)
    })

    it('clears reports when no active workspace', async () => {
      useWorkspaceStore.setState({ activeWorkspaceId: null, reports: [makeReport()] })
      await useWorkspaceStore.getState().fetchReports()
      expect(useWorkspaceStore.getState().reports).toEqual([])
    })
  })

  describe('updateReport', () => {
    it('does not restore reports from a workspace that is no longer active', async () => {
      let rejectUpdate!: (error: Error) => void
      mockReportsUpdate.mockReturnValue(new Promise((_resolve, reject) => {
        rejectUpdate = reject
      }))
      useWorkspaceStore.setState({
        activeWorkspaceId: 'ws-1',
        reports: [makeReport({ workspaceId: 'ws-1' })]
      })

      const update = useWorkspaceStore.getState().updateReport('r1', { title: 'Changed' })
      const nextReports = [makeReport({ id: 'r2', workspaceId: 'ws-2' })]
      useWorkspaceStore.setState({ activeWorkspaceId: 'ws-2', reports: nextReports })
      rejectUpdate(new Error('network'))

      await update
      expect(useWorkspaceStore.getState().reports).toEqual(nextReports)
    })
  })

  describe('setActiveWorkspace', () => {
    it('sets active workspace and fetches the latest thread', async () => {
      mockChatThreads.mockResolvedValue([
        { id: 'thread-1', workspaceId: 'ws-1', providerId: 'p1', createdAt: 0 }
      ])

      useWorkspaceStore.getState().setActiveWorkspace('ws-1')

      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-1')
      expect(useWorkspaceStore.getState().panelOpen).toBe(true)
      await vi.waitFor(() => {
        expect(useWorkspaceStore.getState().activeThreadId).toBe('thread-1')
      })
    })

    it('sets activeThreadId to null when no threads exist', async () => {
      mockChatThreads.mockResolvedValue([])

      useWorkspaceStore.getState().setActiveWorkspace('ws-1')

      await vi.waitFor(() => {
        expect(useWorkspaceStore.getState().activeThreadId).toBe(null)
      })
    })

    it('clears content from the previous workspace immediately', () => {
      useWorkspaceStore.setState({
        activeWorkspaceId: 'ws-old',
        items: [makeItem({ workspaceId: 'ws-old' })],
        reports: [makeReport({ workspaceId: 'ws-old' })],
        notes: [makeNote({ workspaceId: 'ws-old' })]
      })

      useWorkspaceStore.getState().setActiveWorkspace('ws-new')

      expect(useWorkspaceStore.getState().items).toEqual([])
      expect(useWorkspaceStore.getState().reports).toEqual([])
      expect(useWorkspaceStore.getState().notes).toEqual([])
    })

    it('ignores an item response from a workspace that is no longer active', async () => {
      let resolveFirst!: (items: WorkspaceItem[]) => void
      let resolveSecond!: (items: WorkspaceItem[]) => void
      mockWorkspaceItemsList.mockImplementation((workspaceId: string) => new Promise<WorkspaceItem[]>((resolve) => {
        if (workspaceId === 'ws-1') resolveFirst = resolve
        else resolveSecond = resolve
      }))

      useWorkspaceStore.getState().setActiveWorkspace('ws-1')
      useWorkspaceStore.getState().setActiveWorkspace('ws-2')
      const secondItem = makeItem({ id: 'item-2', workspaceId: 'ws-2' })
      resolveSecond([secondItem])

      await vi.waitFor(() => {
        expect(useWorkspaceStore.getState().items).toEqual([secondItem])
      })

      resolveFirst([makeItem({ workspaceId: 'ws-1' })])
      await Promise.resolve()
      expect(useWorkspaceStore.getState().items).toEqual([secondItem])
    })
  })

  describe('board layout', () => {
    it('optimistically reorders all item kinds and keeps the saved order', async () => {
      const first = makeItem({ id: 'first', sortOrder: 0 })
      const second = makeItem({
        id: 'second',
        kind: 'report',
        docId: null,
        reportId: 'r1',
        sortOrder: 1
      })
      const saved = [{ ...second, sortOrder: 0 }, { ...first, sortOrder: 1 }]
      useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', items: [first, second] })
      mockWorkspaceItemsReorder.mockResolvedValue(saved)

      const promise = useWorkspaceStore.getState().reorderItems(['second', 'first'])
      expect(useWorkspaceStore.getState().items.map((item) => item.id)).toEqual(['second', 'first'])
      await promise

      expect(mockWorkspaceItemsReorder).toHaveBeenCalledWith('ws-1', ['second', 'first'])
      expect(useWorkspaceStore.getState().items).toEqual(saved)
    })

    it('restores the previous card size when persistence fails', async () => {
      const item = makeItem()
      useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', items: [item] })
      mockWorkspaceItemsResize.mockRejectedValue(new Error('disk'))

      const saved = await useWorkspaceStore.getState().resizeItem(item.id, 420, 280)

      expect(saved).toBe(false)
      expect(useWorkspaceStore.getState().items).toEqual([item])
    })

    it('preserves unrelated item changes when a resize fails', async () => {
      const first = makeItem({ id: 'first' })
      const second = makeItem({ id: 'second' })
      useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', items: [first, second] })
      mockWorkspaceItemsResize.mockRejectedValue(new Error('disk'))

      const resize = useWorkspaceStore.getState().resizeItem(first.id, 420, 280)
      useWorkspaceStore.setState((state) => ({
        items: state.items.map((item) =>
          item.id === second.id ? { ...item, x: 900 } : item
        )
      }))

      await resize
      expect(useWorkspaceStore.getState().items).toEqual([first, { ...second, x: 900 }])
    })

    it('persists a freely positioned card in world coordinates', async () => {
      const item = makeItem()
      useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', items: [item] })

      const saved = await useWorkspaceStore.getState().moveItem(item.id, -240, 460, 7)

      expect(saved).toBe(true)
      expect(mockWorkspaceItemsMove).toHaveBeenCalledWith(item.id, -240, 460, 7)
      expect(useWorkspaceStore.getState().items[0]).toMatchObject({ x: -240, y: 460, zIndex: 7 })
    })

    it('restores the previous position when persistence fails', async () => {
      const item = makeItem({ x: 20, y: 40, zIndex: 2 })
      useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', items: [item] })
      mockWorkspaceItemsMove.mockRejectedValue(new Error('disk'))

      const saved = await useWorkspaceStore.getState().moveItem(item.id, 500, -120, 6)

      expect(saved).toBe(false)
      expect(useWorkspaceStore.getState().items).toEqual([item])
    })
  })

  describe('workspace notes', () => {
    it('creates a note and refreshes the unified item list', async () => {
      const note = makeNote()
      const item = makeItem({
        id: 'note-item',
        kind: 'note',
        docId: null,
        noteId: note.id
      })
      useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1' })
      mockWorkspaceNotesCreate.mockResolvedValue(note)
      mockWorkspaceItemsList.mockResolvedValue([item])

      const created = await useWorkspaceStore.getState().createNote(note.title, note.contentMd, note.noteType)

      expect(mockWorkspaceNotesCreate).toHaveBeenCalledWith('ws-1', note.title, note.contentMd, 'markdown')
      expect(created).toEqual(note)
      expect(useWorkspaceStore.getState().notes).toEqual([note])
      expect(useWorkspaceStore.getState().items).toEqual([item])
    })

    it('does not restore notes from a workspace that is no longer active', async () => {
      let rejectUpdate!: (error: Error) => void
      mockWorkspaceNotesUpdate.mockReturnValue(new Promise((_resolve, reject) => {
        rejectUpdate = reject
      }))
      useWorkspaceStore.setState({
        activeWorkspaceId: 'ws-1',
        notes: [makeNote({ workspaceId: 'ws-1' })]
      })

      const update = useWorkspaceStore.getState().updateNote('note-1', { title: 'Changed' })
      const nextNotes = [makeNote({ id: 'note-2', workspaceId: 'ws-2' })]
      useWorkspaceStore.setState({ activeWorkspaceId: 'ws-2', notes: nextNotes })
      rejectUpdate(new Error('network'))

      await update
      expect(useWorkspaceStore.getState().notes).toEqual(nextNotes)
    })
  })

  describe('startNewChat', () => {
    it('clears the active thread id', () => {
      useWorkspaceStore.setState({ activeThreadId: 'thread-1' })
      useWorkspaceStore.getState().startNewChat()
      expect(useWorkspaceStore.getState().activeThreadId).toBe(null)
    })
  })

  describe('onWorkspaceItemsChanged', () => {
    it('fetches items when workspaceId matches active workspace', async () => {
      useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1' })
      useWorkspaceStore.getState().init()

      expect(mockOnWorkspaceItemsChanged).toHaveBeenCalledTimes(1)
      const cb = mockOnWorkspaceItemsChanged.mock.calls[0][0] as (
        payload: WorkspaceItemsChangedEvent
      ) => void
      cb({ workspaceId: 'ws-1', reason: 'agent_add_docs' })

      await vi.waitFor(() => {
        expect(mockWorkspaceItemsList).toHaveBeenCalledWith('ws-1')
      })
    })

    it('does not fetch items when workspaceId does not match', async () => {
      useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1' })
      useWorkspaceStore.getState().init()

      const cb = mockOnWorkspaceItemsChanged.mock.calls[0][0] as (
        payload: WorkspaceItemsChangedEvent
      ) => void
      cb({ workspaceId: 'ws-other', reason: 'user' })

      await new Promise((r) => setTimeout(r, 50))
      expect(mockWorkspaceItemsList).not.toHaveBeenCalled()
    })
  })
})

describe('workspace board migration', () => {
  let directory: string
  let dbPath: string

  const runSql = (sql: string) => {
    execFileSync('/usr/bin/sqlite3', [dbPath], {
      input: `PRAGMA foreign_keys = ON;\n${sql}`,
      encoding: 'utf8'
    })
  }

  const query = <T>(sql: string): T[] => {
    const output = execFileSync('/usr/bin/sqlite3', ['-json', dbPath], {
      input: `PRAGMA foreign_keys = ON;\n${sql}`,
      encoding: 'utf8'
    })
    return output.trim() ? JSON.parse(output) as T[] : []
  }

  const rejectsSql = (sql: string): boolean => {
    const result = spawnSync('/usr/bin/sqlite3', [dbPath], {
      input: `PRAGMA foreign_keys = ON;\n${sql}`,
      encoding: 'utf8'
    })
    return result.status !== 0
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'refora-workspace-migration-'))
    dbPath = join(directory, 'test.sqlite')
    runSql(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE TABLE documents (id TEXT PRIMARY KEY);
      CREATE TABLE ai_reports (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        title TEXT NOT NULL,
        contentMd TEXT NOT NULL,
        sourceDocIds TEXT NOT NULL DEFAULT '[]',
        model TEXT,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (workspaceId) REFERENCES workspaces(id) ON DELETE CASCADE
      );
      CREATE TABLE workspace_items (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        kind TEXT NOT NULL,
        docId TEXT,
        reportId TEXT,
        sortOrder INTEGER NOT NULL DEFAULT 0,
        addedAt INTEGER NOT NULL,
        FOREIGN KEY (workspaceId) REFERENCES workspaces(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_workspace_items_ws ON workspace_items(workspaceId);
      INSERT INTO workspaces VALUES ('ws-1', 'Research', 1, 1);
      INSERT INTO documents VALUES ('doc-1');
      INSERT INTO ai_reports VALUES ('report-1', 'ws-1', 'Pinned', '# Pinned', '[]', NULL, 2);
      INSERT INTO ai_reports VALUES ('report-2', 'ws-1', 'Unpinned', '# Unpinned', '[]', NULL, 3);
      INSERT INTO workspace_items VALUES ('item-doc', 'ws-1', 'document', 'doc-1', NULL, 0, 1);
      INSERT INTO workspace_items VALUES ('item-doc-duplicate', 'ws-1', 'document', 'doc-1', NULL, 1, 2);
      INSERT INTO workspace_items VALUES ('item-report', 'ws-1', 'report', NULL, 'report-1', 2, 2);
      INSERT INTO workspace_items VALUES ('item-orphan', 'ws-1', 'document', 'missing', NULL, 3, 2);
    `)
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('deduplicates old items, removes orphans, and preserves every report', () => {
    runSql(migrationSql)
    runSql(canvasMigrationSql)
    runSql(noteTypesMigrationSql)

    const items = query<Record<string, unknown>>(
      'SELECT kind, docId, reportId, noteId, width, height, x, y, zIndex FROM workspace_items ORDER BY sortOrder;'
    )

    expect(items).toHaveLength(3)
    expect(items.filter((item) => item.docId === 'doc-1')).toHaveLength(1)
    expect(items.map((item) => item.reportId).filter(Boolean)).toEqual(['report-1', 'report-2'])
    expect(items.every((item) => item.width === 300 && item.height === 200)).toBe(true)
    expect(items.map((item) => [item.x, item.y, item.zIndex])).toEqual([
      [0, 0, 0],
      [664, 0, 2],
      [996, 0, 3]
    ])
  })

  it('enforces item type, reference, size, and uniqueness constraints', () => {
    runSql(migrationSql)
    runSql(canvasMigrationSql)
    runSql(noteTypesMigrationSql)
    runSql(`
      INSERT INTO workspace_notes (id, workspaceId, title, contentMd, createdAt, updatedAt)
      VALUES ('note-1', 'ws-1', 'Note', '', 4, 4);
      INSERT INTO workspace_items
        (id, workspaceId, kind, docId, reportId, noteId, sortOrder, width, height, addedAt)
      VALUES ('item-note', 'ws-1', 'note', NULL, NULL, 'note-1', 3, 320, 240, 4);
    `)

    expect(rejectsSql(`
      INSERT INTO workspace_items
        (id, workspaceId, kind, docId, reportId, noteId, sortOrder, width, height, addedAt)
      VALUES ('bad-kind', 'ws-1', 'other', NULL, NULL, NULL, 4, 300, 200, 4);
    `)).toBe(true)
    expect(rejectsSql(`
      INSERT INTO workspace_items
        (id, workspaceId, kind, docId, reportId, noteId, sortOrder, width, height, addedAt)
      VALUES ('bad-size', 'ws-1', 'note', NULL, NULL, 'note-1', 4, 900, 200, 4);
    `)).toBe(true)
    expect(rejectsSql(`
      INSERT INTO workspace_items
        (id, workspaceId, kind, docId, reportId, noteId, sortOrder, width, height, addedAt)
      VALUES ('duplicate-doc', 'ws-1', 'document', 'doc-1', NULL, NULL, 4, 300, 200, 4);
    `)).toBe(true)
  })

  it('removes a report card when its report is deleted', () => {
    runSql(migrationSql)
    runSql(canvasMigrationSql)
    runSql(noteTypesMigrationSql)
    runSql("DELETE FROM ai_reports WHERE id = 'report-1';")

    const items = query<{ id: string }>("SELECT id FROM workspace_items WHERE reportId = 'report-1';")
    expect(items).toEqual([])
  })

  it('persists one bounded viewport per workspace and cascades it on deletion', () => {
    runSql(migrationSql)
    runSql(canvasMigrationSql)
    runSql(noteTypesMigrationSql)
    runSql(`
      INSERT INTO workspace_canvas_state (workspaceId, panX, panY, zoom, updatedAt)
      VALUES ('ws-1', -240.5, 320.25, 1.75, 5);
    `)

    expect(query<Record<string, unknown>>('SELECT panX, panY, zoom FROM workspace_canvas_state;')).toEqual([
      { panX: -240.5, panY: 320.25, zoom: 1.75 }
    ])
    expect(rejectsSql(`
      UPDATE workspace_canvas_state SET zoom = 4 WHERE workspaceId = 'ws-1';
    `)).toBe(true)

    runSql("DELETE FROM workspaces WHERE id = 'ws-1';")
    expect(query<Record<string, unknown>>('SELECT * FROM workspace_canvas_state;')).toEqual([])
  })

  it('defaults existing notes to markdown and constrains new note types', () => {
    runSql(migrationSql)
    runSql(canvasMigrationSql)
    runSql(`
      INSERT INTO workspace_notes (id, workspaceId, title, contentMd, createdAt, updatedAt)
      VALUES ('legacy-note', 'ws-1', 'Legacy', '', 4, 4);
    `)
    runSql(noteTypesMigrationSql)
    runSql(`
      INSERT INTO workspace_notes (id, workspaceId, noteType, title, contentMd, createdAt, updatedAt)
      VALUES ('sticky-note', 'ws-1', 'plain', 'Sticky', 'Text', 5, 5);
    `)

    expect(query<{ id: string; noteType: string }>(
      'SELECT id, noteType FROM workspace_notes ORDER BY id;'
    )).toEqual([
      { id: 'legacy-note', noteType: 'markdown' },
      { id: 'sticky-note', noteType: 'plain' }
    ])
    expect(rejectsSql(`
      INSERT INTO workspace_notes (id, workspaceId, noteType, title, contentMd, createdAt, updatedAt)
      VALUES ('bad-note', 'ws-1', 'rich-text', 'Bad', '', 6, 6);
    `)).toBe(true)
  })
})
