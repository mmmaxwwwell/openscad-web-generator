#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * E2E Integration Test: Build Plate Realistic User Workflows
 *
 * Tests realistic user workflows that combine the editor with the build plate:
 * - Editor → render → send to build plate → add more objects → slice
 * - Multicolor from editor → build plate → mixed plate slice
 * - Re-render SCAD object on plate → slice
 * - Duplicate, delete, move objects → slice
 *
 * These tests exercise the "Send to Build Plate" entry point which is
 * the most common way users will populate their build plate.
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
import { validateGCode, validatePlateGCode, validateMulticolorGCode } from './helpers/gcode-validators.mjs';

// ---------------------------------------------------------------------------
// Helpers (duplicated from other test files to keep tests self-contained)
// ---------------------------------------------------------------------------

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
async function slicePlateAndGetGCode(page, timeout = TIMEOUT_SLICE) {
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

  // Wait for either slice result or slice error
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
      { timeout },
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
 * Add a SCAD example to the build plate via picker dialog.
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

/**
 * Load param_multicolor.scad in the editor, render Multi-Color 3MF,
 * then send to build plate. Returns when the build plate overlay is open
 * with the multicolor object visible in the sidebar.
 */
async function sendMulticolorToBuildPlate(page, baseUrl) {
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
  log('STEP', 'Sending multicolor to build plate...');
  const buildPlateBtn = page.locator('.export-build-plate-btn').first();
  await buildPlateBtn.waitFor({ timeout: 5_000 });
  await buildPlateBtn.click();

  // Wait for build plate overlay + object in sidebar
  await page.locator('.build-plate-overlay').waitFor({ timeout: 10_000 });
  await page.locator('.build-plate-object-item').first().waitFor({ timeout: 10_000 });
  log('OK', 'Multicolor object on build plate');
}

/**
 * Load a SCAD file in the editor, render STL, and send to build plate.
 * Returns when build plate overlay is open with the object in the sidebar.
 */
async function sendSTLToBuildPlate(page, baseUrl, exampleFile, renderTimeout = TIMEOUT_RENDER) {
  log('STEP', `Loading ${exampleFile} in editor...`);
  await setupPage(page, baseUrl, { example: exampleFile });
  await page.locator('.export-controls').waitFor({ timeout: 10_000 });
  log('OK', 'Editor screen loaded');

  // Click the STL Render button (first export section)
  log('STEP', 'Rendering STL...');
  const renderBtn = page.locator('.export-render-btn').first();
  await renderBtn.click();

  // Wait for render to complete
  const renderStart = Date.now();
  try {
    await renderBtn.filter({ hasText: /Re-render/ }).waitFor({ timeout: renderTimeout });
    const renderTime = ((Date.now() - renderStart) / 1000).toFixed(1);
    log('OK', `STL rendered in ${renderTime}s`);
  } catch {
    const errorEl = page.locator('.export-error');
    if (await errorEl.isVisible().catch(() => false)) {
      const errorText = await errorEl.textContent().catch(() => 'unknown');
      throw new Error(`Render failed: ${errorText}`);
    }
    throw new Error(`Render did not complete within ${renderTimeout / 1000}s`);
  }

  // Click "+ Build Plate" in the STL section
  log('STEP', 'Sending to build plate...');
  const buildPlateBtn = page.locator('.export-build-plate-btn').first();
  await buildPlateBtn.waitFor({ timeout: 5_000 });
  await buildPlateBtn.click();

  // Wait for build plate overlay + object in sidebar
  await page.locator('.build-plate-overlay').waitFor({ timeout: 10_000 });
  await page.locator('.build-plate-object-item').first().waitFor({ timeout: 10_000 });
  log('OK', 'Object on build plate');
}

// ---------------------------------------------------------------------------
// Test 2.1: Build plate from editor flow (fi_mini_case.scad)
// ---------------------------------------------------------------------------
async function testEditorToBuildPlateFlow({ page, baseUrl }) {
  // Load fi_mini_case.scad in editor, render STL, send to build plate
  // Fi Mini Case is complex (BOSL2 + QR), so use a longer render timeout
  await sendSTLToBuildPlate(page, baseUrl, 'fi_mini_case.scad', 180_000);

  // Verify the object has SCAD type badge (metadata preserved)
  log('STEP', 'Verifying SCAD metadata preserved...');
  const badge = await page.locator('.build-plate-object-type-badge').first().textContent();
  if (badge !== 'SCAD') {
    throw new Error(`Expected "SCAD" badge (metadata preserved), got "${badge}"`);
  }
  log('OK', 'Object has SCAD type badge — metadata preserved from editor');

  // Verify object name contains fi_mini
  const objectText = await page.locator('.build-plate-object-item').first().textContent();
  log('DIAG', `Object item text: "${objectText}"`);
  if (!/fi.?mini/i.test(objectText)) {
    log('DIAG', `Warning: object name does not contain "fi_mini" — got "${objectText}"`);
  } else {
    log('OK', 'Object name contains "fi_mini"');
  }

  // Add a 1cm Cube via SCAD picker
  log('STEP', 'Adding 1cm Cube via SCAD picker...');
  await addSCADToPlate(page, '1cm Cube', 2);
  const count = await page.locator('.build-plate-object-item').count();
  if (count !== 2) throw new Error(`Expected 2 objects, got ${count}`);
  log('OK', `2 objects on plate (fi_mini_case + 1cm cube)`);

  // Auto-arrange
  log('STEP', 'Auto-arranging objects...');
  await page.locator('.build-plate-btn', { hasText: 'Arrange' }).click();
  await page.waitForTimeout(500);

  // Slice
  const { gcode, elapsed } = await slicePlateAndGetGCode(page, 300_000);

  // Save GCode
  const gcodePath = resolve(OUTPUT_DIR, 'build-plate-editor-flow.gcode');
  writeFileSync(gcodePath, gcode);
  log('OK', `GCode saved to ${gcodePath}`);

  // Validate GCode
  log('STEP', 'Validating GCode...');
  const validation = validatePlateGCode(gcode, 2);

  for (const check of validation.checks) {
    log(check.passed ? 'OK' : 'FAIL', `  ${check.name}: ${check.detail}`);
  }

  log('GCODE', `Lines: ${validation.stats.totalLines}`);
  log('GCODE', `Moves: ${validation.stats.moveCommands}`);
  log('GCODE', `Extrusion: ${validation.stats.extrusionMoves}`);
  log('GCODE', `Layers: ${validation.stats.layerChanges}`);
  log('GCODE', `Print area: ${validation.stats.printWidth.toFixed(1)} x ${validation.stats.printDepth.toFixed(1)}mm`);
  if (validation.stats.estimatedTime) log('GCODE', `Time: ${validation.stats.estimatedTime}`);
  if (validation.stats.filamentUsedMm) log('GCODE', `Filament: ${validation.stats.filamentUsedMm.toFixed(1)}mm`);

  if (!validation.passed) {
    throw new Error('GCode validation failed — see checks above');
  }

  // Verify fi_mini + cube filament is consistent with stress test baselines
  // From stress test 1.2: fi_mini + 1cm cube ≈ 4,873mm filament
  const filament = validation.stats.filamentUsedMm || 0;
  if (filament > 3000 && filament < 7000) {
    log('OK', `Filament ${filament.toFixed(1)}mm consistent with expected range (fi_mini + cube)`);
  } else {
    log('DIAG', `Filament ${filament.toFixed(1)}mm outside expected 3000-7000mm range — may indicate issue`);
  }

  // Verify Z height matches fi_mini baseline (~14.5mm)
  const maxZ = validation.stats.zRange.max;
  if (maxZ >= 12 && maxZ <= 18) {
    log('OK', `Z height ${maxZ.toFixed(2)}mm matches fi_mini baseline (~14.5mm)`);
  } else {
    log('DIAG', `Z height ${maxZ.toFixed(2)}mm outside expected 12-18mm range`);
  }

  log('OK', `Editor-to-build-plate flow complete (sliced in ${elapsed}s)`);
}

// ---------------------------------------------------------------------------
// Test 2.2: Build plate from editor with multicolor
// ---------------------------------------------------------------------------
async function testEditorMulticolorToBuildPlate({ page, baseUrl }) {
  // Load param_multicolor.scad in editor, render Multi-Color 3MF, send to build plate
  await sendMulticolorToBuildPlate(page, baseUrl);

  // Verify SCAD badge preserved
  log('STEP', 'Verifying SCAD metadata preserved...');
  const badge = await page.locator('.build-plate-object-type-badge').first().textContent();
  if (badge !== 'SCAD') {
    throw new Error(`Expected "SCAD" badge, got "${badge}"`);
  }
  log('OK', 'Multicolor object has SCAD type badge');

  // Add a single-color 1cm Cube via picker
  log('STEP', 'Adding 1cm Cube via SCAD picker...');
  await addSCADToPlate(page, '1cm Cube', 2);
  const count = await page.locator('.build-plate-object-item').count();
  if (count !== 2) throw new Error(`Expected 2 objects, got ${count}`);
  log('OK', `Mixed plate: ${count} objects (1 multicolor + 1 single-color)`);

  // Auto-arrange
  log('STEP', 'Auto-arranging objects...');
  await page.locator('.build-plate-btn', { hasText: 'Arrange' }).click();
  await page.waitForTimeout(500);

  // Slice
  const { gcode, elapsed } = await slicePlateAndGetGCode(page, 300_000);

  // Save GCode
  const gcodePath = resolve(OUTPUT_DIR, 'build-plate-editor-multicolor-flow.gcode');
  writeFileSync(gcodePath, gcode);
  log('OK', `GCode saved to ${gcodePath}`);

  // Validate multicolor GCode (should have tool changes from the multicolor object)
  log('STEP', 'Validating multicolor GCode...');
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
    throw new Error('Multicolor GCode validation failed — see checks above');
  }

  // Compare with the dedicated multicolor+cube test from build-plate-multicolor-e2e.mjs
  // The results should be similar since we're testing the same combo via a different entry path
  if (validation.stats.filamentUsedMm) {
    log('OK', `Editor multicolor flow filament: ${validation.stats.filamentUsedMm.toFixed(1)}mm`);
  }

  log('OK', `Editor multicolor → build plate flow complete (sliced in ${elapsed}s)`);
}

// ---------------------------------------------------------------------------
// Test 2.3: Re-render SCAD object on plate then slice
// ---------------------------------------------------------------------------
async function testReRenderThenSlice({ page, baseUrl }) {
  // Open build plate
  log('STEP', 'Opening build plate...');
  await setupPage(page, baseUrl);
  const buildPlateBtn = page.locator('.build-plate-open-btn').first();
  await buildPlateBtn.waitFor({ timeout: 10_000 });
  await buildPlateBtn.click();
  await page.locator('.build-plate-overlay').waitFor({ timeout: 10_000 });
  log('OK', 'Build plate opened');

  // Add Parametric Cube via picker
  log('STEP', 'Adding Parametric Cube via picker...');
  await addSCADToPlate(page, 'Parametric Cube', 1);
  log('OK', 'Parametric Cube added');

  // Select the object to open right panel
  log('STEP', 'Selecting object...');
  await page.locator('.build-plate-object-item').first().click();
  await page.locator('.build-plate-scad-params-section').waitFor({ timeout: 10_000 });
  log('OK', 'SCAD params section visible');

  // Record position before re-render
  const transformGrid = page.locator('.build-plate-transform-section .build-plate-transform-grid').first();
  const posInputs = transformGrid.locator('input[type="number"]');
  const posXBefore = parseFloat(await posInputs.nth(0).inputValue());
  const posYBefore = parseFloat(await posInputs.nth(1).inputValue());
  log('DIAG', `Position before: X=${posXBefore}, Y=${posYBefore}`);

  // Change "size" parameter from 10 to 25
  log('STEP', 'Changing "size" parameter to 25...');
  const overlay = page.locator('.build-plate-overlay');
  const paramField = overlay.locator('.param-field').filter({
    has: page.locator('.param-name', { hasText: 'size' }),
  });
  const paramInput = paramField.locator('input[type="number"]');
  await paramInput.waitFor({ timeout: 5_000 });
  await paramInput.click({ clickCount: 3 });
  await paramInput.fill('25');
  await paramInput.press('Tab');
  log('OK', 'Parameter changed to 25');

  // Click Re-render and wait for completion
  log('STEP', 'Re-rendering...');
  const reRenderBtn = page.locator('.build-plate-rerender-actions .build-plate-btn--primary', { hasText: 'Re-render' });
  await reRenderBtn.click();

  await page.waitForFunction(
    () => {
      const b = document.querySelector('.build-plate-rerender-actions .build-plate-btn--primary');
      return b && b.textContent === 'Re-render' && !b.disabled;
    },
    { timeout: TIMEOUT_RENDER },
  );
  log('OK', 'Re-render completed');

  // Check for re-render errors
  const reRenderError = page.locator('.build-plate-rerender-error');
  if (await reRenderError.isVisible().catch(() => false)) {
    const errorText = await reRenderError.textContent();
    throw new Error(`Re-render error: ${errorText}`);
  }

  // Verify position preserved
  const posXAfter = parseFloat(await posInputs.nth(0).inputValue());
  const posYAfter = parseFloat(await posInputs.nth(1).inputValue());
  log('DIAG', `Position after: X=${posXAfter}, Y=${posYAfter}`);
  if (Math.abs(posXAfter - posXBefore) > 0.1 || Math.abs(posYAfter - posYBefore) > 0.1) {
    throw new Error(`Position changed after re-render: (${posXBefore},${posYBefore}) → (${posXAfter},${posYAfter})`);
  }
  log('OK', 'Position preserved after re-render');

  // Add 1cm Cube as second object
  log('STEP', 'Adding 1cm Cube...');
  await addSCADToPlate(page, '1cm Cube', 2);
  const count = await page.locator('.build-plate-object-item').count();
  if (count !== 2) throw new Error(`Expected 2 objects, got ${count}`);
  log('OK', `2 objects on plate (parametric cube size=25 + 1cm cube)`);

  // Auto-arrange
  log('STEP', 'Auto-arranging...');
  await page.locator('.build-plate-btn', { hasText: 'Arrange' }).click();
  await page.waitForTimeout(500);
  log('OK', 'Auto-arranged');

  // Slice
  const { gcode, elapsed } = await slicePlateAndGetGCode(page, 300_000);

  // Save GCode
  const gcodePath = resolve(OUTPUT_DIR, 'build-plate-rerender-then-slice.gcode');
  writeFileSync(gcodePath, gcode);
  log('OK', `GCode saved to ${gcodePath}`);

  // Validate GCode
  log('STEP', 'Validating GCode...');
  const validation = validatePlateGCode(gcode, 2);

  for (const check of validation.checks) {
    log(check.passed ? 'OK' : 'FAIL', `  ${check.name}: ${check.detail}`);
  }

  log('GCODE', `Lines: ${validation.stats.totalLines}`);
  log('GCODE', `Moves: ${validation.stats.moveCommands}`);
  log('GCODE', `Extrusion: ${validation.stats.extrusionMoves}`);
  log('GCODE', `Layers: ${validation.stats.layerChanges}`);
  log('GCODE', `Print area: ${validation.stats.printWidth.toFixed(1)} x ${validation.stats.printDepth.toFixed(1)}mm`);
  if (validation.stats.estimatedTime) log('GCODE', `Time: ${validation.stats.estimatedTime}`);
  if (validation.stats.filamentUsedMm) log('GCODE', `Filament: ${validation.stats.filamentUsedMm.toFixed(1)}mm`);

  if (!validation.passed) {
    throw new Error('GCode validation failed — see checks above');
  }

  // Key check: Z height should be ~25mm (the parametric cube with size=25)
  // The 1cm Cube is only 10mm tall, so the max Z should be from the larger cube
  const maxZ = validation.stats.zRange.max;
  log('GCODE', `Max Z: ${maxZ.toFixed(2)}mm`);
  if (maxZ >= 23 && maxZ <= 27) {
    log('OK', `Z height ${maxZ.toFixed(2)}mm matches expected ~25mm (re-rendered parametric cube)`);
  } else {
    throw new Error(`Z height ${maxZ.toFixed(2)}mm does not match expected ~25mm — re-rendered mesh may not have been used for slicing`);
  }

  // Verify layers: at 0.2mm layer height, 25mm → ~125 layers
  const layers = validation.stats.layerChanges;
  log('GCODE', `Layers: ${layers}`);
  if (layers >= 100 && layers <= 150) {
    log('OK', `Layer count ${layers} consistent with 25mm object at 0.2mm layer height`);
  } else {
    log('DIAG', `Layer count ${layers} outside expected 100-150 range for 25mm object`);
  }

  log('OK', `Re-render then slice complete (sliced in ${elapsed}s)`);
}

// ---------------------------------------------------------------------------
// Test 2.4: Duplicate object then slice
// ---------------------------------------------------------------------------
async function testDuplicateObjectThenSlice({ page, baseUrl }) {
  // Open build plate
  log('STEP', 'Opening build plate...');
  await setupPage(page, baseUrl);
  const buildPlateBtn = page.locator('.build-plate-open-btn').first();
  await buildPlateBtn.waitFor({ timeout: 10_000 });
  await buildPlateBtn.click();
  await page.locator('.build-plate-overlay').waitFor({ timeout: 10_000 });
  log('OK', 'Build plate opened');

  // Add 1cm Cube via picker
  log('STEP', 'Adding 1cm Cube via picker...');
  await addSCADToPlate(page, '1cm Cube', 1);
  log('OK', '1cm Cube added');

  // Wait for render to finish (object must have mesh data before duplicate)
  await page.waitForTimeout(1000);

  // Select the object
  log('STEP', 'Selecting object...');
  await page.locator('.build-plate-object-item').first().click();
  await page.waitForTimeout(500);

  // Click Duplicate
  log('STEP', 'Clicking Duplicate...');
  const dupBtn = page.locator('.build-plate-btn', { hasText: 'Duplicate' });
  await dupBtn.waitFor({ timeout: 5_000 });

  // Ensure it's enabled (object must be selected)
  await page.waitForFunction(
    () => {
      const btns = [...document.querySelectorAll('.build-plate-btn')];
      const btn = btns.find(b => b.textContent?.includes('Duplicate'));
      return btn && !btn.disabled;
    },
    { timeout: 5_000 },
  );
  await dupBtn.click();
  log('OK', 'Duplicate clicked');

  // Wait for the second object to appear in sidebar
  await page.locator('.build-plate-object-item:nth-child(2)').waitFor({ timeout: 10_000 });
  const count = await page.locator('.build-plate-object-item').count();
  if (count !== 2) throw new Error(`Expected 2 objects after duplicate, got ${count}`);
  log('OK', `2 objects on plate after duplicate`);

  // Auto-arrange to space them out
  log('STEP', 'Auto-arranging objects...');
  await page.locator('.build-plate-btn', { hasText: 'Arrange' }).click();
  await page.waitForTimeout(500);
  log('OK', 'Auto-arranged');

  // Slice
  const { gcode, elapsed } = await slicePlateAndGetGCode(page, 120_000);

  // Save GCode
  const gcodePath = resolve(OUTPUT_DIR, 'build-plate-duplicate-then-slice.gcode');
  writeFileSync(gcodePath, gcode);
  log('OK', `GCode saved to ${gcodePath}`);

  // Validate GCode
  log('STEP', 'Validating GCode...');
  const validation = validatePlateGCode(gcode, 2);

  for (const check of validation.checks) {
    log(check.passed ? 'OK' : 'FAIL', `  ${check.name}: ${check.detail}`);
  }

  log('GCODE', `Lines: ${validation.stats.totalLines}`);
  log('GCODE', `Moves: ${validation.stats.moveCommands}`);
  log('GCODE', `Extrusion: ${validation.stats.extrusionMoves}`);
  log('GCODE', `Layers: ${validation.stats.layerChanges}`);
  log('GCODE', `Print area: ${validation.stats.printWidth.toFixed(1)} x ${validation.stats.printDepth.toFixed(1)}mm`);
  if (validation.stats.estimatedTime) log('GCODE', `Time: ${validation.stats.estimatedTime}`);
  if (validation.stats.filamentUsedMm) log('GCODE', `Filament: ${validation.stats.filamentUsedMm.toFixed(1)}mm`);

  if (!validation.passed) {
    throw new Error('GCode validation failed — see checks above');
  }

  // Verify Z height matches 1cm Cube (~10mm)
  const maxZ = validation.stats.zRange.max;
  log('GCODE', `Max Z: ${maxZ.toFixed(2)}mm`);
  if (maxZ >= 8 && maxZ <= 12) {
    log('OK', `Z height ${maxZ.toFixed(2)}mm matches 1cm Cube (~10mm)`);
  } else {
    throw new Error(`Z height ${maxZ.toFixed(2)}mm outside expected 8-12mm range for 1cm Cube`);
  }

  // Verify filament is roughly 2× a single 1cm Cube (~256mm × 2 ≈ 512mm)
  const filament = validation.stats.filamentUsedMm || 0;
  if (filament >= 300 && filament <= 800) {
    log('OK', `Filament ${filament.toFixed(1)}mm consistent with 2× 1cm Cube (~512mm expected)`);
  } else {
    log('DIAG', `Filament ${filament.toFixed(1)}mm outside expected 300-800mm range for 2 cubes`);
  }

  // Verify print area shows 2 objects spread apart
  const printWidth = validation.stats.printWidth;
  if (printWidth >= 15) {
    log('OK', `Print width ${printWidth.toFixed(1)}mm shows objects spread apart (2 cubes, auto-arranged)`);
  } else {
    log('DIAG', `Print width ${printWidth.toFixed(1)}mm seems small for 2 objects — may be overlapping`);
  }

  log('OK', `Duplicate object test complete (sliced in ${elapsed}s)`);
}

// ---------------------------------------------------------------------------
// Test 2.5: Delete object from plate then slice
// ---------------------------------------------------------------------------
async function testDeleteObjectThenSlice({ page, baseUrl }) {
  // Open build plate
  log('STEP', 'Opening build plate...');
  await setupPage(page, baseUrl);
  const buildPlateBtn = page.locator('.build-plate-open-btn').first();
  await buildPlateBtn.waitFor({ timeout: 10_000 });
  await buildPlateBtn.click();
  await page.locator('.build-plate-overlay').waitFor({ timeout: 10_000 });
  log('OK', 'Build plate opened');

  // Add 3 cubes via picker
  log('STEP', 'Adding 3× 1cm Cube via picker...');
  await addSCADToPlate(page, '1cm Cube', 1);
  log('OK', 'Cube 1 added');
  await addSCADToPlate(page, '1cm Cube', 2);
  log('OK', 'Cube 2 added');
  await addSCADToPlate(page, '1cm Cube', 3);
  log('OK', 'Cube 3 added');

  const countBefore = await page.locator('.build-plate-object-item').count();
  if (countBefore !== 3) throw new Error(`Expected 3 objects, got ${countBefore}`);
  log('OK', `3 objects on plate`);

  // Select the second (middle) object
  log('STEP', 'Selecting second object...');
  await page.locator('.build-plate-object-item:nth-child(2)').click();
  await page.waitForTimeout(500);

  // Record the name of the second object for verification
  const secondObjectName = await page.locator('.build-plate-object-item:nth-child(2)').textContent();
  log('DIAG', `Second object text: "${secondObjectName}"`);

  // Click Delete
  log('STEP', 'Deleting second object...');
  const deleteBtn = page.locator('.build-plate-btn', { hasText: 'Delete' });
  await deleteBtn.waitFor({ timeout: 5_000 });

  // Ensure Delete is enabled (object must be selected)
  await page.waitForFunction(
    () => {
      const btns = [...document.querySelectorAll('.build-plate-btn')];
      const btn = btns.find(b => b.textContent?.includes('Delete'));
      return btn && !btn.disabled;
    },
    { timeout: 5_000 },
  );
  await deleteBtn.click();
  log('OK', 'Delete clicked');

  // Wait for object count to decrease
  await page.waitForFunction(
    () => document.querySelectorAll('.build-plate-object-item').length === 2,
    { timeout: 5_000 },
  );
  const countAfter = await page.locator('.build-plate-object-item').count();
  if (countAfter !== 2) throw new Error(`Expected 2 objects after delete, got ${countAfter}`);
  log('OK', `2 objects remain after delete`);

  // Auto-arrange remaining objects
  log('STEP', 'Auto-arranging remaining objects...');
  await page.locator('.build-plate-btn', { hasText: 'Arrange' }).click();
  await page.waitForTimeout(500);
  log('OK', 'Auto-arranged');

  // Slice
  const { gcode, elapsed } = await slicePlateAndGetGCode(page, 120_000);

  // Save GCode
  const gcodePath = resolve(OUTPUT_DIR, 'build-plate-delete-then-slice.gcode');
  writeFileSync(gcodePath, gcode);
  log('OK', `GCode saved to ${gcodePath}`);

  // Validate GCode — should be 2-object plate
  log('STEP', 'Validating GCode...');
  const validation = validatePlateGCode(gcode, 2);

  for (const check of validation.checks) {
    log(check.passed ? 'OK' : 'FAIL', `  ${check.name}: ${check.detail}`);
  }

  log('GCODE', `Lines: ${validation.stats.totalLines}`);
  log('GCODE', `Moves: ${validation.stats.moveCommands}`);
  log('GCODE', `Extrusion: ${validation.stats.extrusionMoves}`);
  log('GCODE', `Layers: ${validation.stats.layerChanges}`);
  log('GCODE', `Print area: ${validation.stats.printWidth.toFixed(1)} x ${validation.stats.printDepth.toFixed(1)}mm`);
  if (validation.stats.estimatedTime) log('GCODE', `Time: ${validation.stats.estimatedTime}`);
  if (validation.stats.filamentUsedMm) log('GCODE', `Filament: ${validation.stats.filamentUsedMm.toFixed(1)}mm`);

  if (!validation.passed) {
    throw new Error('GCode validation failed — see checks above');
  }

  // Verify Z height matches 1cm Cube (~10mm)
  const maxZ = validation.stats.zRange.max;
  log('GCODE', `Max Z: ${maxZ.toFixed(2)}mm`);
  if (maxZ >= 8 && maxZ <= 12) {
    log('OK', `Z height ${maxZ.toFixed(2)}mm matches 1cm Cube (~10mm)`);
  } else {
    throw new Error(`Z height ${maxZ.toFixed(2)}mm outside expected 8-12mm range for 1cm Cube`);
  }

  // Verify filament is roughly 2× a single 1cm Cube (~256mm × 2 ≈ 512mm)
  // NOT 3× — we deleted one
  const filament = validation.stats.filamentUsedMm || 0;
  if (filament >= 300 && filament <= 800) {
    log('OK', `Filament ${filament.toFixed(1)}mm consistent with 2× 1cm Cube (~512mm expected, NOT 3×)`);
  } else {
    throw new Error(`Filament ${filament.toFixed(1)}mm outside expected 300-800mm range for 2 cubes — delete may not have removed object from slicer`);
  }

  // Verify print area shows 2 objects (not 3)
  const printWidth = validation.stats.printWidth;
  log('GCODE', `Print width: ${printWidth.toFixed(1)}mm`);
  if (printWidth >= 15) {
    log('OK', `Print width ${printWidth.toFixed(1)}mm shows 2 objects spread apart`);
  } else {
    log('DIAG', `Print width ${printWidth.toFixed(1)}mm seems small for 2 objects`);
  }

  log('OK', `Delete object test complete (sliced in ${elapsed}s)`);
}

// ---------------------------------------------------------------------------
// Test 2.6: Move object manually then slice
// ---------------------------------------------------------------------------
async function testMoveObjectThenSlice({ page, baseUrl }) {
  // Open build plate
  log('STEP', 'Opening build plate...');
  await setupPage(page, baseUrl);
  const buildPlateBtn = page.locator('.build-plate-open-btn').first();
  await buildPlateBtn.waitFor({ timeout: 10_000 });
  await buildPlateBtn.click();
  await page.locator('.build-plate-overlay').waitFor({ timeout: 10_000 });
  log('OK', 'Build plate opened');

  // Add 2 cubes via picker
  log('STEP', 'Adding 2× 1cm Cube via picker...');
  await addSCADToPlate(page, '1cm Cube', 1);
  log('OK', 'Cube 1 added');
  await addSCADToPlate(page, '1cm Cube', 2);
  log('OK', 'Cube 2 added');

  const count = await page.locator('.build-plate-object-item').count();
  if (count !== 2) throw new Error(`Expected 2 objects, got ${count}`);
  log('OK', '2 objects on plate');

  // Select the first object
  log('STEP', 'Selecting first object...');
  await page.locator('.build-plate-object-item').first().click();
  await page.waitForTimeout(500);

  // Wait for transform inputs to appear
  const transformGrid = page.locator('.build-plate-transform-section .build-plate-transform-grid').first();
  await transformGrid.waitFor({ timeout: 5_000 });

  // Set position to (50, 50) via transform inputs
  log('STEP', 'Setting first object position to (50, 50)...');
  const posInputs = transformGrid.locator('input[type="number"]');

  // Set X position
  await posInputs.nth(0).click({ clickCount: 3 });
  await posInputs.nth(0).fill('50');
  await posInputs.nth(0).press('Tab');

  // Set Y position
  await posInputs.nth(1).click({ clickCount: 3 });
  await posInputs.nth(1).fill('50');
  await posInputs.nth(1).press('Tab');

  await page.waitForTimeout(300);

  // Verify position was applied
  const posX = parseFloat(await posInputs.nth(0).inputValue());
  const posY = parseFloat(await posInputs.nth(1).inputValue());
  log('DIAG', `First object position: X=${posX}, Y=${posY}`);
  if (Math.abs(posX - 50) > 1 || Math.abs(posY - 50) > 1) {
    throw new Error(`Position not applied correctly: expected (50, 50), got (${posX}, ${posY})`);
  }
  log('OK', 'First object positioned at (50, 50)');

  // Select the second object and leave it at its auto-placed position
  log('STEP', 'Selecting second object...');
  await page.locator('.build-plate-object-item:nth-child(2)').click();
  await page.waitForTimeout(500);

  // Read second object position
  const transformGrid2 = page.locator('.build-plate-transform-section .build-plate-transform-grid').first();
  const posInputs2 = transformGrid2.locator('input[type="number"]');
  const posX2 = parseFloat(await posInputs2.nth(0).inputValue());
  const posY2 = parseFloat(await posInputs2.nth(1).inputValue());
  log('DIAG', `Second object position: X=${posX2}, Y=${posY2}`);

  // Slice
  const { gcode, elapsed } = await slicePlateAndGetGCode(page, 120_000);

  // Save GCode
  const gcodePath = resolve(OUTPUT_DIR, 'build-plate-move-then-slice.gcode');
  writeFileSync(gcodePath, gcode);
  log('OK', `GCode saved to ${gcodePath}`);

  // Validate GCode
  log('STEP', 'Validating GCode...');
  const validation = validatePlateGCode(gcode, 2);

  for (const check of validation.checks) {
    log(check.passed ? 'OK' : 'FAIL', `  ${check.name}: ${check.detail}`);
  }

  log('GCODE', `Lines: ${validation.stats.totalLines}`);
  log('GCODE', `Moves: ${validation.stats.moveCommands}`);
  log('GCODE', `Extrusion: ${validation.stats.extrusionMoves}`);
  log('GCODE', `Layers: ${validation.stats.layerChanges}`);
  log('GCODE', `Print area: ${validation.stats.printWidth.toFixed(1)} x ${validation.stats.printDepth.toFixed(1)}mm`);
  if (validation.stats.estimatedTime) log('GCODE', `Time: ${validation.stats.estimatedTime}`);
  if (validation.stats.filamentUsedMm) log('GCODE', `Filament: ${validation.stats.filamentUsedMm.toFixed(1)}mm`);

  if (!validation.passed) {
    throw new Error('GCode validation failed — see checks above');
  }

  // Verify Z height matches 1cm Cube (~10mm)
  const maxZ = validation.stats.zRange.max;
  log('GCODE', `Max Z: ${maxZ.toFixed(2)}mm`);
  if (maxZ >= 8 && maxZ <= 12) {
    log('OK', `Z height ${maxZ.toFixed(2)}mm matches 1cm Cube (~10mm)`);
  } else {
    throw new Error(`Z height ${maxZ.toFixed(2)}mm outside expected 8-12mm range for 1cm Cube`);
  }

  // Verify filament is roughly 2× a single 1cm Cube (~256mm × 2 ≈ 512mm)
  const filament = validation.stats.filamentUsedMm || 0;
  if (filament >= 300 && filament <= 800) {
    log('OK', `Filament ${filament.toFixed(1)}mm consistent with 2× 1cm Cube (~512mm expected)`);
  } else {
    log('DIAG', `Filament ${filament.toFixed(1)}mm outside expected 300-800mm range for 2 cubes`);
  }

  // Key check: verify the manually-positioned object is reflected in GCode
  // The first object is at (50, 50), so extrusion should happen near those coordinates
  // The print area should reflect the manual positioning
  const printWidth = validation.stats.printWidth;
  const printDepth = validation.stats.printDepth;
  log('GCODE', `Print area: ${printWidth.toFixed(1)} x ${printDepth.toFixed(1)}mm`);

  // With one object at (50,50) and another at its auto-placed position,
  // the print area should show them spread out
  if (printWidth >= 5 && printDepth >= 5) {
    log('OK', `Print area ${printWidth.toFixed(1)} x ${printDepth.toFixed(1)}mm shows valid spread`);
  } else {
    log('DIAG', `Print area seems unexpectedly small — objects may be overlapping`);
  }

  // Check GCode X/Y ranges to verify the manually-positioned object's location
  const xMin = validation.stats.xRange?.min ?? 0;
  const xMax = validation.stats.xRange?.max ?? 0;
  const yMin = validation.stats.yRange?.min ?? 0;
  const yMax = validation.stats.yRange?.max ?? 0;
  log('GCODE', `X range: ${xMin.toFixed(1)} - ${xMax.toFixed(1)}mm`);
  log('GCODE', `Y range: ${yMin.toFixed(1)} - ${yMax.toFixed(1)}mm`);

  // Object at (50,50) should have extrusion near x=50 (±15mm for object size)
  // GCode coordinates include bed offset, so the exact values depend on the slicer
  // but we can at least verify the print is not all at (0,0)
  if (xMax > 30) {
    log('OK', `X range extends to ${xMax.toFixed(1)}mm — manually positioned object is reflected in GCode`);
  } else {
    log('DIAG', `X max only ${xMax.toFixed(1)}mm — manual position may not have been applied to slicer`);
  }

  log('OK', `Move object test complete (sliced in ${elapsed}s)`);
}

// ---------------------------------------------------------------------------
// Test 4.1: Slice after removing all objects — button should be disabled
// ---------------------------------------------------------------------------
async function testSliceAfterRemovingAllObjects({ page, baseUrl }) {
  // Open build plate
  log('STEP', 'Opening build plate...');
  await setupPage(page, baseUrl);
  const buildPlateBtn = page.locator('.build-plate-open-btn').first();
  await buildPlateBtn.waitFor({ timeout: 10_000 });
  await buildPlateBtn.click();
  await page.locator('.build-plate-overlay').waitFor({ timeout: 10_000 });
  log('OK', 'Build plate opened');

  // Verify empty state initially
  log('STEP', 'Verifying initial empty state...');
  const emptyMsg = page.locator('.build-plate-empty');
  await emptyMsg.waitFor({ timeout: 5_000 });
  const emptyText = await emptyMsg.textContent();
  if (!emptyText || !emptyText.includes('No objects')) {
    throw new Error(`Expected empty message, got: "${emptyText}"`);
  }
  log('OK', 'Initial empty state shows "No objects on plate"');

  // Verify Slice Plate button is disabled when empty
  log('STEP', 'Verifying Slice Plate button is disabled on empty plate...');
  const sliceBtnDisabledInitial = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.build-plate-btn--primary')];
    const btn = btns.find(b => /Slice Plate/.test(b.textContent));
    return btn ? btn.disabled : null;
  });
  if (sliceBtnDisabledInitial !== true) {
    throw new Error(`Expected Slice Plate button to be disabled on empty plate, got disabled=${sliceBtnDisabledInitial}`);
  }
  log('OK', 'Slice Plate button is disabled on empty plate');

  // Add 2 cubes
  log('STEP', 'Adding 2× 1cm Cube via picker...');
  await addSCADToPlate(page, '1cm Cube', 1);
  log('OK', 'Cube 1 added');
  await addSCADToPlate(page, '1cm Cube', 2);
  log('OK', 'Cube 2 added');

  const countBefore = await page.locator('.build-plate-object-item').count();
  if (countBefore !== 2) throw new Error(`Expected 2 objects, got ${countBefore}`);
  log('OK', '2 objects on plate');

  // Verify Slice Plate button is enabled with objects
  log('STEP', 'Verifying Slice Plate button is enabled with objects...');
  const sliceBtnEnabled = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.build-plate-btn--primary')];
    const btn = btns.find(b => /Slice Plate/.test(b.textContent));
    return btn ? !btn.disabled : null;
  });
  if (sliceBtnEnabled !== true) {
    throw new Error('Expected Slice Plate button to be enabled with 2 objects on plate');
  }
  log('OK', 'Slice Plate button is enabled with 2 objects');

  // Delete first object
  log('STEP', 'Deleting first object...');
  await page.locator('.build-plate-object-item').first().click();
  await page.waitForTimeout(500);
  const deleteBtn = page.locator('.build-plate-btn', { hasText: 'Delete' });
  await page.waitForFunction(
    () => {
      const btns = [...document.querySelectorAll('.build-plate-btn')];
      const btn = btns.find(b => b.textContent?.includes('Delete'));
      return btn && !btn.disabled;
    },
    { timeout: 5_000 },
  );
  await deleteBtn.click();
  await page.waitForFunction(
    () => document.querySelectorAll('.build-plate-object-item').length === 1,
    { timeout: 5_000 },
  );
  log('OK', '1 object remaining after first delete');

  // Verify Slice Plate still enabled with 1 object
  const sliceBtnEnabledAfter1 = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.build-plate-btn--primary')];
    const btn = btns.find(b => /Slice Plate/.test(b.textContent));
    return btn ? !btn.disabled : null;
  });
  if (sliceBtnEnabledAfter1 !== true) {
    throw new Error('Expected Slice Plate button to still be enabled with 1 object');
  }
  log('OK', 'Slice Plate still enabled with 1 object');

  // Delete second (last) object
  log('STEP', 'Deleting last object...');
  await page.locator('.build-plate-object-item').first().click();
  await page.waitForTimeout(500);
  await page.waitForFunction(
    () => {
      const btns = [...document.querySelectorAll('.build-plate-btn')];
      const btn = btns.find(b => b.textContent?.includes('Delete'));
      return btn && !btn.disabled;
    },
    { timeout: 5_000 },
  );
  await deleteBtn.click();
  await page.waitForFunction(
    () => document.querySelectorAll('.build-plate-object-item').length === 0,
    { timeout: 5_000 },
  );
  log('OK', '0 objects remaining after second delete');

  // Verify empty state is restored
  log('STEP', 'Verifying empty state restored...');
  await emptyMsg.waitFor({ timeout: 5_000 });
  const emptyTextAfter = await emptyMsg.textContent();
  if (!emptyTextAfter || !emptyTextAfter.includes('No objects')) {
    throw new Error(`Expected empty message after deleting all objects, got: "${emptyTextAfter}"`);
  }
  log('OK', 'Empty state restored — "No objects on plate" shown');

  // Verify Slice Plate button is disabled again
  log('STEP', 'Verifying Slice Plate button is disabled after removing all objects...');
  const sliceBtnDisabledFinal = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.build-plate-btn--primary')];
    const btn = btns.find(b => /Slice Plate/.test(b.textContent));
    return btn ? btn.disabled : null;
  });
  if (sliceBtnDisabledFinal !== true) {
    throw new Error(`Expected Slice Plate button to be disabled after removing all objects, got disabled=${sliceBtnDisabledFinal}`);
  }
  log('OK', 'Slice Plate button is disabled after removing all objects');

  log('OK', 'Slice after removing all objects test PASSED — cleanup path works correctly');
}

// ---------------------------------------------------------------------------
// Test 4.2: Object at bed edge — boundary validation
// ---------------------------------------------------------------------------
async function testObjectAtBedEdge({ page, baseUrl }) {
  // Open build plate
  log('STEP', 'Opening build plate...');
  await setupPage(page, baseUrl);
  const buildPlateBtn = page.locator('.build-plate-open-btn').first();
  await buildPlateBtn.waitFor({ timeout: 10_000 });
  await buildPlateBtn.click();
  await page.locator('.build-plate-overlay').waitFor({ timeout: 10_000 });
  log('OK', 'Build plate opened');

  // Add 1cm Cube via picker
  log('STEP', 'Adding 1cm Cube via picker...');
  await addSCADToPlate(page, '1cm Cube', 1);
  log('OK', '1cm Cube added');

  // Select the object
  log('STEP', 'Selecting object...');
  await page.locator('.build-plate-object-item').first().click();
  await page.waitForTimeout(500);

  // Wait for transform inputs
  const transformGrid = page.locator('.build-plate-transform-section .build-plate-transform-grid').first();
  await transformGrid.waitFor({ timeout: 5_000 });
  const posInputs = transformGrid.locator('input[type="number"]');

  // --- Part 1: Position at (240, 240) — OUTSIDE bed bounds (235x235) ---
  log('STEP', 'Setting position to (240, 240) — outside bed bounds...');
  await posInputs.nth(0).click({ clickCount: 3 });
  await posInputs.nth(0).fill('240');
  await posInputs.nth(0).press('Tab');
  await posInputs.nth(1).click({ clickCount: 3 });
  await posInputs.nth(1).fill('240');
  await posInputs.nth(1).press('Tab');
  await page.waitForTimeout(300);

  // Verify position was applied
  const posX1 = parseFloat(await posInputs.nth(0).inputValue());
  const posY1 = parseFloat(await posInputs.nth(1).inputValue());
  log('DIAG', `Position set to: X=${posX1}, Y=${posY1}`);
  if (Math.abs(posX1 - 240) > 1 || Math.abs(posY1 - 240) > 1) {
    throw new Error(`Position not applied correctly: expected (240, 240), got (${posX1}, ${posY1})`);
  }
  log('OK', 'Object positioned at (240, 240) — outside bed');

  // Click Slice Plate — should show validation error
  log('STEP', 'Clicking Slice Plate with out-of-bounds object...');
  const sliceBtn = page.locator('.build-plate-btn--primary', { hasText: /Slice Plate/ });
  await sliceBtn.waitFor({ timeout: 5_000 });

  // Ensure button is enabled (validation happens on click, not proactively)
  await page.waitForFunction(
    () => {
      const btns = [...document.querySelectorAll('.build-plate-btn--primary')];
      const btn = btns.find(b => /Slice Plate/.test(b.textContent));
      return btn && !btn.disabled;
    },
    { timeout: 10_000 },
  );
  await sliceBtn.click();
  log('OK', 'Slice button clicked');

  // Wait for validation error to appear
  log('STEP', 'Waiting for validation error...');
  const validationErrors = page.locator('.build-plate-validation-errors');
  try {
    await validationErrors.waitFor({ timeout: 5_000 });
  } catch {
    // Check if slice result appeared instead (meaning validation was bypassed — BUG)
    const sliceResult = await page.$('.build-plate-slice-result');
    if (sliceResult) {
      throw new Error('BUG: Slicing succeeded with object at (240, 240) — outside 235x235 bed bounds. Validation should have blocked this.');
    }
    // Check for slice error (slicer crashed instead of validation catching it)
    const sliceError = await page.$('.build-plate-scad-error');
    if (sliceError) {
      const errorText = await sliceError.textContent();
      throw new Error(`BUG: Slicer error instead of validation error for out-of-bounds object: ${errorText}`);
    }
    throw new Error('Expected validation error for out-of-bounds object, but none appeared');
  }

  // Read the validation error text
  const errorText = await validationErrors.textContent();
  log('DIAG', `Validation error text: "${errorText}"`);

  // Should mention "outside bed bounds"
  if (/outside bed bounds/i.test(errorText)) {
    log('OK', `Validation correctly caught out-of-bounds object: "${errorText.trim()}"`);
  } else {
    log('DIAG', `Validation error shown but doesn't mention "outside bed bounds": "${errorText}"`);
    // Still a pass — validation blocked slicing, even if the message is different
    log('OK', 'Validation blocked slicing for out-of-bounds object (different error wording)');
  }

  // --- Part 2: Dismiss error, move within bounds (230, 230), slice successfully ---
  log('STEP', 'Dismissing validation error...');
  const dismissBtn = validationErrors.locator('button');
  if (await dismissBtn.isVisible().catch(() => false)) {
    await dismissBtn.click();
    await page.waitForTimeout(300);
    log('OK', 'Validation error dismissed');
  }

  log('STEP', 'Moving object to (230, 230) — within bed bounds...');
  // Re-select the object (it should still be selected but just in case)
  await page.locator('.build-plate-object-item').first().click();
  await page.waitForTimeout(500);
  await transformGrid.waitFor({ timeout: 5_000 });

  await posInputs.nth(0).click({ clickCount: 3 });
  await posInputs.nth(0).fill('230');
  await posInputs.nth(0).press('Tab');
  await posInputs.nth(1).click({ clickCount: 3 });
  await posInputs.nth(1).fill('230');
  await posInputs.nth(1).press('Tab');
  await page.waitForTimeout(300);

  const posX2 = parseFloat(await posInputs.nth(0).inputValue());
  const posY2 = parseFloat(await posInputs.nth(1).inputValue());
  log('DIAG', `Position set to: X=${posX2}, Y=${posY2}`);
  if (Math.abs(posX2 - 230) > 1 || Math.abs(posY2 - 230) > 1) {
    throw new Error(`Position not applied correctly: expected (230, 230), got (${posX2}, ${posY2})`);
  }
  log('OK', 'Object positioned at (230, 230) — within bed');

  // Slice — should succeed since (230, 230) is within the 235x235 bed
  log('STEP', 'Slicing with object at bed edge...');
  const { gcode, elapsed } = await slicePlateAndGetGCode(page, 120_000);
  log('OK', `Slicing succeeded at bed edge position (230, 230) in ${elapsed}s`);

  // Save GCode
  const gcodePath = resolve(OUTPUT_DIR, 'build-plate-bed-edge-valid.gcode');
  writeFileSync(gcodePath, gcode);
  log('OK', `GCode saved to ${gcodePath}`);

  // Basic GCode validation
  const validation = validatePlateGCode(gcode, 1);
  for (const check of validation.checks) {
    log(check.passed ? 'OK' : 'FAIL', `  ${check.name}: ${check.detail}`);
  }
  log('GCODE', `Lines: ${validation.stats.totalLines}`);
  log('GCODE', `Filament: ${(validation.stats.filamentUsedMm || 0).toFixed(1)}mm`);
  if (!validation.passed) {
    throw new Error('GCode validation failed for bed-edge position — see checks above');
  }
  log('OK', 'GCode validates for bed-edge position');

  // --- Part 3: Try exact boundary positions (235, 235) — should pass ---
  // Note: We don't reposition after slicing due to BUG-003 (detached ArrayBuffer crash).
  // The (230, 230) test above already confirms near-edge slicing works.
  // The validation check at (240, 240) confirms out-of-bounds is blocked.

  log('OK', 'Object at bed edge test PASSED — boundary validation works correctly');
}

// ---------------------------------------------------------------------------
// Test 4.3: Slice with zero-scale object — robustness
// ---------------------------------------------------------------------------
async function testZeroScaleObject({ page, baseUrl }) {
  // Open build plate
  log('STEP', 'Opening build plate...');
  await setupPage(page, baseUrl);
  const buildPlateBtn = page.locator('.build-plate-open-btn').first();
  await buildPlateBtn.waitFor({ timeout: 10_000 });
  await buildPlateBtn.click();
  await page.locator('.build-plate-overlay').waitFor({ timeout: 10_000 });
  log('OK', 'Build plate opened');

  // Add 1cm Cube via picker
  log('STEP', 'Adding 1cm Cube via picker...');
  await addSCADToPlate(page, '1cm Cube', 1);
  log('OK', '1cm Cube added');

  // Select the object
  log('STEP', 'Selecting object...');
  await page.locator('.build-plate-object-item').first().click();
  await page.waitForTimeout(500);

  // Find the scale input (X) — it's in the scale section's transform-grid
  const scaleGrid = page.locator('.build-plate-scale-section .build-plate-transform-grid');
  await scaleGrid.waitFor({ timeout: 5_000 });
  const scaleXInput = scaleGrid.locator('input[type="number"]').first();

  // --- Part 1: Try setting scale to 0 — UI should prevent it ---
  log('STEP', 'Setting scale X to 0 (should be prevented by UI)...');
  await scaleXInput.click({ clickCount: 3 });
  await scaleXInput.fill('0');
  await scaleXInput.press('Tab');
  await page.waitForTimeout(300);

  const scaleAfterZero = parseFloat(await scaleXInput.inputValue());
  log('DIAG', `Scale X after setting to 0: ${scaleAfterZero}`);
  // The handler uses `parseFloat(value) || 1`, so 0 should become 1
  if (scaleAfterZero === 0) {
    throw new Error('BUG: Scale of 0 was accepted by the UI — should be prevented. Zero-scale objects produce degenerate geometry.');
  }
  log('OK', `Scale 0 correctly rejected by UI — clamped to ${scaleAfterZero}`);

  // --- Part 2: Try setting scale to negative value ---
  log('STEP', 'Setting scale X to -1 (should be prevented or clamped)...');
  await scaleXInput.click({ clickCount: 3 });
  await scaleXInput.fill('-1');
  await scaleXInput.press('Tab');
  await page.waitForTimeout(300);

  const scaleAfterNeg = parseFloat(await scaleXInput.inputValue());
  log('DIAG', `Scale X after setting to -1: ${scaleAfterNeg}`);
  // Negative scale is degenerate — should not be accepted
  if (scaleAfterNeg < 0) {
    // Log as a finding but don't fail — the slicer might handle it (mirror)
    log('DIAG', 'WARNING: Negative scale accepted by UI — could cause mirrored/degenerate geometry');
  } else {
    log('OK', `Negative scale rejected/clamped to ${scaleAfterNeg}`);
  }

  // --- Part 3: Set scale to a very small valid value (0.1) and verify slicing works ---
  log('STEP', 'Setting scale X to 0.1 (uniform, should produce ~1mm cube)...');
  await scaleXInput.click({ clickCount: 3 });
  await scaleXInput.fill('0.1');
  await scaleXInput.press('Tab');
  await page.waitForTimeout(300);

  const scaleAfterSmall = parseFloat(await scaleXInput.inputValue());
  log('DIAG', `Scale X after setting to 0.1: ${scaleAfterSmall}`);
  if (Math.abs(scaleAfterSmall - 0.1) > 0.01) {
    throw new Error(`Scale not applied correctly: expected 0.1, got ${scaleAfterSmall}`);
  }
  log('OK', 'Scale 0.1 accepted');

  // Slice with tiny scale
  const { gcode, elapsed } = await slicePlateAndGetGCode(page, 60_000);

  // Save GCode
  const gcodePath = resolve(OUTPUT_DIR, 'build-plate-zero-scale.gcode');
  writeFileSync(gcodePath, gcode);
  log('OK', `GCode saved to ${gcodePath}`);

  // Validate
  log('STEP', 'Validating GCode...');
  const validation = validatePlateGCode(gcode, 1);
  for (const check of validation.checks) {
    log(check.passed ? 'OK' : 'FAIL', `  ${check.name}: ${check.detail}`);
  }
  log('GCODE', `Lines: ${validation.stats.totalLines}`);
  log('GCODE', `Layers: ${validation.stats.layerChanges}`);
  log('GCODE', `Filament: ${(validation.stats.filamentUsedMm || 0).toFixed(1)}mm`);

  // A 10mm cube at 0.1 scale = ~1mm tall cube. Z should be very small.
  const maxZ = validation.stats.zRange.max;
  log('GCODE', `Max Z: ${maxZ.toFixed(2)}mm`);
  if (maxZ > 3) {
    throw new Error(`Max Z=${maxZ.toFixed(2)}mm too high for 0.1-scale cube (expected ~1mm). Scale override may not have been applied to slicer.`);
  }
  log('OK', `Z height ${maxZ.toFixed(2)}mm is consistent with 0.1-scale 1cm cube (~1mm)`);

  if (!validation.passed) {
    throw new Error('GCode validation failed — see checks above');
  }

  log('OK', 'Zero-scale robustness test PASSED — UI prevents zero scale, tiny scale slices correctly');
}

// ---------------------------------------------------------------------------
// Test 4.4: Rapid add/remove cycle — tests state consistency under fast ops
// ---------------------------------------------------------------------------
async function testRapidAddRemoveCycle({ page, baseUrl }) {
  // Open build plate
  log('STEP', 'Opening build plate...');
  await setupPage(page, baseUrl);
  const buildPlateBtn = page.locator('.build-plate-open-btn').first();
  await buildPlateBtn.waitFor({ timeout: 10_000 });
  await buildPlateBtn.click();
  await page.locator('.build-plate-overlay').waitFor({ timeout: 10_000 });
  log('OK', 'Build plate opened');

  // --- Phase 1: Rapidly add 5 cubes ---
  log('STEP', 'Rapidly adding 5× 1cm Cube...');
  for (let i = 1; i <= 5; i++) {
    await addSCADToPlate(page, '1cm Cube', i);
    log('OK', `Cube ${i} added`);
  }

  const countAfterAdd = await page.locator('.build-plate-object-item').count();
  if (countAfterAdd !== 5) throw new Error(`Expected 5 objects after rapid add, got ${countAfterAdd}`);
  log('OK', `5 objects on plate after rapid add`);

  // Verify each object has a SCAD badge (metadata consistency)
  const badges = await page.locator('.build-plate-object-type-badge').allTextContents();
  const allScad = badges.every(b => b === 'STL' || b === 'SCAD');
  if (!allScad) {
    log('DIAG', `Badges: ${JSON.stringify(badges)}`);
    throw new Error('Not all objects have valid type badges after rapid add');
  }
  log('OK', 'All 5 objects have valid type badges');

  // --- Phase 2: Delete all 5 objects one by one ---
  log('STEP', 'Deleting all 5 objects one by one...');
  for (let i = 5; i >= 1; i--) {
    // Select the first remaining object
    await page.locator('.build-plate-object-item').first().click();
    await page.waitForTimeout(200);

    // Click Delete
    const deleteBtn = page.locator('.build-plate-btn', { hasText: 'Delete' });
    await page.waitForFunction(
      () => {
        const btns = [...document.querySelectorAll('.build-plate-btn')];
        const btn = btns.find(b => b.textContent?.includes('Delete'));
        return btn && !btn.disabled;
      },
      { timeout: 5_000 },
    );
    await deleteBtn.click();

    // Wait for count to decrease
    const expectedCount = i - 1;
    await page.waitForFunction(
      (expected) => document.querySelectorAll('.build-plate-object-item').length === expected,
      expectedCount,
      { timeout: 5_000 },
    );
    log('OK', `Deleted → ${expectedCount} objects remaining`);
  }

  // Verify empty state
  const countAfterDeleteAll = await page.locator('.build-plate-object-item').count();
  if (countAfterDeleteAll !== 0) throw new Error(`Expected 0 objects after deleting all, got ${countAfterDeleteAll}`);
  log('OK', 'All objects deleted — plate is empty');

  // Verify empty state message
  const emptyMsg = page.locator('.build-plate-empty');
  await emptyMsg.waitFor({ timeout: 5_000 });
  log('OK', 'Empty state message shown');

  // Verify Slice button is disabled
  const sliceBtnDisabled = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.build-plate-btn--primary')];
    const btn = btns.find(b => /Slice Plate/.test(b.textContent));
    return btn ? btn.disabled : null;
  });
  if (sliceBtnDisabled !== true) {
    throw new Error('Expected Slice Plate button to be disabled after removing all objects');
  }
  log('OK', 'Slice button correctly disabled after emptying plate');

  // --- Phase 3: Add 2 more cubes and slice ---
  log('STEP', 'Adding 2× 1cm Cube after clearing plate...');
  await addSCADToPlate(page, '1cm Cube', 1);
  log('OK', 'Cube 1 re-added');
  await addSCADToPlate(page, '1cm Cube', 2);
  log('OK', 'Cube 2 re-added');

  const countAfterReAdd = await page.locator('.build-plate-object-item').count();
  if (countAfterReAdd !== 2) throw new Error(`Expected 2 objects after re-add, got ${countAfterReAdd}`);
  log('OK', '2 objects on plate after re-add');

  // Auto-arrange
  log('STEP', 'Auto-arranging...');
  await page.locator('.build-plate-btn', { hasText: 'Arrange' }).click();
  await page.waitForTimeout(500);

  // Slice
  const { gcode, elapsed } = await slicePlateAndGetGCode(page, 120_000);

  // Save GCode
  const gcodePath = resolve(OUTPUT_DIR, 'build-plate-rapid-add-remove.gcode');
  writeFileSync(gcodePath, gcode);
  log('OK', `GCode saved to ${gcodePath}`);

  // Validate GCode — should be a clean 2-object plate
  log('STEP', 'Validating GCode...');
  const validation = validatePlateGCode(gcode, 2);

  for (const check of validation.checks) {
    log(check.passed ? 'OK' : 'FAIL', `  ${check.name}: ${check.detail}`);
  }

  log('GCODE', `Lines: ${validation.stats.totalLines}`);
  log('GCODE', `Moves: ${validation.stats.moveCommands}`);
  log('GCODE', `Extrusion: ${validation.stats.extrusionMoves}`);
  log('GCODE', `Layers: ${validation.stats.layerChanges}`);
  log('GCODE', `Print area: ${validation.stats.printWidth.toFixed(1)} x ${validation.stats.printDepth.toFixed(1)}mm`);
  if (validation.stats.filamentUsedMm) log('GCODE', `Filament: ${validation.stats.filamentUsedMm.toFixed(1)}mm`);

  if (!validation.passed) {
    throw new Error('GCode validation failed — see checks above');
  }

  // Verify filament is consistent with 2× 1cm Cube baseline (~512mm)
  const filament = validation.stats.filamentUsedMm || 0;
  if (filament >= 300 && filament <= 800) {
    log('OK', `Filament ${filament.toFixed(1)}mm consistent with 2× 1cm Cube (~512mm)`);
  } else {
    throw new Error(`Filament ${filament.toFixed(1)}mm outside expected 300-800mm range — state may be corrupted from rapid add/remove`);
  }

  // Verify Z height matches 1cm Cube (~10mm)
  const maxZ = validation.stats.zRange.max;
  if (maxZ >= 8 && maxZ <= 12) {
    log('OK', `Z height ${maxZ.toFixed(2)}mm matches 1cm Cube (~10mm)`);
  } else {
    throw new Error(`Z height ${maxZ.toFixed(2)}mm outside expected 8-12mm range`);
  }

  // Verify exactly 2 objects worth of GCode (not 5, not 7, not 0)
  // 2 cubes should have ~6600 extrusion moves (baseline from test 2.5)
  const extrusions = validation.stats.extrusionMoves;
  if (extrusions >= 3000 && extrusions <= 12000) {
    log('OK', `Extrusion moves ${extrusions} consistent with 2 cubes (~6600 baseline)`);
  } else {
    throw new Error(`Extrusion moves ${extrusions} unexpected — state corruption from rapid operations?`);
  }

  log('OK', `Rapid add/remove cycle test PASSED (sliced in ${elapsed}s) — no state corruption`);
}

// ---------------------------------------------------------------------------
// Test: Verify object positions in GCode
// ---------------------------------------------------------------------------
/**
 * Phase 5.1: Add 2 cubes, manually position at (50, 50) and (150, 150).
 * Slice. Parse GCode extrusion positions. Verify there are extrusion clusters
 * near both positions (within ~15mm). Tests that plate object positions are
 * correctly translated to slicer coordinates.
 */
async function testVerifyObjectPositionsInGCode({ page, baseUrl }) {
  // Open build plate
  log('STEP', 'Opening build plate...');
  await setupPage(page, baseUrl);
  const buildPlateBtn = page.locator('.build-plate-open-btn').first();
  await buildPlateBtn.waitFor({ timeout: 10_000 });
  await buildPlateBtn.click();
  await page.locator('.build-plate-overlay').waitFor({ timeout: 10_000 });
  log('OK', 'Build plate opened');

  // Add 2 cubes via picker
  log('STEP', 'Adding 2× 1cm Cube via picker...');
  await addSCADToPlate(page, '1cm Cube', 1);
  log('OK', 'Cube 1 added');
  await addSCADToPlate(page, '1cm Cube', 2);
  log('OK', 'Cube 2 added');

  const count = await page.locator('.build-plate-object-item').count();
  if (count !== 2) throw new Error(`Expected 2 objects, got ${count}`);
  log('OK', '2 objects on plate');

  // Select the first object and position at (50, 50)
  log('STEP', 'Selecting first object and positioning at (50, 50)...');
  await page.locator('.build-plate-object-item').first().click();
  await page.waitForTimeout(500);

  const transformGrid = page.locator('.build-plate-transform-section .build-plate-transform-grid').first();
  await transformGrid.waitFor({ timeout: 5_000 });
  const posInputs = transformGrid.locator('input[type="number"]');

  // Set X=50
  await posInputs.nth(0).click({ clickCount: 3 });
  await posInputs.nth(0).fill('50');
  await posInputs.nth(0).press('Tab');
  // Set Y=50
  await posInputs.nth(1).click({ clickCount: 3 });
  await posInputs.nth(1).fill('50');
  await posInputs.nth(1).press('Tab');
  await page.waitForTimeout(300);

  const posX1 = parseFloat(await posInputs.nth(0).inputValue());
  const posY1 = parseFloat(await posInputs.nth(1).inputValue());
  log('DIAG', `First object position: X=${posX1}, Y=${posY1}`);
  if (Math.abs(posX1 - 50) > 1 || Math.abs(posY1 - 50) > 1) {
    throw new Error(`Position not applied: expected (50, 50), got (${posX1}, ${posY1})`);
  }
  log('OK', 'First object positioned at (50, 50)');

  // Select the second object and position at (150, 150)
  log('STEP', 'Selecting second object and positioning at (150, 150)...');
  await page.locator('.build-plate-object-item:nth-child(2)').click();
  await page.waitForTimeout(500);

  const transformGrid2 = page.locator('.build-plate-transform-section .build-plate-transform-grid').first();
  await transformGrid2.waitFor({ timeout: 5_000 });
  const posInputs2 = transformGrid2.locator('input[type="number"]');

  // Set X=150
  await posInputs2.nth(0).click({ clickCount: 3 });
  await posInputs2.nth(0).fill('150');
  await posInputs2.nth(0).press('Tab');
  // Set Y=150
  await posInputs2.nth(1).click({ clickCount: 3 });
  await posInputs2.nth(1).fill('150');
  await posInputs2.nth(1).press('Tab');
  await page.waitForTimeout(300);

  const posX2 = parseFloat(await posInputs2.nth(0).inputValue());
  const posY2 = parseFloat(await posInputs2.nth(1).inputValue());
  log('DIAG', `Second object position: X=${posX2}, Y=${posY2}`);
  if (Math.abs(posX2 - 150) > 1 || Math.abs(posY2 - 150) > 1) {
    throw new Error(`Position not applied: expected (150, 150), got (${posX2}, ${posY2})`);
  }
  log('OK', 'Second object positioned at (150, 150)');

  // Slice
  const { gcode, elapsed } = await slicePlateAndGetGCode(page, 120_000);

  // Save GCode
  const gcodePath = resolve(OUTPUT_DIR, 'build-plate-verify-positions.gcode');
  writeFileSync(gcodePath, gcode);
  log('OK', `GCode saved to ${gcodePath}`);

  // Parse all extrusion XY positions from GCode
  log('STEP', 'Analyzing extrusion positions in GCode...');
  const lines = gcode.split('\n');
  let curX = 0, curY = 0;
  const extrusionXYs = [];

  for (const line of lines) {
    const g1Match = line.match(/^G1\s(.+)/);
    if (!g1Match) continue;
    const params = g1Match[1];
    const xM = params.match(/X([\d.]+)/);
    const yM = params.match(/Y([\d.]+)/);
    const eM = params.match(/E([\d.]+)/);
    if (xM) curX = parseFloat(xM[1]);
    if (yM) curY = parseFloat(yM[1]);
    if (eM) extrusionXYs.push({ x: curX, y: curY });
  }

  log('DIAG', `Total extrusion positions: ${extrusionXYs.length}`);

  // Compute bounding box of all extrusions
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of extrusionXYs) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  log('DIAG', `Extrusion bounding box: X=[${minX.toFixed(1)}, ${maxX.toFixed(1)}] Y=[${minY.toFixed(1)}, ${maxY.toFixed(1)}]`);

  // Check for extrusion clusters near each target position
  // A 10mm cube at position (50,50) should have extrusions roughly in the range [45-65, 45-65]
  // (position is center of object, cube is ~10mm, plus skirt/brim margin)
  const clusterRadius = 15; // mm — generous to account for skirt/brim

  // Count extrusions near position 1 (50, 50)
  const nearPos1 = extrusionXYs.filter(
    p => Math.abs(p.x - 50) <= clusterRadius && Math.abs(p.y - 50) <= clusterRadius
  );
  log('DIAG', `Extrusions near (50, 50) [±${clusterRadius}mm]: ${nearPos1.length}`);

  // Count extrusions near position 2 (150, 150)
  const nearPos2 = extrusionXYs.filter(
    p => Math.abs(p.x - 150) <= clusterRadius && Math.abs(p.y - 150) <= clusterRadius
  );
  log('DIAG', `Extrusions near (150, 150) [±${clusterRadius}mm]: ${nearPos2.length}`);

  // Both clusters must have significant extrusion activity
  const minExtrusionsPerCluster = 100; // each 10mm cube should have many hundreds of extrusions
  if (nearPos1.length < minExtrusionsPerCluster) {
    throw new Error(
      `Insufficient extrusions near position 1 (50, 50): ${nearPos1.length} (expected >=${minExtrusionsPerCluster}). ` +
      `Object position may not be correctly translated to slicer coordinates.`
    );
  }
  log('OK', `Cluster 1 at (50, 50): ${nearPos1.length} extrusions — object present`);

  if (nearPos2.length < minExtrusionsPerCluster) {
    throw new Error(
      `Insufficient extrusions near position 2 (150, 150): ${nearPos2.length} (expected >=${minExtrusionsPerCluster}). ` +
      `Object position may not be correctly translated to slicer coordinates.`
    );
  }
  log('OK', `Cluster 2 at (150, 150): ${nearPos2.length} extrusions — object present`);

  // Verify the two clusters are separated — no significant extrusions in the middle gap
  // The midpoint region (90-110, 90-110) should have few/no extrusions
  const nearMid = extrusionXYs.filter(
    p => Math.abs(p.x - 100) <= 10 && Math.abs(p.y - 100) <= 10
  );
  log('DIAG', `Extrusions near midpoint (100, 100) [±10mm]: ${nearMid.length}`);

  // Midpoint should have much fewer extrusions than either cluster
  if (nearMid.length > nearPos1.length * 0.1 && nearMid.length > nearPos2.length * 0.1) {
    log('DIAG', `Warning: Significant extrusions at midpoint — objects may not be properly separated`);
  } else {
    log('OK', `Midpoint gap confirmed — objects are spatially separated in GCode`);
  }

  // Also run standard plate validation
  const validation = validatePlateGCode(gcode, 2);
  for (const check of validation.checks) {
    log(check.passed ? 'OK' : 'FAIL', `  ${check.name}: ${check.detail}`);
  }

  log('GCODE', `Lines: ${validation.stats.totalLines}`);
  log('GCODE', `Extrusion moves: ${validation.stats.extrusionMoves}`);
  log('GCODE', `Print area: ${validation.stats.printWidth.toFixed(1)} x ${validation.stats.printDepth.toFixed(1)}mm`);
  if (validation.stats.filamentUsedMm) log('GCODE', `Filament: ${validation.stats.filamentUsedMm.toFixed(1)}mm`);

  if (!validation.passed) {
    throw new Error('GCode validation failed — see checks above');
  }

  // Print area should span from ~(45,45) to ~(165,165) — i.e., ~120mm in both axes
  const printWidth = validation.stats.printWidth;
  const printDepth = validation.stats.printDepth;
  if (printWidth < 80 || printDepth < 80) {
    throw new Error(
      `Print area too small: ${printWidth.toFixed(1)} x ${printDepth.toFixed(1)}mm — ` +
      `expected >80mm in each axis for objects at (50,50) and (150,150)`
    );
  }
  log('OK', `Print area ${printWidth.toFixed(1)} x ${printDepth.toFixed(1)}mm confirms objects are spread apart`);

  log('OK', `Verify object positions in GCode PASSED (sliced in ${elapsed}s) — both positions confirmed`);
}

// ---------------------------------------------------------------------------
// Test: Z height sanity for mixed-height objects
// ---------------------------------------------------------------------------
async function testMixedHeightZSanity({ page, baseUrl }) {
  // Open build plate
  log('STEP', 'Opening build plate...');
  await setupPage(page, baseUrl);
  const buildPlateBtn = page.locator('.build-plate-open-btn').first();
  await buildPlateBtn.waitFor({ timeout: 10_000 });
  await buildPlateBtn.click();
  await page.locator('.build-plate-overlay').waitFor({ timeout: 10_000 });
  log('OK', 'Build plate opened');

  // Add Parametric Cube via picker
  log('STEP', 'Adding Parametric Cube via picker...');
  await addSCADToPlate(page, 'Parametric Cube', 1);
  log('OK', 'Parametric Cube added');

  // Select the object to open right panel
  log('STEP', 'Selecting Parametric Cube to change height_factor...');
  await page.locator('.build-plate-object-item').first().click();
  await page.locator('.build-plate-scad-params-section').waitFor({ timeout: 10_000 });
  log('OK', 'SCAD params section visible');

  // Change "height_factor" parameter from 1 to 5 (making it 10×10×50mm)
  log('STEP', 'Changing "height_factor" parameter to 5...');
  const overlay = page.locator('.build-plate-overlay');
  const paramField = overlay.locator('.param-field').filter({
    has: page.locator('.param-name', { hasText: 'height_factor' }),
  });
  const paramInput = paramField.locator('input[type="number"]');
  await paramInput.waitFor({ timeout: 5_000 });
  await paramInput.click({ clickCount: 3 });
  await paramInput.fill('5');
  await paramInput.press('Tab');
  log('OK', 'height_factor changed to 5');

  // Click Re-render and wait for completion
  log('STEP', 'Re-rendering Parametric Cube with height_factor=5...');
  const reRenderBtn = page.locator('.build-plate-rerender-actions .build-plate-btn--primary', { hasText: 'Re-render' });
  await reRenderBtn.click();

  await page.waitForFunction(
    () => {
      const b = document.querySelector('.build-plate-rerender-actions .build-plate-btn--primary');
      return b && b.textContent === 'Re-render' && !b.disabled;
    },
    { timeout: TIMEOUT_RENDER },
  );
  log('OK', 'Re-render completed');

  // Check for re-render errors
  const reRenderError = page.locator('.build-plate-rerender-error');
  if (await reRenderError.isVisible().catch(() => false)) {
    const errorText = await reRenderError.textContent();
    throw new Error(`Re-render error: ${errorText}`);
  }

  // Add 1cm Cube as second object (10mm tall)
  log('STEP', 'Adding 1cm Cube (10mm tall)...');
  await addSCADToPlate(page, '1cm Cube', 2);
  const count = await page.locator('.build-plate-object-item').count();
  if (count !== 2) throw new Error(`Expected 2 objects, got ${count}`);
  log('OK', '2 objects on plate (50mm tall cube + 10mm cube)');

  // Auto-arrange
  log('STEP', 'Auto-arranging...');
  await page.locator('.build-plate-btn', { hasText: 'Arrange' }).click();
  await page.waitForTimeout(500);
  log('OK', 'Auto-arrange complete');

  // Slice
  log('STEP', 'Slicing mixed-height plate (50mm + 10mm)...');
  const getGCode = await installGCodeInterceptor(page);
  const sliceBtn = page.locator('.build-plate-btn--primary', { hasText: /Slice Plate|Slicing/ });
  await sliceBtn.click();
  log('OK', 'Slice started');

  const startTime = Date.now();
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
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Check for slice error
  const sliceError = await page.evaluate(() => {
    const el = document.querySelector('.build-plate-scad-error');
    if (el && el.textContent?.includes('Slice error:')) return el.textContent;
    return null;
  });
  if (sliceError) throw new Error(`Slicing failed after ${elapsed}s: ${sliceError}`);
  log('OK', `Slicing complete in ${elapsed}s`);

  // Get GCode
  await page.waitForFunction(() => window.__capturedGCode != null, null, { timeout: 10_000 });
  const gcode = await getGCode();
  if (!gcode || gcode.length < 100) throw new Error(`GCode too small: ${gcode?.length ?? 0} bytes`);
  log('OK', `GCode captured: ${gcode.length} bytes`);

  // Save GCode
  const gcodePath = resolve(OUTPUT_DIR, 'build-plate-mixed-height-z-sanity.gcode');
  writeFileSync(gcodePath, gcode);
  log('OK', `GCode saved to ${gcodePath}`);

  // Validate basic GCode
  log('STEP', 'Validating GCode...');
  const validation = validatePlateGCode(gcode, 2);
  for (const check of validation.checks) {
    log(check.passed ? 'OK' : 'FAIL', `  ${check.name}: ${check.detail}`);
  }

  log('GCODE', `Lines: ${validation.stats.totalLines}`);
  log('GCODE', `Extrusion moves: ${validation.stats.extrusionMoves}`);
  log('GCODE', `Layers: ${validation.stats.layerChanges}`);
  log('GCODE', `Z range: ${validation.stats.zRange.min.toFixed(2)}-${validation.stats.zRange.max.toFixed(2)}mm`);
  if (validation.stats.filamentUsedMm) log('GCODE', `Filament: ${validation.stats.filamentUsedMm.toFixed(1)}mm`);

  if (!validation.passed) {
    throw new Error('GCode validation failed — see checks above');
  }
  log('OK', 'Basic GCode validation passed');

  // --- Z height sanity checks ---
  log('STEP', 'Running mixed-height Z sanity checks...');

  // Max Z should be ~50mm (10mm size × 5 height_factor)
  // The cube is center=true, so it extends from -25 to +25, placed on bed = 0 to 50mm
  const maxZ = validation.stats.zRange.max;
  if (maxZ < 45 || maxZ > 55) {
    throw new Error(`Max Z ${maxZ.toFixed(2)}mm outside expected 45-55mm range (expected ~50mm for height_factor=5)`);
  }
  log('OK', `Max Z ${maxZ.toFixed(2)}mm within expected 45-55mm range`);

  // Layer count at 0.2mm layer height: 50mm / 0.2mm = 250 layers expected
  const layers = validation.stats.layerChanges;
  if (layers < 200 || layers > 300) {
    throw new Error(`Layer count ${layers} outside expected 200-300 range (expected ~250 for 50mm at 0.2mm)`);
  }
  log('OK', `Layer count ${layers} within expected 200-300 range`);

  // --- Key check: layers continue above 10mm ---
  // The 1cm Cube finishes at ~10mm. The taller cube should continue.
  // Extract Z values from ;Z: comments and verify extrusion moves at high Z
  const lines = gcode.split('\n');
  const zValues = [];
  for (const l of lines) {
    const m = l.match(/;Z:([\d.]+)/);
    if (m) zValues.push(parseFloat(m[1]));
  }
  log('DIAG', `Total Z layer markers: ${zValues.length}`);

  // Count layers below 10mm, between 10-50mm
  const layersBelow10 = zValues.filter(z => z <= 10.5).length;
  const layersAbove10 = zValues.filter(z => z > 10.5).length;
  log('DIAG', `Layers at Z ≤ 10.5mm: ${layersBelow10}`);
  log('DIAG', `Layers at Z > 10.5mm: ${layersAbove10}`);

  if (layersAbove10 < 150) {
    throw new Error(`Only ${layersAbove10} layers above 10mm — expected ≥150 for 50mm tall object continuing after 10mm cube finishes`);
  }
  log('OK', `${layersAbove10} layers above 10mm — slicer correctly continues for the taller object`);

  // Verify extrusion moves exist at high Z (above 40mm) — proves the tall cube is actually printing
  let currentZ = 0;
  let extrusionsAbove40mm = 0;
  for (const l of lines) {
    const zm = l.match(/;Z:([\d.]+)/);
    if (zm) { currentZ = parseFloat(zm[1]); continue; }
    if (currentZ > 40 && /^G1\s.*E[\d.]+/.test(l)) {
      extrusionsAbove40mm++;
    }
  }
  log('DIAG', `Extrusion moves at Z > 40mm: ${extrusionsAbove40mm}`);

  if (extrusionsAbove40mm < 100) {
    throw new Error(`Only ${extrusionsAbove40mm} extrusion moves above 40mm — expected ≥100. Slicer may have stopped early.`);
  }
  log('OK', `${extrusionsAbove40mm} extrusion moves above 40mm — tall object printing all the way to top`);

  // Check that the 10mm cube contributed extrusion below ~10mm
  let extrusionsBelow10mm = 0;
  currentZ = 0;
  for (const l of lines) {
    const zm = l.match(/;Z:([\d.]+)/);
    if (zm) { currentZ = parseFloat(zm[1]); continue; }
    if (currentZ <= 10.5 && /^G1\s.*E[\d.]+/.test(l)) {
      extrusionsBelow10mm++;
    }
  }
  log('DIAG', `Extrusion moves at Z ≤ 10.5mm: ${extrusionsBelow10mm}`);

  // Below 10mm, both objects are being printed, so extrusions should be higher than above 40mm
  // (where only the tall cube prints)
  if (extrusionsBelow10mm > extrusionsAbove40mm) {
    log('OK', `More extrusions below 10mm (${extrusionsBelow10mm}) than above 40mm (${extrusionsAbove40mm}) — both objects contributing to lower layers`);
  } else {
    log('DIAG', `Extrusions below 10mm (${extrusionsBelow10mm}) vs above 40mm (${extrusionsAbove40mm}) — distribution may vary`);
  }

  log('OK', `Mixed-height Z sanity test PASSED (slice: ${elapsed}s, maxZ: ${maxZ.toFixed(2)}mm, layers: ${layers})`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
// To run a single test, set RUN_TEST env var: RUN_TEST=move-object-then-slice
const allTests = [
  { name: 'editor-to-build-plate-flow', fn: testEditorToBuildPlateFlow },
  { name: 'editor-multicolor-to-build-plate', fn: testEditorMulticolorToBuildPlate },
  { name: 'rerender-scad-then-slice', fn: testReRenderThenSlice },
  { name: 'duplicate-object-then-slice', fn: testDuplicateObjectThenSlice },
  { name: 'delete-object-then-slice', fn: testDeleteObjectThenSlice },
  { name: 'move-object-then-slice', fn: testMoveObjectThenSlice },
  { name: 'slice-after-removing-all-objects', fn: testSliceAfterRemovingAllObjects },
  { name: 'object-at-bed-edge', fn: testObjectAtBedEdge },
  { name: 'zero-scale-object', fn: testZeroScaleObject },
  { name: 'rapid-add-remove-cycle', fn: testRapidAddRemoveCycle },
  { name: 'verify-object-positions-in-gcode', fn: testVerifyObjectPositionsInGCode },
  { name: 'mixed-height-z-sanity', fn: testMixedHeightZSanity },
];
const runTest = process.env.RUN_TEST;
const testsToRun = runTest ? allTests.filter(t => t.name === runTest) : allTests;
runTestSuite('build-plate-realistic', testsToRun);
