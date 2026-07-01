import { randomUUID } from 'node:crypto'
import type { Category } from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'
import { RepoError } from './errors'

function mapCategory(row: Record<string, unknown>): Category {
  return {
    id: row.id as string,
    name: row.name as string,
    sortOrder: row.sortOrder as number,
    moveToLibrary: (row.moveToLibrary as number | null) ?? null,
    createdAt: row.createdAt as number
  }
}

export function createCategoriesRepository(db: SqliteDb) {
  function list(): Category[] {
    const rows = db.prepare('SELECT * FROM categories ORDER BY sortOrder, name').all() as Record<
      string,
      unknown
    >[]
    return rows.map(mapCategory)
  }

  function create(name: string, moveToLibrary?: number): Category {
    const id = randomUUID()
    const createdAt = Date.now()
    db.prepare(
      'INSERT INTO categories (id, name, sortOrder, moveToLibrary, createdAt) VALUES (?, ?, ?, ?, ?)'
    ).run(id, name, 0, moveToLibrary === undefined ? null : moveToLibrary, createdAt)
    const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as Record<string, unknown>
    return mapCategory(row)
  }

  function rename(id: string, name: string): void {
    const result = db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id)
    if (result.changes === 0) throw new RepoError('not_found', `category not found: ${id}`)
  }

  function remove(id: string): void {
    db.prepare('DELETE FROM categories WHERE id = ?').run(id)
  }

  function setMoveToLibrary(id: string, value: number | null): void {
    const result = db.prepare('UPDATE categories SET moveToLibrary = ? WHERE id = ?').run(value, id)
    if (result.changes === 0) throw new RepoError('not_found', `category not found: ${id}`)
  }

  function assign(docId: string, catId: string): void {
    db.prepare(
      'INSERT OR IGNORE INTO document_categories (documentId, categoryId) VALUES (?, ?)'
    ).run(docId, catId)
  }

  function unassign(docId: string, catId: string): void {
    db.prepare('DELETE FROM document_categories WHERE documentId = ? AND categoryId = ?').run(docId, catId)
  }

  function listForDocument(docId: string): Category[] {
    const rows = db
      .prepare(
        'SELECT c.* FROM categories c JOIN document_categories dc ON c.id = dc.categoryId WHERE dc.documentId = ? ORDER BY c.sortOrder, c.name'
      )
      .all(docId) as Record<string, unknown>[]
    return rows.map(mapCategory)
  }

  function countByCategory(): Map<string, number> {
    const rows = db
      .prepare(
        'SELECT categoryId AS id, count(*) AS count FROM document_categories GROUP BY categoryId'
      )
      .all() as Array<{ id: string; count: number }>
    return new Map(rows.map((r) => [r.id, r.count]))
  }

  function getAllDocumentCategories(): Array<{ documentId: string; categoryId: string }> {
    return db
      .prepare('SELECT documentId, categoryId FROM document_categories')
      .all() as Array<{ documentId: string; categoryId: string }>
  }

  return {
    list,
    create,
    rename,
    delete: remove,
    setMoveToLibrary,
    assign,
    unassign,
    listForDocument,
    countByCategory,
    getAllDocumentCategories
  }
}
