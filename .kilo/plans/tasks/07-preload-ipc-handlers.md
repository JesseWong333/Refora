# Task 07 — Preload contextBridge + IPC handlers

**Phase:** 1 (Data layer) · **Prerequisites:** 05, 06 · **Master plan:** §3 (Preload), §8 (IPC API surface)

## Goal
Expose a typed, validated IPC API to the renderer via `contextBridge`, wire all `ipcMain` handlers to the repositories, and implement `getBootstrap()`. Every handler returns `Result<T>`. No PDF/IO/import logic yet (those arrive in Tasks 08+) — wire only the data-layer handlers now, leaving service-dependent handlers (import, openPdf, refreshMetadata, relocate, restore, export, watch mutations that need chokidar) as clearly-marked stubs that return `{ ok: false, error: { code: 'not_implemented' } }`.

## Spec — preload (`src/preload/index.ts`)
- `contextBridge.exposeInMainWorld('api', …)` exposing the full surface in `00-INDEX.md §3`.
- Typed `on/off` subscribe wrappers for events: `events.onDocumentUpdated(cb)`, `events.onImportProgress(cb)`, `events.off(channel, cb)` — backed by `ipcRenderer.on('document:updated' | 'import:progress')`. No raw `ipcRenderer` leaks; no Node objects leak.
- **Unwrap `Result<T>`**: on `{ ok: false }` throw a serializable `IpcError` (with `code` + `message`) the renderer can catch; on `{ ok: true }` return `data`.
- `getBootstrap()` is **async** — renderer awaits it before mounting (behind the language-neutral splash from Task 03). Returns `{ language, windowBounds, listColumnState, sidebarCollapsed }` (from settings repo, with safe defaults).
- `src/renderer/ipc.ts`: typed client wrappers over `window.api` for renderer use.

## Spec — handlers (`src/main/ipc/handlers.ts`)
- Register all `ipcMain.handle` for the API surface. Each handler wraps logic in try/catch and **always resolves a `Result<T>`** (never rejects). Validate inputs (paths resolved to absolute + `.pdf` where applicable; patches validated against the `EditableField` whitelist).
- Implement now (backed by repos from Task 06):
  - `documents.list`, `documents.search`, `documents.get`, `documents.update` (whitelist + `editedFields` management), `documents.setStarred`, `documents.delete`, `documents.bulkDelete`, `documents.bulkCategorize`.
  - `categories.*` (list/create/rename/delete/setMoveToLibrary/assign/unassign).
  - `settings.get/set`.
  - `getBootstrap`.
- Leave as `not_implemented` stubs (to be filled by later tasks): `documents.openPdf` (08/pdfOpen→Task 10), `documents.refreshMetadata`, `documents.bulkRefreshMetadata` (09), `documents.relocateFile`, `documents.restoreFile` (22/16), `import.addFiles/addFolder` (08), `watch.*` (18), `export.toJson`/`export.toBibtex` (23/24), `import.fromJson` (23).
- Events: provide an emitter helper to send `document:updated` and `import:progress` to the renderer (`webContents.send`). Services (Task 08+) will call it.

## Steps
1. `src/preload/index.ts` — full typed API + event wrappers + `Result` unwrap + `getBootstrap`.
2. `src/main/ipc/handlers.ts` — register handlers; try/catch → `Result`; input validation.
3. `src/main/ipc/types.ts` — re-export from `src/shared/ipc-types` (+ main-only types).
4. `src/renderer/ipc.ts` — typed client wrappers.
5. Wire `getBootstrap()` into the renderer mount flow (replace the Task 03 seam): await `window.api.getBootstrap()` before mounting React, behind the splash.

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- `documents.update` rejects non-`EditableField` keys with `forbidden_field`; `patch-whitelist.test.ts` passes against the **real** validation function (replace the Task 01 stub import).
- `documents.list(ListFilter)` covers all six modes end-to-end through IPC.
- `getBootstrap()` returns `{language, windowBounds, listColumnState, sidebarCollapsed}`; every handler resolves a `Result<T>`, never rejects (test: a handler that throws internally still returns `{ ok:false }`).

## Phase 1 DoD (this task owns)
- [ ] `documents.update` rejects non-`EditableField` keys with `forbidden_field`; `patch-whitelist.test.ts` passes against the real validation function.
- [ ] `documents.list(ListFilter)` covers all six `ListMode` values; FK cascade works (through IPC).
- [ ] `getBootstrap()` returns `{language, windowBounds, listColumnState, sidebarCollapsed}`; every handler resolves a `Result<T>`, never rejects.
