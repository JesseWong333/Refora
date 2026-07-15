import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRepositories } from '../../src/main/db/repositories'
import { RepoError } from '../../src/main/db/repositories/errors'
import {
  WORKSPACE_CANVAS_MAX_ZOOM,
  WORKSPACE_CANVAS_MIN_ZOOM,
  WORKSPACE_CARD_MAX_HEIGHT,
  WORKSPACE_CARD_MAX_WIDTH,
  WORKSPACE_CARD_MIN_HEIGHT,
  WORKSPACE_CARD_MIN_WIDTH
} from '../../src/shared/ipc-types'
import {
  createMainTestDb,
  makeNewDocument,
  migrateMainTestDb,
  type MainTestDb
} from '../helpers/mainDb'

function expectRepoError(action: () => unknown, code: string): void {
  expect(action).toThrowError(expect.objectContaining({ code }))
}

describe('workspace repositories', () => {
  let db: MainTestDb
  let repos: ReturnType<typeof createRepositories>
  let workspaceId: string

  beforeEach(() => {
    db = createMainTestDb()
    repos = createRepositories(migrateMainTestDb(db))
    workspaceId = repos.workspaces.create('Research').id
  })

  it('creates, orders, renames, and deletes workspaces', () => {
    vi.spyOn(Date, 'now').mockReturnValue(9_999_999_999_999)
    const second = repos.workspaces.create('Second')

    expect(repos.workspaces.list().map((workspace) => workspace.id)).toEqual([second.id, workspaceId])
    repos.workspaces.rename(workspaceId, 'Renamed')
    expect(repos.workspaces.list().find((workspace) => workspace.id === workspaceId)?.name).toBe('Renamed')

    repos.workspaces.delete(workspaceId)
    expect(repos.workspaces.list().map((workspace) => workspace.id)).toEqual([second.id])
    expectRepoError(() => repos.workspaces.rename('missing', 'No'), 'not_found')
    expectRepoError(() => repos.workspaces.delete('missing'), 'not_found')
  })

  it('adds unique document, report, and note cards with deterministic placement', () => {
    repos.documents.insert(makeNewDocument('doc-1'))
    repos.documents.insert(makeNewDocument('doc-2'))
    const report = repos.aiReports.create({
      workspaceId,
      title: 'Report',
      contentMd: 'Body',
      sourceDocIds: ['doc-1'],
      model: null
    })
    const note = repos.workspaceNotes.create(workspaceId, 'Note', 'Body', 'markdown')

    const docs = repos.workspaceItems.add(workspaceId, 'document', ['doc-1', '', 'doc-1', 'doc-2'], {
      x: 10,
      y: 20
    })
    expect(docs).toHaveLength(2)
    expect(docs.map(({ docId, x, y }) => ({ docId, x, y }))).toEqual([
      { docId: 'doc-1', x: 10, y: 20 },
      { docId: 'doc-2', x: 38, y: 20 }
    ])

    const duplicate = repos.workspaceItems.add(workspaceId, 'document', ['doc-1'])
    expect(duplicate).toEqual([docs[0]])
    expect(repos.workspaceItems.add(workspaceId, 'report', [report.id])).toHaveLength(1)
    expect(repos.workspaceItems.add(workspaceId, 'note', [note.id])).toHaveLength(1)
    expect(repos.workspaceItems.add(workspaceId, 'document', ['', ''])).toEqual([])

    expect(repos.workspaceItems.list(workspaceId)).toHaveLength(4)
  })

  it('rejects invalid card sources, kinds, workspaces, and placements', () => {
    repos.documents.insert(makeNewDocument('doc-1'))
    const otherWorkspace = repos.workspaces.create('Other')
    const report = repos.aiReports.create({
      workspaceId: otherWorkspace.id,
      title: 'Other report',
      contentMd: '',
      sourceDocIds: [],
      model: null
    })

    expectRepoError(
      () => repos.workspaceItems.add(workspaceId, 'invalid' as never, ['doc-1']),
      'invalid_kind'
    )
    expectRepoError(() => repos.workspaceItems.add('missing', 'document', ['doc-1']), 'not_found')
    expectRepoError(() => repos.workspaceItems.add(workspaceId, 'document', ['missing']), 'not_found')
    expectRepoError(() => repos.workspaceItems.add(workspaceId, 'report', [report.id]), 'not_found')
    expectRepoError(
      () => repos.workspaceItems.add(workspaceId, 'document', ['doc-1'], { x: Number.NaN, y: 0 }),
      'invalid_position'
    )
  })

  it('reorders, resizes, moves, and removes cards', () => {
    repos.documents.insert(makeNewDocument('doc-1'))
    repos.documents.insert(makeNewDocument('doc-2'))
    const items = repos.workspaceItems.add(workspaceId, 'document', ['doc-1', 'doc-2'])

    const orderedIds = [items[1].id, items[0].id]
    const reordered = repos.workspaceItems.reorder(workspaceId, orderedIds)
    const persistedOrder = db
      .prepare('SELECT id FROM workspace_items WHERE workspaceId = ? ORDER BY sortOrder')
      .all(workspaceId) as Array<{ id: string }>
    expect(persistedOrder.map((item) => item.id)).toEqual(orderedIds)
    expect(reordered.map((item) => item.id)).toEqual(orderedIds)
    expect(reordered.map((item) => item.sortOrder)).toEqual([0, 1])
    expect(repos.workspaceItems.list(workspaceId).map((item) => item.id)).toEqual(orderedIds)

    const resized = repos.workspaceItems.resize(
      items[0].id,
      WORKSPACE_CARD_MIN_WIDTH,
      WORKSPACE_CARD_MAX_HEIGHT
    )
    expect(resized).toMatchObject({
      width: WORKSPACE_CARD_MIN_WIDTH,
      height: WORKSPACE_CARD_MAX_HEIGHT
    })

    const moved = repos.workspaceItems.move(items[0].id, -12.5, 48.25, 7)
    expect(moved).toMatchObject({ x: -12.5, y: 48.25, zIndex: 7 })

    repos.workspaceItems.remove(items[1].id)
    expect(repos.workspaceItems.list(workspaceId).map((item) => item.id)).toEqual([items[0].id])
    expectRepoError(() => repos.workspaceItems.remove(items[1].id), 'not_found')
  })

  it('validates complete reorder sets, card sizes, and card positions', () => {
    repos.documents.insert(makeNewDocument('doc-1'))
    repos.documents.insert(makeNewDocument('doc-2'))
    const items = repos.workspaceItems.add(workspaceId, 'document', ['doc-1', 'doc-2'])

    for (const orderedIds of [[items[0].id], [items[0].id, items[0].id], [items[0].id, 'missing']]) {
      expectRepoError(() => repos.workspaceItems.reorder(workspaceId, orderedIds), 'invalid_order')
    }
    expectRepoError(() => repos.workspaceItems.reorder('missing', []), 'not_found')

    for (const [width, height] of [
      [WORKSPACE_CARD_MIN_WIDTH - 1, WORKSPACE_CARD_MIN_HEIGHT],
      [WORKSPACE_CARD_MAX_WIDTH + 1, WORKSPACE_CARD_MIN_HEIGHT],
      [WORKSPACE_CARD_MIN_WIDTH, WORKSPACE_CARD_MIN_HEIGHT - 1],
      [WORKSPACE_CARD_MIN_WIDTH, WORKSPACE_CARD_MAX_HEIGHT + 1],
      [WORKSPACE_CARD_MIN_WIDTH + 0.5, WORKSPACE_CARD_MIN_HEIGHT]
    ]) {
      expectRepoError(() => repos.workspaceItems.resize(items[0].id, width, height), 'invalid_size')
    }
    expectRepoError(
      () => repos.workspaceItems.resize('missing', WORKSPACE_CARD_MIN_WIDTH, WORKSPACE_CARD_MIN_HEIGHT),
      'not_found'
    )

    for (const [x, y, zIndex] of [
      [Number.NaN, 0, 0],
      [0, Number.POSITIVE_INFINITY, 0],
      [0, 0, -1],
      [0, 0, 0.5]
    ]) {
      expectRepoError(() => repos.workspaceItems.move(items[0].id, x, y, zIndex), 'invalid_position')
    }
    expectRepoError(() => repos.workspaceItems.move('missing', 0, 0, 0), 'not_found')
  })

  it('removes cards by their source identifiers', () => {
    repos.documents.insert(makeNewDocument('doc-1'))
    const report = repos.aiReports.create({
      workspaceId,
      title: 'Report',
      contentMd: '',
      sourceDocIds: [],
      model: null
    })
    const note = repos.workspaceNotes.create(workspaceId, 'Note', '', 'plain')
    repos.workspaceItems.add(workspaceId, 'document', ['doc-1'])
    repos.workspaceItems.add(workspaceId, 'report', [report.id])
    repos.workspaceItems.add(workspaceId, 'note', [note.id])

    repos.workspaceItems.removeByDocId('doc-1')
    repos.workspaceItems.removeByReportId(report.id)
    repos.workspaceItems.removeByNoteId(note.id)
    expect(repos.workspaceItems.list(workspaceId)).toEqual([])
  })

  it('creates, updates, orders, and deletes workspace notes', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(200)
      .mockReturnValueOnce(200)
      .mockReturnValueOnce(300)
      .mockReturnValueOnce(300)
    const first = repos.workspaceNotes.create(workspaceId, ' First ', 'One', 'markdown')
    const second = repos.workspaceNotes.create(workspaceId, 'Second', 'Two', 'plain')
    const updated = repos.workspaceNotes.update(first.id, { title: ' Updated ' })

    expect(updated).toMatchObject({ title: 'Updated', contentMd: 'One', noteType: 'markdown' })
    expect(repos.workspaceNotes.list(workspaceId).map((note) => note.id)).toEqual([first.id, second.id])

    repos.workspaceNotes.delete(second.id)
    expect(repos.workspaceNotes.list(workspaceId).map((note) => note.id)).toEqual([first.id])
  })

  it('rejects invalid and missing workspace notes', () => {
    expectRepoError(() => repos.workspaceNotes.create(workspaceId, '   ', '', 'markdown'), 'invalid_title')
    expectRepoError(() => repos.workspaceNotes.create('missing', 'Title', '', 'markdown'), 'not_found')
    expectRepoError(() => repos.workspaceNotes.update('missing', { title: 'Title' }), 'not_found')
    expectRepoError(() => repos.workspaceNotes.delete('missing'), 'not_found')

    const note = repos.workspaceNotes.create(workspaceId, 'Valid', 'Body', 'plain')
    expectRepoError(() => repos.workspaceNotes.update(note.id, { title: ' ' }), 'invalid_title')
    const updated = repos.workspaceNotes.update(note.id, { contentMd: 'Updated body' })
    expect(updated).toMatchObject({ title: 'Valid', contentMd: 'Updated body', noteType: 'plain' })
  })

  it('provides, persists, and validates canvas viewports', () => {
    expect(repos.workspaceCanvas.get(workspaceId)).toEqual({ panX: 0, panY: 0, zoom: 1 })

    const viewport = { panX: -20.5, panY: 30.25, zoom: WORKSPACE_CANVAS_MIN_ZOOM }
    expect(repos.workspaceCanvas.update(workspaceId, viewport)).toEqual(viewport)
    const next = { panX: 0, panY: 0, zoom: WORKSPACE_CANVAS_MAX_ZOOM }
    expect(repos.workspaceCanvas.update(workspaceId, next)).toEqual(next)
    expect(repos.workspaceCanvas.get(workspaceId)).toEqual(next)

    expectRepoError(() => repos.workspaceCanvas.get('missing'), 'not_found')
    for (const invalid of [
      { panX: Number.NaN, panY: 0, zoom: 1 },
      { panX: 0, panY: Number.POSITIVE_INFINITY, zoom: 1 },
      { panX: 0, panY: 0, zoom: WORKSPACE_CANVAS_MIN_ZOOM - 0.01 },
      { panX: 0, panY: 0, zoom: WORKSPACE_CANVAS_MAX_ZOOM + 0.01 }
    ]) {
      expectRepoError(() => repos.workspaceCanvas.update(workspaceId, invalid), 'invalid_viewport')
    }
  })

  it('commits and rolls back outer and nested transactions', () => {
    repos.transaction(() => {
      repos.workspaces.create('Committed')
    })
    expect(repos.workspaces.list().some((workspace) => workspace.name === 'Committed')).toBe(true)

    expect(() =>
      repos.transaction(() => {
        repos.workspaces.create('Rolled back')
        throw new Error('rollback')
      })
    ).toThrow('rollback')
    expect(repos.workspaces.list().some((workspace) => workspace.name === 'Rolled back')).toBe(false)

    repos.transaction(() => {
      repos.workspaces.create('Outer')
      try {
        repos.transaction(() => {
          repos.workspaces.create('Nested rollback')
          throw new Error('nested')
        })
      } catch {
        repos.workspaces.create('After nested rollback')
      }
    })
    expect(repos.workspaces.list().map((workspace) => workspace.name)).toEqual(
      expect.arrayContaining(['Outer', 'After nested rollback'])
    )
    expect(repos.workspaces.list().some((workspace) => workspace.name === 'Nested rollback')).toBe(false)
  })

  it('rejects asynchronous transaction callbacks and rolls back their synchronous writes', () => {
    expect(() =>
      repos.transaction(async () => {
        repos.workspaces.create('Async write')
      })
    ).toThrowError(expect.objectContaining<Partial<RepoError>>({ code: 'transaction_callback_must_be_sync' }))
    expect(repos.workspaces.list().some((workspace) => workspace.name === 'Async write')).toBe(false)
  })
})
