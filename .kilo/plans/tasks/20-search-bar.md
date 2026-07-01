# Task 20 — Search bar

**Phase:** 5 (Watch & search) · **Prerequisites:** 07, 11a · **Master plan:** §6 (Top bar — Search), §4 (Search query), §7

## Goal
SearchBar: debounced FTS5/LIKE query that replaces the list with results, with live in-place refresh on `document:updated` and Esc-to-clear.

## Spec (master plan §6 Top bar, §4)
- Placeholder "Search by title, author, keywords…". No-results state: "No documents match your search."
- **Debounced (200ms)** query → `documents.search(q)`.
- **Server decides the path** based on trimmed length: `len >= 3` → FTS5 `MATCH` (trigram); `len 1–2` → `LIKE` fallback over the same column set. (Repo logic from Task 06.)
- Results replace the list. Clear returns to the current sidebar selection. **Esc clears search.**
- **Live refresh while searching:** on a `document:updated` event, if the updated doc is in the current results, patch its row in place (preserve selection + scroll); do **NOT** auto-add newly-matching docs until the query changes (don't re-run the full query on every keystroke/edit).
- **Short CJK regression:** a 2-char Chinese term uses `LIKE`; a 3+ char term uses trigram FTS.

## Steps
1. SearchBar component (right-aligned in TopBar): input + 200ms debounce.
2. On debounce fire → `documents.search` → replace list results; Esc clears → revert to sidebar selection.
3. No-results state.
4. Subscribe to `document:updated`: if searching and the updated doc is in results, patch its row in place (preserve selection/scroll); do not auto-add new matches.

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- 200ms debounce; ≥3 chars → FTS5 MATCH; 1–2 chars → LIKE fallback (server decides); Esc clears; no-results state shows.
- Live refresh: on `document:updated`, matching rows patched in place (selection + scroll preserved); new matches NOT auto-added until query changes.
- Regression: a 2-char Chinese term uses `LIKE`; a 3+ char term uses trigram FTS.

## Phase 5 DoD (this task owns)
- [ ] SearchBar: 200ms debounce; ≥3 chars → FTS5 MATCH; 1–2 chars → LIKE fallback (server decides); Esc clears; no-results state.
- [ ] Live refresh patches matching rows in place (selection + scroll preserved); new matches not auto-added until query changes.
- [ ] Regression: 2-char Chinese → LIKE; 3+ char → trigram FTS.
