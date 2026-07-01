# Task 16 — Drag-to-category (move-to-library + restore)

**Phase:** 4 (Sidebar groups & drag) · **Prerequisites:** 15 · **Master plan:** §3 (Drag-to-category flow), §2 (File model, Categories), §7 (Move-to-library vs watch, Filename collision)

## Goal
Make sidebar categories a drop target for internal doc-drag, implement the `library.ts` service (effective move policy + collision-safe move + path update), and the "Restore to original location" action.

## Spec — drag-to-category flow (master plan §3)
1. Renderer sends `{documentId, categoryId}` (sidebar category accepts **only** `application/x-scholarnote-docids` from list rows — Task 11b sets the MIME; ignores OS file drops).
2. Main: resolve the **effective move policy** — `categories.moveToLibrary` for the target category, falling back to the global `moveToLibraryOnCategorize` setting when it is NULL (default ON). If effective=ON and `filePath` not already under the library folder → `fs.rename` into library folder (**collision-safe**: append ` (1)`, ` (2)`… if name exists); update `documents.filePath` (**`originalFolderPath` stays immutable**). If effective=OFF → keep file in place (category is a logical label only).
3. Insert `document_categories` row (idempotent).
4. Library folder is excluded from chokidar watching (Task 18); content-hash dedup guards against races.
5. Bulk variant: `documents.bulkCategorize(ids, catId)` applies the flow to each.

## Spec — restore to original location (master plan §3, §6)
- When removing a document from ALL categories, the file is **NOT** moved back — it stays in the library folder (if previously moved).
- Manual **"Restore to original location"** action (detail panel, Task 12 wires UI): moves the file back to `originalFolderPath` (collision-safe suffix), updates `filePath`; **disabled if the original folder no longer exists** (toast explains).

## Spec — `library.ts` service
- `resolveMovePolicy(category): boolean` — category override → global.
- `moveToLibrary(filePath, libraryFolder): newPath` — collision-safe `fs.rename`.
- `restoreToOriginal(docId): newPath` — move back under `originalFolderPath`; throw/no-op if folder missing.
- Update `documents.filePath`; never touch `originalFolderPath`.

## Steps
1. `src/main/services/library.ts` — move policy + collision-safe move + restore.
2. Sidebar category drop handler → `categories.assign`/`documents.bulkCategorize` with move logic.
3. Wire `documents.restoreFile` IPC handler (replace Task 07/12 stub).
4. Verify FTS still finds the doc after a move (filePath change does not break FTS — FTS indexes metadata columns, not filePath; the rowid is stable).

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- Drag doc → category: sidebar accepts only `application/x-scholarnote-docids`; effective move policy = category override → global; file moved (collision-safe) when effective=ON, `filePath` updated, `originalFolderPath` immutable; FTS still finds it after move.
- Setting a category `moveToLibrary`=keep-in-place → drag does NOT move file (assignment only).
- Disabling global `moveToLibraryOnCategorize` + dragging to a default category → file NOT moved.
- "Restore to original location" returns file to `originalFolderPath` (collision-safe); disabled if original folder missing (toast).
- Bulk-categorize assigns all selected.

## Phase 4 DoD (this task owns)
- [ ] Drag doc → category: accepts only the custom MIME; effective move policy = category override → global; file moved (collision-safe) when effective=ON, `filePath` updated, `originalFolderPath` immutable; FTS still finds it.
- [ ] Category `moveToLibrary`=keep-in-place → no move; disabling global setting + default category → no move.
