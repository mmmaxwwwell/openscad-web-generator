#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Builds OrcaSlicer libslic3r WASM using Nix.
 * Requires: nix with flakes enabled.
 *
 * Runs `nix build .#orcaslicer-wasm` (and optionally .#orcaslicer-wasm64)
 * and copies the output artifacts into public/wasm/.
 *
 * Options:
 *   --force     Rebuild even if artifacts already exist
 *   --no-wasm64 Skip the wasm64 build (faster, wasm64 is optional)
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const WASM_DIR = join(ROOT, 'public', 'wasm');

// wasm32 artifacts (required)
const WASM32_REQUIRED = ['libslic3r.js', 'libslic3r.wasm'];
const WASM32_OPTIONAL = ['libslic3r.worker.js'];

// wasm64 artifacts (optional — app works without them)
const WASM64_ARTIFACTS = ['libslic3r-wasm64.js', 'libslic3r-wasm64.wasm'];
const WASM64_OPTIONAL = ['libslic3r-wasm64.worker.js'];

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

/**
 * Copy a file from src to dest, handling read-only destination files
 * (common when previous copy was from Nix store).
 */
function safeCopy(src, dest) {
  try {
    if (existsSync(dest)) {
      chmodSync(dest, 0o644);
    }
  } catch { /* ignore chmod errors */ }
  copyFileSync(src, dest);
}

/**
 * Copy artifacts from a Nix result directory to public/wasm/.
 * @returns number of files copied
 */
function copyArtifacts(resultDir, required, optional, label) {
  let copied = 0;

  for (const artifact of required) {
    const srcPath = join(resultDir, artifact);
    const destPath = join(WASM_DIR, artifact);
    if (!existsSync(srcPath)) {
      console.error(`ERROR: Required ${label} artifact "${artifact}" not found in Nix output.`);
      process.exit(1);
    }
    safeCopy(srcPath, destPath);
    console.log(`  ${artifact} -> public/wasm/${artifact}`);
    copied++;
  }

  for (const artifact of optional) {
    const srcPath = join(resultDir, artifact);
    const destPath = join(WASM_DIR, artifact);
    if (existsSync(srcPath)) {
      safeCopy(srcPath, destPath);
      console.log(`  ${artifact} -> public/wasm/${artifact}`);
      copied++;
    }
  }

  return copied;
}

async function main() {
  const force = process.argv.includes('--force');
  const skipWasm64 = process.argv.includes('--no-wasm64');

  // Check if wasm32 already built
  const wasm32Exist = WASM32_REQUIRED.every(a => existsSync(join(WASM_DIR, a)));
  if (wasm32Exist && !force) {
    console.log('OrcaSlicer WASM (wasm32) files already present. Use --force to rebuild.');
    if (skipWasm64) return;
    // Still check wasm64 below
  }

  checkPrerequisites();
  mkdirSync(WASM_DIR, { recursive: true });

  // --- wasm32 build ---
  if (!wasm32Exist || force) {
    console.log('Building OrcaSlicer WASM (wasm32) via Nix...');
    run('nix build .#orcaslicer-wasm --print-build-logs', {
      timeout: 120 * 60 * 1000,
    });

    const resultDir = join(ROOT, 'result');
    if (!existsSync(resultDir)) {
      console.error('Nix build did not produce a result directory.');
      process.exit(1);
    }

    console.log('Copying wasm32 artifacts:');
    copyArtifacts(resultDir, WASM32_REQUIRED, WASM32_OPTIONAL, 'wasm32');
  }

  // --- wasm64 build (optional) ---
  if (!skipWasm64) {
    const wasm64Exist = WASM64_ARTIFACTS.every(a => existsSync(join(WASM_DIR, a)));
    if (wasm64Exist && !force) {
      console.log('OrcaSlicer WASM (wasm64) files already present.');
    } else {
      console.log('Building OrcaSlicer WASM (wasm64) via Nix...');
      try {
        run('nix build .#orcaslicer-wasm64 --print-build-logs -o result-wasm64', {
          timeout: 120 * 60 * 1000,
        });

        const resultDir64 = join(ROOT, 'result-wasm64');
        if (existsSync(resultDir64)) {
          console.log('Copying wasm64 artifacts:');
          copyArtifacts(resultDir64, WASM64_ARTIFACTS, WASM64_OPTIONAL, 'wasm64');
        }
      } catch (err) {
        console.warn(`wasm64 build failed (non-fatal): ${err.message}`);
        console.warn('The app will work without wasm64 — it is only needed for >4GB models.');
      }
    }
  }

  console.log('Done. OrcaSlicer WASM artifacts installed to public/wasm/');
}

main().catch(err => {
  console.error('Failed to build OrcaSlicer WASM:', err.message);
  process.exit(1);
});
