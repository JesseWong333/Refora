# Task 18 — Watcher (chokidar)

**Phase:** 5 (Watch & search) · **Prerequisites:** 08 · **Master plan:** §3 (Watching), §6 (Watch folder), §7 (Watch add-only, Move-to-library vs watch)

## Goal
`watcher.ts`: chokidar per watch folder, recursive, PDF-only, add-only, `awaitWriteFinish`, library-folder exclusion, debounce, hooked into the importer. Start watchers in the startup sequence (step 8).

## Spec (master plan §3, §7)
- One chokidar watcher per enabled `watch_folders` row; recursive; PDF-only; **add-only** (deletion/rename of a watched file never removes or clears its DB record).
- `awaitWriteFinish` to avoid reading half-written files; debounce rapid bursts.
- **Library folder excluded** from watching (so move-to-library doesn't re-import).
- On add → import pipeline with **watch dedup behavior**: path dedup always; hash-dedup auto-skips silently (no confirmation dialog).
- Rename fires chokidar add for the new name → path dedup treats as new (acceptable) unless hash matches existing → skip.
- Deletion of a watched source file → record persists (never removed).
- `watch.*` IPC: `list`/`add`/`remove`/`toggle` — add/remove/toggle start/stop the corresponding chokidar instance. (CRUD UI is Task 19.)
- Library-vs-watch mutual exclusion: if user sets library path inside a watch folder, or adds a watch folder inside the library path, refuse (validation message in Task 19/21). Content-hash dedup is the safety net.

## Steps
1. `src/main/services/watcher.ts` — start/stop per-folder chokidar; PDF-only globs; `awaitWriteFinish`; debounce; library exclusion.
2. Hook `add` events → importer (watch behavior).
3. `watch.*` IPC handlers (replace Task 07 stubs): add/remove/toggle manage chokidar instances + `watch_folders` rows.
4. Start enabled watchers in startup sequence step 8.

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- chokidar watchers: recursive, PDF-only, add-only, `awaitWriteFinish`; library folder excluded.
- Rename → new add (path dedup); deletion never removes DB record.
- Adding a new PDF to a watched folder imports it (auto-skip on hash dup); toggling a watch folder off stops watching.

## Phase 5 DoD (this task owns)
- [ ] chokidar watchers: recursive, PDF-only, add-only, `awaitWriteFinish`; library folder excluded; rename → new add (path dedup); deletion never removes DB record.
