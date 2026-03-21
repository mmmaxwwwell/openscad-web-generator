#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * E2E Test: fi_mini_case.scad slicing with qr_code_text="google.com"
 *
 * Reproduces a "memory access out of bounds" crash in the libslic3r WASM
 * module when slicing the fi_mini_case multi-color 3MF model.
 *
 * Tests three variants to isolate the root cause:
 *   1. STL-only render + slice (single color, simpler geometry path)
 *   2. Multi-color 3MF render + slice (the crash case)
 *   3. Simple cube STL slice (baseline sanity check)
 *
 * Exit codes:
 *   0 = all variants passed
 *   1 = at least one variant failed (crash or validation error)
 *   2 = infrastructure error (server/browser failed to start)
 */

import { chromium } from 'playwright';
import { createServer } from 'vite';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const OUTPUT_DIR = resolve(PROJECT_ROOT, 'test-output');

const TIMEOUT_PAGE_LOAD = 30_000;
const TIMEOUT_RENDER = 180_000;
const TIMEOUT_SLICE = 300_000;

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${tag}] ${ts} ${msg}`);
}

async function screenshot(page, name) {
  const path = resolve(OUTPUT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  log('SCREENSHOT', path);
}

// ---------------------------------------------------------------------------
// Helpers: navigate, render, slice
// ---------------------------------------------------------------------------

/**
 * Navigate to an example, inject test printer, and wait for editor.
 */
async function loadExample(page, baseUrl, exampleFile) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_PAGE_LOAD });
  await page.evaluate(() => {
    localStorage.setItem('disclaimer-accepted', 'true');
    localStorage.setItem('moonraker-printers', JSON.stringify([{
      id: 'test-e2e',
      name: 'E2E Test Printer',
      address: 'http://localhost:0',
      profileId: 'ender3-s1',
      nozzleDiameter: 0.4,
    }]));
  });
  await page.goto(`${baseUrl}?example=${exampleFile}`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_PAGE_LOAD,
  });
  await page.locator('.export-controls').waitFor({ timeout: 10_000 });
}

/**
 * Click a render button and wait for it to complete.
 * @param {'first' | 'last'} which - 'first' for STL, 'last' for 3MF/multi-color
 * @returns {number} render time in ms
 */
async function renderModel(page, which = 'first') {
  const renderBtns = page.locator('.export-render-btn');
  const btn = which === 'last' ? renderBtns.last() : renderBtns.first();
  await btn.click();
  const start = Date.now();
  await btn.filter({ hasText: /Re-render/ }).waitFor({ timeout: TIMEOUT_RENDER });
  return Date.now() - start;
}

/**
 * Open print dialog, click slice, wait for result.
 * @param {'first' | 'last'} which - 'first' for STL, 'last' for multi-color 3MF
 * @returns {{ success: boolean, error?: string, gcode?: string, timeMs: number }}
 */
async function sliceModel(page, which = 'first') {
  // Open print dialog — pick the right "Send to Printer" button
  const sendBtns = page.locator('.send-to-printer-btn');
  const sendBtn = which === 'last' ? sendBtns.last() : sendBtns.first();
  await sendBtn.click();
  const printerOption = page.locator('.send-to-printer-option').first();
  try {
    await printerOption.waitFor({ timeout: 3000 });
    await printerOption.click();
  } catch { /* dialog may have opened directly */ }
  await page.locator('.print-dialog').waitFor({ timeout: 10_000 });

  // Click slice
  const sliceBtn = page.locator('.print-dialog-slice-btn');
  await sliceBtn.waitFor({ timeout: 5000 });
  if (await sliceBtn.isDisabled()) {
    await page.waitForFunction(() => {
      const btn = document.querySelector('.print-dialog-slice-btn');
      return btn && !btn.disabled;
    }, { timeout: 15_000 });
  }
  await sliceBtn.click();

  const start = Date.now();
  const result = await page.waitForFunction(() => {
    if (document.querySelector('.print-dialog-download-btn')) return 'done';
    if (document.querySelector('.print-dialog-error-detail')) return 'error';
    return null;
  }, null, { timeout: TIMEOUT_SLICE });

  const timeMs = Date.now() - start;
  const outcome = await result.jsonValue();

  if (outcome === 'error') {
    const errText = await page.locator('.print-dialog-error-detail').textContent().catch(() => 'unknown');
    return { success: false, error: errText, timeMs };
  }

  // Download GCode
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10_000 }),
    page.locator('.print-dialog-download-btn').click(),
  ]);
  const downloadPath = resolve(OUTPUT_DIR, `slice-${Date.now()}.gcode`);
  await download.saveAs(downloadPath);
  const gcode = readFileSync(downloadPath, 'utf-8');
  return { success: true, gcode, timeMs };
}

/**
 * Close the print dialog by pressing Escape.
 */
async function closePrintDialog(page) {
  await page.keyboard.press('Escape');
  // Wait for dialog to disappear
  try {
    await page.locator('.print-dialog').waitFor({ state: 'hidden', timeout: 3000 });
  } catch { /* may already be gone */ }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runTest() {
  let server = null;
  let browser = null;
  let exitCode = 0;
  const consoleLogs = [];
  const results = {};

  try {
    // ─── Start Vite Dev Server ─────────────────────────
    log('STEP', 'Starting Vite dev server...');
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
    log('OK', `Dev server at ${baseUrl}`);

    // ─── Launch Browser ────────────────────────────────
    log('STEP', 'Launching Chromium...');
    const chromiumPath = process.env.CHROMIUM_PATH || '/run/current-system/sw/bin/google-chrome-stable';
    browser = await chromium.launch({
      headless: true,
      executablePath: chromiumPath,
      args: ['--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('console', (msg) => {
      const entry = `[${msg.type()}] ${msg.text()}`;
      consoleLogs.push(entry);
      // Log slicer-related messages immediately
      if (entry.includes('slicer') || entry.includes('Slic3r') || msg.type() === 'error') {
        log('CONSOLE', entry);
      }
    });
    page.on('pageerror', (err) => {
      consoleLogs.push(`[pageerror] ${err.message}`);
      log('CONSOLE', `[pageerror] ${err.message}`);
    });
    log('OK', 'Browser launched');

    // ═══════════════════════════════════════════════════
    // Variant 1: Baseline — cube_1cm.scad STL slice
    // ═══════════════════════════════════════════════════
    log('STEP', '═══ Variant 1: cube_1cm.scad STL (baseline) ═══');
    await loadExample(page, baseUrl, 'cube_1cm.scad');
    const cubeRenderMs = await renderModel(page, 'first');
    log('OK', `Cube rendered in ${(cubeRenderMs / 1000).toFixed(1)}s`);

    const cubeResult = await sliceModel(page);
    results.cubeStl = cubeResult;
    if (cubeResult.success) {
      log('OK', `Cube STL sliced in ${(cubeResult.timeMs / 1000).toFixed(1)}s — ${cubeResult.gcode.length} bytes`);
    } else {
      log('FAIL', `Cube STL slice FAILED: ${cubeResult.error}`);
      exitCode = 1;
    }
    await closePrintDialog(page);

    // ═══════════════════════════════════════════════════
    // Variant 2: fi_mini_case STL-only (single color)
    // ═══════════════════════════════════════════════════
    log('STEP', '═══ Variant 2: fi_mini_case.scad STL (single color) ═══');
    await loadExample(page, baseUrl, 'fi_mini_case.scad');
    const fiStlRenderMs = await renderModel(page, 'first');
    log('OK', `fi_mini STL rendered in ${(fiStlRenderMs / 1000).toFixed(1)}s`);

    const fiStlResult = await sliceModel(page);
    results.fiMiniStl = fiStlResult;
    if (fiStlResult.success) {
      log('OK', `fi_mini STL sliced in ${(fiStlResult.timeMs / 1000).toFixed(1)}s — ${fiStlResult.gcode.length} bytes`);
    } else {
      log('FAIL', `fi_mini STL slice FAILED: ${fiStlResult.error}`);
      exitCode = 1;
    }
    await closePrintDialog(page);

    // ═══════════════════════════════════════════════════
    // Variant 3: fi_mini_case multi-color 3MF (the crash case)
    // ═══════════════════════════════════════════════════
    log('STEP', '═══ Variant 3: fi_mini_case.scad 3MF multi-color (google.com QR) ═══');
    // Reload to get fresh state
    await loadExample(page, baseUrl, 'fi_mini_case.scad');
    const fi3mfRenderMs = await renderModel(page, 'last');
    log('OK', `fi_mini 3MF rendered in ${(fi3mfRenderMs / 1000).toFixed(1)}s`);

    const fi3mfResult = await sliceModel(page, 'last');
    results.fiMini3mf = fi3mfResult;
    if (fi3mfResult.success) {
      log('OK', `fi_mini 3MF sliced in ${(fi3mfResult.timeMs / 1000).toFixed(1)}s — ${fi3mfResult.gcode.length} bytes`);

      // Validate multi-color: check for T1 extrusions
      const hasT1 = fi3mfResult.gcode.includes('\nT1');
      if (hasT1) {
        log('OK', 'GCode has T1 (white/QR) tool changes');
      } else {
        log('FAIL', 'GCode missing T1 tool changes — multi-color may not be working');
        exitCode = 1;
      }
    } else {
      log('FAIL', `fi_mini 3MF slice FAILED: ${fi3mfResult.error}`);
      exitCode = 1;
    }

    // ═══════════════════════════════════════════════════
    // Summary
    // ═══════════════════════════════════════════════════
    log('STEP', '═══ Summary ═══');
    log('RESULT', `Cube STL:       ${results.cubeStl?.success ? 'PASS' : 'FAIL — ' + (results.cubeStl?.error || 'unknown')}`);
    log('RESULT', `fi_mini STL:    ${results.fiMiniStl?.success ? 'PASS' : 'FAIL — ' + (results.fiMiniStl?.error || 'unknown')}`);
    log('RESULT', `fi_mini 3MF:    ${results.fiMini3mf?.success ? 'PASS' : 'FAIL — ' + (results.fiMini3mf?.error || 'unknown')}`);

    // Diagnostic: which variable caused the crash?
    if (!results.fiMini3mf?.success && results.fiMiniStl?.success) {
      log('DIAG', 'STL works but 3MF crashes → issue is multi-color/multi-extruder path');
    } else if (!results.fiMini3mf?.success && !results.fiMiniStl?.success) {
      log('DIAG', 'Both STL and 3MF fail → issue is model geometry, not multi-color');
    } else if (!results.fiMini3mf?.success && !results.cubeStl?.success) {
      log('DIAG', 'All variants fail → fundamental slicer issue');
    }

  } catch (err) {
    if (exitCode === 0) exitCode = 2;
    log('ERROR', err.message);
    if (err.stack) log('ERROR', err.stack);
  } finally {
    // Write console log
    const consoleLogPath = resolve(OUTPUT_DIR, 'fi-mini-slice-console.log');
    writeFileSync(consoleLogPath, consoleLogs.join('\n'));
    log('DIAG', `Console log: ${consoleLogPath} (${consoleLogs.length} messages)`);

    // Write results JSON
    const resultsPath = resolve(OUTPUT_DIR, 'fi-mini-slice-results.json');
    writeFileSync(resultsPath, JSON.stringify({
      exitCode,
      cubeStl: { success: results.cubeStl?.success, error: results.cubeStl?.error, timeMs: results.cubeStl?.timeMs },
      fiMiniStl: { success: results.fiMiniStl?.success, error: results.fiMiniStl?.error, timeMs: results.fiMiniStl?.timeMs },
      fiMini3mf: { success: results.fiMini3mf?.success, error: results.fiMini3mf?.error, timeMs: results.fiMini3mf?.timeMs },
    }, null, 2));
    log('DIAG', `Results: ${resultsPath}`);

    if (browser) try { await browser.close(); } catch {}
    if (server) try { await server.close(); } catch {}
  }

  process.exit(exitCode);
}

runTest();
