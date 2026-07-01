# Task 02 — Tailwind + layout shell

**Phase:** 0 (Scaffold) · **Prerequisites:** 01 · **Master plan:** §8, §6

## Goal
Set up Tailwind with a VSCode-dark theme token set, and build the 3-pane layout shell (TopBar / Sidebar / DocumentList / DetailPanel) with placeholder data so the UI structure exists before real data is wired in.

## Steps
1. Configure `tailwind.config.ts` + postcss. Define VSCode-dark theme tokens (background, panel, border, text, accent, warning, error) as design tokens / CSS variables consumed by Tailwind.
2. Build `App.tsx` as a 3-pane responsive layout: collapsible sidebar (left), document list (middle), detail panel (right), with a top bar spanning the width. Use placeholder/mock data only.
3. Create the four placeholder components: `TopBar.tsx`, `Sidebar.tsx`, `DocumentList.tsx`, `DetailPanel.tsx` — each renders a static placeholder matching its future role (see master plan §6 feature specs for the intended content). No IPC calls yet.
4. Apply the dark theme globally; ensure the window background matches to avoid white flash before content paints.

## Spec reference (intended pane contents — full detail in master plan §6)
- **TopBar:** sidebar toggle · add file · add folder · watch folder · export BibTeX · search (right-aligned).
- **Sidebar:** All files / Recently read / Recently added / Starred; expandable Categories; expandable Folder grouping.
- **DocumentList:** columns title · authors · year · venue · addedAt · filePath + leading PDF-icon cell + star toggle.
- **DetailPanel:** inline-editable fields + Note.

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- `npm run dev` shows the 4-pane shell in VSCode-dark theme with placeholder content.

## Phase 0 DoD (this task owns)
- [ ] `npm run dev` launches a window with the 4-pane shell + VSCode-dark Tailwind theme.
