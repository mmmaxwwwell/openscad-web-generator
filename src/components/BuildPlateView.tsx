// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Printer } from '../hooks/usePrinters';
import type { PrintProfile } from '../types/print-profile';
import type { BuildPlateObject } from '../types/build-plate';
import type { ColorGroup } from '../lib/merge-3mf';
import type { UseOpenSCADResult } from '../hooks/useOpenSCAD';
import type { ScadParam, ScadValue } from '../types';
import type { ParsedGCode } from '../lib/gcode-parser';
import type { SliceResult } from '../hooks/useSlicer';
import type { PrinterSettings } from '../lib/slicer-settings';
import { useBuildPlate } from '../hooks/useBuildPlate';
import { useSlicer } from '../hooks/useSlicer';
import { useFilaments } from '../hooks/useFilaments';
import { useExtruderFilaments } from '../hooks/useExtruderFilaments';
import { usePrinterFilamentOverrides } from '../hooks/usePrinterFilamentOverrides';
import { usePrinterConfig } from '../hooks/usePrinterConfig';
import { getPrinterProfile } from '../data/printer-profiles';
import { validatePlateForSlicing, buildPlateSliceConfig, layFlatMesh, computePrimeTowerDepth, getMaxFlushVolume } from '../lib/plate-slicer';
import { getPlateExtruderCount } from './BuildPlateFlushVolumes';
import { uploadToMoonraker } from './SendToPrinter';
import { BuildPlateCanvas } from './BuildPlateCanvas';
import { BuildPlateObjectSettings } from './BuildPlateObjectSettings';
import { GCodePreview } from './GCodePreview';
import { ParameterEditor } from './ParameterEditor';
import {
  QualityTab,
  WallsTab,
  InfillTab,
  SpeedTab,
  SupportTab,
  AdhesionTab,
  AdvancedTab,
} from './print-settings';
import { BuildPlatePrimeTower } from './BuildPlatePrimeTower';
import { BuildPlateFlushVolumes } from './BuildPlateFlushVolumes';
import { parseScadFile } from '../lib/scad-parser';

const SCAD_EXAMPLES: Array<{ name: string; path: string }> = [
  { name: '1cm Cube', path: '/examples/cube_1cm.scad' },
  { name: 'Parametric Cube', path: '/examples/param_cube.scad' },
  { name: 'Parametric Multicolor', path: '/examples/param_multicolor.scad' },
  { name: 'Big Chapstick (BOSL2)', path: '/examples/big_chapstick.scad' },
  { name: 'Parametric Sign', path: '/examples/sign.scad' },
  { name: 'Stacked Colors', path: '/examples/stacked_colors.scad' },
  { name: 'Fi Mini Case (BOSL2 + QR)', path: '/examples/fi_mini_case.scad' },
];

// ── Printer bed dimensions helper ────────────────────────────────────────

interface BedDimensions {
  bedWidth: number;
  bedDepth: number;
  maxHeight: number;
  originCenter: boolean;
}

function getBedDimensions(printer: Printer): BedDimensions {
  const profile = printer.profileId ? getPrinterProfile(printer.profileId) : undefined;
  return {
    bedWidth: profile?.bedWidth ?? 235,
    bedDepth: profile?.bedDepth ?? 235,
    maxHeight: profile?.maxHeight ?? 300,
    originCenter: profile?.originCenter ?? false,
  };
}

const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  bedWidth: 235,
  bedDepth: 235,
  maxHeight: 300,
  originCenter: false,
  startGcode: 'START_PRINT BED_TEMP={bed_temp} EXTRUDER_TEMP={temp}',
  endGcode: 'END_PRINT',
  toolChangeGcode: 'T{tool}',
  printableArea: [],
  bedExcludeAreas: [],
  printerStructureType: 'cartesian',
  nozzleType: 'brass',
  nozzleHRC: 0,
  auxiliaryFan: false,
  chamberTempControl: false,
  maxVolumetricSpeed: 0,
};

function printerSettingsFromProfile(profileId?: string): PrinterSettings {
  if (!profileId) return DEFAULT_PRINTER_SETTINGS;
  const profile = getPrinterProfile(profileId);
  if (!profile) return DEFAULT_PRINTER_SETTINGS;
  return {
    ...DEFAULT_PRINTER_SETTINGS,
    bedWidth: profile.bedWidth,
    bedDepth: profile.bedDepth,
    maxHeight: profile.maxHeight,
    originCenter: profile.originCenter,
    startGcode: profile.startGcode,
    endGcode: profile.endGcode,
  };
}

// ── Tab → field mapping for per-object override detection ────────────────

/** Fields that belong to each print settings tab. Used to show warning indicators. */
const TAB_FIELDS: Record<string, Array<keyof PrintProfile>> = {
  quality: [
    'layerHeight', 'initialLayerPrintHeight', 'adaptiveLayerHeight', 'preciseZHeight',
    'lineWidth', 'outerWallLineWidth', 'innerWallLineWidth', 'topSurfaceLineWidth',
    'internalSolidInfillLineWidth', 'sparseInfillLineWidth', 'supportLineWidth',
    'initialLayerLineWidth', 'seamPosition', 'seamGap', 'staggeredInnerSeams',
    'seamScarfType', 'scarfSlopeConditional', 'scarfAngleThreshold',
    'scarfOverhangThreshold', 'scarfJointSpeed', 'scarfJointFlowRatio',
    'scarfStartHeight', 'scarfEntireLoop', 'scarfMinLength', 'scarfSteps', 'scarfInnerWalls',
  ],
  walls: [
    'wallLoops', 'wallSequence', 'wallGenerator', 'wallDirection',
    'ensureVerticalShellThickness', 'topLayers', 'bottomLayers',
    'isInfillFirst', 'preciseOuterWall', 'detectThinWall', 'detectOverhangWall',
    'onlyOneWallFirstLayer', 'onlyOneWallTop', 'extraPerimetersOnOverhangs',
    'slowdownForCurledPerimeters', 'minBeadWidth', 'minFeatureSize',
    'wallTransitionAngle', 'wallTransitionFilterDeviation',
    'wallTransitionLength', 'wallDistributionCount',
  ],
  infill: [
    'sparseInfillDensity', 'sparseInfillPattern', 'infillAngle', 'infillOverlap',
    'infillCombination', 'topSurfacePattern', 'bottomSurfacePattern',
    'internalSolidInfillPattern', 'bridgeFlow', 'internalBridgeFlow',
    'bridgeDensity', 'internalBridgeDensity', 'bridgeAngle', 'internalBridgeAngle',
  ],
  speed: [
    'outerWallSpeed', 'innerWallSpeed', 'topSurfaceSpeed',
    'internalSolidInfillSpeed', 'sparseInfillSpeed', 'gapFillSpeed',
    'supportSpeed', 'bridgeSpeed', 'internalBridgeSpeed',
    'smallPerimeterSpeed', 'smallPerimeterThreshold',
    'initialLayerSpeed', 'initialLayerInfillSpeed', 'initialLayerTravelSpeed',
    'skirtSpeed', 'travelSpeed', 'enableOverhangSpeed',
    'overhang1_4Speed', 'overhang2_4Speed', 'overhang3_4Speed', 'overhang4_4Speed',
    'defaultAcceleration', 'outerWallAcceleration', 'innerWallAcceleration',
    'topSurfaceAcceleration', 'bridgeAcceleration', 'sparseInfillAcceleration',
    'internalSolidInfillAcceleration', 'initialLayerAcceleration', 'travelAcceleration',
    'defaultJerk', 'outerWallJerk', 'innerWallJerk', 'topSurfaceJerk',
    'infillJerk', 'travelJerk', 'initialLayerJerk',
    'accelToDecelEnable', 'accelToDecelFactor',
  ],
  support: [
    'supportEnabled', 'supportType', 'supportStyle', 'supportThresholdAngle',
    'supportDensity', 'supportXYOffset', 'supportZGap',
    'supportOnBuildPlateOnly', 'supportSpeed', 'supportLineWidth',
    'supportBasePattern', 'supportInterfaceLayers', 'supportInterfaceBottomLayers',
    'supportInterfacePattern', 'supportInterfaceSpacing', 'supportInterfaceSpeed',
  ],
  adhesion: [
    'adhesionType', 'skirtCount', 'skirtDistance', 'skirtSpeed',
    'brimWidth', 'brimType', 'brimEarsDetectionLength', 'brimEarsMaxAngle',
    'raftLayers',
  ],
  advanced: [
    'pressureAdvanceEnable', 'pressureAdvanceValue', 'adaptivePressureAdvance',
    'adaptivePAModel', 'adaptivePAOverhangs', 'adaptivePABridges',
    'arcFittingEnable', 'gcodeResolution', 'fuzzySkinType', 'fuzzySkinMode',
    'fuzzySkinNoiseType', 'fuzzySkinThickness', 'fuzzySkinPointDistance',
    'fuzzySkinFirstLayer', 'fuzzySkinScale', 'fuzzySkinOctaves', 'fuzzySkinPersistence',
    'ironingType', 'ironingFlow', 'ironingSpacing', 'ironingSpeed', 'ironingAngle',
    'holeToPolyhole', 'holeToPolyholeThreshold', 'holeToPoleholeTwisted',
    'excludeObject', 'makeOverhangPrintable', 'makeOverhangPrintableAngle',
    'makeOverhangPrintableHoleSize', 'maxVolumetricFlowSmoothingRate',
    'maxVolumetricFlowSmoothingSegment', 'printFlowRatio', 'timelapseType',
    'spiralMode', 'overhangReverse', 'overhangReverseThreshold', 'slowDownLayers',
  ],
};

function hasTabOverrides(tab: string, overriddenFields: Set<keyof PrintProfile>): boolean {
  const fields = TAB_FIELDS[tab];
  if (!fields) return false;
  return fields.some((f) => overriddenFields.has(f));
}

// ── Props ────────────────────────────────────────────────────────────────

export interface PendingBuildPlateObject {
  meshData: ArrayBuffer;
  format: 'stl' | '3mf';
  name: string;
  colorGroups?: ColorGroup[];
  /** SCAD source code (for re-rendering on the build plate) */
  scadSource?: string;
  /** Current SCAD parameter values */
  scadParams?: Record<string, ScadValue>;
  /** Parsed SCAD parameter definitions (for parameter editor UI) */
  scadParamDefs?: ScadParam[];
  /** SCAD file identifier */
  scadFileId?: string;
}

export interface BuildPlateViewProps {
  printer: Printer;
  openscad?: UseOpenSCADResult;
  onClose: () => void;
  onSlice?: (gcode: ArrayBuffer, stats: { time: number; filament: number }) => void;
  pendingObject?: PendingBuildPlateObject | null;
  onPendingObjectConsumed?: () => void;
}

// ── Sidebar view mode ────────────────────────────────────────────────────

type SidebarMode = 'objects' | 'plate-settings';

// ── Component ────────────────────────────────────────────────────────────

export function BuildPlateView({ printer, openscad, onClose, pendingObject, onPendingObjectConsumed }: BuildPlateViewProps) {
  const { bedWidth, bedDepth, maxHeight, originCenter } = getBedDimensions(printer);

  const plate = useBuildPlate(bedWidth, bedDepth, maxHeight, originCenter);
  const slicer = useSlicer();
  const printerConfig = usePrinterConfig(printer.address);
  const { filaments } = useFilaments(printer.profileId, printer.nozzleDiameter);

  // Extruder count from plate objects
  const extruderCount = useMemo(() => getPlateExtruderCount(plate.objects), [plate.objects]);
  const { getFilamentForExtruder } = useExtruderFilaments(printer.address, extruderCount);
  const primaryFilament = getFilamentForExtruder(0, filaments);
  const { getResolvedFilament } = usePrinterFilamentOverrides();
  const resolvedFilament = useMemo(
    () => getResolvedFilament(printer.address, primaryFilament),
    [getResolvedFilament, printer.address, primaryFilament],
  );
  const [printerSettings, setPrinterSettings] = useState<PrinterSettings>(
    () => printerSettingsFromProfile(printer.profileId),
  );

  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('objects');
  const [gridSnap, setGridSnap] = useState(false);
  const [scadRendering, setScadRendering] = useState(false);
  const [scadError, setScadError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [reRenderParams, setReRenderParams] = useState<Record<string, ScadValue> | null>(null);
  const [reRendering, setReRendering] = useState(false);
  const [plateSettingsTab, setPlateSettingsTab] = useState<string>('plate');
  const [reRenderError, setReRenderError] = useState<string | null>(null);
  const [showArrayCopy, setShowArrayCopy] = useState(false);
  const [arrayCopyRows, setArrayCopyRows] = useState(2);
  const [arrayCopyCols, setArrayCopyCols] = useState(2);
  const [arrayCopySpacing, setArrayCopySpacing] = useState(10);
  const [showScadPicker, setShowScadPicker] = useState(false);
  const [scadPickerExamples, setScadPickerExamples] = useState<Array<{ name: string; path: string }>>([]);
  const [scadPickerLoading, setScadPickerLoading] = useState(false);
  const [scadPickerMulticolor, setScadPickerMulticolor] = useState(false);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // ── Slice result state ─────────────────────────────────────────────
  const [sliceResult, setSliceResult] = useState<SliceResult | null>(null);
  const [sliceError, setSliceError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [parsedGCode, setParsedGCode] = useState<ParsedGCode | null>(null);
  const [previewProgress, setPreviewProgress] = useState(0);
  const previewWorkerRef = useRef<Worker | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showWasmWarning, setShowWasmWarning] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ objectId: string; x: number; y: number } | null>(null);

  // ── Apply printer config from Moonraker when it arrives ────────────
  useEffect(() => {
    if (!printerConfig.config) return;
    setPrinterSettings((prev) => ({
      ...prev,
      bedWidth: printerConfig.config!.bedWidth,
      bedDepth: printerConfig.config!.bedDepth,
      maxHeight: printerConfig.config!.maxHeight,
      originCenter: printerConfig.config!.originCenter,
      startGcode: printerConfig.config!.startGcode || prev.startGcode,
      endGcode: printerConfig.config!.endGcode || prev.endGcode,
    }));
  }, [printerConfig.config]);

  // ── Consume pending object from external "Send to Build Plate" ───────

  useEffect(() => {
    if (!pendingObject || !plate.loaded) return;
    const isScad = !!(pendingObject.scadSource && pendingObject.scadParams && pendingObject.scadParamDefs);
    plate.addObject({
      name: pendingObject.name,
      type: isScad ? 'scad' : (pendingObject.format === 'stl' ? 'stl' : '3mf'),
      meshData: pendingObject.meshData,
      meshFormat: pendingObject.format,
      colorGroups: pendingObject.colorGroups?.map((g) => ({ color: g.colorHex })),
      ...(isScad ? {
        scadSource: pendingObject.scadSource,
        scadParams: pendingObject.scadParams,
        scadParamDefs: pendingObject.scadParamDefs,
        scadFileId: pendingObject.scadFileId,
      } : {}),
    });
    onPendingObjectConsumed?.();
  }, [pendingObject, plate.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-enable prime tower for multicolor plates ────────────────────

  useEffect(() => {
    const hasMulticolor = plate.objects.some((o) => o.colorGroups && o.colorGroups.length > 1);
    if (hasMulticolor && !plate.primeTower.enabled) {
      plate.setPrimeTower({ enabled: true });
    }
  }, [plate.objects]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Estimated prime tower depth (for canvas visualization) ──────────

  const estimatedTowerDepth = useMemo(() => {
    if (!plate.primeTower.enabled || extruderCount < 2) return undefined;
    const { layerHeight, lineWidth, flushVolume } = plate.plateProfile;
    let maxFlush: number;
    if (plate.flushVolumeConfig && plate.flushVolumeConfig.extruderCount >= 2) {
      maxFlush = getMaxFlushVolume(
        plate.flushVolumeConfig.matrix,
        plate.flushVolumeConfig.extruderCount,
        plate.flushVolumeConfig.multiplier,
      );
    } else {
      maxFlush = flushVolume;
    }
    return computePrimeTowerDepth(maxFlush, plate.primeTower.width, layerHeight, lineWidth);
  }, [plate.primeTower.enabled, plate.primeTower.width, plate.plateProfile, plate.flushVolumeConfig, extruderCount]);

  // ── Prime tower position from canvas drag ──────────────────────────

  const handlePrimeTowerPositionUpdate = useCallback(
    (position: { x: number; y: number }) => {
      plate.setPrimeTower({ position });
    },
    [plate],
  );

  // ── File import handlers ─────────────────────────────────────────────

  const handleAddSTL = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.stl';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) plate.addSTLFile(file);
    };
    input.click();
  }, [plate]);

  const handleAdd3MF = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.3mf';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) plate.add3MFFile(file);
    };
    input.click();
  }, [plate]);

  // ── SCAD file import ────────────────────────────────────────────────

  const handleAddScadFile = useCallback(
    async (
      fileId: string,
      source: string,
      params: Record<string, ScadValue>,
      paramDefs?: ScadParam[],
      multicolor = false,
    ) => {
      if (!openscad) return;
      setScadRendering(true);
      setScadError(null);
      try {
        let meshData: ArrayBuffer;
        let meshFormat: 'stl' | '3mf';
        let colorGroups: Array<{ color: string; name?: string }> | undefined;

        if (multicolor) {
          meshData = await openscad.renderMulticolor(source, params);
          meshFormat = '3mf';
          const { extractColorGroups } = await import('../lib/merge-3mf');
          const groups = extractColorGroups(meshData);
          colorGroups = groups.length > 0
            ? groups.map((g) => ({ color: g.colorHex }))
            : undefined;
        } else {
          meshData = await openscad.render(source, params, 'stl');
          meshFormat = 'stl';
        }

        plate.addObject({
          name: fileId.replace(/\.scad$/i, ''),
          type: 'scad',
          meshData,
          meshFormat,
          colorGroups,
          scadFileId: fileId,
          scadSource: source,
          scadParams: params,
          scadParamDefs: paramDefs,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setScadError(msg);
      } finally {
        setScadRendering(false);
      }
    },
    [openscad, plate],
  );

  const handleOpenScadPicker = useCallback(() => {
    setScadPickerExamples(SCAD_EXAMPLES);
    setShowScadPicker(true);
  }, []);

  const handleScadPickerSelect = useCallback(
    async (examplePath: string, displayName: string, multicolor: boolean) => {
      setShowScadPicker(false);
      setScadPickerLoading(true);
      try {
        const url = `${import.meta.env.BASE_URL}${examplePath.replace(/^\//, '')}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Failed to fetch ${displayName}: ${resp.statusText}`);
        const source = await resp.text();
        const parsed = parseScadFile(source);
        const defaultParams: Record<string, ScadValue> = {};
        for (const p of parsed.params) {
          defaultParams[p.name] = p.default;
        }
        const fileId = examplePath.split('/').pop() ?? displayName;
        await handleAddScadFile(fileId, source, defaultParams, parsed.params, multicolor);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setScadError(msg);
      } finally {
        setScadPickerLoading(false);
      }
    },
    [handleAddScadFile],
  );

  // ── Drag and drop ──────────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only leave if we're actually leaving the container (not entering a child)
    if (canvasContainerRef.current && !canvasContainerRef.current.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        const name = file.name.toLowerCase();
        if (name.endsWith('.stl')) {
          plate.addSTLFile(file);
        } else if (name.endsWith('.3mf')) {
          plate.add3MFFile(file);
        }
      }
    },
    [plate],
  );

  // ── Toolbar action handlers ──────────────────────────────────────────

  const handleDelete = useCallback(() => {
    if (plate.selectedObjectId) {
      plate.removeObject(plate.selectedObjectId);
    }
  }, [plate]);

  const handleDuplicate = useCallback(() => {
    if (plate.selectedObjectId) {
      plate.duplicateObject(plate.selectedObjectId);
    }
  }, [plate]);

  const handleLayFlat = useCallback(() => {
    const obj = plate.selectedObject;
    if (!obj) return;
    const result = layFlatMesh(obj.meshData, obj.meshFormat);
    if (result) {
      plate.replaceObjectMesh(obj.id, result, obj.meshFormat, obj.colorGroups);
    }
  }, [plate]);

  const handleMirror = useCallback(
    (axis: 'x' | 'y' | 'z') => {
      if (plate.selectedObjectId) {
        plate.mirrorObject(plate.selectedObjectId, axis);
      }
    },
    [plate],
  );

  const handleObjectContextMenu = useCallback((objectId: string, x: number, y: number) => {
    setContextMenu({ objectId, x, y });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleArrayCopy = useCallback(() => {
    if (!plate.selectedObjectId) return;
    plate.arrayCopyObject(
      plate.selectedObjectId,
      arrayCopyRows,
      arrayCopyCols,
      arrayCopySpacing,
      arrayCopySpacing,
    );
    setShowArrayCopy(false);
  }, [plate, arrayCopyRows, arrayCopyCols, arrayCopySpacing]);

  const handleToggleGridSnap = useCallback(() => {
    setGridSnap((prev) => !prev);
  }, []);

  const handleTogglePrintSequence = useCallback(() => {
    plate.setPrintSequence(plate.printSequence === 'by_layer' ? 'by_object' : 'by_layer');
  }, [plate]);

  // ── Selection handler — auto-open object settings ────────────────────

  const handleSelectObject = useCallback(
    (id: string | null) => {
      plate.selectObject(id);
      if (id) {
        // Switch to objects view when selecting an object
        setSidebarMode('objects');
      }
    },
    [plate],
  );

  // ── Object list selection ────────────────────────────────────────────

  const handleObjectListClick = useCallback(
    (obj: BuildPlateObject) => {
      handleSelectObject(obj.id);
    },
    [handleSelectObject],
  );

  // ── SCAD re-render ──────────────────────────────────────────────────

  // Initialize/reset local param editor when selection changes
  useEffect(() => {
    if (plate.selectedObject?.type === 'scad' && plate.selectedObject.scadParams) {
      setReRenderParams({ ...plate.selectedObject.scadParams });
    } else {
      setReRenderParams(null);
    }
    setReRenderError(null);
  }, [plate.selectedObjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScadParamChange = useCallback(
    (name: string, value: ScadValue) => {
      setReRenderParams((prev) => (prev ? { ...prev, [name]: value } : prev));
    },
    [],
  );

  const handleReRender = useCallback(
    async (multicolor = false) => {
      const obj = plate.selectedObject;
      if (!obj || obj.type !== 'scad' || !obj.scadSource || !openscad || !reRenderParams) return;

      setReRendering(true);
      setReRenderError(null);
      try {
        let meshData: ArrayBuffer;
        let meshFormat: 'stl' | '3mf';
        let colorGroups: Array<{ color: string; name?: string }> | undefined;

        if (multicolor) {
          meshData = await openscad.renderMulticolor(obj.scadSource, reRenderParams);
          meshFormat = '3mf';
          const { extractColorGroups } = await import('../lib/merge-3mf');
          const groups = extractColorGroups(meshData);
          colorGroups = groups.length > 0
            ? groups.map((g) => ({ color: g.colorHex }))
            : undefined;
        } else {
          meshData = await openscad.render(obj.scadSource, reRenderParams, 'stl');
          meshFormat = 'stl';
        }

        plate.replaceObjectMesh(obj.id, meshData, meshFormat, colorGroups, reRenderParams);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setReRenderError(msg);
      } finally {
        setReRendering(false);
      }
    },
    [openscad, plate, reRenderParams],
  );

  // ── Per-object override handlers ─────────────────────────────────────

  const handleObjectOverrideChange = useCallback(
    (updates: Partial<PrintProfile>) => {
      if (plate.selectedObjectId) {
        plate.updateObjectOverrides(plate.selectedObjectId, updates);
      }
    },
    [plate],
  );

  const handleClearObjectOverrides = useCallback(() => {
    if (plate.selectedObjectId) {
      plate.clearObjectOverrides(plate.selectedObjectId);
    }
  }, [plate]);

  const handleResetField = useCallback(
    (field: keyof PrintProfile) => {
      if (!plate.selectedObjectId || !plate.selectedObject?.printOverrides) return;
      const next = { ...plate.selectedObject.printOverrides };
      delete next[field];
      // Replace overrides entirely — use updateObjectOverrides with cleaned copy
      plate.clearObjectOverrides(plate.selectedObjectId);
      if (Object.keys(next).length > 0) {
        plate.updateObjectOverrides(plate.selectedObjectId, next);
      }
    },
    [plate],
  );

  // ── Plate profile handler ────────────────────────────────────────────

  const handlePlateProfileChange = useCallback(
    (updates: Partial<PrintProfile>) => {
      plate.setPlateProfile(updates);
    },
    [plate],
  );

  // ── Slice plate ───────────────────────────────────────────────────

  const doSlicePlate = useCallback(async () => {
    const buildPlate = {
      objects: plate.objects,
      plateProfile: plate.plateProfile,
      primeTower: plate.primeTower,
      flushVolumeConfig: plate.flushVolumeConfig,
      printSequence: plate.printSequence,
      bedWidth,
      bedDepth,
      maxHeight,
      originCenter,
    };

    // Build config
    const job = buildPlateSliceConfig(
      buildPlate,
      resolvedFilament,
      printerSettings,
      printerConfig.config ?? null,
      extruderCount,
    );

    // Clear previous result
    setSliceResult(null);
    setSliceError(null);
    setParsedGCode(null);
    setPreviewProgress(0);

    // Slice
    try {
      const result = await slicer.slicePlate(
        job.objects,
        job.globalConfig,
        job.printSequence,
      );
      setSliceResult(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSliceError(msg);
    }
  }, [plate, bedWidth, bedDepth, maxHeight, originCenter, resolvedFilament, printerSettings, printerConfig.config, extruderCount, slicer]);

  const handleSlicePlate = useCallback(() => {
    // Validate first
    const buildPlate = {
      objects: plate.objects,
      plateProfile: plate.plateProfile,
      primeTower: plate.primeTower,
      flushVolumeConfig: plate.flushVolumeConfig,
      printSequence: plate.printSequence,
      bedWidth,
      bedDepth,
      maxHeight,
      originCenter,
    };
    const errors = validatePlateForSlicing(buildPlate);
    setValidationErrors(errors);
    if (errors.length > 0) return;

    // Show WASM performance warning before slicing in browser
    const isWasm = slicer.engineName === 'WASM' || slicer.engineName === 'WASM64';
    if (isWasm) {
      setShowWasmWarning(true);
    } else {
      void doSlicePlate();
    }
  }, [plate, bedWidth, bedDepth, maxHeight, originCenter, slicer.engineName, doSlicePlate]);

  // ── Parse GCode in worker after slice completes ────────────────────

  useEffect(() => {
    if (!sliceResult || parsedGCode) return;
    if (previewWorkerRef.current) return;

    setPreviewProgress(0);

    const worker = new Worker(
      new URL('../workers/gcode-preview-worker.ts', import.meta.url),
      { type: 'module' },
    );
    previewWorkerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        setPreviewProgress(msg.progress);
      } else if (msg.type === 'done') {
        setParsedGCode(msg.result);
        worker.terminate();
        previewWorkerRef.current = null;
      } else if (msg.type === 'error' || msg.type === 'cancelled') {
        worker.terminate();
        previewWorkerRef.current = null;
      }
    };

    worker.postMessage({ type: 'parse', gcode: sliceResult.gcode });
  }, [sliceResult, parsedGCode]);

  // Clean up preview worker on unmount
  useEffect(() => {
    return () => {
      if (previewWorkerRef.current) {
        previewWorkerRef.current.terminate();
        previewWorkerRef.current = null;
      }
      slicer.cancel();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Upload to printer ──────────────────────────────────────────────

  const handleUploadToPrinter = useCallback(async () => {
    if (!sliceResult) return;
    setUploadStatus('uploading');
    setUploadError(null);
    try {
      const blob = new Blob([sliceResult.gcode], { type: 'text/x-gcode' });
      const fileName = `plate_${Date.now()}.gcode`;
      await uploadToMoonraker(printer.address, blob, fileName);
      setUploadStatus('done');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setUploadError(msg);
      setUploadStatus('error');
    }
  }, [sliceResult, printer.address]);

  const handleBackFromPreview = useCallback(() => {
    setSliceResult(null);
    setParsedGCode(null);
    setPreviewProgress(0);
    setUploadStatus('idle');
    setUploadError(null);
  }, []);

  // ── Keyboard shortcuts ──────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip when typing in inputs/textareas/selects
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Ctrl+Z: undo, Ctrl+Shift+Z: redo
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (e.shiftKey) {
          plate.redo();
        } else {
          plate.undo();
        }
        return;
      }

      // Escape: deselect (or close array popover)
      if (e.key === 'Escape') {
        if (showArrayCopy) {
          setShowArrayCopy(false);
        } else {
          handleSelectObject(null);
        }
        return;
      }

      // Delete / Backspace: remove selected
      if ((e.key === 'Delete' || e.key === 'Backspace') && plate.selectedObjectId) {
        e.preventDefault();
        handleDelete();
        return;
      }

      // Ctrl+D: duplicate
      if (e.key === 'd' && (e.ctrlKey || e.metaKey) && plate.selectedObjectId) {
        e.preventDefault();
        handleDuplicate();
        return;
      }

      // Ctrl+A: select all (no multi-select yet, so no-op — but prevent default)
      if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        return;
      }

      // R: rotate 90°
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey && plate.selectedObject) {
        e.preventDefault();
        const currentRot = plate.selectedObject.rotation ?? 0;
        plate.updateObjectTransform(plate.selectedObject.id, { rotation: currentRot + 90 });
        return;
      }

      // Arrow keys: nudge 1mm (shift: 10mm)
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && plate.selectedObject) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const pos = plate.selectedObject.position;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        if (e.key === 'ArrowUp') dy = step;    // model Y goes back (up on screen)
        if (e.key === 'ArrowDown') dy = -step;
        plate.updateObjectTransform(plate.selectedObject.id, {
          position: { x: pos.x + dx, y: pos.y + dy },
        });
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [plate.selectedObjectId, plate.selectedObject, showArrayCopy, handleSelectObject, handleDelete, handleDuplicate, plate]);

  // ── Compute fields that have per-object overrides (for plate settings warning icons) ──

  const fieldsWithObjectOverrides = useMemo(() => {
    const fields = new Set<keyof PrintProfile>();
    for (const obj of plate.objects) {
      if (obj.printOverrides) {
        for (const key of Object.keys(obj.printOverrides)) {
          fields.add(key as keyof PrintProfile);
        }
      }
    }
    return fields;
  }, [plate.objects]);

  // ── Loading state ────────────────────────────────────────────────────

  if (!plate.loaded) {
    return (
      <div className="build-plate-overlay">
        <div className="build-plate-loading">Loading build plate...</div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="build-plate-overlay">
      <div className="build-plate-view">
        {/* Header */}
        <div className="build-plate-header">
          <h3>Build Plate &mdash; {printer.name}</h3>
          <div className="build-plate-header-actions">
            <span className="build-plate-object-count">
              {plate.objects.length} object{plate.objects.length !== 1 ? 's' : ''}
            </span>
            <button className="build-plate-close" onClick={onClose}>
              &times;
            </button>
          </div>
        </div>

        {/* Main content: sidebar + canvas + right panel */}
        <div className="build-plate-body">
          {/* Left sidebar: objects + settings */}
          <div className="build-plate-sidebar">
            {/* Mode toggle */}
            <div className="build-plate-sidebar-toggle">
              <button
                className={`build-plate-sidebar-toggle-btn ${sidebarMode === 'objects' ? 'build-plate-sidebar-toggle-btn--active' : ''}`}
                onClick={() => setSidebarMode('objects')}
              >
                Objects ({plate.objects.length})
              </button>
              <button
                className={`build-plate-sidebar-toggle-btn ${sidebarMode === 'plate-settings' ? 'build-plate-sidebar-toggle-btn--active' : ''}`}
                onClick={() => setSidebarMode('plate-settings')}
              >
                Plate Settings
              </button>
            </div>

            {/* Objects mode */}
            {sidebarMode === 'objects' && (
              <div className="build-plate-sidebar-content">
                {/* Object list */}
                {plate.objects.length === 0 ? (
                  <div className="build-plate-empty">
                    No objects on plate.
                    <br />
                    Use the toolbar to add objects.
                  </div>
                ) : (
                  <div className="build-plate-object-list">
                    {plate.objects.map((obj) => (
                      <div
                        key={obj.id}
                        className={`build-plate-object-item ${plate.selectedObjectId === obj.id ? 'build-plate-object-item--selected' : ''}`}
                        onClick={() => handleObjectListClick(obj)}
                      >
                        <span className="build-plate-object-type-badge">
                          {obj.type.toUpperCase()}
                        </span>
                        <span className="build-plate-object-name">{obj.name}</span>
                        {obj.colorGroups && obj.colorGroups.length > 1 && (
                          <span className="build-plate-object-colors">
                            {obj.colorGroups.map((cg, i) => (
                              <span
                                key={i}
                                className="build-plate-color-swatch"
                                style={{ backgroundColor: cg.color.slice(0, 7) }}
                                title={`Extruder ${i + 1}: ${cg.color}`}
                              />
                            ))}
                          </span>
                        )}
                        {obj.printOverrides && Object.keys(obj.printOverrides).length > 0 && (
                          <span className="build-plate-object-override-badge" title="Has per-object settings">
                            *
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Object settings (visible when an object is selected) */}
                {plate.selectedObject && (
                  <div className="build-plate-sidebar-section-body">
                    <div className="build-plate-object-settings-header">
                      <strong>{plate.selectedObject.name}</strong>
                    </div>

                    {/* SCAD parameter editor + re-render */}
                    {plate.selectedObject.type === 'scad' &&
                      plate.selectedObject.scadParamDefs &&
                      plate.selectedObject.scadParamDefs.length > 0 &&
                      reRenderParams && (
                        <div className="build-plate-scad-params-section">
                          <h4>SCAD Parameters</h4>
                          <ParameterEditor
                            params={plate.selectedObject.scadParamDefs}
                            values={reRenderParams}
                            onChange={handleScadParamChange}
                          />
                          <div className="build-plate-rerender-actions">
                            <button
                              className="build-plate-btn build-plate-btn--primary"
                              onClick={() => handleReRender(false)}
                              disabled={reRendering || !openscad}
                              title="Re-render with updated parameters (single-color STL)"
                            >
                              {reRendering ? 'Rendering...' : 'Re-render'}
                            </button>
                            <button
                              className="build-plate-btn build-plate-btn--primary"
                              onClick={() => handleReRender(true)}
                              disabled={reRendering || !openscad}
                              title="Re-render as multicolor 3MF (discovers colors from source)"
                            >
                              {reRendering ? 'Rendering...' : 'Re-render Multicolor'}
                            </button>
                          </div>
                          {reRenderError && (
                            <div className="build-plate-rerender-error">
                              Re-render failed: {reRenderError}
                              <button onClick={() => setReRenderError(null)}>Dismiss</button>
                            </div>
                          )}
                        </div>
                      )}

                    {/* Object settings: transform + overrides + tabbed print settings */}
                    <BuildPlateObjectSettings
                      object={plate.selectedObject}
                      plateProfile={plate.plateProfile}
                      onUpdateOverrides={handleObjectOverrideChange}
                      onClearOverrides={handleClearObjectOverrides}
                      onResetField={handleResetField}
                      onUpdateTransform={plate.updateObjectTransform}
                      onSetExtruder={plate.setExtruderAssignment}
                      onSetVolumeExtruder={plate.setVolumeExtruder}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Plate Settings mode */}
            {sidebarMode === 'plate-settings' && (
              <div className="build-plate-sidebar-content">
                <div className="build-plate-plate-settings">
                  <div className="build-plate-settings-tabs">
                    <div className="build-plate-settings-tab-bar">
                      {(['plate', 'prime tower', 'flush', 'quality', 'walls', 'infill', 'speed', 'support', 'adhesion', 'advanced'] as const).map((tab) => {
                        // Check if any per-object overrides exist for fields in this tab
                        const tabHasOverrides = tab !== 'plate' && tab !== 'prime tower' && tab !== 'flush' &&
                          fieldsWithObjectOverrides.size > 0 &&
                          hasTabOverrides(tab, fieldsWithObjectOverrides);
                        return (
                          <button
                            key={tab}
                            className={`build-plate-settings-tab ${plateSettingsTab === tab ? 'build-plate-settings-tab--active' : ''}`}
                            onClick={() => setPlateSettingsTab(tab)}
                          >
                            {tab.charAt(0).toUpperCase() + tab.slice(1)}
                            {tabHasOverrides && (
                              <span className="build-plate-override-warning" title="Some objects override settings in this tab">
                                &#9888;
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <div className="build-plate-settings-tab-content">
                      {plateSettingsTab === 'plate' && (
                        <div className="build-plate-tab-plate">
                          <div className="build-plate-transform-section">
                            <h4>Print Sequence</h4>
                            <select
                              value={plate.printSequence}
                              onChange={(e) =>
                                plate.setPrintSequence(e.target.value as 'by_layer' | 'by_object')
                              }
                            >
                              <option value="by_layer">By Layer</option>
                              <option value="by_object">By Object</option>
                            </select>
                          </div>
                          <div className="build-plate-transform-section">
                            <h4>Bed Info</h4>
                            <p className="build-plate-override-hint">
                              {bedWidth} &times; {bedDepth} mm, max height {maxHeight} mm
                              {originCenter ? ', center origin' : ''}
                            </p>
                          </div>
                        </div>
                      )}
                      {plateSettingsTab === 'prime tower' && (
                        <BuildPlatePrimeTower
                          config={plate.primeTower}
                          onChange={plate.setPrimeTower}
                          objects={plate.objects}
                          bedWidth={bedWidth}
                          bedDepth={bedDepth}
                          flushVolumeConfig={plate.flushVolumeConfig}
                          defaultFlushVolume={plate.plateProfile.flushVolume}
                          layerHeight={plate.plateProfile.layerHeight}
                          lineWidth={plate.plateProfile.lineWidth}
                          extruderCount={extruderCount}
                        />
                      )}
                      {plateSettingsTab === 'flush' && (
                        <BuildPlateFlushVolumes
                          config={plate.flushVolumeConfig}
                          onChange={plate.setFlushVolumeConfig}
                          objects={plate.objects}
                          defaultFlushVolume={plate.plateProfile.flushVolume}
                        />
                      )}
                      {plateSettingsTab === 'quality' && (
                        <QualityTab
                          profile={plate.plateProfile}
                          onChange={handlePlateProfileChange}
                          perObjectOverrides={fieldsWithObjectOverrides}
                        />
                      )}
                      {plateSettingsTab === 'walls' && (
                        <WallsTab
                          profile={plate.plateProfile}
                          onChange={handlePlateProfileChange}
                          perObjectOverrides={fieldsWithObjectOverrides}
                        />
                      )}
                      {plateSettingsTab === 'infill' && (
                        <InfillTab
                          profile={plate.plateProfile}
                          onChange={handlePlateProfileChange}
                          perObjectOverrides={fieldsWithObjectOverrides}
                        />
                      )}
                      {plateSettingsTab === 'speed' && (
                        <SpeedTab
                          profile={plate.plateProfile}
                          onChange={handlePlateProfileChange}
                          perObjectOverrides={fieldsWithObjectOverrides}
                        />
                      )}
                      {plateSettingsTab === 'support' && (
                        <SupportTab
                          profile={plate.plateProfile}
                          onChange={handlePlateProfileChange}
                          perObjectOverrides={fieldsWithObjectOverrides}
                        />
                      )}
                      {plateSettingsTab === 'adhesion' && (
                        <AdhesionTab
                          profile={plate.plateProfile}
                          onChange={handlePlateProfileChange}
                          perObjectOverrides={fieldsWithObjectOverrides}
                        />
                      )}
                      {plateSettingsTab === 'advanced' && (
                        <AdvancedTab
                          profile={plate.plateProfile}
                          onChange={handlePlateProfileChange}
                          perObjectOverrides={fieldsWithObjectOverrides}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Center: toolbar + canvas */}
          <div className="build-plate-center">
            {/* Toolbar */}
            <div className="build-plate-toolbar">
              <div className="build-plate-toolbar-group">
                <button className="build-plate-btn" onClick={handleAddSTL} title="Add STL file">
                  + STL
                </button>
                <button className="build-plate-btn" onClick={handleAdd3MF} title="Add 3MF file">
                  + 3MF
                </button>
                <button
                  className="build-plate-btn"
                  onClick={handleOpenScadPicker}
                  disabled={!openscad || scadRendering || scadPickerLoading}
                  title={openscad ? 'Add SCAD example file' : 'OpenSCAD WASM not loaded'}
                >
                  {scadPickerLoading ? 'Loading...' : '+ SCAD'}
                </button>
                <button
                  className="build-plate-btn"
                  onClick={() => setShowArrayCopy((prev) => !prev)}
                  disabled={!plate.selectedObjectId}
                  title="Create grid array of copies"
                >
                  Array
                </button>
                <button className="build-plate-btn" onClick={plate.autoArrange} title="Auto-arrange objects">
                  Arrange
                </button>
                <button
                  className="build-plate-btn"
                  onClick={plate.undo}
                  disabled={!plate.canUndo}
                  title="Undo (Ctrl+Z)"
                >
                  Undo
                </button>
                <button
                  className="build-plate-btn"
                  onClick={plate.redo}
                  disabled={!plate.canRedo}
                  title="Redo (Ctrl+Shift+Z)"
                >
                  Redo
                </button>
                <button
                  className={`build-plate-btn ${gridSnap ? 'build-plate-btn--active' : ''}`}
                  onClick={handleToggleGridSnap}
                  title="Toggle grid snapping"
                >
                  Snap
                </button>
                <button
                  className={`build-plate-btn ${plate.printSequence === 'by_object' ? 'build-plate-btn--active' : ''}`}
                  onClick={handleTogglePrintSequence}
                  title={`Print sequence: ${plate.printSequence === 'by_layer' ? 'by layer' : 'by object'}`}
                >
                  {plate.printSequence === 'by_layer' ? 'By Layer' : 'By Object'}
                </button>
              </div>
              <div className="build-plate-toolbar-group build-plate-toolbar-right">
                <button
                  className="build-plate-btn build-plate-btn--primary"
                  disabled={plate.objects.length === 0 || slicer.status === 'slicing'}
                  onClick={handleSlicePlate}
                  title="Slice all objects on the plate"
                >
                  {slicer.status === 'slicing' ? 'Slicing...' : 'Slice Plate'}
                </button>
              </div>
            </div>

            {/* Array copy popover */}
            {showArrayCopy && plate.selectedObjectId && (
              <div className="build-plate-array-popover">
                <label>
                  Rows: <input type="number" min={1} max={20} value={arrayCopyRows}
                    onChange={(e) => setArrayCopyRows(Math.max(1, parseInt(e.target.value) || 1))} />
                </label>
                <label>
                  Cols: <input type="number" min={1} max={20} value={arrayCopyCols}
                    onChange={(e) => setArrayCopyCols(Math.max(1, parseInt(e.target.value) || 1))} />
                </label>
                <label>
                  Spacing (mm): <input type="number" min={0} max={200} value={arrayCopySpacing}
                    onChange={(e) => setArrayCopySpacing(Math.max(0, parseFloat(e.target.value) || 0))} />
                </label>
                <div className="build-plate-array-popover-actions">
                  <button className="build-plate-btn build-plate-btn--primary" onClick={handleArrayCopy}>
                    Create {arrayCopyRows * arrayCopyCols - 1} copies
                  </button>
                  <button className="build-plate-btn" onClick={() => setShowArrayCopy(false)}>Cancel</button>
                </div>
              </div>
            )}

            {/* SCAD file picker dialog */}
            {showScadPicker && (
              <div className="build-plate-scad-picker-overlay" onClick={() => setShowScadPicker(false)}>
                <div className="build-plate-scad-picker" onClick={(e) => e.stopPropagation()}>
                  <h3>Add SCAD Example</h3>
                  <label className="build-plate-scad-multicolor-toggle">
                    <input
                      type="checkbox"
                      checked={scadPickerMulticolor}
                      onChange={(e) => setScadPickerMulticolor(e.target.checked)}
                    />
                    Multi-color (extract colors from source)
                  </label>
                  <div className="build-plate-scad-picker-list">
                    {scadPickerExamples.map((ex) => (
                      <button
                        key={ex.path}
                        className="build-plate-scad-picker-item"
                        onClick={() => handleScadPickerSelect(ex.path, ex.name, scadPickerMulticolor)}
                      >
                        {ex.name}
                      </button>
                    ))}
                  </div>
                  <button className="build-plate-btn" onClick={() => setShowScadPicker(false)}>Cancel</button>
                </div>
              </div>
            )}

            {/* WASM performance warning */}
            {showWasmWarning && (
              <div className="build-plate-scad-picker-overlay" onClick={() => setShowWasmWarning(false)}>
                <div className="build-plate-scad-picker" onClick={(e) => e.stopPropagation()}>
                  <h3>Slicing Performance Warning</h3>
                  <p style={{ margin: '0.5rem 0 1rem', lineHeight: 1.5, color: '#ccc' }}>
                    WASM slicing in the browser is <strong>extremely slow</strong> compared to native slicing.
                    For significantly better performance, consider using the Android app or a desktop slicer.
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button className="build-plate-btn" onClick={() => setShowWasmWarning(false)}>Cancel</button>
                    <button
                      className="build-plate-btn build-plate-btn--primary"
                      onClick={() => {
                        setShowWasmWarning(false);
                        void doSlicePlate();
                      }}
                    >
                      Slice Anyway
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 3D Canvas */}
            <div
              className={`build-plate-canvas-container ${isDragOver ? 'build-plate-canvas-container--drag-over' : ''}`}
              ref={canvasContainerRef}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {isDragOver && (
                <div className="build-plate-drop-overlay">
                  Drop STL or 3MF files here
                </div>
              )}
              {scadRendering && (
                <div className="build-plate-rendering-overlay">
                  Rendering SCAD...
                </div>
              )}
              {scadError && (
                <div className="build-plate-scad-error">
                  SCAD error: {scadError}
                  <button onClick={() => setScadError(null)}>Dismiss</button>
                </div>
              )}
              {validationErrors.length > 0 && (
                <div className="build-plate-validation-errors">
                  {validationErrors.map((err, i) => (
                    <div key={i} className="build-plate-validation-error">{err}</div>
                  ))}
                  <button onClick={() => setValidationErrors([])}>Dismiss</button>
                </div>
              )}
              {sliceError && (
                <div className="build-plate-scad-error">
                  Slice error: {sliceError}
                  <button onClick={() => setSliceError(null)}>Dismiss</button>
                </div>
              )}
              {slicer.status === 'slicing' && slicer.progress && (
                <div className="build-plate-slice-progress">
                  <div className="build-plate-slice-progress-label">
                    {slicer.progress.stage === 'parsing' && 'Loading models...'}
                    {slicer.progress.stage === 'slicing' && 'Slicing...'}
                    {slicer.progress.stage === 'exporting' && 'Exporting GCode...'}
                    {slicer.progress.stage === 'preparing' && 'Preparing...'}
                  </div>
                  <div className="build-plate-slice-progress-bar">
                    <div
                      className="build-plate-slice-progress-fill"
                      style={{ width: `${Math.round(slicer.progress.progress * 100)}%` }}
                    />
                  </div>
                  <button className="build-plate-btn" onClick={slicer.cancel}>Cancel</button>
                </div>
              )}
              <BuildPlateCanvas
                objects={plate.objects}
                selectedObjectId={plate.selectedObjectId}
                bedWidth={bedWidth}
                bedDepth={bedDepth}
                maxHeight={maxHeight}
                originCenter={originCenter}
                primeTower={plate.primeTower}
                estimatedTowerDepth={estimatedTowerDepth}
                onSelectObject={handleSelectObject}
                onUpdateTransform={plate.updateObjectTransform}
                onUpdatePrimeTowerPosition={handlePrimeTowerPositionUpdate}
                onObjectContextMenu={handleObjectContextMenu}
                gridSnap={gridSnap}
              />
              {/* Right-click context menu */}
              {contextMenu && (
                <div
                  className="build-plate-context-menu-overlay"
                  onClick={closeContextMenu}
                  onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }}
                >
                  <div
                    className="build-plate-context-menu"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button onClick={() => { handleDuplicate(); closeContextMenu(); }}>Duplicate</button>
                    <button onClick={() => { handleLayFlat(); closeContextMenu(); }}>Lay Flat</button>
                    <button onClick={() => { handleMirror('x'); closeContextMenu(); }}>Mirror X</button>
                    <button onClick={() => { handleMirror('y'); closeContextMenu(); }}>Mirror Y</button>
                    <hr />
                    <button onClick={() => { handleDelete(); closeContextMenu(); }} className="build-plate-context-menu-danger">Delete</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Slice result panel */}
          {sliceResult && (
            <div className="build-plate-slice-result">
              <div className="build-plate-slice-result-header">
                <h4>Slice Result</h4>
                <button className="build-plate-btn" onClick={handleBackFromPreview}>
                  Back
                </button>
              </div>
              <div className="build-plate-slice-stats">
                {sliceResult.printTime != null && (
                  <span>
                    Time: {Math.floor(sliceResult.printTime / 3600)}h{' '}
                    {Math.floor((sliceResult.printTime % 3600) / 60)}m
                  </span>
                )}
                {sliceResult.filamentUsed != null && (
                  <span>Filament: {(sliceResult.filamentUsed / 1000).toFixed(1)}m</span>
                )}
              </div>
              {parsedGCode ? (
                <div className="build-plate-gcode-preview">
                  <GCodePreview
                    parsedGCode={parsedGCode}
                    bedWidth={bedWidth}
                    bedDepth={bedDepth}
                    originCenter={originCenter}
                    nozzleDiameter={printerConfig.config?.nozzleDiameter ?? 0.4}
                    extruderColors={
                      plate.objects.flatMap((o) =>
                        o.colorGroups ? o.colorGroups.map((g) => g.color) : [],
                      ).length > 0
                        ? plate.objects.flatMap((o) =>
                            o.colorGroups ? o.colorGroups.map((g) => g.color) : [],
                          )
                        : ['#dddddd']
                    }
                    sliceStats={sliceResult.stats}
                  />
                </div>
              ) : (
                <div className="build-plate-preview-loading">
                  Parsing GCode... {Math.round(previewProgress * 100)}%
                </div>
              )}
              <div className="build-plate-slice-actions">
                <button
                  className="build-plate-btn build-plate-btn--primary"
                  onClick={handleUploadToPrinter}
                  disabled={uploadStatus === 'uploading'}
                >
                  {uploadStatus === 'uploading' ? 'Uploading...' :
                   uploadStatus === 'done' ? 'Uploaded!' :
                   'Send to Printer'}
                </button>
                {uploadError && (
                  <div className="build-plate-upload-error">Upload failed: {uploadError}</div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
