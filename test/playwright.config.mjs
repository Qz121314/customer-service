import { defineConfig } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  use: {
    launchOptions: executablePath ? { executablePath } : {},
  },
});
