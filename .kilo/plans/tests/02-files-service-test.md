# Task 02 — Files Service Test

**Phase:** 1 (Service Unit Tests) · **Prerequisites:** 01 · **Master plan:** Phase 1, Task 1.1

## Goal
Create `tests/unit/files-service.test.ts` with full coverage of `src/main/services/files.ts`: `checkMissing()` batch-scan and `relocate()`.

## Spec

The files service provides:
- `checkMissing(repos, docIds[], emitter)` — batch-scan documents to detect missing files, with debounced event emission.
- `relocate(repos, docId, newPath)` — update a document's filePath/fileName, with validation.

## Test Cases

### `checkMissing(docIds: string[])`

Use a fake `repos` (mock `documents` repo with `list`, `updateFilePath`, `setFileMissing` methods). Use a fake `EventEmitter` to capture emitted `'missing'` events. Mock `existsSync` from `node:fs`.

1. **All files missing** — Mock `existsSync` to return `false` for all paths.
   - All docs marked `fileMissing=1`.
   - `emitter` fires `'missing'` event exactly once (debounced batch emit).
   - Count of missing doc IDs in emitted payload equals total docs.

2. **All files present** — Mock `existsSync` to return `true` for all paths.
   - No `fileMissing` changes.
   - No `'missing'` event emitted.

3. **50+ docs batch** — Provide 75 docs.
   - `checkMissing` processes in ticks of 50 (uses `setImmediate` internally).
   - Verify only one `'missing'` event fires after all batches complete (debounced).

4. **Status toggles** — Doc was `fileMissing=1`, now file exists.
   - `fileMissing` cleared to 0 via `updateFilePath`.
   - `'missing'` event fires (if any docs change status).

### `relocate(docId: string, newPath: string)`

5. **Valid `.pdf` path** — `newPath = '/some/where/doc.pdf'`.
   - `filePath` updated to newPath.
   - `fileName` updated to `'doc.pdf'`.
   - `fileMissing` set to 0.
   - Returns `{ ok: true }`.

6. **Non-PDF path** — `newPath = '/some/where/doc.txt'`.
   - Returns `{ ok: false, error: { code: 'invalid_path' } }`.

7. **Doc not found** — `docId` doesn't exist in DB.
   - Returns `{ ok: false, error: { code: 'not_found' } }`.

8. **File missing on disk, still accepts relocation** — path is valid PDF, but `existsSync` returns `false`.
   - Relocation succeeds (user-intent overrides file existence).
   - Returns `{ ok: true }`.

## Mock scope
- `node:fs` — `existsSync`. Mock via `vi.mock('node:fs', ...)`.
- DB repositories — pass a fake `Repositories` object with stubbed document repo methods.
- `EventEmitter` — use real Node `EventEmitter` from `node:events`.

## Files to create
- `tests/unit/files-service.test.ts`

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- New test file: `tests/unit/files-service.test.ts` with 8+ test cases, all passing.
