// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * PrintProfile — printer & filament agnostic print settings.
 *
 * These describe "how to print" (quality, walls, infill, speed, support,
 * adhesion, retraction, cooling overrides, advanced features) and are
 * saved per printer address. They do NOT change when you switch filament
 * or printer.
 *
 * Field names follow OrcaSlicer config key naming where possible.
 * The mapping to actual OrcaSlicer .ini keys is done in orca-slicer-settings.ts.
 */

// ============================================================
// Enum types for OrcaSlicer options
// ============================================================

export type SeamPosition = 'nearest' | 'aligned' | 'aligned_back' | 'back' | 'random';

export type SeamScarfType = 'none' | 'external' | 'all';

export type WallSequence = 'inner_outer' | 'outer_inner' | 'inner_outer_inner';

export type WallGenerator = 'classic' | 'arachne';

export type InfillPattern =
  | 'monotonic' | 'monotonicline' | 'rectilinear' | 'alignedrectilinear'
  | 'zigzag' | 'crosszag' | 'lockedzag'
  | 'line' | 'grid' | 'triangles' | 'tri-hexagon' | 'cubic'
  | 'adaptivecubic' | 'quartercubic' | 'supportcubic' | 'lightning'
  | 'honeycomb' | '3dhoneycomb' | 'lateral-honeycomb' | 'lateral-lattice'
  | 'crosshatch' | 'tpmsd' | 'tpmsfk'
  | 'gyroid' | 'concentric'
  | 'hilbertcurve' | 'archimedeanchords' | 'octagramspiral';

export type SupportType = 'normal_auto' | 'tree_auto' | 'normal_manual' | 'tree_manual';

export type SupportStyle = 'default' | 'grid' | 'snug' | 'tree_slim' | 'tree_strong' | 'tree_hybrid' | 'organic';

export type AdhesionType = 'none' | 'skirt' | 'brim' | 'raft';

export type BrimType = 'no_brim' | 'outer_only' | 'inner_only' | 'outer_and_inner' | 'auto_brim' | 'brim_ears' | 'painted';

export type ZHopType = 'auto' | 'normal' | 'slope' | 'spiral';

export type FuzzySkinType = 'none' | 'external' | 'all' | 'allwalls';

export type FuzzySkinMode = 'displacement' | 'extrusion' | 'combined';

export type FuzzySkinNoiseType = 'classic' | 'perlin' | 'billow' | 'ridged_multi' | 'voronoi';

export type IroningType = 'no ironing' | 'top' | 'topmost' | 'solid';

export type EnsureVerticalShellThickness = 'none' | 'ensure_critical_only' | 'ensure_moderate' | 'ensure_all';

export type GapFillTarget = 'everywhere' | 'topbottom' | 'nowhere';

export type WallDirection = 'auto' | 'ccw' | 'cw';

export type SupportBasePattern = 'default' | 'rectilinear' | 'rectilinear-grid' | 'honeycomb' | 'lightning' | 'hollow';

export type SupportInterfacePattern = 'auto' | 'rectilinear' | 'concentric' | 'rectilinear_interlaced' | 'grid';

export type TimelapseType = 'none' | 'smooth';

// ============================================================
// PrintProfile
// ============================================================

export interface PrintProfile {
  // -- Quality --
  layerHeight: number;                   // mm (0.05-0.6)
  initialLayerPrintHeight: number;       // mm (first layer height)
  adaptiveLayerHeight: boolean;
  preciseZHeight: boolean;

  // Line widths (0 = auto from nozzle diameter)
  lineWidth: number;                     // default line width (mm)
  outerWallLineWidth: number;
  innerWallLineWidth: number;
  topSurfaceLineWidth: number;
  internalSolidInfillLineWidth: number;
  sparseInfillLineWidth: number;
  supportLineWidth: number;
  initialLayerLineWidth: number;

  // Seam
  seamPosition: SeamPosition;
  seamGap: number;                       // mm
  staggeredInnerSeams: boolean;

  // Scarf joint seam
  seamScarfType: SeamScarfType;
  scarfSlopeConditional: boolean;
  scarfAngleThreshold: number;           // degrees
  scarfOverhangThreshold: number;        // degrees
  scarfJointSpeed: number;               // mm/s (0 = auto)
  scarfJointFlowRatio: number;           // ratio (0.8-1.2)
  scarfStartHeight: number;              // mm
  scarfEntireLoop: boolean;
  scarfMinLength: number;                // mm
  scarfSteps: number;
  scarfInnerWalls: boolean;
  scarfHasScarf: boolean;               // master enable

  // -- Walls --
  wallLoops: number;                     // number of perimeters (1-20)
  wallSequence: WallSequence;
  wallGenerator: WallGenerator;
  preciseOuterWall: boolean;
  detectThinWall: boolean;
  detectOverhangWall: boolean;
  onlyOneWallFirstLayer: boolean;
  onlyOneWallTop: boolean;
  extraPerimetersOnOverhangs: boolean;
  slowdownForCurledPerimeters: boolean;
  wallDirection: WallDirection;
  isInfillFirst: boolean;
  ensureVerticalShellThickness: EnsureVerticalShellThickness;
  topLayers: number;
  bottomLayers: number;

  // Arachne settings (used when wallGenerator === 'arachne')
  minBeadWidth: number;                  // % of nozzle
  minFeatureSize: number;                // % of nozzle
  wallTransitionAngle: number;           // degrees
  wallTransitionFilterDeviation: number; // % of nozzle
  wallTransitionLength: number;          // % of nozzle
  wallDistributionCount: number;

  // -- Infill --
  sparseInfillPattern: InfillPattern;
  topSurfacePattern: InfillPattern;      // config key: top_surface_pattern
  bottomSurfacePattern: InfillPattern;   // config key: bottom_surface_pattern
  internalSolidInfillPattern: InfillPattern; // config key: internal_solid_infill_pattern
  sparseInfillDensity: number;           // 0-100 (percentage)
  infillAngle: number;                   // degrees
  infillOverlap: number;                 // percentage (0-100)
  infillCombination: boolean;

  // Bridge settings
  bridgeFlow: number;                    // ratio (0.5-2.0, ConfigOptionFloat)
  internalBridgeFlow: number;            // ratio (0.5-2.0, ConfigOptionFloat)
  bridgeDensity: number;                 // percentage (0-100, ConfigOptionPercent)
  internalBridgeDensity: number;         // percentage (0-100, ConfigOptionPercent)
  bridgeAngle: number;                   // degrees (0 = auto, ConfigOptionFloat)
  internalBridgeAngle: number;           // degrees (0 = auto, ConfigOptionFloat)

  // -- Speed --
  // Per-feature speeds (mm/s)
  outerWallSpeed: number;
  innerWallSpeed: number;
  topSurfaceSpeed: number;
  internalSolidInfillSpeed: number;
  sparseInfillSpeed: number;
  gapFillSpeed: number;
  supportSpeed: number;
  bridgeSpeed: number;
  internalBridgeSpeed: number;
  smallPerimeterSpeed: number;
  smallPerimeterThreshold: number;       // mm radius

  // Overhang speed tiers (FloatOrPercent; 0 = auto)
  enableOverhangSpeed: boolean;
  overhang1_4Speed: number;              // 25% overhang speed (mm/s or %)
  overhang2_4Speed: number;              // 50% overhang speed
  overhang3_4Speed: number;              // 75% overhang speed
  overhang4_4Speed: number;              // 100% overhang speed
  initialLayerSpeed: number;
  initialLayerInfillSpeed: number;
  initialLayerTravelSpeed: number;
  skirtSpeed: number;
  travelSpeed: number;

  // Per-feature accelerations (mm/s²; 0 = printer default)
  defaultAcceleration: number;
  outerWallAcceleration: number;
  innerWallAcceleration: number;
  topSurfaceAcceleration: number;
  bridgeAcceleration: number;
  sparseInfillAcceleration: number;
  internalSolidInfillAcceleration: number;
  initialLayerAcceleration: number;
  travelAcceleration: number;

  // Per-feature jerk (mm/s; 0 = printer default)
  defaultJerk: number;
  outerWallJerk: number;
  innerWallJerk: number;
  topSurfaceJerk: number;
  infillJerk: number;
  travelJerk: number;
  initialLayerJerk: number;

  // Klipper accel-to-decel
  accelToDecelEnable: boolean;
  accelToDecelFactor: number;            // percentage (0-100)

  // -- Support --
  supportEnabled: boolean;
  supportType: SupportType;
  supportStyle: SupportStyle;
  supportThresholdAngle: number;         // degrees (0-90)
  supportDensity: number;                // percentage (0-100)
  supportXYOffset: number;               // mm
  supportZGap: number;                   // gap in layers
  supportOnBuildPlateOnly: boolean;
  supportInterfaceLayers: number;
  supportBasePattern: SupportBasePattern;
  supportInterfacePattern: SupportInterfacePattern;
  supportInterfaceSpacing: number;          // mm (ConfigOptionFloat, default: 0)
  supportInterfaceSpeed: number;            // mm/s (ConfigOptionFloat, default: 0 = auto)
  supportInterfaceBottomLayers: number;     // integer (ConfigOptionInt, default: 0)

  // -- Adhesion --
  adhesionType: AdhesionType;
  skirtCount: number;
  skirtDistance: number;                  // mm
  brimWidth: number;                     // mm
  brimType: BrimType;
  brimEarsDetectionLength: number;       // mm
  brimEarsMaxAngle: number;              // degrees
  raftLayers: number;

  // -- Retraction --
  retractionLength: number;              // mm
  retractionSpeed: number;               // mm/s
  deretractionSpeed: number;             // mm/s (0 = same as retraction)
  retractOnLayerChange: boolean;
  zHopHeight: number;                    // mm
  zHopType: ZHopType;
  wipeDistance: number;                   // mm
  coastDistance: number;                  // mm
  retractLengthToolchange: number;       // mm

  // -- Multi-material / Prime tower --
  enablePrimeTower: boolean;
  primeTowerWidth: number;               // mm
  primeTowerBrimWidth: number;           // mm
  flushVolume: number;                   // mm³ per tool change

  // -- Advanced --
  // Pressure advance
  pressureAdvanceEnable: boolean;
  pressureAdvanceValue: number;
  adaptivePressureAdvance: boolean;
  adaptivePAModel: number;               // model coefficient
  adaptivePAOverhangs: boolean;
  adaptivePABridges: number;             // PA value for bridges

  // Arc fitting
  arcFittingEnable: boolean;
  gcodeResolution: number;               // mm

  // Fuzzy skin
  fuzzySkinType: FuzzySkinType;           // WHERE: none/external/all/allwalls (config key: fuzzy_skin)
  fuzzySkinMode: FuzzySkinMode;           // HOW: displacement/extrusion/combined (config key: fuzzy_skin_mode)
  fuzzySkinNoiseType: FuzzySkinNoiseType;
  fuzzySkinThickness: number;             // mm (ConfigOptionFloat, default: 0.3)
  fuzzySkinPointDistance: number;          // mm (ConfigOptionFloat, default: 0.8)
  fuzzySkinFirstLayer: boolean;            // (ConfigOptionBool, default: false)
  fuzzySkinScale: number;                  // scale factor (ConfigOptionFloat, default: 1.0)
  fuzzySkinOctaves: number;                // integer (ConfigOptionInt, default: 4)
  fuzzySkinPersistence: number;            // ratio (ConfigOptionFloat, default: 0.5)

  // Ironing
  ironingType: IroningType;
  ironingFlow: number;                   // percentage (ConfigOptionPercent)
  ironingSpacing: number;                // mm (ConfigOptionFloat)
  ironingSpeed: number;                  // mm/s (ConfigOptionFloat)
  ironingAngle: number;                  // degrees (ConfigOptionFloat)

  // Hole-to-polyhole
  holeToPolyhole: boolean;
  holeToPolyholeThreshold: number;       // percentage
  holeToPoleholeTwisted: boolean;

  // Flow ratios
  topSolidInfillFlowRatio: number;      // ratio (0.8-1.2, ConfigOptionFloat)
  bottomSolidInfillFlowRatio: number;   // ratio (0.8-1.2, ConfigOptionFloat)

  // Gap fill
  gapFillTarget: GapFillTarget;         // config key: gap_fill_target

  // Retraction advanced
  reduceInfillRetraction: boolean;      // config key: reduce_infill_retraction
  useFirmwareRetraction: boolean;       // config key: use_firmware_retraction

  // Other advanced
  excludeObject: boolean;
  makeOverhangPrintable: boolean;
  makeOverhangPrintableAngle: number;    // degrees
  makeOverhangPrintableHoleSize: number; // mm
  maxVolumetricFlowSmoothingRate: number;    // mm³/s (0 = disabled)
  maxVolumetricFlowSmoothingSegment: number; // mm
  printFlowRatio: number;               // ratio (0.8-1.2)
  timelapseType: TimelapseType;
  spiralMode: boolean;
  overhangReverse: boolean;
  overhangReverseInternalOnly: boolean;
  overhangReverseThreshold: number;      // percentage
  slowDownLayers: number;                // number of layers for gradual speed increase
}

// ============================================================
// Defaults matching OrcaSlicer defaults
// ============================================================

export const DEFAULT_PRINT_PROFILE: PrintProfile = {
  // Quality
  layerHeight: 0.2,
  initialLayerPrintHeight: 0.3,
  adaptiveLayerHeight: false,
  preciseZHeight: false,

  // Line widths (0 = auto)
  lineWidth: 0.4,
  outerWallLineWidth: 0,
  innerWallLineWidth: 0,
  topSurfaceLineWidth: 0,
  internalSolidInfillLineWidth: 0,
  sparseInfillLineWidth: 0,
  supportLineWidth: 0,
  initialLayerLineWidth: 0,

  // Seam
  seamPosition: 'aligned',
  seamGap: 0,
  staggeredInnerSeams: false,

  // Scarf joint seam
  seamScarfType: 'none',
  scarfSlopeConditional: false,
  scarfAngleThreshold: 155,
  scarfOverhangThreshold: 40,
  scarfJointSpeed: 0,
  scarfJointFlowRatio: 1.0,
  scarfStartHeight: 0,
  scarfEntireLoop: false,
  scarfMinLength: 15,
  scarfSteps: 10,
  scarfInnerWalls: false,
  scarfHasScarf: false,

  // Walls
  wallLoops: 3,
  wallSequence: 'inner_outer',
  wallGenerator: 'arachne',
  preciseOuterWall: true,
  detectThinWall: true,
  detectOverhangWall: true,
  onlyOneWallFirstLayer: false,
  onlyOneWallTop: false,
  extraPerimetersOnOverhangs: true,
  slowdownForCurledPerimeters: true,
  wallDirection: 'auto',
  isInfillFirst: false,
  ensureVerticalShellThickness: 'ensure_all',
  topLayers: 4,
  bottomLayers: 4,

  // Arachne
  minBeadWidth: 85,
  minFeatureSize: 25,
  wallTransitionAngle: 10,
  wallTransitionFilterDeviation: 25,
  wallTransitionLength: 100,
  wallDistributionCount: 1,

  // Infill
  sparseInfillPattern: 'gyroid',
  topSurfacePattern: 'monotonicline',
  bottomSurfacePattern: 'monotonic',
  internalSolidInfillPattern: 'monotonic',
  sparseInfillDensity: 15,
  infillAngle: 45,
  infillOverlap: 25,
  infillCombination: false,

  // Bridge settings
  bridgeFlow: 1.0,
  internalBridgeFlow: 1.0,
  bridgeDensity: 100,
  internalBridgeDensity: 100,
  bridgeAngle: 0,
  internalBridgeAngle: 0,

  // Speeds (mm/s)
  outerWallSpeed: 120,
  innerWallSpeed: 180,
  topSurfaceSpeed: 100,
  internalSolidInfillSpeed: 200,
  sparseInfillSpeed: 200,
  gapFillSpeed: 50,
  supportSpeed: 150,
  bridgeSpeed: 25,
  internalBridgeSpeed: 100,
  smallPerimeterSpeed: 50,
  smallPerimeterThreshold: 6.5,

  // Overhang speed tiers (0 = auto)
  enableOverhangSpeed: true,
  overhang1_4Speed: 0,
  overhang2_4Speed: 0,
  overhang3_4Speed: 0,
  overhang4_4Speed: 0,
  initialLayerSpeed: 30,
  initialLayerInfillSpeed: 80,
  initialLayerTravelSpeed: 100,
  skirtSpeed: 30,
  travelSpeed: 300,

  // Accelerations (mm/s²; 0 = printer default)
  defaultAcceleration: 500,
  outerWallAcceleration: 2000,
  innerWallAcceleration: 5000,
  topSurfaceAcceleration: 2000,
  bridgeAcceleration: 1000,
  sparseInfillAcceleration: 5000,
  internalSolidInfillAcceleration: 5000,
  initialLayerAcceleration: 1000,
  travelAcceleration: 5000,

  // Jerk (mm/s; 0 = printer default)
  defaultJerk: 0,
  outerWallJerk: 0,
  innerWallJerk: 0,
  topSurfaceJerk: 0,
  infillJerk: 0,
  travelJerk: 0,
  initialLayerJerk: 0,

  // Klipper accel-to-decel
  accelToDecelEnable: false,
  accelToDecelFactor: 50,

  // Support
  supportEnabled: false,
  supportType: 'normal_auto',
  supportStyle: 'default',
  supportThresholdAngle: 45,
  supportDensity: 20,
  supportXYOffset: 0.3,
  supportZGap: 1,
  supportOnBuildPlateOnly: false,
  supportInterfaceLayers: 3,
  supportBasePattern: 'default',
  supportInterfacePattern: 'auto',
  supportInterfaceSpacing: 0,
  supportInterfaceSpeed: 0,
  supportInterfaceBottomLayers: 0,

  // Adhesion
  adhesionType: 'skirt',
  skirtCount: 3,
  skirtDistance: 2,
  brimWidth: 8,
  brimType: 'auto_brim',
  brimEarsDetectionLength: 1,
  brimEarsMaxAngle: 125,
  raftLayers: 0,

  // Retraction
  retractionLength: 0.8,
  retractionSpeed: 30,
  deretractionSpeed: 0,
  retractOnLayerChange: true,
  zHopHeight: 0,
  zHopType: 'normal',
  wipeDistance: 2,
  coastDistance: 0,
  retractLengthToolchange: 10,

  // Multi-material / Prime tower
  enablePrimeTower: false,
  primeTowerWidth: 60,
  primeTowerBrimWidth: 3,
  flushVolume: 140,

  // Pressure advance
  pressureAdvanceEnable: false,
  pressureAdvanceValue: 0.02,
  adaptivePressureAdvance: false,
  adaptivePAModel: 0,
  adaptivePAOverhangs: false,
  adaptivePABridges: 0,

  // Arc fitting
  arcFittingEnable: false,
  gcodeResolution: 0.012,

  // Fuzzy skin
  fuzzySkinType: 'none',
  fuzzySkinMode: 'displacement',
  fuzzySkinNoiseType: 'classic',
  fuzzySkinThickness: 0.3,
  fuzzySkinPointDistance: 0.8,
  fuzzySkinFirstLayer: false,
  fuzzySkinScale: 1.0,
  fuzzySkinOctaves: 4,
  fuzzySkinPersistence: 0.5,

  // Ironing
  ironingType: 'no ironing',
  ironingFlow: 15,
  ironingSpacing: 0.1,
  ironingSpeed: 15,
  ironingAngle: 45,

  // Hole-to-polyhole
  holeToPolyhole: false,
  holeToPolyholeThreshold: 40,
  holeToPoleholeTwisted: false,

  // Flow ratios
  topSolidInfillFlowRatio: 1.0,
  bottomSolidInfillFlowRatio: 1.0,

  // Gap fill
  gapFillTarget: 'nowhere',

  // Retraction advanced
  reduceInfillRetraction: false,
  useFirmwareRetraction: false,

  // Other advanced
  excludeObject: true,
  makeOverhangPrintable: false,
  makeOverhangPrintableAngle: 55,
  makeOverhangPrintableHoleSize: 0,
  maxVolumetricFlowSmoothingRate: 0,
  maxVolumetricFlowSmoothingSegment: 3,
  printFlowRatio: 1.0,
  timelapseType: 'none',
  spiralMode: false,
  overhangReverse: false,
  overhangReverseInternalOnly: false,
  overhangReverseThreshold: 50,
  slowDownLayers: 0,
};
