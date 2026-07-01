# Task 18 — Code Review Audit (Fire-and-Forget)

**Phase:** 6 (Code Review) · **Prerequisites:** all above tasks complete · **Master plan:** Phase 6

## Goal
Run a systematic audit of all 10 renderer components and 8 services against a quality checklist. Report findings. Do NOT refactor code in this phase — produce a report only.

## Scope

### Renderer components (10 files)
- `TopBar.tsx`, `DocumentList.tsx`, `DetailPanel.tsx`, `Sidebar.tsx`, `SettingsModal.tsx`, `FirstRunWizard.tsx`, `CategoryDialog.tsx`, `ConfirmDialog.tsx`, `WatchFoldersSettings.tsx`, `Splash.tsx`

### Main services (8 files)
- `importer.ts`, `watcher.ts`, `library.ts`, `files.ts`, `pdfOpen.ts`, `metadata.ts`, `export.ts`, `logger.ts`

### Also review
- `src/main/index.ts` (318 lines)
- `src/preload/index.ts`
- `src/renderer/store/documentStore.ts`

## Audit Checklist (apply to each file)

1. **Error boundaries** — Are async operations wrapped in try/catch? Are errors surfaced to the user (toast/error state) rather than swallowed?
2. **Loading states** — Is `isLoading`/`isSaving` handled in every component that makes async calls?
3. **Empty states** — Does every list/detail view handle the absence of data without crashing?
4. **IPC error handling** — Are all `api.*` calls wrapped in try/catch with user-facing error messages?
5. **Memory leaks** — Are event subscriptions cleaned up in `destroy()`/`useEffect` cleanup? Are `setInterval`/`setTimeout` cleared?
6. **Type safety** — Is `any` used where a concrete type exists? Are type assertions (`as`) used safely?
7. **i18n coverage** — Are all user-facing strings using `t()`? Any hardcoded English text?
8. **Null safety** — Does the code guard against `null`/`undefined` on props, DB results, and IPC responses?

## Deliverable

A markdown file at `tests/audit/code-review-report.md` with:
- Summary table: file → issues found per category.
- Per-file detailed findings (what's wrong + suggested fix, no code edits).
- Top 5 critical issues ranked by severity.

## Verification
- `tests/audit/code-review-report.md` exists with findings for all 10 components + 8 services.
- Report is actionable: each finding has a concrete location (file:line) and suggested fix.

## Do NOT
- Do NOT make code changes. This is read-only audit.
- Do NOT add comments to source files.
- Do NOT install new linters/formatters unless the task explicitly lists them.
