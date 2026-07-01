# Task 07 — Metadata Service Test

**Phase:** 1 (Service Unit Tests) · **Prerequisites:** 01 · **Master plan:** Phase 1, Task 1.6

## Goal
Create `tests/unit/metadata-service.test.ts` covering queue behavior, rate limiting, startup resume, and retry logic from `src/main/services/metadata.ts`.

**Note:** The existing `tests/unit/metadata-merge.test.ts` (26 tests) covers `mergeMetadata`, `extractDoiFromText`, `normalizeAuthors` — pure functions. This new test covers the **service orchestration** layer: queue, rate limit, resume, bulk refresh.

## Spec

The metadata service manages a rate-limited queue for fetching metadata from Crossref/arXiv:
- `enqueueMetadataJob(docId)` — adds doc to processing queue.
- `refreshMetadata(docId)` — resets attempts + re-enqueues.
- `bulkRefreshMetadata(docIds)` — refreshes multiple docs.
- `resumeOnStartup()` — re-enqueues pending + failed<3 docs.
- Rate limits: ≥1s between Crossref requests, ≥3s between arXiv requests.
- Max 3 concurrent workers.

## Test Cases

### Queue behavior

1. **Single enqueue** — `enqueueMetadataJob(docId)` adds to queue.
   - After ≥1s delay, processing starts (mock `fetch` to return Crossref JSON).
   - Document metadata fields updated in DB (title, authors, year, venue, abstract).
   - `metadataStatus` set to `'success'`. `metadataSource` set to `'crossref'`.

2. **Fallback to arXiv** — Crossref returns 404, but text contains arXiv ID.
   - Falls back to arXiv fetch (≥3s rate limit gate).
   - `metadataStatus='success'`, `metadataSource='arxiv'`.

3. **No metadata found** — Both Crossref and arXiv fail.
   - `metadataStatus='not_found'`. `metadataAttempts` incremented.

4. **Network timeout** — `fetch` takes >8s (mock `AbortController`).
   - Job fails. `metadataStatus='error'`.

### Rate limiting

5. **Crossref rate gate** — Two jobs enqueued rapidly.
   - First processed after ≥1s. Second starts ≥1s after first completes.

6. **arXiv rate gate** — Two arXiv jobs.
   - ≥3s gap between them.

7. **Concurrent limit** — Enqueue 5 jobs.
   - At most 3 processed concurrently. Remaining queued.

### Resume on startup

8. **Pending docs re-enqueued** — DB has docs with `metadataStatus='pending'`.
   - `resumeOnStartup()` re-enqueues them all.

9. **Failed <3 attempts re-enqueued** — Doc has `metadataStatus='error'`, `metadataAttempts=2`.
   - Re-enqueued.

10. **Failed ≥3 attempts NOT re-enqueued** — Doc has `metadataStatus='error'`, `metadataAttempts=3`.
    - NOT re-enqueued. Stays in `'error'` state.

### Manual refresh

11. **refreshMetadata** — `refreshMetadata(docId)` on a failed doc.
    - Resets `metadataAttempts=0` and `metadataStatus='pending'`.
    - Enqueues for processing.

12. **bulkRefreshMetadata** — `bulkRefreshMetadata([id1, id2, id3])`.
    - Calls `refreshMetadata` for each ID.
    - All 3 queued.

## Mock scope
- `fetch` — mock the global fetch / Electron `net.fetch` to return controlled JSON responses.
- DB repos — fake document repo with `getResumableMetadataRows`, `setMetadataStatus`, `incrementMetadataAttempts`, `applyMetadataFields`.
- Timer — use `vi.useFakeTimers()` to control rate-limit delays.
- `electron-log` — via `tests/mocks/electron-log.ts`.

## Files to create
- `tests/unit/metadata-service.test.ts`

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- 12+ test cases, all passing.
- Existing `tests/unit/metadata-merge.test.ts` (26 tests) still passes.
