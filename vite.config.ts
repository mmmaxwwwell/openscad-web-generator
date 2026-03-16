/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isApk = process.env.VITE_APK === '1';

export default defineConfig({
  base: isApk ? './' : '/openscad-web-generator/',
  plugins: [react()],
  test: {
    exclude: [
      '**/node_modules/**',
    ],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: [
        'src/lib/**/*.ts',
        'src/data/**/*.ts',
        'src/types/**/*.ts',
      ],
      exclude: [
        'src/lib/__tests__/**',
        'src/test-*.tsx',
        'src/vite-env.d.ts',
        // Web Workers — require Worker runtime, not testable in Node
        'src/workers/**',
        'src/lib/openscad-worker.ts',
        // Thin wrappers around browser/external APIs
        'src/lib/storage-s3.ts',
      ],
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      reportOnFailure: true,
    },
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      external: ['/wasm/openscad.js', '/wasm/openscad.fonts.js', '/wasm/openscad.mcad.js', '/wasm/openscad.bosl2.js'],
    },
  },
  worker: {
    format: 'es',
    rollupOptions: {
      external: ['/wasm/openscad.js', '/wasm/openscad.fonts.js', '/wasm/openscad.mcad.js', '/wasm/openscad.bosl2.js'],
    },
  },
});
