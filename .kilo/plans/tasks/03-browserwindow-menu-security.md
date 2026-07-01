# Task 03 — BrowserWindow, menu, security, logging

**Phase:** 0 (Scaffold) · **Prerequisites:** 01 · **Master plan:** §3 (Security), §3 (Startup), §2 (macOS menu, Keyboard)

## Goal
Create a secure `BrowserWindow`, the native macOS application menu, app-scoped keyboard shortcuts, electron-log file logging, and the language-neutral splash. Establish the startup skeleton (steps 1–7 of the startup sequence in `00-INDEX.md §2`) — DB/migrations/watchers arrive in later tasks.

## Steps
1. **`src/main/index.ts`** app lifecycle + the startup sequence from `00-INDEX.md §2` (steps 1–7). Where later tasks supply pieces (DB open, bootstrap settings, proxy, watchers), leave clearly-marked TODO seams that return sensible defaults (e.g. `getBootstrap()` returns default language + null bounds) so the app boots now.
2. **Secure BrowserWindow config:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no `remote`. Show window only after `did-finish-load` to avoid white flash.
3. **CSP** per `00-INDEX.md §0` Security baseline: prod strict; dev (only when `!app.isPackaged`) adds `'unsafe-inline'` to script-src + `ws://localhost:*` to connect-src for HMR.
4. **Native macOS `Menu`** with: File (Add File, Add Folder, Watch Folder, Export → JSON… / BibTeX…), Edit (Undo/Redo, Cut/Copy/Paste), Window, Help. Menu items can be no-ops/stubs now (handlers wired in later tasks) but the structure + accelerators must exist.
5. **Keyboard shortcuts:** Cmd+F (focus search), Cmd+I (import file), Cmd+Backspace (delete selected), Cmd+S (save note), arrow keys (list nav), Enter (open PDF), Space (preview placeholder). Implement via `Menu` accelerators + renderer `keydown` handlers. **Do NOT import `globalShortcut`.**
6. **electron-log** initialized to `app.getPath('logs')`; DEBUG in dev, INFO in production. Wrap in `src/main/services/logger.ts`.
7. **Language-neutral splash:** before the renderer resolves `getBootstrap()`, show a splash (logo + spinner, no translatable text) so there's no wrong-language flash. (Bootstrap returns real `language` once settings exist — Task 05/07.)

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- `npm run dev` shows the menu bar with File/Edit/Window/Help; window opens without white flash; language-neutral splash shows before bootstrap resolves.
- `grep -r globalShortcut src/` returns nothing (no globalShortcut import anywhere).

## Phase 0 DoD (this task owns)
- [ ] Secure window config + CSP (dev allows HMR ws, prod strict); menu bar present; electron-log to file.
- [ ] Language-neutral splash shows before bootstrap resolves.
- [ ] No `globalShortcut` import anywhere.
