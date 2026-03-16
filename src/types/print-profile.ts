// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * PrintProfile — printer & filament agnostic print settings.
 *
 * These describe "how to print" (quality, walls, infill, support, adhesion,
 * travel/first-layer speed, z-hop) and are saved per printer address.
 * They do NOT change when you switch filament or printer.
 */

export interface PrintProfile {
  // Quality
  layerHeight: number;
  firstLayerHeight: number;
  lineWidth: number;
  // Walls
  shellCount: number;
  topLayers: number;
  bottomLayers: number;
  shellOrder: 'in-out' | 'out-in';
  // Infill
  infillDensity: number; // 0-1
  infillPattern: string;
  infillAngle: number; // degrees
  infillOverlap: number; // 0-1
  // Speed (strategy, not material-dependent)
  travelSpeed: number;
  firstLayerSpeed: number;
  outerWallSpeed: number; // mm/s, 0 = same as print speed
  firstLayerFillSpeed: number; // mm/s
  // Support
  supportEnabled: boolean;
  supportAngle: number;
  supportDensity: number;
  supportXYOffset: number; // mm
  supportZGap: number; // gap layers
  // Adhesion
  adhesionType: 'none' | 'skirt' | 'brim' | 'raft';
  skirtCount: number;
  brimWidth: number;
  // Retraction extras
  coastDist: number; // mm
  wipeDistance: number; // mm
  retractOnLayerChange: boolean;
  // Z-hop (geometry choice, not filament)
  zHopHeight: number;
  // Arc fitting
  arcEnabled: boolean;
  // Top single-wall: reduce to 1 shell for the topmost N layers
  topSingleWallLayers: number;
}

export const DEFAULT_PRINT_PROFILE: PrintProfile = {
  layerHeight: 0.2,
  firstLayerHeight: 0.3,
  lineWidth: 0.4,
  shellCount: 3,
  topLayers: 4,
  bottomLayers: 4,
  shellOrder: 'in-out',
  infillDensity: 0.2,
  infillPattern: 'gyroid',
  infillAngle: 45,
  infillOverlap: 0.5,
  travelSpeed: 150,
  firstLayerSpeed: 25,
  outerWallSpeed: 0,
  firstLayerFillSpeed: 80,
  supportEnabled: false,
  supportAngle: 45,
  supportDensity: 0.2,
  supportXYOffset: 0.3,
  supportZGap: 1,
  adhesionType: 'skirt',
  skirtCount: 3,
  brimWidth: 8,
  coastDist: 0,
  wipeDistance: 2,
  retractOnLayerChange: true,
  zHopHeight: 0,
  arcEnabled: false,
  topSingleWallLayers: 0,
};
