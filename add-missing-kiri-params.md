# Task: Add all missing Kiri:Moto parameters to the slicer UI

Add every Kiri:Moto FDM parameter we're not currently exposing. For each one, add it to the correct type (PrintProfile, FilamentProfile/overrides, or PrinterProfile), wire it into `buildProcessSettings()`, add a UI control in PrintDialog, and set the correct default from OrcaSlicer's FlashForge Adventurer 5M profile.

Run one step at a time. After each step, run `npx tsc --noEmit` to check for errors. At the end, run `npx vite build` to verify.

---

## Current state of the codebase

### Files to modify:
- `src/types/print-profile.ts` — PrintProfile type + DEFAULT_PRINT_PROFILE
- `src/hooks/useFilaments.ts` — FilamentProfile interface + GENERIC_PRESETS
- `src/hooks/usePrinterFilamentOverrides.ts` — PrinterFilamentOverride + ResolvedFilamentSettings + resolveFilament()
- `src/components/FilamentManager.tsx` — EMPTY_PROFILE + FilamentForm + handleStartEdit
- `src/data/printer-profiles.ts` — PrintDefaults + FilamentDefaults + ADM5 values
- `src/components/PrintDialog.tsx` — buildProcessSettings() + UI sections

### What we currently pass to Kiri (in buildProcessSettings):
```ts
{
  sliceHeight, firstSliceHeight, sliceLineWidth,
  sliceShells, sliceTopLayers, sliceBottomLayers,
  sliceFillSparse, sliceFillType,
  outputFeedrate, outputSeekrate, firstLayerRate,
  outputTemp, outputBedTemp, firstLayerNozzleTemp, firstLayerBedTemp,
  sliceSupportEnable, sliceSupportAngle, sliceSupportDensity,
  sliceSkirtCount, firstLayerBrim, outputRaft,
  outputFanSpeed, firstLayerFanSpeed,
  outputRetractDist, outputRetractSpeed,
  zHopDistance,
  outputShellMult: 1.0, outputFillMult: 1.0, outputSparseMult: 1.0,
}
```

---

## All Kiri:Moto FDM parameters (complete list)

### Slice parameters
| Kiri param | Description | Default |
|---|---|---|
| `sliceHeight` | Layer height mm | 0.2 |
| `firstSliceHeight` | First layer height mm | 0.2 |
| `sliceLineWidth` | Line width mm | nozzle dia |
| `sliceShells` | Wall count | 2 |
| `sliceTopLayers` | Top solid layers | 5 |
| `sliceBottomLayers` | Bottom solid layers | 3 |
| `sliceFillSparse` | Infill density 0-1 | 0.15 |
| `sliceFillType` | Infill pattern | gyroid |
| `sliceFillAngle` | Infill angle degrees | 45 |
| `sliceFillOverlap` | Infill/wall overlap 0-0.8 | 0.5 (OrcaSlicer ADM5: 50%) |
| `sliceFillRepeat` | Repeat infill pattern count | 1 |
| `sliceShellOrder` | Shell order: "in-out" or "out-in" | "in-out" (OrcaSlicer ADM5: inner wall first) |
| `sliceDetectThin` | Thin wall detection: "basic" or "none" | "none" (OrcaSlicer: detect_overhang_wall=1) |
| `sliceAdaptive` | Adaptive layer height bool | false |
| `sliceMinHeight` | Min layer for adaptive mm | 0.08 |
| `sliceSolidify` | Solidify thin areas | false |
| `sliceLayerStart` | Layer start: "last", "first", "center" | "last" |

### Support parameters
| Kiri param | Description | Default |
|---|---|---|
| `sliceSupportEnable` | Enable supports | false |
| `sliceSupportAngle` | Overhang angle degrees | 30 |
| `sliceSupportDensity` | Support density 0-1 | 0.2 |
| `sliceSupportGap` | Gap layers between support/model | 1 |
| `sliceSupportOffset` | XY offset from model mm | 0.3 (OrcaSlicer ADM5: support_object_xy_distance=0.3) |
| `sliceSupportExtra` | Extra support area mm | 0 |

### Adhesion parameters
| Kiri param | Description | Default |
|---|---|---|
| `sliceSkirtCount` | Skirt loops | 2 |
| `firstLayerBrim` | Brim width mm | 0 |
| `outputRaft` | Enable raft | false |
| `outputRaftSpacing` | Raft-to-model gap mm | 0.3 |

### Output/speed parameters
| Kiri param | Description | Default |
|---|---|---|
| `outputFeedrate` | Print speed mm/s | 250 |
| `outputFinishrate` | Outer wall speed mm/s | 0 (=same as feedrate) |
| `outputSeekrate` | Travel speed mm/s | 500 |
| `outputMinSpeed` | Min speed for cooling mm/s | 20 (OrcaSlicer ADM5: slow_down_min_speed=20) |
| `outputShellMult` | Wall speed multiplier | 1.0 |
| `outputFillMult` | Solid infill speed multiplier | 1.0 |
| `outputSparseMult` | Sparse infill speed multiplier | 1.0 |
| `outputCoastDist` | Coast before retract mm | 0 |
| `outputRetractWipe` | Wipe distance mm | 2 (OrcaSlicer ADM5: wipe_distance=2) |
| `outputRetractDwell` | Retract dwell ms | 0 |
| `outputMinLayerTime` | Min time per layer sec | 6 (OrcaSlicer ADM5 PLA: slow_down_layer_time=6) |
| `outputLayerRetract` | Retract between layers | true |

### First layer parameters
| Kiri param | Description | Default |
|---|---|---|
| `firstLayerRate` | First layer speed mm/s | 50 |
| `firstLayerFillRate` | First layer infill speed mm/s | 80 (OrcaSlicer ADM5: initial_layer_infill_speed=80) |
| `firstLayerNozzleTemp` | First layer nozzle temp °C | =nozzleTemp |
| `firstLayerBedTemp` | First layer bed temp °C | =bedTemp |
| `firstLayerFanSpeed` | First layer fan 0-255 | 0 |

### Temperature/retraction (filament-derived)
| Kiri param | Description | Default |
|---|---|---|
| `outputTemp` | Nozzle temp °C | 220 |
| `outputBedTemp` | Bed temp °C | 55 |
| `outputFanSpeed` | Fan speed 0-255 | 255 |
| `outputRetractDist` | Retract distance mm | 0.8 |
| `outputRetractSpeed` | Retract speed mm/s | 35 |
| `zHopDistance` | Z-hop mm | 0.4 |

### Arc fitting
| Kiri param | Description | Default |
|---|---|---|
| `fdmArcEnabled` | Enable G2/G3 arcs | false |

---

## OrcaSlicer FlashForge ADM5 resolved values

### Machine (fdm_adventurer5m_common → fdm_flashforge_common → fdm_machine_common)
- Build: 220x220x220mm, center origin
- Max speed XY: 600mm/s, Z: 20mm/s
- Max accel XY: 20000mm/s², Z: 500mm/s²
- Max jerk XY: 9mm/s, Z: 3mm/s
- GCode: klipper
- Retraction: 0.8mm @ 35mm/s, deretract 35mm/s
- Z-hop: 0.4mm (Auto Lift)
- Wipe distance: 2mm, retract before wipe: 100%

### Process (0.20mm Standard → fdm_process_flashforge_0.20 → fdm_process_flashforge_common → fdm_process_common)
- Layer: 0.2mm, line width: 0.42mm
- Shells: 2, top: 5, bottom: 3
- Infill: 15% crosshatch (mapped to our "grid"), fill overlap: 50%
- Wall order: inner wall/outer wall (inner first)
- Outer wall speed: 200mm/s, inner wall: 300mm/s
- Sparse infill: 270mm/s, solid infill: 250mm/s
- Top surface: 200mm/s
- Travel: 500mm/s
- First layer: 50mm/s, first layer infill: 80mm/s
- Support angle: 30°, support speed: 150mm/s
- Support XY offset: 0.3mm, support Z gap: 0.18mm
- Outer wall accel: 5000mm/s², inner wall: 5000mm/s²
- Top surface accel: 2000mm/s², initial layer accel: 500mm/s²
- Travel accel: 10000mm/s², solid infill accel: 7000mm/s²
- Default accel: 10000mm/s²
- Elephant foot compensation: 0.15mm
- Brim gap: 0.1mm
- Skirt: 0 loops (OrcaSlicer ADM5 disables skirt by default)

### Filament — PLA (Flashforge Generic PLA → fdm_filament_pla → fdm_filament_common)
- Nozzle: 220°C (initial layer same)
- Bed: 55°C initial layer, 50°C after (hot plate)
- Fan: 100%, first layer fan off (close_fan_the_first_x_layers=1)
- Flow ratio: 0.98
- Max volumetric speed: 25mm³/s
- Pressure advance: 0.025
- Slow down layer time: 6s, min speed: 20mm/s

### Filament — PETG (Flashforge Generic PETG → fdm_filament_pet → fdm_filament_common)
- Nozzle: 255°C (initial layer same)
- Bed: 70°C
- Fan: 80-100%, first layer fan off
- Flow ratio: 1.0
- Max volumetric speed: 12mm³/s
- Pressure advance: 0.046
- Slow down layer time: 8s, min speed: 30mm/s

### Filament — TPU (Flashforge Generic TPU → fdm_filament_tpu → fdm_filament_common)
- Nozzle: 225°C
- Bed: 45°C
- Fan: 100%, first layer fan off
- Flow ratio: 1.0
- Max volumetric speed: 3.5mm³/s
- Retraction: 1.2mm (override)
- Pressure advance: 0.035
- Slow down layer time: 8s, min speed: 20mm/s

### Filament — ASA (Flashforge Generic ASA → fdm_filament_asa → fdm_filament_common)
- Nozzle: 260°C
- Bed: 105°C
- Fan: 10-20%, first layer fan off (close_fan_the_first_x_layers=2)
- Flow ratio: 0.98
- Max volumetric speed: 18mm³/s
- Pressure advance: 0.04
- Slow down layer time: 5s, min speed: 20mm/s

### Filament — ABS (Flashforge Generic ABS → fdm_filament_abs → fdm_filament_common)
- Nozzle: 260°C (OrcaSlicer base is 265 but FF overrides are not explicit, inherits)
- Bed: 105°C
- Fan: 10-20% (from base fdm_filament_abs), first layer fan off
- Flow ratio: 0.98
- Max volumetric speed: 15mm³/s
- Pressure advance: 0.04
- Slow down layer time: 8s, min speed: 20mm/s

---

## What to add (grouped by where it belongs)

### 1. PrintProfile (print-agnostic, saved per printer address)

Add to `PrintProfile` interface and `DEFAULT_PRINT_PROFILE`:

```ts
// Infill
infillAngle: number;         // degrees, default 45
infillOverlap: number;       // 0-1, default 0.5
// Walls
shellOrder: 'in-out' | 'out-in';  // default 'in-out'
// Speed
outerWallSpeed: number;      // mm/s, 0 = same as print speed. ADM5: 200
firstLayerFillSpeed: number; // mm/s. ADM5: 80
minLayerTime: number;        // seconds. ADM5: 6
// Cooling
minSpeed: number;            // mm/s for min-layer-time slowdown. ADM5: 20
// Retraction
coastDist: number;           // mm. default 0
wipeDistance: number;         // mm. ADM5: 2
retractOnLayerChange: boolean; // default true
// Support
supportXYOffset: number;     // mm. ADM5: 0.3
supportZGap: number;         // layers. ADM5: 1
// Arc
arcEnabled: boolean;         // default false
```

### 2. FilamentDefaults / FilamentProfile (filament-dependent)

Add to `FilamentProfile` interface, `GENERIC_PRESETS`, `FilamentDefaults`, `PrinterFilamentOverride`, `ResolvedFilamentSettings`:

```ts
firstLayerNozzleTemp: number;  // °C, often = nozzleTemp but can differ
firstLayerBedTemp: number;     // °C, often = bedTemp but can differ (PLA: 55 initial, 50 after)
minSpeed: number;              // mm/s for cooling slowdown per-filament. ADM5 PLA: 20
minLayerTime: number;          // seconds per-filament. ADM5 PLA: 6
```

Wait — `minSpeed` and `minLayerTime` are really per-filament in OrcaSlicer (slow_down_min_speed, slow_down_layer_time vary by material). Move them to filament.

### 3. PrintDefaults in printer-profiles.ts

Add corresponding fields and ADM5 values.

### 4. buildProcessSettings

Add all new fields to the Kiri mapping:
```ts
sliceFillAngle: p.infillAngle,
sliceFillOverlap: p.infillOverlap,
sliceShellOrder: p.shellOrder,
outputFinishrate: p.outerWallSpeed,
firstLayerFillRate: p.firstLayerFillSpeed,
outputCoastDist: p.coastDist,
outputRetractWipe: p.wipeDistance,
outputLayerRetract: p.retractOnLayerChange,
sliceSupportOffset: p.supportXYOffset,
sliceSupportGap: p.supportZGap,
fdmArcEnabled: p.arcEnabled,
firstLayerNozzleTemp: f.firstLayerNozzleTemp,
firstLayerBedTemp: f.firstLayerBedTemp,
outputMinSpeed: f.minSpeed,
outputMinLayerTime: f.minLayerTime,
```

### 5. UI — add controls to PrintDialog sections

- **Infill tab**: infillAngle input, infillOverlap slider
- **Walls tab**: shellOrder select (In→Out / Out→In)
- **Speed tab**: outerWallSpeed input, firstLayerFillSpeed input
- **Temperature tab**: firstLayerNozzleTemp, firstLayerBedTemp (overridable from filament)
- **Retraction tab**: coastDist, wipeDistance, retractOnLayerChange checkbox
- **Support tab** (when enabled): supportXYOffset, supportZGap
- **Fan tab**: minSpeed, minLayerTime (overridable from filament)
- **New "Advanced" tab**: arcEnabled checkbox

---

## ADM5 defaults summary for new fields

| Field | ADM5 value |
|---|---|
| infillAngle | 45 |
| infillOverlap | 0.5 |
| shellOrder | 'in-out' |
| outerWallSpeed | 200 |
| firstLayerFillSpeed | 80 |
| coastDist | 0 |
| wipeDistance | 2 |
| retractOnLayerChange | true |
| supportXYOffset | 0.3 |
| supportZGap | 1 |
| arcEnabled | false |
| PLA firstLayerNozzleTemp | 220 |
| PLA firstLayerBedTemp | 55 |
| PLA minSpeed | 20 |
| PLA minLayerTime | 6 |
| PETG firstLayerNozzleTemp | 255 |
| PETG firstLayerBedTemp | 70 |
| PETG minSpeed | 30 |
| PETG minLayerTime | 8 |
| TPU firstLayerNozzleTemp | 225 |
| TPU firstLayerBedTemp | 45 |
| TPU minSpeed | 20 |
| TPU minLayerTime | 8 |
| ASA firstLayerNozzleTemp | 260 |
| ASA firstLayerBedTemp | 105 |
| ASA minSpeed | 20 |
| ASA minLayerTime | 5 |
| ABS firstLayerNozzleTemp | 260 |
| ABS firstLayerBedTemp | 105 |
| ABS minSpeed | 20 |
| ABS minLayerTime | 8 |
