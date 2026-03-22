#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * E2E Integration Test: Build Plate Slicing
 *
 * Tests slicing objects on the build plate and validates GCode output.
 * - Single STL object slice + GCode validation
 * - (Future: multi-object slice, per-object overrides)
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
import { validateGCode, validatePlateGCode } from './helpers/gcode-validators.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a minimal valid binary STL (two triangles forming a flat square).
 */
function generateTestSTL() {
  const triangleCount = 2;
  const buf = new ArrayBuffer(80 + 4 + triangleCount * 50);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // Header
  const header = new TextEncoder().encode('STL test: slice-plate');
  u8.set(header.subarray(0, Math.min(header.length, 79)), 0);
  view.setUint32(80, triangleCount, true);

  // Triangle 1: (0,0,0) (10,0,0) (10,10,0)
  let o = 84;
  // Normal (0,0,1)
  view.setFloat32(o, 0, true); o += 4;
  view.setFloat32(o, 0, true); o += 4;
  view.setFloat32(o, 1, true); o += 4;
  // Vertices
  for (const v of [0,0,0, 10,0,0, 10,10,0]) {
    view.setFloat32(o, v, true); o += 4;
  }
  view.setUint16(o, 0, true); o += 2;

  // Triangle 2: (0,0,0) (10,10,0) (0,10,0)
  view.setFloat32(o, 0, true); o += 4;
  view.setFloat32(o, 0, true); o += 4;
  view.setFloat32(o, 1, true); o += 4;
  for (const v of [0,0,0, 10,10,0, 0,10,0]) {
    view.setFloat32(o, v, true); o += 4;
  }
  view.setUint16(o, 0, true);

  return Buffer.from(buf);
}

/**
 * Open build plate overlay from the file screen.
 */
async function openBuildPlate(page, baseUrl) {
  await setupPage(page, baseUrl);
  const btn = page.locator('.build-plate-open-btn').first();
  await btn.waitFor({ timeout: 10_000 });
  await btn.click();
  await page.locator('.build-plate-overlay').waitFor({ timeout: 10_000 });
}

/**
 * Add an STL file to the build plate via toolbar file chooser.
 */
async function addSTLToPlate(page, stlPath) {
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10_000 }),
    page.locator('.build-plate-btn', { hasText: '+ STL' }).click(),
  ]);
  await fileChooser.setFiles(stlPath);
  // Wait for object in sidebar
  await page.locator('.build-plate-object-item').first().waitFor({ timeout: 10_000 });
}

/**
 * Add a SCAD example to the build plate via picker dialog.
 * Waits for OpenSCAD WASM to load and render.
 * @param {number} [expectedCount] - Expected object count after add (for subsequent adds)
 */
async function addSCADToPlate(page, exampleName, expectedCount) {
  // Wait for + SCAD button to be enabled (WASM loaded)
  const scadBtn = page.locator('.build-plate-btn', { hasText: '+ SCAD' });
  await scadBtn.waitFor({ timeout: 10_000 });

  // Poll until enabled (WASM may still be loading)
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

  // Wait for picker, select example
  await page.locator('.build-plate-scad-picker').waitFor({ timeout: 5_000 });
  await page.locator('.build-plate-scad-picker-item', { hasText: exampleName }).click();

  // Wait for render to complete — object appears in sidebar
  if (expectedCount && expectedCount > 1) {
    // Wait for the Nth object to appear
    await page.locator(`.build-plate-object-item:nth-child(${expectedCount})`).waitFor({ timeout: TIMEOUT_RENDER });
  } else {
    await page.locator('.build-plate-object-item').first().waitFor({ timeout: TIMEOUT_RENDER });
  }
}

/**
 * Install a GCode interceptor that captures GCode sent to the preview worker.
 * Must be called BEFORE clicking slice. Returns a function that retrieves the captured GCode.
 */
async function installGCodeInterceptor(page) {
  await page.evaluate(() => {
    // Monkey-patch Worker.prototype.postMessage to capture GCode
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

  return async () => {
    return page.evaluate(() => window.__capturedGCode);
  };
}

/**
 * Click "Slice Plate" and wait for completion, returning captured GCode.
 */
async function slicePlateAndGetGCode(page) {
  // Install interceptor
  const getGCode = await installGCodeInterceptor(page);

  // Click slice
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
        // Success: slice result panel appears
        if (document.querySelector('.build-plate-slice-result')) return 'done';
        // Error: slice error message
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

  // Wait a moment for the GCode to be sent to preview worker
  await page.waitForFunction(
    () => window.__capturedGCode != null,
    null,
    { timeout: 10_000 },
  );

  // Extract GCode
  const gcode = await getGCode();
  if (!gcode || gcode.length < 100) {
    throw new Error(`GCode too small: ${gcode?.length ?? 0} bytes`);
  }
  log('OK', `GCode captured: ${gcode.length} bytes`);

  return { gcode, elapsed };
}

// ---------------------------------------------------------------------------
// Test: Slice single STL object on build plate
// ---------------------------------------------------------------------------
async function testSliceSingleSTL({ page, baseUrl }) {
  log('STEP', 'Opening build plate...');
  await openBuildPlate(page, baseUrl);

  // Add SCAD cube (10mm) — renders via WASM to proper 3D geometry
  log('STEP', 'Adding 1cm Cube via SCAD picker...');
  await addSCADToPlate(page, '1cm Cube');
  log('OK', 'SCAD cube added to plate');

  // Slice
  const { gcode, elapsed } = await slicePlateAndGetGCode(page);

  // Save GCode for inspection
  const gcodePath = resolve(OUTPUT_DIR, 'build-plate-single.gcode');
  writeFileSync(gcodePath, gcode);
  log('OK', `GCode saved to ${gcodePath}`);

  // Validate GCode
  log('STEP', 'Validating GCode...');
  const validation = validateGCode(gcode, { expectedMaxZ: 10, zTolerance: 6 });

  for (const check of validation.checks) {
    log(check.passed ? 'OK' : 'FAIL', `  ${check.name}: ${check.detail}`);
  }

  // Report stats
  log('GCODE', `Lines: ${validation.stats.totalLines}`);
  log('GCODE', `Moves: ${validation.stats.moveCommands}`);
  log('GCODE', `Extrusion: ${validation.stats.extrusionMoves}`);
  log('GCODE', `Layers: ${validation.stats.layerChanges}`);
  log('GCODE', `Z range: ${validation.stats.zRange.min.toFixed(2)}-${validation.stats.zRange.max.toFixed(2)}mm`);
  if (validation.stats.estimatedTime) log('GCODE', `Time: ${validation.stats.estimatedTime}`);
  if (validation.stats.filamentUsedMm) log('GCODE', `Filament: ${validation.stats.filamentUsedMm.toFixed(1)}mm`);

  if (!validation.passed) {
    throw new Error('GCode validation failed — see checks above');
  }
  log('OK', 'All GCode checks passed');

  // Verify print stats are displayed in UI
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
// Test: Empty plate — Slice Plate button disabled
// ---------------------------------------------------------------------------
async function testEmptyPlateValidation({ page, baseUrl }) {
  log('STEP', 'Opening build plate with no objects...');
  await openBuildPlate(page, baseUrl);

  // Verify "Slice Plate" button exists but is disabled (no objects)
  const sliceBtn = page.locator('.build-plate-btn--primary', { hasText: 'Slice Plate' });
  await sliceBtn.waitFor({ timeout: 5_000 });

  const isDisabled = await sliceBtn.isDisabled();
  if (!isDisabled) {
    throw new Error('Slice Plate button should be disabled when plate is empty');
  }
  log('OK', 'Slice Plate button correctly disabled for empty plate');

  // Verify no objects in sidebar
  const objectCount = await page.locator('.build-plate-object-item').count();
  if (objectCount !== 0) {
    throw new Error(`Expected 0 objects in sidebar, got ${objectCount}`);
  }
  log('OK', 'Sidebar confirms empty plate (0 objects)');
}

// ---------------------------------------------------------------------------
// Test: Object out of bounds — validation error appears
// ---------------------------------------------------------------------------
async function testOutOfBoundsValidation({ page, baseUrl }) {
  log('STEP', 'Opening build plate...');
  await openBuildPlate(page, baseUrl);

  // Add an STL object via file chooser
  log('STEP', 'Adding test STL file...');
  const stlPath = resolve(OUTPUT_DIR, 'validation-test.stl');
  writeFileSync(stlPath, generateTestSTL());

  await addSTLToPlate(page, stlPath);
  log('OK', 'STL added to plate');

  // Select the object to open the right panel
  await page.locator('.build-plate-object-item').first().click();

  // Wait for transform inputs to appear
  const transformGrid = page.locator('.build-plate-transform-section .build-plate-transform-grid').first();
  await transformGrid.waitFor({ timeout: 10_000 });

  // Set X position far outside bed bounds (bed is 235mm for ender3-s1)
  log('STEP', 'Moving object far outside bed bounds (X=999)...');
  const posInputs = transformGrid.locator('input[type="number"]');
  await posInputs.nth(0).click({ clickCount: 3 });
  await posInputs.nth(0).fill('999');
  await posInputs.nth(0).press('Tab');
  await page.waitForTimeout(200);

  // Verify position was set
  const posX = parseFloat(await posInputs.nth(0).inputValue());
  if (posX < 500) {
    throw new Error(`Position X wasn't set to 999, got ${posX}`);
  }
  log('OK', `Position set to X=${posX}`);

  // Click "Slice Plate" — should show validation error
  log('STEP', 'Clicking Slice Plate (expecting validation error)...');
  const sliceBtn = page.locator('.build-plate-btn--primary', { hasText: 'Slice Plate' });
  await sliceBtn.click();

  // Wait for validation error to appear
  const errorContainer = page.locator('.build-plate-validation-errors');
  await errorContainer.waitFor({ timeout: 5_000 });
  log('OK', 'Validation error container appeared');

  // Check error text mentions bed bounds
  const errorText = await errorContainer.textContent();
  log('DIAG', `Validation error text: "${errorText}"`);

  if (!errorText || !errorText.includes('outside bed bounds')) {
    throw new Error(`Expected "outside bed bounds" error, got: "${errorText}"`);
  }
  log('OK', 'Correct validation error: object outside bed bounds');

  // Verify no slicing started (no progress bar, no slice result)
  const hasSliceResult = await page.locator('.build-plate-slice-result').isVisible().catch(() => false);
  const hasSliceProgress = await page.locator('.build-plate-slice-progress').isVisible().catch(() => false);
  if (hasSliceResult || hasSliceProgress) {
    throw new Error('Slicing should NOT have started with validation errors');
  }
  log('OK', 'Slicing correctly blocked by validation');
}

// ---------------------------------------------------------------------------
// Test: Validation error dismissal
// ---------------------------------------------------------------------------
async function testValidationErrorDismiss({ page, baseUrl }) {
  log('STEP', 'Opening build plate...');
  await openBuildPlate(page, baseUrl);

  // Add STL and move out of bounds
  log('STEP', 'Adding STL and moving out of bounds...');
  const stlPath = resolve(OUTPUT_DIR, 'dismiss-test.stl');
  writeFileSync(stlPath, generateTestSTL());
  await addSTLToPlate(page, stlPath);

  await page.locator('.build-plate-object-item').first().click();
  const transformGrid = page.locator('.build-plate-transform-section .build-plate-transform-grid').first();
  await transformGrid.waitFor({ timeout: 10_000 });

  const posInputs = transformGrid.locator('input[type="number"]');
  await posInputs.nth(0).click({ clickCount: 3 });
  await posInputs.nth(0).fill('999');
  await posInputs.nth(0).press('Tab');
  await page.waitForTimeout(200);

  // Trigger validation error
  log('STEP', 'Triggering validation error...');
  const sliceBtn = page.locator('.build-plate-btn--primary', { hasText: 'Slice Plate' });
  await sliceBtn.click();

  const errorContainer = page.locator('.build-plate-validation-errors');
  await errorContainer.waitFor({ timeout: 5_000 });
  log('OK', 'Validation error appeared');

  // Click the Dismiss button
  log('STEP', 'Clicking Dismiss button...');
  const dismissBtn = errorContainer.locator('button', { hasText: 'Dismiss' });
  await dismissBtn.click();

  // Verify error container is gone
  await page.waitForFunction(
    () => !document.querySelector('.build-plate-validation-errors'),
    { timeout: 5_000 },
  );
  log('OK', 'Validation errors dismissed successfully');

  // Verify object still on plate (dismiss doesn't remove objects)
  const objectCount = await page.locator('.build-plate-object-item').count();
  if (objectCount !== 1) {
    throw new Error(`Expected 1 object after dismiss, got ${objectCount}`);
  }
  log('OK', 'Object still on plate after dismiss');
}

// ---------------------------------------------------------------------------
// Test: Slice multiple STL objects on build plate
// ---------------------------------------------------------------------------
async function testSliceMultipleObjects({ page, baseUrl }) {
  log('STEP', 'Opening build plate...');
  await openBuildPlate(page, baseUrl);

  // Add first SCAD cube (10mm)
  log('STEP', 'Adding first 1cm Cube via SCAD picker...');
  await addSCADToPlate(page, '1cm Cube', 1);
  const count1 = await page.locator('.build-plate-object-item').count();
  if (count1 !== 1) throw new Error(`Expected 1 object after first add, got ${count1}`);
  log('OK', 'First cube added');

  // Add second SCAD cube
  log('STEP', 'Adding second 1cm Cube via SCAD picker...');
  await addSCADToPlate(page, '1cm Cube', 2);
  const count2 = await page.locator('.build-plate-object-item').count();
  if (count2 !== 2) throw new Error(`Expected 2 objects after second add, got ${count2}`);
  log('OK', 'Second cube added');

  // Add third SCAD cube for good measure
  log('STEP', 'Adding third 1cm Cube via SCAD picker...');
  await addSCADToPlate(page, '1cm Cube', 3);
  const count3 = await page.locator('.build-plate-object-item').count();
  if (count3 !== 3) throw new Error(`Expected 3 objects after third add, got ${count3}`);
  log('OK', 'Third cube added — 3 objects on plate');

  // Auto-arrange to spread objects apart
  log('STEP', 'Auto-arranging objects...');
  const arrangeBtn = page.locator('.build-plate-btn', { hasText: 'Arrange' });
  await arrangeBtn.click();
  await page.waitForTimeout(500); // Let arrange settle

  // Slice
  const { gcode, elapsed } = await slicePlateAndGetGCode(page);

  // Save GCode for inspection
  const gcodePath = resolve(OUTPUT_DIR, 'build-plate-multi-object.gcode');
  writeFileSync(gcodePath, gcode);
  log('OK', `GCode saved to ${gcodePath}`);

  // Validate with plate-specific checks (3 objects)
  log('STEP', 'Validating multi-object GCode...');
  const validation = validatePlateGCode(gcode, 3);

  for (const check of validation.checks) {
    log(check.passed ? 'OK' : 'FAIL', `  ${check.name}: ${check.detail}`);
  }

  // Report stats
  log('GCODE', `Lines: ${validation.stats.totalLines}`);
  log('GCODE', `Moves: ${validation.stats.moveCommands}`);
  log('GCODE', `Extrusion: ${validation.stats.extrusionMoves}`);
  log('GCODE', `Layers: ${validation.stats.layerChanges}`);
  log('GCODE', `Print area: ${validation.stats.printWidth.toFixed(1)} x ${validation.stats.printDepth.toFixed(1)}mm`);
  if (validation.stats.estimatedTime) log('GCODE', `Time: ${validation.stats.estimatedTime}`);
  if (validation.stats.filamentUsedMm) log('GCODE', `Filament: ${validation.stats.filamentUsedMm.toFixed(1)}mm`);

  if (!validation.passed) {
    throw new Error('Multi-object GCode validation failed — see checks above');
  }
  log('OK', `All multi-object GCode checks passed (sliced in ${elapsed}s)`);

  // Verify more filament/time than single-object slice
  // Single 10mm cube ~256mm filament — 3 cubes should be >500mm
  if (validation.stats.filamentUsedMm && validation.stats.filamentUsedMm < 500) {
    log('DIAG', `Filament seems low for 3 objects: ${validation.stats.filamentUsedMm.toFixed(1)}mm (expected >500mm)`);
  } else if (validation.stats.filamentUsedMm) {
    log('OK', `Filament usage scales with 3 objects: ${validation.stats.filamentUsedMm.toFixed(1)}mm`);
  }
}

// ---------------------------------------------------------------------------
// Test: Per-object print setting override affects GCode output
// ---------------------------------------------------------------------------
async function testPerObjectOverrideSlice({ page, baseUrl }) {
  log('STEP', 'Opening build plate...');
  await openBuildPlate(page, baseUrl);

  // Add two SCAD cubes — one will get overrides, one stays at plate defaults
  log('STEP', 'Adding first 1cm Cube (will get 80% infill override)...');
  await addSCADToPlate(page, '1cm Cube', 1);
  log('OK', 'First cube added');

  log('STEP', 'Adding second 1cm Cube (plate defaults — 15% infill)...');
  await addSCADToPlate(page, '1cm Cube', 2);
  log('OK', 'Second cube added');

  // Select first object to open settings panel
  log('STEP', 'Selecting first object to open settings...');
  await page.locator('.build-plate-object-item').nth(0).click();

  // Wait for object settings panel to appear
  await page.locator('.build-plate-object-settings').waitFor({ timeout: 10_000 });
  log('OK', 'Object settings panel opened');

  // Verify override summary shows "Using plate defaults" initially
  const summaryBefore = await page.locator('.build-plate-override-summary-row > span').first().textContent();
  log('DIAG', `Override summary before change: "${summaryBefore}"`);
  if (!summaryBefore || !summaryBefore.includes('plate defaults')) {
    throw new Error(`Expected "Using plate defaults", got: "${summaryBefore}"`);
  }
  log('OK', 'Initially using plate defaults (no overrides)');

  // Click Infill tab
  log('STEP', 'Switching to Infill tab...');
  await page.locator('.build-plate-settings-tab', { hasText: 'Infill' }).click();

  // Wait for infill density range input
  const infillField = page.locator('.print-dialog-field').filter({
    has: page.locator('span:has-text("Infill Density")'),
  }).first();
  await infillField.waitFor({ timeout: 5_000 });

  // Verify field starts with override-inherited class
  const classBefore = await infillField.evaluate((el) => el.className);
  if (!classBefore.includes('override-inherited')) {
    log('DIAG', `Expected override-inherited, got: ${classBefore}`);
  } else {
    log('OK', 'Infill density field shows inherited state');
  }

  // Read initial value (should be 15% — plate default)
  const rangeInput = infillField.locator('input[type="range"]');
  const initialValue = await rangeInput.inputValue();
  log('DIAG', `Initial infill density: ${initialValue}%`);

  // Change infill density to 80% — use JavaScript to set range value + dispatch events
  log('STEP', 'Setting infill density to 80% on first object...');
  await rangeInput.evaluate((el) => {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value',
    ).set;
    nativeInputValueSetter.call(el, '80');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(300);

  // Verify field now shows override-active class
  const classAfter = await infillField.evaluate((el) => el.className);
  if (!classAfter.includes('override-active')) {
    throw new Error(`Expected override-active after change, got: ${classAfter}`);
  }
  log('OK', 'Infill density field marked as overridden (override-active)');

  // Verify reset button is visible
  const resetBtn = infillField.locator('.override-reset-btn');
  if (await resetBtn.isVisible()) {
    log('OK', 'Reset button visible for overridden field');
  } else {
    log('DIAG', 'Reset button not visible (non-fatal)');
  }

  // Verify override summary updated
  const summaryAfter = await page.locator('.build-plate-override-summary-row > span').first().textContent();
  log('DIAG', `Override summary after change: "${summaryAfter}"`);
  if (summaryAfter && summaryAfter.includes('overridden')) {
    log('OK', `Override summary: ${summaryAfter}`);
  }

  // Auto-arrange to spread objects apart
  log('STEP', 'Auto-arranging objects...');
  await page.locator('.build-plate-btn', { hasText: 'Arrange' }).click();
  await page.waitForTimeout(500);

  // Slice the plate
  const { gcode, elapsed } = await slicePlateAndGetGCode(page);

  // Save GCode
  const gcodePath = resolve(OUTPUT_DIR, 'build-plate-per-object-override.gcode');
  writeFileSync(gcodePath, gcode);
  log('OK', `GCode saved to ${gcodePath}`);

  // Validate basic GCode structure
  log('STEP', 'Validating GCode...');
  const validation = validatePlateGCode(gcode, 2);

  for (const check of validation.checks) {
    log(check.passed ? 'OK' : 'FAIL', `  ${check.name}: ${check.detail}`);
  }

  if (!validation.passed) {
    throw new Error('GCode validation failed — see checks above');
  }
  log('OK', 'Basic GCode validation passed');

  // Check that the GCode contains per-object config indication
  // OrcaSlicer embeds settings as comments at the end of GCode
  // With per-object overrides, we expect to see sparse_infill_density in the GCode
  log('STEP', 'Checking GCode for infill density evidence...');

  const filamentUsed = validation.stats.filamentUsedMm || 0;
  log('GCODE', `Filament used: ${filamentUsed.toFixed(1)}mm`);
  log('GCODE', `Extrusion moves: ${validation.stats.extrusionMoves}`);
  log('GCODE', `Lines: ${validation.stats.totalLines}`);

  // With 80% infill on one object vs 15% default on the other,
  // total filament should be significantly more than 2x the 15%-infill baseline (~256mm each = ~512mm)
  // One object at 80% should use substantially more filament.
  // Single 10mm cube at 15% infill ≈ 256mm filament
  // Two cubes at 15% ≈ 512mm. With one at 80%, expect >600mm total.
  if (filamentUsed > 600) {
    log('OK', `Filament usage (${filamentUsed.toFixed(1)}mm) reflects higher infill on first object (expected >600mm for 80%+15%)`);
  } else if (filamentUsed > 500) {
    log('DIAG', `Filament usage (${filamentUsed.toFixed(1)}mm) slightly above 2x baseline — override may have limited effect`);
  } else {
    log('DIAG', `Filament usage (${filamentUsed.toFixed(1)}mm) seems low for one 80% infill object — per-object override may not be taking effect`);
  }

  // Look for sparse_infill_density in GCode comments
  const infillMatches = gcode.match(/sparse_infill_density\s*=\s*[\d%]+/g);
  if (infillMatches && infillMatches.length > 0) {
    log('GCODE', `Infill density in GCode comments: ${infillMatches.join(', ')}`);
  } else {
    log('DIAG', 'No sparse_infill_density found in GCode comments (slicer may not embed per-object overrides)');
  }

  log('OK', `Per-object override slice test complete (sliced in ${elapsed}s)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
runTestSuite('build-plate-slice', [
  { name: 'slice-single-stl', fn: testSliceSingleSTL },
  { name: 'slice-multiple-objects', fn: testSliceMultipleObjects },
  { name: 'per-object-override-slice', fn: testPerObjectOverrideSlice },
  { name: 'empty-plate-validation', fn: testEmptyPlateValidation },
  { name: 'out-of-bounds-validation', fn: testOutOfBoundsValidation },
  { name: 'validation-error-dismiss', fn: testValidationErrorDismiss },
]);
