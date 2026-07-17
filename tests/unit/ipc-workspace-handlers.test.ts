import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRepositories } from '../../src/main/db/repositories'
import {
  createIpcHandlers,
  registerIpcHandlers,
  type IpcHandlerMap
} from '../../src/main/ipc/handlers'
import { IpcChannel } from '../../src/shared/ipc-channels'
import type { Result, Workspace, WorkspaceItem, WorkspaceNote } from '../../src/shared/ipc-types'
import {
  createMainTestDb,
  makeNewDocument,
  migrateMainTestDb,
  type MainTestDb
} from '../helpers/mainDb'

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  showMessageBox: vi.fn(),
  trashItem: vi.fn(),
  showItemInFolder: vi.fn(),
  openPath: vi.fn(),
  setProxy: vi.fn()
}))

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog,
    showSaveDialog: electronMocks.showSaveDialog,
    showMessageBox: electronMocks.showMessageBox
  },
  ipcMain: { handle: electronMocks.handle },
  shell: {
    trashItem: electronMocks.trashItem,
    showItemInFolder: electronMocks.showItemInFolder,
    openPath: electronMocks.openPath,
    openExternal: vi.fn()
  },
  session: { defaultSession: { setProxy: electronMocks.setProxy } }
}))

vi.mock('../../src/main/services/logger', () => ({
  default: {},
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

function expectOk<T>(result: Result<T>): T {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

function expectError(result: Result<unknown>, code: string): void {
  expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code }) }))
}

describe('workspace IPC handlers', () => {
  let db: MainTestDb
  let repos: ReturnType<typeof createRepositories>
  let handlers: IpcHandlerMap
  let directory: string

  beforeEach(() => {
    vi.clearAllMocks()
    directory = mkdtempSync(join(tmpdir(), 'refora-workspace-assets-'))
    electronMocks.trashItem.mockResolvedValue(undefined)
    electronMocks.openPath.mockResolvedValue('')
    db = createMainTestDb()
    repos = createRepositories(migrateMainTestDb(db))
    handlers = createIpcHandlers({
      getWin: () => null,
      getRuntime: () => ({ repos })
    })
  })

  afterEach(() => {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('round-trips workspace lifecycle operations through Result envelopes', async () => {
    const created = expectOk(handlers[IpcChannel.WorkspacesCreate]('Research'))
    expect(expectOk(handlers[IpcChannel.WorkspacesList]())).toEqual([created])

    expectOk(handlers[IpcChannel.WorkspacesRename](created.id, 'Renamed'))
    expect(expectOk(handlers[IpcChannel.WorkspacesList]())[0].name).toBe('Renamed')

    expectOk(await handlers[IpcChannel.WorkspacesDelete](created.id))
    expect(expectOk(handlers[IpcChannel.WorkspacesList]())).toEqual([])
    expectError(await handlers[IpcChannel.WorkspacesDelete]('missing'), 'not_found')
  })

  it('round-trips card add, list, reorder, resize, move, and remove operations', () => {
    const workspace = repos.workspaces.create('Board')
    repos.documents.insert(makeNewDocument('doc-1'))
    repos.documents.insert(makeNewDocument('doc-2'))

    const added = expectOk(
      handlers[IpcChannel.WorkspaceItemsAdd](
        workspace.id,
        'document',
        ['doc-1', 'doc-2'],
        { x: 10, y: 20 }
      )
    )
    expect(added).toHaveLength(2)
    expect(expectOk(handlers[IpcChannel.WorkspaceItemsList](workspace.id))).toHaveLength(2)

    const resized = expectOk(
      handlers[IpcChannel.WorkspaceItemsResize](added[0].id, 320, 240)
    )
    expect(resized).toMatchObject({ width: 320, height: 240 })

    const moved = expectOk(
      handlers[IpcChannel.WorkspaceItemsMove](added[1].id, -15, 25, 4)
    )
    expect(moved).toMatchObject({ x: -15, y: 25, zIndex: 4 })

    const orderedIds = [added[1].id, added[0].id]
    const reordered = expectOk(
      handlers[IpcChannel.WorkspaceItemsReorder](workspace.id, orderedIds)
    )
    expect(reordered.map((item) => item.id)).toEqual(orderedIds)
    expect(expectOk(handlers[IpcChannel.WorkspaceItemsList](workspace.id)).map((item) => item.id)).toEqual(
      orderedIds
    )
    const persistedOrder = db
      .prepare('SELECT id FROM workspace_items WHERE workspaceId = ? ORDER BY sortOrder')
      .all(workspace.id) as Array<{ id: string }>
    expect(persistedOrder.map((item) => item.id)).toEqual(orderedIds)

    expectOk(handlers[IpcChannel.WorkspaceItemsRemove](added[1].id))
    expect(expectOk(handlers[IpcChannel.WorkspaceItemsList](workspace.id))).toHaveLength(1)
    expectError(handlers[IpcChannel.WorkspaceItemsRemove]('missing'), 'not_found')
  })

  it('creates notes and cards atomically, then updates and deletes both', () => {
    const workspace = repos.workspaces.create('Notes')
    const note = expectOk(
      handlers[IpcChannel.WorkspaceNotesCreate](
        workspace.id,
        ' Draft ',
        'Body',
        'markdown',
        { x: 5, y: 6 }
      )
    )

    expect(note.title).toBe('Draft')
    expect(expectOk(handlers[IpcChannel.WorkspaceNotesList](workspace.id))).toEqual([note])
    expect(repos.workspaceItems.list(workspace.id)[0]).toMatchObject({
      kind: 'note',
      noteId: note.id,
      x: 5,
      y: 6
    })

    const updated = expectOk(
      handlers[IpcChannel.WorkspaceNotesUpdate](note.id, { title: 'Final', contentMd: 'Updated' })
    )
    expect(updated).toMatchObject({ title: 'Final', contentMd: 'Updated' })

    expectOk(handlers[IpcChannel.WorkspaceNotesDelete](note.id))
    expect(repos.workspaceNotes.list(workspace.id)).toEqual([])
    expect(repos.workspaceItems.list(workspace.id)).toEqual([])
  })

  it('rolls back note creation when its card placement is invalid', () => {
    const workspace = repos.workspaces.create('Atomic')
    const result = handlers[IpcChannel.WorkspaceNotesCreate](
      workspace.id,
      'Draft',
      'Body',
      'plain',
      { x: Number.NaN, y: 0 }
    )

    expectError(result, 'invalid_position')
    expect(repos.workspaceNotes.list(workspace.id)).toEqual([])
    expect(repos.workspaceItems.list(workspace.id)).toEqual([])
  })

  it('gets, updates, and validates canvas viewports through IPC', () => {
    const workspace = repos.workspaces.create('Canvas')
    expect(expectOk(handlers[IpcChannel.WorkspaceCanvasGet](workspace.id))).toEqual({
      panX: 0,
      panY: 0,
      zoom: 1
    })

    const viewport = { panX: -12, panY: 48, zoom: 1.5 }
    expect(expectOk(handlers[IpcChannel.WorkspaceCanvasUpdate](workspace.id, viewport))).toEqual(
      viewport
    )
    expectError(
      handlers[IpcChannel.WorkspaceCanvasUpdate](workspace.id, { panX: 0, panY: 0, zoom: 99 }),
      'invalid_viewport'
    )
  })

  it('round-trips workspace card connections through IPC', () => {
    const workspace = repos.workspaces.create('Connections')
    repos.documents.insert(makeNewDocument('doc-1'))
    repos.documents.insert(makeNewDocument('doc-2'))
    const items = repos.workspaceItems.add(workspace.id, 'document', ['doc-1', 'doc-2'])

    const connection = expectOk(handlers[IpcChannel.WorkspaceConnectionsCreate](
      workspace.id,
      items[0].id,
      items[1].id,
      'right',
      'left'
    ))
    expect(expectOk(handlers[IpcChannel.WorkspaceConnectionsList](workspace.id))).toEqual([connection])
    expectOk(handlers[IpcChannel.WorkspaceConnectionsDelete](connection.id))
    expect(expectOk(handlers[IpcChannel.WorkspaceConnectionsList](workspace.id))).toEqual([])
  })

  it('copies arbitrary files into managed assets and exposes text preview actions', async () => {
    repos.settings.set('libraryFolderPath', directory)
    const workspace = repos.workspaces.create('Files')
    const source = join(directory, 'source.md')
    writeFileSync(source, '# Workspace file\n\nHello')

    const result = expectOk(await handlers[IpcChannel.WorkspaceAssetsAddFiles](
      workspace.id,
      [source],
      { x: 12, y: 34 }
    ))

    expect(result.errors).toEqual([])
    expect(result.imported).toHaveLength(1)
    const asset = result.imported[0]
    expect(asset).toMatchObject({
      workspaceId: workspace.id,
      fileName: 'source.md',
      mimeType: 'text/markdown',
      previewKind: 'text'
    })
    expect(asset.filePath).toBe(`refora-assets/${asset.id}/source.md`)
    expect(existsSync(join(directory, asset.filePath))).toBe(true)
    expect(repos.workspaceItems.list(workspace.id)[0]).toMatchObject({
      kind: 'asset',
      assetId: asset.id,
      x: 12,
      y: 34
    })

    expect(expectOk(handlers[IpcChannel.WorkspaceAssetsList](workspace.id))).toEqual([asset])
    expect(expectOk(await handlers[IpcChannel.WorkspaceAssetsTextPreview](asset.id))).toEqual({
      content: '# Workspace file\n\nHello',
      truncated: false
    })
    expectOk(await handlers[IpcChannel.WorkspaceAssetsOpen](asset.id))
    expect(electronMocks.openPath).toHaveBeenCalledWith(join(directory, asset.filePath))
    expectOk(handlers[IpcChannel.WorkspaceAssetsReveal](asset.id))
    expect(electronMocks.showItemInFolder).toHaveBeenCalledWith(join(directory, asset.filePath))

    expectOk(await handlers[IpcChannel.WorkspaceAssetsDelete](asset.id))
    expect(electronMocks.trashItem).toHaveBeenCalledWith(join(directory, 'refora-assets', asset.id))
    expect(repos.workspaceAssets.get(asset.id)).toBeNull()
    expect(repos.workspaceItems.list(workspace.id)).toEqual([])
  })

  it('registers every handler and forwards invocation arguments', () => {
    registerIpcHandlers({
      getWin: () => null,
      getRuntime: () => ({ repos })
    })

    const expectedCount = Object.keys(handlers).length
    expect(electronMocks.handle).toHaveBeenCalledTimes(expectedCount)
    const registration = electronMocks.handle.mock.calls.find(
      ([channel]) => channel === IpcChannel.WorkspacesCreate
    ) as [string, (event: unknown, name: string) => Result<Workspace>] | undefined
    expect(registration).toBeDefined()

    const result = registration?.[1]({ sender: 'ignored' }, 'Registered')
    expect(result && expectOk(result).name).toBe('Registered')
  })

  it('keeps workspace handler return types serializable', () => {
    const workspace = expectOk<Workspace>(handlers[IpcChannel.WorkspacesCreate]('Serializable'))
    repos.documents.insert(makeNewDocument('doc-1'))
    const item = expectOk<WorkspaceItem[]>(
      handlers[IpcChannel.WorkspaceItemsAdd](workspace.id, 'document', ['doc-1'])
    )[0]
    const note = expectOk<WorkspaceNote>(
      handlers[IpcChannel.WorkspaceNotesCreate](workspace.id, 'Note', '', 'plain')
    )

    expect(() => JSON.stringify({ workspace, item, note })).not.toThrow()
  })
})
