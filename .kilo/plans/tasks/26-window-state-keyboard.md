# Task 26 — Window state persistence + keyboard shortcuts

**Phase:** 6 (Settings, polish, edge cases) · **Prerequisites:** 03, 07 · **Master plan:** §2 (Window state, Keyboard), §3 (Startup sequence)

## Goal
Persist window bounds, sidebar width, and list column widths/order to the `settings` DB (debounced + flushed on close/before-quit) and restore on startup. Finalize all keyboard shortcuts via `Menu` accelerators + renderer `keydown` (no `globalShortcut`).

## Spec — window state (master plan §2 Window state, §3 Startup)
- Persist: window bounds (`{ x, y, width, height, isMaximized }`), sidebar width, list column widths/order (`listColumnState`).
- **Debounced (500ms)** on window `resize`/`move`; **flushed** on window `close` (macOS red-dot close, which does NOT fire `before-quit`) **and** on app `before-quit` (Cmd+Q).
- **Restored on startup** — read before `createWindow` (startup step 6) so the window opens at the right place/size the first frame (no flicker). `getBootstrap()` carries `windowBounds` + `listColumnState`.
- Sidebar collapse persisted in `settings.sidebarCollapsed` (Task 21).

## Spec — keyboard shortcuts (master plan §2 Keyboard)
- Cmd+F (focus search), Cmd+I (import file), Cmd+Backspace (delete selected), Cmd+S (save note), arrow keys (list navigation), Enter (open PDF), Space (preview placeholder).
- **App-scoped only:** `Menu` accelerators + renderer `keydown`. **Do NOT use `globalShortcut`** (would hijack Cmd+F system-wide).

## Steps
1. Window state: debounced save on resize/move; flush on `close` + `before-quit`; restore on startup from `settings.windowBounds`.
2. Sidebar width + list column state persistence (list columns from Task 11a `listColumnState`).
3. Finalize keyboard shortcuts via Menu accelerators + renderer keydown handlers (skeleton from Task 03).
4. Verify no `globalShortcut` import anywhere.

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- Window bounds restored after red-dot close (no Cmd+Q) **and** after Cmd+Q.
- All keyboard shortcuts work via Menu accelerators + keydown (no `globalShortcut` import anywhere — `grep -r globalShortcut src/` empty).

## Phase 6 DoD (this task owns)
- [ ] Window bounds restored after red-dot close (no Cmd+Q) AND after Cmd+Q; all keyboard shortcuts work via Menu accelerators + keydown (no `globalShortcut` import anywhere).
