# Task 12 — DetailPanel Component Test

**Phase:** 2 (Renderer Component & Store Tests) · **Prerequisites:** 08 · **Master plan:** Phase 2, Task 2.5

## Goal
Create `tests/component/DetailPanel.test.tsx`: verify empty state, field rendering, inline edit → save flow, and NoteField autosave.

## Spec

`<DetailPanel />` renders:
- "No document selected" placeholder when `focusedDocId` is null.
- Document fields (title, authors, year, venue, volume, abstract, keywords, url, doi, note) when a doc is selected.
- InlineField: click to edit, blur/Enter saves via `window.api.documents.update`, Escape cancels.
- NoteField: `<textarea>` with 1s debounce autosave on change.
- Category chips for assigned categories.

## Test Cases

1. **No selection — empty state** — Store has `focusedDocId = null`.
   - "Select a document" placeholder visible.
   - No InlineFields rendered.

2. **Selected doc — fields rendered** — Store has focused doc with all fields populated.
   - Title, authors, year, venue, abstract, keywords, url, doi, note all visible.
   - Categories rendered as chips.

3. **Inline edit → blur → save** — Click on title field to enter edit mode.
   - `<input>` or `<textarea>` appears.
   - Type new title. Blur.
   - `window.api.documents.update(id, { title: 'new title' })` called.
   - "Saved" indicator briefly appears.

4. **Inline edit → Escape → cancel** — Enter edit mode, press Escape.
   - Original value restored.
   - No API call made.

5. **Inline edit → Enter → save** — Enter edit mode, press Enter.
   - Same as blur — saves via API.

6. **NoteField autosave** — Type in note `<textarea>`.
   - Advance timers 1s.
   - `window.api.documents.update(id, { note: '...' })` called.

7. **Empty fields shown as placeholder** — Doc has `abstract: null`.
   - Field displays placeholder text.
   - Click to edit still works.

## Mock strategy
Mock `useDocumentStore` and `window.api`:
```ts
const mockDoc = {
  id: '1', title: 'Test Paper', authors: 'Smith, J.',
  year: 2024, venue: 'Nature', volume: '10', issue: '2',
  abstract: 'An important study.', keywords: 'ML, AI',
  url: 'https://example.com', doi: '10.1234/test', note: 'Good read',
  filePath: '/pdfs/test.pdf', fileName: 'test.pdf', starred: 1,
  fileMissing: 0, metadataStatus: 'success', categories: [{ id: 'c1', name: 'ML' }],
  editedFields: [], remoteValues: {}
}

vi.mock('@renderer/store/documentStore', () => ({
  useDocumentStore: vi.fn(() => ({
    focusedDocId: '1',
    documents: [mockDoc],
    selectedIds: [],
    categories: [{ id: 'c1', name: 'ML', count: 5 }],
    updateDocument: vi.fn(),
    fetchCategories: vi.fn(),
    deleteDoc: vi.fn(),
  }))
}))
```

## Files to create
- `tests/component/DetailPanel.test.tsx`

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- 7+ test cases, all passing.
