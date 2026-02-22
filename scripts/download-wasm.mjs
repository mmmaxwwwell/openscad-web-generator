#!/usr/bin/env node

/**
 * Downloads OpenSCAD WASM release artifacts from GitHub into public/wasm/.
 * Uses the openscad/openscad-wasm GitHub releases.
 */

import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'fs';
import { pipeline } from 'stream/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const WASM_DIR = join(ROOT, 'public', 'wasm');

const REPO = 'openscad/openscad-wasm';
const GITHUB_API = `https://api.github.com/repos/${REPO}/releases/latest`;

const REQUIRED_ASSETS = [
  'openscad.js',
  'openscad.wasm',
  'openscad.wasm.js',
  'openscad.fonts.js',
  'openscad.mcad.js',
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

async function main() {
  const force = process.argv.includes('--force');

  // Check if already downloaded
  const allExist = REQUIRED_ASSETS.every(f => existsSync(join(WASM_DIR, f)));
  if (allExist && !force) {
    console.log('OpenSCAD WASM files already present. Use --force to re-download.');
    return;
  }

  mkdirSync(WASM_DIR, { recursive: true });

  console.log('Fetching latest release info from GitHub...');
  const release = await fetchJSON(GITHUB_API);
  console.log(`Latest release: ${release.tag_name}`);

  const assets = release.assets || [];

  for (const name of REQUIRED_ASSETS) {
    const asset = assets.find(a => a.name === name);
    if (!asset) {
      console.warn(`Warning: Asset "${name}" not found in release. Skipping.`);
      continue;
    }
    const dest = join(WASM_DIR, name);
    console.log(`Downloading ${name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)...`);
    await downloadFile(asset.browser_download_url, dest);
    console.log(`  -> ${dest}`);
  }

  // Write version manifest for cache busting
  const manifest = {
    tag: release.tag_name,
    downloadedAt: new Date().toISOString(),
  };
  writeFileSync(join(WASM_DIR, 'wasm-version.json'), JSON.stringify(manifest, null, 2));
  console.log('Done. WASM version:', release.tag_name);
}

main().catch(err => {
  console.error('Failed to download OpenSCAD WASM:', err.message);
  process.exit(1);
});
