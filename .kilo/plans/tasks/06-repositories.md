# Task 06 — Repositories

**Phase:** 1 (Data layer) · **Prerequisites:** 05 · **Master plan:** §4, §8

## Goal
Typed repositories over the DB for documents, categories, watch_folders, and settings. These are the data-access layer used by IPC handlers (Task 07) and services (Tasks 08+). No IPC here — just DB functions.

## Spec — documents repository
- `list(filter: ListFilter): Document[]` — covers all six `ListMode` values:
  - `all` → all documents.
  - `recentlyRead` → `lastReadAt IS NOT NULL` ordered desc.
  - `recentlyAdded` → `addedAt` ordered desc.
  - `starred` → `starred = 1`.
  - `category` → join `document_categories` where `categoryId`.
  - `folder` → where `originalFolderPath = folderPath`.
  - Apply `sort` (default `{ field: 'addedAt', dir: 'desc' }`). No pagination — returns all rows (metadata small; renderer virtualizes).
- `search(q: string): Document[]` — trim `q`; `len >= 3` → FTS5 `MATCH` (`SELECT d.* FROM documents d JOIN docs_fts f ON d.rowid = f.rowid WHERE docs_fts MATCH ? ORDER BY rank`); `len 1–2` → `LIKE` fallback over the same column set. Server decides the path based on trimmed length. (Used by Task 20.)
- `get(id)`, `insert(doc)`, `update(id, patch)` (see whitelist note below), `delete(id)`, `setStarred(id, value)`, `bulkDelete(ids)`.
- `update` whitelist: only `EditableField` keys (`title|authors|year|venue|volume|abstract|keywords|url|doi|note`). Reject any other key with error code `forbidden_field`. Each patched field is added to `editedFields` (JSON array); clearing a field to `''` **removes** it from `editedFields`. Never allow setting `id, filePath, originalFolderPath, fileName, fileSize, fileHash, addedAt, lastReadAt, starred, metadataSource, metadataStatus, metadataAttempts, editedFields, remoteValues, fileMissing` via update.
- Helpers needed by later tasks (add now or as they come): `findByPath`, `findByHash`, `updateFilePath`, `setMetadataStatus`, `incrementMetadataAttempts`, `setLastReadAt`, `setFileMissing`, `getResumableMetadataRows` (`pending` OR (`failed` AND `metadataAttempts < 3`)), `mergeMetadata` (the merge logic itself lives in Task 09's `metadata.ts`; repo just persists).

## Spec — categories repository
- `list()`, `create(name, moveToLibrary?)` (`moveToLibrary` NULL=inherit), `rename(id, name)`, `delete(id)` (FK cascade removes `document_categories` rows), `setMoveToLibrary(id, value)`, `assign(docId, catId)` (idempotent), `unassign(docId, catId)`, `listForDocument(docId)`, `countByCategory()`.

## Spec — watch_folders repository
- `list()`, `add(path)`, `remove(id)`, `toggle(id, enabled)`, `getEnabled()`.

## Spec — settings repository (key-value, JSON strings)
- `get<T>(key, defaultValue): T` — parse `value` with try/catch, fall back to default on corruption (never throw on bad JSON).
- `set(key, value)` — JSON-stringify.
- `getBootstrapSettings()` — returns `{ language, windowBounds, listColumnState, sidebarCollapsed, libraryFolderPath, proxyUrl }` with safe defaults.
- Settings value schemas (master plan §4):
  - `windowBounds = { x, y, width, height, isMaximized }`
  - `listColumnState = { columns: { id, visible, width, order }[], sort: { field: SortField, dir } }`
  - scalar strings: `libraryFolderPath`, `crossrefMailto`, `theme` (`'dark'`), `language` (`'zh'|'en'`), `proxyUrl` (`''`=none), `sidebarCollapsed` (`'0'|'1'`), `moveToLibraryOnCategorize` (`'0'|'1'`).

## Steps
1. `src/main/db/repositories/documents.ts`, `categories.ts`, `watchFolders.ts`, `settings.ts` — typed functions above.
2. Keep SQL parameterized (no string interpolation of user input).
3. Export a single `db` facade or per-repo objects as fits the codebase.

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- Unit tests: `documents.list` covers all six `ListMode` values; `documents.update` rejects non-`EditableField` keys with `forbidden_field` and manages `editedFields` correctly (add on edit, remove on clear); FK cascade on `document_categories` works (delete document or category clears assignments).

## Phase 1 DoD (this task owns)
- [ ] `documents.list(ListFilter)` covers all six `ListMode` values; FK cascade on `document_categories` works.
