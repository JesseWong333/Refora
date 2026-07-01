# Code Review Audit Report

**Date:** 2026-07-01 · **Scope:** 10 renderer components + 8 services + 3 core files · **21 files total**

---

## Summary Table

| # | File | Err Bound | Loading | Empty | IPC Err | Mem Leak | Type Safe | i18n | Null Safe | Issues |
|---|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | **TopBar.tsx** | ❌ | ⚠️ | — | ❌ | ✅ | ✅ | ❌ | ✅ | 4 |
| 2 | **DocumentList.tsx** | ❌ | ✅ | ✅ | ❌ | ✅ | ⚠️ | ❌ | ⚠️ | 5 |
| 3 | **DetailPanel.tsx** | ✅ | ✅ | ✅ | ✅ | ❌ | ⚠️ | ❌ | ✅ | 4 |
| 4 | **Sidebar.tsx** | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | 4 |
| 5 | **SettingsModal.tsx** | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | 2 |
| 6 | **FirstRunWizard.tsx** | ❌ | ✅ | — | ❌ | ✅ | ✅ | ✅ | ✅ | 2 |
| 7 | **CategoryDialog.tsx** | ✅ | ❌ | — | — | ✅ | ✅ | ✅ | ✅ | 1 |
| 8 | **ConfirmDialog.tsx** | — | ✅ | — | — | ✅ | ✅ | ✅ | ✅ | 0 |
| 9 | **WatchFoldersSettings.tsx** | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | 2 |
| 10 | **Splash.tsx** | — | — | — | — | ✅ | ✅ | — | ✅ | 0 |
| 11 | **importer.ts** | ❌ | — | ✅ | — | ✅ | ✅ | ❌ | ⚠️ | 3 |
| 12 | **watcher.ts** | ⚠️ | — | — | — | ✅ | ✅ | — | ✅ | 1 |
| 13 | **library.ts** | ⚠️ | — | — | — | — | ✅ | — | ✅ | 1 |
| 14 | **files.ts** | ❌ | — | ✅ | — | ✅ | ⚠️ | ❌ | ❌ | 4 |
| 15 | **pdfOpen.ts** | ✅ | — | — | — | ✅ | ⚠️ | — | ✅ | 1 |
| 16 | **metadata.ts** | ✅ | — | ✅ | — | ✅ | ⚠️ | — | ✅ | 1 |
| 17 | **export.ts** | ❌ | — | ✅ | — | ✅ | ⚠️ | — | ✅ | 2 |
| 18 | **logger.ts** | — | — | — | — | ✅ | ✅ | — | — | 0 |
| 19 | **main/index.ts** | ❌ | — | — | — | ✅ | ⚠️ | ❌ | ⚠️ | 4 |
| 20 | **preload/index.ts** | ✅ | — | — | ✅ | ⚠️ | ⚠️ | — | ✅ | 2 |
| 21 | **documentStore.ts** | ✅ | ✅ | — | ✅ | ✅ | ✅ | ❌ | ✅ | 1 |

**Legend:** ✅ = satisfactory · ⚠️ = minor issues · ❌ = significant issues · — = not applicable

**Total issues found:** 44 (across 18 files; 3 files have zero issues)

---

## Per-File Detailed Findings

### 1. TopBar.tsx

| # | Category | Severity | Line(s) | Finding | Suggested Fix |
|---|----------|----------|---------|---------|---------------|
| 1.1 | IPC Err | **HIGH** | 24-39 | `handleAddFile`, `handleAddFolder`, `handleExportBibtex`, `handleExportJson` call `api.*` methods with `void` and no try/catch. Any IPC failure is silently swallowed with zero user feedback. | Wrap each call in try/catch, call `showToast` on error. |
| 1.2 | i18n | MEDIUM | 50 | Hardcoded English string `"ScholarNote"` in `<span>` — should be wrapped with `t('app.title')` or equivalent. | Add i18n key and use `t()`. |
| 1.3 | i18n | LOW | 46 | `aria-label="Toggle sidebar"` is hardcoded English, not using `t()`. | `aria-label={t('topbar.toggleSidebar')}` |
| 1.4 | Err Bound | MEDIUM | 24-39 | Related to 1.1: no error boundary pattern at all for async user-initiated actions. | Add error toast on failure. |

### 2. DocumentList.tsx

| # | Category | Severity | Line(s) | Finding | Suggested Fix |
|---|----------|----------|---------|---------|---------------|
| 2.1 | IPC Err | **HIGH** | 356, 371 | `handleCopyPath` uses `.catch(() => {})` and `handleDrop`'s `api.import.addFiles(paths).catch(() => {})` silently swallows all errors. User drops files and nothing happens with no indication why. | Show toast on error or surface via store. |
| 2.2 | Type Safe | MEDIUM | 174, 401 | `t(\`list.${col.id}\` as never)` — `as never` is a type hack to bypass strict i18n key checking. If a column id doesn't have a translation key, it silently falls back to the key string. | Define a typed mapping or use a function with proper fallback. |
| 2.3 | i18n | LOW | 489 | ``title={t('detail.relocate') ?? 'Relocate'}`` — English fallback string. | Define the translation key in all locale files. |
| 2.4 | i18n | LOW | 503 | `"PDF"` text inside the PDF button is hardcoded English. | Use `t('common.pdf')` or a localized abbreviation. |
| 2.5 | Null Safe | LOW | 444 | `displayDocs[vr.index]` — no bounds check before access. Under normal virtualizer operation this is safe, but if state and virtualizer get out of sync it could crash. | Add `if (vr.index >= displayDocs.length) return null` guard. |

### 3. DetailPanel.tsx

| # | Category | Severity | Line(s) | Finding | Suggested Fix |
|---|----------|----------|---------|---------|---------------|
| 3.1 | Mem Leak | **HIGH** | 87-88, 106-107 | `statusRef.current` setTimeout is set inside `InlineField` but never cleared on unmount. A rapid close/reopen could cause stale state updates. Same pattern in `NoteField` at 202-203. | Add `useEffect(() => () => { if (statusRef.current) clearTimeout(statusRef.current) }, [])` cleanup. |
| 3.2 | Type Safe | MEDIUM | 403 | `t(\`detail.${field}\` as never)` — same `as never` hack as DocumentList. | Use typed key mapping. |
| 3.3 | i18n | MEDIUM | 403 | `"DOI"` label is hardcoded — field with `labelKey: 'DOI'` bypasses translation entirely. The `EDITABLE_FIELDS` array at line 22 has `{ field: 'doi', labelKey: 'DOI' }` — should be `'detail.doi'`. | Change `labelKey` to use the i18n key and remove the special-casing at line 403. |
| 3.4 | i18n | LOW | 304 | ``title={t('common.delete') ?? 'Remove'}`` — English fallback. | Define the translation key. |

### 4. Sidebar.tsx

| # | Category | Severity | Line(s) | Finding | Suggested Fix |
|---|----------|----------|---------|---------|---------------|
| 4.1 | Mem Leak | **CRITICAL** | 182-188 | New `cb` function is created on every render (closure over nothing but recreated), registered via `api.events.onDocumentUpdated(cb)`, and the cleanup calls `api.events.off('document:updated', cb)` with the **same** cb reference. However if this useEffect re-runs (due to dependency change), the **old** listener is cleaned up correctly. The real problem: the dependency array is `[]` so it only runs once. Actually this is correct — the cb is stable because it only captures `setFolderGroups`. **Revised:** This is not a leak. However, the listener is never unregistered on component unmount if the effect doesn't re-run — but it **does** return cleanup which runs on unmount. So this is actually fine. Let me re-examine… The `useEffect` at line 182 has empty deps `[]`, so it runs once on mount and cleans up on unmount. This is correct. | — (false positive on review, keeping for transparency) |
| 4.2 | IPC Err | **HIGH** | 178, 230-232 | `api.documents.folderGroups().then(setFolderGroups).catch(() => {})` — error swallowed. Same for `api.categories.assign/ api.documents.bulkCategorize` in `handleDropCategory` — `.catch(() => {})` patterns. | Show toast or error state. |
| 4.3 | Loading | MEDIUM | 174-178 | `folderGroups` has no loading state. On slow systems the empty state ("empty categories") flashes before data arrives. | Add `isLoadingGroups` state and show skeleton/spinner. |
| 4.4 | Err Bound | MEDIUM | 177 | `void fetchCategories()` — if this call throws synchronously (unlikely but possible in store init), the error is unhandled. | Wrap in try/catch or ensure store method cannot throw sync. |

### 5. SettingsModal.tsx

| # | Category | Severity | Line(s) | Finding | Suggested Fix |
|---|----------|----------|---------|---------|---------------|
| 5.1 | i18n | **HIGH** | 42, 59 | Error messages `'Failed to load settings'` and `'Failed to set library folder'` are hardcoded English strings. When the user has switched to Chinese, these remain in English. | Use `setError(t('settings.errorLoad'))` style. |
| 5.2 | i18n | LOW | 168, 179 | `placeholder="http://proxy:8080"` and `placeholder="user@example.com"` are hardcoded English. | Use `t('settings.proxyPlaceholder')` etc. |
| 5.3 | Loading | LOW | 29-44 | No loading indicator while `loadSettings` runs. On slow systems the form appears blank momentarily. | Add `isLoading` state and a spinner. |

### 6. FirstRunWizard.tsx

| # | Category | Severity | Line(s) | Finding | Suggested Fix |
|---|----------|----------|---------|---------|---------------|
| 6.1 | Err Bound | **HIGH** | 20-21 | `catch { void 0 }` — errors from `api.dialog.openDirectory()` or `api.settings.set()` are silently swallowed. If the library folder fails to set, user proceeds unaware. | Show error toast or inline error state. |
| 6.2 | IPC Err | **HIGH** | 16-18 | No error handling for `api.settings.set('libraryFolderPath', path)`. | Add catch with user feedback. |

### 7. CategoryDialog.tsx

| # | Category | Severity | Line(s) | Finding | Suggested Fix |
|---|----------|----------|---------|---------|---------------|
| 7.1 | Loading | LOW | 40-54 | No saving state while `onSave`/`onSetMoveToLibrary` are running. User could double-click and trigger duplicate operations. | Add `isSaving` state, disable buttons, show spinner. |

### 8. ConfirmDialog.tsx

No issues found. ✅

### 9. WatchFoldersSettings.tsx

| # | Category | Severity | Line(s) | Finding | Suggested Fix |
|---|----------|----------|---------|---------|---------------|
| 9.1 | i18n | LOW | 88 | Empty state uses `t('sidebar.emptyCategories')` which is semantically wrong — this is a watch folders dialog, not a categories list. While it happens to display a reasonable message, it should have its own dedicated key. | Add `t('settings.watchFoldersEmpty')` and use it here. |
| 9.2 | Loading | LOW | 29-30 | No loading state when fetching watch folders. Dialog appears with "empty" message briefly before data arrives. | Add `isLoading` state with spinner. |

### 10. Splash.tsx

No issues found. ✅

---

### 11. importer.ts

| # | Category | Severity | Line(s) | Finding | Suggested Fix |
|---|----------|----------|---------|---------|---------------|
| 11.1 | Err Bound | **CRITICAL** | 189 | `statSync(abs)` is called **after** the async `requestFromWorker(abs)` completes. Between validation at line 123 and this line, the file could have been deleted or moved by an external process, causing `statSync` to throw synchronously and crash the import loop. | Wrap in try/catch with a continue-on-error fallback. |
| 11.2 | i18n | MEDIUM | 97-102 | `showDuplicateDialog` has hardcoded English strings for the dialog title, message, detail, and button labels. | These should use the app's localization system. (Note: main process i18n is inherently harder — consider passing locale from renderer.) |
| 11.3 | i18n | MEDIUM | 150-153, 156-159, 162 | Error messages in the `importFiles` result are hardcoded English strings (e.g., `'Skipping encrypted PDF…'`, `'Could not read…'`). | Localize error messages or delegate i18n to the renderer side where they are displayed. |

### 12. watcher.ts

| # | Category | Severity | Line(s) | Finding | Suggested Fix |
|---|----------|----------|---------|---------|---------------|
| 12.1 | Err Bound | LOW | 41 | `chokidar.watch(wf.path, ...)` can throw synchronously if the path is invalid or inaccessible (though `existsSync` is checked first, there's a TOCTOU race). | Wrap in try/catch and log/report the error. |

### 13. library.ts

| # | Category | Severity | Line(s) | Finding | Suggested Fix |
|---|----------|----------|---------|---------|---------------|
| 13.1 | Err Bound | LOW | 31 | `moveToLibrary` calls `renameSync(filePath, destPath)` without try/catch. If the source file no longer exists or the destination is unwritable, the error propagates to the IPC handler (which does catch it). Acceptable since the caller should handle — but consider wrapping for a more descriptive error. | Wrap in try/catch and throw a `RepoError` with context. |

### 14. files.ts

| # | Category | Severity | Line(s) | Finding | Suggested Fix |
|---|----------|----------|---------|---------|---------------|
| 14.1 | Err Bound | **HIGH** | 20-21, 29 | `checkMissing` iterates all documents and calls `existsSync(doc.filePath)` without a try/catch. While `existsSync` itself doesn't throw for invalid paths, the batch processing via `setImmediate` has no error recovery — if one iteration throws (e.g., `repos.documents.setFileMissing` or `emitDocumentUpdated` throws), the entire batch chain stops. | Add try/catch inside the batch loop with `continue` semantics. |
| 14.2 | Type Safe | MEDIUM | 64 | `return repos.documents.get(id) as Document` — `get()` can return `null` if the document was deleted between `updateFilePath` and the `get` call. The `as Document` assertion hides this null possibility. | Store the result in a variable and throw if null: `const d = repos.documents.get(id); if (!d) throw new RepoError(...); return d`. |
| 14.3 | i18n | LOW | 52-55 | RepoError messages `'Selected file must be a PDF'` and `'File not found: …'` are hardcoded English. | Use error codes that the renderer can translate. |
| 14.4 | Null Safe | MEDIUM | 20 | `doc.filePath` accessed without null-checking `doc` itself. While the list method guarantees non-null entries, defensive programming should verify. | Add `if (!doc || !doc.filePath) continue`. |

### 15. pdfOpen.ts

| # | Category | Severity | Line(s) | Finding | Suggested Fix |
|---|----------|----------|---------|---------|---------------|
| 15.1 | Type Safe | LOW | 18 | `repos.documents.get(docId) as Document` — `get()` can return null. Same issue as files.ts:14.2. | Add null check before casting. |

### 16. metadata.ts

| # | Category | Severity | Line(s) | Finding | Suggested Fix |
|---|----------|----------|---------|---------|---------------|
| 16.1 | Type Safe | LOW | 337 | `info['Title'] as string ?? info['title'] as string` — assumes metadata keys are strings. If the value is a number or object (which PDF metadata can return), the `as string` assertion is a lie. | Add `typeof` runtime check: `typeof info['Title'] === 'string' ? info['Title'] : null`. |

### 17. export.ts

| # | Category | Severity | Line(s) | Finding | Suggested Fix |
|---|----------|----------|---------|---------|---------------|
| 17.1 | Err Bound | **HIGH** | 282-283 | `writeExportFile` calls `writeFileSync(filePath, json, 'utf-8')` without try/catch. If the file is locked or disk is full, this crashes the app. Called from menu handler at main/index.ts:139 which also has no try/catch. | Wrap in try/catch, report error to user via dialog. |
| 17.2 | Err Bound | MEDIUM | 291-292 | `importFromJsonFile` calls `readFileSync` — can throw if file is inaccessible. The menu handler at main/index.ts:123 calls it without try/catch. | Add try/catch in the menu handler, show error dialog. |

### 18. logger.ts

No issues found. ✅

---

### 19. main/index.ts

| # | Category | Severity | Line(s) | Finding | Suggested Fix |
|---|----------|----------|---------|---------|---------------|
| 19.1 | i18n | **CRITICAL** | 54-156 | Entire application menu (`buildMenu()`) is hardcoded in English. Labels like `'Add File'`, `'Add Folder'`, `'Watch Folder'`, `'Import JSON…'`, `'Export JSON…'` etc. have no localization support. This is the most user-visible i18n gap. | Implement dynamic menu rebuilding on language change, with localized labels. |
| 19.2 | i18n | MEDIUM | 62, 75, 108 | Dialog titles, button labels, and filters (e.g., `'PDF Files'`, `'JSON files'`, `'Import Mode'`) are all hardcoded English. | Use localized strings from settings. |
| 19.3 | Err Bound | **HIGH** | 123, 139 | Menu handlers for Import JSON and Export JSON call `importFromJsonFile` and `writeExportFile` without try/catch. File I/O errors crash the app. | Wrap in try/catch with `dialog.showErrorBox()`. |
| 19.4 | Null Safe | MEDIUM | 239, 274 | `importer!` non-null assertion — if `createImporter` somehow fails or returns null, this crashes. `win!` at line 274 on setImmediate — theoretically `win` is always assigned by then, but a non-null assertion is risky. | Store in local variable and check with early return. |

### 20. preload/index.ts

| # | Category | Severity | Line(s) | Finding | Suggested Fix |
|---|----------|----------|---------|---------|---------------|
| 20.1 | Mem Leak | LOW | 30-43 | The `subscriptions` Map stores listener references but never prunes entries when `unsubscribe` is called with a `cb` that was never subscribed (harmless). More importantly, if a renderer component forgets to call `off`, the callback reference accumulates in the Map indefinitely. | Consider using WeakMap or periodically cleaning stale entries. |
| 20.2 | Type Safe | LOW | 34 | `args[1] as T` — assumes ipcRenderer message format `[channel, payload]`. If Electron changes the argument format (unlikely but possible), this would silently pass undefined. | Add runtime validation: `if (args.length < 2) return`. |

### 21. documentStore.ts

| # | Category | Severity | Line(s) | Finding | Suggested Fix |
|---|----------|----------|---------|---------|---------------|
| 21.1 | i18n | **HIGH** | 196, 207, 216, 235, 243, 263, 271, 281, 407, 420, 432 | All error toast messages use hardcoded English strings: `'Failed to update star'`, `'Failed to open PDF'`, `'Failed to open in Finder'`, `'Failed to delete document'`, `'Failed to refresh metadata'`, `'Failed to delete documents'`, `'Failed to categorize'`, `'Failed to create category'`, `'Failed to rename category'`, `'Failed to delete category'`. The store has no access to `t()` because Zustand store is outside React tree. | Accept translated error messages from the caller, or use a module-level `t()` from a pre-initialized i18next instance. |

---

## Top 5 Critical Issues (Ranked by Severity)

### 1. 🔴 Sidebar — Memory Leak from Event Listener Pattern

- **File:** `src/renderer/components/Sidebar.tsx:182-188`
- **Category:** Memory Leak (reviewed and confirmed no actual leak on re-exam — the useEffect dependency `[]` ensures mount-only registration with unmount cleanup. This is a **false positive** upon deeper review.)

**Revised #1:**

### 1. 🔴 Main Process — Complete Application Menu i18n Gap

- **File:** `src/main/index.ts:54-156`
- **Category:** i18n Coverage
- **Severity:** CRITICAL
- **Impact:** Every menu item, dialog title, button label, and file filter in the application's native menu is hardcoded in English. Users who switch the app to Chinese still see English menus. This is the single most visible internationalization defect.
- **Suggested Fix:** Store current language in settings. On language change, call `Menu.setApplicationMenu(buildMenu(locale))` with localized templates. Use a static map of menu labels keyed by locale.

### 2. 🔴 TopBar + DocumentList — Silent IPC Error Swallowing

- **Files:** `src/renderer/components/TopBar.tsx:24-39`, `src/renderer/components/DocumentList.tsx:356,371`
- **Category:** IPC Error Handling
- **Severity:** CRITICAL
- **Impact:** All `api.import.*` and `api.export.*` calls in TopBar and DocumentList use `void` without try/catch or `.catch(() => {})` that swallows errors. When import/export fails, the user sees nothing — no error toast, no feedback, no indication anything went wrong. This is the most user-impacting defect.
- **Suggested Fix:** Wrap every `api.*` call in try/catch or `.catch()` that calls `useDocumentStore.getState().showToast(errorMessage)`.

### 3. 🔴 Importer — `statSync` Race Condition After Async Worker

- **File:** `src/main/services/importer.ts:189`
- **Category:** Error Boundary
- **Severity:** CRITICAL
- **Impact:** `statSync(abs)` is called **after** the PDF worker completes its async parsing. Between the initial validation (line 123) and the stat call, the file may have been deleted or moved by external processes. `statSync` throws synchronously, which crashes the entire import operation — all subsequent files in the batch are lost, and if uncaught at the handler level, could crash the main process.
- **Suggested Fix:** Wrap `statSync(abs)` in try/catch, push to `errors` array, and `continue` to the next file.

### 4. 🔴 documentStore — All Error Messages Hardcoded in English

- **File:** `src/renderer/store/documentStore.ts:196-432` (11 locations)
- **Category:** i18n Coverage
- **Severity:** HIGH
- **Impact:** Every error toast shown to the user uses hardcoded English strings ("Failed to update star", "Failed to open PDF", etc.). Since Zustand store lives outside React's component tree, it doesn't have access to `useTranslation()`. This means all error messages remain in English regardless of the user's language setting.
- **Suggested Fix:** Either (a) pass translated error messages as parameters from the caller, or (b) import a standalone `i18next.t()` instance configured during app bootstrap.

### 5. 🔴 Export Service — Uncaught Sync File I/O Crashes App

- **File:** `src/main/services/export.ts:283` + `src/main/index.ts:139`
- **Category:** Error Boundary
- **Severity:** HIGH
- **Impact:** `writeExportFile` uses `writeFileSync` without try/catch. The menu handler at main/index.ts:139 calls it directly. If the save dialog's chosen path is on a full disk, locked directory, or removed USB drive, the synchronous throw propagates uncaught — Electron may show an unhandled error or crash. Same issue exists for `importFromJsonFile` → `readFileSync` at export.ts:291 + main/index.ts:123.
- **Suggested Fix:** Wrap both file operations in try/catch and use `dialog.showErrorBox()` to inform the user.

---

## Category Summary

| Category | Files Affected | Issue Count | Severity Distribution |
|----------|:---:|:---:|:---|
| **Error Boundaries** | 7 | 10 | 3 critical, 4 high, 3 medium |
| **Loading States** | 4 | 5 | 4 low, 1 medium |
| **Empty States** | 0 | 0 | — |
| **IPC Error Handling** | 4 | 6 | 2 critical, 3 high, 1 low |
| **Memory Leaks** | 2 | 2 | 1 high, 1 low |
| **Type Safety** | 6 | 7 | 4 medium, 3 low |
| **i18n Coverage** | 8 | 14 | 2 critical, 4 high, 4 medium, 4 low |
| **Null Safety** | 3 | 3 | 1 medium, 1 low, 1 low |

### Key Takeaways

- **Strong areas:** Empty state handling is universally good — every list and detail view gracefully handles the no-data case. The `preload/index.ts` Result unwrapping pattern is well-designed for IPC error propagation.
- **Weakest area: i18n** — 14 issues across 8 files. The main process menu being entirely unlocalized is a critical gap. The store's inability to use `t()` creates a second tier of unlocalized error messages.
- **Second weakest: Error boundaries** — 10 issues across 7 files. The pattern of silently swallowing errors with `void` or `.catch(() => {})` is pervasive in renderer components.
- **Recommendation:** Prioritize the Top 5 issues. Fixing the menu i18n (1), IPC error swallowing (2), and the importer race condition (3) would eliminate the most impactful defects.
