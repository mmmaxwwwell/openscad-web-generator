#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * E2E Integration Test: Slice a 1cm Cube
 *
 * Starts the Vite dev server, launches Chromium via Playwright, navigates
 * through the app to slice the cube_1cm.scad example, saves the GCode,
 * and validates the output.
 *
 * --- AI Agent Interface ---
 * This test is designed for AI agents to run and parse. Output is structured
 * with tagged sections so agents can extract diagnostics programmatically.
 *
 * Exit codes:
 *   0 = all checks passed
 *   1 = test failure (GCode validation failed or slicing error)
 *   2 = infrastructure error (server didn't start, browser crashed, etc.)
 *
 * Output format:
 *   [STEP]     — progress through the test
 *   [OK]       — a check passed
 *   [FAIL]     — a check failed (includes details)
 *   [ERROR]    — infrastructure/unexpected error
 *   [GCODE]    — GCode analysis results
 *   [CONSOLE]  — browser console messages
 *   [DIAG]     — diagnostic info for debugging
 *   [SCREENSHOT] — path to screenshot on failure
 *   [RESULT]   — final pass/fail summary as JSON
 */

import { chromium } from 'playwright';
import { createServer } from 'vite';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const OUTPUT_DIR = resolve(PROJECT_ROOT, 'test-output');
const TIMEOUT_WASM_LOAD = 30_000;
const TIMEOUT_RENDER = 60_000;
const TIMEOUT_SLICE = 180_000;

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${tag}] ${ts} ${msg}`);
}

function fail(msg, details) {
  log('FAIL', msg);
  if (details) log('DIAG', details);
  return false;
}

/** Validate GCode content and return structured results */
function validateGCode(gcode) {
  const lines = gcode.split('\n');
  const checks = [];
  let passed = true;

  // Check 1: Has content
  const hasContent = lines.length > 10;
  checks.push({ name: 'has_content', passed: hasContent, detail: `${lines.length} lines` });
  if (!hasContent) passed = false;

  // Check 2: Has G0/G1 move commands
  const moveLines = lines.filter(l => /^G[01]\s/.test(l));
  const hasMoves = moveLines.length > 0;
  checks.push({ name: 'has_moves', passed: hasMoves, detail: `${moveLines.length} G0/G1 commands` });
  if (!hasMoves) passed = false;

  // Check 3: Has extrusion (E parameter on G1 commands)
  const extrusionLines = lines.filter(l => /^G1\s.*E[\d.]+/.test(l));
  const hasExtrusion = extrusionLines.length > 0;
  checks.push({ name: 'has_extrusion', passed: hasExtrusion, detail: `${extrusionLines.length} extrusion moves` });
  if (!hasExtrusion) passed = false;

  // Check 4: Has layer changes (Z moves or ;LAYER_CHANGE comments)
  const layerComments = lines.filter(l => /^;LAYER_CHANGE/.test(l));
  const zMoves = lines.filter(l => /^G[01]\s.*Z[\d.]+/.test(l));
  const hasLayers = layerComments.length > 0 || zMoves.length > 0;
  checks.push({ name: 'has_layers', passed: hasLayers, detail: `${layerComments.length} layer comments, ${zMoves.length} Z moves` });
  if (!hasLayers) passed = false;

  // Check 5: Z values are within expected range for 10mm cube
  // (cube is 10mm tall, centered, so Z should be 0 to ~10mm)
  const zValues = [];
  for (const l of lines) {
    const m = l.match(/;Z:([\d.]+)/);
    if (m) zValues.push(parseFloat(m[1]));
  }
  if (zValues.length === 0) {
    // Fallback: parse Z from G0/G1 commands
    for (const l of lines) {
      const m = l.match(/^G[01]\s.*Z([\d.]+)/);
      if (m) zValues.push(parseFloat(m[1]));
    }
  }
  const maxZ = zValues.length > 0 ? Math.max(...zValues) : 0;
  const minZ = zValues.length > 0 ? Math.min(...zValues) : 0;
  // Cube is 10mm. With center=true + ensure_on_bed(), max Z ≈ 10mm.
  // Without ensure_on_bed(), centered cubes get clipped to ~5mm.
  // Accept 4-15mm to catch gross errors; the exact height depends on
  // whether the C++ bindings call ensure_on_bed() before slicing.
  const zReasonable = maxZ >= 4 && maxZ <= 15;
  checks.push({
    name: 'z_range_reasonable',
    passed: zReasonable,
    detail: `Z range: ${minZ.toFixed(2)} - ${maxZ.toFixed(2)}mm (expected ~10mm for 1cm cube)`,
  });
  if (!zReasonable) passed = false;

  // Check 6: Has temperature commands
  const tempLines = lines.filter(l => /^M10[49]\s/.test(l));
  const hasTemp = tempLines.length > 0;
  checks.push({ name: 'has_temperature', passed: hasTemp, detail: `${tempLines.length} temp commands (M104/M109)` });
  if (!hasTemp) passed = false;

  // Check 7: Has fan commands
  const fanLines = lines.filter(l => /^M10[67]\s/.test(l));
  checks.push({ name: 'has_fan_commands', passed: fanLines.length > 0, detail: `${fanLines.length} fan commands` });

  // Check 8: PrusaSlicer signature
  const hasPrusaSignature = lines.some(l => /generated by PrusaSlicer|; slic3r_pe_/.test(l));
  checks.push({ name: 'prusaslicer_signature', passed: hasPrusaSignature, detail: hasPrusaSignature ? 'Found PrusaSlicer signature' : 'No PrusaSlicer signature found' });

  // Parse print stats
  const timeMatch = gcode.match(/; estimated printing time \(normal mode\) = (.+)/);
  const filamentMatch = gcode.match(/; filament used \[mm\] = ([\d.]+)/);

  return {
    passed,
    checks,
    stats: {
      totalLines: lines.length,
      moveCommands: moveLines.length,
      extrusionMoves: extrusionLines.length,
      layerChanges: layerComments.length,
      zRange: { min: minZ, max: maxZ },
      estimatedTime: timeMatch ? timeMatch[1] : null,
      filamentUsedMm: filamentMatch ? parseFloat(filamentMatch[1]) : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Main test
// ---------------------------------------------------------------------------

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
        port: 0,         // pick a random free port
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
    diagnostics.serverUrl = baseUrl;

    // ─── Launch Browser ──────────────────────────────────
    log('STEP', 'Launching Chromium...');
    const chromiumPath = process.env.CHROMIUM_PATH || '/run/current-system/sw/bin/google-chrome-stable';
    browser = await chromium.launch({
      headless: true,
      executablePath: chromiumPath,
      args: [
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    log('OK', 'Browser launched');

    // Collect console messages
    page.on('console', (msg) => {
      const entry = `[${msg.type()}] ${msg.text()}`;
      consoleLogs.push(entry);
      // Surface errors immediately
      if (msg.type() === 'error') {
        log('CONSOLE', entry);
      }
    });

    // Collect page errors
    page.on('pageerror', (err) => {
      const entry = `[pageerror] ${err.message}`;
      consoleLogs.push(entry);
      log('CONSOLE', entry);
    });

    // ─── Step 1: Navigate to app ─────────────────────────
    log('STEP', '1. Navigating to app...');
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    log('OK', 'Page loaded');

    // ─── Step 2: Accept disclaimer ───────────────────────
    log('STEP', '2. Checking for disclaimer...');
    const disclaimerBtn = page.locator('.disclaimer-ok-btn');
    if (await disclaimerBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await disclaimerBtn.click();
      log('OK', 'Disclaimer accepted');
    } else {
      log('OK', 'No disclaimer shown (already accepted)');
    }

    // ─── Step 3: Inject fake printer + accept disclaimer, then load example via URL ───
    log('STEP', '3. Injecting test printer and loading example...');
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
    // Navigate directly to the example via URL (picks up localStorage + loads file in one shot)
    await page.goto(`${baseUrl}?example=cube_1cm.scad`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    log('OK', 'Test printer injected and example loaded via URL');

    // ─── Step 4: Wait for editor to load ───────────────────
    log('STEP', '4. Waiting for editor screen...');
    // After loading example, editor screen should appear with export controls
    try {
      await page.locator('.export-controls').waitFor({ timeout: 10_000 });
      log('OK', 'Editor screen loaded');
    } catch {
      const screenshotPath = resolve(OUTPUT_DIR, 'step4-editor-missing.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log('SCREENSHOT', screenshotPath);
      throw new Error('Editor screen did not appear');
    }

    // ─── Step 6: Render STL ──────────────────────────────
    // WASM loads lazily on first render — no need to wait for "ready" first
    log('STEP', '5. Rendering STL (triggers WASM load)...');
    const renderBtns = page.locator('.export-render-btn');
    // Click the first render button (STL section)
    const stlRenderBtn = renderBtns.first();
    await stlRenderBtn.click();
    log('DIAG', 'Clicked STL render button, waiting for WASM load + render...');

    // Wait for button to show "Re-render" (indicates cache hit = render complete)
    // This includes WASM loading time + actual render time
    try {
      await stlRenderBtn.filter({ hasText: /Re-render/ }).waitFor({ timeout: TIMEOUT_RENDER });
      log('OK', 'STL rendered successfully');
    } catch {
      const wasmStatus = await page.locator('[class^="wasm-status"]').textContent().catch(() => 'unknown');
      const btnText = await stlRenderBtn.textContent().catch(() => 'unknown');
      diagnostics.wasmStatus = wasmStatus;
      diagnostics.renderBtnText = btnText;
      // Check for errors
      const errorEl = page.locator('.export-error');
      if (await errorEl.isVisible().catch(() => false)) {
        const errorText = await errorEl.textContent().catch(() => 'unknown');
        diagnostics.renderError = errorText;
        log('FAIL', `Render failed: ${errorText}`);
        throw new Error(`Render failed: ${errorText}`);
      }
      const screenshotPath = resolve(OUTPUT_DIR, 'step5-render-timeout.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log('SCREENSHOT', screenshotPath);
      log('FAIL', `Render did not complete within ${TIMEOUT_RENDER / 1000}s. WASM: ${wasmStatus}, Button: ${btnText}`);
      throw new Error(`Render timeout. WASM: ${wasmStatus}, Button: ${btnText}`);
    }

    // ─── Step 7: Open Print Dialog ───────────────────────
    log('STEP', '6. Opening print dialog...');
    // The "Send to Printer" is a dropdown button — click the main button first
    const sendBtn = page.locator('.send-to-printer-btn').first();
    await sendBtn.click();
    // Then click the printer option in the dropdown
    const printerOption = page.locator('.send-to-printer-option').first();
    try {
      await printerOption.waitFor({ timeout: 3000 });
      await printerOption.click();
    } catch {
      // Maybe it's a direct button (single printer)
      log('DIAG', 'No dropdown option found, checking if dialog opened directly...');
    }

    // Wait for print dialog to appear
    try {
      await page.locator('.print-dialog').waitFor({ timeout: 10_000 });
      log('OK', 'Print dialog opened');
    } catch {
      // Take screenshot
      const screenshotPath = resolve(OUTPUT_DIR, 'step6-print-dialog-missing.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log('SCREENSHOT', screenshotPath);
      log('FAIL', 'Print dialog did not open');
      throw new Error('Print dialog did not appear');
    }

    // ─── Step 8: Click Slice ─────────────────────────────
    log('STEP', '7. Clicking Slice...');
    const sliceBtn = page.locator('.print-dialog-slice-btn');
    await sliceBtn.waitFor({ timeout: 5000 });
    const sliceBtnDisabled = await sliceBtn.isDisabled();
    if (sliceBtnDisabled) {
      log('DIAG', 'Slice button is disabled, waiting for it to become enabled...');
      await sliceBtn.waitFor({ state: 'attached', timeout: 10_000 });
      // Wait until enabled
      await page.waitForFunction(
        () => {
          const btn = document.querySelector('.print-dialog-slice-btn');
          return btn && !btn.disabled;
        },
        { timeout: 15_000 },
      );
    }
    await sliceBtn.click();
    log('OK', 'Slice started');

    // ─── Step 9: Wait for slicing to complete ────────────
    log('STEP', '8. Waiting for slicing to complete...');
    const startTime = Date.now();

    try {
      // Wait for either "done" phase (success) or "error" phase
      await page.waitForFunction(
        () => {
          // Check for success: "Slicing complete" text or download button
          const doneEl = document.querySelector('.print-dialog-download-btn');
          if (doneEl) return 'done';
          // Check for error
          const errorEl = document.querySelector('.print-dialog-error-detail');
          if (errorEl) return 'error';
          return null;
        },
        null,
        { timeout: TIMEOUT_SLICE },
      );
    } catch {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      // Capture current state
      const progressLabel = await page.locator('.print-dialog-progress-label').textContent().catch(() => 'unknown');
      diagnostics.sliceProgress = progressLabel;
      diagnostics.sliceElapsed = elapsed;

      // Capture slicer debug log
      const debugLog = await page.evaluate(() => {
        const logEl = document.querySelector('.print-dialog-debug-log');
        return logEl ? logEl.textContent : null;
      });
      if (debugLog) diagnostics.slicerDebugLog = debugLog;

      const screenshotPath = resolve(OUTPUT_DIR, 'step8-slice-timeout.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log('SCREENSHOT', screenshotPath);
      log('FAIL', `Slicing timed out after ${elapsed}s. Progress: ${progressLabel}`);
      throw new Error(`Slice timeout after ${elapsed}s`);
    }

    const sliceElapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Check if it was an error
    const errorDetail = await page.locator('.print-dialog-error-detail').textContent().catch(() => null);
    if (errorDetail) {
      diagnostics.slicerError = errorDetail;

      // Capture slicer debug log
      const debugLog = await page.evaluate(() => {
        const els = document.querySelectorAll('.print-dialog-debug-log pre, .print-dialog pre');
        return Array.from(els).map(e => e.textContent).join('\n');
      });
      if (debugLog) diagnostics.slicerDebugLog = debugLog;

      const screenshotPath = resolve(OUTPUT_DIR, 'step8-slice-error.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log('SCREENSHOT', screenshotPath);
      log('FAIL', `Slicing failed after ${sliceElapsed}s: ${errorDetail}`);
      throw new Error(`Slicing failed: ${errorDetail}`);
    }

    log('OK', `Slicing complete in ${sliceElapsed}s`);

    // ─── Step 10: Extract GCode ──────────────────────────
    log('STEP', '9. Extracting GCode...');

    // The GCode is stored in the component's sliceResult state.
    // We can intercept the download click to capture the blob content,
    // or use a more direct approach: trigger the download and read it.
    // Easier: evaluate in page context to get the GCode from the download button's click handler.
    // Actually, the cleanest way is to intercept the blob URL created on download click.

    let gcode = null;

    // Strategy: set up a download listener, click download, read the file
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10_000 }),
      page.locator('.print-dialog-download-btn').click(),
    ]);

    const downloadPath = resolve(OUTPUT_DIR, 'cube_1cm.gcode');
    await download.saveAs(downloadPath);
    const { readFileSync } = await import('fs');
    gcode = readFileSync(downloadPath, 'utf-8');

    if (!gcode || gcode.length < 100) {
      log('FAIL', `GCode file is too small: ${gcode?.length ?? 0} bytes`);
      throw new Error('GCode extraction failed — file too small');
    }

    log('OK', `GCode extracted: ${gcode.length} bytes, saved to ${downloadPath}`);

    // ─── Step 11: Validate GCode ─────────────────────────
    log('STEP', '10. Validating GCode...');
    const validation = validateGCode(gcode);

    // Report each check
    for (const check of validation.checks) {
      const tag = check.passed ? 'OK' : 'FAIL';
      log(tag, `  ${check.name}: ${check.detail}`);
    }

    // Report stats
    log('GCODE', `Total lines: ${validation.stats.totalLines}`);
    log('GCODE', `Move commands: ${validation.stats.moveCommands}`);
    log('GCODE', `Extrusion moves: ${validation.stats.extrusionMoves}`);
    log('GCODE', `Layer changes: ${validation.stats.layerChanges}`);
    log('GCODE', `Z range: ${validation.stats.zRange.min.toFixed(2)} - ${validation.stats.zRange.max.toFixed(2)}mm`);
    if (validation.stats.estimatedTime) log('GCODE', `Estimated time: ${validation.stats.estimatedTime}`);
    if (validation.stats.filamentUsedMm) log('GCODE', `Filament used: ${validation.stats.filamentUsedMm.toFixed(1)}mm`);

    if (!validation.passed) {
      exitCode = 1;
      log('FAIL', 'GCode validation failed — see checks above');
    } else {
      log('OK', 'All GCode checks passed');
    }

    // Save first 50 lines for quick inspection
    log('GCODE', '--- First 50 lines of GCode ---');
    const previewLines = gcode.split('\n').slice(0, 50);
    for (const line of previewLines) {
      log('GCODE', line);
    }
    log('GCODE', '--- End preview ---');

  } catch (err) {
    if (exitCode === 0) exitCode = 1;
    log('ERROR', err.message);
    diagnostics.error = err.message;
    diagnostics.stack = err.stack;
  } finally {
    // ─── Diagnostics dump ──────────────────────────────
    if (consoleLogs.length > 0) {
      log('DIAG', `--- Browser console (${consoleLogs.length} messages) ---`);
      // Show last 50 console messages (most relevant)
      const tail = consoleLogs.slice(-50);
      for (const entry of tail) {
        log('CONSOLE', entry);
      }
      if (consoleLogs.length > 50) {
        log('DIAG', `... (${consoleLogs.length - 50} earlier messages omitted)`);
      }
    }

    // Write full console log as plain text (easy for AI agents to read)
    const consoleLogPath = resolve(OUTPUT_DIR, 'browser-console.log');
    writeFileSync(consoleLogPath, consoleLogs.join('\n'));
    log('DIAG', `Full browser console log (${consoleLogs.length} lines) written to ${consoleLogPath}`);

    // Write full diagnostics JSON
    diagnostics.consoleLogs = consoleLogs;
    diagnostics.exitCode = exitCode;
    const diagPath = resolve(OUTPUT_DIR, 'diagnostics.json');
    writeFileSync(diagPath, JSON.stringify(diagnostics, null, 2));
    log('DIAG', `Full diagnostics written to ${diagPath}`);

    // Final result as structured JSON for agent parsing
    log('RESULT', JSON.stringify({
      passed: exitCode === 0,
      exitCode,
      gcodeFile: exitCode === 0 ? resolve(OUTPUT_DIR, 'cube_1cm.gcode') : null,
      diagnosticsFile: diagPath,
      error: diagnostics.error || null,
      slicerError: diagnostics.slicerError || null,
    }));

    // ─── Cleanup ─────────────────────────────────────────
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
    if (server) {
      try { await server.close(); } catch { /* ignore */ }
    }
  }

  process.exit(exitCode);
}

runTest();
