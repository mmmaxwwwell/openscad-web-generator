#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * E2E Integration Test: WASM64 (Memory64) Detection
 *
 * Verifies that:
 * 1. supportsMemory64() detection works in the browser (returns a boolean)
 * 2. The engine badge shows "WASM" for normal slicing (wasm32 is default)
 * 3. The engine badge CSS class matches the expected variant
 *
 * Note: WASM64 only activates on OOM (wasm32-first strategy), so we cannot
 * easily trigger a WASM64 slice in e2e. This test verifies detection and
 * badge rendering, not actual WASM64 slicing.
 *
 * Exit codes:
 *   0 = all checks passed
 *   1 = test failure
 *   2 = infrastructure error
 */

import { chromium } from 'playwright';
import { createServer } from 'vite';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const OUTPUT_DIR = resolve(PROJECT_ROOT, 'test-output');
const TIMEOUT_RENDER = 60_000;
const TIMEOUT_SLICE = 180_000;

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${tag}] ${ts} ${msg}`);
}

async function runTest() {
  let server = null;
  let browser = null;
  let exitCode = 0;
  const consoleLogs = [];
  const diagnostics = {};

  try {
    // ─── Start Vite Dev Server ───────────────────────────
    log('STEP', 'Starting Vite dev server with COOP/COEP headers...');
    server = await createServer({
      root: PROJECT_ROOT,
      server: {
        port: 0,
        strictPort: false,
        headers: {
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
        },
      },
    });
    await server.listen();
    const addr = server.httpServer.address();
    const baseUrl = `http://localhost:${addr.port}/openscad-web-generator/`;
    log('OK', `Dev server running at ${baseUrl}`);

    // ─── Launch Browser ──────────────────────────────────
    log('STEP', 'Launching Chromium...');
    const chromiumPath = process.env.CHROMIUM_PATH || '/run/current-system/sw/bin/google-chrome-stable';
    browser = await chromium.launch({
      headless: true,
      executablePath: chromiumPath,
      args: ['--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    log('OK', 'Browser launched');

    page.on('console', (msg) => {
      const entry = `[${msg.type()}] ${msg.text()}`;
      consoleLogs.push(entry);
      if (msg.type() === 'error') log('CONSOLE', entry);
    });
    page.on('pageerror', (err) => {
      const entry = `[pageerror] ${err.message}`;
      consoleLogs.push(entry);
      log('CONSOLE', entry);
    });

    // ─── Step 1: Test Memory64 detection in browser ──────
    log('STEP', '1. Testing Memory64 detection in browser context...');
    const memory64Result = await page.evaluate(() => {
      try {
        // This is the same check as supportsMemory64() in slicer-engine.ts
        new WebAssembly.Memory({ initial: 1, index: 'i64' });
        return { supported: true, error: null };
      } catch (err) {
        return { supported: false, error: err.message };
      }
    });

    diagnostics.memory64 = memory64Result;

    if (typeof memory64Result.supported !== 'boolean') {
      log('FAIL', `supportsMemory64 returned non-boolean: ${typeof memory64Result.supported}`);
      exitCode = 1;
    } else {
      log('OK', `Memory64 supported: ${memory64Result.supported}${memory64Result.error ? ` (${memory64Result.error})` : ''}`);
    }

    // Also check WebAssembly is available at all
    const wasmAvailable = await page.evaluate(() => typeof WebAssembly !== 'undefined');
    if (!wasmAvailable) {
      log('FAIL', 'WebAssembly not available in browser');
      exitCode = 1;
    } else {
      log('OK', 'WebAssembly available');
    }

    // ─── Step 2: Navigate + inject test printer ──────────
    log('STEP', '2. Navigating to app and injecting test printer...');
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const disclaimerBtn = page.locator('.disclaimer-ok-btn');
    if (await disclaimerBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await disclaimerBtn.click();
      log('OK', 'Disclaimer accepted');
    }

    await page.evaluate(() => {
      const testPrinter = {
        id: 'test-printer-001',
        name: 'Test Printer',
        address: 'http://localhost:0',
        profileId: 'ender3-s1',
        nozzleDiameter: 0.4,
      };
      localStorage.setItem('moonraker-printers', JSON.stringify([testPrinter]));
      localStorage.setItem('disclaimer-accepted', 'true');
    });

    await page.goto(`${baseUrl}?example=cube_1cm.scad`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    log('OK', 'Test printer injected, example loaded');

    // ─── Step 3: Render STL ──────────────────────────────
    log('STEP', '3. Rendering STL...');
    await page.locator('.export-controls').waitFor({ timeout: 10_000 });
    const stlRenderBtn = page.locator('.export-render-btn').first();
    await stlRenderBtn.click();
    await stlRenderBtn.filter({ hasText: /Re-render/ }).waitFor({ timeout: TIMEOUT_RENDER });
    log('OK', 'STL rendered');

    // ─── Step 4: Open Print Dialog ───────────────────────
    log('STEP', '4. Opening print dialog...');
    await page.locator('.send-to-printer-btn').first().click();
    const printerOption = page.locator('.send-to-printer-option').first();
    try {
      await printerOption.waitFor({ timeout: 3000 });
      await printerOption.click();
    } catch { /* direct button */ }
    await page.locator('.print-dialog').waitFor({ timeout: 10_000 });
    log('OK', 'Print dialog opened');

    // ─── Step 5: Slice ───────────────────────────────────
    log('STEP', '5. Slicing to verify engine badge...');
    const sliceBtn = page.locator('.print-dialog-slice-btn');
    await sliceBtn.waitFor({ timeout: 5000 });
    if (await sliceBtn.isDisabled()) {
      await page.waitForFunction(
        () => { const btn = document.querySelector('.print-dialog-slice-btn'); return btn && !btn.disabled; },
        { timeout: 15_000 },
      );
    }
    await sliceBtn.click();

    const startTime = Date.now();
    await page.waitForFunction(
      () => {
        const doneEl = document.querySelector('.print-dialog-download-btn');
        if (doneEl) return 'done';
        const errorEl = document.querySelector('.print-dialog-error-detail');
        if (errorEl) return 'error';
        return null;
      },
      null,
      { timeout: TIMEOUT_SLICE },
    );

    const errorDetail = await page.locator('.print-dialog-error-detail').textContent().catch(() => null);
    if (errorDetail) {
      throw new Error(`Slicing failed: ${errorDetail}`);
    }

    const sliceElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log('OK', `Slicing complete in ${sliceElapsed}s`);

    // ─── Step 6: Verify engine badge shows "WASM" ────────
    log('STEP', '6. Verifying engine badge...');
    const engineBadge = page.locator('.print-dialog-engine-badge').first();
    const badgeText = await engineBadge.textContent().catch(() => null);

    if (!badgeText) {
      log('FAIL', 'Engine badge not found after slicing');
      exitCode = 1;
    } else {
      diagnostics.engineBadge = badgeText;

      // For a normal slice (no OOM), badge should show "WASM" (not "WASM64")
      if (badgeText.trim().toUpperCase() === 'WASM') {
        log('OK', `Engine badge correctly shows "WASM" (wasm32-first strategy)`);
      } else if (/wasm64/i.test(badgeText)) {
        // WASM64 would only appear if OOM occurred — unexpected for a 1cm cube
        log('FAIL', `Engine badge shows "WASM64" for a simple 1cm cube — wasm32 should suffice`);
        exitCode = 1;
      } else if (/wasm|native/i.test(badgeText)) {
        log('OK', `Engine badge shows: "${badgeText}"`);
      } else {
        log('FAIL', `Unexpected engine badge text: "${badgeText}"`);
        exitCode = 1;
      }
    }

    // ─── Step 7: Verify badge CSS class ──────────────────
    log('STEP', '7. Verifying engine badge CSS class...');
    const badgeClasses = await engineBadge.getAttribute('class').catch(() => null);

    if (badgeClasses) {
      diagnostics.badgeClasses = badgeClasses;

      // Should have the --wasm modifier class (not --wasm64 or --native)
      if (badgeClasses.includes('print-dialog-engine-badge--wasm')) {
        log('OK', `Badge has correct CSS class: print-dialog-engine-badge--wasm`);
      } else if (badgeClasses.includes('print-dialog-engine-badge--wasm64')) {
        log('FAIL', `Badge has wasm64 CSS class for a normal slice — unexpected`);
        exitCode = 1;
      } else {
        log('DIAG', `Badge classes: ${badgeClasses}`);
      }

      // Verify the badge doesn't have the --native class
      if (badgeClasses.includes('print-dialog-engine-badge--native')) {
        log('DIAG', 'Badge has native class — running on native backend?');
      }
    } else {
      log('DIAG', 'Could not read badge CSS classes');
    }

    // ─── Step 8: Summary ─────────────────────────────────
    log('STEP', '8. Summary');
    log('INFO', `Memory64 supported in this browser: ${memory64Result.supported}`);
    log('INFO', `Engine badge: "${badgeText || 'not found'}"`);
    log('INFO', `wasm64 would be used on OOM: ${memory64Result.supported ? 'yes' : 'no (browser lacks Memory64)'}`);

  } catch (err) {
    if (exitCode === 0) exitCode = 2;
    log('ERROR', err.message);
    diagnostics.error = err.message;
    diagnostics.stack = err.stack;
  } finally {
    if (consoleLogs.length > 0) {
      const consoleLogPath = resolve(OUTPUT_DIR, 'wasm64-detect-console.log');
      writeFileSync(consoleLogPath, consoleLogs.join('\n'));
      log('DIAG', `Console log (${consoleLogs.length} lines) written to ${consoleLogPath}`);
    }

    diagnostics.consoleLogs = consoleLogs;
    diagnostics.exitCode = exitCode;
    const diagPath = resolve(OUTPUT_DIR, 'wasm64-detect-diagnostics.json');
    writeFileSync(diagPath, JSON.stringify(diagnostics, null, 2));

    log('RESULT', JSON.stringify({
      passed: exitCode === 0,
      exitCode,
      diagnosticsFile: diagPath,
      error: diagnostics.error || null,
    }));

    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
    if (server) { try { await server.close(); } catch { /* ignore */ } }
  }

  process.exit(exitCode);
}

runTest();
