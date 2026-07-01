# Task 16 — Document CRUD E2E Test

**Phase:** 4 (Integration & E2E) · **Prerequisites:** 14 · **Master plan:** Phase 4, Task 4.3

## Goal
Create `tests/e2e/document-crud.spec.ts` verifying the full document CRUD lifecycle end-to-end.

## Pre-requisite
Task 14 complete.

## Test Cases

1. **Create → List → Read** — Seed 1 document (via import as in Task 15).
   - `documents.list({ mode: 'all' })` returns 1 doc.
   - `documents.get(id)` returns the same doc with all fields populated.

2. **Update title** — `documents.update(id, { title: 'Updated Title' })`.
   - Returns `{ ok: true, data: Document }` with `title: 'Updated Title'`.
   - `editedFields` now includes `'title'`.
   - Re-fetch via `documents.get(id)` → title is updated.

3. **Update forbidden field** — `documents.update(id, { filePath: '/hacked' })`.
   - Returns `{ ok: false, error: { code: 'forbidden_field' } }`.

4. **Set star** — `documents.setStarred(id, 1)`.
   - Returns `{ ok: true }`.
   - Doc has `starred: 1` on re-fetch.

5. **Delete with confirm** — `documents.delete(id)`.
   - Returns `{ ok: true }`.
   - `documents.list({ mode: 'all' })` returns 0 docs.
   - `documents.get(id)` returns `{ ok: false, error: { code: 'not_found' } }`.

6. **Bulk delete** — Seed 3 documents.
   - `documents.bulkDelete([id1, id2, id3])` succeeds.
   - List returns 0 docs.

7. **Categories CRUD round-trip** — Create a category, assign a doc, unassign.
   - `categories.create('Test', true)` → returns Category with id.
   - `categories.list()` includes it.
   - `categories.assign(docId, catId)` → succeeds.
   - `categories.unassign(docId, catId)` → succeeds.
   - `categories.delete(catId)` → succeeds, not in list.

## E2E strategy
Same as Task 15 — `page.evaluate()` to call IPC directly. UI interaction (click buttons, fill forms) is lower priority than verifying the IPC layer works.

## Files to create
- `tests/e2e/document-crud.spec.ts`

## Verification
- `npm run build` succeeds.
- `npx playwright test --project=electron tests/e2e/document-crud.spec.ts` passes.
