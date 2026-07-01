# Task 14 — IPC E2E Smoke Test

**Phase:** 4 (Integration & E2E) · **Prerequisites:** all prior tasks + `electron-vite build` works · **Master plan:** Phase 4, Task 4.1

## Goal
Set up `@playwright/test` with Electron fixture and create `tests/e2e/ipc-smoke.spec.ts` verifying the full IPC bridge works in a real Electron process.

## Pre-requisite: Playwright Setup

```bash
npm install -D @playwright/test
```

Create `playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30000,
  retries: 0,
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'electron',
      use: {
        // The Electron app entry point
        executablePath: require('electron'),
        args: ['.'],
      },
    },
  ],
})
```

**Important:** Playwright's Electron support uses `electron.launch()`. The app must be **built** first:
```bash
npm run build
```

## Test Cases — `tests/e2e/ipc-smoke.spec.ts`

1. **App launches** — `electron.launch()` returns an `ElectronApplication`.
   - App window exists.
   - No crash on startup.

2. **getBootstrap() returns valid shape** — From renderer via `page.evaluate()`:
   - `window.api.getBootstrap()` resolves.
   - Response has `language` (string), `windowBounds` (object or null), `sidebarCollapsed` (string '0' or '1').

3. **settings.get() / set() round-trip** — Set a setting, then read it back.
   - `window.api.settings.set({ key: 'test_key', value: '"test_value"' })` → `{ ok: true }`.
   - `window.api.settings.get('test_key')` → `{ ok: true, data: 'test_value' }`.

4. **document:updated event fires** — Subscribe to event, trigger an update via handler.
   - Call `onDocumentUpdated(cb)` where `cb` stores received data.
   - Call `documents.update(id, { title: 'New Title' })`.
   - Wait for `cb` to fire with updated document.

## Files to create
- `playwright.config.ts`
- `tests/e2e/ipc-smoke.spec.ts`

## Verification
- `npm run build` succeeds.
- `npx playwright test --project=electron tests/e2e/ipc-smoke.spec.ts` passes (requires headed display or `xvfb-run`).
- Do NOT add `test:e2e` script to `package.json` yet — that's Task 17.

## Known limitations
- Playwright Electron fixture may require additional configuration to match electron-vite's output path. Adjust `args` / `cwd` / `executablePath` as needed.
- If the macOS CI runner has no display, tests will fail. Document in CI workflow (Task 17).
