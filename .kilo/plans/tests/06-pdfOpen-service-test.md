# Task 06 — PDF Open Service Test

**Phase:** 1 (Service Unit Tests) · **Prerequisites:** 01 · **Master plan:** Phase 1, Task 1.5

## Goal
Create `tests/unit/pdfOpen-service.test.ts` covering `openPdf()` from `src/main/services/pdfOpen.ts`.

## Spec

`openPdf(repos, docId)`:
- Fetches document from DB by `docId`.
- Checks file exists on disk (`existsSync`).
- Calls `shell.openPath(filePath)`.
- On success (`errMsg === ''`): updates `lastReadAt` on the document, emits `document:updated`.
- On failure: returns error, does NOT update `lastReadAt`.
- On missing doc/file: returns specific error codes.

## Test Cases

1. **Successful open** — Doc exists, file exists, `shell.openPath` returns `''` (no error).
   - `lastReadAt` updated to current timestamp.
   - Returns `{ ok: true, data: doc }` where doc has updated `lastReadAt`.
   - `emitDocumentUpdated` called.

2. **shell.openPath returns error** — `shell.openPath` returns `'Permission denied'`.
   - `lastReadAt` NOT updated.
   - Returns `{ ok: false, error: { code: 'open_failed', message: ... } }`.

3. **File missing on disk** — Doc exists but `existsSync` returns `false`.
   - Returns `{ ok: false, error: { code: 'file_missing' } }`.
   - `shell.openPath` never called.

4. **Doc not found** — `docId` not in DB.
   - Returns `{ ok: false, error: { code: 'not_found' } }`.

5. **Multiple consecutive opens** — Open same doc twice.
   - Each call updates `lastReadAt` independently.
   - Both calls succeed.

## Mock scope
- `electron.shell` — `openPath` (via `tests/mocks/electron.ts`).
- `node:fs` — `existsSync`.
- DB repos — fake document repo with `get`, `setLastReadAt`.
- `emitDocumentUpdated` — mock the events module or verify via repos call.

## Files to create
- `tests/unit/pdfOpen-service.test.ts`

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- 5+ test cases, all passing.
