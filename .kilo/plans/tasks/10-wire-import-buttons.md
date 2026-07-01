# Task 10 — Wire import buttons + list display

**Phase:** 2 (Import & metadata) · **Prerequisites:** 08, 09 · **Master plan:** §6 (Top bar, Document list basics)

## Goal
Connect the TopBar Add File / Add Folder buttons to the import pipeline, display imported documents in the list, and make `import:progress` + `document:updated` events drive live UI updates. (Full DocumentList features — sort/virtual/multi-select/DnD — are Tasks 11a/11b; here just render rows from `documents.list`.)

## Spec
- **Add file** button → native multi-select `.pdf` picker → `window.api.import.addFiles(paths)`.
- **Add folder** button → native dir picker → `window.api.import.addFolder(dir)`.
- Both buttons **disabled during active import** (prevent concurrent imports).
- **Import progress:** progress bar in the top bar during import of 3+ files ("Importing 12/50 PDFs…"); subscribe to `events.onImportProgress`.
- **List display:** after import, call `documents.list({ mode: 'all' })` and render rows (title · authors · year · venue · addedAt · filePath + PDF-icon cell + star toggle as static placeholders for now; interactions come in 11a/11b).
- **Live refresh:** subscribe to `events.onDocumentUpdated`; when a doc updates, patch/refresh its row in the list.

## Steps
1. TopBar: wire Add File / Add Folder buttons → import IPC; disable during active import; render progress bar from `import:progress` events.
2. Renderer store (Zustand): hold the current document list + selected list mode; refresh on `document:updated`.
3. DocumentList: render rows from the store (basic — features in 11a/11b).
4. Subscribe to `events.onImportProgress` + `events.onDocumentUpdated` in the store; clean up on unmount.

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- Add File / Add Folder buttons import PDFs; documents appear in the list.
- `import:progress` fires and the top-bar bar animates; buttons disabled during import.
- `document:updated` fires (on metadata completion) and the affected row refreshes in place.

## Phase 2 DoD (this task owns)
- [ ] Add File / Add Folder buttons wired; documents appear in list; `import:progress` + `document:updated` events fire.
