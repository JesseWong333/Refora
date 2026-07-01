# Task 17 — Folder grouping (sidebar)

**Phase:** 4 (Sidebar groups & drag) · **Prerequisites:** 11a · **Master plan:** §6 (Sidebar — Folder grouping), §2 (Folder grouping)

## Goal
Add the expandable "Folders" (按照文件夹分类) group in the sidebar: virtual groups by immutable `originalFolderPath` (read-only, derived). Selecting one filters the list (`ListFilter.mode='folder'`, `folderPath`).

## Spec (master plan §6, §2)
- **Folder grouping** — expandable; virtual groups by `originalFolderPath` (read-only, derived from existing documents). Each group shows a directory icon + folder path + document count.
- Selecting a folder group → `ListFilter.mode='folder'`, `folderPath` → `documents.list` filters to that original folder.
- **Folder groups are NOT drop targets** (grouping is by immutable original folder; only categories accept drop). Reject any drop on folder groups.
- Empty folder groups: directory icon + folder path, count `0`.

## Steps
1. Sidebar: expandable Folders section; derive groups from `documents.list` distinct `originalFolderPath`.
2. Render each group (icon + path + count); select → filter list.
3. Explicitly ignore/reject drops on folder groups (no drop handlers, or preventDefault + no-op).
4. Empty-state copy.

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- Folder grouping (virtual, by `originalFolderPath`) is expandable; selecting filters the list to that original folder.
- Folder groups are NOT drop targets (dropping on them does nothing).

## Phase 4 DoD (this task owns)
- [ ] Folder grouping (virtual, by `originalFolderPath`) expandable; folder groups are NOT drop targets.
