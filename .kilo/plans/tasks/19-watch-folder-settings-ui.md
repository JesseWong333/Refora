# Task 19 — Watch folder Settings UI

**Phase:** 5 (Watch & search) · **Prerequisites:** 18 · **Master plan:** §6 (Settings), §5 (Settings validation), §7 (Move-to-library vs watch)

## Goal
Watch-folder management UI in Settings: add/remove/toggle watch folders, with mutual-exclusion validation against the library folder.

## Spec (master plan §6 Settings, §5, §7)
- Watch folders list (add/remove/toggle) backed by `watch.list/add/remove/toggle`.
- **Validation:** adding a watch folder inside the library folder (or vice-versa: setting the library folder inside a watch folder) is refused with the message:
  - library folder inside a watch folder → "Path cannot be inside a watch folder."
  - watch folder inside the library folder → "Path cannot be inside the library folder."
- Toggling a watch folder enabled/disabled starts/stops its chokidar watcher (Task 18).

## Steps
1. Settings: Watch Folders section listing current `watch_folders` with enable/disable toggles + remove.
2. Add button → native dir picker → `watch.add(path)`; show validation errors inline.
3. Coordinate with the library-folder picker (Task 21) for mutual exclusion.

## Verification
- `npm run typecheck && npm run lint && npm run test` pass.
- Watch folder Settings UI (add/remove/toggle) works.
- Adding a watch inside the library folder (or vice-versa) is refused with the correct validation message.

## Phase 5 DoD (this task owns)
- [ ] Watch folder Settings UI (add/remove/toggle) works; adding a watch inside the library folder (or vice-versa) is refused with the validation message.
