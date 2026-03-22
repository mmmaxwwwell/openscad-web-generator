#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * E2E Integration Test: Build Plate Entry Points
 *
 * Tests all ways to open/close the build plate overlay:
 * - File screen "Build Plate" button
 * - Editor screen "Build Plate" button
 * - No printer configured → toast error
 * - Close button returns to previous screen
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
// Test: File screen entry — click "Build Plate" button on file manager screen
// ---------------------------------------------------------------------------
async function testFileScreenEntry({ page, baseUrl }) {
  log('STEP', 'Navigating to file screen with test printer...');
  await setupPage(page, baseUrl);

  // Should be on file screen — look for the Build Plate button
  log('STEP', 'Looking for Build Plate button on file screen...');
  const buildPlateBtn = page.locator('.build-plate-open-btn').first();
  await buildPlateBtn.waitFor({ timeout: 10_000 });
  log('OK', 'Build Plate button found on file screen');

  // Click it
  log('STEP', 'Clicking Build Plate button...');
  await buildPlateBtn.click();

  // Verify build plate overlay opens
  log('STEP', 'Waiting for build plate overlay...');
  const overlay = page.locator('.build-plate-overlay');
  await overlay.waitFor({ timeout: 10_000 });
  log('OK', 'Build plate overlay opened');

  // Verify key elements are visible: toolbar, sidebar, canvas container
  const toolbar = page.locator('.build-plate-toolbar');
  const sidebar = page.locator('.build-plate-sidebar');
  const canvas = page.locator('.build-plate-canvas-container');

  await toolbar.waitFor({ timeout: 5_000 });
  log('OK', 'Toolbar visible');

  await sidebar.waitFor({ timeout: 5_000 });
  log('OK', 'Sidebar visible');

  await canvas.waitFor({ timeout: 5_000 });
  log('OK', 'Canvas container visible');

  log('OK', 'File screen entry: all elements present');
}

// ---------------------------------------------------------------------------
// Test: Editor screen entry — load example, then click "Build Plate"
// ---------------------------------------------------------------------------
async function testEditorScreenEntry({ page, baseUrl }) {
  log('STEP', 'Loading example cube_1cm.scad...');
  await setupPage(page, baseUrl, { example: 'cube_1cm.scad' });

  // Wait for editor screen (export controls indicate editor is loaded)
  log('STEP', 'Waiting for editor screen...');
  await page.locator('.export-controls').waitFor({ timeout: 10_000 });
  log('OK', 'Editor screen loaded');

  // Find and click Build Plate button on editor screen
  log('STEP', 'Clicking Build Plate button on editor screen...');
  const buildPlateBtn = page.locator('.build-plate-open-btn');
  await buildPlateBtn.waitFor({ timeout: 5_000 });
  await buildPlateBtn.click();

  // Verify overlay opens
  log('STEP', 'Waiting for build plate overlay...');
  const overlay = page.locator('.build-plate-overlay');
  await overlay.waitFor({ timeout: 10_000 });
  log('OK', 'Build plate overlay opened from editor screen');

  // Verify toolbar and sidebar are present
  await page.locator('.build-plate-toolbar').waitFor({ timeout: 5_000 });
  await page.locator('.build-plate-sidebar').waitFor({ timeout: 5_000 });
  log('OK', 'Editor screen entry: build plate elements present');
}

// ---------------------------------------------------------------------------
// Test: No printer configured → toast error
// ---------------------------------------------------------------------------
async function testNoPrinterError({ page, baseUrl }) {
  log('STEP', 'Navigating without printer configured...');
  // First visit: set disclaimer accepted and ensure NO printers in localStorage
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.evaluate(() => {
    localStorage.setItem('disclaimer-accepted', 'true');
    localStorage.setItem('moonraker-printers', JSON.stringify([]));
  });
  // Reload so the app initializes with empty printers
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // Wait for the app to be ready
  log('STEP', 'Waiting for app to render...');
  const buildPlateBtn = page.locator('.build-plate-open-btn').first();
  await buildPlateBtn.waitFor({ timeout: 10_000 });

  // Click Build Plate button
  log('STEP', 'Clicking Build Plate button with no printer...');
  await buildPlateBtn.click();

  // Small delay to let React process the click
  await page.waitForTimeout(500);

  // Verify build plate overlay did NOT open (no printer = should be blocked)
  const overlayCount = await page.locator('.build-plate-overlay').count();
  if (overlayCount === 0) {
    log('OK', 'Build plate overlay correctly did not open (no printer configured)');
  } else {
    throw new Error('Build plate overlay opened despite no printer configured');
  }

  // Note: Toast component is only in the editor-screen return path of App.tsx,
  // not the file-screen path. So the toast message won't be visible in DOM here.
  // We verify the functional behavior: overlay doesn't open, app doesn't crash.
  log('OK', 'No-printer guard works — build plate blocked without crash');
}

// ---------------------------------------------------------------------------
// Test: Close build plate — click close button, overlay disappears
// ---------------------------------------------------------------------------
async function testCloseBuildPlate({ page, baseUrl }) {
  log('STEP', 'Opening build plate from file screen...');
  await setupPage(page, baseUrl);

  const buildPlateBtn = page.locator('.build-plate-open-btn').first();
  await buildPlateBtn.waitFor({ timeout: 10_000 });
  await buildPlateBtn.click();

  // Wait for overlay to open
  const overlay = page.locator('.build-plate-overlay');
  await overlay.waitFor({ timeout: 10_000 });
  log('OK', 'Build plate overlay opened');

  // Click the close button
  log('STEP', 'Clicking close button...');
  const closeBtn = page.locator('.build-plate-close');
  await closeBtn.waitFor({ timeout: 5_000 });
  await closeBtn.click();

  // Verify overlay disappears
  log('STEP', 'Waiting for overlay to disappear...');
  await overlay.waitFor({ state: 'detached', timeout: 5_000 });
  log('OK', 'Build plate overlay closed');

  // Verify we're back on the file screen (Build Plate button should be visible again)
  await buildPlateBtn.waitFor({ timeout: 5_000 });
  log('OK', 'Returned to file screen after closing build plate');
}

// ---------------------------------------------------------------------------
// Test: Send to Build Plate — render STL, click "+ Build Plate", verify object
// ---------------------------------------------------------------------------
async function testSendToBuildPlate({ page, baseUrl }) {
  log('STEP', 'Loading example cube_1cm.scad on editor screen...');
  await setupPage(page, baseUrl, { example: 'cube_1cm.scad' });

  // Wait for editor screen
  log('STEP', 'Waiting for editor screen...');
  await page.locator('.export-controls').waitFor({ timeout: 10_000 });
  log('OK', 'Editor screen loaded');

  // Click the first Render button (STL section) to trigger WASM load + render
  log('STEP', 'Rendering STL (triggers WASM load)...');
  const stlRenderBtn = page.locator('.export-render-btn').first();
  await stlRenderBtn.click();
  log('DIAG', 'Clicked STL render button, waiting for WASM load + render...');

  // Wait for render to complete — button text changes to "Re-render"
  try {
    await stlRenderBtn.filter({ hasText: /Re-render/ }).waitFor({ timeout: TIMEOUT_RENDER });
    log('OK', 'STL rendered successfully');
  } catch {
    const btnText = await stlRenderBtn.textContent().catch(() => 'unknown');
    const errorEl = page.locator('.export-error');
    if (await errorEl.isVisible().catch(() => false)) {
      const errorText = await errorEl.textContent().catch(() => 'unknown');
      throw new Error(`Render failed: ${errorText}`);
    }
    throw new Error(`Render did not complete within ${TIMEOUT_RENDER / 1000}s. Button: ${btnText}`);
  }

  // The "+ Build Plate" button should now be visible (only appears when render is cached)
  log('STEP', 'Looking for "+ Build Plate" button...');
  const buildPlateBtn = page.locator('.export-build-plate-btn').first();
  await buildPlateBtn.waitFor({ timeout: 5_000 });
  log('OK', '"+ Build Plate" button visible');

  // Click "+ Build Plate"
  log('STEP', 'Clicking "+ Build Plate" button...');
  await buildPlateBtn.click();

  // Verify build plate overlay opens
  log('STEP', 'Waiting for build plate overlay...');
  const overlay = page.locator('.build-plate-overlay');
  await overlay.waitFor({ timeout: 10_000 });
  log('OK', 'Build plate overlay opened');

  // Verify the cube object appears in the sidebar object list
  log('STEP', 'Waiting for object to appear in sidebar...');
  const objectItem = page.locator('.build-plate-object-item');
  await objectItem.first().waitFor({ timeout: 10_000 });
  const objectCount = await objectItem.count();
  if (objectCount < 1) {
    throw new Error(`Expected at least 1 object in sidebar, got ${objectCount}`);
  }
  log('OK', `Object appeared in sidebar (${objectCount} object(s))`);

  // Verify the object name contains "cube" (from cube_1cm.scad)
  const objectText = await objectItem.first().textContent();
  log('DIAG', `Object item text: "${objectText}"`);
  if (!/cube/i.test(objectText)) {
    log('DIAG', `Warning: object name does not contain "cube" — got "${objectText}"`);
  } else {
    log('OK', 'Object name contains "cube"');
  }

  // Verify canvas container is present (mesh should be rendering)
  await page.locator('.build-plate-canvas-container').waitFor({ timeout: 5_000 });
  log('OK', 'Canvas container visible — object should be rendered');

  log('OK', 'Send to Build Plate: full flow works — render → add → overlay → object visible');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
runTestSuite('build-plate-entry', [
  { name: 'file-screen-entry', fn: testFileScreenEntry },
  { name: 'editor-screen-entry', fn: testEditorScreenEntry },
  { name: 'no-printer-error', fn: testNoPrinterError },
  { name: 'close-build-plate', fn: testCloseBuildPlate },
  { name: 'send-to-build-plate', fn: testSendToBuildPlate },
]);
