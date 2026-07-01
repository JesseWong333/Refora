# Task 11a — DocumentList: columns, sort, virtual scroll, resize

**Phase:** 3 (UI: list + detail) · **Prerequisites:** 07, 10 · **Master plan:** §6 (Middle list), §2 (Performance)

## Goal
Build the DocumentList with virtual scrolling, sortable columns, resizable + show/hide columns. This task establishes the list's structure + column model; row interactions (star, PDF-open, multi-select, context menu, DnD) are Task 11b.

## Spec (master plan §6 Middle list, §2 Performance)
- Columns: 论文名称(title) · 作者(authors) · 发表年份(year) · 期刊/会议(venue) · 添加时间(addedAt) · PDF位置(filePath). Plus a leading PDF-icon cell and a star toggle.
- **Virtual scrolling** via `@tanstack/react-virtual` (supports 500+ documents). List queries return all rows in one shot; renderer virtualizes.
- **Sort:** click column header → sort asc; click again → desc; arrow indicator. Default `addedAt` desc. Sort via `ListFilter.sort` → `documents.list`.
- **Resizable + show/hide columns:** column widths/order persisted in `settings.listColumnState`; show/hide via header context menu. Default `listColumnState` columns: `{ id, visible, width, order }[]`.
- **Loading:** 5-row skeleton placeholder with shimmer animation (state from Task 25 wires all four states; here implement the loading skeleton).

## Steps
1. DocumentList: integrate `@tanstack/react-virtual` for row virtualization.
2. Column header model: sortable (asc/desc + arrow), resizable (drag handles), show/hide context menu. Persist to `settings.listColumnState` (debounced) — read initial state from `getBootstrap()`.
3. Re-query `documents.list` with updated `sort` on header click; keep selection stable where possible.
4. Loading skeleton (5-row shimmer) while the list query is in flight.

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- DocumentList virtual-scrolls (`@tanstack/react-virtual`) with 500+ mock rows without jank.
- Columns sortable (asc/desc + arrows); default `addedAt` desc.
- Columns resizable + show/hide via header context menu; widths/order persist in `settings.listColumnState` across reload.
- Loading skeleton renders while querying.

## Phase 3 DoD (this task owns)
- [ ] DocumentList virtual-scrolls; columns sortable (asc/desc + arrows), resizable, show/hide via header context menu; default `addedAt` desc.
