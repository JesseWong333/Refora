# Task 13 — Smart lists (sidebar filters)

**Phase:** 3 (UI: list + detail) · **Prerequisites:** 11a · **Master plan:** §6 (Sidebar — smart lists), §2 (Smart lists)

## Goal
Implement the four smart-list filters in the sidebar: All / Recently read / Recently added / Starred. Selecting one sets the `ListFilter.mode` and re-queries `documents.list`. (Categories + Folder grouping are Tasks 15/17.)

## Spec (master plan §6 Sidebar)
- **All files** → `mode: 'all'`.
- **Recently read** → `mode: 'recentlyRead'` (`lastReadAt IS NOT NULL` ordered desc).
- **Recently added** → `mode: 'recentlyAdded'` (`addedAt` ordered desc).
- **Starred** → `mode: 'starred'` (`starred = 1`).
- Selecting a smart list clears any active search (Task 20) and re-queries the list.
- Persist the last-selected sidebar item across sessions if convenient (optional; window/column state persistence is Task 26).

## Steps
1. Sidebar: render the four smart-list entries (i18n keys from §8 `sidebar.*`).
2. On select → set `ListFilter.mode` in the store → re-query `documents.list` → DocumentList updates.
3. Highlight the active selection.

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- Selecting each smart list filters the list correctly (All = all; Recently read = `lastReadAt` not null desc; Recently added = `addedAt` desc; Starred = `starred=1`).

## Phase 3 DoD (this task owns)
- [ ] Smart lists (All / Recently read / Recently added / Starred) filter correctly.
