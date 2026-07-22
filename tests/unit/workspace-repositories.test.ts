import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRepositories } from '../../src/main/db/repositories'
import { RepoError } from '../../src/main/db/repositories/errors'
import {
  WORKSPACE_CANVAS_MAX_ZOOM,
  WORKSPACE_CANVAS_MIN_ZOOM
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

  it('adds unique document, report, note, and asset cards with deterministic placement', () => {
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
    const asset = repos.workspaceAssets.insert({
      id: 'asset-1',
      workspaceId,
      fileName: 'notes.txt',
      filePath: 'refora-assets/asset-1/notes.txt',
      sourcePath: '/tmp/notes.txt',
      mimeType: 'text/plain',
      previewKind: 'text',
      fileSize: 12,
      fileHash: 'hash',
      fileMissing: 0,
      createdAt: 100,
      updatedAt: 100
    })

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
    expect(repos.workspaceItems.add(workspaceId, 'asset', [asset.id])).toHaveLength(1)
    expect(repos.workspaceItems.add(workspaceId, 'document', ['', ''])).toEqual([])

    expect(repos.workspaceItems.list(workspaceId)).toHaveLength(5)
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

    const resized = repos.workspaceItems.resize(items[0].id, 1, 10_000)
    expect(resized).toMatchObject({
      width: 1,
      height: 10_000
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
      [0, 100],
      [-1, 100],
      [100, 0],
      [100, -1],
      [100.5, 100],
      [100, Number.POSITIVE_INFINITY]
    ]) {
      expectRepoError(() => repos.workspaceItems.resize(items[0].id, width, height), 'invalid_size')
    }
    expectRepoError(
      () => repos.workspaceItems.resize('missing', 1, 1),
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
    const asset = repos.workspaceAssets.insert({
      id: 'asset-1',
      workspaceId,
      fileName: 'data.bin',
      filePath: 'refora-assets/asset-1/data.bin',
      sourcePath: '/tmp/data.bin',
      mimeType: 'application/octet-stream',
      previewKind: 'none',
      fileSize: 1,
      fileHash: 'hash',
      fileMissing: 0,
      createdAt: 100,
      updatedAt: 100
    })
    repos.workspaceItems.add(workspaceId, 'document', ['doc-1'])
    repos.workspaceItems.add(workspaceId, 'report', [report.id])
    repos.workspaceItems.add(workspaceId, 'note', [note.id])
    repos.workspaceItems.add(workspaceId, 'asset', [asset.id])

    repos.workspaceItems.removeByDocId('doc-1')
    repos.workspaceItems.removeByReportId(report.id)
    repos.workspaceItems.removeByNoteId(note.id)
    repos.workspaceItems.removeByAssetId(asset.id)
    expect(repos.workspaceItems.list(workspaceId)).toEqual([])
  })

  it('keeps workspace assets scoped to their workspace and cascades asset cards', () => {
    const asset = repos.workspaceAssets.insert({
      id: 'asset-1',
      workspaceId,
      fileName: 'image.png',
      filePath: 'refora-assets/asset-1/image.png',
      sourcePath: '/tmp/image.png',
      mimeType: 'image/png',
      previewKind: 'image',
      fileSize: 10,
      fileHash: 'hash',
      fileMissing: 0,
      createdAt: 100,
      updatedAt: 100
    })
    const otherWorkspace = repos.workspaces.create('Other')

    expectRepoError(() => repos.workspaceItems.add(otherWorkspace.id, 'asset', [asset.id]), 'not_found')
    const item = repos.workspaceItems.add(workspaceId, 'asset', [asset.id])[0]
    expect(item).toMatchObject({ kind: 'asset', assetId: asset.id })

    repos.workspaceAssets.delete(asset.id)
    expect(repos.workspaceItems.list(workspaceId)).toEqual([])
  })

  it('searches workspace files across workspaces with literal wildcard handling', () => {
    const otherWorkspace = repos.workspaces.create('Experiments')
    repos.workspaceAssets.insert({
      id: 'asset-search',
      workspaceId,
      fileName: 'survey_100%.csv',
      filePath: 'refora-assets/asset-search/survey_100%.csv',
      sourcePath: '/tmp/survey_100%.csv',
      mimeType: 'text/csv',
      previewKind: 'text',
      fileSize: 10,
      fileHash: 'search-hash',
      fileMissing: 0,
      createdAt: 100,
      updatedAt: 200
    })
    repos.workspaceAssets.insert({
      id: 'asset-other',
      workspaceId: otherWorkspace.id,
      fileName: 'image.png',
      filePath: 'refora-assets/asset-other/image.png',
      sourcePath: '/tmp/image.png',
      mimeType: 'image/png',
      previewKind: 'image',
      fileSize: 20,
      fileHash: 'other-hash',
      fileMissing: 0,
      createdAt: 300,
      updatedAt: 300
    })

    expect(repos.workspaceAssets.search('100%')).toEqual([
      expect.objectContaining({
        id: 'asset-search',
        workspaceId,
        workspaceName: 'Research',
        fileName: 'survey_100%.csv'
      })
    ])
    expect(repos.workspaceAssets.search('image/png')).toEqual([
      expect.objectContaining({ id: 'asset-other', workspaceName: 'Experiments' })
    ])
    expect(repos.workspaceAssets.search('   ')).toEqual([])
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

  it('searches report and note titles and full content across workspaces', () => {
    const otherWorkspace = repos.workspaces.create('Experiments')
    const report = repos.aiReports.create({
      workspaceId,
      title: 'Architecture review',
      contentMd: '# Findings\n\nThe latent representation preserves topology.',
      sourceDocIds: [],
      model: null
    })
    const note = repos.workspaceNotes.create(
      otherWorkspace.id,
      'Decoder follow-up',
      'Beam search_100% improves the result.',
      'markdown'
    )

    expect(repos.workspaces.searchContent('latent representation')).toEqual([
      expect.objectContaining({
        id: report.id,
        workspaceName: 'Research',
        kind: 'report',
        title: 'Architecture review',
        snippet: expect.stringContaining('latent representation')
      })
    ])
    expect(repos.workspaces.searchContent('search_100%')).toEqual([
      expect.objectContaining({
        id: note.id,
        workspaceName: 'Experiments',
        kind: 'note',
        snippet: expect.stringContaining('search_100%')
      })
    ])
    expect(repos.workspaces.searchContent('Architecture')).toEqual([
      expect.objectContaining({ id: report.id })
    ])
    expect(repos.workspaces.searchContent('   ')).toEqual([])
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

  it('creates, updates, deletes, and cascades workspace card connections', () => {
    repos.documents.insert(makeNewDocument('doc-1'))
    repos.documents.insert(makeNewDocument('doc-2'))
    const items = repos.workspaceItems.add(workspaceId, 'document', ['doc-1', 'doc-2'])

    const created = repos.workspaceConnections.create(
      workspaceId,
      items[0].id,
      items[1].id,
      'right',
      'left'
    )
    expect(repos.workspaceConnections.list(workspaceId)).toEqual([created])

    const updated = repos.workspaceConnections.create(
      workspaceId,
      items[0].id,
      items[1].id,
      'bottom',
      'top'
    )
    expect(updated).toMatchObject({ id: created.id, sourceAnchor: 'bottom', targetAnchor: 'top' })
    expect(repos.workspaceConnections.list(workspaceId)).toHaveLength(1)

    expectRepoError(
      () => repos.workspaceConnections.create(workspaceId, items[0].id, items[0].id, 'right', 'left'),
      'invalid_connection'
    )
    expectRepoError(
      () => repos.workspaceConnections.create(workspaceId, items[0].id, items[1].id, 'invalid' as never, 'left'),
      'invalid_anchor'
    )

    repos.workspaceItems.remove(items[1].id)
    expect(repos.workspaceConnections.list(workspaceId)).toEqual([])

    const replacement = repos.workspaceItems.add(workspaceId, 'document', ['doc-2'])[0]
    const next = repos.workspaceConnections.create(workspaceId, items[0].id, replacement.id, 'right', 'left')
    repos.workspaceConnections.remove(next.id)
    expect(repos.workspaceConnections.list(workspaceId)).toEqual([])
    expectRepoError(() => repos.workspaceConnections.remove(next.id), 'not_found')
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
