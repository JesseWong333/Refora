# ScholarNote — Test Remediation Plan (Executable)

> **Target audience:** AI agent executing this plan. Every task is concrete to the granularity of "write file X with assertions Y". No open-ended decisions.

---

## Architecture Constraints (read before any task)

### What CANNOT be tested "as-is" in vitest
| API | Reason | Strategy |
|-----|--------|----------|
| `utilityProcess.fork` | Electron-only, no Node.js equivalent | Manual mock returning `EventEmitter` stub via `vi.mock('electron', ...)` |
| `ipcMain.handle` / `ipcRenderer.invoke` | Electron-only | Unit: test handler functions directly (already done). Integration: use `@playwright/test` + electron fixture. |
| `webContents.send` | Electron-only, needs BrowserWindow instance | Stub: `emitImportProgress` accepts a `{ send: vi.fn() }` instead of real `webContents`. |
| `better-sqlite3` (native C ABI) | Won't load outside Electron's Node | Continue `node:sqlite` in-memory for DB-layer unit tests (existing pattern). Add a **smoke test** that loads the real `.node` binding post-rebuild in CI only. |
| `chokidar.watch()` | Native fs-watching | `vi.mock('chokidar', ...)` returning a fake `FSWatcher` EventEmitter. |
| `contextBridge.exposeInMainWorld` / `window.api` | jsdom has no preload | Component tests: inject `window.api` mock in `beforeEach` before mount. |
| Native file dialog (`dialog.showOpenDialog`) | Electron-only | `vi.mock('electron', ...)` returning `{ canceled: false, filePaths: [...] }`. |
| `electron-log` | Electron-only | `vi.mock('electron-log', ...)` returning `{ info: vi.fn(), error: vi.fn(), ... }`. |

### Mocking convention
- All Electron imports use `vi.mock('electron', () => ({ ... }))` — define once in a shared test helper, not per-file.
- All native Node modules (`fs`, `path`, `child_process`) use `vi.mock` when side effects matter; pure functions (e.g., `basename`) don't need mocking.
- The `createImporter` function takes `repos` + `win` as parameters — tests pass mock objects, avoiding deep `vi.mock` on internal modules.

---

## Phase 0: Scaffolding (MUST complete first, blocks all other Phases)

### 0.1 Install test dependencies
```bash
npm install -D @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @vitest/coverage-v8
```
Verify: `npx vitest run --version` prints vitest version.

### 0.2 Extend `vitest.config.ts`
Current config is minimal (only `jsdom` + `include`). Extend to:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'jsdom',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/component/**/*.test.tsx',
      'tests/integration/**/*.test.ts'
    ],
    globals: false,
    setupFiles: ['tests/setup.ts']
  }
})
```

**Acceptance:** `npx vitest run` still passes all 111 existing tests after this change.

### 0.3 Create `tests/setup.ts`

```ts
// tests/setup.ts
import '@testing-library/jest-dom/vitest'

// Stub window.api so components don't crash on import
(window as any).api = {
  getBootstrap: async () => ({}),
  documents: { list: async () => [] },
  import: { addFiles: async () => ({ added: [], skipped: [], errors: [] }) },
  onDocumentUpdated: () => () => {},
  onImportProgress: () => () => {},
  off: () => {},
  // ... fill remaining methods as needed per test
}
```
**Acceptance:** Components can mount in jsdom without `TypeError: window.api is undefined`.

### 0.4 Create `tests/fixtures/` directory with test PDFs

Create 4 small (1-page) PDF files:
- `tests/fixtures/valid.pdf` — plain PDF, no metadata (create via `echo "%PDF-1.4" > ...` — real PDFs needed but tiny ones suffice)
- `tests/fixtures/with-doi.pdf` — PDF containing `DOI: 10.1234/test.1` in its text
- `tests/fixtures/encrypted.pdf` — PDF encrypted with empty password (use `qpdf --encrypt "" "" 128 -- valid.pdf encrypted.pdf`)
- `tests/fixtures/corrupted.pdf` — truncated/broken binary (just `%PDF-1.4%EOF` with garbage after)

If `qpdf` not available, create minimal mock PDFs and document that real encrypted/corrupted tests need manual fixture creation.

**Acceptance:** `node -e "require('fs').statSync('tests/fixtures/valid.pdf').size > 0"` → true.

### 0.5 Create shared Electron mock helper `tests/mocks/electron.ts`

```ts
// tests/mocks/electron.ts
import { vi } from 'vitest'
import { EventEmitter } from 'node:events'

export function mockElectron() {
  vi.mock('electron', () => ({
    dialog: {
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/fake/doc.pdf'] }),
      showMessageBox: vi.fn().mockResolvedValue({ response: 0 })
    },
    utilityProcess: {
      fork: vi.fn(() => {
        const child = new EventEmitter()
        return child
      })
    },
    BrowserWindow: class {
      webContents = { send: vi.fn() }
      on = vi.fn()
      close = vi.fn()
      isDestroyed = () => false
    },
    app: {
      getPath: vi.fn((name: string) => `/fake/path/${name}`),
      getLocale: () => 'en',
      on: vi.fn(),
      whenReady: () => Promise.resolve()
    }
  }))
}
```

**Acceptance:** Importing `mockElectron()` in a test file then importing `src/main/services/importer.ts` does not throw `Cannot find module 'electron'`.

### 0.6 Create shared Chokidar mock `tests/mocks/chokidar.ts`

```ts
// tests/mocks/chokidar.ts
import { vi } from 'vitest'
import { EventEmitter } from 'node:events'

export function mockChokidar() {
  const fakeWatcher = Object.assign(new EventEmitter(), {
    close: vi.fn().mockResolvedValue(undefined),
    getWatched: vi.fn().mockReturnValue({}),
    add: vi.fn()
  })
  vi.mock('chokidar', () => ({
    default: { watch: vi.fn(() => fakeWatcher) },
    watch: vi.fn(() => fakeWatcher)
  }))
  return fakeWatcher
}
```

### 0.7 Create shared `electron-log` mock `tests/mocks/electron-log.ts`

```ts
// tests/mocks/electron-log.ts
import { vi } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn()
}))
```

---

## Phase 1: Service Unit Tests (lowest risk, no Electron dep)

Each task = one test file. Execute in dependency order (B2 needs B3's mocks).

### Task 1.1 — `tests/unit/files-service.test.ts`
**Depends on:** Phase 0 complete (mocks available).

**What to test** (concrete assertions):
1. `checkMissing(docIds[])` batch-scan:
   - Mock `existsSync` to return `false` for all → all docs marked `fileMissing=1`, `emitter` fires `'missing'` once total (debounced).
   - Mock `existsSync` to return `true` for all → no `fileMissing` change, no emit.
   - 50 docs in batch → only 50 per tick (verify `setImmediate` is called exactly `ceil(N/50)` times).
   - Status toggles: doc was `fileMissing=1`, now exists → `fileMissing` cleared, emit fires.
2. `relocate(docId, newPath)`:
   - Valid `.pdf` path → `filePath` and `fileName` updated in DB, `fileMissing=0`, returns `{ ok: true }`.
   - Path not ending in `.pdf` → returns `{ ok: false, error: { code: 'invalid_path' } }`.
   - Doc not found → returns `{ ok: false, error: { code: 'not_found' } }`.
   - File missing on disk → still accepts the relocation (relocate is user-intent), returns `{ ok: true }`.

**Mock scope:** `node:fs` (`existsSync`, `renameSync`), DB repositories (pass fake repos object).

### Task 1.2 — `tests/unit/library-service.test.ts`
**Depends on:** Task 1.1 (Files service interface known).

**What to test:**
1. `resolveMovePolicy(categoryId)`:
   - Category has `moveToLibrary=1` → `true`.
   - Category has `moveToLibrary=0` → `false`.
   - Category `NULL` (drag to "uncategorized" bucket) + global setting ON → `true`.
   - Category `NULL` + global setting OFF → `false`.
2. `moveToLibrary(docId, libraryDir)`:
   - Source file exists → file copied to `<libraryDir>/<doc.fileName>`, DB updated to new path, returns `{ ok: true, data: { newPath } }`.
   - Destination filename collision → `(1)` suffix applied, then `(2)`, etc.
   - Source file missing → returns `{ ok: false, error: { code: 'source_missing' } }`.
3. `restoreToOriginal(docId)`:
   - Doc has `originalFolderPath` and it exists → file moved back, DB updated, returns `{ ok: true }`.
   - `originalFolderPath` is `null` → returns `{ ok: false, error: { code: 'invalid_state' } }`.
   - `originalFolderPath` doesn't exist on disk → returns `{ ok: false, error: { code: 'invalid_state' } }`.
   - Doc not found → returns `{ ok: false, error: { code: 'not_found' } }`.

**Mock scope:** `node:fs` (`existsSync`, `copyFileSync`, `renameSync`, `mkdirSync`), DB repos.

### Task 1.3 — `tests/unit/importer-service.test.ts`
**Depends on:** Phase 0.5 (Electron mock).

**What to test:**
1. `createImporter(repos, win)` factory returns object with `importFiles` method.
2. `importFiles(paths, opts)` — single valid PDF:
   - PDF path exists (`existsSync → true`), not in DB.
   - Sends request to worker stub → worker emits `message` with `{ correlationId, fileHash: 'abc', info: {...} }`.
   - Document inserted into DB with `fileHash='abc'` and `info` fields mapped.
   - `emitImportProgress(win, 'complete', { added: 1 })` called.
3. Duplicate path (same `filePath` already in DB):
   - `importFiles` returns `{ skipped: [path] }`, no worker call, no DB insert.
4. Duplicate hash (different path, same hash):
   - `opts.mode === 'manual'` → `dialog.showMessageBox` called ("duplicate found").
   - `opts.mode === 'watch'` → auto-skipped, no dialog.
5. Encrypted PDF (worker returns `{ error: { type: 'encrypted' } }`):
   - Document NOT inserted, `importFiles` returns `{ errors: [{ path, message: 'Encrypted' }] }`.
6. Corrupted PDF (worker returns `{ error: { type: 'corrupted' } }`):
   - Same as encrypted — not inserted, error returned.
7. Worker crashes (`worker.emit('exit', 1)`):
   - All pending requests rejected with `'PDF worker exited unexpectedly'` error.
   - Next `importFiles` call creates new worker.
8. Worker timeout (no response within 120s):
   - Request rejected with timeout error.

**Mock scope:** `electron` (via Phase 0.5), `node:fs` (`existsSync`, `statSync`), worker (EventEmitter stub).

### Task 1.4 — `tests/unit/watcher-service.test.ts`
**Depends on:** Phase 0.6 (Chokidar mock).

**What to test:**
1. `start(folderPath, libraryPath, onImport)`:
   - Calls `chokidar.watch(folderPath, { ... })` with `ignored` excluding `libraryPath`.
   - Options include `depth: undefined` (recursive) and `awaitWriteFinish: true`.
   - Glob pattern only matches `**/*.pdf`.
2. Add event (`.pdf` file appearing in watched dir):
   - Debounced (default ~1s) then calls `onImport(paths, { mode: 'watch' })`.
3. Add event (non-PDF file):
   - Ignored, `onImport` never called.
4. `change` event:
   - Ignored (spec says watch only detects new files).
5. `unlink` event:
   - Ignored (DB record never removed).
6. `stop()`:
   - Calls `watcher.close()`, clears internal watcher map.
7. `startAll(enabledFolders, libraryPath, onImport)`:
   - Calls `start()` for each enabled folder.

### Task 1.5 — `tests/unit/pdfOpen-service.test.ts`
**Depends on:** Phase 0 complete.

**What to test:**
1. `openPdf(docId)`:
   - Doc exists, file exists → `lastReadAt` updated to current timestamp, returns `{ ok: true, data: doc }`.
   - Doc exists, file missing → returns `{ ok: false, error: { code: 'file_missing' } }`.
   - Doc not found → returns `{ ok: false, error: { code: 'not_found' } }`.
   - `shell.openPath` returns non-empty error string → `lastReadAt` NOT updated, returns error.

**Mock scope:** `node:fs` (`existsSync`), `electron.shell.openPath`, DB repos.

### Task 1.6 — `tests/unit/metadata-service.test.ts`
**Depends on:** Phase 0 complete.

**What to test:**
1. `enqueue(docId)`:
   - Adds to internal queue, starts processing with rate limit (≥1s between Crossref lookups).
   - Mock `fetch` to return Crossref JSON → metadata fields updated in DB.
2. `resumeOnStartup()`:
   - Queries DB for `metadataStatus IN ('pending', 'error')`.
   - Docs with `metadataAttempts < 3` → re-enqueued.
   - Docs with `metadataAttempts >= 3` → NOT re-enqueued.
3. `refreshMetadata(docId)`:
   - Resets `metadataAttempts = 0` and `metadataStatus = 'pending'`, then enqueues.
4. `bulkRefreshMetadata(docIds)`:
   - Calls `refreshMetadata` for each doc ID in batch.

**Mock scope:** `fetch` (global, or mock the HTTP layer), DB repos.

---

## Phase 2: Renderer Component & Store Tests

### Task 2.1 — `tests/unit/documentStore.test.ts`
**Depends on:** Phase 0.3 (setup.ts provides `window.api` stub).

**What to test:**
1. `fetchDocuments()`:
   - Calls `window.api.documents.list(filter)`, stores result in `state.documents`.
   - Sets `isLoading = true` before call, `false` after.
2. `performSearch(query)`:
   - Query < 3 chars → uses `LIKE` mode.
   - Query ≥ 3 chars → uses `FTS` mode.
   - Debounced (300ms): rapid calls → only last query dispatched.
3. `init()`:
   - Subscribes to `window.api.onDocumentUpdated` and `window.api.onImportProgress`.
   - Subscription callbacks update store state.
4. `setSelected(id)`:
   - Updates `selectedIds` (single-select mode).
5. `toggleStar(id)`:
   - Calls `window.api.documents.setStarred(id, !current)`, updates local state on success.

### Task 2.2 — `tests/component/TopBar.test.tsx`
**Depends on:** Phase 2.1 (store interface known).

Mount `<TopBar />` wrapped in a Zustand store provider (or mock `useDocumentStore`). Assert:
1. "Add File" button exists and is clickable.
2. Click → calls `window.api.import.addFiles`.
3. "Add Folder" button exists.
4. Search input exists, typing debounces and calls store's `performSearch`.

### Task 2.3 — `tests/component/DocumentList.test.tsx`
1. Mount with 0 docs → verify "empty state" placeholder text.
2. Mount with 5 docs → verify 5 rows rendered, each shows `fileName`/`title`.
3. Click row → verify `setSelected(docId)` called.
4. Sort header click → verify sort toggles (cycle asc/desc/none).

### Task 2.4 — `tests/component/Sidebar.test.tsx`
1. Mount with 3 categories → verify category names rendered.
2. Mount with 0 categories → verify no crash (empty sidebar).
3. Click "All Documents" smart list → verify filter dispatch.

### Task 2.5 — `tests/component/DetailPanel.test.tsx`
1. Mount with no selected doc → verify empty state ("Select a document").
2. Mount with selected doc → verify title/authors/year/abstract fields rendered.
3. Edit title → blur → verify `window.api.documents.update(id, patch)` called.
4. No edit → no API call.

---

## Phase 3: Smoke Test (CI-only, real better-sqlite3)

### Task 3.1 — `tests/smoke/db-native.test.ts`
**Purpose:** Validate that `better-sqlite3` loads and runs under the CI Electron/Node ABI.

```ts
// tests/smoke/db-native.test.ts
import { describe, it, expect } from 'vitest'

describe('better-sqlite3 native binding', () => {
  it('can open an in-memory database', () => {
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)')
    db.prepare('INSERT INTO test (value) VALUES (?)').run('hello')
    const row = db.prepare('SELECT value FROM test WHERE id = 1').get()
    expect(row.value).toBe('hello')
    db.close()
  })

  it('supports WAL mode', () => {
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    const mode = db.pragma('journal_mode', { simple: true })
    expect(mode).toBe('wal')
    db.close()
  })
})
```
**Run condition:** Only in CI where `npm run rebuild` has been executed. Mark as `skip` in dev (auto-detect: try `require('better-sqlite3')`, skip on failure).

---

## Phase 4: Integration & E2E (requires @playwright/test with Electron)

### Pre-requisite decisions (answer before any E2E task starts):
- **Tool:** `@playwright/test` with `electron` fixture (supported by Playwright, no extra plugin needed).
- **App build:** `electron-vite build` must run before tests. E2E script: `npm run build && npx playwright test`.
- **Dialog bypass:** Use `app.on('ready', () => { ... })` to intercept file dialogs — or pre-seed DB with documents and skip the "select file" flow.
- **No external API in CI:** Mock Crossref/arXiv at the HTTP level or skip metadata fetch in E2E.

### Task 4.1 — IPC Smoke (`tests/e2e/ipc-smoke.spec.ts`)
- Launch electron app.
- In main world via `page.evaluate`: call `window.api.getBootstrap()`.
- Assert response shape: `{ language: string, windowBounds: { x, y, width, height } }`.
- Call `window.api.settings.get()` → assert known keys exist.

### Task 4.2 — Import Flow (`tests/e2e/import.spec.ts`)
- Seed DB with 0 docs.
- Trigger `window.api.import.addFiles([path_to_valid_pdf])` from renderer.
- Verify `documents.list()` returns 1 doc.
- Verify progress event fires.

### Task 4.3 — Document CRUD (`tests/e2e/document-crud.spec.ts`)
- Seed DB with 1 doc.
- UI: verify doc appears in list.
- Edit title in DetailPanel → save → re-read from DB → title changed.
- Delete doc → confirm dialog → doc removed from list.

**Scope note:** Full E2E with native dialogs (file picker, message boxes) is NOT in scope for Phase 4. These require `dialog` interception via `app` module listeners that Playwright's Electron fixture does not natively support without custom main-process hooks. Document as a known limitation.

---

## Phase 5: Coverage & CI Gates

### Task 5.1 — Coverage thresholds in `vitest.config.ts`
```ts
coverage: {
  provider: 'v8',
  reporter: ['text', 'lcov'],
  thresholds: {
    lines: 70,
    branches: 55,
    functions: 70
  }
}
```
**Note:** 80% is aspirational but not achievable in the first pass given Electron native APIs. Set baseline at 70/55/70 and ratchet up.

### Task 5.2 — CI workflow (`.github/workflows/ci.yml`)
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run postinstall
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test
      - run: npm run test:coverage
      - run: npm run build
```

---

## Execution Order (do NOT reorder)

| Step | Task | Rationale |
|------|------|-----------|
| 1 | 0.1 Install deps | Blocks everything |
| 2 | 0.2 vitest.config.ts | Running existing tests must still pass |
| 3 | 0.3 tests/setup.ts | Components must mount in jsdom |
| 4 | 0.4 tests/fixtures/ | PDFs needed for importer tests |
| 5 | 0.5 tests/mocks/electron.ts | Blocks all service tests using Electron APIs |
| 6 | 0.6 tests/mocks/chokidar.ts | Blocks watcher test |
| 7 | 0.7 tests/mocks/electron-log.ts | Blocks any test importing services |
| 8 | 1.1 files-service.test.ts | Foundation for library tests |
| 9 | 1.2 library-service.test.ts | Depends on files service interface |
| 10 | 1.3 importer-service.test.ts | Core import logic |
| 11 | 1.4 watcher-service.test.ts | |
| 12 | 1.5 pdfOpen-service.test.ts | |
| 13 | 1.6 metadata-service.test.ts | |
| 14 | 2.1 documentStore.test.ts | Foundation for component tests |
| 15 | 2.2 TopBar.test.tsx | |
| 16 | 2.3 DocumentList.test.tsx | |
| 17 | 2.4 Sidebar.test.tsx | |
| 18 | 2.5 DetailPanel.test.tsx | |
| 19 | 3.1 db-native.test.ts | CI-only smoke |
| 20 | 5.1 Coverage config | |
| 21 | 5.2 CI workflow | |
| 22 | 4.1-4.3 E2E | Last — requires full build + playwright-electron |

---

## Don't-do list (explicit guardrails)

1. **Do NOT write E2E tests for native file dialogs** — Playwright's Electron fixture cannot drive macOS native `dialog.showOpenDialog`. Skip or use API-level workaround.
2. **Do NOT mock `better-sqlite3` to act like `node:sqlite`** — they have different APIs (`stmt.pluck()`, WAL pragmas, `better-sqlite3` synchronous-only). Keep existing `node:sqlite` pattern for unit tests.
3. **Do NOT write tests that import from `src/main/index.ts`** — it registers IPC handlers on import, which crashes in Node.js. Test services in isolation.
4. **Do NOT import `electron` outside `vi.mock`** — in vitest Node environment, `require('electron')` returns a path string, not an object.
5. **If a test cannot run with `vitest run`, mark it `test.skip` and document the blocker** — never leave a broken test.
6. **Run `npm run typecheck && npm run lint && npm run test` after every task** — per AGENTS.md gate.

---

## Phase 6: Code Review Items (per-component audit, fire-and-forget)

Run as a separate agent session after all tests are green. For each file in `src/renderer/components/` and `src/main/services/`:

1. Does it crash on `null`/`undefined` props?
2. Is every `api.*` call wrapped in try/catch?
3. Is every event subscription cleaned up?
4. Are all user-visible strings using `t()`?
5. Is `any` used where a concrete type exists?

Report findings as a GitHub issue — do NOT refactor in this phase.
