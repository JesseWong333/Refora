# Task 05 — DB connection + migrations

**Phase:** 1 (Data layer) · **Prerequisites:** 01 · **Master plan:** §4 (Data Model), §4 (Migration runner)

## Goal
Open the better-sqlite3 connection with required pragmas, create the full v1 schema (tables + FTS5 + triggers) via a migration runner based on `PRAGMA user_version`, and verify the trigram tokenizer at runtime with fallback.

## Spec — pragmas (run on every open in `connection.ts`)
```sql
PRAGMA foreign_keys = ON;   -- REQUIRED: enables ON DELETE CASCADE on document_categories
PRAGMA journal_mode = WAL;
```

## Spec — full v1 schema (`src/main/db/schema.sql`, single source of truth for v1)
```sql
CREATE TABLE documents (
  id            TEXT PRIMARY KEY,          -- uuid
  filePath      TEXT NOT NULL,             -- absolute, current location (updated on move)
  originalFolderPath TEXT NOT NULL,        -- immutable source folder captured at add
  fileName      TEXT NOT NULL,
  fileSize      INTEGER,
  fileHash      TEXT,                      -- sha256 of content only; NULL if hashing failed (dedup falls back to path-only)
  title         TEXT,
  authors       TEXT,                      -- ';'-separated, each "Family, Given"
  year          TEXT,
  venue         TEXT,
  volume        TEXT,
  abstract      TEXT,
  keywords      TEXT,                      -- comma-separated
  url           TEXT,
  doi           TEXT,
  note          TEXT,                      -- plain text
  starred       INTEGER NOT NULL DEFAULT 0,
  addedAt       INTEGER NOT NULL,          -- unix ms
  lastReadAt    INTEGER,                   -- unix ms, nullable
  updatedAt     INTEGER NOT NULL,
  metadataSource TEXT,                     -- 'pdf' | 'crossref' | 'arxiv' | 'manual'
  metadataStatus TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'done' | 'failed'
  metadataAttempts INTEGER NOT NULL DEFAULT 0,
  editedFields  TEXT NOT NULL DEFAULT '[]',-- JSON array of user-edited field names
  remoteValues  TEXT,                      -- JSON {field: {value, source}}
  fileMissing   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_documents_addedAt ON documents(addedAt DESC);
CREATE INDEX idx_documents_lastReadAt ON documents(lastReadAt DESC);
CREATE INDEX idx_documents_starred ON documents(starred);
CREATE INDEX idx_documents_filePath ON documents(filePath);
CREATE INDEX idx_documents_fileHash ON documents(fileHash);
CREATE INDEX idx_documents_metadataStatus ON documents(metadataStatus);

CREATE TABLE categories (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  sortOrder     INTEGER NOT NULL DEFAULT 0,
  moveToLibrary INTEGER,                   -- NULL=inherit global, 1=move, 0=keep
  createdAt     INTEGER NOT NULL,
  UNIQUE(name)
);

CREATE TABLE document_categories (
  documentId TEXT NOT NULL,
  categoryId TEXT NOT NULL,
  PRIMARY KEY (documentId, categoryId),
  FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE CASCADE
);
CREATE INDEX idx_doccat_doc ON document_categories(documentId);
CREATE INDEX idx_doccat_cat ON document_categories(categoryId);

CREATE TABLE watch_folders (
  id      TEXT PRIMARY KEY,
  path    TEXT NOT NULL UNIQUE,           -- absolute
  enabled INTEGER NOT NULL DEFAULT 1,
  addedAt INTEGER NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- seed keys: libraryFolderPath, crossrefMailto, theme, sidebarCollapsed, lastWatchScanAt,
--   language, moveToLibraryOnCategorize, proxyUrl, windowBounds, listColumnState

-- FTS5 external-content, trigram tokenizer (CJK substring). case-insensitive.
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
-- UPDATE trigger scoped to FTS-indexed columns ONLY (toggling starred/lastReadAt/editedFields/etc does NOT reindex)
CREATE TRIGGER documents_au AFTER UPDATE OF title, authors, venue, year, keywords, abstract, url, note, fileName ON documents BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, title, authors, venue, year, keywords, abstract, url, note, fileName)
  VALUES ('delete', old.rowid, old.title, old.authors, old.venue, old.year, old.keywords, old.abstract, old.url, old.note, old.fileName);
  INSERT INTO docs_fts(rowid, title, authors, venue, year, keywords, abstract, url, note, fileName)
  VALUES (new.rowid, new.title, new.authors, new.venue, new.year, new.keywords, new.abstract, new.url, new.note, new.fileName);
END;
```

## Spec — migration runner (`connection.ts`, master plan §4)
- **Fresh DB:** execute `schema.sql` (all tables + FTS + triggers), then `PRAGMA user_version = 1`.
- **Existing DB:** read `PRAGMA user_version`; apply `migrations/NN_*.sql` whose `NN` > current version, in order, each wrapped in `BEGIN…COMMIT`; bump `user_version` after each. v1 has no migration files yet (baseline = `schema.sql`); the `migrations/` folder exists for forward-compat.
- All DDL uses `IF NOT EXISTS` as defense-in-depth. Never hand-edit a live DB.
- DB file location: `app.getPath('userData')/scholarnote.db`.

## Spec — tokenizer availability (master plan §2)
- At init, verify `trigram` tokenizer works (e.g. `CREATE VIRTUAL TABLE ... USING fts5(x, tokenize='trigram')` in a try/catch on a temp table). If it throws, fall back to `unicode61` + always-on `LIKE` search. Record which path is active.

## Steps
1. `src/main/db/connection.ts`: open better-sqlite3 (single connection), apply pragmas, run migration runner.
2. `src/main/db/schema.sql`: the v1 schema above.
3. `src/main/db/migrations/`: empty dir (forward-compat) + a `.gitkeep`.
4. Trigram-availability check + fallback flag.
5. Seed default settings on first run (the seed keys above) including detect+write `language` from system locale.
6. Wire this DB open into the startup sequence (`src/main/index.ts` step 2) replacing the Task 03 seam.

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- Fresh DB created in `userData` on first launch; `PRAGMA foreign_keys=ON` + `journal_mode=WAL` active; `user_version=1`.
- FTS5 with `tokenize='trigram'` verified at runtime (falls back to `unicode61`+`LIKE` if unavailable).
- `documents_au` UPDATE trigger is scoped to FTS columns only — add a regression test proving toggling `starred`/`lastReadAt`/`editedFields`/`metadataStatus`/`fileMissing`/`remoteValues` does **not** reindex FTS (e.g. FTS rowcount unchanged).

## Phase 1 DoD (this task owns)
- [ ] Fresh DB created in `userData`; `foreign_keys=ON` + `journal_mode=WAL`; `user_version=1`.
- [ ] FTS5 `trigram` verified at runtime (fallback to `unicode61`+`LIKE`).
- [ ] `documents_au` scoped to FTS columns only — toggling `starred`/`lastReadAt`/`editedFields` does NOT reindex FTS (regression test).
