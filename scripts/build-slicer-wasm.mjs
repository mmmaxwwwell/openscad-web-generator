#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Builds OrcaSlicer libslic3r WASM using Nix.
 * Requires: nix with flakes enabled.
 *
 * Runs `nix build .#orcaslicer-wasm` and copies the output artifacts
 * into public/wasm/.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const WASM_DIR = join(ROOT, 'public', 'wasm');

// Required artifacts from the Nix build
const REQUIRED_ARTIFACTS = [
  'libslic3r.js',
  'libslic3r.wasm',
];

// Optional artifacts (pthreads worker)
const OPTIONAL_ARTIFACTS = [
  'libslic3r.worker.js',
];

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts });
}

function checkPrerequisites() {
  try {
    execSync('nix --version', { stdio: 'ignore' });
  } catch {
    console.error('Nix is not installed. Install it from https://nixos.org/download');
    process.exit(1);
  }
}

async function main() {
  const force = process.argv.includes('--force');

  // Check if already built
  const allExist = REQUIRED_ARTIFACTS.every(a => existsSync(join(WASM_DIR, a)));
  if (allExist && !force) {
    console.log('OrcaSlicer WASM files already present. Use --force to rebuild.');
    return;
  }

  checkPrerequisites();

  console.log('Building OrcaSlicer WASM via Nix (this will take a while on first build)...');
  run('nix build .#orcaslicer-wasm --print-build-logs', {
    timeout: 120 * 60 * 1000, // 120 min timeout for first build
  });

  // nix build creates a ./result symlink pointing to the Nix store
  const resultDir = join(ROOT, 'result');
  if (!existsSync(resultDir)) {
    console.error('Nix build did not produce a result directory.');
    process.exit(1);
  }

  // Copy artifacts from Nix store to public/wasm/
  mkdirSync(WASM_DIR, { recursive: true });

  for (const artifact of REQUIRED_ARTIFACTS) {
    const srcPath = join(resultDir, artifact);
    const destPath = join(WASM_DIR, artifact);
    if (!existsSync(srcPath)) {
      console.error(`ERROR: Required artifact "${artifact}" not found in Nix output.`);
      process.exit(1);
    }
    copyFileSync(srcPath, destPath);
    console.log(`Copied result/${artifact} -> public/wasm/${artifact}`);
  }

  for (const artifact of OPTIONAL_ARTIFACTS) {
    const srcPath = join(resultDir, artifact);
    const destPath = join(WASM_DIR, artifact);
    if (existsSync(srcPath)) {
      copyFileSync(srcPath, destPath);
      console.log(`Copied result/${artifact} -> public/wasm/${artifact}`);
    }
  }

  console.log('Done. OrcaSlicer WASM artifacts installed to public/wasm/');
}

main().catch(err => {
  console.error('Failed to build OrcaSlicer WASM:', err.message);
  process.exit(1);
});
