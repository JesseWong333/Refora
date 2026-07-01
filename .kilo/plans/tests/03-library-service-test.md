# Task 03 — Library Service Test

**Phase:** 1 (Service Unit Tests) · **Prerequisites:** 02 · **Master plan:** Phase 1, Task 1.2

## Goal
Create `tests/unit/library-service.test.ts` covering `resolveMovePolicy()`, `moveToLibrary()`, and `restoreToOriginal()` from `src/main/services/library.ts`.

## Spec

The library service manages moving files into a shared library folder and restoring them to original locations.

## Test Cases

### `resolveMovePolicy(categoryId: string | null, settingValue: string)`

1. **Category override ON** — `categoryId` maps to category with `moveToLibrary=1`.
   - Returns `true`.

2. **Category override OFF** — `categoryId` maps to category with `moveToLibrary=0`.
   - Returns `false`.

3. **NULL category + global ON** — `categoryId=null`, `moveToLibraryOnCategorize='1'`.
   - Returns `true`.

4. **NULL category + global OFF** — `categoryId=null`, `moveToLibraryOnCategorize='0'`.
   - Returns `false`.

### `moveToLibrary(docId: string, libraryDir: string)`

5. **Successful move** — Source file exists (`existsSync→true`), destination doesn't exist.
   - File `copyFileSync`'d to `<libraryDir>/<doc.fileName>`.
   - DB `filePath` and `fileName` updated to new library path.
   - Returns `{ ok: true, data: { newPath } }`.

6. **Collision-safe rename** — Destination filename already exists at `<libraryDir>/doc.pdf`.
   - File moved as `<libraryDir>/doc (1).pdf`.
   - DB updated with `(1)` suffixed path.

7. **Double collision** — `<libraryDir>/doc.pdf` and `<libraryDir>/doc (1).pdf` both exist.
   - File moved as `<libraryDir>/doc (2).pdf`.

8. **Source file missing** — `existsSync` returns `false` for source.
   - Returns `{ ok: false, error: { code: 'source_missing' } }`.

9. **Doc not found** — `docId` not in DB.
   - Returns `{ ok: false, error: { code: 'not_found' } }`.

### `restoreToOriginal(docId: string)`

10. **Successful restore** — Doc has `originalFolderPath` and it exists on disk.
    - File `renameSync`'d from current `filePath` to `originalFolderPath`.
    - DB `filePath` updated back to original, `fileMissing=0`.
    - Returns `{ ok: true }`.

11. **originalFolderPath is null** — Doc has no original folder.
    - Returns `{ ok: false, error: { code: 'invalid_state' } }`.

12. **originalFolderPath missing on disk** — Doc had original but directory gone.
    - Returns `{ ok: false, error: { code: 'invalid_state' } }`.

13. **Doc not found** — `docId` not in DB.
    - Returns `{ ok: false, error: { code: 'not_found' } }`.

## Mock scope
- `node:fs` — `existsSync`, `copyFileSync`, `renameSync`, `mkdirSync`.
- DB repos — fake document repo with `get`, `updateFilePath`, `setFileMissing`.
- Global settings — provide mock `settings.get` for `moveToLibraryOnCategorize`.

## Files to create
- `tests/unit/library-service.test.ts`

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- 13+ test cases, all passing.
