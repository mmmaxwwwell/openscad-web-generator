import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
