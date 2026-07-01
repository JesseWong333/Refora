# Task 08 — Document Store Test

**Phase:** 2 (Renderer Component & Store Tests) · **Prerequisites:** 01 · **Master plan:** Phase 2, Task 2.1

## Goal
Create `tests/unit/documentStore.test.ts` testing the Zustand store in isolation: `fetchDocuments()`, `performSearch()`, `init()` with event subscriptions, and basic state management actions.

## Spec

`src/renderer/store/documentStore.ts` uses Zustand. Test the store as a pure JavaScript module — no React rendering needed.

## Test Cases

### `fetchDocuments()`

1. **Successful fetch** — Call `fetchDocuments(filter)`.
   - Store `isLoading` is `true` during the call, `false` after.
   - `window.api.documents.list` called with the correct filter.
   - Store `documents` populated with returned data.
   - Store `error` is `null`.

2. **Fetch error** — Mock `api.documents.list` to return `{ ok: false, error: { code: '...' } }`.
   - Store `error` set to the error message.
   - `isLoading` set to `false`.
   - `documents` unchanged.

### `performSearch(query)`

3. **Short query (< 3 chars)** — Call `performSearch('ab')`.
   - After debounce, store `searchMode` is `'like'`.
   - `api.documents.search` called with `'ab'`.

4. **Long query (≥ 3 chars)** — Call `performSearch('abc')`.
   - After debounce, `searchMode` is `'fts'`.

5. **Debounce** — Call `performSearch('a')`, then `performSearch('ab')` within 100ms.
   - Use `vi.useFakeTimers()`.
   - Only the LAST query dispatched after debounce window (300ms default).
   - Only 1 API call made.

6. **Empty query** — Call `performSearch('')`.
   - Search cleared. Falls back to list mode with current filter.

### `init()`

7. **Event subscriptions** — Call `store.getState().init()`.
   - `window.api.events.onDocumentUpdated` called with a callback function.
   - `window.api.events.onImportProgress` called with a callback function.

8. **`destroy()` cleanup** — Call `destroy()`.
   - `window.api.events.off` called for both channels.
   - Store `subscriptions` cleared.

### State mutations

9. **`setSelected(id)`** — Updates `focusedDocId` and `selectedIds = [id]`.

10. **`toggleStar(id)`** — Calls `api.documents.setStarred(id, !currentStarred)`.
    - Updates local doc's `starred` field optimistically.

## Files to create
- `tests/unit/documentStore.test.ts`

## Mock strategy
- `window.api` — already stubbed by `tests/setup.ts`. Override per-test where needed:
  ```ts
  vi.spyOn(window.api.documents, 'list').mockResolvedValue({ ok: true, data: [...] })
  ```
- Zustand store itself is NOT mocked — test the real store actions, just mock its external dependencies (`window.api`).

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- 10+ test cases, all passing.
