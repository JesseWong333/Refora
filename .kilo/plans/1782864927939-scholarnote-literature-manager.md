# ScholarNote — Implementation Plan

A macOS-only desktop app to manage and organize local PDF literature **by reference**. Greenfield project.

---

## 1. Goal & Scope

**Goal:** A fast, local-first PDF literature manager with a VSCode/Obsidian-style 3-pane UI: collapsible sidebar, sortable document list, and an editable detail panel. PDFs are tracked by path; metadata is auto-enriched (offline + DOI/Crossref) and user-editable; documents can be organized into logical categories (which optionally consolidate the file into a managed library folder).

**In scope (v1):**
- Add file / add folder (recursive) / watch folder(s) (recursive, PDF-only, add-only).
- Metadata: offline PDF info-dict + filename heuristics + DOI/Crossref (+arXiv) async lookup, graceful fallback, all fields editable, "refresh metadata" action (merge: only fills empty fields; never overwrites fields listed in `editedFields` unless the user explicitly cleared them; remote candidates stored in `remoteValues` power a per-field "↻" conflict indicator). Metadata jobs are resumable across restarts via `metadataStatus`.
- Logical categories (many-to-many); drag-to-category assigns label + **optionally** moves the PDF into one shared library folder (configurable per-category or globally in Settings: `moveToLibraryOnCategorize`, default ON).
- Delete document (remove from DB; never delete the source PDF file from disk).
- Multi-select in document list for bulk operations (delete, assign to category, refresh metadata).
- Folder-based grouping by immutable original source folder.
- SQLite FTS5 search over metadata + note + filename.
- Sortable, resizable, show/hide columns; PDF icon opens system reader and marks "recently read".
- Smart lists: All / Recently read / Recently added / Starred.
- Plain-text per-document Note; inline-editable detail fields.
- Dedup (path-based + content-hash warning), missing-file detection + relocate.
- Database export (JSON, portable) for backup/migration — includes documents, categories, and the `document_categories` assignment map so re-import preserves all category memberships.
- **BibTeX export**: export the selected document(s) from the middle list as a `.bib` file (one or more rows selected). Also available in the menu bar (File → Export → BibTeX…).
- Proper macOS application menu (File, Edit, Window, Help).
- Keyboard shortcuts for common actions.
- Window state & column layout persistence across sessions.
- Virtual scrolling for large libraries (500+ documents).
- Logging (electron-log) to file for debugging.
- All UI states specified: loading spinners, empty-state prompts, error toasts, progress indicators for import.

**Out of scope (v1):** built-in PDF viewer, CSV export, full-text PDF body indexing, cloud sync, tags-as-separate-entity (keywords field suffices), non-macOS builds, OCR.

---

## 2. Confirmed Decisions

| Area | Decision |
|---|---|
| Platform | macOS only |
| Stack | React 18 + TypeScript; electron-vite (dev/build/HMR) + electron-builder (packaging) |
| DB | better-sqlite3 (synchronous, **single connection on main process**), rebuilt via `@electron/rebuild` (not the deprecated `electron-rebuild`). Pin `better-sqlite3@^11` (bundles SQLite ≥ 3.42 → trigram tokenizer available). On open run `PRAGMA foreign_keys=ON` + `journal_mode=WAL`. FTS5 tokenizer = `trigram` (verified at init; if unavailable, fall back to `unicode61` + always-on `LIKE`). |
| Packaging | electron-builder; **`asarUnpack: ["**/*.node"]`** so the better-sqlite3 native binary loads from disk (asar can't dlopen). `@electron/rebuild` runs in `postinstall` + before build. |
| State | Zustand (renderer) |
| Styling | Tailwind CSS + headless UI primitives, VSCode-dark theme |
| i18n | react-i18next + i18next, JSON resource files (zh/en), language stored in `settings.language`. Detection priority: `settings.language` → system locale (if `zh*` → `zh`, else `en`). On first run when `settings.language` is absent, detect from system locale, write detected value to settings, and use it. |
| IPC | contextBridge (preload), contextIsolation ON, nodeIntegration OFF, sandbox. **All handlers return a typed envelope `Promise<Result<T>>` where `Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }`** (never throw across the bridge — errors don't serialize reliably). Shared request/response/error types live in `src/shared/ipc-types.ts` (imported by main + preload + renderer via tsconfig project references). |
| PDF | pdfjs-dist (legacy build, pinned `^4`), imported as ESM from `pdfjs-dist/legacy/build/pdf.mjs`. **Node (main/worker) init**: set `GlobalWorkerOptions.workerSrc` to `pdfjs-dist/legacy/build/pdf.worker.mjs` (or pass `useWorkerFetch:false, isEvalSupported:false`); call `getDocument({ data })` — no canvas/DOM needed for info-dict + text. Used for info-dict metadata + text extraction for DOI. |
| Threading | DB stays synchronous on main (cheap queries). **CPU-heavy work runs off-main**: sha256 hashing + pdfjs parsing run in an Electron `utilityProcess` (or Node `worker_thread`) spawned from main; results return via `MessagePort`. This keeps the renderer/IPC responsive during bulk import so the progress bar actually animates. |
| Watching | chokidar (multiple, recursive, PDF-only, add-only) |
| File model | Add = reference only (no copy/move). Drag-to-category = optionally MOVE into shared library folder + assign label (configurable per-category or global `moveToLibraryOnCategorize` setting, default ON). |
| Categories | Logical DB labels, many-to-many. Flat (no nesting) in v1. |
| Folder grouping | By immutable original source folder captured at add time |
| Metadata | Offline extraction + DOI/Crossref (+arXiv) lookup, async, fallback. Per-field provenance: `editedFields` (JSON array of user-edited field names) + `remoteValues` (JSON {field:{value,source}} from last fetch). Refresh merge: only fills empty/NULL fields; skips fields in `editedFields` unless cleared; updates auto-fetched fields and refreshes `remoteValues`. `metadataStatus` ('pending'|'done'|'failed') makes jobs resumable across restarts. |
| Search | FTS5 over metadata + note + filename |
| Note format | Plain text |
| Recently read | Triggered by opening the PDF via the app (clicking PDF icon). Does NOT track external opens. |
| Performance | `@tanstack/react-virtual` for document list (virtual scrolling); debounced search; metadata job queue (rate-limited). CPU-heavy hashing/parsing off-main (see Threading). List queries return rows in one shot (metadata is small); renderer virtualizes. |
| Logging | electron-log to file (`app.getPath('logs')`); DEBUG level for dev, INFO for production. |
| Multi-select | Checkbox column in list; bulk delete, bulk categorize, bulk refresh metadata. |
| Migration | `PRAGMA user_version`-based. `schema.sql` defines the v1 baseline (fresh DBs create everything + set `user_version=1`). `migrations/NN_*.sql` apply incremental upgrades for future versions; runner reads `user_version`, applies pending files in order inside a transaction, bumps `user_version`. Idempotent checks (`CREATE TABLE IF NOT EXISTS`) as defense-in-depth. |
| Export | JSON export of full library (documents + categories + `document_categories` assignments + metadata), importable for backup/migration (memberships preserved on re-import). BibTeX export of selected document(s) as `.bib`. |
| Window state | Persist window bounds, sidebar width, list column widths/order in `settings` DB table — debounced on `resize`/`move` (500ms) and flushed on window `close` + app `before-quit` (covers macOS red-dot close, which does not fire `before-quit`). Restored on startup. |
| macOS menu | Native `Menu` with File (Add File/Folder, Watch Folder, Export → JSON…/BibTeX…), Edit (Undo/Redo, Cut/Copy/Paste), Window, Help. |
| Keyboard | Cmd+F (focus search), Cmd+I (import file), Cmd+Backspace (delete selected), Cmd+S (save note), arrow keys (list navigation), Enter (open PDF), Space (preview placeholder). **App-scoped only: use `Menu` accelerators + renderer `keydown` handlers. Do NOT use `globalShortcut`** (it registers system-wide and would hijack Cmd+F etc. globally). |

**Assumed defaults (overridable):** library folder default `~/Documents/ScholarNote Library` (configurable in Settings); default list sort `addedAt` DESC; macOS `open` to launch PDFs; first-run auto-creates DB + runs migrations; Crossref polite-pool `mailto` configurable in Settings; **default language = system locale (if `zh*` → `zh`, else `en`), configurable in Settings**.

---

## 3. Architecture

### Process model
- **Main process** owns all privileged/IO concerns:
  - SQLite DB (better-sqlite3, single connection) + migrations + repositories.
  - File watching (chokidar) for watch folders.
  - HTTP fetch (Crossref `https://api.crossref.org/works/{doi}`, arXiv `http://export.arxiv.org/api/query`) via Electron `net` module (not raw `fetch`) so requests honor the configured proxy. Proxy is applied to `defaultSession` via `session.setProxy({ proxyRules: proxyUrl })` on startup and whenever `settings.proxyUrl` changes (empty string = direct). Crossref requests include a `User-Agent` header. (`net` is only usable after `app.whenReady()`.)
  - Filesystem moves (move-to-library), existence checks.
  - `shell.openPath` to launch PDFs: `const errMsg = await shell.openPath(filePath)`; success = `errMsg === ''` (non-empty string is an error message). Set `lastReadAt = now` **only on success**; on failure toast the message and leave `lastReadAt` unchanged.
- **Utility worker** (Electron `utilityProcess`, `src/main/worker/pdf-worker.ts`): owns CPU-heavy, blocking work so the main thread never freezes —
  - sha256 hashing via streaming `createReadStream` + `crypto.createHash('sha256')` (never read whole file into memory).
  - pdfjs-dist parsing: info-dict + first-N-pages text extraction (Node init per the PDF decision row). Returns `{ fileHash, info, text }` to main over a `MessagePort`. Main decides dedup + DOI + DB writes; the worker does NOT touch the DB or filesystem mutation.
- **Preload**: exposes a typed, validated IPC API to the renderer via `contextBridge`, including typed `on/off` subscribe wrappers for `document:updated` / `import:progress` events (no raw `ipcRenderer` leaks). No Node objects leak; all paths validated server-side.
- **Renderer**: React UI, Zustand stores, Tailwind. No direct fs/DB access.

### Startup sequence (order matters)
1. `app.whenReady()`.
2. Open DB connection (`connection.ts`): `PRAGMA foreign_keys=ON`, `journal_mode=WAL`; run migration runner (`user_version`).
3. Seed default settings if missing (incl. detect+write `language` from system locale on first run).
4. Read bootstrap settings: `language`, `windowBounds`, `listColumnState`, `sidebarCollapsed`, `libraryFolderPath`, `proxyUrl`.
5. Apply proxy via `session.setProxy` (defaultSession).
6. **Create the BrowserWindow** using restored `windowBounds` (so it opens at the right place/size the first frame — no flicker). The renderer calls `await window.api.getBootstrap()` (one async IPC round-trip; DB is already open so this is ~ms) before mounting the app, showing a **language-neutral splash** (logo + spinner, no translatable text) until it resolves — this avoids a wrong-language flash without needing synchronous IPC (impossible under sandbox). Bootstrap carries `language`, `windowBounds`, `listColumnState`, `sidebarCollapsed` so first paint uses the correct language + column layout.
7. `loadURL` (dev server or built file). Show window only after `whenReady`/`did-finish-load` to avoid white flash.
8. Start watch-folder chokidar watchers + metadata-resume (re-enqueue `pending`/`failed` rows per retry cap) + missing-file batch check — all after the window is up, non-blocking.

### Security
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (preload), no `remote`.
- All file-path arguments validated to be `.pdf` and resolved to absolute paths in main before any fs action.
- **CSP**: prod `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'` (no remote). Dev adds `'unsafe-inline'` to script-src + allows the electron-vite HMR `ws://localhost:*` in connect-src so HMR works; dev CSP is only applied when `!app.isPackaged`.

### Import pipeline (shared by add-file / add-folder / watch)
1. Resolve absolute path; skip if path already in `documents` (path dedup).
2. **Off-main hashing**: send the path to the pdf-worker, which streams `createReadStream` → `crypto.createHash('sha256')` and returns `fileHash` (sha256 of file content; if streaming throws — e.g. permission error — returns `null` and dedup falls back to path-only). If `fileHash` matches an existing record: for manual add, show confirmation dialog ("This file appears to be a duplicate. Skip?"); for watch, auto-skip silently.
3. Insert `documents` row with `filePath`, `originalFolderPath` (dirname, immutable), `fileName`, `fileSize`, `fileHash`, `addedAt`, empty metadata, `metadataStatus='pending'`, `metadataAttempts=0`, `editedFields='[]'`. Emit `import:progress`.
4. Enqueue async metadata job (PDF parse also runs on the pdf-worker):
   a. pdf-worker: pdfjs-dist `getDocument({data})` → info dict + text of first N pages. Returns `{info, text}`. Prefill `title`/`keywords`; `authors` normalized to `;`-separated `Family, Given` entries (Crossref/arXiv supply structured names; offline info-dict strings are split heuristically and best-effort formatted, kept as a single entry when parsing is ambiguous). Filename heuristic fallback for title.
   b. **DOI disambiguation** (avoid grabbing a cited reference's DOI): prefer, in order — (i) PDF info-dict `/doi` field; (ii) a DOI in the first 2 pages that is not after a "References"/"参考文献" heading; (iii) among remaining regex matches (`/10\.\d{4,9}\/[-._;()\/:A-Za-z0-9+]+/g`, case-insensitive), the one closest to the top of the document. Ignore matches that appear inside reference sections. arXiv ID extracted similarly from the first 2 pages.
   c. If DOI found → Crossref lookup → fill title/authors/year/venue/volume/abstract/url/doi (`metadataSource='crossref'`); store the fetched values in `remoteValues`. Else if arXiv ID → arXiv API. Else keep offline values (`metadataSource='pdf'`).
   d. On success set `metadataStatus='done'`, `metadataAttempts` unchanged; on exception/timeout set `metadataStatus='failed'`, `metadataAttempts += 1`. Never block import.
5. Update row (respecting `editedFields`: skip merging user-edited fields) + FTS (via triggers). Emit `document:updated` so renderer refreshes.

### Metadata retry policy (resumable, bounded)
- On startup, re-enqueue rows where `metadataStatus='pending'` (interrupted) **or** (`metadataStatus='failed'` **and** `metadataAttempts < 3`). Rows that hit `metadataAttempts >= 3` stay `'failed'` and are **not** auto-retried — surface a per-row "retry" affordance (calls `documents.refreshMetadata(id)` which resets `metadataAttempts=0` and re-enqueues). This prevents a permanently-broken PDF from re-saturating the queue on every launch.

### Drag-to-category flow
1. Renderer sends `{documentId, categoryId}`.
2. Main: resolve the effective move policy — `categories.moveToLibrary` for the target category, falling back to the global `moveToLibraryOnCategorize` setting when it is NULL (default ON). If effective=ON and `filePath` not already under library folder → `fs.rename` into library folder (collision-safe: append suffix if name exists); update `documents.filePath` (note: `originalFolderPath` stays immutable). If effective=OFF, keep file in place — category is a logical label only.
3. Insert `document_categories` row (idempotent).
4. Library folder is excluded from chokidar watching; content-hash dedup guards against any race.
5. When removing a document from ALL categories, the file is NOT moved back — it stays in the library folder (if previously moved). A manual **"Restore to original location"** action is available in the detail panel (see §6): moves the file back to `originalFolderPath` (collision-safe) and updates `filePath`.

### BibTeX export flow
1. Renderer collects selected `documentIds` from the list and calls `export.toBibtex(ids)`.
2. Main: fetch rows by id; for each document build one BibTeX entry (`@article` if `venue`/`volume` present, else `@misc`):
   - `citekey` = first-author-lastname + year + first significant title word, sanitized and de-duplicated within the batch (append `a`, `b`, … on collisions). Falls back to `id` slug if authors/year missing.
   - Field mapping: `title`→`title`, `authors`→`author` (split on `;` into entries; each entry is already `Family, Given`, joined with ` and ` — BibTeX's native format), `year`→`year`, `venue`→`journal`/`booktitle`, `volume`→`volume`, `abstract`→`abstract`, `keywords`→`keywords`, `url`→`url`, `doi`→`doi`. Missing fields omitted (never emit empty fields).
   - Non-ASCII/`{}`/`%` in values escaped per BibTeX rules; values braced.
3. Join entries with blank lines; return the BibTeX string to the renderer (or write directly to the user-chosen path via a save dialog, returning the path).
4. If `ids` is empty → renderer disables the action (no-op); menu item disabled when no selection.

---

## 4. Data Model (SQLite)

```sql
-- Connection pragmas (run on every open in connection.ts)
PRAGMA foreign_keys = ON;   -- REQUIRED: enables ON DELETE CASCADE on document_categories
PRAGMA journal_mode = WAL;  -- concurrent reads while main process writes (watch imports)

-- Core document record
CREATE TABLE documents (
  id            TEXT PRIMARY KEY,          -- uuid
  filePath      TEXT NOT NULL,             -- absolute, current location (updated on move)
  originalFolderPath TEXT NOT NULL,        -- immutable source folder captured at add
  fileName      TEXT NOT NULL,
  fileSize      INTEGER,
  fileHash      TEXT,                      -- sha256 of file content only; NULL if hashing failed (dedup falls back to path-only)
  title         TEXT,
  authors       TEXT,                      -- ';'-separated, each entry "Family, Given" — unambiguous author split (see BibTeX flow). Raw fallback strings allowed for offline-only rows.
  year          TEXT,
  venue         TEXT,                      -- journal or conference
  volume        TEXT,
  abstract      TEXT,
  keywords      TEXT,                      -- comma-separated
  url           TEXT,
  doi           TEXT,
  note          TEXT,                      -- plain text
  starred       INTEGER NOT NULL DEFAULT 0,
  addedAt       INTEGER NOT NULL,          -- unix ms
  lastReadAt    INTEGER,                   -- unix ms, nullable, set only after successful open
  updatedAt     INTEGER NOT NULL,
  metadataSource TEXT,                     -- 'pdf' | 'crossref' | 'arxiv' | 'manual'
  metadataStatus TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'done' | 'failed' — drives restart re-enqueue of the metadata job
  metadataAttempts INTEGER NOT NULL DEFAULT 0,     -- # of failed metadata attempts; auto-retry stops at 3 (see Metadata retry policy)
  editedFields  TEXT NOT NULL DEFAULT '[]',-- JSON array of field names manually edited by the user; refresh merge skips these unless the field was cleared
  remoteValues  TEXT,                      -- JSON {field: {value, source}} captured at last auto-fetch; powers the "↻" conflict indicator + "apply remote" action
  fileMissing   INTEGER NOT NULL DEFAULT 0 -- cached flag, recomputed lazily
);
CREATE INDEX idx_documents_addedAt ON documents(addedAt DESC);
CREATE INDEX idx_documents_lastReadAt ON documents(lastReadAt DESC);
CREATE INDEX idx_documents_starred ON documents(starred);
CREATE INDEX idx_documents_filePath ON documents(filePath);
CREATE INDEX idx_documents_fileHash ON documents(fileHash);
CREATE INDEX idx_documents_metadataStatus ON documents(metadataStatus);

-- Logical categories
CREATE TABLE categories (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  sortOrder     INTEGER NOT NULL DEFAULT 0,
  moveToLibrary INTEGER,                   -- per-category override of the global setting: NULL = inherit global moveToLibraryOnCategorize, 1 = move into library, 0 = keep in place
  createdAt     INTEGER NOT NULL,
  UNIQUE(name)
);

-- Many-to-many
CREATE TABLE document_categories (
  documentId TEXT NOT NULL,
  categoryId TEXT NOT NULL,
  PRIMARY KEY (documentId, categoryId),
  FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE CASCADE
);
CREATE INDEX idx_doccat_doc ON document_categories(documentId);
CREATE INDEX idx_doccat_cat ON document_categories(categoryId);

-- Watch folders
CREATE TABLE watch_folders (
  id      TEXT PRIMARY KEY,
  path    TEXT NOT NULL UNIQUE,           -- absolute
  enabled INTEGER NOT NULL DEFAULT 1,
  addedAt INTEGER NOT NULL
);

-- Settings (key-value)
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- seed keys: libraryFolderPath, crossrefMailto, theme, sidebarCollapsed, lastWatchScanAt, language, moveToLibraryOnCategorize, proxyUrl, windowBounds, listColumnState

-- Full-text search (external content, synced via triggers)
-- trigram tokenizer: substring matching for any script incl. CJK (zh titles/notes/keywords). Requires SQLite >= 3.34 (bundled by better-sqlite3). case-insensitive by default.
CREATE VIRTUAL TABLE docs_fts USING fts5(
  title, authors, venue, year, keywords, abstract, url, note, fileName,
  content='documents', content_rowid='rowid', tokenize='trigram'
);
CREATE TRIGGER documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO docs_fts(rowid, title, authors, venue, year, keywords, abstract, url, note, fileName)
  VALUES (new.rowid, new.title, new.authors, new.venue, new.year, new.keywords, new.abstract, new.url, new.note, new.fileName);
END;
CREATE TRIGGER documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, title, authors, venue, year, keywords, abstract, url, note, fileName)
  VALUES ('delete', old.rowid, old.title, old.authors, old.venue, old.year, old.keywords, old.abstract, old.url, old.note, old.fileName);
END;
-- NOTE: the UPDATE trigger is scoped to FTS-indexed columns ONLY, so toggling starred / lastReadAt /
-- editedFields / metadataStatus / fileMissing / remoteValues does NOT trigger a full FTS reindex.
CREATE TRIGGER documents_au AFTER UPDATE OF title, authors, venue, year, keywords, abstract, url, note, fileName ON documents BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, title, authors, venue, year, keywords, abstract, url, note, fileName)
  VALUES ('delete', old.rowid, old.title, old.authors, old.venue, old.year, old.keywords, old.abstract, old.url, old.note, old.fileName);
  INSERT INTO docs_fts(rowid, title, authors, venue, year, keywords, abstract, url, note, fileName)
  VALUES (new.rowid, new.title, new.authors, new.venue, new.year, new.keywords, new.abstract, new.url, new.note, new.fileName);
END;
```

Search query: `SELECT d.* FROM documents d JOIN docs_fts f ON d.rowid = f.rowid WHERE docs_fts MATCH ? ORDER BY rank;`
- trigram requires query length ≥ 3 (it builds 3-char subsequences). For queries of 1–2 chars (e.g. 2-char Chinese terms), fall back to `SELECT * FROM documents WHERE title LIKE ? OR authors LIKE ? OR …` (same column set), so short CJK lookups still work. The SearchBar picks the path based on trimmed query length.

### Migration runner (`connection.ts`)
- Fresh DB: execute `schema.sql` (all tables + FTS + triggers), then `PRAGMA user_version = 1`.
- Existing DB: read `PRAGMA user_version`; apply `migrations/NN_*.sql` files whose `NN` > current version, in order, each wrapped in `BEGIN…COMMIT`; bump `user_version` after each. On a v1 codebase there are no migration files yet (baseline = `schema.sql`); the folder exists for forward-compat.
- All DDL uses `IF NOT EXISTS` as defense-in-depth. `schema.sql` is the single source of truth for v1 structure; never hand-edit a live DB.

### Settings value schemas (stored as JSON strings in `settings.value`)
```ts
windowBounds    = { x: number; y: number; width: number; height: number; isMaximized: boolean }
listColumnState = {
  columns: { id: 'title'|'authors'|'year'|'venue'|'addedAt'|'filePath'; visible: boolean; width: number; order: number }[],
  sort: { field: SortField; dir: 'asc' | 'desc' }
}
// scalar strings: libraryFolderPath, crossrefMailto, theme ('dark'), language ('zh'|'en'),
// proxyUrl ('' = none), sidebarCollapsed ('0'|'1'), moveToLibraryOnCategorize ('0'|'1')
```
Reads parse with try/catch + fall back to defaults on corruption (never throw on bad JSON).

---

## 5. UI States & Feedback

Every view must handle **four states**: empty, loading, error, and data.

### Global
- **Loading**: skeleton placeholders on startup while DB initializes.
- **Network error**: non-blocking toast ("Crossref unreachable — using offline metadata"), auto-dismiss 5s.
- **First run**: wizard-style overlay: "Welcome to ScholarNote" → choose library folder → ready. Skip button available.

### Top Bar
- **Import progress**: progress bar in the top bar during import of 3+ files; shows "Importing 12/50 PDFs…".
- **Add File / Folder buttons**: disabled during active import (prevent concurrent imports).
- **Search**: placeholder "Search by title, author, keywords…"; no-results state: "No documents match your search."

### Sidebar
- **Empty categories**: show "No categories yet — right-click to create one".
- **Empty folder groups**: directory icon + folder path, count `0`.

### Document List
- **Empty (no documents)**: centered illustration + "Add your first PDF" button.
- **Empty (filtered)**: "No documents in this category. Drag a PDF here to add one."
- **Loading**: 5-row skeleton placeholder with shimmer animation.
- **Error row**: per-document error badge if metadata fetch failed (hover shows failure reason).
- **Missing file row**: yellow warning badge; PDF icon disabled; relocate action available.

### Detail Panel
- **No selection**: "Select a document to view details" placeholder.
- **Multi-selection (≥2 rows)**: replace single-doc fields with a summary header "{{count}} selected" + a bulk-action bar (Delete, Categorize…, Refresh metadata, Export BibTeX). Single-doc editing/refresh/relocate are hidden while multi-select is active. (Bulk actions also live in the list context menu; the panel bar is the keyboard-friendly path.)
- **Saving**: brief "Saving…" indicator next to edited fields; "Saved" confirmation (auto-dismiss 2s).
- **Refresh metadata**: spinner overlay on the detail panel while fetching; toast on completion/failure.
- **Relocate**: opens native file picker; on success, clears `fileMissing` badge and re-enables PDF icon.

### Settings
- **Library folder validation error**: inline red message "Path cannot be inside a watch folder."
- **Watch folder validation error**: "Path cannot be inside the library folder."

### Import Pipeline
- **Hash duplicate (manual)**: modal dialog "A file with identical content already exists: [filename]. Skip this file?" [Skip] [Import Anyway].
- **Password-protected PDF**: toast warning "Skipping encrypted PDF: [filename] (password-protected)".
- **Corrupted PDF**: toast warning "Could not read: [filename] (file may be corrupted)."

### Metadata Refresh
- **Behavior**: re-runs the metadata job and merges results using per-field provenance:
  - Fields currently **empty or NULL** → filled from the fresh fetch.
  - Fields listed in `editedFields` (user has manually edited them) → **never overwritten**, even if the fetch returns a value, *unless* the user explicitly cleared the field first (clearing removes it from `editedFields`).
  - Fields that are non-empty but NOT in `editedFields` (i.e. came from a previous auto-fetch untouched) → updated to the new fetched value.
  - The fetched values are always written to `remoteValues` (regardless of merge outcome), so the conflict indicator stays current.
- **Editing marks fields**: any inline edit via `documents.update` adds the field name to `editedFields` (and writes the new value). Clearing a field removes it from `editedFields`.
- **Conflict indicator**: for a field in `editedFields` whose `remoteValues[field].value` differs from the current value, show a "↻" icon; clicking it replaces the user's value with the remote one (and the field stays in `editedFields` — now holding the remote value).

---

## 6. Feature Specs

### Top bar (left → right)
1. **Sidebar toggle** — collapse to icons-only; persists in `settings.sidebarCollapsed`.
2. **Add file** — native file picker (multi-select `.pdf`) → import pipeline.
3. **Add folder** — native dir picker → import all `.pdf` recursively (one-time).
4. **Watch folder** — native dir picker → add to `watch_folders` + start chokidar. Manage list in Settings.
5. **Export BibTeX** — enabled when one or more documents are selected in the list; opens a save dialog (`*.bib`) and writes one BibTeX entry per selected document. Also reachable via the menu bar: **File → Export → BibTeX…** (the JSON export sits alongside as **File → Export → JSON…**).
6. **Search** (right-aligned) — input; debounced (200ms) FTS5 query (≥3 chars) or LIKE fallback (1–2 chars); results replace the list. Clear returns to the current sidebar selection. **Live refresh while searching**: on a `document:updated` event, if the updated doc is in the current results, patch its row in place (preserve selection + scroll); do NOT auto-add newly-matching docs until the query changes (re-running the full query on every keystroke/next edit). Esc clears search.

### Sidebar
- **All files** — all documents.
- **Recently read** — `lastReadAt IS NOT NULL` ordered desc.
- **Recently added** — `addedAt` ordered desc.
- **Starred** — `starred = 1`.
- **分类 (Categories)** — expandable; lists `categories`; each shows count. Right-click to create/rename/delete. Selecting one filters the list to its documents. **Drop target for internal doc-drag only**: on `drop`, read `application/x-scholarnote-docids` → drag-to-category flow (ignores OS file drops).
- **按照文件夹分类 (Folder grouping)** — expandable; virtual groups by `originalFolderPath` (read-only, derived). Dragging a document onto a folder group is **not supported** (grouping is by immutable original folder; only categories accept drop).

### Middle list
- Columns: 论文名称(title) · 作者(authors) · 发表年份(year) · 期刊/会议(venue) · 添加时间(addedAt) · PDF位置(filePath). Plus a leading PDF-icon cell and a star toggle.
- Click column header → sort asc; click again → desc; arrow indicator. Default: `addedAt` desc.
- Row click → loads detail panel (does NOT set `lastReadAt`).
- PDF icon click → `shell.openPath(filePath)`; on resolve success set `lastReadAt = now` + refresh "Recently read" (on failure, toast + leave `lastReadAt` unchanged).
- Star click toggles `starred`.
- Accepts OS drag-drop of `.pdf` files from Finder (HTML5 `drop` with `e.dataTransfer.files`) → import pipeline. **Rejects internal doc-drops on the list** (a row being dragged onto the list is a no-op — internal drops only target sidebar categories).
- **Drag source**: list rows are draggable (`draggable`); on `dragstart` they set `e.dataTransfer.setData('application/x-scholarnote-docids', JSON.stringify(selectedIds))`. This MIME is the only payload sidebar categories accept.
- Missing file (`fileMissing=1`) → row shows a warning badge; PDF icon disabled.
- **BibTeX export**: when one or more rows are selected, an "Export BibTeX" action is available (list toolbar button + row/context menu). Triggers a save dialog; exports a `.bib` containing one entry per selected document. If nothing is selected, the action is disabled.

### Right detail panel
- **Single selection** → Fields (all inline-editable on click): 论文名称, 作者, 发表年份, 期刊/会议, 卷号(volume), 摘要(abstract), 关键词(keywords), URL, 添加时间(read-only), PDF位置(read-only, with "open" + "relocate" actions), Note (plain-text textarea, autosave on blur/debounce).
- **Multi-selection (≥2)** → fields hidden; show "{{count}} selected" + bulk-action bar (Delete, Categorize…, Refresh metadata, Export BibTeX). (See §5 Detail Panel.)
- **Refresh metadata** button → re-run metadata job; merge respects `editedFields` (skips user-edited unless cleared), refreshes `remoteValues`, shows "↻" where remote differs.
- **Categories** chip list → add/remove category assignments.
- **Relocate file** action (when missing) → dir/file picker → update `filePath` + clear `fileMissing`.
- **Restore to original location** action (shown when `filePath` differs from `originalFolderPath/fileName`, e.g. after a move-to-library) → moves the file back under `originalFolderPath` (collision-safe suffix), updates `filePath`; disabled if the original folder no longer exists (toast explains).

### Settings (window or modal)
- Library folder path (picker) — validates not inside a watch folder.
- Watch folders list (add/remove/toggle).
- Crossref polite-pool mailto.
- Theme (dark default).
- **Language (语言)** — dropdown: 中文 (Chinese) / English. Stored in `settings.language`. Default: system locale if zh, else `en`. Changing language switches UI immediately without restart. Persisted across sessions.

---

## 7. Key Behaviors & Edge Cases

- **Dedup:** path-based skip always (same absolute path never imported twice). Content-hash (sha256) warning on manual add; auto-skip on watch. When `fileHash` is NULL (hashing failed), only path dedup applies.
- **Watch add-only:** deletion/rename of a watched file never removes or clears its DB record. Rename fires chokidar add for the new name → path dedup treats it as new (acceptable) unless hash matches existing → skip.
- **Move-to-library vs watch:** library folder excluded from chokidar. If user sets library path inside a watch folder, or adds a watch folder inside the library path, Settings warns and refuses; content-hash dedup is the safety net.
- **Missing source file:** batch-check all `filePath` on app start (progressive, non-blocking); periodic background rescan every 5 min (configurable); cache result in `fileMissing`. Open disabled when missing; "Relocate" offered.
- **DOI/network failure:** keep offline/blank values; `metadataSource='pdf'` or `'manual'`; `metadataStatus='failed'` (resumable on next launch); import never fails. Timeout 8s per request.
- **Concurrency & rate limiting:** metadata HTTP jobs run on a queue with up to 3 concurrent workers, but behind a **global minimum-interval gate** (not per-worker): ≥1s between Crossref requests, ≥3s between arXiv requests (arXiv asks ≤1 req/3s). The gate is shared across workers so effective rate = the floor. Crossref requests include a `User-Agent` header. **Batch cap**: a single bulk "refresh metadata" action queues at most 50 docs; if more are selected, confirm "This will enqueue N jobs (rate-limited). Continue?" — the user can still proceed; the cap is a UX guard, not a hard limit. PDF parse/hash work is off-main (utility worker) and not rate-limited.
- **Filename collision on move:** append ` (1)`, ` (2)` etc.
- **First run:** create DB file in `app.getPath('userData')/scholarnote.db`, run migrations, seed default settings + a couple of seed categories (optional).

---

## 8. Project Structure

```
ScholarNote/
  package.json                  # scripts: dev/build/typecheck/lint/test (see below)
  electron.vite.config.ts
  electron-builder.yml          # asarUnpack: ["**/*.node"], mac target, dmg
  vitest.config.ts              # unit/integration tests (vitest, jsdom for renderer utils)
  eslint.config.js              # flat config; lint main+preload+renderer+shared
  tsconfig.json                 # solution-style refs → tsconfig.main/ .preload/ .renderer/ .shared/
  tailwind.config.ts
  src/
    shared/                     # imported by main + preload + renderer (no electron deps)
      ipc-types.ts              # Result<T>, ListFilter, DocumentPatch, EditableField, events, DTOs
    main/
      index.ts                  # app lifecycle, startup sequence (§3), window creation
      db/
        connection.ts           # better-sqlite3 open (PRAGMA foreign_keys=ON + WAL) + migration runner (user_version)
        schema.sql              # v1 baseline (single source of truth)
        migrations/             # NN_*.sql for future versions (empty in v1)
        repositories/           # documents, categories, watchFolders, settings
      worker/
        pdf-worker.ts           # utilityProcess: streaming sha256 + pdfjs parse; returns via MessagePort; no DB/fs-mutation
      services/
        importer.ts             # import pipeline + dedup (delegates hashing/parse to worker)
        metadata.ts             # DOI disambiguation + Crossref/arXiv (net); editedFields/remoteValues merge; rate-limited queue; metadataStatus resume + retry cap
        watcher.ts              # chokidar watch_folders (PDF-only, add-only, library-excluded)
        library.ts              # move-to-library + restore-to-original-location
        pdfOpen.ts              # shell.openPath; set lastReadAt only when errMsg === ''
        files.ts                # existence, relocate (hashing lives in worker)
        export.ts               # JSON export/import (backup) + BibTeX export
        logger.ts               # electron-log wrapper
      ipc/
        handlers.ts             # register all ipcMain handlers; each returns Result<T>; try/catch; path/patch validation
        types.ts                # re-exports from src/shared/ipc-types (+ main-only types)
    preload/
      index.ts                  # contextBridge expose typed API; unwrap Result→throw IpcError; getBootstrap() sync
    renderer/
      index.html
      main.tsx
      App.tsx
      components/
        TopBar.tsx
        Sidebar.tsx
        DocumentList.tsx
        DetailPanel.tsx
        SearchBar.tsx
        Settings.tsx
      store/                    # Zustand stores
      hooks/
      ipc.ts                    # typed client wrappers for window.api
      styles/
      i18n/
        index.ts                 # i18next init + language detection
        locales/
          zh.json                # Chinese translations
          en.json                # English translations
```

**`package.json` scripts (agent must run these to verify):**
```jsonc
{
  "scripts": {
    "dev": "electron-vite dev",                       // HMR dev (macOS)
    "build": "electron-vite build",                   // compile main+preload+renderer
    "typecheck": "tsc -b",                            // project-references typecheck across all 4 contexts
    "lint": "eslint .",
    "test": "vitest run",                             // unit + integration
    "test:watch": "vitest",
    "package": "electron-vite build && electron-builder --mac",  // produces .app (asarUnpack applied)
    "rebuild": "electron-rebuild -f -w better-sqlite3"           // @electron/rebuild for native ABI
  }
}
```
**Verification rule (write into `AGENTS.md`):** after any code change, the agent runs `npm run typecheck && npm run lint && npm run test` before declaring a task done; `npm run dev` to smoke the feature; `npm run package` before claiming the build works.

**IPC API surface (preload `window.api`):**
`documents.list(filter)`, `documents.search(q)`, `documents.get(id)`, `documents.update(id, patch)` (marks patched fields in `editedFields`), `documents.setStarred`, `documents.delete(id)`, `documents.bulkDelete(ids)`, `documents.bulkCategorize(ids, catId)`, `documents.bulkRefreshMetadata(ids)`, `documents.openPdf(id)`, `documents.refreshMetadata(id)`, `documents.relocateFile(id, newPath)`, `documents.restoreFile(id)`, `import.addFiles(paths)`, `import.addFolder(dir)`, `categories.list/create(name, moveToLibrary?)/rename/delete`, `categories.setMoveToLibrary(catId, value)`, `categories.assign(docId, catId)`, `categories.unassign`, `watch.list/add/remove/toggle`, `settings.get/set`, `export.toJson()`, `export.toBibtex(ids)`, `import.fromJson(file)`, `getBootstrap()` (async; returns language + windowBounds + listColumnState + sidebarCollapsed — renderer awaits it before mounting, behind a neutral splash). **Events** (preload exposes typed subscribe/unsubscribe, not raw `ipcRenderer`): `events.onDocumentUpdated(cb)`, `events.onImportProgress(cb)`, `events.off(channel, cb)` — backed by `ipcRenderer.on('document:updated' | 'import:progress')` in the sandboxed preload.

**Shared types (`src/shared/ipc-types.ts`, imported by all three contexts):**
```ts
// Envelope for EVERY ipcMain.handle response.
type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

// documents.list filter — covers all sidebar modes + sort.
type ListMode = 'all' | 'recentlyRead' | 'recentlyAdded' | 'starred' | 'category' | 'folder';
type ListFilter = {
  mode: ListMode;
  categoryId?: string;        // when mode === 'category'
  folderPath?: string;        // when mode === 'folder' (originalFolderPath)
  sort?: { field: SortField; dir: 'asc' | 'desc' }; // default { field: 'addedAt', dir: 'desc' }
  // No pagination: returns all rows (metadata is small; renderer virtualizes).
};
type SortField = 'title' | 'authors' | 'year' | 'venue' | 'addedAt' | 'filePath';

// documents.update patch — WHITELIST enforced server-side.
type EditableField =
  | 'title' | 'authors' | 'year' | 'venue' | 'volume'
  | 'abstract' | 'keywords' | 'url' | 'doi' | 'note';
type DocumentPatch = Partial<Pick<Document, EditableField>>;
// Server rejects (error code 'forbidden_field') any key outside EditableField —
// notably id, filePath, originalFolderPath, fileName, fileSize, fileHash, addedAt,
// lastReadAt, starred, metadataSource, metadataStatus, metadataAttempts,
// editedFields, remoteValues, fileMissing are NOT settable via update.
// Each patched field is added to editedFields (and removed if cleared to '').

// documents.search: trim q; len>=3 → FTS5 MATCH; len 1–2 → LIKE fallback (server decides).
type SearchResult = Document[]; // ordered by FTS rank / LIKE relevance
```
Handlers wrap logic in try/catch and always resolve a `Result` (never reject). The preload unwraps: on `{ok:false}` it throws a serializable `IpcError` the renderer can catch.

### i18n Translation Keys

Translation files (`zh.json` / `en.json`) cover all user-facing strings. Top-level key namespaces:

```json
{
  "sidebar": {
    "allFiles": "All Files" / "所有文件",
    "recentlyRead": "Recently Read" / "最近阅读",
    "recentlyAdded": "Recently Added" / "最近添加",
    "starred": "Starred" / "收藏",
    "categories": "Categories" / "分类",
    "folderGrouping": "Folders" / "文件夹"
  },
  "topbar": {
    "addFile": "Add File" / "添加文件",
    "addFolder": "Add Folder" / "添加文件夹",
    "watchFolder": "Watch Folder" / "监控文件夹",
    "exportBibtex": "Export BibTeX…" / "导出 BibTeX…",
    "exportJson": "Export JSON…" / "导出 JSON…",
    "search": "Search…" / "搜索…"
  },
  "list": {
    "title": "Title" / "论文名称",
    "authors": "Authors" / "作者",
    "year": "Year" / "发表年份",
    "venue": "Venue" / "期刊/会议",
    "addedAt": "Added" / "添加时间",
    "filePath": "Path" / "PDF位置"
  },
  "detail": {
    "title": "Title" / "论文名称",
    "authors": "Authors" / "作者",
    "year": "Year" / "发表年份",
    "venue": "Venue" / "期刊/会议",
    "volume": "Volume" / "卷号",
    "abstract": "Abstract" / "摘要",
    "keywords": "Keywords" / "关键词",
    "url": "URL",
    "addedAt": "Added" / "添加时间",
    "filePath": "Path" / "PDF位置",
    "note": "Notes" / "笔记",
    "refreshMetadata": "Refresh Metadata" / "刷新元数据",
    "relocate": "Relocate" / "重新定位",
    "restoreOriginal": "Restore to Original Location" / "恢复到原始位置",
    "open": "Open" / "打开",
    "applyRemote": "Apply remote value" / "应用远端值",
    "moveToLibraryInherit": "Inherit global" / "继承全局",
    "moveToLibraryMove": "Move into library" / "移入库文件夹",
    "moveToLibraryKeep": "Keep in place" / "保留原位"
  },
  "settings": {
    "title": "Settings" / "设置",
    "libraryFolder": "Library Folder" / "库文件夹",
    "watchFolders": "Watch Folders" / "监控文件夹",
    "crossrefMailto": "Crossref Mailto",
    "theme": "Theme" / "主题",
    "language": "Language" / "语言",
    "proxy": "Proxy (HTTP/HTTPS)" / "代理 (HTTP/HTTPS)",
    "moveToLibraryOnCategorize": "Move file into library on categorize" / "分类时将文件移入库文件夹"
  },
  "common": {
    "delete": "Delete" / "删除",
    "rename": "Rename" / "重命名",
    "cancel": "Cancel" / "取消",
    "confirm": "Confirm" / "确认",
    "create": "Create" / "创建",
    "save": "Save" / "保存",
    "skip": "Skip" / "跳过",
    "importAnyway": "Import Anyway" / "仍然导入",
    "openInFinder": "Open in Finder" / "在访达中打开",
    "copyPath": "Copy Path" / "复制路径",
    "multiSelected": "{{count}} selected" / "已选择 {{count}} 篇",
    "noResults": "No documents found" / "未找到文档",
    "emptyLibrary": "Your library is empty" / "您的库是空的",
    "selectDocHint": "Select a document to view details" / "选择一篇文献查看详情",
    "saving": "Saving…" / "正在保存…",
    "saved": "Saved" / "已保存",
    "networkError": "Crossref unreachable — using offline metadata" / "Crossref 无法访问 — 使用离线元数据",
    "exportBibtexTitle": "Export BibTeX" / "导出 BibTeX",
    "selectToExport": "Select one or more documents to export" / "请选择一篇或多篇文献以导出",
    "bibtexExported": "Exported {{count}} entries to BibTeX" / "已导出 {{count}} 条到 BibTeX"
  },
  "dialog": {
    "duplicateWarning": "A file with identical content already exists: {{name}}. Skip this file?" / "已存在相同内容的文件: {{name}}。跳过此文件？",
    "deleteConfirm": "Remove this document from the library? (The PDF file will not be deleted.)" / "从库中移除此文献？（PDF文件不会被删除。）"
  }
}
```

---

## 9. Implementation Task List (ordered)

**Phase 0 — Scaffold**
1. Init repo: `npm create @quick-start/electron` (electron-vite React+TS) or manual. Add deps: `better-sqlite3@^11`, chokidar, `pdfjs-dist@^4`, zustand, tailwind, `@tanstack/react-virtual`, uuid, react-i18next, i18next, electron-log. Add devDeps: `@electron/rebuild`, electron-builder, **vitest, jsdom, @types/node** (test infra), eslint, typescript. Configure `electron-builder.yml` (mac target + `asarUnpack: ["**/*.node"]`). Set up tsconfig project references (`tsconfig.{main,preload,renderer,shared}.json`) + `src/shared/ipc-types.ts`. Add the `package.json` scripts from §8 + `postinstall: electron-rebuild -f -w better-sqlite3`. **Create `vitest.config.ts`** (env: `jsdom` for renderer utils; include `tests/unit/**` + `src/**/*.test.ts`; `typecheck` excludes test files via the shared tsconfig so `tsc -b` stays clean). Write the verification rule into `AGENTS.md`. **Verify the test infra works before leaving Phase 0:** the three existing `tests/unit/*.test.ts` files are self-contained reference implementations — running `npm run test` must pass them with zero `src/` code present.
2. Tailwind + VSCode-dark theme tokens; base layout shell (TopBar/Sidebar/List/Detail) with placeholder data.
3. Secure BrowserWindow config (contextIsolation, sandbox, CSP per §3 Security — dev allows HMR ws, prod strict); native macOS `Menu` with File (Add File/Folder, Watch Folder, Export → JSON…/BibTeX…) /Edit/Window/Help; `electron-log` initialized to `app.getPath('logs')`. Wire app-scoped keyboard shortcuts via `Menu` accelerators + renderer `keydown` — **do not import `globalShortcut`**.
4. i18n setup: create `i18n/index.ts` (i18next init with `zh.json` + `en.json` resources, `settings.language` detection fallback to system locale); create full translation files for both languages; wrap all UI strings with `useTranslation` / `t()`.

**Phase 0 — DoD**
- [ ] `npm install` succeeds with no native-rebuild errors; `postinstall` runs `@electron/rebuild` for better-sqlite3.
- [ ] `npm run typecheck && npm run lint` pass on the empty-ish scaffold.
- [ ] `npm run test` passes the three pre-existing `tests/unit/*.test.ts` specs (self-contained) — proving the vitest/jsdom pipeline works.
- [ ] `npm run dev` launches a window with the 4-pane shell + VSCode-dark Tailwind theme; menu bar present; language-neutral splash shows before bootstrap resolves.
- [ ] `src/shared/ipc-types.ts` exists with `Result<T>`, `ListFilter`, `DocumentPatch`, `EditableField` (matches `docs/ipc-api.md`).
- [ ] i18n: both `zh.json`/`en.json` exist with all namespaces from `docs/i18n.md`; switching language updates UI live.

**Phase 1 — Data layer**
5. DB connection + migration runner (`user_version`-based, §4): open with `PRAGMA foreign_keys = ON` + `journal_mode = WAL`; create all tables (incl. `editedFields`/`remoteValues`/`metadataStatus`/`metadataAttempts` on documents, `moveToLibrary` on categories) + FTS5 with `tokenize='trigram'` (runtime-check tokenizer availability; fall back to `unicode61`+`LIKE` if it throws) + triggers (note the `documents_au` is scoped `AFTER UPDATE OF <fts columns>`).
6. Repositories for documents/categories/watch_folders/settings (typed).
7. Preload contextBridge API (incl. typed `events.on/off` subscribe wrappers + async `getBootstrap()`) + ipcMain handlers wiring repos (no PDF/IO yet). Every handler returns `Result<T>` (try/catch, never reject). Implement `documents.update` patch whitelist validation (reject non-`EditableField` keys with `forbidden_field`) and `documents.list(ListFilter)` covering all sidebar modes.

**Phase 1 — DoD**
- [ ] `npm run typecheck && npm run lint && npm run test` pass.
- [ ] Fresh DB created in `userData` on first launch; `PRAGMA foreign_keys=ON` + `journal_mode=WAL` active; `user_version=1`.
- [ ] FTS5 with `tokenize='trigram'` verified at runtime (falls back to `unicode61`+`LIKE` if unavailable).
- [ ] `documents.update` rejects non-`EditableField` keys with `forbidden_field`; `patch-whitelist.test.ts` passes against the real validation function (replace the stub import).
- [ ] `documents.list(ListFilter)` covers all six `ListMode` values; FK cascade on `document_categories` works.
- [ ] `documents_au` UPDATE trigger is scoped to FTS columns only — toggling `starred`/`lastReadAt`/`editedFields` does NOT reindex FTS (add a regression test).
- [ ] `getBootstrap()` returns `{language, windowBounds, listColumnState, sidebarCollapsed}`; every handler resolves a `Result<T>`, never rejects.

**Phase 2 — Import & metadata**
8. `pdf-worker.ts` (utilityProcess): streaming sha256 (`createReadStream`+`crypto.createHash`) + pdfjs-dist parse (Node init per PDF decision row) → returns `{fileHash, info, text}` via MessagePort. `importer.ts`: add file / add folder (recursive), path + hash dedup (NULL hash → path-only), insert row (`metadataStatus='pending'`, `metadataAttempts=0`), emit `import:progress`.
9. `metadata.ts`: DOI disambiguation (info-dict `/doi` → first-2-pages non-reference matches → topmost); Crossref + arXiv via `net` with timeout/fallback; rate-limited queue (global gate: ≥1s Crossref / ≥3s arXiv, 3 workers, 50-doc batch confirm); merge respecting `editedFields`, persist `remoteValues`, set `metadataStatus`/`metadataAttempts`. **Startup resume: re-enqueue `pending` + `failed`-with-`metadataAttempts<3`; `>=3` stays failed with a manual retry affordance.**
10. Wire add-file/add-folder buttons; show documents in list; emit update events.

**Phase 2 — DoD**
- [ ] `npm run typecheck && npm run lint && npm run test` pass.
- [ ] `metadata-merge.test.ts` passes against the real `mergeMetadata` (replace stub import): empty-fill, `editedFields`-skip, cleared-field-refill, `remoteValues` always written, conflict detection.
- [ ] pdf-worker (`utilityProcess`) streams sha256 (no whole-file buffering) + returns `{fileHash, info, text}` via MessagePort; import of 50 PDFs keeps the main thread/progress bar responsive.
- [ ] Path dedup always; hash-dedup warns on manual add, auto-skips on watch; NULL hash → path-only dedup.
- [ ] DOI disambiguation: info-dict `/doi` wins; a DOI inside a References section is NOT picked; `metadata-merge.md` ordering honored.
- [ ] Rate-limited queue: ≥1s Crossref / ≥3s arXiv, 3 workers, 8s timeout; 50-doc batch confirm dialog.
- [ ] Startup resume: `pending` and `failed`-with-`metadataAttempts<3` re-enqueue; `>=3` stays failed with manual-retry affordance (resets `metadataAttempts=0`).
- [ ] Add File / Add Folder buttons wired; documents appear in list; `import:progress` + `document:updated` events fire.

**Phase 3 — UI: list + detail**
11. DocumentList: virtual-scrolled (`@tanstack/react-virtual`) columns, sortable (asc/desc + arrows), resizable + show/hide columns via header context menu, default addedAt desc, star toggle, PDF-icon open + lastReadAt (on success, `errMsg===''`), missing-file badge, multi-select via checkbox column, context menu (Open in Finder, Copy Path, Refresh Metadata, Delete). **DnD**: list is an OS file-drop target only (`dataTransfer.files` → import); list rows are draggable setting `application/x-scholarnote-docids`; internal doc-drops onto the list are no-ops.
12. DetailPanel: inline-editable fields (edits recorded in `editedFields`), plain-text Note (autosave), refresh-metadata (merge respects `editedFields`, refreshes `remoteValues`, shows "↻" conflict indicator), relocate, restore-to-original-location. **Multi-select state (≥2)**: hide single-doc fields, show "{{count}} selected" + bulk-action bar (Delete/Categorize/Refresh/Export BibTeX); restore single-doc view when selection ≤1.
13. Smart lists: All / Recently read / Recently added / Starred.
14. Document deletion: right-click "Delete" on list row or button in detail panel; confirm dialog; removes DB record (never deletes source PDF). Bulk delete for multi-select.

**Phase 3 — DoD**
- [ ] `npm run typecheck && npm run lint && npm run test` pass.
- [ ] DocumentList virtual-scrolls (`@tanstack/react-virtual`); columns sortable (asc/desc + arrows), resizable, show/hide via header context menu; default `addedAt` desc.
- [ ] PDF-icon click calls `shell.openPath`; `lastReadAt` set only when `errMsg===''` (regression: force failure → `lastReadAt` unchanged + toast).
- [ ] Multi-select via checkbox; missing-file badge + disabled PDF icon; context menu (Open in Finder, Copy Path, Refresh Metadata, Delete).
- [ ] DnD dual-source: OS file drop → import; list rows draggable with `application/x-scholarnote-docids`; internal doc-drops onto the list are no-ops (per `docs/drag-and-drop.md`).
- [ ] DetailPanel inline-edits record `editedFields`; Note autosave; refresh-metadata shows "↻" conflict indicator + apply-remote; relocate + restore-to-original-location work.
- [ ] Multi-select (≥2): single-doc fields hidden, "{{count}} selected" bulk-action bar (Delete/Categorize/Refresh/Export BibTeX); reverts to single view at ≤1.
- [ ] Smart lists (All / Recently read / Recently added / Starred) filter correctly.
- [ ] Delete + bulk delete with confirm dialog; DB record removed (source PDF untouched); `document_categories` rows cascade-removed.

**Phase 4 — Sidebar groups & drag**
15. Categories CRUD UI (create/rename/edit include a `moveToLibrary` override: inherit global / move / keep in place); category-filtered list; many-to-many assignment chips in detail.
16. Drag document → category: sidebar category accepts only `application/x-scholarnote-docids`; `library.ts` resolves effective move policy (category override → global) + path update + assignment.
17. Folder grouping (virtual, by `originalFolderPath`); expandable.

**Phase 4 — DoD**
- [ ] `npm run typecheck && npm run lint && npm run test` pass.
- [ ] Categories CRUD UI (create/rename/delete via right-click); edit dialog exposes `moveToLibrary` override (inherit global / move / keep).
- [ ] Category-filtered list works; many-to-many assignment chips in detail panel.
- [ ] Drag doc → category: sidebar accepts only `application/x-scholarnote-docids`; effective move policy = category override → global; file moved (collision-safe) when effective=ON, `filePath` updated, `originalFolderPath` immutable; FTS still finds it after move.
- [ ] Setting a category `moveToLibrary`=keep-in-place → drag does NOT move file (assignment only).
- [ ] Disabling global `moveToLibraryOnCategorize` + dragging to a default category → file NOT moved.
- [ ] Folder grouping (virtual, by `originalFolderPath`) expandable; folder groups are NOT drop targets.

**Phase 5 — Watch & search**
18. `watcher.ts`: chokidar per watch folder, recursive, PDF-only, add-only, `awaitWriteFinish`; library exclusion; debounce; hook into importer.
19. Watch folder Settings UI (add/remove/toggle).
20. SearchBar: debounced (200ms) query; ≥3 chars → FTS5 MATCH, 1–2 chars → `LIKE` fallback (server picks); results replace list; Esc clears. Live refresh: on `document:updated`, patch matching rows in place (preserve selection/scroll); don't auto-add new matches until query changes.

**Phase 5 — DoD**
- [ ] `npm run typecheck && npm run lint && npm run test` pass.
- [ ] chokidar watchers: recursive, PDF-only, add-only, `awaitWriteFinish`; library folder excluded; rename → new add (path dedup); deletion never removes DB record.
- [ ] Watch folder Settings UI (add/remove/toggle) works; adding a watch inside the library folder (or vice-versa) is refused with the validation message from `docs/ui-states.md`.
- [ ] SearchBar: 200ms debounce; ≥3 chars → FTS5 MATCH; 1–2 chars → `LIKE` fallback (server decides); Esc clears; no-results state shows.
- [ ] Live refresh: on `document:updated`, matching rows patched in place (selection + scroll preserved); new matches NOT auto-added until query changes.
- [ ] Regression: a 2-char Chinese term uses `LIKE`; a 3+ char term uses trigram FTS.

**Phase 6 — Settings, polish, edge cases**
21. Settings: library folder (validate not under a watch folder, and no watch folder inside library), Crossref mailto, proxy (HTTP/HTTPS, optional — applied to `defaultSession` via `session.setProxy` on change + startup), theme, sidebar collapse persistence, **language dropdown (zh/en) — update `settings.language` + call `i18next.changeLanguage()`; UI updates immediately**, `moveToLibraryOnCategorize` toggle (default ON; per-category overrides edited via category create/edit).
22. Missing-file detection: batch `fs.existsSync` on app start + periodic background rescan (every 5 min); cache `fileMissing` flag; relocate flow for missing files.
23. **JSON export/import** (`export.toJson()` / `import.fromJson(file)`): export full library (documents + categories + `document_categories` assignment map) as JSON via native save dialog; import via open dialog (merge or replace; re-creates category memberships). Verify round-trip preserves all metadata + category memberships.
24. **BibTeX export** (`export.toBibtex(ids)`): citekey generation + field mapping (authors split on `;`) + value escaping (non-ASCII, `{}`, `%`) + duplicate-citekey suffixing; `bibtex.test.ts` must pass against the real implementation (replace stub). List "Export BibTeX" toolbar/context action enabled only when ≥1 row selected; menu bar **File → Export → BibTeX…** (alongside **File → Export → JSON…**). Entry type `@article` when `venue`+`volume` present, else `@misc`.
25. **First-run + empty states**: first-run DB creation + seed default settings (+ optional seed categories); first-run wizard overlay ("Welcome to ScholarNote" → choose library folder → ready, skip available). All views implement the four states (empty/loading/error/data) per `docs/ui-states.md`: empty library, filtered empty, no-results, missing-file badge, password-protected/corrupted-PDF toasts.
26. **Window state & keyboard shortcuts**: persist window bounds, sidebar width, list column widths/order to `settings` DB — debounced (500ms) on window `resize`/`move` and flushed on window `close` (macOS red-dot) **and** app `before-quit` (Cmd+Q); restore on startup (read before createWindow, §3 Startup sequence). Keyboard shortcuts: Cmd+F, Cmd+I, Cmd+Backspace, Cmd+S, arrow keys, Enter, Space — via `Menu` accelerators + renderer `keydown` (**not** `globalShortcut`).
27. **Packaging & smoke test**: `npm run package` → macOS `.app` via electron-builder with `asarUnpack: ["**/*.node"]`; ad-hoc sign (`codesign --force --deep -s -`) so it launches under Gatekeeper on Apple Silicon. **Smoke test the packaged `.app`** (not just `npm run dev`): better-sqlite3 loads (no asar dlopen error), DB created in `userData` on first launch, `PRAGMA foreign_keys=ON` active.

**Phase 6 — DoD**
- [ ] `npm run typecheck && npm run lint && npm run test` pass (incl. `bibtex.test.ts` against the real implementation).
- [ ] JSON export → re-import preserves all metadata + `document_categories` memberships.
- [ ] BibTeX: 1-doc export has correct fields/citekey/authors; 3-doc export has 3 entries + unique citekeys; File → Export → BibTeX… disabled with no selection; round-trip into a LaTeX bibliography compiles.
- [ ] First-run wizard appears on empty DB; all four UI states render for every view; password-protected/corrupted-PDF toasts fire.
- [ ] Window bounds restored after red-dot close (no Cmd+Q) AND after Cmd+Q; all keyboard shortcuts work via Menu accelerators + keydown (no `globalShortcut` import anywhere).
- [ ] Missing-file batch check on start + 5-min background rescan; `fileMissing` flag cached; relocate clears badge.
- [ ] Settings: library/watch-folder mutual-exclusion validation; proxy applied to `defaultSession` on change + startup; language switch updates UI live + persists.
- [ ] `npm run package` produces an ad-hoc-signed `.app`; smoke test confirms better-sqlite3 loads, DB created, `PRAGMA foreign_keys=ON` active.

---

## 10. Validation / Testing

- **Unit:** repositories (CRUD + FTS sync), dedup logic (sha256 + NULL→path-only fallback; streaming hash does not buffer whole file), DOI regex (lowercase + `+` cases) + **DOI disambiguation (a DOI in a References section is NOT picked; info-dict `/doi` wins)**, metadata fallback mapping, **metadata refresh merge respecting `editedFields` + `remoteValues` conflict detection**, **retry cap (3 fails → `metadataStatus='failed'`, no auto-re-enqueue; manual retry resets `metadataAttempts`)**, move collision naming, **FK cascade (delete document/category clears `document_categories`)**, **`documents.update` patch whitelist (rejects `id`/`filePath`/`starred`/… with `forbidden_field`; clearing a field removes it from `editedFields`)**, **`Result<T>` envelope (handlers never reject; preload unwraps to `IpcError`)**, **BibTeX citekey generation + field mapping (authors split on `;`) + value escaping (non-ASCII, `{}`, `%`) + duplicate-citekey suffixing**, **FTS trigram match + <3-char `LIKE` fallback**, **`documents_au` trigger does NOT fire on `starred`/`lastReadAt` toggle (no FTS reindex)**.
- **Integration:** import pipeline end-to-end (real sample PDFs with/without DOI); **off-main worker: bulk-import 50 PDFs and verify the UI/progress bar stays responsive (main thread not blocked)**; watch folder add-only behavior; drag-to-category move + path update + FTS still searchable; **DnD dual-source (OS file drop imports; internal doc-drag only targets categories; list rejects internal drops)**; **JSON export → re-import preserves `document_categories` memberships**; **metadata job resume: kill app mid-import, relaunch, verify `pending`/`failed<3` rows re-enqueue and complete; a 3×-failed row is NOT auto-retried**.
- **Manual smoke:** add file/folder; watch a folder and drop a new PDF in; search (incl. a 2-char Chinese term → LIKE fallback; a 3+ char term → trigram); sort each column; show/hide columns; open PDF (verify reader launches + Recently read updates; kill the reader path to force failure → verify `lastReadAt` NOT set); edit fields + Note (verify "Saving…/Saved" feedback); create category + drag doc into it (verify file moved, original folder group unchanged, still opens); **set a category's `moveToLibrary`=keep-in-place and drag a doc in (verify file NOT moved, category assigned)**; **disable global `moveToLibraryOnCategorize` and drag doc to a default category (verify file NOT moved)**; **use "Restore to original location" on a moved doc (verify file returns to `originalFolderPath`)**; delete document + bulk delete (verify `document_categories` rows also removed); **multi-select: select 3 docs, bulk-categorize, verify all assigned**; delete a watched source file (verify record persists); move source file externally (verify missing badge + relocate); **edit a field, refresh metadata, verify the ↻ conflict indicator appears when remote differs and "apply remote" replaces the value**; **switch language in Settings (verify all UI text updates immediately without restart, persists after relaunch)**; **JSON export + re-import (verify all metadata + category memberships preserved)**; **BibTeX export: select 1 doc → export, verify entry fields/citekey/authors; select 3 docs → export, verify 3 entries + unique citekeys; open File → Export → BibTeX… with no selection (verify disabled); verify round-trip the .bib into a LaTeX bibliography compiles**; **resize/move the window then close via red dot (without Cmd+Q), relaunch, verify bounds restored**; **set a proxy in Settings, verify Crossref requests route through it (or fail predictably if unreachable)**; **multi-select ≥2 rows → detail panel shows "{{count}} selected" bulk-action bar with single-doc fields hidden**; **launch the packaged `.app` (not `npm run dev`) → better-sqlite3 loads (no asar dlopen error), opens under Gatekeeper on Apple Silicon**; **verify prod CSP blocks a deliberately-injected remote `<script>`**.
- **Build:** `npm run typecheck && npm run lint && npm run test` pass; `npm run package` produces a macOS `.app` with `asarUnpack: ["**/*.node"]` applied and ad-hoc signed; verify DB created in `userData` on first launch, `PRAGMA foreign_keys = ON` active, and better-sqlite3 loads from the unpacked `.node` (not from inside asar).

---

## 11. Open Questions / Configurable Defaults

- Library folder default `~/Documents/ScholarNote Library` (configurable).
- Default sort `addedAt` DESC.
- Seed categories: none by default (user-created) — confirm if any predefined categories are wanted.
- Crossref `mailto`: leave blank (use common pool) unless user sets one in Settings.
- Keywords stored comma-separated string (simplest); revisit if structured keywords needed later.
- Authors stored `;`-separated as `Family, Given` entries (unambiguous split for BibTeX + display). Offline info-dict strings that can't be parsed stay as a single raw entry; revisit a structured `document_authors` table in v1.1 if finer control is needed.
- `moveToLibraryOnCategorize`: default ON (global). Per-category override via `categories.moveToLibrary` (NULL=inherit, 1=move, 0=keep). Users who prefer files in-place can disable globally or per category.
- Proxy: no proxy by default. Optional HTTP/HTTPS proxy URL in Settings, applied to `defaultSession` via `session.setProxy` (affects Crossref/arXiv fetch only).
- FTS5 uses the trigram tokenizer for CJK substring search (≥3-char queries); 1–2-char queries fall back to SQL `LIKE`. Revisit a dedicated CJK segmenter if recall is insufficient.
- PDF import N for text extraction: first 5 pages default; configurable (1–20) in Settings.
- Category nesting/hierarchy: deferred to v1.1 (flat in v1).
- Built-in PDF viewer: deferred to v1.1 (thumbnail + first-page preview); full viewer out of scope.
- BibTeX entry type: `@article` when `venue`+`volume` present, otherwise `@misc`; revisit finer-grained types (inproceedings, book) in v1.1.
- CSV export: deferred to v1.1.
- Code signing: v1 ships **ad-hoc signed** only (runs under Gatekeeper on the build machine / after clearing quarantine). Real Developer ID signing + notarization deferred (needed for distribution).
- Toolchain decisions (resolved, see §2/§8): test runner = vitest; type sharing = `src/shared` + tsconfig project references; migrations = `PRAGMA user_version`; CPU work = `utilityProcess`.
- Auto-update: deferred to post-v1.
