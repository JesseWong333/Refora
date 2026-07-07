# Task 03 — Relocate Settings & Export to Bottom of Left Sidebar

## Objective
Move the Settings, Export JSON, and Export BibTeX actions from the TopBar to the bottom region of the left sidebar, matching LobeHub's pattern of placing utility actions in the lower sidebar area.

## Files to Modify
- `src/renderer/components/TopBar.tsx` — remove Settings and Export buttons
- `src/renderer/components/Sidebar.tsx` — add a bottom utility section

## Specific Changes

### 1. In `TopBar.tsx` — Remove
- Remove the **Settings** button (currently around line 75–78)
- Remove the **Export JSON** button (currently around line 79–82)
- Remove the **Export BibTeX** button (currently around line 83–86)
- Keep all other buttons intact (Add File, Add Folder, Watch Folders, sidebar toggle, ScholarNote label, divider, search)
- Remove any unused icon imports (Settings, FileJson, FileText) if they're no longer used in TopBar

### 2. In `Sidebar.tsx` — Add bottom utility section
At the bottom of the sidebar, below the "Folder Grouping" section, add a new section:

```tsx
{/* Utility section at bottom */}
<div className="mt-auto border-t border-border pt-2">
  <SidebarItem
    icon={<Settings className="h-4 w-4" />}
    label={t('sidebar.settings')}
    onClick={() => setSettingsOpen(true)}
  />
  <SidebarItem
    icon={<FileJson className="h-4 w-4" />}
    label={t('sidebar.exportJson')}
    onClick={() => window.api.export.toJson()}
  />
  <SidebarItem
    icon={<FileText className="h-4 w-4" />}
    label={t('sidebar.exportBibtex')}
    onClick={() => window.api.export.toBibtex(selectedIds)}
    disabled={disabled}
  />
</div>
```

Key points:
- Use `mt-auto` to push this section to the bottom of the sidebar
- Add a thin `border-t border-border` separator line above the utility items
- Reuse the existing `SidebarItem` component pattern already used for smart list items
- The `selectedIds` and export disabled state need to be available in Sidebar — import from the Zustand store (`useDocumentStore`)
- For Settings, import the existing `SettingsModal` component and manage its open state locally (or lift to a store)
- Add necessary i18n keys if `sidebar.settings`, `sidebar.exportJson`, `sidebar.exportBibtex` don't exist

### 3. Update imports in `Sidebar.tsx`
Add imports:
- `Settings`, `FileJson`, `FileText` from `lucide-react`
- `useDocumentStore` (for `selectedIds`)
- `SettingsModal` component
- Any missing i18n hook usage

## Acceptance Criteria
- Settings, Export JSON, and Export BibTeX buttons are no longer in the TopBar
- They appear at the bottom of the left sidebar in a separated utility section
- The utility section is pushed to the bottom via `mt-auto`
- Settings clicking opens the existing `SettingsModal`
- Export JSON works (exports all documents)
- Export BibTeX respects selection state (disabled when nothing selected, exports selected docs)
- `npm run typecheck && npm run lint` passes
- Visual smoke test: sidebar scroll position and utility section visibility at bottom

## Dependencies
- **Task 02** — The sidebar layout should already be inside the floating container, so the bottom utility section properly sits at the bottom of the sidebar panel

## Notes
- Task 05 will handle moving the "Add" and "Add Folder" buttons from TopBar to the sidebar's right edge. Do NOT move those in this task.
- The Watch Folders button stays in TopBar for now (unless the user explicitly requests moving it later).
