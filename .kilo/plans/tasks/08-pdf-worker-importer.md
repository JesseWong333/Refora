# Task 08 — pdf-worker + importer

**Phase:** 2 (Import & metadata) · **Prerequisites:** 06, 07 · **Master plan:** §3 (Import pipeline, Threading, Utility worker)

## Goal
Create the `utilityProcess` worker that streams sha256 + parses PDFs off-main, and the importer service that runs the import pipeline (dedup, insert, progress events). Metadata fetch (DOI/Crossref) is Task 09; here we insert rows with `metadataStatus='pending'`.

## Spec — pdf-worker (`src/main/worker/pdf-worker.ts`, master plan §3)
- Electron `utilityProcess` (spawned from main). Owns CPU-heavy blocking work so the main thread never freezes.
- **sha256:** stream the file via `createReadStream` + `crypto.createHash('sha256')` — **never read the whole file into memory**. If streaming throws (e.g. permission error) return `fileHash: null` (dedup falls back to path-only).
- **pdfjs-dist parse** (Node init per master plan §2 PDF decision): set `GlobalWorkerOptions.workerSrc` to `pdfjs-dist/legacy/build/pdf.worker.mjs` (or pass `useWorkerFetch:false, isEvalSupported:false`); `getDocument({ data })` → info dict + text of first N pages (default 5). Returns `{ info, text }`. No canvas/DOM.
- Return `{ fileHash, info, text }` to main over a `MessagePort`. The worker does **NOT** touch the DB or do filesystem mutation.
- Handle password-protected PDFs: return a distinguishable error so the importer can toast "Skipping encrypted PDF: [filename] (password-protected)". Handle corrupted PDFs similarly ("Could not read: [filename] (file may be corrupted).").

## Spec — import pipeline (`src/main/services/importer.ts`, master plan §3)
1. Resolve absolute path; **skip if path already in `documents`** (path dedup — always).
2. **Off-main hashing:** send path to pdf-worker → `fileHash`. If `fileHash` matches an existing record:
   - manual add → show confirmation dialog ("This file appears to be a duplicate. Skip?") [Skip] [Import Anyway].
   - watch → auto-skip silently.
   - If `fileHash` is NULL (hashing failed) → only path dedup applies.
3. Insert `documents` row: `filePath`, `originalFolderPath` (dirname, **immutable**), `fileName`, `fileSize`, `fileHash`, `addedAt` (now), empty metadata, `metadataStatus='pending'`, `metadataAttempts=0`, `editedFields='[]'`. Emit `import:progress`.
4. Enqueue async metadata job (the job itself is Task 09; here just mark `pending` and ensure the enqueue seam exists).
5. On metadata completion (Task 09) update row respecting `editedFields` + FTS (via triggers) + emit `document:updated`. (This step's wiring is finalized in Task 09; importer exposes the hook.)

## Spec — `import.addFiles(paths)` / `import.addFolder(dir)`
- `addFiles`: native multi-select `.pdf` paths → pipeline (manual-add dedup behavior).
- `addFolder`: native dir picker → import all `.pdf` recursively (one-time, not a watch).

## Spec — import:progress event
- Progress bar in the top bar during import of 3+ files; shows "Importing 12/50 PDFs…". Add File/Folder buttons disabled during active import (prevent concurrent imports).

## Steps
1. `src/main/worker/pdf-worker.ts` — utilityProcess; streaming sha256 + pdfjs parse; MessagePort reply; error cases (encrypted/corrupted).
2. `src/main/services/importer.ts` — pipeline + dedup (path always; hash warn-on-manual / auto-skip-on-watch; NULL→path-only); insert row; emit `import:progress`; enqueue metadata seam.
3. Wire `import.addFiles`/`import.addFolder` IPC handlers (replace Task 07 stubs).
4. Main↔worker MessagePort plumbing + a small request/response correlation (multiple concurrent imports).

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- Unit test: streaming hash does not buffer the whole file (mock/inspect); NULL-hash → path-only dedup; path dedup always skips.
- Integration: import 50 PDFs keeps the main thread/progress bar responsive (utility worker off-main).
- Manual-add hash-duplicate shows the confirmation dialog; watch hash-duplicate auto-skips.
- Password-protected PDF → toast "Skipping encrypted PDF…"; corrupted PDF → toast "Could not read…".

## Phase 2 DoD (this task owns)
- [ ] pdf-worker (`utilityProcess`) streams sha256 (no whole-file buffering) + returns `{fileHash, info, text}` via MessagePort; import of 50 PDFs keeps main thread/progress bar responsive.
- [ ] Path dedup always; hash-dedup warns on manual add, auto-skips on watch; NULL hash → path-only dedup.
- [ ] Add File / Add Folder wired; `import:progress` fires. (Document list display + `document:updated` finalized in Task 10.)
