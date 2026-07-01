# Task 12 — Detail panel

**Phase:** 3 (UI: list + detail) · **Prerequisites:** 11a · **Master plan:** §6 (Right detail panel), §5 (Detail Panel, Metadata Refresh)

## Goal
Build the DetailPanel: inline-editable fields (edits recorded in `editedFields`), plain-text Note (autosave), refresh-metadata with "↻" conflict indicator + apply-remote, relocate, restore-to-original-location, categories chips, and the multi-select bulk-action bar.

## Spec — single selection (master plan §6)
- Fields (all inline-editable on click): 论文名称(title), 作者(authors), 发表年份(year), 期刊/会议(venue), 卷号(volume), 摘要(abstract), 关键词(keywords), URL, 添加时间(read-only), PDF位置(read-only with "open" + "relocate" actions), Note (plain-text textarea, autosave on blur/debounce).
- Edits go through `documents.update(id, patch)` → server marks patched fields in `editedFields` (and removes on clear). Show "Saving…" then "Saved" (auto-dismiss 2s).
- **Refresh metadata** button → `documents.refreshMetadata(id)`; merge respects `editedFields` (skips user-edited unless cleared), refreshes `remoteValues`, shows "↻" where remote differs. Clicking "↻" replaces the user value with the remote one (field stays in `editedFields`, now holding the remote value). Spinner overlay while fetching; toast on completion/failure.
- **Categories** chip list → add/remove assignments (`categories.assign`/`unassign`). (Category creation UI is Task 15; here just assign existing.)
- **Relocate file** action (when `fileMissing`) → native dir/file picker → `documents.relocateFile(id, newPath)` → clears badge, re-enables PDF icon. (Service in Task 22; here wire the UI + IPC; handler may be stub until 22.)
- **Restore to original location** action (shown when `filePath` differs from `originalFolderPath/fileName`, e.g. after move-to-library) → `documents.restoreFile(id)` moves file back under `originalFolderPath` (collision-safe suffix), updates `filePath`; disabled if original folder no longer exists (toast explains). (Service in Task 16/22; wire UI now.)

## Spec — multi-selection (≥2) (master plan §5, §6)
- Hide single-doc fields; show "{{count}} selected" header + bulk-action bar: Delete, Categorize…, Refresh metadata, Export BibTeX.
- Revert to single-doc view when selection ≤1. (Bulk Categorize uses Task 15; Export BibTeX uses Task 24 — wire buttons now, handlers come later.)

## Spec — no selection
- "Select a document to view details" placeholder.

## Steps
1. DetailPanel: single-selection inline-editable fields + Note autosave + saving/saved feedback.
2. Refresh-metadata UI + "↻" conflict indicator (driven by `remoteValues` diff) + apply-remote.
3. Categories chips (assign/unassign existing categories).
4. Relocate + restore-to-original-location actions (UI + IPC; service implementations in 16/22).
5. Multi-select bulk-action bar + "{{count}} selected" header; revert at ≤1 selection.
6. No-selection placeholder.

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- Inline-edits record `editedFields` (verify via `documents.get` after edit); Note autosaves; "Saving…/Saved" feedback.
- Refresh-metadata shows "↻" when `remoteValues[field].value` differs from current; apply-remote replaces value.
- Multi-select (≥2): single-doc fields hidden, "{{count}} selected" bulk bar (Delete/Categorize/Refresh/Export BibTeX); reverts at ≤1.
- No-selection placeholder renders.

## Phase 3 DoD (this task owns)
- [ ] DetailPanel inline-edits record `editedFields`; Note autosave; refresh-metadata shows "↻" + apply-remote; relocate + restore-to-original-location UI.
- [ ] Multi-select (≥2): fields hidden, "{{count}} selected" bulk-action bar; reverts to single view at ≤1.
