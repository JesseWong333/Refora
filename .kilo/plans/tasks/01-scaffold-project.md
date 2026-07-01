# Task 01 — Scaffold project

**Phase:** 0 (Scaffold) · **Prerequisites:** none · **Master plan:** §8, §2

## Goal
Initialize the electron-vite React+TS project, install all dependencies, configure build/test/lint toolchain, tsconfig project references, the shared IPC types, and the verification rule in `AGENTS.md`. Establish the test infra and prove it works.

## Steps

1. **Init repo.** Use `npm create @quick-start/electron` (electron-vite, React+TS) — or scaffold manually to match the structure in `00-INDEX.md §2`.
2. **Install runtime deps:** `better-sqlite3@^11`, `chokidar`, `pdfjs-dist@^4`, `zustand`, `tailwindcss`, `@tanstack/react-virtual`, `uuid`, `react-i18next`, `i18next`, `electron-log`.
3. **Install dev deps:** `@electron/rebuild`, `electron-builder`, `vitest`, `jsdom`, `@types/node`, `eslint`, `typescript`, plus postcss/autoprefixer for Tailwind.
4. **`package.json` scripts:** use exactly the scripts in `00-INDEX.md §1`. Add `"postinstall": "electron-rebuild -f -w better-sqlite3"`.
5. **`electron-builder.yml`:** mac target + dmg; **`asarUnpack: ["**/*.node"]`** (critical — better-sqlite3 native binary can't dlopen from inside asar).
6. **tsconfig project references:** `tsconfig.json` (solution-style refs) → `tsconfig.main.json`, `tsconfig.preload.json`, `tsconfig.renderer.json`, `tsconfig.shared.json`. `src/shared/` has no electron deps and is importable by all three contexts.
7. **Create `src/shared/ipc-types.ts`** with the types in `00-INDEX.md §3` (`Result<T>`, `ListMode`, `ListFilter`, `SortField`, `EditableField`, `DocumentPatch`, `SearchResult`). Define a `Document` DTO matching the `documents` table columns (master plan §4) plus `categories?: Category[]`. (Full DB schema arrives in Task 05; here define the TS shapes only.)
8. **`vitest.config.ts`:** env `jsdom` for renderer utils; include `tests/unit/**` + `src/**/*.test.ts`. Configure so `tsc -b` (typecheck) **excludes test files** (shared tsconfig) — `tsc -b` must stay clean even with no `src/` code.
9. **`eslint.config.js`** flat config; lint main + preload + renderer + shared.
10. **`AGENTS.md`:** write the verification rule — after any code change run `npm run typecheck && npm run lint && npm run test`; smoke with `npm run dev`; build with `npm run package`. Include the doc-navigation note (master plan §0) and the macOS-only note.
11. **Create `tests/unit/` reference specs** so the pipeline is proven: write three self-contained unit tests that pass with **zero `src/` implementation** (e.g. a pure-function util test, a `Result<T>` shape test, an ipc-types compile test). These are the reference implementations referenced by later tasks (patch-whitelist, metadata-merge, bibtex) which will replace their stub imports later.

## Verification
- `npm install` succeeds with no native-rebuild errors; `postinstall` runs `@electron/rebuild` for better-sqlite3.
- `npm run typecheck && npm run lint` pass on the empty-ish scaffold.
- `npm run test` passes the three `tests/unit/*.test.ts` specs with zero `src/` code present.
- `src/shared/ipc-types.ts` exists with `Result<T>`, `ListFilter`, `DocumentPatch`, `EditableField`.
- `AGENTS.md` documents the verification gate.

## Phase 0 DoD (this task owns)
- [ ] `npm install` succeeds; `postinstall` rebuilds better-sqlite3.
- [ ] `npm run typecheck && npm run lint` pass on the scaffold.
- [ ] `npm run test` passes the three self-contained specs — proving the vitest/jsdom pipeline works.
- [ ] `src/shared/ipc-types.ts` exists with `Result<T>`, `ListFilter`, `DocumentPatch`, `EditableField`.
