# Task 23 — JSON export / import

**Phase:** 6 (Settings, polish, edge cases) · **Prerequisites:** 06, 07 · **Master plan:** §1 (scope), §2 (Export), §6 (menu), §10

## Goal
JSON export of the full library (documents + categories + `document_categories` assignment map) and re-import that preserves all metadata + category memberships. Menu bar **File → Export → JSON…** and import via open dialog.

## Spec (master plan §1, §2, §6)
- `export.toJson()` → export full library as JSON via native save dialog: documents (all columns) + categories + `document_categories` assignment map. Portable for backup/migration.
- `import.fromJson(file)` → import via open dialog (merge or replace); **re-creates category memberships** so re-import preserves all `document_categories` assignments.
- Menu bar: **File → Export → JSON…** (alongside **File → Export → BibTeX…** from Task 24).
- Round-trip must preserve all metadata + category memberships.

## Steps
1. `src/main/services/export.ts` — `toJson()` (serialize documents + categories + document_categories) + `fromJson(json)` (merge/replace, recreate memberships).
2. Wire `export.toJson` + `import.fromJson` IPC handlers (replace Task 07 stubs).
3. Menu bar File → Export → JSON… + File → Import… (open dialog).
4. Handle import conflicts (merge vs replace) per a clear policy (document by id; on id clash, replace or skip with a confirm).

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- JSON export → re-import preserves all metadata + `document_categories` memberships (round-trip test).
- File → Export → JSON… writes a file via save dialog; import reads via open dialog.

## Phase 6 DoD (this task owns)
- [ ] JSON export → re-import preserves all metadata + `document_categories` memberships.
