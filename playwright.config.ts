import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  retries: 0,
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'electron',
      use: {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        executablePath: require('electron') as string,
        args: ['.'],
      },
    },
  ],
})
