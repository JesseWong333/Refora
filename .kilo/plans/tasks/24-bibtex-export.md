# Task 24 — BibTeX export

**Phase:** 6 (Settings, polish, edge cases) · **Prerequisites:** 06, 07, 11a · **Master plan:** §3 (BibTeX export flow), §1 (scope), §6 (Top bar + list + menu), §10

## Goal
BibTeX export of selected document(s) as `.bib`: citekey generation, field mapping, value escaping, duplicate-citekey suffixing. List toolbar/context action (enabled only when ≥1 row selected) + menu bar **File → Export → BibTeX…** (disabled with no selection).

## Spec — BibTeX flow (master plan §3)
1. Renderer collects selected `documentIds` from the list and calls `export.toBibtex(ids)`.
2. Main: fetch rows by id; for each document build one BibTeX entry:
   - **Entry type:** `@article` if `venue`/`volume` present, else `@misc`.
   - **`citekey`** = first-author-lastname + year + first significant title word, sanitized and de-duplicated within the batch (append `a`, `b`, … on collisions). Falls back to `id` slug if authors/year missing.
   - **Field mapping:** `title`→`title`, `authors`→`author` (split on `;` into entries; each entry is already `Family, Given`, joined with ` and ` — BibTeX's native format), `year`→`year`, `venue`→`journal`/`booktitle`, `volume`→`volume`, `abstract`→`abstract`, `keywords`→`keywords`, `url`→`url`, `doi`→`doi`. Missing fields omitted (never emit empty fields).
   - **Escaping:** non-ASCII/`{}`/`%` in values escaped per BibTeX rules; values braced.
3. Join entries with blank lines; return the BibTeX string (or write directly to the user-chosen path via save dialog, returning the path).
4. If `ids` is empty → renderer disables the action (no-op); menu item disabled when no selection.

## Spec — UI (master plan §6)
- List toolbar "Export BibTeX" button + row/context menu action, **enabled only when ≥1 row selected**.
- Top bar Export BibTeX (master plan §6 top bar item 5) — enabled when one or more documents are selected.
- Menu bar **File → Export → BibTeX…** (alongside File → Export → JSON… from Task 23).
- Save dialog `*.bib`.

## Steps
1. `src/main/services/export.ts` — `toBibtex(ids)` with pure helper functions: `buildCitekey(doc, usedKeys)`, `mapFields(doc)`, `escapeValue(s)`, `entryType(doc)`.
2. Wire `export.toBibtex` IPC handler (replace Task 07 stub).
3. UI: list toolbar/context action + top bar button + menu item; enable/disable on selection.
4. `bibtex.test.ts` against the **real** implementation (replace Task 01 stub).

## Verification
- `npm run typecheck && npm run lint && npm run test` pass (incl. `bibtex.test.ts` against the real implementation).
- 1-doc export: correct fields/citekey/authors.
- 3-doc export: 3 entries + unique citekeys (suffixing on collision).
- File → Export → BibTeX… disabled with no selection.
- Round-trip the `.bib` into a LaTeX bibliography compiles.

## Phase 6 DoD (this task owns)
- [ ] `bibtex.test.ts` passes against the real implementation.
- [ ] BibTeX: 1-doc correct fields/citekey/authors; 3-doc 3 entries + unique citekeys; File → Export → BibTeX… disabled with no selection; round-trip compiles in LaTeX.
