# Task 14 — Document deletion

**Phase:** 3 (UI: list + detail) · **Prerequisites:** 11a, 07 · **Master plan:** §6, §7 (Delete), §1 (scope)

## Goal
Implement single + bulk document deletion with a confirm dialog. Deleting removes the DB record (and cascades `document_categories` rows) but **never deletes the source PDF file from disk**.

## Spec (master plan §1, §6, §7)
- Delete entry points: right-click "Delete" on a list row (context menu, Task 11b) and a Delete button in the detail panel (Task 12) + the multi-select bulk bar (Task 12).
- **Confirm dialog:** "Remove this document from the library? (The PDF file will not be deleted.)" (i18n `dialog.deleteConfirm`).
- `documents.delete(id)` / `documents.bulkDelete(ids)` → remove DB record; `document_categories` rows cascade-removed (FK `ON DELETE CASCADE`); FTS rows removed by `documents_ad` trigger. **Source PDF file untouched.**
- After delete: refresh the list; if the deleted doc was selected, clear selection / revert detail panel to no-selection.

## Steps
1. Wire delete confirm dialog (single + bulk).
2. Call `documents.delete` / `documents.bulkDelete`; handle Result unwrap + error toast.
3. Refresh list + clear selection as needed.

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- Delete + bulk delete with confirm dialog; DB record removed (source PDF untouched on disk — verify file still exists).
- `document_categories` rows cascade-removed on document delete (regression test).

## Phase 3 DoD (this task owns)
- [ ] Delete + bulk delete with confirm dialog; DB record removed (source PDF untouched); `document_categories` rows cascade-removed.
