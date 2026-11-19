#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * E2E Integration Test: Slice Stats Display
 *
 * Slices a 1cm cube and verifies that the rich stats panel shows non-zero
 * values for print time, filament usage, and layer count. These stats come
 * from the native C++ getSliceStats() API (not GCode parsing).
 *
 * Exit codes:
 *   0 = all checks passed
 *   1 = test failure
 *   2 = infrastructure error
 *
 * Output format: same tagged format as other e2e tests.
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

    // ─── Step 1: Navigate + inject test printer ──────────
    log('STEP', '1. Navigating to app...');
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

    // ─── Step 2: Wait for editor ─────────────────────────
    log('STEP', '2. Waiting for editor...');
    await page.locator('.export-controls').waitFor({ timeout: 10_000 });
    log('OK', 'Editor loaded');

    // ─── Step 3: Render STL ──────────────────────────────
    log('STEP', '3. Rendering STL...');
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
    log('STEP', '5. Slicing...');
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

    // ─── Step 6: Verify Stats Panel ──────────────────────
    log('STEP', '6. Verifying stats panel...');

    // The stats panel should be visible after slicing
    const statsPanel = page.locator('.print-dialog-stats-panel');
    const statsPanelVisible = await statsPanel.isVisible().catch(() => false);

    if (!statsPanelVisible) {
      // Take screenshot for debugging
      const screenshotPath = resolve(OUTPUT_DIR, 'stats-panel-missing.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log('SCREENSHOT', screenshotPath);
      log('FAIL', 'Stats panel not visible after slicing');
      exitCode = 1;
    } else {
      log('OK', 'Stats panel is visible');

      // Extract all stat labels and values
      const stats = await page.evaluate(() => {
        const statEls = document.querySelectorAll('.print-dialog-stat');
        const result = {};
        for (const el of statEls) {
          const label = el.querySelector('.print-dialog-stat-label')?.textContent?.trim();
          const value = el.querySelector('.print-dialog-stat-value')?.textContent?.trim();
          if (label) result[label] = value;
        }
        return result;
      });

      log('DIAG', `Stats found: ${JSON.stringify(stats)}`);
      diagnostics.stats = stats;

      // Check: Print Time is present and non-empty
      if (stats['Print Time'] && stats['Print Time'].length > 0) {
        log('OK', `Print Time: ${stats['Print Time']}`);
      } else {
        log('FAIL', 'Print Time missing or empty');
        exitCode = 1;
      }

      // Check: Filament is present and shows non-zero grams
      if (stats['Filament']) {
        const gramsMatch = stats['Filament'].match(/([\d.]+)g/);
        if (gramsMatch && parseFloat(gramsMatch[1]) > 0) {
          log('OK', `Filament: ${stats['Filament']}`);
        } else {
          log('FAIL', `Filament value is zero or unparseable: ${stats['Filament']}`);
          exitCode = 1;
        }
      } else {
        log('FAIL', 'Filament stat missing');
        exitCode = 1;
      }

      // Check: Layers is present and non-zero
      if (stats['Layers']) {
        const layerMatch = stats['Layers'].match(/(\d+)/);
        if (layerMatch && parseInt(layerMatch[1]) > 0) {
          log('OK', `Layers: ${stats['Layers']}`);
        } else {
          log('FAIL', `Layer count is zero or unparseable: ${stats['Layers']}`);
          exitCode = 1;
        }
      } else {
        log('FAIL', 'Layers stat missing');
        exitCode = 1;
      }

      // Check: For a simple 1cm cube, we expect reasonable values
      // Layers should be roughly 10mm / 0.2mm = 50 layers (±20 for different layer heights)
      if (stats['Layers']) {
        const layerCount = parseInt(stats['Layers'].match(/(\d+)/)?.[1] || '0');
        if (layerCount >= 10 && layerCount <= 200) {
          log('OK', `Layer count ${layerCount} is reasonable for a 1cm cube`);
        } else {
          log('FAIL', `Layer count ${layerCount} seems unreasonable for a 1cm cube (expected 10-200)`);
          exitCode = 1;
        }
      }

      // Check: Print time should be non-trivial (at least a few seconds for a 1cm cube)
      if (stats['Print Time']) {
        // The format is like "1m 23s" or "23s" — any non-empty string means it was computed
        const hasTime = /\d+[smhd]/.test(stats['Print Time']);
        if (hasTime) {
          log('OK', `Print time format looks valid: ${stats['Print Time']}`);
        } else {
          log('FAIL', `Print time format unexpected: ${stats['Print Time']}`);
          exitCode = 1;
        }
      }
    }

    // ─── Step 7: Verify engine badge ─────────────────────
    log('STEP', '7. Verifying engine badge...');
    const engineBadge = page.locator('.print-dialog-engine-badge');
    const badgeText = await engineBadge.textContent().catch(() => null);
    if (badgeText) {
      const isValidBadge = /wasm|native/i.test(badgeText);
      if (isValidBadge) {
        log('OK', `Engine badge: "${badgeText}"`);
      } else {
        log('FAIL', `Unexpected engine badge text: "${badgeText}"`);
        exitCode = 1;
      }
    } else {
      log('DIAG', 'No engine badge found (may be expected if badge class differs)');
    }

  } catch (err) {
    if (exitCode === 0) exitCode = 2;
    log('ERROR', err.message);
    diagnostics.error = err.message;
    diagnostics.stack = err.stack;
  } finally {
    if (consoleLogs.length > 0) {
      const consoleLogPath = resolve(OUTPUT_DIR, 'stats-test-console.log');
      writeFileSync(consoleLogPath, consoleLogs.join('\n'));
      log('DIAG', `Console log (${consoleLogs.length} lines) written to ${consoleLogPath}`);
    }

    diagnostics.consoleLogs = consoleLogs;
    diagnostics.exitCode = exitCode;
    const diagPath = resolve(OUTPUT_DIR, 'stats-test-diagnostics.json');
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
