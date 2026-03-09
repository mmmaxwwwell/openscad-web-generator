import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.integration.test.ts'],
    browser: {
      enabled: true,
      instances: [
        { browser: 'chromium' },
      ],
      provider: playwright({
        launchOptions: {
          executablePath: process.env.CHROMIUM_PATH || '/run/current-system/sw/bin/google-chrome-stable',
        },
      }),
      headless: true,
    },
  },
});
