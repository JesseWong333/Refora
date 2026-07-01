# Task 05 — Watcher Service Test

**Phase:** 1 (Service Unit Tests) · **Prerequisites:** 01 · **Master plan:** Phase 1, Task 1.4

## Goal
Create `tests/unit/watcher-service.test.ts` covering `createWatcher()`: `start()`, `stop()`, `startAll()`, and event handling (add/change/unlink for various file types).

## Spec

`createWatcher(repos, importer, libraryPath)` returns:
- `start(folderPath)` — creates a chokidar watcher on the folder, recursive, PDF-only, add-only.
- `stop(folderPath)` — closes the watcher.
- `startAll(enabledFolders: { path: string }[])` — starts watchers for all enabled folders.
- Add events are debounced (500ms window) then call `importer.importFiles(paths, { mode: 'watch' })`.
- Library folder is excluded via chokidar's `ignored` option.

## Test Cases

### `start(folderPath)`

1. **Correct chokidar options** — `start('/watch/dir')` calls `chokidar.watch('/watch/dir', opts)`.
   - `opts.ignored` excludes `libraryPath`.
   - `opts.depth` is `undefined` (recursive).
   - `opts.awaitWriteFinish` is truthy with `stabilityThreshold` ≥ 1000ms.
   - Watched paths use glob / regex that only matches `*.pdf`.

2. **Library folder excluded** — Verify `ignored` callback/path returns `true` for paths inside `libraryPath`.

### Add events

3. **New .pdf file** — Fake watcher emits `'add'` for `/watch/dir/new.pdf`.
   - After debounce window (500ms), `importer.importFiles(['/watch/dir/new.pdf'], { mode: 'watch' })` is called.
   - Use `vi.useFakeTimers()` to advance past the debounce.

4. **Multiple .pdfs in batch** — Fake watcher emits `'add'` for `a.pdf`, then `b.pdf`, then `c.pdf` within 300ms.
   - Only ONE `importer.importFiles` call with all 3 paths (debounce collects them).

5. **Non-PDF file** — Fake watcher emits `'add'` for `/watch/dir/readme.txt`.
   - Filtered out at the `ignored` level or handler level. `importer.importFiles` never called.

### Ignored events

6. **`change` event on PDF** — Ignored. `importer.importFiles` never called.
7. **`unlink` event on PDF** — Ignored. DB record preserved. `importer.importFiles` never called.

### Lifecycle

8. **`stop(folderPath)`** — Calls `watcher.close()` for the matching watcher, removes from internal map.

9. **`startAll([{ path: '/a' }, { path: '/b' }])`** — Calls `start('/a')` and `start('/b')`.

10. **Duplicate start** — `start('/same/path')` called twice. Only one chokidar watch created. Second call is a no-op.

## Mock scope
- `chokidar` — via `tests/mocks/chokidar.ts` (returns fake `FSWatcher` EventEmitter).
- `importer` — pass a mock object with `importFiles = vi.fn()`.
- `node:path` — no need to mock pure functions like `resolve`, `extname`.

## Files to create
- `tests/unit/watcher-service.test.ts`

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- 10+ test cases, all passing.
