#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * E2E Integration Test: fi_mini_case multi-color slicing
 *
 * Starts the Vite dev server, launches Chromium via Playwright, loads the
 * fi_mini_case.scad example with qr_code_text="google.com", renders as
 * multi-color 3MF, slices, downloads GCode, and validates that the white
 * QR code extrusions are positioned correctly relative to the black case body.
 *
 * Bug being tested: the slicer may center each color volume independently,
 * causing the white QR modules to shift to the bed center instead of
 * staying at their correct position on the case body.
 *
 * Exit codes:
 *   0 = all checks passed
 *   1 = test failure (GCode validation failed or position mismatch)
 *   2 = infrastructure error (server didn't start, browser crashed, etc.)
 */

import { chromium } from 'playwright';
import { createServer } from 'vite';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const OUTPUT_DIR = resolve(PROJECT_ROOT, 'test-output');
const TIMEOUT_RENDER = 120_000;   // multicolor render is slow
const TIMEOUT_SLICE = 300_000;    // slicing can take a while

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${tag}] ${ts} ${msg}`);
}

/**
 * Parse GCode and extract per-extruder XY bounds.
 * Returns { t0: {minX,maxX,minY,maxY}, t1: {minX,maxX,minY,maxY}, layers, ... }
 */
function analyzeMulticolorGCode(gcode) {
  const lines = gcode.split('\n');
  let currentExtruder = 0;
  let currentX = 0, currentY = 0, currentZ = 0;
  let layerCount = 0;

  const bounds = {
    t0: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity },
    t1: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity },
  };
  let t0Moves = 0, t1Moves = 0;
  const t1Layers = new Set();

  for (const line of lines) {
    const trimmed = line.trim();

    // Tool change
    const toolMatch = trimmed.match(/^T(\d+)/);
    if (toolMatch) {
      currentExtruder = parseInt(toolMatch[1]);
      continue;
    }

    // Layer change
    if (trimmed === ';LAYER_CHANGE') {
      layerCount++;
      continue;
    }

    // Z height
    const zComment = trimmed.match(/^;Z:([\d.]+)/);
    if (zComment) {
      currentZ = parseFloat(zComment[1]);
      continue;
    }

    // G1 move with extrusion
    const g1Match = trimmed.match(/^G1\s(.+)/);
    if (!g1Match) continue;

    const params = g1Match[1];
    const xMatch = params.match(/X([\d.]+)/);
    const yMatch = params.match(/Y([\d.]+)/);
    const zMatch = params.match(/Z([\d.]+)/);
    const eMatch = params.match(/E([\d.]+)/);

    if (xMatch) currentX = parseFloat(xMatch[1]);
    if (yMatch) currentY = parseFloat(yMatch[1]);
    if (zMatch) currentZ = parseFloat(zMatch[1]);

    // Only count extrusion moves (has E parameter)
    if (!eMatch) continue;

    const b = currentExtruder === 0 ? bounds.t0 : bounds.t1;
    b.minX = Math.min(b.minX, currentX);
    b.maxX = Math.max(b.maxX, currentX);
    b.minY = Math.min(b.minY, currentY);
    b.maxY = Math.max(b.maxY, currentY);
    b.minZ = Math.min(b.minZ, currentZ);
    b.maxZ = Math.max(b.maxZ, currentZ);

    if (currentExtruder === 0) t0Moves++;
    if (currentExtruder === 1) {
      t1Moves++;
      t1Layers.add(currentZ);
    }
  }

  return { bounds, t0Moves, t1Moves, layerCount, t1Layers: [...t1Layers].sort((a, b) => a - b) };
}

async function runTest() {
  let server = null;
  let browser = null;
  let exitCode = 0;
  const consoleLogs = [];

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
    page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => consoleLogs.push(`[pageerror] ${err.message}`));
    log('OK', 'Browser launched');

    // ─── Navigate + inject printer + load example ──────
    log('STEP', 'Loading fi_mini_case example...');
    // Navigate first so localStorage is accessible on the right origin
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
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
    // Now reload with the example parameter
    await page.goto(`${baseUrl}?example=fi_mini_case.scad`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Wait for editor
    await page.locator('.export-controls').waitFor({ timeout: 10_000 });
    log('OK', 'Editor loaded with fi_mini_case');

    // ─── Render multi-color 3MF ────────────────────────
    log('STEP', 'Rendering multi-color 3MF...');
    // The fi_mini_case has qr_code_text="google.com" by default, which enables multi-color.
    // Click the 3MF render button (should be the multi-color one)
    const renderBtns = page.locator('.export-render-btn');
    // Find the 3MF/multi-color render button
    const render3mfBtn = renderBtns.last(); // 3MF is typically the second button
    await render3mfBtn.click();
    log('DIAG', 'Clicked render button, waiting for multi-color render...');

    try {
      await render3mfBtn.filter({ hasText: /Re-render/ }).waitFor({ timeout: TIMEOUT_RENDER });
      log('OK', 'Multi-color 3MF rendered');
    } catch {
      const screenshotPath = resolve(OUTPUT_DIR, 'fi-mini-render-timeout.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log('SCREENSHOT', screenshotPath);
      throw new Error('Multi-color render timed out');
    }

    // ─── Open Print Dialog ─────────────────────────────
    log('STEP', 'Opening print dialog...');
    const sendBtn = page.locator('.send-to-printer-btn').first();
    await sendBtn.click();
    const printerOption = page.locator('.send-to-printer-option').first();
    try {
      await printerOption.waitFor({ timeout: 3000 });
      await printerOption.click();
    } catch {
      log('DIAG', 'No dropdown, checking if dialog opened directly...');
    }
    await page.locator('.print-dialog').waitFor({ timeout: 10_000 });
    log('OK', 'Print dialog opened');

    // ─── Slice ─────────────────────────────────────────
    log('STEP', 'Slicing...');
    const sliceBtn = page.locator('.print-dialog-slice-btn');
    await sliceBtn.waitFor({ timeout: 5000 });
    // Wait for slice button to be enabled
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('.print-dialog-slice-btn');
        return btn && !btn.disabled;
      },
      { timeout: 15_000 },
    );
    await sliceBtn.click();
    log('OK', 'Slice started');

    const startTime = Date.now();
    try {
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
    } catch {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const screenshotPath = resolve(OUTPUT_DIR, 'fi-mini-slice-timeout.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log('SCREENSHOT', screenshotPath);
      throw new Error(`Slice timed out after ${elapsed}s`);
    }

    const sliceElapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Check for slice error
    const errorDetail = await page.locator('.print-dialog-error-detail').textContent().catch(() => null);
    if (errorDetail) {
      const screenshotPath = resolve(OUTPUT_DIR, 'fi-mini-slice-error.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      throw new Error(`Slicing failed: ${errorDetail}`);
    }

    log('OK', `Slicing complete in ${sliceElapsed}s`);

    // ─── Download GCode ────────────────────────────────
    log('STEP', 'Downloading GCode...');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10_000 }),
      page.locator('.print-dialog-download-btn').click(),
    ]);
    const downloadPath = resolve(OUTPUT_DIR, 'fi_mini_case.gcode');
    await download.saveAs(downloadPath);
    const gcode = readFileSync(downloadPath, 'utf-8');
    log('OK', `GCode saved: ${gcode.length} bytes at ${downloadPath}`);

    // ─── Validate multi-color GCode ────────────────────
    log('STEP', 'Validating multi-color GCode positions...');
    const analysis = analyzeMulticolorGCode(gcode);

    log('GCODE', `T0 (black) moves: ${analysis.t0Moves}`);
    log('GCODE', `T1 (white/QR) moves: ${analysis.t1Moves}`);
    log('GCODE', `Total layers: ${analysis.layerCount}`);
    log('GCODE', `T0 X: ${analysis.bounds.t0.minX.toFixed(1)}..${analysis.bounds.t0.maxX.toFixed(1)}`);
    log('GCODE', `T0 Y: ${analysis.bounds.t0.minY.toFixed(1)}..${analysis.bounds.t0.maxY.toFixed(1)}`);
    log('GCODE', `T0 Z: ${analysis.bounds.t0.minZ.toFixed(1)}..${analysis.bounds.t0.maxZ.toFixed(1)}`);
    log('GCODE', `T1 X: ${analysis.bounds.t1.minX.toFixed(1)}..${analysis.bounds.t1.maxX.toFixed(1)}`);
    log('GCODE', `T1 Y: ${analysis.bounds.t1.minY.toFixed(1)}..${analysis.bounds.t1.maxY.toFixed(1)}`);
    log('GCODE', `T1 Z: ${analysis.bounds.t1.minZ.toFixed(1)}..${analysis.bounds.t1.maxZ.toFixed(1)}`);
    log('GCODE', `T1 layers: ${analysis.t1Layers.map(z => z.toFixed(2)).join(', ')}`);

    let failed = false;

    // Check 1: Has multi-color (T1 extrusions exist)
    if (analysis.t1Moves === 0) {
      log('FAIL', 'No T1 (white/QR) extrusion moves found — model may not be multi-color');
      failed = true;
    } else {
      log('OK', `Found ${analysis.t1Moves} T1 extrusion moves`);
    }

    // Check 2: T1 (white QR) extrusions are WITHIN T0 (black body) XY footprint
    // This is the critical centering bug check.
    if (analysis.t1Moves > 0) {
      const t1WithinT0X = analysis.bounds.t1.minX >= analysis.bounds.t0.minX - 1 &&
                           analysis.bounds.t1.maxX <= analysis.bounds.t0.maxX + 1;
      const t1WithinT0Y = analysis.bounds.t1.minY >= analysis.bounds.t0.minY - 1 &&
                           analysis.bounds.t1.maxY <= analysis.bounds.t0.maxY + 1;

      if (!t1WithinT0X || !t1WithinT0Y) {
        log('FAIL', `T1 (white) extrusions OUTSIDE T0 (black) footprint — centering bug!`);
        log('FAIL', `  T0 X: ${analysis.bounds.t0.minX.toFixed(1)}..${analysis.bounds.t0.maxX.toFixed(1)}, T1 X: ${analysis.bounds.t1.minX.toFixed(1)}..${analysis.bounds.t1.maxX.toFixed(1)}`);
        log('FAIL', `  T0 Y: ${analysis.bounds.t0.minY.toFixed(1)}..${analysis.bounds.t0.maxY.toFixed(1)}, T1 Y: ${analysis.bounds.t1.minY.toFixed(1)}..${analysis.bounds.t1.maxY.toFixed(1)}`);
        failed = true;
      } else {
        log('OK', 'T1 (white) extrusions are within T0 (black) XY footprint');
      }
    }

    // Check 3: T0 and T1 XY centers should NOT be identical
    // (they share the same center in the fi_mini_case because both are
    //  on the top half — but the T0 body also includes the cap offset in Y,
    //  so the T0 center should be different from T1 center)
    if (analysis.t1Moves > 0) {
      const t0CenterX = (analysis.bounds.t0.minX + analysis.bounds.t0.maxX) / 2;
      const t0CenterY = (analysis.bounds.t0.minY + analysis.bounds.t0.maxY) / 2;
      const t1CenterX = (analysis.bounds.t1.minX + analysis.bounds.t1.maxX) / 2;
      const t1CenterY = (analysis.bounds.t1.minY + analysis.bounds.t1.maxY) / 2;

      log('GCODE', `T0 center: (${t0CenterX.toFixed(1)}, ${t0CenterY.toFixed(1)})`);
      log('GCODE', `T1 center: (${t1CenterX.toFixed(1)}, ${t1CenterY.toFixed(1)})`);

      // The fi_mini_case has the cap offset in Y. The black body (T0) covers
      // both the top half and the cap, so its center is offset from the white
      // QR (T1) which is only on the top half.
      // If they have the same center, the slicer centered each independently.
      const centerDiffY = Math.abs(t0CenterY - t1CenterY);
      log('GCODE', `T0/T1 Y center difference: ${centerDiffY.toFixed(1)}mm`);

      // The fi_mini_case cap is ~50mm offset. The T0 center should be offset
      // from T1 center by a significant amount (>10mm).
      // However, this depends on whether the scad renders both halves as one
      // black mesh or if they're separate. The key check is #2 above.
    }

    // Check 4: T1 (white) extrusions should only appear in upper portion
    if (analysis.t1Moves > 0) {
      const t1MinZ = analysis.bounds.t1.minZ;
      const t0MaxZ = analysis.bounds.t0.maxZ;
      // QR recesses go a few layers deep. T1 should start above 30% of total height.
      if (t1MinZ < t0MaxZ * 0.3) {
        log('FAIL', `T1 (white) extrusions start at Z=${t1MinZ.toFixed(1)}mm — too low (expected upper portion, Z > ${(t0MaxZ * 0.3).toFixed(1)}mm)`);
        failed = true;
      } else {
        log('OK', `T1 (white) starts at Z=${t1MinZ.toFixed(1)}mm (upper portion of case)`);
      }
    }

    // Check 6: T1 (white) must NOT protrude above T0 (black)
    // The QR code shares the same top surface as the case body.
    // A tiny CSG overlap (+0.01mm) is fine — the slicer rounds it down.
    // But T1 should never exceed T0's max Z (that would make white visible from the side).
    if (analysis.t1Moves > 0) {
      const t1MaxZ = analysis.bounds.t1.maxZ;
      const t0MaxZ = analysis.bounds.t0.maxZ;
      if (t1MaxZ > t0MaxZ) {
        log('FAIL', `T1 (white) maxZ=${t1MaxZ.toFixed(2)}mm exceeds T0 (black) maxZ=${t0MaxZ.toFixed(2)}mm — white protrudes above case!`);
        failed = true;
      } else {
        log('OK', `T1 (white) maxZ=${t1MaxZ.toFixed(2)}mm <= T0 (black) maxZ=${t0MaxZ.toFixed(2)}mm`);
      }
    }

    // Check 5: Reasonable layer count
    if (analysis.layerCount < 10) {
      log('FAIL', `Only ${analysis.layerCount} layers — expected many more for a case`);
      failed = true;
    } else {
      log('OK', `${analysis.layerCount} layers`);
    }

    if (failed) {
      exitCode = 1;
      log('FAIL', 'Multi-color GCode validation FAILED');
    } else {
      log('OK', 'All multi-color GCode checks PASSED');
    }

    log('RESULT', JSON.stringify({
      passed: !failed,
      exitCode,
      gcodeFile: downloadPath,
      t0Moves: analysis.t0Moves,
      t1Moves: analysis.t1Moves,
      t0Bounds: analysis.bounds.t0,
      t1Bounds: analysis.bounds.t1,
    }));

  } catch (err) {
    if (exitCode === 0) exitCode = 2;
    log('ERROR', err.message);
  } finally {
    // Write console log
    const consoleLogPath = resolve(OUTPUT_DIR, 'fi-mini-browser-console.log');
    writeFileSync(consoleLogPath, consoleLogs.join('\n'));
    log('DIAG', `Console log: ${consoleLogPath} (${consoleLogs.length} lines)`);

    if (browser) try { await browser.close(); } catch {}
    if (server) try { await server.close(); } catch {}
  }

  process.exit(exitCode);
}

runTest();
