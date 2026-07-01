# Task 15 — Import Pipeline E2E Test

**Phase:** 4 (Integration & E2E) · **Prerequisites:** 14 · **Master plan:** Phase 4, Task 4.2

## Goal
Create `tests/e2e/import.spec.ts` verifying the full import pipeline: trigger import via IPC, verify document appears in DB, progress events fire.

## Pre-requisite
Task 14 complete — Playwright configured, app launches, IPC verified.

## Test Cases

1. **Import a single PDF via IPC** — With a clean DB (seeded empty):
   - Call `window.api.import.addFiles(['/absolute/path/to/tests/fixtures/valid.pdf'])`.
   - Result has `added: [docId]`, `skipped: []`, `errors: []`.
   - Call `window.api.documents.list({ mode: 'all' })` → returns 1 document.
   - Document has `filePath` matching the input path.

2. **Import progress event fires** — Subscribe to `onImportProgress` before calling `addFiles`.
   - At least one progress event with `stage: 'processing'` fired.
   - Final event has `stage: 'complete'` with `added: 1`.

3. **Duplicate path — skipped** — Call `addFiles` again with the same path.
   - Result has `added: []`, `skipped: [path]`.
   - DB still has exactly 1 document.

4. **Hash dedup** — Add a **different** path pointing to a copy of the same valid PDF.
   - In watch mode: auto-skipped (`skipped` includes the path).
   - In manual mode (default): `showMessageBox` dialog fires (can't fully assert in E2E, but verify `added: []`).

5. **Corrupted PDF — error** — Call `addFiles` with `tests/fixtures/corrupted.pdf`.
   - Result has `errors: [{ path, message: 'Corrupted' }]`.
   - No document inserted.

6. **Encrypted PDF — error** — Call `addFiles` with `tests/fixtures/encrypted.pdf`.
   - Result has `errors: [{ path, message: 'Encrypted' }]`.
   - No document inserted.

## E2E strategy
- Use `page.evaluate()` to call `window.api.*` methods directly (bypasses UI).
- DB state verified via `window.api.documents.list()` only — no direct DB access from test.
- Pre-seed empty DB by launching app with a fresh DB path (set `userData` / app data directory via Electron launch args).

## Files to create
- `tests/e2e/import.spec.ts`

## Verification
- `npm run build` succeeds.
- `npx playwright test --project=electron tests/e2e/import.spec.ts` passes (requires headed display).
