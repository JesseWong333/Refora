# Task 09 — TopBar Component Test

**Phase:** 2 (Renderer Component & Store Tests) · **Prerequisites:** 08 · **Master plan:** Phase 2, Task 2.2

## Goal
Create `tests/component/TopBar.test.tsx` with `@testing-library/react`: verify mounts, button existence, click handlers, and search input behavior.

## Spec

`<TopBar />` is a React component that renders:
- "Add File" button — clicks → `window.api.import.addFiles(["/fake/doc.pdf"])`.
- "Add Folder" button — clicks → `window.api.import.addFolder("/fake/folder")`.
- Search input — typing dispatches `performSearch` action.
- Import progress bar — visible when `isImporting` is true.
- Buttons disabled during import.

## Test Cases

1. **Mounts without crash** — `render(<TopBar />)` does not throw.

2. **"Add File" button exists and triggers dialog** — Find button by accessible name / text.
   - Click button.
   - `window.api.import.addFiles` called once.
   - `window.api.import.addFolder` NOT called.

3. **"Add Folder" button exists and triggers dialog** — Find button by accessible name / text.
   - Click button.
   - `window.api.import.addFolder` called once.

4. **Search input renders** — Find `<input>` with placeholder (check i18n key `topbar.searchPlaceholder`).
   - Type text → verify input value changes.

5. **Search input triggers store** — Mock `useDocumentStore` to expose `performSearch = vi.fn()`.
   - Type 'hello' into search input.
   - `performSearch` called (debounced — advance timers).

6. **Import progress bar** — Set store `isImporting = true` and `importProgress = { current: 2, total: 5 }`.
   - Progress bar visible with text `2/5`.
   - "Add File" and "Add Folder" buttons disabled (`disabled` attribute).

7. **Progress bar hidden** — Set store `isImporting = false`.
   - Progress bar not in DOM.
   - Buttons enabled.

## Mock strategy

The component imports from Zustand store:
- Option A: Wrap component in a provider with a mocked store (if the store has a `<Provider>`).
- Option B: Use `vi.mock` on the store module to return controlled state.

Check how the app's store is consumed. If components use `useDocumentStore()` directly (Zustand default), use `vi.mock('@renderer/store/documentStore', ...)` to return a mock hook that provides controllable state:
```ts
vi.mock('@renderer/store/documentStore', () => ({
  useDocumentStore: vi.fn(() => ({
    isImporting: false,
    importProgress: null,
    fetchDocuments: vi.fn(),
    performSearch: vi.fn(),
  }))
}))
```

## Files to create
- `tests/component/TopBar.test.tsx`

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- 7+ test cases, all passing.
- Component mounts without crash in jsdom.
