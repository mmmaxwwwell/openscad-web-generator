#!/usr/bin/env node

/**
 * Bundles the BOSL2 library into a JS module that can be loaded by the OpenSCAD WASM worker.
 * Follows the same pattern as openscad.mcad.js from the openscad-wasm project:
 * - Files are hex-encoded into a JS object
 * - An addBOSL2(openscad) function writes them to the WASM filesystem at /libraries/BOSL2/
 *
 * Usage: node scripts/bundle-bosl2.mjs [--force]
 *
 * Looks for BOSL2 in standard OpenSCAD library paths:
 *   - $OPENSCADPATH/BOSL2/
 *   - ~/.local/share/OpenSCAD/libraries/BOSL2/
 *   - /usr/share/openscad/libraries/BOSL2/
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT = join(ROOT, 'public', 'wasm', 'openscad.bosl2.js');

const SEARCH_PATHS = [
  process.env.OPENSCADPATH ? join(process.env.OPENSCADPATH, 'BOSL2') : null,
  join(homedir(), '.local', 'share', 'OpenSCAD', 'libraries', 'BOSL2'),
  '/usr/share/openscad/libraries/BOSL2',
  '/usr/local/share/openscad/libraries/BOSL2',
].filter(Boolean);

function findBOSL2() {
  for (const p of SEARCH_PATHS) {
    if (existsSync(join(p, 'std.scad'))) return p;
  }
  return null;
}

function toHex(buffer) {
  return Buffer.from(buffer).toString('hex');
}

async function main() {
  const force = process.argv.includes('--force');

  if (existsSync(OUTPUT) && !force) {
    console.log('BOSL2 bundle already exists. Use --force to regenerate.');
    return;
  }

  const bosl2Path = findBOSL2();
  if (!bosl2Path) {
    console.error('BOSL2 library not found. Searched:');
    SEARCH_PATHS.forEach(p => console.error(`  - ${p}`));
    console.error('\nInstall BOSL2: https://github.com/BelfrySCAD/BOSL2/wiki');
    process.exit(1);
  }

  console.log(`Found BOSL2 at: ${bosl2Path}`);

  // Collect all .scad files
  const files = readdirSync(bosl2Path).filter(f => f.endsWith('.scad')).sort();
  console.log(`Bundling ${files.length} .scad files...`);

  const entries = {};
  let totalSize = 0;
  for (const file of files) {
    const content = readFileSync(join(bosl2Path, file));
    entries[file] = toHex(content);
    totalSize += content.length;
  }

  // Generate JS module following the same pattern as openscad.mcad.js
  const js = `// Auto-generated BOSL2 library bundle
// Source: ${bosl2Path}
// Files: ${files.length}, Total: ${(totalSize / 1024).toFixed(1)} KB

function writeFolder(fs, base, contents) {
    for (const [file, data] of Object.entries(contents)) {
        const fullPath = base + file;
        ensureDirectoryExists(fs, fullPath);
        fs.writeFile(fullPath, fromHex(data));
    }
}
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

var bosl2 = ${JSON.stringify(entries)};

function addBOSL2(openscad) {
    writeFolder(openscad.FS, "/libraries/BOSL2/", bosl2);
}

export { addBOSL2 };
`;

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, js);
  const outputSize = (readFileSync(OUTPUT).length / 1024 / 1024).toFixed(1);
  console.log(`Written: ${OUTPUT} (${outputSize} MB)`);
}

main().catch(err => {
  console.error('Failed to bundle BOSL2:', err.message);
  process.exit(1);
});
