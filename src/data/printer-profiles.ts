/**
 * Printer profiles — predefined printer models with nozzle variants,
 * machine kinematics, bed geometry, and per-filament defaults.
 *
 * Values sourced from manufacturer specifications and community-tuned profiles.
 */

export interface NozzleProfile {
  diameter: number; // mm
  minLayerHeight: number;
  maxLayerHeight: number;
  retractDist: number; // mm
  retractSpeed: number; // mm/s
  deretractSpeed: number; // mm/s
}

export interface FilamentDefaults {
  nozzleTemp: number;
  bedTemp: number;
  fanSpeed: number; // 0-100
  printSpeed: number; // mm/s
  retractDist?: number; // override nozzle default if set
  retractSpeed?: number;
  firstLayerNozzleTemp?: number; // °C, defaults to nozzleTemp
  firstLayerBedTemp?: number; // °C, defaults to bedTemp
  minSpeed?: number; // mm/s for cooling slowdown
  minLayerTime?: number; // seconds
  notes: string;
}

export interface PrintDefaults {
  layerHeight: number;
  firstLayerHeight: number;
  lineWidth: number;
  shellCount: number;
  topLayers: number;
  bottomLayers: number;
  shellOrder: 'in-out' | 'out-in';
  infillDensity: number;
  infillAngle: number;
  infillOverlap: number;
  travelSpeed: number;
  firstLayerSpeed: number;
  outerWallSpeed: number;
  firstLayerFillSpeed: number;
  zHopHeight: number;
  supportAngle: number;
  supportXYOffset: number;
  supportZGap: number;
  coastDist: number;
  wipeDistance: number;
  retractOnLayerChange: boolean;
  arcEnabled: boolean;
}

export interface PrinterProfile {
  id: string;
  name: string;
  /** Bed dimensions */
  bedWidth: number;
  bedDepth: number;
  maxHeight: number;
  originCenter: boolean;
  /** Available nozzle sizes */
  nozzles: NozzleProfile[];
  defaultNozzle: number; // diameter of default nozzle
  /** Machine kinematics */
  maxVelocityXY: number; // mm/s
  maxVelocityZ: number;
  maxAccelXY: number; // mm/s²
  maxAccelZ: number;
  maxJerkXY: number;
  maxJerkZ: number;
  /** GCode flavor */
  gcodeFlaver: 'klipper' | 'marlin';
  /** Start/end gcode templates */
  startGcode: string;
  endGcode: string;
  /** Default print settings */
  printDefaults: PrintDefaults;
  /** Per-filament-type defaults (keyed by filament type: pla, petg, etc.) */
  filamentDefaults: Record<string, FilamentDefaults>;
}

// ---------------------------------------------------------------------------
// FlashForge Adventurer 5M
// ---------------------------------------------------------------------------

const ADV5M_START_GCODE = `START_PRINT BED_TEMP={bed_temp} EXTRUDER_TEMP={temp}`;

const ADV5M_END_GCODE = `END_PRINT`;

export const FLASHFORGE_ADV5M: PrinterProfile = {
  id: 'flashforge-adv5m',
  name: 'FlashForge Adventurer 5M',
  bedWidth: 220,
  bedDepth: 220,
  maxHeight: 220,
  originCenter: true,
  nozzles: [
    {
      diameter: 0.25,
      minLayerHeight: 0.06,
      maxLayerHeight: 0.15,
      retractDist: 0.6,
      retractSpeed: 35,
      deretractSpeed: 35,
    },
    {
      diameter: 0.4,
      minLayerHeight: 0.08,
      maxLayerHeight: 0.28,
      retractDist: 0.8,
      retractSpeed: 35,
      deretractSpeed: 35,
    },
    {
      diameter: 0.6,
      minLayerHeight: 0.1,
      maxLayerHeight: 0.42,
      retractDist: 1.0,
      retractSpeed: 35,
      deretractSpeed: 35,
    },
    {
      diameter: 0.8,
      minLayerHeight: 0.15,
      maxLayerHeight: 0.56,
      retractDist: 1.2,
      retractSpeed: 35,
      deretractSpeed: 35,
    },
  ],
  defaultNozzle: 0.4,
  maxVelocityXY: 600,
  maxVelocityZ: 20,
  maxAccelXY: 20000,
  maxAccelZ: 500,
  maxJerkXY: 9,
  maxJerkZ: 3,
  gcodeFlaver: 'klipper',
  startGcode: ADV5M_START_GCODE,
  endGcode: ADV5M_END_GCODE,
  printDefaults: {
    layerHeight: 0.2,
    firstLayerHeight: 0.2,
    lineWidth: 0.42,
    shellCount: 2,
    topLayers: 5,
    bottomLayers: 3,
    shellOrder: 'in-out',
    infillDensity: 0.15,
    infillAngle: 45,
    infillOverlap: 0.5,
    travelSpeed: 500,
    firstLayerSpeed: 50,
    outerWallSpeed: 200,
    firstLayerFillSpeed: 80,
    zHopHeight: 0.4,
    supportAngle: 30,
    supportXYOffset: 0.3,
    supportZGap: 1,
    coastDist: 0,
    wipeDistance: 2,
    retractOnLayerChange: true,
    arcEnabled: false,
  },
  filamentDefaults: {
    pla: {
      nozzleTemp: 220,
      bedTemp: 55,
      fanSpeed: 100,
      printSpeed: 250,
      firstLayerNozzleTemp: 220,
      firstLayerBedTemp: 55,
      minSpeed: 20,
      minLayerTime: 6,
      notes: 'High-speed PLA — outer 200, inner 300, infill 270',
    },
    petg: {
      nozzleTemp: 255,
      bedTemp: 70,
      fanSpeed: 80,
      printSpeed: 250,
      firstLayerNozzleTemp: 255,
      firstLayerBedTemp: 70,
      minSpeed: 30,
      minLayerTime: 8,
      notes: 'High-speed PETG — reduced fan to prevent delamination',
    },
    tpu: {
      nozzleTemp: 225,
      bedTemp: 45,
      fanSpeed: 100,
      printSpeed: 80,
      retractDist: 1.2,
      firstLayerNozzleTemp: 225,
      firstLayerBedTemp: 45,
      minSpeed: 20,
      minLayerTime: 8,
      notes: 'Direct drive, minimal retraction — flexible material',
    },
    asa: {
      nozzleTemp: 260,
      bedTemp: 105,
      fanSpeed: 20,
      printSpeed: 250,
      firstLayerNozzleTemp: 260,
      firstLayerBedTemp: 105,
      minSpeed: 20,
      minLayerTime: 5,
      notes: 'Low fan, enclosed recommended',
    },
    abs: {
      nozzleTemp: 260,
      bedTemp: 105,
      fanSpeed: 20,
      printSpeed: 250,
      firstLayerNozzleTemp: 260,
      firstLayerBedTemp: 105,
      minSpeed: 20,
      minLayerTime: 8,
      notes: 'Low fan, enclosed recommended',
    },
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** All available printer profiles */
export const PRINTER_PROFILES: PrinterProfile[] = [
  FLASHFORGE_ADV5M,
];

/** Look up a printer profile by ID, returns undefined if not found */
export function getPrinterProfile(id: string): PrinterProfile | undefined {
  return PRINTER_PROFILES.find((p) => p.id === id);
}

/** Look up a nozzle profile within a printer profile */
export function getNozzleProfile(
  profile: PrinterProfile,
  diameter: number,
): NozzleProfile | undefined {
  return profile.nozzles.find((n) => n.diameter === diameter);
}

/** Get filament defaults for a given printer profile and filament type */
export function getFilamentDefaults(
  profile: PrinterProfile,
  filamentType: string,
): FilamentDefaults | undefined {
  return profile.filamentDefaults[filamentType.toLowerCase()];
}
