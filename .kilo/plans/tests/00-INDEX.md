# ScholarNote — Test Remediation Task Index

The master test plan lives at `.kilo/plans/test_plan.md`. This directory splits it into independently-executable task files.

**Conflict rule:** task files inline their spec; the master plan is authoritative on strategy/architecture decisions.

---

## 0. Global Rules (apply to EVERY task)

### Verification gate
After **every** code change, before declaring a task done:
```bash
npm run typecheck && npm run lint && npm run test
```
Test-writing tasks must also pass their own new tests.

### Do NOT modify source code
These are **test-writing tasks**. Do NOT refactor production code unless the task explicitly says so (e.g., Phase 6 code review is audit-only, no refactoring).

### Mocking conventions (carried from master plan)
- All `electron` imports → `vi.mock('electron', ...)` via shared `tests/mocks/electron.ts`.
- All `chokidar` imports → `vi.mock('chokidar', ...)` via shared `tests/mocks/chokidar.ts`.
- All `electron-log` imports → `vi.mock('electron-log', ...)` via shared `tests/mocks/electron-log.ts`.
- `better-sqlite3` cannot load under Node.js vitest. Keep existing `node:sqlite` via `createRequire` pattern for DB-layer tests.
- Component tests: inject `window.api` mock in `tests/setup.ts` `beforeEach`. Use `@testing-library/react` with `jsdom` environment.
- Do NOT import `src/main/index.ts` in tests — it registers IPC handlers on import and crashes in Node.js.

### File naming
- Unit tests → `tests/unit/<name>.test.ts`
- Component tests → `tests/component/<name>.test.tsx`
- Smoke tests → `tests/smoke/<name>.test.ts`
- Integration tests → `tests/integration/<name>.test.ts`
- E2E tests → `tests/e2e/<name>.spec.ts`

---

## 1. Execution Order & Dependencies

| # | File | Phase | Prerequisites |
|---|---|---|---|
| 01 | `01-test-infra-scaffolding.md` | 0 | — |
| 02 | `02-files-service-test.md` | 1 | 01 |
| 03 | `03-library-service-test.md` | 1 | 02 |
| 04 | `04-importer-service-test.md` | 1 | 01 |
| 05 | `05-watcher-service-test.md` | 1 | 01 |
| 06 | `06-pdfOpen-service-test.md` | 1 | 01 |
| 07 | `07-metadata-service-test.md` | 1 | 01 |
| 08 | `08-documentStore-test.md` | 2 | 01 |
| 09 | `09-topbar-component-test.md` | 2 | 08 |
| 10 | `10-documentlist-component-test.md` | 2 | 08 |
| 11 | `11-sidebar-component-test.md` | 2 | 08 |
| 12 | `12-detailpanel-component-test.md` | 2 | 08 |
| 13 | `13-db-native-smoke-test.md` | 3 | 01 |
| 14 | `14-ipc-e2e-smoke.md` | 4 | all above + electron build |
| 15 | `15-import-e2e.md` | 4 | 14 |
| 16 | `16-document-crud-e2e.md` | 4 | 14 |
| 17 | `17-coverage-ci-config.md` | 5 | 01–13 |
| 18 | `18-code-review-audit.md` | 6 | all above |

Phase boundaries are verification milestones. After the last task of a phase, re-run the gate and confirm every DoD item.

---

## 2. Phase 0 DoD (Task 01 owns)
- [ ] `npm install` succeeds (new test deps added).
- [ ] `npx vitest run` passes all existing 111 tests after config changes.
- [ ] `tests/setup.ts` exists; components can mount in jsdom.
- [ ] `tests/mocks/electron.ts`, `chokidar.ts`, `electron-log.ts` exist and are importable.
- [ ] `tests/fixtures/` contains 4 PDF files (valid, with-doi, encrypted, corrupted).

## 3. Phase 1 DoD (Tasks 02–07 own)
- [ ] `tests/unit/files-service.test.ts` — all assertions pass.
- [ ] `tests/unit/library-service.test.ts` — all assertions pass.
- [ ] `tests/unit/importer-service.test.ts` — all assertions pass.
- [ ] `tests/unit/watcher-service.test.ts` — all assertions pass.
- [ ] `tests/unit/pdfOpen-service.test.ts` — all assertions pass.
- [ ] `tests/unit/metadata-service.test.ts` — all assertions pass.

## 4. Phase 2 DoD (Tasks 08–12 own)
- [ ] `tests/unit/documentStore.test.ts` — all assertions pass.
- [ ] `tests/component/TopBar.test.tsx` — mounts without crash, key interactions tested.
- [ ] `tests/component/DocumentList.test.tsx` — mounts, renders rows, empty state.
- [ ] `tests/component/Sidebar.test.tsx` — mounts, category list rendered.
- [ ] `tests/component/DetailPanel.test.tsx` — mounts, edit/save flow tested.

## 5. Phase 3 DoD (Task 13 owns)
- [ ] `tests/smoke/db-native.test.ts` — loads real `better-sqlite3` binding, WAL mode verified.

## 6. Phase 4 DoD (Tasks 14–16 own)
- [ ] `playwright.config.ts` exists with Electron fixture.
- [ ] `tests/e2e/ipc-smoke.spec.ts` — bootstrap + settings round-trip verified.
- [ ] `tests/e2e/import.spec.ts` — import flow verified end-to-end.
- [ ] `tests/e2e/document-crud.spec.ts` — CRUD flow verified end-to-end.

## 7. Phase 5 DoD (Task 17 owns)
- [ ] `vitest.config.ts` has coverage thresholds (70/55/70).
- [ ] `.github/workflows/ci.yml` exists with full pipeline.
- [ ] `npm run test:coverage` script works.

## 8. Phase 6 DoD (Task 18 owns)
- [ ] Audit report for all 10 renderer components + 8 services published as a GitHub issue (or local markdown file).
