/**
 * Slicer settings builders — extracted from PrintDialog for testability.
 *
 * Converts our PrintProfile + ResolvedFilamentSettings into the
 * Record<string, unknown> objects that Kiri:Moto expects via
 * engine.setProcess() and engine.setDevice().
 */

import type { PrintProfile } from '../types/print-profile';
import type { ResolvedFilamentSettings } from '../hooks/usePrinterFilamentOverrides';
import type { FilamentProfile } from '../hooks/useFilaments';
import type { PrinterConfig } from './moonraker-api';

/** Printer-owned settings (from Moonraker, overridable in dialog) */
export interface PrinterSettings {
  bedWidth: number;
  bedDepth: number;
  maxHeight: number;
  originCenter: boolean;
  startGcode: string;
  endGcode: string;
  toolChangeGcode: string;
}

/**
 * Replace common PrusaSlicer/OrcaSlicer variable syntax with Kiri:Moto equivalents.
 * e.g. {first_layer_bed_temperature[0]} → {bed_temp}
 */
export function migrateGcodeVars(gcode: string): string {
  return gcode
    .replace(/\{first_layer_bed_temperature\[\d+\]\}/g, '{bed_temp}')
    .replace(/\{first_layer_temperature\[\d+\]\}/g, '{temp}')
    .replace(/\{bed_temperature\[\d+\]\}/g, '{bed_temp}')
    .replace(/\{temperature\[\d+\]\}/g, '{temp}');
}

/** Build Kiri:Moto process settings from profile + filament */
export function buildProcessSettings(
  p: PrintProfile,
  f: ResolvedFilamentSettings,
): Record<string, unknown> {
  return {
    sliceHeight: p.layerHeight,
    firstSliceHeight: p.firstLayerHeight,
    sliceLineWidth: p.lineWidth,
    sliceShells: p.shellCount,
    sliceTopLayers: p.topLayers,
    sliceBottomLayers: p.bottomLayers,
    sliceShellOrder: p.shellOrder,
    sliceFillSparse: p.infillDensity,
    sliceFillType: p.infillPattern,
    sliceFillAngle: p.infillAngle,
    sliceFillOverlap: p.infillOverlap,
    outputFeedrate: f.printSpeed,
    outputFinishrate: p.outerWallSpeed,
    outputSeekrate: p.travelSpeed,
    firstLayerRate: p.firstLayerSpeed,
    firstLayerFillRate: p.firstLayerFillSpeed,
    outputTemp: f.nozzleTemp,
    outputBedTemp: f.bedTemp,
    firstLayerNozzleTemp: f.firstLayerNozzleTemp,
    firstLayerBedTemp: f.firstLayerBedTemp,
    outputMinSpeed: f.minSpeed,
    outputMinLayerTime: f.minLayerTime,
    sliceSupportEnable: p.supportEnabled,
    sliceSupportAngle: p.supportAngle,
    sliceSupportDensity: p.supportDensity,
    sliceSupportOffset: p.supportXYOffset,
    sliceSupportGap: p.supportZGap,
    sliceSkirtCount: p.adhesionType === 'skirt' ? p.skirtCount : 0,
    firstLayerBrim: p.adhesionType === 'brim' ? p.brimWidth : 0,
    outputRaft: p.adhesionType === 'raft',
    outputFanSpeed: Math.round(f.fanSpeed * 2.55), // 0-100 → 0-255
    outputFanLayer: 1, // fan activates starting at layer 1 (second layer)
    firstLayerFanSpeed: Math.round(f.firstLayerFan * 2.55),
    outputRetractDist: f.retractDist,
    outputRetractSpeed: f.retractSpeed,
    outputCoastDist: p.coastDist,
    outputRetractWipe: p.wipeDistance,
    outputLayerRetract: p.retractOnLayerChange,
    zHopDistance: p.zHopHeight,
    fdmArcEnabled: p.arcEnabled,
    outputShellMult: 1.0,
    outputFillMult: 1.0,
    outputSparseMult: 1.0,
  };
}

/** Build Kiri:Moto device settings from printer config */
export function buildDeviceSettings(
  pc: PrinterConfig | null,
  ps: PrinterSettings,
  extruderCount: number,
  getFilamentForExtruder?: (index: number, filaments: FilamentProfile[]) => FilamentProfile,
  filaments?: FilamentProfile[],
): Record<string, unknown> {
  const device: Record<string, unknown> = {};
  device.bedWidth = ps.bedWidth;
  device.bedDepth = ps.bedDepth;
  device.maxHeight = ps.maxHeight;
  device.originCenter = ps.originCenter;
  if (pc) {
    device.bedRound = pc.bedCircular;
  }
  if (ps.startGcode) {
    device.gcodePre = migrateGcodeVars(ps.startGcode).split('\n').filter((l) => l.trim());
  }
  if (ps.endGcode) {
    device.gcodePost = migrateGcodeVars(ps.endGcode).split('\n').filter((l) => l.trim());
  }
  if (ps.toolChangeGcode) {
    device.gcodeChange = ps.toolChangeGcode.split('\n').filter((l) => l.trim());
  }
  // Fan control gcode — Kiri doesn't emit M106/M107 without this
  device.gcodeFan = ['M106 S{fan_speed}'];
  // Layer change comment
  device.gcodeLayer = [';LAYER:{layer}'];
  const nozzle = pc?.nozzleDiameter ?? 0.4;
  const filament = pc?.filamentDiameter ?? 1.75;
  if (extruderCount > 1 && getFilamentForExtruder && filaments) {
    const extruders: Record<string, unknown>[] = [];
    for (let i = 0; i < extruderCount; i++) {
      const fil = getFilamentForExtruder(i, filaments);
      extruders.push({
        extNozzle: nozzle,
        extFilament: filament,
        extOffsetX: 0,
        extOffsetY: 0,
        extSelect: [`T${i}`],
        extDeselect: [],
        extTemp: fil.nozzleTemp,
      });
    }
    device.extruders = extruders;
  } else {
    device.extruders = [{
      extNozzle: nozzle,
      extFilament: filament,
      extOffsetX: 0,
      extOffsetY: 0,
      extSelect: ['T0'],
      extDeselect: [],
    }];
  }
  return device;
}
