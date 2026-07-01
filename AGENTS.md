# ScholarNote — Agent Guide

## Platform
macOS only.

## Verification gate
After **any** code change, before declaring work done, run:
```
npm run typecheck && npm run lint && npm run test
```
- Smoke a feature with `npm run dev`.
- Before claiming a build works: `npm run package`.

A task's own Verification assertions must also pass. Do not mark a task done until both the gate and the task's assertions pass.

## Doc navigation
The master plan (`.kilo/plans/1782864927939-scholarnote-literature-manager.md`) is the spec of record; `docs/*.md` (when they exist) take precedence over it. Load only the section a task needs — never read all docs at once. Task files live in `.kilo/plans/tasks/`; load **one** at a time. `00-INDEX.md` is the entry point (global rules, stack, IPC surface, dependency table, execution order).

## Security baseline (never violate)
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (preload), no `remote`.
- All file-path args validated to be `.pdf` and resolved to absolute paths in main before any fs action.
- CSP per spec — prod: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'`. Dev (only when `!app.isPackaged`): add `'unsafe-inline'` to script-src + allow `ws://localhost:*` in connect-src for HMR.
- Every IPC response is a typed envelope `Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }`. Handlers never throw across the bridge (wrap in try/catch, always resolve). Preload unwraps `{ok:false}` into a serializable `IpcError`.
- Keyboard shortcuts are app-scoped only: `Menu` accelerators + renderer `keydown`. NEVER import `globalShortcut`.

## Don't-do list
- No code comments unless asked.
- Never delete a source PDF from disk (delete = remove DB record only).
- Never read a whole PDF into memory for hashing (stream it).
- Never git commit unless explicitly asked.
- If a test fails and you can't fix it, or a task is blocked, STOP and report — don't guess.

## Toolchain notes
- Native module `better-sqlite3` is rebuilt for Electron's ABI via `@electron/rebuild` (`postinstall` + `npm run rebuild`). Rebuilding compiles from source and requires Xcode Command Line Tools (accept the license: `sudo xcodebuild -license accept`).
- `tsc -b` (typecheck) uses project references and **excludes test files**; tests are run by vitest only.
