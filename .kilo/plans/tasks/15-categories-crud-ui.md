# Task 15 — Categories CRUD UI + assignment

**Phase:** 4 (Sidebar groups & drag) · **Prerequisites:** 07, 11a · **Master plan:** §6 (Sidebar — Categories), §2 (Categories), §4 (categories table)

## Goal
Categories CRUD UI (create/rename/delete) with a `moveToLibrary` override in the edit dialog, category-filtered list, and many-to-many assignment chips in the detail panel. (Drag-to-category move logic is Task 16; here just CRUD + assign + filter.)

## Spec (master plan §6 Sidebar, §2, §4)
- **分类 (Categories)** — expandable; lists `categories`; each shows a count. Right-click to create/rename/delete. Selecting one filters the list to its documents (`ListFilter.mode='category'`, `categoryId`).
- **CRUD** via `categories.create(name, moveToLibrary?)` / `categories.rename` / `categories.delete` (FK cascade removes `document_categories` rows).
- **Edit dialog exposes `moveToLibrary` override:** inherit global (NULL) / move into library (1) / keep in place (0) (i18n `detail.moveToLibraryInherit/Move/Keep`). Persist via `categories.setMoveToLibrary`.
- **Assignment chips** in the detail panel (Task 12 lays out the chip list; here wire add/remove to `categories.assign`/`unassign`).
- Empty categories state: "No categories yet — right-click to create one".

## Steps
1. Sidebar: expandable Categories section; list with counts; right-click context menu (create/rename/delete).
2. Create/Edit dialog with name + `moveToLibrary` override (inherit/move/keep).
3. Selecting a category → `ListFilter.mode='category'` → re-query.
4. Detail panel chip list → assign/unassign.
5. Empty state copy.

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- Categories CRUD (create/rename/delete via right-click) works; edit dialog exposes the `moveToLibrary` override (inherit/move/keep).
- Category-filtered list works; many-to-many assignment chips in detail panel add/remove.
- Deleting a category cascades its `document_categories` rows.

## Phase 4 DoD (this task owns)
- [ ] Categories CRUD UI (create/rename/delete via right-click); edit dialog exposes `moveToLibrary` override (inherit/move/keep).
- [ ] Category-filtered list works; many-to-many assignment chips in detail panel.
