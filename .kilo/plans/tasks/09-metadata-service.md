# Task 09 — Metadata service

**Phase:** 2 (Import & metadata) · **Prerequisites:** 08 · **Master plan:** §3 (Import pipeline §4c, Metadata retry policy), §5 (Metadata Refresh), §7 (DOI/network failure, Concurrency & rate limiting)

## Goal
Implement DOI disambiguation, Crossref/arXiv lookup over Electron `net`, the rate-limited job queue, the `editedFields`/`remoteValues` merge logic, metadata status/attempts tracking, and startup resume.

## Spec — metadata job (per document, master plan §3 §4c)
a. **Parse** (runs on pdf-worker, from Task 08): info dict + first-N-pages text. Prefill `title`/`keywords`; `authors` normalized to `;`-separated `Family, Given` entries (Crossref/arXiv supply structured names; offline info-dict strings split heuristically, best-effort formatted, single entry when ambiguous). Filename heuristic fallback for title.
b. **DOI disambiguation** (avoid grabbing a cited reference's DOI). Preference order:
   1. PDF info-dict `/doi` field.
   2. A DOI in the first 2 pages that is **not** after a "References"/"参考文献" heading.
   3. Among remaining regex matches (`/10\.\d{4,9}\/[-._;()\/:A-Za-z0-9+]+/g`, case-insensitive), the one closest to the top of the document.
   - Ignore matches inside reference sections. arXiv ID extracted similarly from the first 2 pages.
c. If DOI found → Crossref lookup → fill title/authors/year/venue/volume/abstract/url/doi (`metadataSource='crossref'`); store fetched values in `remoteValues`. Else if arXiv ID → arXiv API (`metadataSource='arxiv'`). Else keep offline values (`metadataSource='pdf'`).
d. On success: `metadataStatus='done'`, `metadataAttempts` unchanged. On exception/timeout: `metadataStatus='failed'`, `metadataAttempts += 1`. Never block import.

## Spec — network (master plan §3, §7)
- Crossref `https://api.crossref.org/works/{doi}`; arXiv `http://export.arxiv.org/api/query`. Use Electron `net` (not raw `fetch`) so requests honor the configured proxy (proxy applied to `defaultSession` via `session.setProxy` on startup + whenever `settings.proxyUrl` changes; empty string = direct). Crossref requests include a `User-Agent` header. (`net` only usable after `app.whenReady()`.)
- **Timeout 8s per request.** On failure: keep offline/blank values; `metadataSource='pdf'|'manual'`; `metadataStatus='failed'` (resumable). Import never fails.

## Spec — rate-limited queue (master plan §7)
- Up to 3 concurrent workers, behind a **global minimum-interval gate** (not per-worker): ≥1s between Crossref requests, ≥3s between arXiv requests (arXiv asks ≤1 req/3s). The gate is shared across workers so effective rate = the floor.
- **Batch cap:** a single bulk "refresh metadata" action queues at most 50 docs; if more selected, confirm "This will enqueue N jobs (rate-limited). Continue?" — user may still proceed (cap is a UX guard, not a hard limit).
- PDF parse/hash work is off-main (worker) and not rate-limited.

## Spec — merge logic (`mergeMetadata`, master plan §3 §5)
Refresh re-runs the job and merges using per-field provenance:
- Fields currently **empty or NULL** → filled from the fresh fetch.
- Fields listed in `editedFields` (user-edited) → **never overwritten**, even if fetch returns a value, *unless* the user explicitly cleared the field first (clearing removes it from `editedFields`).
- Fields non-empty but NOT in `editedFields` (previous auto-fetch, untouched) → updated to the new fetched value.
- The fetched values are **always** written to `remoteValues` (regardless of merge outcome) so the conflict indicator stays current.
- (Editing via `documents.update` adds the field to `editedFields`; clearing removes it — Task 06/07.)

## Spec — retry policy & resume (master plan §3 Metadata retry policy)
- On startup, re-enqueue rows where `metadataStatus='pending'` (interrupted) **OR** (`metadataStatus='failed'` **AND** `metadataAttempts < 3`).
- Rows with `metadataAttempts >= 3` stay `'failed'` and are **not** auto-retried — surface a per-row "retry" affordance (`documents.refreshMetadata(id)` resets `metadataAttempts=0` and re-enqueues).
- `documents.refreshMetadata(id)` and `documents.bulkRefreshMetadata(ids)` (bulk respects the 50-doc confirm cap).

## Steps
1. `src/main/services/metadata.ts`:
   - `mergeMetadata(current, fetched, editedFields)` pure function (unit-testable).
   - DOI/arXiv extraction + disambiguation (pure functions, unit-testable).
   - Crossref/arXiv fetch via `net` with timeout + `User-Agent`.
   - Rate-limited queue (global gate, 3 workers).
   - `enqueueMetadataJob(docId)`, `refreshMetadata(docId)`, `bulkRefreshMetadata(ids)`, `resumeOnStartup()`.
   - Persist `remoteValues`, set `metadataStatus`/`metadataAttempts`; emit `document:updated` on completion.
2. Wire `documents.refreshMetadata` + `documents.bulkRefreshMetadata` IPC handlers (replace Task 07 stubs).
3. Wire startup resume into the startup sequence (`src/main/index.ts` step 8).

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- `metadata-merge.test.ts` passes against the **real** `mergeMetadata` (replace Task 01 stub): empty-fill, `editedFields`-skip, cleared-field-refill, `remoteValues` always written, conflict detection.
- DOI disambiguation unit tests: info-dict `/doi` wins; a DOI inside a References section is NOT picked; topmost match wins otherwise; regex handles lowercase + `+` cases.
- Rate-limited queue: ≥1s Crossref / ≥3s arXiv, 3 workers, 8s timeout; 50-doc batch confirm dialog.
- Startup resume: `pending` and `failed`-with-`metadataAttempts<3` re-enqueue; `>=3` stays failed with manual-retry affordance (resets `metadataAttempts=0`).
- Integration: kill app mid-import, relaunch → `pending`/`failed<3` rows re-enqueue and complete; a 3×-failed row is NOT auto-retried.

## Phase 2 DoD (this task owns)
- [ ] `metadata-merge.test.ts` passes against real `mergeMetadata`.
- [ ] DOI disambiguation: info-dict `/doi` wins; References-section DOI NOT picked; ordering honored.
- [ ] Rate-limited queue: ≥1s Crossref / ≥3s arXiv, 3 workers, 8s timeout; 50-doc batch confirm.
- [ ] Startup resume: `pending` + `failed<3` re-enqueue; `>=3` stays failed with manual-retry (resets `metadataAttempts=0`).
