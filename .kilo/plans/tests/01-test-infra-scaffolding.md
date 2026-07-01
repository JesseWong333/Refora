# Task 01 — Test Infrastructure Scaffolding

**Phase:** 0 (Scaffolding) · **Prerequisites:** none · **Master plan:** Phase 0

## Goal
Install test dependencies, extend `vitest.config.ts` for component tests, create `tests/setup.ts` to stub `window.api` for jsdom, create test PDF fixtures, and create shared mock files for `electron`, `chokidar`, and `electron-log`.

## Steps

### 1.1 Install test dependencies
```bash
npm install -D @testing-library/react @testing-library/jest-dom @testing-library/user-event @vitest/coverage-v8
```
Verify: `npx vitest run --version` prints vitest version.

### 1.2 Extend `vitest.config.ts`

Add React plugin, resolve aliases, component/E2E test includes, and setup file:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

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

**Acceptance:** `npm run test` still passes all 111 existing tests.

### 1.3 Create `tests/setup.ts`

```ts
import '@testing-library/jest-dom/vitest'

const noop = () => {}
const noopPromise = async () => ({ ok: true, data: undefined })

;(window as any).api = {
  getBootstrap: async () => ({
    language: 'en',
    windowBounds: null,
    listColumnState: null,
    sidebarCollapsed: false,
    libraryFolderPath: '/fake/library',
    proxyUrl: ''
  }),
  documents: {
    list: async () => ({ ok: true, data: [] }),
    get: async () => ({ ok: false, error: { code: 'not_found', message: 'not found' } }),
    update: noopPromise,
    setStarred: noopPromise,
    delete: noopPromise,
    bulkDelete: noopPromise,
    bulkCategorize: noopPromise,
    bulkRefreshMetadata: noopPromise,
    openPdf: noopPromise,
    refreshMetadata: noopPromise,
    relocateFile: noopPromise,
    restoreFile: noopPromise,
    folderGroups: async () => ({ ok: true, data: [] })
  },
  import: {
    addFiles: async () => ({ ok: true, data: { added: [], skipped: [], errors: [] } }),
    addFolder: async () => ({ ok: true, data: { added: [], skipped: [], errors: [] } }),
    fromJson: noopPromise
  },
  categories: {
    list: async () => ({ ok: true, data: [] }),
    create: noopPromise,
    rename: noopPromise,
    delete: noopPromise,
    setMoveToLibrary: noopPromise,
    assign: noopPromise,
    unassign: noopPromise
  },
  watch: {
    list: async () => ({ ok: true, data: [] }),
    add: noopPromise,
    remove: noopPromise,
    toggle: noopPromise
  },
  settings: {
    get: async () => ({ ok: true, data: null }),
    set: noopPromise
  },
  export: {
    toJson: noopPromise,
    toBibtex: noopPromise
  },
  events: {
    onDocumentUpdated: (cb: any) => { return () => {} },
    onImportProgress: (cb: any) => { return () => {} },
    off: (channel: string, cb: any) => {}
  }
}
```

**Acceptance:** A React component with `import { api } from '@renderer/ipc'` can mount in jsdom without `window.api is undefined`.

### 1.4 Create test PDF fixtures

Create directory `tests/fixtures/` with 4 files:

- `valid.pdf` — minimal valid single-page PDF
- `with-doi.pdf` — minimal PDF containing "DOI: 10.1234/test.1" in page text
- `encrypted.pdf` — PDF encrypted with empty password
- `corrupted.pdf` — truncated/broken PDF (just `%PDF-1.4` header with garbage bytes)

**If `qpdf` is not available on macOS**, use Python (built-in on macOS):
```bash
# valid.pdf — minimal PDF
python3 -c "
pdf = b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<<>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td (Test PDF) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000210 00000 n \ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n306\n%%EOF'
with open('tests/fixtures/valid.pdf', 'wb') as f: f.write(pdf)
"
```

**Acceptance:** `node -e "require('fs').statSync('tests/fixtures/valid.pdf').size > 0"` → true.

### 1.5 Create `tests/mocks/electron.ts`

Shared mock file for all Electron APIs:

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
        ;(child as any).kill = vi.fn()
        return child
      })
    },
    BrowserWindow: class {
      webContents = { send: vi.fn() }
      isDestroyed = () => false
      on = vi.fn()
      close = vi.fn()
    },
    app: {
      getPath: vi.fn((name: string) => `/fake/path/${name}`),
      getLocale: () => 'en',
      on: vi.fn(),
      whenReady: () => Promise.resolve()
    },
    shell: {
      openPath: vi.fn().mockResolvedValue(''),
      showItemInFolder: vi.fn()
    }
  }))
}
```

**Acceptance:** `import { mockElectron } from '../../mocks/electron'` resolves without error.

### 1.6 Create `tests/mocks/chokidar.ts`

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

### 1.7 Create `tests/mocks/electron-log.ts`

```ts
// tests/mocks/electron-log.ts
import { vi } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))
```

## Verification
- `npm run test` passes all 111 existing tests.
- New directories exist: `tests/component/`, `tests/smoke/`, `tests/integration/`, `tests/e2e/`, `tests/mocks/`, `tests/fixtures/`.
- `tests/setup.ts`, `tests/mocks/electron.ts`, `tests/mocks/chokidar.ts`, `tests/mocks/electron-log.ts` all exist.
- `tests/fixtures/` contains 4 PDF files.

## Phase 0 DoD
- [ ] `npm install` succeeds (new test deps added).
- [ ] `npm run test` passes all existing 111 tests after config changes.
- [ ] `tests/setup.ts` exists; components can mount in jsdom.
- [ ] All mock files exist and are importable.
- [ ] `tests/fixtures/` has 4 PDF files.
