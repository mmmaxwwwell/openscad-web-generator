import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isApk = process.env.VITE_APK === '1';

export default defineConfig({
  base: isApk ? './' : '/openscad-web-generator/',
  plugins: [react()],
  server: {
    watch: {
      ignored: ['**/vendor/grid-apps/**'],
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
