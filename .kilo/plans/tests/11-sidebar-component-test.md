# Task 11 — Sidebar Component Test

**Phase:** 2 (Renderer Component & Store Tests) · **Prerequisites:** 08 · **Master plan:** Phase 2, Task 2.4

## Goal
Create `tests/component/Sidebar.test.tsx`: verify smart list items, category rendering, and click interactions.

## Spec

`<Sidebar />` renders:
- Smart lists: "All Documents", "Recently Read", "Recently Added", "Starred".
- Categories section with category names and counts.
- Folders section with folder paths and counts.
- Click on a smart list → `setListMode({ mode })` called.
- Click on a category → `setListMode({ mode: 'category', categoryId })` called.

## Test Cases

1. **Mounts without crash** — `render(<Sidebar />)`.

2. **Smart list items rendered** — All 4 smart list items present in DOM.
   - Accessible text for each (use i18n keys: `sidebar.allFiles`, `sidebar.recentlyRead`, `sidebar.recentlyAdded`, `sidebar.starred`).

3. **Smart list click** — Click "All Documents".
   - `setListMode({ mode: 'all' })` called.

4. **Categories rendered** — Store has 3 categories.
   - 3 category items rendered with names and counts.

5. **0 categories — no crash** — Store has `categories = []`.
   - Empty state placeholder visible (e.g., "No categories yet").
   - No category items.

6. **Category click** — Click a category.
   - `setListMode({ mode: 'category', categoryId })` called with correct ID.

7. **Active item highlighted** — Store has `listMode: { mode: 'starred' }`.
   - "Starred" item has `bg-active` class.
   - Other items do not.

## Mock strategy
Mock `useDocumentStore`:
```ts
vi.mock('@renderer/store/documentStore', () => ({
  useDocumentStore: vi.fn(() => ({
    categories: [
      { id: 'cat1', name: 'ML', count: 5 },
      { id: 'cat2', name: 'NLP', count: 3 },
      { id: 'cat3', name: 'Vision', count: 7 },
    ],
    listMode: { mode: 'all' },
    setListMode: vi.fn(),
    fetchCategories: vi.fn(),
  }))
}))
```

## Files to create
- `tests/component/Sidebar.test.tsx`

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- 7+ test cases, all passing.
