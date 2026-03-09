#!/usr/bin/env node

/**
 * Bundles the qr.scad library into a JS module that can be loaded by the OpenSCAD WASM worker.
 * Follows the same pattern as bundle-bosl2.mjs:
 * - File is hex-encoded into a JS module
 * - An addQR(openscad) function writes it to the WASM filesystem at /libraries/qr.scad
 *
 * Usage: node scripts/bundle-qr.mjs [--force]
 *
 * Looks for qr.scad in standard OpenSCAD library paths:
 *   - $OPENSCADPATH/qr.scad
 *   - ~/.local/share/OpenSCAD/libraries/qr.scad
 *   - /usr/share/openscad/libraries/qr.scad
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT = join(ROOT, 'public', 'wasm', 'openscad.qr.js');

const SEARCH_PATHS = [
  process.env.OPENSCADPATH ? join(process.env.OPENSCADPATH, 'qr.scad') : null,
  join(homedir(), '.local', 'share', 'OpenSCAD', 'libraries', 'qr.scad'),
  '/usr/share/openscad/libraries/qr.scad',
  '/usr/local/share/openscad/libraries/qr.scad',
].filter(Boolean);

function findQR() {
  for (const p of SEARCH_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

function toHex(buffer) {
  return Buffer.from(buffer).toString('hex');
}

async function main() {
  const force = process.argv.includes('--force');

  if (existsSync(OUTPUT) && !force) {
    console.log('QR bundle already exists. Use --force to regenerate.');
    return;
  }

  const qrPath = findQR();
  if (!qrPath) {
    console.error('qr.scad library not found. Searched:');
    SEARCH_PATHS.forEach(p => console.error(`  - ${p}`));
    console.error('\nInstall qr.scad: https://github.com/xypwn/scadqr');
    process.exit(1);
  }

  console.log(`Found qr.scad at: ${qrPath}`);

  const content = readFileSync(qrPath);
  const hex = toHex(content);
  const size = content.length;

  console.log(`Bundling qr.scad (${(size / 1024).toFixed(1)} KB)...`);

  // Generate JS module following the same pattern as openscad.bosl2.js
  const js = `// Auto-generated QR code library bundle
// Source: ${qrPath}
// Size: ${(size / 1024).toFixed(1)} KB

function fromHex(hex) {
    if (hex.length == 0) {
        return new Uint8Array(0);
    }
    return new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
}
function ensureDirectoryExists(fs, filePath) {
    const dirIndex = filePath.lastIndexOf("/");
    if (dirIndex != -1) {
        const dirname = filePath.substring(0, dirIndex);
        ensureDirectoryExists(fs, dirname);
        if (dirname != "" && !exists(fs, dirname)) {
            fs.mkdir(dirname);
        }
    }
}
function exists(fs, path) {
    try {
        fs.stat(path);
        return true;
    }
    catch (e) {
        return false;
    }
}

var qrData = "${hex}";

function addQR(openscad) {
    ensureDirectoryExists(openscad.FS, "/libraries/qr.scad");
    openscad.FS.writeFile("/libraries/qr.scad", fromHex(qrData));
}

export { addQR };
`;

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, js);
  const outputSize = (readFileSync(OUTPUT).length / 1024).toFixed(1);
  console.log(`Written: ${OUTPUT} (${outputSize} KB)`);
}

main().catch(err => {
  console.error('Failed to bundle qr.scad:', err.message);
  process.exit(1);
});
