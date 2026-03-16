#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Performance profiling script for libslic3r WASM.
 *
 * Uses Playwright (system Chrome) + Vite dev server with COOP/COEP headers
 * to measure slicer performance in a real browser environment.
 *
 * Usage: node scripts/profile-slicer.mjs
 */

import { createServer } from 'vite';
import { chromium } from 'playwright';

// ---------------------------------------------------------------------------
// ASCII STL for a 10mm cube (12 triangles, ~1.5KB)
// ---------------------------------------------------------------------------
const ASCII_STL_10MM_CUBE = `solid cube
facet normal 0 0 -1
  outer loop
    vertex 0 0 0
    vertex 10 0 0
    vertex 10 10 0
  endloop
endfacet
facet normal 0 0 -1
  outer loop
    vertex 0 0 0
    vertex 10 10 0
    vertex 0 10 0
  endloop
endfacet
facet normal 0 0 1
  outer loop
    vertex 0 0 10
    vertex 10 10 10
    vertex 10 0 10
  endloop
endfacet
facet normal 0 0 1
  outer loop
    vertex 0 0 10
    vertex 0 10 10
    vertex 10 10 10
  endloop
endfacet
facet normal 0 -1 0
  outer loop
    vertex 0 0 0
    vertex 10 0 10
    vertex 10 0 0
  endloop
endfacet
facet normal 0 -1 0
  outer loop
    vertex 0 0 0
    vertex 0 0 10
    vertex 10 0 10
  endloop
endfacet
facet normal 0 1 0
  outer loop
    vertex 0 10 0
    vertex 10 10 0
    vertex 10 10 10
  endloop
endfacet
facet normal 0 1 0
  outer loop
    vertex 0 10 0
    vertex 10 10 10
    vertex 0 10 10
  endloop
endfacet
facet normal -1 0 0
  outer loop
    vertex 0 0 0
    vertex 0 10 0
    vertex 0 10 10
  endloop
endfacet
facet normal -1 0 0
  outer loop
    vertex 0 0 0
    vertex 0 10 10
    vertex 0 0 10
  endloop
endfacet
facet normal 1 0 0
  outer loop
    vertex 10 0 0
    vertex 10 0 10
    vertex 10 10 10
  endloop
endfacet
facet normal 1 0 0
  outer loop
    vertex 10 0 0
    vertex 10 10 10
    vertex 10 10 0
  endloop
endfacet
endsolid cube`;

// ---------------------------------------------------------------------------
// PrusaSlicer config for profiling
// ---------------------------------------------------------------------------
const SLICER_CONFIG = {
  layer_height: '0.2',
  first_layer_height: '0.2',
  extrusion_width: '0.45',
  perimeters: '3',
  top_solid_layers: '5',
  bottom_solid_layers: '4',
  fill_density: '20%',
  fill_pattern: 'gyroid',
  fill_angle: '45',
  infill_overlap: '25%',
  travel_speed: '150',
  first_layer_speed: '30',
  external_perimeter_speed: '25',
  perimeter_speed: '45',
  infill_speed: '80',
  solid_infill_speed: '80',
  top_solid_infill_speed: '40',
  support_material: '0',
  skirts: '1',
  brim_width: '0',
  raft_layers: '0',
  retract_length: '0.8',
  retract_speed: '35',
  retract_lift: '0.2',
  temperature: '210',
  bed_temperature: '60',
  first_layer_temperature: '215',
  first_layer_bed_temperature: '65',
  max_fan_speed: '100',
  min_fan_speed: '100',
  disable_fan_first_layers: '1',
  nozzle_diameter: '0.4',
  filament_diameter: '1.75',
  bed_shape: '0x0,250x0,250x210,0x210',
  max_print_height: '250',
  start_gcode: 'G28\\nG1 Z5 F3000',
  end_gcode: 'M104 S0\\nM140 S0\\nG28 X Y',
  gcode_flavor: 'marlin',
};

// ---------------------------------------------------------------------------
// HTML page that loads the WASM module and exposes profiling functions
// ---------------------------------------------------------------------------
function makeProfilingPage() {
  return `<!DOCTYPE html>
<html>
<head><title>Slicer Profiling</title></head>
<body>
<script>
// Load the Emscripten glue and expose profiling API on window

let slicerModule = null;

window.profileLoadModule = async function() {
  const script = document.createElement('script');
  script.src = '/wasm/libslic3r.js';
  document.head.appendChild(script);
  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = reject;
  });

  const createModule = window.createSlicerModule;
  if (!createModule) throw new Error('createSlicerModule not found on window');

  const t0 = performance.now();
  slicerModule = await createModule({
    locateFile(path) {
      if (path.endsWith('.wasm')) return '/wasm/libslic3r.wasm';
      if (path.endsWith('.worker.js')) return '/wasm/libslic3r.worker.js';
      return path;
    },
    mainScriptUrlOrBlob: '/wasm/libslic3r.js',
  });
  const t1 = performance.now();

  // Ensure /tmp exists
  try { slicerModule.FS.mkdir('/tmp'); } catch(e) {}

  return { moduleLoadMs: t1 - t0 };
};

window.profileSlice = async function(stlText, config) {
  if (!slicerModule) throw new Error('Module not loaded');

  const slicer = new slicerModule.WasmSlicer();
  const results = {};

  try {
    // Generate binary STL from ASCII text for a 10mm cube
    // PrusaSlicer's load_stl may work better with binary
    const stlBytes = window.generateBinarySTLCube(10);
    const stlPath = '/tmp/profile_model.stl';
    slicerModule.FS.writeFile(stlPath, stlBytes);

    // loadSTLFile
    let t0 = performance.now();
    slicer.loadSTLFile(stlPath);
    results.loadSTLMs = performance.now() - t0;

    // cleanup temp file
    try { slicerModule.FS.unlink(stlPath); } catch(e) {}

    // setConfig
    t0 = performance.now();
    for (const [key, value] of Object.entries(config)) {
      slicer.setConfigString(key, value);
    }
    results.setConfigMs = performance.now() - t0;

    // slice
    t0 = performance.now();
    slicer.slice();
    results.sliceMs = performance.now() - t0;

    // exportGCode
    t0 = performance.now();
    const gcode = slicer.exportGCode();
    results.exportGCodeMs = performance.now() - t0;
    results.gcodeLength = gcode.length;
    results.gcodeLines = gcode.split('\\n').length;

  } finally {
    slicer.delete();
  }

  return results;
};

window.profileSliceBinary = async function(stlArrayBuffer, config) {
  if (!slicerModule) throw new Error('Module not loaded');

  const slicer = new slicerModule.WasmSlicer();
  const results = {};

  try {
    const stlPath = '/tmp/profile_model_bin.stl';
    slicerModule.FS.writeFile(stlPath, new Uint8Array(stlArrayBuffer));

    let t0 = performance.now();
    slicer.loadSTLFile(stlPath);
    results.loadSTLMs = performance.now() - t0;

    try { slicerModule.FS.unlink(stlPath); } catch(e) {}

    t0 = performance.now();
    for (const [key, value] of Object.entries(config)) {
      slicer.setConfigString(key, value);
    }
    results.setConfigMs = performance.now() - t0;

    t0 = performance.now();
    slicer.slice();
    results.sliceMs = performance.now() - t0;

    t0 = performance.now();
    const gcode = slicer.exportGCode();
    results.exportGCodeMs = performance.now() - t0;
    results.gcodeLength = gcode.length;
    results.gcodeLines = gcode.split('\\n').length;

  } finally {
    slicer.delete();
  }

  return results;
};

// Generate a binary STL cube of the given size, centered on the bed
window.generateBinarySTLCube = function(size) {
  const s = size;
  // Center the cube on a 250x210 bed at Z=0
  const cx = 125 - s/2;
  const cy = 105 - s/2;
  // 12 triangles for a cube
  const faces = [
    // Bottom (Z=0)
    [[cx,cy,0],[cx+s,cy,0],[cx+s,cy+s,0],[0,0,-1]],
    [[cx,cy,0],[cx+s,cy+s,0],[cx,cy+s,0],[0,0,-1]],
    // Top (Z=s)
    [[cx,cy,s],[cx+s,cy+s,s],[cx+s,cy,s],[0,0,1]],
    [[cx,cy,s],[cx,cy+s,s],[cx+s,cy+s,s],[0,0,1]],
    // Front (Y=cy)
    [[cx,cy,0],[cx+s,cy,s],[cx+s,cy,0],[0,-1,0]],
    [[cx,cy,0],[cx,cy,s],[cx+s,cy,s],[0,-1,0]],
    // Back (Y=cy+s)
    [[cx,cy+s,0],[cx+s,cy+s,0],[cx+s,cy+s,s],[0,1,0]],
    [[cx,cy+s,0],[cx+s,cy+s,s],[cx,cy+s,s],[0,1,0]],
    // Left (X=cx)
    [[cx,cy,0],[cx,cy+s,0],[cx,cy+s,s],[-1,0,0]],
    [[cx,cy,0],[cx,cy+s,s],[cx,cy,s],[-1,0,0]],
    // Right (X=cx+s)
    [[cx+s,cy,0],[cx+s,cy,s],[cx+s,cy+s,s],[1,0,0]],
    [[cx+s,cy,0],[cx+s,cy+s,s],[cx+s,cy+s,0],[1,0,0]],
  ];
  const numFaces = faces.length;
  const buf = new ArrayBuffer(84 + numFaces * 50);
  const view = new DataView(buf);
  // 80-byte header
  const header = 'Binary STL - 10mm cube';
  for (let i = 0; i < 80; i++) view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  view.setUint32(80, numFaces, true);
  let offset = 84;
  for (const [v1, v2, v3, n] of faces) {
    // Normal
    view.setFloat32(offset, n[0], true); offset += 4;
    view.setFloat32(offset, n[1], true); offset += 4;
    view.setFloat32(offset, n[2], true); offset += 4;
    // Vertices
    for (const v of [v1, v2, v3]) {
      view.setFloat32(offset, v[0], true); offset += 4;
      view.setFloat32(offset, v[1], true); offset += 4;
      view.setFloat32(offset, v[2], true); offset += 4;
    }
    view.setUint16(offset, 0, true); offset += 2;
  }
  return new Uint8Array(buf);
};

// Check COOP/COEP
window.checkIsolation = function() {
  return {
    crossOriginIsolated: self.crossOriginIsolated,
    sab: typeof SharedArrayBuffer !== 'undefined',
  };
};
</script>
<p>Slicer profiling page. Use Playwright to drive tests.</p>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== libslic3r WASM Performance Profiling ===\n');

  // Start Vite dev server with COOP/COEP headers
  console.log('Starting Vite dev server with COOP/COEP headers...');
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    base: '/',
    server: {
      port: 0, // random port
      strictPort: false,
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    plugins: [
      {
        name: 'profiling-page',
        configureServer(srv) {
          srv.middlewares.use('/profile.html', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
            res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
            res.end(makeProfilingPage());
          });
        },
      },
    ],
    logLevel: 'warn',
  });

  await server.listen();
  const addr = server.httpServer?.address();
  const port = typeof addr === 'object' ? addr?.port : 0;
  const baseUrl = `http://localhost:${port}`;
  console.log(`Vite dev server running at ${baseUrl}`);

  // Launch Chrome
  console.log('Launching Chrome (system)...');
  const browser = await chromium.launch({
    executablePath: '/run/current-system/sw/bin/google-chrome-stable',
    headless: true,
    args: [
      '--enable-features=SharedArrayBuffer',
    ],
  });

  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(120000); // 2 min for WASM operations

  // Capture console messages
  page.on('console', msg => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      console.log(`  [browser ${type}] ${msg.text()}`);
    }
  });

  try {
    // Navigate to profiling page
    await page.goto(`${baseUrl}/profile.html`, { waitUntil: 'load' });

    // Check COOP/COEP
    const isolation = await page.evaluate(() => window.checkIsolation());
    console.log(`\nCOOP/COEP status: crossOriginIsolated=${isolation.crossOriginIsolated}, SharedArrayBuffer=${isolation.sab}`);

    if (!isolation.crossOriginIsolated) {
      console.error('WARNING: Cross-origin isolation not active. Pthreads may not work.');
    }

    // -----------------------------------------------------------------------
    // Module Load
    // -----------------------------------------------------------------------
    console.log('\n--- Module Load ---');
    const moduleResults = [];
    for (let i = 0; i < 3; i++) {
      // Need to reload page each time to get fresh module load
      if (i > 0) {
        await page.reload({ waitUntil: 'load' });
      }
      const result = await page.evaluate(() => window.profileLoadModule(), { timeout: 60000 });
      console.log(`  Run ${i + 1}: ${result.moduleLoadMs.toFixed(1)}ms`);
      moduleResults.push(result.moduleLoadMs);
    }
    const medianModule = median(moduleResults);
    console.log(`  Median: ${medianModule.toFixed(1)}ms`);

    // Ensure module is loaded for subsequent tests
    await page.evaluate(() => window.profileLoadModule());

    // -----------------------------------------------------------------------
    // Full pipeline: loadSTL + setConfig + slice + exportGCode
    // -----------------------------------------------------------------------
    console.log('\n--- Full Slicing Pipeline (10mm cube) ---');
    const loadResults = [];
    for (let i = 0; i < 3; i++) {
      const result = await page.evaluate(({ config }) => {
        const slicer = new slicerModule.WasmSlicer();
        const results = {};
        try {
          // Binary STL cube (12 faces)
          const stlBytes = window.generateBinarySTLCube(10);
          slicerModule.FS.writeFile('/tmp/profile_cube.stl', stlBytes);
          results.stlSize = stlBytes.length;

          let t0 = performance.now();
          slicer.loadSTLFile('/tmp/profile_cube.stl');
          results.loadSTLMs = performance.now() - t0;

          try { slicerModule.FS.unlink('/tmp/profile_cube.stl'); } catch(e) {}

          t0 = performance.now();
          for (const [key, value] of Object.entries(config)) {
            slicer.setConfigString(key, value);
          }
          results.setConfigMs = performance.now() - t0;
          results.configKeys = Object.keys(config).length;

          // Slice
          t0 = performance.now();
          slicer.slice();
          results.sliceMs = performance.now() - t0;
          results.sliceOk = true;

          // Export GCode
          t0 = performance.now();
          const gcode = slicer.exportGCode();
          results.exportGCodeMs = performance.now() - t0;
          results.gcodeLength = gcode.length;
          results.gcodeLines = gcode.split('\\n').length;

        } catch (e) {
          results.sliceOk = false;
          if (typeof e === 'number' && slicerModule.getExceptionMessage) {
            const [t, m] = slicerModule.getExceptionMessage(e);
            results.sliceError = `${t}: ${m}`;
          } else {
            results.sliceError = String(e);
          }
        } finally {
          slicer.delete();
        }
        return results;
      }, { config: SLICER_CONFIG });
      if (result.sliceOk) {
        console.log(`  Run ${i + 1}: loadSTL=${result.loadSTLMs.toFixed(2)}ms, setConfig(${result.configKeys} keys)=${result.setConfigMs.toFixed(2)}ms, slice=${result.sliceMs.toFixed(1)}ms, exportGCode=${result.exportGCodeMs.toFixed(1)}ms (${result.gcodeLines} lines, ${(result.gcodeLength / 1024).toFixed(1)}KB)`);
      } else {
        console.log(`  Run ${i + 1}: loadSTL=${result.loadSTLMs.toFixed(2)}ms, setConfig(${result.configKeys} keys)=${result.setConfigMs.toFixed(2)}ms, slice FAILED: ${result.sliceError}`);
      }
      loadResults.push(result);
    }

    // Binary STL sphere (~760 faces)
    console.log('\n--- Complex Model Load (sphere, ~760 triangles) ---');
    const sphereLoadResults = [];
    for (let i = 0; i < 3; i++) {
      const result = await page.evaluate(() => {
        function generateSphereSTL(radius, latSteps, lonSteps) {
          const faces = [];
          for (let lat = 0; lat < latSteps; lat++) {
            const theta1 = (lat / latSteps) * Math.PI;
            const theta2 = ((lat + 1) / latSteps) * Math.PI;
            for (let lon = 0; lon < lonSteps; lon++) {
              const phi1 = (lon / lonSteps) * 2 * Math.PI;
              const phi2 = ((lon + 1) / lonSteps) * 2 * Math.PI;
              const p1 = [radius * Math.sin(theta1) * Math.cos(phi1), radius * Math.sin(theta1) * Math.sin(phi1), radius * Math.cos(theta1)];
              const p2 = [radius * Math.sin(theta2) * Math.cos(phi1), radius * Math.sin(theta2) * Math.sin(phi1), radius * Math.cos(theta2)];
              const p3 = [radius * Math.sin(theta2) * Math.cos(phi2), radius * Math.sin(theta2) * Math.sin(phi2), radius * Math.cos(theta2)];
              const p4 = [radius * Math.sin(theta1) * Math.cos(phi2), radius * Math.sin(theta1) * Math.sin(phi2), radius * Math.cos(theta1)];
              if (lat > 0) faces.push([p1, p2, p3]);
              if (lat < latSteps - 1) faces.push([p1, p3, p4]);
            }
          }
          const numFaces = faces.length;
          const buf = new ArrayBuffer(84 + numFaces * 50);
          const view = new DataView(buf);
          for (let j = 0; j < 80; j++) view.setUint8(j, 0);
          view.setUint32(80, numFaces, true);
          let offset = 84;
          for (const face of faces) {
            view.setFloat32(offset, 0, true); offset += 4;
            view.setFloat32(offset, 0, true); offset += 4;
            view.setFloat32(offset, 0, true); offset += 4;
            for (const v of face) {
              view.setFloat32(offset, v[0], true); offset += 4;
              view.setFloat32(offset, v[1], true); offset += 4;
              view.setFloat32(offset, v[2], true); offset += 4;
            }
            view.setUint16(offset, 0, true); offset += 2;
          }
          return new Uint8Array(buf);
        }
        const stlBytes = generateSphereSTL(10, 20, 20);
        slicerModule.FS.writeFile('/tmp/profile_sphere.stl', stlBytes);
        const slicer = new slicerModule.WasmSlicer();
        const t0 = performance.now();
        slicer.loadSTLFile('/tmp/profile_sphere.stl');
        const loadMs = performance.now() - t0;
        slicer.delete();
        try { slicerModule.FS.unlink('/tmp/profile_sphere.stl'); } catch(e) {}
        return { loadSTLMs: loadMs, stlSize: stlBytes.length, faces: stlBytes.length > 84 ? new DataView(stlBytes.buffer).getUint32(80, true) : 0 };
      });
      console.log(`  Run ${i + 1}: loadSTL=${result.loadSTLMs.toFixed(2)}ms (${result.faces} faces, ${(result.stlSize / 1024).toFixed(1)}KB)`);
      sphereLoadResults.push(result);
    }

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    console.log('\n========================================');
    console.log('=== SUMMARY ===');
    console.log('========================================');
    console.log(`WASM binary: libslic3r.wasm ${(8782310 / 1024 / 1024).toFixed(1)} MB, libslic3r.js ${(147307 / 1024).toFixed(0)} KB`);
    console.log(`COOP/COEP: ${isolation.crossOriginIsolated ? 'active' : 'INACTIVE'}, SharedArrayBuffer: ${isolation.sab ? 'available' : 'UNAVAILABLE'}`);
    console.log(`Module load (median of 3): ${medianModule.toFixed(0)}ms`);

    if (loadResults.length > 0) {
      const medLoad = median(loadResults.map(r => r.loadSTLMs));
      const medConfig = median(loadResults.map(r => r.setConfigMs));
      console.log(`10mm cube loadSTL (median): ${medLoad.toFixed(1)}ms`);
      console.log(`setConfig ${loadResults[0].configKeys} keys (median): ${medConfig.toFixed(1)}ms`);

      const successResults = loadResults.filter(r => r.sliceOk);
      if (successResults.length > 0) {
        const medSlice = median(successResults.map(r => r.sliceMs));
        const medExport = median(successResults.map(r => r.exportGCodeMs));
        const lastSuccess = successResults[successResults.length - 1];
        console.log(`10mm cube slice (median): ${medSlice.toFixed(1)}ms`);
        console.log(`10mm cube exportGCode (median): ${medExport.toFixed(1)}ms`);
        console.log(`GCode output: ${lastSuccess.gcodeLines} lines, ${(lastSuccess.gcodeLength / 1024).toFixed(1)}KB`);
        console.log(`Total pipeline (median): ${(medLoad + medConfig + medSlice + medExport).toFixed(1)}ms`);
      } else {
        console.log('*** slice() FAILED — see errors above ***');
      }
    }

    if (sphereLoadResults.length > 0) {
      const medSphereLoad = median(sphereLoadResults.map(r => r.loadSTLMs));
      console.log(`Sphere (~760 faces) loadSTL (median): ${medSphereLoad.toFixed(1)}ms`);
    }

    console.log('========================================');

  } finally {
    await browser.close();
    await server.close();
  }
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function medianResult(results) {
  return {
    loadSTLMs: median(results.map(r => r.loadSTLMs)),
    setConfigMs: median(results.map(r => r.setConfigMs)),
    sliceMs: median(results.map(r => r.sliceMs)),
    exportGCodeMs: median(results.map(r => r.exportGCodeMs)),
  };
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
