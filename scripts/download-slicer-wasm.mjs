#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Downloads pre-built OrcaSlicer libslic3r WASM artifacts from GitHub releases.
 * Fallback for CI or non-Nix environments where building from source is impractical.
 *
 * Downloads both wasm32 (required) and wasm64 (optional) variants.
 *
 * Options:
 *   --force      Re-download even if artifacts already exist
 *   --no-wasm64  Skip downloading wasm64 artifacts
 */

import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { pipeline } from 'stream/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const WASM_DIR = join(ROOT, 'public', 'wasm');

const REPO = 'mmmaxwwwell/openscad-web-generator';
const GITHUB_API = `https://api.github.com/repos/${REPO}/releases`;

// wasm32 artifacts (required)
const REQUIRED_ASSETS = [
  'libslic3r.js',
  'libslic3r.wasm',
];

// wasm32 optional artifacts (pthreads worker)
const OPTIONAL_ASSETS = [
  'libslic3r.worker.js',
];

// wasm64 artifacts (all optional — app works without them)
const WASM64_ASSETS = [
  'libslic3r-wasm64.js',
  'libslic3r-wasm64.wasm',
];

const WASM64_OPTIONAL = [
  'libslic3r-wasm64.worker.js',
];

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { 'Accept': 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  return res.json();
}

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  const fileStream = createWriteStream(dest);
  await pipeline(res.body, fileStream);
}

/**
 * Find the latest release that contains OrcaSlicer WASM assets.
 * Looks through recent releases for one tagged with 'orcaslicer-wasm' prefix
 * (or legacy 'slicer-wasm') that contains the required libslic3r.* assets.
 */
async function findSlicerRelease() {
  const releases = await fetchJSON(GITHUB_API);

  // First, look for a release with 'orcaslicer-wasm' in the tag name
  for (const release of releases) {
    if (release.tag_name.includes('orcaslicer-wasm')) {
      const assets = release.assets || [];
      const hasRequired = REQUIRED_ASSETS.every(name =>
        assets.some(a => a.name === name)
      );
      if (hasRequired) return release;
    }
  }

  // Fallback: look for legacy 'slicer-wasm' tag or any release with the assets
  for (const release of releases) {
    if (release.tag_name.includes('slicer-wasm')) {
      const assets = release.assets || [];
      const hasRequired = REQUIRED_ASSETS.every(name =>
        assets.some(a => a.name === name)
      );
      if (hasRequired) return release;
    }
  }

  // Last resort: any release with the right assets
  for (const release of releases) {
    const assets = release.assets || [];
    const hasRequired = REQUIRED_ASSETS.every(name =>
      assets.some(a => a.name === name)
    );
    if (hasRequired) return release;
  }

  return null;
}

/**
 * Download a list of assets from a release. Required assets cause failure if missing.
 */
async function downloadAssets(assets, names, label, required = true) {
  let downloaded = 0;
  for (const name of names) {
    const asset = assets.find(a => a.name === name);
    if (!asset) {
      if (required) {
        console.error(`ERROR: Required ${label} asset "${name}" not found in release.`);
        process.exit(1);
      }
      continue;
    }
    const dest = join(WASM_DIR, name);
    console.log(`  ${name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)...`);
    await downloadFile(asset.browser_download_url, dest);
    downloaded++;
  }
  return downloaded;
}

async function main() {
  const force = process.argv.includes('--force');
  const skipWasm64 = process.argv.includes('--no-wasm64');

  // Check if wasm32 already downloaded
  const wasm32Exist = REQUIRED_ASSETS.every(f => existsSync(join(WASM_DIR, f)));
  if (wasm32Exist && !force) {
    console.log('OrcaSlicer WASM (wasm32) files already present. Use --force to re-download.');
    if (skipWasm64) return;
    // Still check wasm64 below
  }

  mkdirSync(WASM_DIR, { recursive: true });

  console.log('Searching for OrcaSlicer WASM release on GitHub...');
  const release = await findSlicerRelease();

  if (!release) {
    console.error(
      'No GitHub release found with OrcaSlicer WASM artifacts.\n' +
      'Build from source instead: node scripts/build-slicer-wasm.mjs'
    );
    process.exit(1);
  }

  console.log(`Found release: ${release.tag_name}`);
  const assets = release.assets || [];

  // --- wasm32 (required) ---
  if (!wasm32Exist || force) {
    console.log('Downloading wasm32 artifacts:');
    await downloadAssets(assets, REQUIRED_ASSETS, 'wasm32', true);
    await downloadAssets(assets, OPTIONAL_ASSETS, 'wasm32', false);
  }

  // --- wasm64 (optional) ---
  if (!skipWasm64) {
    const wasm64Exist = WASM64_ASSETS.every(f => existsSync(join(WASM_DIR, f)));
    if (wasm64Exist && !force) {
      console.log('OrcaSlicer WASM (wasm64) files already present.');
    } else {
      const hasAnyWasm64 = WASM64_ASSETS.some(name => assets.some(a => a.name === name));
      if (hasAnyWasm64) {
        console.log('Downloading wasm64 artifacts:');
        await downloadAssets(assets, WASM64_ASSETS, 'wasm64', false);
        await downloadAssets(assets, WASM64_OPTIONAL, 'wasm64', false);
      } else {
        console.log('No wasm64 artifacts in this release (optional — app works without them).');
      }
    }
  }

  console.log(`Done. OrcaSlicer WASM from release ${release.tag_name}`);
}

main().catch(err => {
  console.error('Failed to download OrcaSlicer WASM:', err.message);
  process.exit(1);
});
