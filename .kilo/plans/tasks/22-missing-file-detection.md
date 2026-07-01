# Task 22 — Missing-file detection + relocate

**Phase:** 6 (Settings, polish, edge cases) · **Prerequisites:** 06, 07 · **Master plan:** §7 (Missing source file), §6 (Detail panel relocate), §3 (files.ts)

## Goal
Detect missing source PDFs (batch check on start + periodic background rescan), cache the `fileMissing` flag, and implement the relocate flow. Wire the `documents.relocateFile` IPC handler used by the detail panel (Task 12).

## Spec (master plan §7, §6)
- **Batch check** all `documents.filePath` on app start (progressive, non-blocking) → `fs.existsSync` → cache `fileMissing` (1/0).
- **Periodic background rescan** every 5 min (configurable).
- Open disabled when `fileMissing=1` (PDF icon disabled — Task 11b); "Relocate" offered.
- **Relocate flow:** native dir/file picker → `documents.relocateFile(id, newPath)` → update `filePath` + clear `fileMissing` badge + re-enable PDF icon.
- `src/main/services/files.ts`: existence checks + relocate (hashing lives in the worker; relocate may re-hash to keep dedup consistent but is not required).

## Steps
1. `src/main/services/files.ts` — `checkMissing()` (batch existsSync, progressive), `relocate(id, newPath)`.
2. Wire `documents.relocateFile` IPC handler (replace Task 07/12 stub).
3. Run `checkMissing()` on startup (step 8) + schedule 5-min interval.
4. Cache `fileMissing` on documents; UI consumes it (Task 11b badge).

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- Missing-file batch check on start + 5-min background rescan; `fileMissing` flag cached.
- Relocate: pick a new path → `filePath` updated, `fileMissing` cleared, badge gone, PDF icon re-enabled.

## Phase 6 DoD (this task owns)
- [ ] Missing-file batch check on start + 5-min background rescan; `fileMissing` cached; relocate clears badge.
