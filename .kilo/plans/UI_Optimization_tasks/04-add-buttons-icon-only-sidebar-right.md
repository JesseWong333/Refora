# Task 04 — Icon-Only Add/Add Folder on Right Edge of Sidebar

## Objective
Move the "Add File" and "Add Folder" actions from the TopBar into the left sidebar, placing them as icon-only buttons positioned along the right edge of the sidebar. This creates a compact vertical action strip, matching LobeHub's hover-reveal or always-visible icon-only action pattern.

## Files to Modify
- `src/renderer/components/TopBar.tsx` — remove Add File and Add Folder buttons
- `src/renderer/components/Sidebar.tsx` — add icon-only action buttons on the right edge

## Specific Changes

### 1. In `TopBar.tsx` — Remove
- Remove the **Add File** button (currently around line 63–66)
- Remove the **Add Folder** button (currently around line 67–70)
- Remove unused icon imports (`FilePlus`, `FolderPlus`) if they're no longer used in TopBar
- Keep the divider that was between them (the one after the ScholarNote label) — or remove it and adjust layout

### 2. In `Sidebar.tsx` — Add right-edge icon-only buttons
The sidebar's right edge should have two small icon buttons stacked vertically:

**Approach**: Add a fixed-position or absolute-position container on the right side of the sidebar:

```tsx
<div className="absolute right-1 top-3 flex flex-col gap-1">
  <button
    className="toolbar-btn p-1"  // small, icon-only
    onClick={() => window.api.import.addFiles([])}
    title={t('sidebar.addFile')}
    aria-label={t('sidebar.addFile')}
  >
    <FilePlus className="h-4 w-4" />
  </button>
  <button
    className="toolbar-btn p-1"
    onClick={() => window.api.import.addFolder('')}
    title={t('sidebar.addFolder')}
    aria-label={t('sidebar.addFolder')}
  >
    <FolderPlus className="h-4 w-4" />
  </button>
</div>
```

Key points:
- The sidebar container needs `relative` positioning (it may already have it, check)
- Buttons are icon-only — no text labels
- Use `toolbar-btn` class from `index.css` or create a new minimal icon-only button class
- Stack vertically with `flex-col gap-1`
- Positioned at `right-1 top-3` (top-right area of the sidebar) — adjust values to align with the sidebar content visually
- Add `title` and `aria-label` for accessibility
- The buttons should be small and unobtrusive

**LobeHub inspiration**: In LobeHub, sidebar action buttons are hidden by default and revealed on hover via CSS transitions. Consider implementing this:
```css
.sidebar-actions {
  opacity: 0;
  transition: opacity 150ms ease;
}
.sidebar:hover .sidebar-actions {
  opacity: 1;
}
```

### 3. Update imports in `Sidebar.tsx`
Add:
- `FilePlus`, `FolderPlus` from `lucide-react`

### 4. Adjust TopBar layout
With Add File, Add Folder, Settings, Export JSON, and Export BibTeX all removed from TopBar, the remaining elements are:
- Sidebar toggle
- ScholarNote label
- Divider
- Watch Folders
- (Search — stays for now, will be moved in Task 05)

Adjust the TopBar layout to look clean with fewer buttons. The Watch Folders button and search input remain.

## Acceptance Criteria
- Add File and Add Folder buttons are no longer in the TopBar
- Two icon-only buttons (FilePlus icon, FolderPlus icon) appear on the right edge of the sidebar
- Buttons are stacked vertically, small and unobtrusive
- Clicking Add File opens the OS file dialog and imports the selected PDFs
- Clicking Add Folder opens the OS folder dialog and imports PDFs from the selected folder
- Hover state on the sidebar reveals buttons with a smooth transition (if implementing hover-reveal)
- `npm run typecheck && npm run lint` passes
- Visual smoke test: buttons are positioned correctly and don't overlap sidebar content

## Dependencies
- **Task 03** — Sidebar now has a bottom utility section. The icon-only buttons should not visually conflict with it. Position the icon buttons high enough (top area) so they don't overlap the bottom utilities when the sidebar is scrolled.
