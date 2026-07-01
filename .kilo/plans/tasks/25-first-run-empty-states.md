# Task 25 — First-run wizard + empty/error/loading states

**Phase:** 6 (Settings, polish, edge cases) · **Prerequisites:** 02, 11a, 12 · **Master plan:** §5 (UI States & Feedback), §7 (First run), §6

## Goal
First-run wizard overlay + seed defaults, and ensure **every** view implements the four states (empty / loading / error / data) per master plan §5, including import-pipeline toasts.

## Spec — first run (master plan §7, §5)
- On empty DB: create DB + run migrations (Task 05) + seed default settings (+ optional seed categories — none by default per §11).
- First-run wizard overlay: "Welcome to ScholarNote" → choose library folder → ready. **Skip button available.**
- First run sets language from system locale (Task 04/05).

## Spec — four states per view (master plan §5)
- **Global:** skeleton placeholders on startup while DB initializes; network-error toast ("Crossref unreachable — using offline metadata", auto-dismiss 5s); first-run wizard.
- **Top bar:** import progress bar (3+ files, "Importing 12/50 PDFs…"); Add buttons disabled during import; search no-results "No documents match your search."
- **Sidebar:** empty categories "No categories yet — right-click to create one"; empty folder groups (icon + path, count 0).
- **Document list:** empty (no docs) centered illustration + "Add your first PDF"; empty (filtered) "No documents in this category. Drag a PDF here to add one."; loading 5-row skeleton shimmer (from 11a); error row badge (metadata failed, hover reason); missing-file row badge + disabled PDF icon.
- **Detail panel:** no-selection placeholder; multi-select bulk bar (Task 12); "Saving…/Saved"; refresh-metadata spinner overlay + toast; relocate.
- **Settings:** library/watch-folder validation errors (Task 19/21).
- **Import pipeline toasts:** hash duplicate modal (manual); password-protected PDF toast "Skipping encrypted PDF: [filename] (password-protected)"; corrupted PDF toast "Could not read: [filename] (file may be corrupted)."

## Steps
1. First-run wizard overlay + skip; seed defaults already in Task 05 — wire the wizard trigger (empty DB / first-run flag).
2. Audit every view (TopBar, Sidebar, DocumentList, DetailPanel, Settings, SearchBar) for all four states; fill gaps using §5 copy + i18n keys.
3. Import-pipeline toasts (encrypted/corrupted) — wire from importer error cases (Task 08).
4. Network-error toast from metadata fetch failure (Task 09).

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- First-run wizard appears on empty DB; skip works.
- All four UI states render for every view; password-protected/corrupted-PDF toasts fire.

## Phase 6 DoD (this task owns)
- [ ] First-run wizard appears on empty DB; all four UI states render for every view; password-protected/corrupted-PDF toasts fire.
