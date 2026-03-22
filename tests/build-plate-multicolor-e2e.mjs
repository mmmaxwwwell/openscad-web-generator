#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * E2E Integration Test: Build Plate Multi-Color Slicing
 *
 * Tests slicing multi-color objects on the build plate with GCode verification:
 * - Single multicolor object: tool changes, per-extruder bounds, wipe tower
 * - Mixed plate: multicolor + single-color objects together
 * - Prime tower configuration
 *
 * Uses param_multicolor.scad (two-color parametric cube) rendered as
 * Multi-Color 3MF and sent to build plate via ExportControls.
 *
 * --- AI Agent Interface ---
 * Exit codes: 0 = pass, 1 = fail, 2 = infra error
 * Output: [STEP] [OK] [FAIL] [ERROR] [SCREENSHOT] [RESULT]
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  log,
  setupPage,
  runTestSuite,
  TIMEOUT_RENDER,
  TIMEOUT_SLICE,
  OUTPUT_DIR,
} from './helpers/build-plate-harness.mjs';
import { validateMulticolorGCode } from './helpers/gcode-validators.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load param_multicolor.scad in the editor, render Multi-Color 3MF,
 * then send to build plate. Returns when the build plate overlay is open
 * with the multicolor object visible in the sidebar.
 */
async function sendMulticolorToBuildPlate(page, baseUrl) {
  // Load param_multicolor.scad in editor
  log('STEP', 'Loading param_multicolor.scad in editor...');
  await setupPage(page, baseUrl, { example: 'param_multicolor.scad' });
  await page.locator('.export-controls').waitFor({ timeout: 10_000 });
  log('OK', 'Editor screen loaded');

  // Click the Multi-Color 3MF Render button (3rd export section)
  log('STEP', 'Rendering Multi-Color 3MF...');
  const renderBtns = page.locator('.export-render-btn');
  const multicolorBtn = renderBtns.nth(2);
  await multicolorBtn.click();

  // Wait for render to complete — button text changes to "Re-render"
  try {
    await multicolorBtn.filter({ hasText: /Re-render/ }).waitFor({ timeout: TIMEOUT_RENDER });
    log('OK', 'Multi-Color 3MF rendered');
  } catch {
    const errorEl = page.locator('.export-error');
    if (await errorEl.isVisible().catch(() => false)) {
      const errorText = await errorEl.textContent().catch(() => 'unknown');
      throw new Error(`Multicolor render failed: ${errorText}`);
    }
    throw new Error('Multicolor render did not complete in time');
  }

  // Click "+ Build Plate" in the Multi-Color 3MF section
  log('STEP', 'Sending to build plate...');
  const buildPlateBtn = page.locator('.export-build-plate-btn').first();
  await buildPlateBtn.waitFor({ timeout: 5_000 });
  await buildPlateBtn.click();

  // Wait for build plate overlay + object in sidebar
  await page.locator('.build-plate-overlay').waitFor({ timeout: 10_000 });
  await page.locator('.build-plate-object-item').first().waitFor({ timeout: 10_000 });
  log('OK', 'Multicolor object on build plate');
}

/**
 * Install a GCode interceptor that captures GCode sent to the preview worker.
 * Must be called BEFORE clicking slice.
 */
async function installGCodeInterceptor(page) {
  await page.evaluate(() => {
    window.__capturedGCode = null;
    const origPostMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args) {
      const msg = args[0];
      if (msg && msg.type === 'parse' && typeof msg.gcode === 'string' && msg.gcode.length > 100) {
        window.__capturedGCode = msg.gcode;
      }
      return origPostMessage.apply(this, args);
    };
  });

  return async () => page.evaluate(() => window.__capturedGCode);
}

/**
 * Click "Slice Plate" and wait for completion, returning captured GCode.
 */
async function slicePlateAndGetGCode(page) {
  const getGCode = await installGCodeInterceptor(page);

  log('STEP', 'Clicking "Slice Plate"...');
  const sliceBtn = page.locator('.build-plate-btn--primary', { hasText: /Slice Plate|Slicing/ });
  await sliceBtn.waitFor({ timeout: 5_000 });

  // Ensure it's enabled
  await page.waitForFunction(
    () => {
      const btns = [...document.querySelectorAll('.build-plate-btn--primary')];
      const btn = btns.find(b => /Slice Plate/.test(b.textContent));
      return btn && !btn.disabled;
    },
    { timeout: 10_000 },
  );
  await sliceBtn.click();
  log('OK', 'Slice started');

  // Wait for result or error
  const startTime = Date.now();
  log('STEP', 'Waiting for slicing to complete...');

  try {
    await page.waitForFunction(
      () => {
        if (document.querySelector('.build-plate-slice-result')) return 'done';
        const errorEl = document.querySelector('.build-plate-scad-error');
        if (errorEl && errorEl.textContent?.includes('Slice error:')) return 'error';
        return null;
      },
      null,
      { timeout: TIMEOUT_SLICE },
    );
  } catch {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    throw new Error(`Slicing timed out after ${elapsed}s`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Check for error
  const sliceError = await page.evaluate(() => {
    const el = document.querySelector('.build-plate-scad-error');
    if (el && el.textContent?.includes('Slice error:')) return el.textContent;
    return null;
  });
  if (sliceError) {
    throw new Error(`Slicing failed after ${elapsed}s: ${sliceError}`);
  }

  log('OK', `Slicing complete in ${elapsed}s`);

  // Wait for GCode to be sent to preview worker
  await page.waitForFunction(
    () => window.__capturedGCode != null,
    null,
    { timeout: 10_000 },
  );

  const gcode = await getGCode();
  if (!gcode || gcode.length < 100) {
    throw new Error(`GCode too small: ${gcode?.length ?? 0} bytes`);
  }
  log('OK', `GCode captured: ${gcode.length} bytes`);

  return { gcode, elapsed };
}

/**
 * Add a SCAD example to the build plate via the picker dialog.
 */
async function addSCADToPlate(page, exampleName, expectedCount) {
  const scadBtn = page.locator('.build-plate-btn', { hasText: '+ SCAD' });
  await scadBtn.waitFor({ timeout: 10_000 });

  await page.waitForFunction(
    (text) => {
      const btns = [...document.querySelectorAll('.build-plate-btn')];
      const btn = btns.find(b => b.textContent?.includes(text));
      return btn && !btn.disabled;
    },
    '+ SCAD',
    { timeout: 30_000 },
  );
  await scadBtn.click();

  await page.locator('.build-plate-scad-picker').waitFor({ timeout: 5_000 });
  await page.locator('.build-plate-scad-picker-item', { hasText: exampleName }).click();

  if (expectedCount && expectedCount > 1) {
    await page.locator(`.build-plate-object-item:nth-child(${expectedCount})`).waitFor({ timeout: TIMEOUT_RENDER });
  } else {
    await page.locator('.build-plate-object-item').first().waitFor({ timeout: TIMEOUT_RENDER });
  }
}

// ---------------------------------------------------------------------------
// Test 1: Slice single multicolor object — tool changes + per-extruder bounds
// ---------------------------------------------------------------------------
async function testSliceMulticolorObject({ page, baseUrl }) {
  await sendMulticolorToBuildPlate(page, baseUrl);

  // Verify SCAD badge
  const badge = await page.locator('.build-plate-object-type-badge').first().textContent();
  if (badge !== 'SCAD') throw new Error(`Expected "SCAD" badge, got "${badge}"`);
  log('OK', 'Object has SCAD type badge');

  // Slice
  const { gcode, elapsed } = await slicePlateAndGetGCode(page);

  // Save GCode for inspection
  const gcodePath = resolve(OUTPUT_DIR, 'build-plate-multicolor.gcode');
  writeFileSync(gcodePath, gcode);
  log('OK', `GCode saved to ${gcodePath}`);

  // Validate with multicolor checks
  log('STEP', 'Validating multicolor GCode...');
  // Prime tower auto-enables for multicolor plates, so wipe tower should be present
  const validation = validateMulticolorGCode(gcode, {
    expectedExtruders: 2,
    requireWipeTower: true,
  });

  for (const check of validation.checks) {
    log(check.passed ? 'OK' : 'FAIL', `  ${check.name}: ${check.detail}`);
  }

  // Report stats
  log('GCODE', `Lines: ${validation.stats.totalLines}`);
  log('GCODE', `Moves: ${validation.stats.moveCommands}`);
  log('GCODE', `Extrusion: ${validation.stats.extrusionMoves}`);
  log('GCODE', `Layers: ${validation.stats.layerChanges}`);
  log('GCODE', `Z range: ${validation.stats.zRange.min.toFixed(2)}-${validation.stats.zRange.max.toFixed(2)}mm`);
  if (validation.stats.toolChanges !== undefined) log('GCODE', `Tool changes: ${validation.stats.toolChanges}`);
  if (validation.stats.estimatedTime) log('GCODE', `Time: ${validation.stats.estimatedTime}`);
  if (validation.stats.filamentUsedMm) log('GCODE', `Filament: ${validation.stats.filamentUsedMm.toFixed(1)}mm`);

  if (!validation.passed) {
    throw new Error('Multicolor GCode validation failed — see checks above');
  }
  log('OK', `All multicolor GCode checks passed (sliced in ${elapsed}s)`);

  // Verify print stats in UI
  log('STEP', 'Checking print stats in UI...');
  const statsEl = page.locator('.build-plate-slice-stats');
  await statsEl.waitFor({ timeout: 5_000 });
  const statsText = await statsEl.textContent();
  log('DIAG', `Stats display: "${statsText}"`);
  if (statsText && (statsText.includes('Time:') || statsText.includes('Filament:'))) {
    log('OK', 'Print stats displayed in UI');
  } else {
    log('DIAG', 'Print stats text not found in expected format (non-fatal)');
  }
}

// ---------------------------------------------------------------------------
// Test 2: Mixed plate — multicolor + single-color objects
// ---------------------------------------------------------------------------
async function testMixedPlateMulticolor({ page, baseUrl }) {
  // First, send multicolor object to build plate via editor
  await sendMulticolorToBuildPlate(page, baseUrl);
  log('OK', 'Multicolor object on plate');

  // Now add a single-color SCAD cube via the picker
  log('STEP', 'Adding single-color 1cm Cube via SCAD picker...');
  await addSCADToPlate(page, '1cm Cube', 2);
  const count = await page.locator('.build-plate-object-item').count();
  if (count !== 2) throw new Error(`Expected 2 objects, got ${count}`);
  log('OK', `Mixed plate: ${count} objects (1 multicolor + 1 single-color)`);

  // Auto-arrange to spread objects apart
  log('STEP', 'Auto-arranging objects...');
  await page.locator('.build-plate-btn', { hasText: 'Arrange' }).click();
  await page.waitForTimeout(500);

  // Slice
  const { gcode, elapsed } = await slicePlateAndGetGCode(page);

  // Save GCode
  const gcodePath = resolve(OUTPUT_DIR, 'build-plate-mixed-multicolor.gcode');
  writeFileSync(gcodePath, gcode);
  log('OK', `GCode saved to ${gcodePath}`);

  // Validate — should still have tool changes from the multicolor object
  // Prime tower auto-enables for multicolor plates, so wipe tower should be present
  log('STEP', 'Validating mixed plate GCode...');
  const validation = validateMulticolorGCode(gcode, {
    expectedExtruders: 2,
    requireWipeTower: true,
  });

  for (const check of validation.checks) {
    log(check.passed ? 'OK' : 'FAIL', `  ${check.name}: ${check.detail}`);
  }

  log('GCODE', `Lines: ${validation.stats.totalLines}`);
  log('GCODE', `Moves: ${validation.stats.moveCommands}`);
  log('GCODE', `Extrusion: ${validation.stats.extrusionMoves}`);
  log('GCODE', `Layers: ${validation.stats.layerChanges}`);
  if (validation.stats.toolChanges !== undefined) log('GCODE', `Tool changes: ${validation.stats.toolChanges}`);
  if (validation.stats.filamentUsedMm) log('GCODE', `Filament: ${validation.stats.filamentUsedMm.toFixed(1)}mm`);

  if (!validation.passed) {
    throw new Error('Mixed plate GCode validation failed — see checks above');
  }

  // Filament should be more than single multicolor (extra cube at single-color)
  if (validation.stats.filamentUsedMm) {
    log('OK', `Mixed plate filament: ${validation.stats.filamentUsedMm.toFixed(1)}mm (multicolor + single)`);
  }

  log('OK', `Mixed plate multicolor test complete (sliced in ${elapsed}s)`);
}

// ---------------------------------------------------------------------------
// Test 3: Prime tower ENABLED — wipe tower must appear in GCode
// ---------------------------------------------------------------------------
async function testPrimeTowerEnabled({ page, baseUrl }) {
  // Send multicolor object to build plate (auto-enables prime tower)
  await sendMulticolorToBuildPlate(page, baseUrl);

  // Open Plate Settings panel to verify prime tower checkbox
  log('STEP', 'Verifying prime tower is auto-enabled for multicolor...');
  const settingsBtn = page.locator('.build-plate-btn', { hasText: 'Settings' });
  await settingsBtn.click();

  const primeTowerCheckbox = page.locator('.build-plate-prime-tower-config input[type="checkbox"]');
  await primeTowerCheckbox.waitFor({ timeout: 5_000 });
  const isChecked = await primeTowerCheckbox.isChecked();
  if (!isChecked) {
    throw new Error('Prime tower should be auto-enabled for multicolor plates');
  }
  log('OK', 'Prime tower checkbox is checked (auto-enabled)');

  // Verify prime tower config inputs are visible (width, brim, position)
  const configInputs = page.locator('.build-plate-prime-tower-config input[type="number"]');
  const inputCount = await configInputs.count();
  if (inputCount < 3) {
    throw new Error(`Expected at least 3 prime tower config inputs (width, brim, position), got ${inputCount}`);
  }
  log('OK', `Prime tower config visible: ${inputCount} inputs`);

  // Slice and verify wipe tower lines in GCode
  log('STEP', 'Slicing with prime tower enabled...');
  const { gcode, elapsed } = await slicePlateAndGetGCode(page);

  const gcodePath = resolve(OUTPUT_DIR, 'build-plate-prime-tower-enabled.gcode');
  writeFileSync(gcodePath, gcode);

  const wipeTowerLines = gcode.split('\n').filter(l => l.includes(';TYPE:Wipe tower'));
  if (wipeTowerLines.length === 0) {
    throw new Error('Wipe tower lines (;TYPE:Wipe tower) NOT found in GCode — prime tower enabled but slicer did not generate wipe tower');
  }
  log('OK', `Wipe tower present in GCode: ${wipeTowerLines.length} lines`);

  // Verify tool changes
  const toolChanges = gcode.split('\n').filter(l => /^T\d+/.test(l.trim()));
  if (toolChanges.length === 0) {
    throw new Error('No tool changes found — multicolor slicing failed');
  }
  log('OK', `Tool changes: ${toolChanges.length}`);

  log('OK', `Prime tower enabled test passed (sliced in ${elapsed}s)`);
}

// ---------------------------------------------------------------------------
// Test 4: Prime tower DISABLED — no wipe tower in GCode
// ---------------------------------------------------------------------------
async function testPrimeTowerDisabled({ page, baseUrl }) {
  // Send multicolor object to build plate (auto-enables prime tower)
  await sendMulticolorToBuildPlate(page, baseUrl);

  // Open Plate Settings panel and disable prime tower
  log('STEP', 'Disabling prime tower...');
  const settingsBtn = page.locator('.build-plate-btn', { hasText: 'Settings' });
  await settingsBtn.click();

  const primeTowerCheckbox = page.locator('.build-plate-prime-tower-config input[type="checkbox"]');
  await primeTowerCheckbox.waitFor({ timeout: 5_000 });

  // Verify it's currently checked (auto-enabled), then uncheck
  const isChecked = await primeTowerCheckbox.isChecked();
  if (!isChecked) {
    throw new Error('Prime tower should be auto-enabled before we can disable it');
  }
  await primeTowerCheckbox.uncheck();
  log('OK', 'Prime tower checkbox unchecked');

  // Verify config inputs are hidden when disabled
  const configInputs = page.locator('.build-plate-prime-tower-config input[type="number"]');
  const inputCount = await configInputs.count();
  if (inputCount > 0) {
    throw new Error(`Prime tower config inputs should be hidden when disabled, got ${inputCount}`);
  }
  log('OK', 'Prime tower config inputs hidden');

  // Slice and verify NO wipe tower lines in GCode
  log('STEP', 'Slicing with prime tower disabled...');
  const { gcode, elapsed } = await slicePlateAndGetGCode(page);

  const gcodePath = resolve(OUTPUT_DIR, 'build-plate-prime-tower-disabled.gcode');
  writeFileSync(gcodePath, gcode);

  const wipeTowerLines = gcode.split('\n').filter(l => l.includes(';TYPE:Wipe tower'));
  if (wipeTowerLines.length > 0) {
    throw new Error(`Wipe tower lines found in GCode (${wipeTowerLines.length}) but prime tower was disabled`);
  }
  log('OK', 'No wipe tower lines in GCode (correctly disabled)');

  // Tool changes should still be present (multi-extruder slicing works without wipe tower)
  const toolChanges = gcode.split('\n').filter(l => /^T\d+/.test(l.trim()));
  if (toolChanges.length === 0) {
    throw new Error('No tool changes found — multicolor slicing failed');
  }
  log('OK', `Tool changes still present: ${toolChanges.length} (multicolor works without wipe tower)`);

  log('OK', `Prime tower disabled test passed (sliced in ${elapsed}s)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
runTestSuite('build-plate-multicolor', [
  { name: 'slice-multicolor-object', fn: testSliceMulticolorObject },
  { name: 'mixed-plate-multicolor', fn: testMixedPlateMulticolor },
  { name: 'prime-tower-enabled', fn: testPrimeTowerEnabled },
  { name: 'prime-tower-disabled', fn: testPrimeTowerDisabled },
]);
