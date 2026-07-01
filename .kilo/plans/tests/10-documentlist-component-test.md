# Task 10 — DocumentList Component Test

**Phase:** 2 (Renderer Component & Store Tests) · **Prerequisites:** 08 · **Master plan:** Phase 2, Task 2.3

## Goal
Create `tests/component/DocumentList.test.tsx`: verify empty state, document rows rendered, click-to-select, and sort behavior.

## Spec

`<DocumentList />` renders:
- Empty state when store has 0 documents.
- A table/grid of document rows when documents > 0.
- Each row shows fileName/title/authors/year/venue.
- Click on a row calls `setSelected(docId)`.
- Column headers are clickable for sort.

## Test Cases

1. **Empty state** — Store has `documents = []`.
   - "No documents" / empty-library placeholder visible (check i18n text).
   - No document rows in DOM.

2. **5 documents rendered** — Store has 5 mock documents.
   - 5 rows rendered.
   - Each row shows `fileName` or `title`.
   - Row indices 0–4 in DOM.

3. **Loading skeleton** — Store has `isLoading = true`.
   - Skeleton shimmer rows visible.
   - Document rows NOT visible.

4. **Click row → select** — Click on the first document row.
   - `setSelected(docId)` called with that doc's ID.
   - `focusedDocId` set in store.

5. **Sort click** — Click on "Title" column header.
   - `setSort({ field: 'title', dir: 'asc' })` called in store.
   - Column header shows sort indicator (▲).

6. **Star toggle** — Click star icon on a row.
   - `toggleStar(docId)` called for that doc.

## Mock strategy
Same as Task 09 — mock `useDocumentStore` via `vi.mock()`:
```ts
const mockDocuments = [
  { id: '1', title: 'Doc 1', authors: 'Author A', year: 2023, venue: 'Journal', fileName: 'doc1.pdf', filePath: '/pdfs/doc1.pdf', starred: 0, fileMissing: 0, metadataStatus: 'success' },
  // ...
]

vi.mock('@renderer/store/documentStore', () => ({
  useDocumentStore: vi.fn(() => ({
    documents: mockDocuments,
    isLoading: false,
    sort: { field: 'addedAt', dir: 'desc' },
    focusedDocId: null,
    selectedIds: [],
    setSort: vi.fn(),
    setSelected: vi.fn(),
    toggleStar: vi.fn(),
    toggleSelect: vi.fn(),
  }))
}))
```

## Files to create
- `tests/component/DocumentList.test.tsx`

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- 6+ test cases, all passing.
