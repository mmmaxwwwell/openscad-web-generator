#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * E2E Integration Test: Build Plate SCAD Re-render
 *
 * Tests the SCAD parameter editing + re-render flow on the build plate:
 * - Add a parametric SCAD file, change parameters, re-render in-place
 * - Verify the object's position is preserved after re-rendering
 * - Verify the mesh was updated (no errors, rendering completes)
 *
 * Uses the "Parametric Cube" example (public/examples/param_cube.scad) which
 * has BEGIN_PARAMS markers and two numeric parameters: size and height_factor.
 *
 * --- AI Agent Interface ---
 * Exit codes: 0 = pass, 1 = fail, 2 = infra error
 * Output: [STEP] [OK] [FAIL] [ERROR] [SCREENSHOT] [RESULT]
 */

import {
  log,
  setupPage,
  runTestSuite,
  TIMEOUT_RENDER,
} from './helpers/build-plate-harness.mjs';

// ---------------------------------------------------------------------------
// Helper: Open build plate overlay
// ---------------------------------------------------------------------------
async function openBuildPlate(page, baseUrl) {
  await setupPage(page, baseUrl);
  const buildPlateBtn = page.locator('.build-plate-open-btn').first();
  await buildPlateBtn.waitFor({ timeout: 10_000 });
  await buildPlateBtn.click();
  await page.locator('.build-plate-overlay').waitFor({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Helper: Add "Parametric Cube" via the SCAD picker
// ---------------------------------------------------------------------------
async function addParametricCube(page) {
  // Click "+ SCAD" button
  const scadBtn = page.locator('.build-plate-btn', { hasText: '+ SCAD' });
  await scadBtn.waitFor({ timeout: 10_000 });

  // Wait for button to be enabled (OpenSCAD WASM may still be loading)
  if (await scadBtn.isDisabled()) {
    log('DIAG', '"+ SCAD" button disabled — waiting for OpenSCAD WASM...');
    await page.waitForFunction(
      () => {
        const btns = document.querySelectorAll('.build-plate-btn');
        for (const btn of btns) {
          if (btn.textContent.includes('+ SCAD') && !btn.disabled) return true;
        }
        return false;
      },
      { timeout: 30_000 },
    );
    log('OK', 'OpenSCAD WASM loaded');
  }

  await scadBtn.click();

  // Select "Parametric Cube" from the picker
  const picker = page.locator('.build-plate-scad-picker');
  await picker.waitFor({ timeout: 5_000 });
  await page.locator('.build-plate-scad-picker-item', { hasText: 'Parametric Cube' }).click();

  // Wait for WASM render — object appears in sidebar
  log('STEP', 'Waiting for Parametric Cube WASM render...');
  const objectItem = page.locator('.build-plate-object-item');
  await objectItem.first().waitFor({ timeout: TIMEOUT_RENDER });
  log('OK', 'Parametric Cube rendered and added to plate');
}

// ---------------------------------------------------------------------------
// Helper: Select the first object and wait for the right panel to open
// ---------------------------------------------------------------------------
async function selectFirstObject(page) {
  await page.locator('.build-plate-object-item').first().click();
  // Wait for right panel with SCAD params section
  await page.locator('.build-plate-scad-params-section').waitFor({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Helper: Read position values from the right panel transform inputs
// ---------------------------------------------------------------------------
async function readPosition(page) {
  const transformGrid = page.locator('.build-plate-transform-section .build-plate-transform-grid').first();
  const inputs = transformGrid.locator('input[type="number"]');
  const posX = parseFloat(await inputs.nth(0).inputValue());
  const posY = parseFloat(await inputs.nth(1).inputValue());
  return { x: posX, y: posY };
}

// ---------------------------------------------------------------------------
// Helper: Change a numeric SCAD parameter by name
// ---------------------------------------------------------------------------
async function changeParam(page, paramName, newValue) {
  const paramField = page.locator('.param-field').filter({
    has: page.locator('.param-name', { hasText: paramName }),
  });
  const input = paramField.locator('input[type="number"]');
  await input.waitFor({ timeout: 5_000 });
  await input.click({ clickCount: 3 });
  await input.fill(String(newValue));
  await input.press('Tab');
}

// ---------------------------------------------------------------------------
// Helper: Click Re-render and wait for completion
// ---------------------------------------------------------------------------
async function reRenderAndWait(page) {
  const btn = page.locator('.build-plate-rerender-actions .build-plate-btn--primary', { hasText: 'Re-render' });
  await btn.click();

  // Wait for button to return to "Re-render" (not "Rendering...") and be enabled
  await page.waitForFunction(
    () => {
      const b = document.querySelector('.build-plate-rerender-actions .build-plate-btn--primary');
      return b && b.textContent === 'Re-render' && !b.disabled;
    },
    { timeout: TIMEOUT_RENDER },
  );

  // Check for errors
  const errorEl = page.locator('.build-plate-rerender-error');
  if (await errorEl.isVisible().catch(() => false)) {
    const errorText = await errorEl.textContent();
    throw new Error(`Re-render error: ${errorText}`);
  }
}

// ---------------------------------------------------------------------------
// Helper: Assert positions match within tolerance
// ---------------------------------------------------------------------------
function assertPositionMatch(before, after, label, tolerance = 0.1) {
  if (Math.abs(after.x - before.x) > tolerance) {
    throw new Error(`${label}: X changed ${before.x} → ${after.x}`);
  }
  if (Math.abs(after.y - before.y) > tolerance) {
    throw new Error(`${label}: Y changed ${before.y} → ${after.y}`);
  }
}

// ---------------------------------------------------------------------------
// Test 1: Change SCAD parameter + re-render preserves position
// ---------------------------------------------------------------------------
async function testScadRerender({ page, baseUrl }) {
  log('STEP', 'Opening build plate...');
  await openBuildPlate(page, baseUrl);

  log('STEP', 'Adding Parametric Cube...');
  await addParametricCube(page);

  // Verify SCAD type badge
  const badge = await page.locator('.build-plate-object-type-badge').first().textContent();
  if (badge !== 'SCAD') throw new Error(`Expected "SCAD" badge, got "${badge}"`);
  log('OK', 'Object has SCAD type badge');

  // Select object — opens right panel with SCAD params
  log('STEP', 'Selecting object...');
  await selectFirstObject(page);
  log('OK', 'SCAD Parameters section visible');

  // Record position before re-render
  const posBefore = await readPosition(page);
  log('DIAG', `Position before: X=${posBefore.x}, Y=${posBefore.y}`);

  // Change "size" parameter from 10 to 20
  log('STEP', 'Changing "size" parameter to 20...');
  await changeParam(page, 'size', 20);
  log('OK', 'Parameter changed');

  // Re-render
  log('STEP', 'Re-rendering...');
  await reRenderAndWait(page);
  log('OK', 'Re-render completed');

  // Verify position preserved
  const posAfter = await readPosition(page);
  log('DIAG', `Position after: X=${posAfter.x}, Y=${posAfter.y}`);
  assertPositionMatch(posBefore, posAfter, 'Re-render');
  log('OK', 'Position preserved after re-render');
}

// ---------------------------------------------------------------------------
// Test 2: Move object to custom position, re-render — position stays
// ---------------------------------------------------------------------------
async function testRerenderAfterMove({ page, baseUrl }) {
  log('STEP', 'Opening build plate...');
  await openBuildPlate(page, baseUrl);

  log('STEP', 'Adding Parametric Cube...');
  await addParametricCube(page);

  // Select and open right panel
  await selectFirstObject(page);

  // Set a custom position via the transform inputs
  log('STEP', 'Setting custom position (X=42, Y=37)...');
  const transformGrid = page.locator('.build-plate-transform-section .build-plate-transform-grid').first();
  const posInputs = transformGrid.locator('input[type="number"]');

  await posInputs.nth(0).click({ clickCount: 3 });
  await posInputs.nth(0).fill('42');
  await posInputs.nth(0).press('Tab');

  await posInputs.nth(1).click({ clickCount: 3 });
  await posInputs.nth(1).fill('37');
  await posInputs.nth(1).press('Tab');

  await page.waitForTimeout(200);

  const posBefore = await readPosition(page);
  log('DIAG', `Position set: X=${posBefore.x}, Y=${posBefore.y}`);
  if (Math.abs(posBefore.x - 42) > 1 || Math.abs(posBefore.y - 37) > 1) {
    throw new Error(`Position wasn't set: X=${posBefore.x}, Y=${posBefore.y}`);
  }
  log('OK', 'Custom position set');

  // Change "height_factor" parameter
  log('STEP', 'Changing "height_factor" to 3...');
  await changeParam(page, 'height_factor', 3);

  // Re-render
  log('STEP', 'Re-rendering...');
  await reRenderAndWait(page);
  log('OK', 'Re-render completed');

  // Verify custom position preserved
  const posAfter = await readPosition(page);
  log('DIAG', `Position after: X=${posAfter.x}, Y=${posAfter.y}`);
  assertPositionMatch({ x: 42, y: 37 }, posAfter, 'Custom position');
  log('OK', 'Custom position preserved after re-render');
}

// ---------------------------------------------------------------------------
// Test 3: Re-render twice in succession — both preserve position
// ---------------------------------------------------------------------------
async function testDoubleRerender({ page, baseUrl }) {
  log('STEP', 'Opening build plate...');
  await openBuildPlate(page, baseUrl);

  log('STEP', 'Adding Parametric Cube...');
  await addParametricCube(page);
  await selectFirstObject(page);

  const posInitial = await readPosition(page);
  log('DIAG', `Initial position: X=${posInitial.x}, Y=${posInitial.y}`);

  // First re-render: size → 15
  log('STEP', 'First re-render: size → 15...');
  await changeParam(page, 'size', 15);
  await reRenderAndWait(page);
  log('OK', 'First re-render completed');

  const posAfter1 = await readPosition(page);
  assertPositionMatch(posInitial, posAfter1, 'After 1st re-render');
  log('OK', 'Position preserved after 1st re-render');

  // Second re-render: size → 25
  log('STEP', 'Second re-render: size → 25...');
  await changeParam(page, 'size', 25);
  await reRenderAndWait(page);
  log('OK', 'Second re-render completed');

  const posAfter2 = await readPosition(page);
  assertPositionMatch(posInitial, posAfter2, 'After 2nd re-render');
  log('OK', 'Position preserved after both re-renders');
}

// ---------------------------------------------------------------------------
// Test 4: Multicolor SCAD re-render — position + colorGroups preserved
// ---------------------------------------------------------------------------
async function testMulticolorRerender({ page, baseUrl }) {
  // Step 1: Load param_multicolor.scad in the editor
  log('STEP', 'Loading param_multicolor.scad in editor...');
  await setupPage(page, baseUrl, { example: 'param_multicolor.scad' });
  await page.locator('.export-controls').waitFor({ timeout: 10_000 });
  log('OK', 'Editor screen loaded');

  // Step 2: Click the Multi-Color 3MF Render button (3rd export section)
  log('STEP', 'Rendering Multi-Color 3MF...');
  const renderBtns = page.locator('.export-render-btn');
  // The 3rd render button is for "Multi-Color 3MF"
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

  // Step 3: Click "+ Build Plate" in the Multi-Color 3MF section
  // Only the multicolor section was rendered, so only one "+ Build Plate" button exists
  log('STEP', 'Sending to build plate...');
  const buildPlateBtn = page.locator('.export-build-plate-btn').first();
  await buildPlateBtn.waitFor({ timeout: 5_000 });
  await buildPlateBtn.click();

  // Step 4: Wait for build plate overlay to open
  log('STEP', 'Waiting for build plate overlay...');
  await page.locator('.build-plate-overlay').waitFor({ timeout: 10_000 });
  log('OK', 'Build plate overlay opened');

  // Wait for object in sidebar
  const objectItem = page.locator('.build-plate-object-item');
  await objectItem.first().waitFor({ timeout: 10_000 });
  log('OK', 'Object appeared in sidebar');

  // Verify SCAD type badge
  const badge = await page.locator('.build-plate-object-type-badge').first().textContent();
  if (badge !== 'SCAD') throw new Error(`Expected "SCAD" badge, got "${badge}"`);
  log('OK', 'Object has SCAD type badge');

  // Verify color indicator is present (multicolor objects show color dots)
  const colorDots = page.locator('.build-plate-object-item .build-plate-color-dot');
  const colorDotCount = await colorDots.count();
  if (colorDotCount < 2) {
    log('DIAG', `Expected 2+ color dots, got ${colorDotCount} — checking object details`);
  } else {
    log('OK', `Object has ${colorDotCount} color dots (multicolor)`);
  }

  // Step 5: Select object — opens right panel with SCAD params
  log('STEP', 'Selecting object...');
  await objectItem.first().click();
  await page.locator('.build-plate-scad-params-section').waitFor({ timeout: 10_000 });
  log('OK', 'SCAD parameters section visible');

  // Verify "Re-render Multicolor" button is visible (requires colorGroups)
  const reRenderMulticolorBtn = page.locator('.build-plate-rerender-actions .build-plate-btn--primary', {
    hasText: 'Re-render Multicolor',
  });
  await reRenderMulticolorBtn.waitFor({ timeout: 5_000 });
  log('OK', '"Re-render Multicolor" button visible');

  // Record position before re-render
  const posBefore = await readPosition(page);
  log('DIAG', `Position before: X=${posBefore.x}, Y=${posBefore.y}`);

  // Step 6: Change "size" parameter from 10 to 15
  // Scope to build plate overlay to avoid matching editor params behind overlay
  log('STEP', 'Changing "size" parameter to 15...');
  const overlay = page.locator('.build-plate-overlay');
  const paramField = overlay.locator('.param-field').filter({
    has: page.locator('.param-name', { hasText: 'size' }),
  });
  const paramInput = paramField.locator('input[type="number"]');
  await paramInput.waitFor({ timeout: 5_000 });
  await paramInput.click({ clickCount: 3 });
  await paramInput.fill('15');
  await paramInput.press('Tab');
  log('OK', 'Parameter changed');

  // Step 7: Click "Re-render Multicolor" and wait
  log('STEP', 'Re-rendering multicolor...');
  await reRenderMulticolorBtn.click();

  // Wait for button to return to "Re-render Multicolor" and be enabled
  await page.waitForFunction(
    () => {
      const btns = document.querySelectorAll('.build-plate-rerender-actions .build-plate-btn--primary');
      for (const b of btns) {
        if (b.textContent === 'Re-render Multicolor' && !b.disabled) return true;
      }
      return false;
    },
    { timeout: TIMEOUT_RENDER },
  );
  log('OK', 'Multicolor re-render completed');

  // Check for errors
  const errorEl = page.locator('.build-plate-rerender-error');
  if (await errorEl.isVisible().catch(() => false)) {
    const errorText = await errorEl.textContent();
    throw new Error(`Re-render error: ${errorText}`);
  }

  // Step 8: Verify position preserved
  const posAfter = await readPosition(page);
  log('DIAG', `Position after: X=${posAfter.x}, Y=${posAfter.y}`);
  assertPositionMatch(posBefore, posAfter, 'Multicolor re-render');
  log('OK', 'Position preserved after multicolor re-render');

  // Step 9: Verify "Re-render Multicolor" button is still visible (colorGroups preserved)
  await reRenderMulticolorBtn.waitFor({ timeout: 5_000 });
  log('OK', '"Re-render Multicolor" button still visible (colorGroups preserved)');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
runTestSuite('build-plate-scad-rerender', [
  { name: 'scad-param-change-rerender', fn: testScadRerender },
  { name: 'rerender-after-move', fn: testRerenderAfterMove },
  { name: 'double-rerender', fn: testDoubleRerender },
  { name: 'multicolor-scad-rerender', fn: testMulticolorRerender },
]);
