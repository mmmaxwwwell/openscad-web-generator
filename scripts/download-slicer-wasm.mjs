#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Downloads pre-built OrcaSlicer libslic3r WASM artifacts from GitHub releases.
 * Fallback for CI or non-Nix environments where building from source is impractical.
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

// Required artifacts
const REQUIRED_ASSETS = [
  'libslic3r.js',
  'libslic3r.wasm',
];

// Optional artifacts (pthreads worker)
const OPTIONAL_ASSETS = [
  'libslic3r.worker.js',
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

async function main() {
  const force = process.argv.includes('--force');

  // Check if already downloaded
  const allExist = REQUIRED_ASSETS.every(f => existsSync(join(WASM_DIR, f)));
  if (allExist && !force) {
    console.log('OrcaSlicer WASM files already present. Use --force to re-download.');
    return;
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

  for (const name of REQUIRED_ASSETS) {
    const asset = assets.find(a => a.name === name);
    if (!asset) {
      console.error(`ERROR: Required asset "${name}" not found in release ${release.tag_name}.`);
      process.exit(1);
    }
    const dest = join(WASM_DIR, name);
    console.log(`Downloading ${name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)...`);
    await downloadFile(asset.browser_download_url, dest);
    console.log(`  -> ${dest}`);
  }

  for (const name of OPTIONAL_ASSETS) {
    const asset = assets.find(a => a.name === name);
    if (asset) {
      const dest = join(WASM_DIR, name);
      console.log(`Downloading ${name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)...`);
      await downloadFile(asset.browser_download_url, dest);
      console.log(`  -> ${dest}`);
    }
  }

  console.log(`Done. OrcaSlicer WASM from release ${release.tag_name}`);
}

main().catch(err => {
  console.error('Failed to download OrcaSlicer WASM:', err.message);
  process.exit(1);
});
