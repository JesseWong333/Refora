# Task 17 — Coverage Thresholds & CI Configuration

**Phase:** 5 (Coverage & CI Gates) · **Prerequisites:** 01–13 · **Master plan:** Phase 5

## Goal
Add vitest coverage with minimum thresholds, create `npm run test:coverage` script, and set up a GitHub Actions CI workflow.

## Steps

### 17.1 Add coverage to `vitest.config.ts`

Add `coverage` key to existing config:
```ts
coverage: {
  provider: 'v8',
  reporter: ['text', 'lcov', 'html'],
  include: ['src/**/*.{ts,tsx}'],
  exclude: [
    'src/renderer/env.d.ts',
    'src/**/*.d.ts',
  ],
  thresholds: {
    lines: 70,
    branches: 55,
    functions: 70,
    statements: 70,
  }
}
```

### 17.2 Add `test:coverage` script to `package.json`

```json
"scripts": {
  "test:coverage": "vitest run --coverage"
}
```

**Note:** Coverage thresholds are a **baseline** (70/55/70), not the aspirational 80%. The project has Electron native APIs that can't be fully covered in vitest. Ratchet up as tests mature.

### 17.3 Create `.github/workflows/ci.yml`

```yaml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: macos-latest
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Rebuild native modules
        run: npm run postinstall

      - name: Typecheck
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Unit & Component Tests
        run: npm run test

      - name: Coverage
        run: npm run test:coverage

      - name: Build
        run: npm run build

      # E2E tests require build + display; skip by default until CI has xvfb/headed setup.
      # Uncomment when ready:
      # - name: E2E Tests
      #   run: npx playwright test --project=electron
```

### 17.4 Verify coverage report

Run `npm run test:coverage` and confirm:
- Text summary printed to console.
- `coverage/lcov.info` generated.
- Thresholds pass (or fail with clear output showing which threshold missed).

## Verification
- `npm run test:coverage` prints coverage report.
- `.github/workflows/ci.yml` passes schema validation (GitHub Actions will validate on push).
- `npm run typecheck && npm run lint && npm run test` pass.

## Notes
- Coverage will be low initially (most source files are untested by the new tests until they're written). Set thresholds to what the **current combined** test suite achieves + a small buffer.
- If coverage thresholds block CI: lower them to the current achieved percentage and create a follow-up task to ratchet up.
- macOS CI requires `electron-builder` dependencies (`dmg`, `zip`). macOS runners include these by default.
