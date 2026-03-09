/**
 * Moonraker REST API client for fetching printer configuration.
 *
 * Endpoints used:
 * - GET /printer/objects/query?configfile — parsed printer.cfg (bed size, stepper limits, extruder config)
 * - GET /printer/objects/query?toolhead — live motion limits
 * - GET /server/files/config/printer.cfg — raw config file text
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PrinterConfig {
  bedWidth: number;
  bedDepth: number;
  bedCircular: boolean;
  maxHeight: number;
  originCenter: boolean;
  maxVelocity: number;
  maxAccel: number;
  squareCornerVelocity: number;
  nozzleDiameter: number;
  filamentDiameter: number;
  maxExtrudeOnlyVelocity: number;
  extruderCount: number;
  startGcode: string;
  endGcode: string;
}

interface MoonrakerConfigfileResponse {
  result: {
    status: {
      configfile: {
        config: Record<string, Record<string, string>>;
      };
    };
  };
}

interface MoonrakerToolheadResponse {
  result: {
    status: {
      toolhead: {
        max_velocity: number;
        max_accel: number;
        square_corner_velocity: number;
      };
    };
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a full URL from a printer address (may or may not include protocol). */
export function buildMoonrakerUrl(address: string, path: string): string {
  const base = /^https?:\/\//.test(address)
    ? address.replace(/\/+$/, '')
    : `http://${address}`;
  return `${base}${path}`;
}

/** Check whether the request would be blocked by mixed-content rules. */
function checkMixedContent(url: string): void {
  const nativeBridge = (window as any).AndroidPrinterDiscovery;
  const cleartextAllowed =
    typeof nativeBridge?.allowsCleartextTraffic === 'function' &&
    nativeBridge.allowsCleartextTraffic();
  if (
    !cleartextAllowed &&
    window.location.protocol === 'https:' &&
    url.startsWith('http://')
  ) {
    throw new Error(
      'Mixed content blocked: cannot reach an HTTP printer from an HTTPS page. ' +
        'Either access this app over HTTP, or put Moonraker behind an HTTPS reverse proxy.',
    );
  }
}

async function moonrakerGet<T>(address: string, path: string): Promise<T> {
  const url = buildMoonrakerUrl(address, path);
  checkMixedContent(url);
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Moonraker ${path} failed (${res.status}): ${text || res.statusText}`);
  }
  return res.json();
}

async function moonrakerPost<T>(address: string, path: string, body?: unknown): Promise<T> {
  const url = buildMoonrakerUrl(address, path);
  checkMixedContent(url);
  const res = await fetch(url, {
    method: 'POST',
    mode: 'cors',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Moonraker ${path} failed (${res.status}): ${text || res.statusText}`);
  }
  return res.json();
}

// ─── API ─────────────────────────────────────────────────────────────────────

/** Fetch parsed printer.cfg sections via the configfile object. */
export async function fetchConfigfile(address: string): Promise<Record<string, Record<string, string>>> {
  const data = await moonrakerGet<MoonrakerConfigfileResponse>(
    address,
    '/printer/objects/query?configfile',
  );
  return data.result.status.configfile.config;
}

/** Fetch live toolhead limits. */
export async function fetchToolhead(address: string) {
  const data = await moonrakerGet<MoonrakerToolheadResponse>(
    address,
    '/printer/objects/query?toolhead',
  );
  return data.result.status.toolhead;
}

/** Fetch the raw printer.cfg text. */
export async function fetchRawPrinterCfg(address: string): Promise<string> {
  const url = buildMoonrakerUrl(address, '/server/files/config/printer.cfg');
  checkMixedContent(url);
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Moonraker printer.cfg fetch failed (${res.status}): ${text || res.statusText}`);
  }
  return res.text();
}

/** Start printing a file that has already been uploaded. */
export async function startPrint(address: string, fileName: string): Promise<void> {
  await moonrakerPost(address, `/printer/print/start?filename=${encodeURIComponent(fileName)}`);
}

// ─── Composite fetcher ──────────────────────────────────────────────────────

/**
 * Fetch all printer configuration data from Moonraker and return a unified PrinterConfig.
 * Fetches configfile + toolhead in parallel, then parses raw printer.cfg for start/end gcode.
 */
export async function fetchPrinterConfig(address: string): Promise<PrinterConfig> {
  const [config, toolhead, rawCfg] = await Promise.all([
    fetchConfigfile(address),
    fetchToolhead(address),
    fetchRawPrinterCfg(address).catch(() => ''),
  ]);

  // Parse bed dimensions from stepper_x / stepper_y position_min/max
  const stepperX = config['stepper_x'] ?? {};
  const stepperY = config['stepper_y'] ?? {};
  const stepperZ = config['stepper_z'] ?? {};
  const xMin = parseFloat(stepperX['position_min'] ?? '0');
  const xMax = parseFloat(stepperX['position_max'] ?? '235');
  const yMin = parseFloat(stepperY['position_min'] ?? '0');
  const yMax = parseFloat(stepperY['position_max'] ?? '235');
  const bedWidth = xMax - xMin;
  const bedDepth = yMax - yMin;
  const maxHeight = parseFloat(stepperZ['position_max'] ?? '300');

  // Detect center origin: if position_min is significantly negative, origin is at bed center
  const originCenter = xMin < -1 && yMin < -1;

  // Detect circular bed (delta kinematics)
  const printerSection = config['printer'] ?? {};
  const kinematics = printerSection['kinematics'] ?? '';
  const bedCircular = kinematics === 'delta';

  // Extruder config
  const extruderSection = config['extruder'] ?? {};
  const nozzleDiameter = parseFloat(extruderSection['nozzle_diameter'] ?? '0.4');
  const filamentDiameter = parseFloat(extruderSection['filament_diameter'] ?? '1.75');
  const maxExtrudeOnlyVelocity = parseFloat(extruderSection['max_extrude_only_velocity'] ?? '50');

  // Count extruders (extruder, extruder1, extruder2, ...)
  let extruderCount = 0;
  for (const key of Object.keys(config)) {
    if (key === 'extruder' || /^extruder\d+$/.test(key)) {
      extruderCount++;
    }
  }
  extruderCount = Math.max(extruderCount, 1);

  // Parse start/end gcode from raw printer.cfg
  const startGcode = extractGcodeBlock(rawCfg, 'START_PRINT') || extractGcodeSection(rawCfg, 'start_gcode');
  const endGcode = extractGcodeBlock(rawCfg, 'END_PRINT') || extractGcodeSection(rawCfg, 'end_gcode');

  return {
    bedWidth,
    bedDepth,
    bedCircular,
    maxHeight,
    originCenter,
    maxVelocity: toolhead.max_velocity,
    maxAccel: toolhead.max_accel,
    squareCornerVelocity: toolhead.square_corner_velocity,
    nozzleDiameter,
    filamentDiameter,
    maxExtrudeOnlyVelocity,
    extruderCount,
    startGcode,
    endGcode,
  };
}

// ─── Config parsing helpers ─────────────────────────────────────────────────

/**
 * Extract a gcode_macro block (e.g. [gcode_macro START_PRINT]) from raw printer.cfg.
 * Returns the gcode content or empty string if not found.
 */
function extractGcodeBlock(rawCfg: string, macroName: string): string {
  const pattern = new RegExp(
    `\\[gcode_macro\\s+${macroName}\\]\\s*\\n([\\s\\S]*?)(?=\\n\\[|$)`,
    'i',
  );
  const match = rawCfg.match(pattern);
  if (!match) return '';

  // Find the gcode: line within the macro block
  const block = match[1];
  const gcodeMatch = block.match(/^gcode\s*:\s*([\s\S]*?)(?=\n\S|\n*$)/m);
  if (!gcodeMatch) return '';

  // The gcode value is the first line after "gcode:" plus all continuation lines (indented)
  const lines = gcodeMatch[1].split('\n');
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimEnd();
    // Continuation lines are indented (start with whitespace)
    if (result.length === 0 || /^\s/.test(line)) {
      result.push(trimmed.replace(/^\s+/, ''));
    } else {
      break;
    }
  }
  return result.filter((l) => l.length > 0).join('\n');
}

/**
 * Extract a plain gcode section (e.g. start_gcode:) from the [extruder] or [printer] section.
 * Klipper configs sometimes inline start/end gcode directly rather than using macros.
 */
function extractGcodeSection(rawCfg: string, sectionName: string): string {
  const pattern = new RegExp(`^${sectionName}\\s*:\\s*(.*)$`, 'im');
  const match = rawCfg.match(pattern);
  if (!match) return '';

  const startIdx = rawCfg.indexOf(match[0]) + match[0].length;
  const rest = rawCfg.slice(startIdx);
  const lines = rest.split('\n');
  const result: string[] = [];

  // First line (after the colon) if non-empty
  const firstLine = match[1].trim();
  if (firstLine) result.push(firstLine);

  // Continuation lines (indented)
  for (const line of lines) {
    if (/^\s+/.test(line) && line.trim().length > 0) {
      result.push(line.trim());
    } else if (line.trim().length === 0) {
      // Blank lines within indented blocks are OK in Klipper configs
      continue;
    } else {
      break;
    }
  }
  return result.join('\n');
}
