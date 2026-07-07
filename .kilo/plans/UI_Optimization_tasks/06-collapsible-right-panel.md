# Task 06 — Collapsible Right Detail Panel (Hidden by Default)

## Objective
Make the right detail panel (`DetailPanel`) collapsible and **hidden by default**. It should slide in from the right only when a document is selected in the center panel, and the user should be able to collapse it again afterward.

## Files to Modify
- `src/renderer/App.tsx` — manage right panel visibility state and animation
- `src/renderer/components/DetailPanel.tsx` — add collapse button inside the panel
- Optionally: `src/renderer/store/documentStore.ts` — if a new panel visibility state is needed

## Specific Changes

### 1. Add right panel open/close state
In `App.tsx`, determine when the right panel should be open:
- **Closed by default** (no doc focused, no multi-select)
- **Opens automatically** when `focusedDoc` is set (user clicks a document row) OR when 2+ items are selected (multi-select)
- **Close button** inside DetailPanel allows user to collapse it

Use local React state in `App.tsx`:
```tsx
const [rightPanelOpen, setRightPanelOpen] = useState(false)
```

Set `rightPanelOpen` to `true` when `focusedDoc || selectedIds.length >= 2`:
```tsx
useEffect(() => {
  if (focusedDoc || selectedIds.length >= 2) {
    setRightPanelOpen(true)
  }
}, [focusedDoc, selectedIds])
```

### 2. Animate the panel with width transition
Replace the static `w-96` with a conditional width that animates:

```tsx
<div
  className={clsx(
    'shrink-0 overflow-hidden border-l border-border bg-panel transition-all duration-200',
    rightPanelOpen ? 'w-96' : 'w-0 border-l-0'
  )}
>
  <DetailPanel onClose={() => setRightPanelOpen(false)} />
</div>
```

Key points:
- Use Tailwind's `transition-all duration-200` for smooth slide animation
- When closed: `w-0 border-l-0 overflow-hidden` (completely hidden)
- When open: `w-96 border-l border-border` (normal width)
- `shrink-0` prevents the flex container from squeezing it
- `overflow-hidden` prevents content from spilling out during the transition

### 3. Add collapse/close button to DetailPanel
In `DetailPanel.tsx`, accept an `onClose` prop and render a close button:

```tsx
interface DetailPanelProps {
  onClose?: () => void
}
```

Add a close button in the panel header area (top-right or top-left corner):
```tsx
<button
  className="toolbar-btn absolute right-2 top-2"
  onClick={onClose}
  title={t('common.close')}
  aria-label={t('common.close')}
>
  <X className="h-4 w-4" />
</button>
```

The panel container needs `relative` positioning. The close button should not overlap content.

### 4. Handle edge cases
- When the panel is manually closed but a document is still focused, clicking the document again should re-open the panel
- When the focused doc changes (user clicks a different row), the panel should stay open with the new content
- When `focusedDoc` is cleared (e.g., user clicks away / presses Escape in DocumentList), the panel can optionally auto-close OR stay open until manually closed — **choose auto-close** for better UX. Add a separate `useEffect`:
  ```tsx
  useEffect(() => {
    if (!focusedDoc && selectedIds.length === 0) {
      setRightPanelOpen(false)
    }
  }, [focusedDoc, selectedIds])
  ```

### 5. Adjust DocumentList click behavior
In `DocumentList.tsx`, clicking a row already calls `setFocusedDoc(doc)` from the store. With the auto-open logic, this will trigger the panel. Verify there's a way to deselect/clear `focusedDoc` — e.g., clicking the same row again, or pressing Escape while in the document list. If not, add Escape key handling in DocumentList to clear `focusedDoc`.

## Acceptance Criteria
- Right detail panel is hidden (width 0) on app launch
- Clicking a document in the center panel opens the right panel with a smooth slide animation
- The panel shows document details (SingleDetail), multi-select actions (BulkBar), or placeholder as before
- An X (close) button is visible in the panel to collapse it manually
- When the panel is closed, clicking another document re-opens it
- Panel auto-closes when focused document is deselected and no items are multi-selected
- The center document list resizes to fill the available space when the panel opens/closes
- `npm run typecheck && npm run lint` passes
- Visual smoke test: animation is smooth, content not cut off during transition

## Dependencies
- **Task 02** — The floating app shell layout must be in place so the right panel's border/shadow appears correctly within the floating container
- No dependency on Tasks 03/04/05 (sidebar changes are independent)
