#!/usr/bin/env node

/**
 * Build orchestration script.
 * 1. Downloads OpenSCAD WASM if not present (or --force-wasm)
 * 2. Runs vite build
 * 3. Prints build summary
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const WASM_DIR = join(ROOT, 'public', 'wasm');

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts });
}

async function main() {
  const forceWasm = process.argv.includes('--force-wasm');

  // Step 1: Download WASM if needed
  const wasmExists = existsSync(join(WASM_DIR, 'openscad.wasm'));
  if (!wasmExists || forceWasm) {
    console.log('=== Downloading OpenSCAD WASM ===');
    const args = forceWasm ? ' --force' : '';
    run(`node scripts/download-wasm.mjs${args}`);
  } else {
    console.log('=== OpenSCAD WASM already present, skipping download ===');
  }

  // Step 2: Vite build
  console.log('\n=== Building with Vite ===');
  run('npx vite build');

  // Step 3: Summary
  console.log('\n=== Build Complete ===');
  console.log('Output: dist/');
}

main().catch(err => {
  console.error('Build failed:', err.message);
  process.exit(1);
});
