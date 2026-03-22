// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Shared test harness for build plate e2e tests.
 *
 * Provides common infrastructure: Vite dev server with COOP/COEP headers,
 * Chromium launch via Playwright, printer injection, disclaimer acceptance,
 * structured logging, screenshot-on-failure, and cleanup.
 */

import { chromium } from 'playwright';
import { createServer } from 'vite';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(__dirname, '../..');
export const OUTPUT_DIR = resolve(PROJECT_ROOT, 'test-output');

// Timeouts
export const TIMEOUT_WASM_LOAD = 30_000;
export const TIMEOUT_RENDER = 60_000;
export const TIMEOUT_SLICE = 180_000;

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

/**
 * Structured log output for AI agent parsing.
 * Tags: STEP, OK, FAIL, ERROR, DIAG, CONSOLE, GCODE, SCREENSHOT, RESULT
 */
export function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${tag}] ${ts} ${msg}`);
}

/**
 * Log a failure with optional diagnostic details.
 */
export function fail(msg, details) {
  log('FAIL', msg);
  if (details) log('DIAG', details);
  return false;
}

/**
 * Start a Vite dev server with COOP/COEP headers on a random port.
 * Returns the Vite server instance (call .httpServer.address() for port).
 */
export async function startServer() {
  const server = await createServer({
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
  return server;
}

/**
 * Get the base URL from a running Vite server.
 */
export function getBaseUrl(server) {
  const addr = server.httpServer.address();
  return `http://localhost:${addr.port}/openscad-web-generator/`;
}

/**
 * Launch headless Chromium via Playwright.
 * Returns { browser, context, page }.
 */
export async function launchBrowser() {
  const chromiumPath = process.env.CHROMIUM_PATH || '/run/current-system/sw/bin/google-chrome-stable';
  const browser = await chromium.launch({
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
  return { browser, context, page };
}

/**
 * Attach console and pageerror listeners that collect messages into an array.
 * Returns the consoleLogs array.
 */
export function collectConsoleLogs(page) {
  const consoleLogs = [];
  page.on('console', (msg) => {
    const entry = `[${msg.type()}] ${msg.text()}`;
    consoleLogs.push(entry);
    if (msg.type() === 'error') {
      log('CONSOLE', entry);
    }
  });
  page.on('pageerror', (err) => {
    const entry = `[pageerror] ${err.message}`;
    consoleLogs.push(entry);
    log('CONSOLE', entry);
  });
  return consoleLogs;
}

/**
 * Inject a test printer into localStorage and accept the disclaimer.
 * Must be called after navigating to the app (so localStorage is on the right origin).
 */
export async function injectTestPrinter(page) {
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
}

/**
 * Accept the disclaimer dialog if it appears.
 */
export async function acceptDisclaimer(page) {
  const disclaimerBtn = page.locator('.disclaimer-ok-btn');
  if (await disclaimerBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await disclaimerBtn.click();
    log('OK', 'Disclaimer accepted');
  } else {
    log('OK', 'No disclaimer shown (already accepted)');
  }
}

/**
 * Navigate to the app, inject test printer, and optionally load an example.
 * Handles disclaimer acceptance and waits for the appropriate screen.
 *
 * @param {import('playwright').Page} page
 * @param {string} baseUrl
 * @param {object} [options]
 * @param {string} [options.example] - Example file to load (e.g., 'cube_1cm.scad')
 * @param {boolean} [options.noPrinter] - Don't inject a test printer
 */
export async function setupPage(page, baseUrl, options = {}) {
  // Initial navigation to set up localStorage
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await acceptDisclaimer(page);

  if (!options.noPrinter) {
    await injectTestPrinter(page);
  }

  // Reload with example if specified
  const url = options.example ? `${baseUrl}?example=${options.example}` : baseUrl;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
}

/**
 * Take a screenshot and log its path. Used on failure.
 *
 * @param {import('playwright').Page} page
 * @param {string} name - Screenshot filename (without extension)
 * @returns {string} Path to the saved screenshot
 */
export async function screenshotOnFailure(page, name) {
  const screenshotPath = resolve(OUTPUT_DIR, `${name}.png`);
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    log('SCREENSHOT', screenshotPath);
  } catch (err) {
    log('DIAG', `Failed to take screenshot: ${err.message}`);
  }
  return screenshotPath;
}

/**
 * Write console logs to a file and log diagnostics summary.
 *
 * @param {string[]} consoleLogs
 * @param {string} prefix - Filename prefix for the log file
 */
export function writeConsoleLogs(consoleLogs, prefix) {
  if (consoleLogs.length > 0) {
    log('DIAG', `--- Browser console (${consoleLogs.length} messages) ---`);
    const tail = consoleLogs.slice(-50);
    for (const entry of tail) {
      log('CONSOLE', entry);
    }
    if (consoleLogs.length > 50) {
      log('DIAG', `... (${consoleLogs.length - 50} earlier messages omitted)`);
    }
  }

  const consoleLogPath = resolve(OUTPUT_DIR, `${prefix}-browser-console.log`);
  writeFileSync(consoleLogPath, consoleLogs.join('\n'));
  log('DIAG', `Console log: ${consoleLogPath} (${consoleLogs.length} lines)`);
}

/**
 * Clean up server and browser resources.
 */
export async function cleanup(server, browser) {
  if (browser) {
    try { await browser.close(); } catch { /* ignore */ }
  }
  if (server) {
    try { await server.close(); } catch { /* ignore */ }
  }
}

/**
 * Run a set of named test functions, handling infrastructure setup and teardown.
 * Each test function receives { page, baseUrl, server } and should throw on failure.
 *
 * @param {string} suiteName - Name of the test suite (used for log files)
 * @param {Array<{ name: string, fn: Function }>} tests - Test cases to run
 * @returns {Promise<void>} Exits the process with appropriate exit code
 */
export async function runTestSuite(suiteName, tests) {
  let server = null;
  let browser = null;
  let exitCode = 0;
  const consoleLogs = [];
  const results = [];

  try {
    // Start server
    log('STEP', 'Starting Vite dev server with COOP/COEP headers...');
    server = await startServer();
    const baseUrl = getBaseUrl(server);
    log('OK', `Dev server running at ${baseUrl}`);

    // Launch browser
    log('STEP', 'Launching Chromium...');
    const browserResult = await launchBrowser();
    browser = browserResult.browser;

    // Run each test in a fresh page
    for (const test of tests) {
      log('STEP', `--- Test: ${test.name} ---`);
      const context = await browser.newContext();
      const page = await context.newPage();
      const testLogs = collectConsoleLogs(page);

      try {
        await test.fn({ page, baseUrl, server });
        log('OK', `PASSED: ${test.name}`);
        results.push({ name: test.name, passed: true });
      } catch (err) {
        log('FAIL', `FAILED: ${test.name} — ${err.message}`);
        await screenshotOnFailure(page, `${suiteName}-${test.name.replace(/\s+/g, '-')}`);
        results.push({ name: test.name, passed: false, error: err.message });
        exitCode = 1;
      } finally {
        consoleLogs.push(...testLogs);
        await context.close().catch(() => {});
      }
    }
  } catch (err) {
    log('ERROR', `Infrastructure error: ${err.message}`);
    exitCode = 2;
  } finally {
    writeConsoleLogs(consoleLogs, suiteName);
    await cleanup(server, browser);

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    log('RESULT', JSON.stringify({
      suite: suiteName,
      passed: exitCode === 0,
      exitCode,
      tests: { total: results.length, passed, failed },
      results,
    }));
  }

  process.exit(exitCode);
}
