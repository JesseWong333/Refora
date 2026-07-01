# Task 04 — Importer Service Test

**Phase:** 1 (Service Unit Tests) · **Prerequisites:** 01 · **Master plan:** Phase 1, Task 1.3

## Goal
Create `tests/unit/importer-service.test.ts` covering the full `createImporter()` pipeline: worker communication, path/hash dedup, encrypted/corrupted handling, worker crash/timeout recovery.

## Spec

`createImporter(repos, win)` returns an object with `importFiles(paths, opts)` that:
- Validates paths (exists, is .pdf).
- Checks path dedup (same `filePath` in DB → skip).
- Checks hash dedup via worker (same `fileHash` in DB → confirm dialog or auto-skip).
- Sends file to pdf-worker via `utilityProcess` for hashing + info extraction.
- Inserts document into DB on success.
- Emits `import:progress` events via `webContents.send`.
- Handles worker crashes and timeouts.

## Test Cases

**Setup:** Import `tests/mocks/electron.ts` before the service import.

### `importFiles(paths, opts)` — Success path

1. **Single valid PDF** — Path exists, not in DB by path or hash.
   - Worker mock emits `message` with `{ correlationId, fileHash: 'abc123', info: { title: 'Test' } }`.
   - Document inserted with `fileHash='abc123'`, `title='Test'`, `metadataStatus='pending'`.
   - `emitImportProgress` called with `stage: 'complete'`, `added: 1`.

2. **NULL hash** — Worker returns `fileHash: null`.
   - Document inserted with `fileHash=null`.
   - Only path-based dedup applies.

### Path dedup

3. **Same filePath already in DB** — `findByPath` returns an existing doc.
   - Document not re-inserted.
   - Result `{ skipped: [path] }`.
   - No worker call made.

### Hash dedup

4. **Different path, same hash, manual mode** — `findByHash` returns existing doc, `opts.mode === 'manual'`.
   - `dialog.showMessageBox` called with duplicate confirmation.
   - Document not inserted.
   - Result `{ skipped: [path] }`.

5. **Different path, same hash, watch mode** — `opts.mode === 'watch'`.
   - NO dialog shown.
   - Auto-skipped silently.
   - Result `{ skipped: [path] }`.

### Error handling

6. **Encrypted PDF** — Worker returns `{ error: { type: 'encrypted', message: '...' } }`.
   - Document NOT inserted.
   - Result `{ errors: [{ path, message: 'Encrypted' }] }`.

7. **Corrupted PDF** — Worker returns `{ error: { type: 'corrupted', message: '...' } }`.
   - Document NOT inserted.
   - Result `{ errors: [{ path, message: 'Corrupted' }] }`.

8. **Worker crash** — Worker emits `'exit'` with code 1.
   - All pending requests rejected with `'PDF worker exited unexpectedly'`.
   - Next call to `importFiles` creates a new worker (via `ensureWorker`).

9. **Worker timeout** — No response within 120s (use `vi.advanceTimersByTime`).
   - Request rejected with timeout error.

10. **Non-existent path** — `existsSync` returns `false` for the path.
    - Result `{ errors: [{ path, message: 'File not found' }] }`.

## Mock scope
- `electron` — via `tests/mocks/electron.ts` (provides `utilityProcess.fork`, `dialog`, `BrowserWindow`).
- `electron-log` — via `tests/mocks/electron-log.ts`.
- `node:fs` — `existsSync`, `statSync` (mock per test as needed).
- Worker — the `utilityProcess.fork` mock returns an `EventEmitter`; tests emit `'message'` on it to simulate responses.
- Timers — use `vi.useFakeTimers()` for timeout tests.

## Files to create
- `tests/unit/importer-service.test.ts`

**Note:** The existing `tests/unit/importer.test.ts` tests `streamHash` utility and some DB-level dedup logic — it does NOT test the full `createImporter` pipeline. Keep the existing file; name the new one `tests/unit/importer-service.test.ts`.

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- 10+ test cases, all passing.
- Existing `tests/unit/importer.test.ts` still passes (7 tests).
