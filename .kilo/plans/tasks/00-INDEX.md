# ScholarNote — Executable Task Index

This directory splits the master plan into small, independently-executable tasks.
Load **one task file at a time**; do not load the whole master plan into context.

- **Master plan (spec of record):** `.kilo/plans/1782864927939-scholarnote-literature-manager.md`
- **These task files** are the executable breakdown. Each inlines the spec it needs.
- **Conflict rule:** if a task file conflicts with the master plan, the master plan wins — fix the task file. (The master plan states `docs/*.md` are authoritative; this repo is greenfield and `docs/` do not exist yet, so the master plan sections act as the spec. If you create `docs/*.md`, they then take precedence — update the affected task file.)

---

## 0. Global rules (apply to EVERY task)

### Verification gate
After **every** code change, before declaring a task done:
```
npm run typecheck && npm run lint && npm run test
```
- Smoke a feature with `npm run dev`.
- Before claiming the build works: `npm run package`.
- A task's own Verification section lists additional specific assertions. Do not mark the task complete until both the gate and the specific assertions pass.

### Security baseline (never violate)
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (preload), no `remote`.
- All file-path args validated to be `.pdf` and resolved to absolute paths in main before any fs action.
- **CSP** — prod: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'`. Dev (only when `!app.isPackaged`): add `'unsafe-inline'` to script-src + allow `ws://localhost:*` in connect-src for HMR.
- **All IPC responses are a typed envelope** `Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }`. Handlers never throw across the bridge (wrap in try/catch, always resolve). Preload unwraps `{ok:false}` into a serializable `IpcError`.
- **Keyboard shortcuts are app-scoped only:** `Menu` accelerators + renderer `keydown`. Never import `globalShortcut`.

### Don't-do list
- No comments in code unless asked.
- Never delete the source PDF file from disk (delete = remove DB record only).
- Never read a whole PDF into memory for hashing (stream it).
- Don't read all `docs/` at once (when they exist) — load only what a task needs.

---

## 1. Stack & toolchain (master plan §2)

| Area | Decision |
|---|---|
| Platform | macOS only |
| Build/dev | electron-vite (HMR) + electron-builder (packaging) |
| DB | better-sqlite3 `^11`, single connection on main, rebuilt via `@electron/rebuild`. On open: `PRAGMA foreign_keys=ON` + `journal_mode=WAL`. FTS5 tokenizer `trigram` (fallback `unicode61` + always-on `LIKE`). |
| Packaging | electron-builder; `asarUnpack: ["**/*.node"]`; `@electron/rebuild` in `postinstall` + before build. |
| State (renderer) | Zustand |
| Styling | Tailwind + headless UI primitives, VSCode-dark theme |
| i18n | react-i18next + i18next, JSON resources `zh`/`en`, stored in `settings.language`. Detection: `settings.language` → system locale (`zh*`→`zh` else `en`). On first run detect + write detected value. |
| IPC | contextBridge (preload), contextIsolation ON, nodeIntegration OFF, sandbox. |
| PDF | pdfjs-dist `^4` legacy ESM (`pdfjs-dist/legacy/build/pdf.mjs`); Node init via `GlobalWorkerOptions.workerSrc`. Used for info-dict + DOI text. |
| Threading | DB synchronous on main. sha256 hashing + pdfjs parsing run in an Electron `utilityProcess` (`src/main/worker/pdf-worker.ts`); results return via `MessagePort`. |
| Watching | chokidar (multiple, recursive, PDF-only, add-only) |
| Virtualization | `@tanstack/react-virtual` |
| Logging | electron-log to `app.getPath('logs')`; DEBUG dev / INFO prod. |
| Test | vitest + jsdom; `tests/unit/**` + `src/**/*.test.ts` |

### `package.json` scripts
```jsonc
{
  "dev": "electron-vite dev",
  "build": "electron-vite build",
  "typecheck": "tsc -b",
  "lint": "eslint .",
  "test": "vitest run",
  "test:watch": "vitest",
  "package": "electron-vite build && electron-builder --mac",
  "rebuild": "electron-rebuild -f -w better-sqlite3",
  "postinstall": "electron-rebuild -f -w better-sqlite3"
}
```

---

## 2. Project structure (master plan §8)

```
ScholarNote/
  package.json, electron.vite.config.ts, electron-builder.yml
  vitest.config.ts, eslint.config.js, tsconfig.json (+ .main/.preload/.renderer/.shared)
  tailwind.config.ts
  src/
    shared/ipc-types.ts          # Result<T>, ListFilter, DocumentPatch, EditableField, events, DTOs (no electron deps)
    main/
      index.ts                   # app lifecycle + startup sequence (§3)
      db/{connection.ts, schema.sql, migrations/, repositories/}
      worker/pdf-worker.ts       # utilityProcess: streaming sha256 + pdfjs parse
      services/{importer,metadata,watcher,library,pdfOpen,files,export,logger}.ts
      ipc/{handlers.ts, types.ts}
    preload/index.ts             # contextBridge typed API; unwrap Result→IpcError; getBootstrap()
    renderer/
      index.html, main.tsx, App.tsx
      components/{TopBar,Sidebar,DocumentList,DetailPanel,SearchBar,Settings}.tsx
      store/, hooks/, ipc.ts, styles/
      i18n/{index.ts, locales/{zh.json,en.json}}
```

### Startup sequence (master plan §3 — order matters)
1. `app.whenReady()`.
2. Open DB (`connection.ts`): `PRAGMA foreign_keys=ON`, `journal_mode=WAL`; run migration runner (`user_version`).
3. Seed default settings if missing (incl. detect+write `language` from system locale on first run).
4. Read bootstrap settings: `language`, `windowBounds`, `listColumnState`, `sidebarCollapsed`, `libraryFolderPath`, `proxyUrl`.
5. Apply proxy via `session.setProxy` (defaultSession).
6. Create BrowserWindow using restored `windowBounds`. Renderer calls `await window.api.getBootstrap()` before mounting, behind a **language-neutral splash** (logo + spinner, no translatable text).
7. `loadURL` (dev or built). Show window only after `did-finish-load` to avoid white flash.
8. Start watch-folder chokidar + metadata-resume (re-enqueue `pending`/`failed<3`) + missing-file batch check — after window up, non-blocking.

---

## 3. IPC API surface (master plan §8) — `window.api`

`documents.list(filter)`, `documents.search(q)`, `documents.get(id)`, `documents.update(id, patch)` (marks patched fields in `editedFields`), `documents.setStarred`, `documents.delete(id)`, `documents.bulkDelete(ids)`, `documents.bulkCategorize(ids, catId)`, `documents.bulkRefreshMetadata(ids)`, `documents.openPdf(id)`, `documents.refreshMetadata(id)`, `documents.relocateFile(id, newPath)`, `documents.restoreFile(id)`, `import.addFiles(paths)`, `import.addFolder(dir)`, `categories.list/create(name, moveToLibrary?)/rename/delete`, `categories.setMoveToLibrary(catId, value)`, `categories.assign(docId, catId)`, `categories.unassign`, `watch.list/add/remove/toggle`, `settings.get/set`, `export.toJson()`, `export.toBibtex(ids)`, `import.fromJson(file)`, `getBootstrap()` (async; returns `language` + `windowBounds` + `listColumnState` + `sidebarCollapsed`).

**Events** (typed subscribe/unsubscribe, not raw `ipcRenderer`): `events.onDocumentUpdated(cb)`, `events.onImportProgress(cb)`, `events.off(channel, cb)` — backed by `ipcRenderer.on('document:updated' | 'import:progress')`.

### Shared types (`src/shared/ipc-types.ts`)
```ts
type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

type ListMode = 'all' | 'recentlyRead' | 'recentlyAdded' | 'starred' | 'category' | 'folder';
type ListFilter = {
  mode: ListMode;
  categoryId?: string;        // when mode === 'category'
  folderPath?: string;        // when mode === 'folder' (originalFolderPath)
  sort?: { field: SortField; dir: 'asc' | 'desc' }; // default { field: 'addedAt', dir: 'desc' }
};
type SortField = 'title' | 'authors' | 'year' | 'venue' | 'addedAt' | 'filePath';

type EditableField =
  | 'title' | 'authors' | 'year' | 'venue' | 'volume'
  | 'abstract' | 'keywords' | 'url' | 'doi' | 'note';
type DocumentPatch = Partial<Pick<Document, EditableField>>;
// Server rejects (error code 'forbidden_field') any key outside EditableField.
// Each patched field is added to editedFields (and removed if cleared to '').
type SearchResult = Document[]; // ordered by FTS rank / LIKE relevance
```

---

## 4. Execution order & dependencies

Execute strictly in this order (later tasks depend on earlier outputs). Files in the same phase may be reordered only if their listed prerequisites are already met.

| # | File | Phase | Prerequisites |
|---|---|---|---|
| 01 | `01-scaffold-project.md` | 0 | — |
| 02 | `02-tailwind-layout-shell.md` | 0 | 01 |
| 03 | `03-browserwindow-menu-security.md` | 0 | 01 |
| 04 | `04-i18n-setup.md` | 0 | 01 |
| 05 | `05-db-connection-migrations.md` | 1 | 01 |
| 06 | `06-repositories.md` | 1 | 05 |
| 07 | `07-preload-ipc-handlers.md` | 1 | 05, 06 |
| 08 | `08-pdf-worker-importer.md` | 2 | 06, 07 |
| 09 | `09-metadata-service.md` | 2 | 08 |
| 10 | `10-wire-import-buttons.md` | 2 | 08, 09 |
| 11a | `11a-document-list-columns.md` | 3 | 07, 10 |
| 11b | `11b-document-list-interactions.md` | 3 | 11a |
| 12 | `12-detail-panel.md` | 3 | 11a |
| 13 | `13-smart-lists.md` | 3 | 11a |
| 14 | `14-document-deletion.md` | 3 | 11a, 07 |
| 15 | `15-categories-crud-ui.md` | 4 | 07, 11a |
| 16 | `16-drag-to-category.md` | 4 | 15 |
| 17 | `17-folder-grouping.md` | 4 | 11a |
| 18 | `18-watcher.md` | 5 | 08 |
| 19 | `19-watch-folder-settings-ui.md` | 5 | 18 |
| 20 | `20-search-bar.md` | 5 | 07, 11a |
| 21 | `21-settings.md` | 6 | 07, 19 |
| 22 | `22-missing-file-detection.md` | 6 | 06, 07 |
| 23 | `23-json-export-import.md` | 6 | 06, 07 |
| 24 | `24-bibtex-export.md` | 6 | 06, 07, 11a |
| 25 | `25-first-run-empty-states.md` | 6 | 02, 11a, 12 |
| 26 | `26-window-state-keyboard.md` | 6 | 03, 07 |
| 27 | `27-packaging-smoke-test.md` | 6 | all above |

> Phase boundaries are verification milestones. After finishing the last task of a phase, re-run the gate and confirm every checkbox under that phase's DoD (each task file restates the DoD items it owns).

---

## 5. Spec-to-master-plan map (what to load if you need full detail)

Each task file inlines its essential spec, but for full context the master-plan sections are:

| Topic | Master plan section |
|---|---|
| Goal & scope | §1 |
| All confirmed decisions | §2 |
| Architecture / process model / startup / import pipeline / metadata retry / drag / BibTeX flow | §3 |
| Data model (full SQL) + migration runner + settings schemas | §4 |
| UI states & feedback (4 states per view) | §5 |
| Feature specs (top bar / sidebar / list / detail / settings) | §6 |
| Key behaviors & edge cases (dedup, watch, missing file, rate limit, collision) | §7 |
| Project structure, scripts, IPC API, shared types, i18n keys | §8 |
| Implementation task list (original) | §9 |
| Validation / testing | §10 |
| Open questions / defaults | §11 |

### Default values (master plan §2/§11)
Library folder default `~/Documents/ScholarNote Library` (configurable). Default sort `addedAt` DESC. `moveToLibraryOnCategorize` default ON. No seed categories by default. Crossref `mailto` blank unless set. No proxy by default. PDF text extraction: first 5 pages default (1–20 configurable). Authors stored `;`-separated as `Family, Given`. Keywords comma-separated. FTS trigram (≥3 chars) + `LIKE` fallback (1–2 chars).
