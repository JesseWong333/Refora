# Task 21 — Settings (library, proxy, language, theme, move policy)

**Phase:** 6 (Settings, polish, edge cases) · **Prerequisites:** 07, 19 · **Master plan:** §6 (Settings), §2 (i18n, proxy), §7

## Goal
Complete the Settings window/modal: library folder, Crossref mailto, proxy, theme, sidebar-collapse persistence, **language dropdown (zh/en)**, and the global `moveToLibraryOnCategorize` toggle. Wire watch-folder mutual exclusion (coordinated with Task 19).

## Spec (master plan §6 Settings, §2, §7)
- **Library folder** picker — validates not inside a watch folder ("Path cannot be inside a watch folder.").
- **Watch folders** list (Task 19) — validates not inside the library folder ("Path cannot be inside the library folder.").
- **Crossref polite-pool mailto.**
- **Proxy (HTTP/HTTPS, optional)** — applied to `defaultSession` via `session.setProxy({ proxyRules: proxyUrl })` on startup **and** whenever `settings.proxyUrl` changes (empty string = direct). Affects Crossref/arXiv fetch only.
- **Theme** (dark default).
- **Sidebar collapse persistence** (`settings.sidebarCollapsed`).
- **Language (语言)** dropdown: 中文 / English. Stored in `settings.language`. Changing it calls `i18next.changeLanguage()` → UI updates immediately without restart; persisted across sessions. Default: system locale if `zh*` else `en` (first-run detection from Task 04/05).
- **`moveToLibraryOnCategorize`** toggle (default ON). Per-category overrides are edited via category create/edit (Task 15); here only the global toggle.

## Steps
1. Settings UI sections per spec; each backed by `settings.get/set`.
2. Library + watch-folder mutual-exclusion validation (coordinate with Task 19).
3. Proxy: on `settings.proxyUrl` change → `session.setProxy`; also apply on startup (startup step 5).
4. Language dropdown → `settings.set('language', lang)` + `i18next.changeLanguage(lang)`.
5. `moveToLibraryOnCategorize` toggle.

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- Settings: library/watch-folder mutual-exclusion validation works.
- Proxy applied to `defaultSession` on change + startup (verify Crossref requests route through it, or fail predictably if unreachable).
- Language switch updates UI live + persists after relaunch.
- `moveToLibraryOnCategorize` toggle persists and affects drag-to-category (Task 16).

## Phase 6 DoD (this task owns)
- [ ] Settings: library/watch-folder mutual-exclusion validation; proxy applied on change + startup; language switch updates UI live + persists.
