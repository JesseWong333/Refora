# Task 11b — DocumentList: interactions (star, PDF-open, multi-select, context menu, DnD)

**Phase:** 3 (UI: list + detail) · **Prerequisites:** 11a · **Master plan:** §6 (Middle list), §3 (Drag-to-category flow — drag source side), §5 (Detail Panel multi-select)

## Goal
Add row interactions to the DocumentList built in 11a: star toggle, PDF-icon open + `lastReadAt`, missing-file badge, multi-select (checkbox column), context menu, and the dual-source drag-and-drop behavior.

## Spec — interactions (master plan §6 Middle list)
- **Row click** → loads detail panel (does NOT set `lastReadAt`).
- **PDF icon click** → `shell.openPath(filePath)`; on resolve success (`errMsg === ''`) set `lastReadAt = now` + refresh "Recently read"; on failure toast + leave `lastReadAt` unchanged. (`pdfOpen.ts` service.)
- **Star click** → toggles `starred` (`documents.setStarred`).
- **Missing file** (`fileMissing=1`) → row shows yellow warning badge; PDF icon disabled; relocate action available (relocate flow in Task 22).
- **Error row:** per-document error badge if metadata fetch failed (hover shows failure reason).
- **Multi-select:** checkbox column; selection state shared with the detail panel (Task 12 uses it for the bulk bar).

## Spec — context menu
- Row right-click: Open in Finder, Copy Path, Refresh Metadata, Delete.

## Spec — drag-and-drop (dual source, master plan §6 + §3)
- **OS file drop target:** list accepts OS drag-drop of `.pdf` files from Finder (HTML5 `drop` with `e.dataTransfer.files`) → import pipeline.
- **Drag source:** list rows are `draggable`; on `dragstart` set `e.dataTransfer.setData('application/x-scholarnote-docids', JSON.stringify(selectedIds))`. This MIME is the only payload sidebar categories accept (Task 16).
- **Reject internal doc-drops on the list:** a row dragged onto the list is a no-op (internal drops only target sidebar categories).

## Steps
1. Star toggle + PDF-icon open (via `documents.openPdf`) with `lastReadAt`-on-success rule.
2. `src/main/services/pdfOpen.ts`: `shell.openPath`; set `lastReadAt` only when `errMsg === ''`. Wire `documents.openPdf` IPC handler (replace Task 07 stub).
3. Missing-file badge + disabled PDF icon when `fileMissing=1`; error badge when `metadataStatus='failed'` (hover reason).
4. Checkbox multi-select column; expose selection to the store (DetailPanel Task 12 + bulk actions consume it).
5. Context menu (Open in Finder, Copy Path, Refresh Metadata, Delete).
6. DnD: OS file drop → import; row dragstart sets the custom MIME; internal doc-drops onto the list are no-ops.

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- PDF-icon click calls `shell.openPath`; `lastReadAt` set only when `errMsg===''` (regression: force failure → `lastReadAt` unchanged + toast).
- Multi-select via checkbox; missing-file badge + disabled PDF icon; error badge with hover reason.
- Context menu (Open in Finder, Copy Path, Refresh Metadata, Delete) works.
- DnD dual-source: OS file drop imports; list rows draggable with `application/x-scholarnote-docids`; internal doc-drops onto the list are no-ops.

## Phase 3 DoD (this task owns)
- [ ] PDF-icon click → `shell.openPath`; `lastReadAt` only on `errMsg===''` (regression test).
- [ ] Multi-select via checkbox; missing-file badge + disabled PDF icon; context menu.
- [ ] DnD dual-source (OS drop imports; rows draggable with the custom MIME; internal doc-drops onto list are no-ops).
