# Task 05 — Move Search Bar to Center Panel (DocumentList)

## Objective
Remove the global search input from the TopBar and place it instead in the center panel's document list header area, so search is contextual to the document list.

## Files to Modify
- `src/renderer/components/TopBar.tsx` — remove search input
- `src/renderer/components/DocumentList.tsx` — add search bar to the header area

## Specific Changes

### 1. In `TopBar.tsx` — Remove
- Remove the search `<input>` and its wrapping `<div>` (currently around lines 103–117)
- Remove the `Search` icon import and any unused imports
- Remove the `searchQuery`, `performSearch`, `clearSearch`, `isSearching` destructuring from `useDocumentStore` (or keep if still used elsewhere in TopBar)

### 2. In `DocumentList.tsx` — Add search bar in the header area
The current header (line 424–426) shows a label like `"All Files · N"`. Replace or extend it to include a search input:

```tsx
<div className="flex items-center gap-3 border-b border-border px-4 py-2">
  <Search className="h-4 w-4 shrink-0 text-muted" />
  <input
    className="search-input flex-1"
    placeholder={t('documentList.search')}
    value={searchQuery}
    onChange={(e) => performSearch(e.target.value)}
    onKeyDown={(e) => { if (e.key === 'Escape') clearSearch() }}
  />
  {isSearching && searchResults && (
    <span className="shrink-0 text-xs text-muted">
      {searchResults.length} {t('common.results')}
    </span>
  )}
</div>
```

Key points:
- Place the search bar at the very top of the document list area, above the column headers
- Use the existing `.search-input` class from `index.css` (which already has `w-56`, `rounded-lg`, `border`, `bg-background`, `pl-8`). Override or remove the fixed `w-56` so it can flex-fill the available width
- Import `Search` from `lucide-react`
- Import `searchQuery`, `isSearching`, `searchResults`, `performSearch`, `clearSearch` from `useDocumentStore`
- The search bar should have a subtle separation from the column headers — a `border-b border-border` or padding gap

### 3. Adjust `.search-input` CSS class if needed
The current `.search-input` class in `index.css` has `@apply w-56`. This fixed width is fine for the TopBar but in the center panel we may want it to expand. Options:
- Remove the `w-56` from the class and apply width per-instance
- OR create a new variant `.search-input-wide` without the width constraint
- OR use an inline width override

Prefer removing `w-56` from the `.search-input` class and applying `w-56` only on the instance that needs it (no longer exists). In the DocumentList, the input gets `flex-1`.

### 4. Remove search from TopBar cleanly
After removing search, the TopBar right area may be empty or just have the Watch Folders button and import progress. Adjust spacing accordingly.

## Acceptance Criteria
- Search input is no longer visible in the TopBar
- Search input is present at the top of the DocumentList, above the column headers
- Typing in the search bar filters documents in the center panel (existing search logic unchanged)
- Pressing Escape clears the search and restores the full document list
- The search result count is shown when searching
- Column headers and document rows render below the search bar
- `npm run typecheck && npm run lint` passes
- Visual smoke test: search bar is visually integrated into the document list header

## Dependencies
- None strict, but ideally after Task 02 (floating shell) so the center panel's boundaries are clearly defined
