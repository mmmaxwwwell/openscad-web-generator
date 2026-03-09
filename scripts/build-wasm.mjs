#!/usr/bin/env node

/**
 * Builds OpenSCAD WASM using Nix.
 * Requires: nix with flakes enabled.
 *
 * Runs `nix build .#openscad-wasm` and copies the output artifacts
 * into public/wasm/.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const WASM_DIR = join(ROOT, 'public', 'wasm');

const REQUIRED_ARTIFACTS = [
  'openscad.js',
  'openscad.wasm',
  'openscad.wasm.js',
  'openscad.fonts.js',
  'openscad.mcad.js',
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
    console.log('OpenSCAD WASM files already present. Use --force to rebuild.');
    return;
  }

  checkPrerequisites();

  console.log('Building OpenSCAD WASM via Nix (this will take a while on first build)...');
  run('nix build .#openscad-wasm --print-build-logs', {
    timeout: 90 * 60 * 1000, // 90 min timeout for first build
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
      console.warn(`Warning: Expected artifact "${artifact}" not found in Nix output. Skipping.`);
      continue;
    }
    copyFileSync(srcPath, destPath);
    console.log(`Copied result/${artifact} -> public/wasm/${artifact}`);
  }

  // Write version manifest
  const manifest = {
    source: 'nix-build',
    builtAt: new Date().toISOString(),
  };
  writeFileSync(join(WASM_DIR, 'wasm-version.json'), JSON.stringify(manifest, null, 2));
  console.log('Done. WASM artifacts installed to public/wasm/');
}

main().catch(err => {
  console.error('Failed to build OpenSCAD WASM:', err.message);
  process.exit(1);
});
