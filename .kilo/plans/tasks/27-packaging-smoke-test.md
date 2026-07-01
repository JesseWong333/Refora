# Task 27 — Packaging & smoke test

**Phase:** 6 (Settings, polish, edge cases) · **Prerequisites:** all above · **Master plan:** §2 (Packaging), §6 (Phase 6 DoD), §10 (Build)

## Goal
Produce a macOS `.app` via electron-builder with `asarUnpack: ["**/*.node"]`, ad-hoc sign it so it launches under Gatekeeper on Apple Silicon, and smoke-test the **packaged** app (not just `npm run dev`).

## Spec (master plan §2, §10)
- `npm run package` = `electron-vite build && electron-builder --mac` → macOS `.app` with `asarUnpack: ["**/*.node"]` (so better-sqlite3's native `.node` loads from disk — asar can't dlopen).
- **Ad-hoc sign:** `codesign --force --deep -s -` so it launches under Gatekeeper on the build machine / after clearing quarantine. (Real Developer ID + notarization deferred to post-v1 per §11.)
- **Smoke test the packaged `.app`:**
  - better-sqlite3 loads (no asar dlopen error).
  - DB created in `userData` on first launch.
  - `PRAGMA foreign_keys = ON` active.
- Final gate: `npm run typecheck && npm run lint && npm run test` pass; `npm run package` succeeds.

## Steps
1. Confirm `electron-builder.yml` has mac target + `asarUnpack: ["**/*.node"]` (Task 01).
2. Run `npm run package`.
3. Ad-hoc sign the `.app`: `codesign --force --deep -s - "<path>.app"`.
4. Launch the packaged `.app` and run the smoke checks above (better-sqlite3 loads, DB created, `foreign_keys=ON`).
5. Re-run the full validation gate (master plan §10): typecheck + lint + test pass.

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- `npm run package` produces an ad-hoc-signed `.app`.
- Smoke test confirms: better-sqlite3 loads (no asar dlopen error), DB created in `userData` on first launch, `PRAGMA foreign_keys=ON` active, better-sqlite3 loads from the unpacked `.node` (not from inside asar).

## Phase 6 DoD (this task owns)
- [ ] `npm run package` produces an ad-hoc-signed `.app`; smoke test confirms better-sqlite3 loads, DB created, `PRAGMA foreign_keys=ON` active.

## Final cross-cutting validation (master plan §10) — confirm before declaring v1 done
- **Unit:** repositories CRUD + FTS sync; dedup (sha256 + NULL→path-only; streaming no whole-file buffer); DOI regex + disambiguation; metadata fallback mapping; metadata refresh merge (`editedFields` + `remoteValues` conflict); retry cap (3 fails → failed, no auto-reenqueue; manual retry resets); move collision naming; FK cascade; `documents.update` patch whitelist; `Result<T>` envelope (never reject; preload unwraps to `IpcError`); BibTeX citekey + field mapping + escaping + suffixing; FTS trigram + <3-char LIKE fallback; `documents_au` no reindex on `starred`/`lastReadAt` toggle.
- **Integration:** import pipeline end-to-end (sample PDFs with/without DOI); off-main worker bulk-import 50 PDFs keeps UI responsive; watch add-only; drag-to-category move + path update + FTS still searchable; DnD dual-source; JSON export→re-import preserves memberships; metadata job resume (kill mid-import, relaunch, `pending`/`failed<3` re-enqueue; 3×-failed not auto-retried).
- **Build:** `npm run package` → macOS `.app` with `asarUnpack` + ad-hoc signed; DB created in `userData`; `PRAGMA foreign_keys=ON`; better-sqlite3 loads from unpacked `.node`.
