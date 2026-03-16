// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { ParsedGCode, MoveType } from '../lib/gcode-parser';
import { MOVE_TYPE_COLORS } from '../lib/gcode-parser';

type ColorMode = 'line-type' | 'filament';

interface GCodePreviewProps {
  parsedGCode: ParsedGCode;
  /** Whether to show travel moves. Defaults to false. */
  showTravel?: boolean;
  /** Printer bed width in mm (X axis). Defaults to 200. */
  bedWidth?: number;
  /** Printer bed depth in mm (Y axis). Defaults to 200. */
  bedDepth?: number;
  /** Whether the printer origin is at bed center. Defaults to false (origin at corner). */
  originCenter?: boolean;
  /** Nozzle diameter in mm — used for line width. Defaults to 0.4. */
  nozzleDiameter?: number;
  /** Per-extruder colors for filament color mode. Index = extruder number. Defaults to ['#dddddd']. */
  extruderColors?: string[];
  /** Called when user clicks back */
  onBack?: () => void;
}

/** Convert hex color string to THREE.Color */
function hexToColor(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

/** Move types that are extrusion (not travel) */
const EXTRUSION_TYPES: MoveType[] = [
  'wall', 'solid-fill', 'infill', 'support', 'brim', 'skirt', 'purge-tower', 'shield', 'other',
];

/**
 * Per-layer index: for each MoveType, the start index and count of position floats
 * in the type's position array, so we can compute draw ranges.
 */
interface LayerIndex {
  extrusion: Map<MoveType, { start: number; count: number }>;
  travel: { start: number; count: number };
}

/**
 * Build all geometry upfront. Returns LineSegments2 per MoveType (fat lines)
 * and a thin-line travel LineSegments, plus per-layer index for draw range.
 *
 * To eliminate gaps at segment joints on curves, each segment's start point
 * is extended backwards along the segment direction by half the nozzle diameter.
 * This creates a slight overlap that fills the gap at joints.
 */
function buildAllGeometries(
  parsedGCode: ParsedGCode,
  nozzleDiameter: number,
): {
  extrusion: Map<MoveType, LineSegments2>;
  travel: THREE.LineSegments;
  layerIndices: LayerIndex[];
  /** Per move-type array of extruder indices (one per line segment instance) */
  extruderIndices: Map<MoveType, Uint8Array>;
} {
  const { layers } = parsedGCode;

  // First pass: count vertices per type
  const typeCounts = new Map<MoveType, number>();
  for (const t of EXTRUSION_TYPES) typeCounts.set(t, 0);
  let travelCount = 0;

  for (const layer of layers) {
    for (const seg of layer.segments) {
      if (seg.type === 'travel') {
        travelCount += 2;
      } else {
        typeCounts.set(seg.type, (typeCounts.get(seg.type) || 0) + 2);
      }
    }
  }

  // Allocate arrays
  const typeArrays = new Map<MoveType, Float32Array>();
  const typeExtruderArrays = new Map<MoveType, Uint8Array>();
  const typeOffsets = new Map<MoveType, number>();
  const typeSegCounts = new Map<MoveType, number>();
  for (const [type, count] of typeCounts.entries()) {
    if (count === 0) continue;
    typeArrays.set(type, new Float32Array(count * 3));
    typeExtruderArrays.set(type, new Uint8Array(count / 2)); // 1 per segment (2 verts each)
    typeOffsets.set(type, 0);
    typeSegCounts.set(type, 0);
  }
  const travelArray = new Float32Array(travelCount * 3);
  let travelOffset = 0;

  // Second pass: fill arrays and build layer indices
  const layerIndices: LayerIndex[] = [];

  for (const layer of layers) {
    const layerExtrusionStarts = new Map<MoveType, number>();
    for (const [type, offset] of typeOffsets.entries()) {
      layerExtrusionStarts.set(type, offset / 3); // vertex index
    }
    const travelStart = travelOffset / 3;

    for (const seg of layer.segments) {
      if (seg.type === 'travel') {
        travelArray[travelOffset++] = seg.x1;
        travelArray[travelOffset++] = seg.z1;  // GCode Z → Three.js Y
        travelArray[travelOffset++] = -seg.y1; // GCode Y → Three.js -Z (match 3MF preview orientation)
        travelArray[travelOffset++] = seg.x2;
        travelArray[travelOffset++] = seg.z2;
        travelArray[travelOffset++] = -seg.y2;
      } else {
        const arr = typeArrays.get(seg.type);
        if (!arr) continue;
        let off = typeOffsets.get(seg.type)!;

        arr[off++] = seg.x1;
        arr[off++] = seg.z1;  // GCode Z → Three.js Y
        arr[off++] = -seg.y1; // GCode Y → Three.js -Z (match 3MF preview orientation)
        arr[off++] = seg.x2;
        arr[off++] = seg.z2;
        arr[off++] = -seg.y2;
        typeOffsets.set(seg.type, off);

        const extArr = typeExtruderArrays.get(seg.type)!;
        const segIdx = typeSegCounts.get(seg.type)!;
        extArr[segIdx] = seg.extruder;
        typeSegCounts.set(seg.type, segIdx + 1);
      }
    }

    // Build layer index
    const extrusionIndex = new Map<MoveType, { start: number; count: number }>();
    for (const [type, startVertex] of layerExtrusionStarts.entries()) {
      const endVertex = typeOffsets.get(type)! / 3;
      if (endVertex > startVertex) {
        extrusionIndex.set(type, { start: startVertex, count: endVertex - startVertex });
      }
    }

    layerIndices.push({
      extrusion: extrusionIndex,
      travel: { start: travelStart, count: travelOffset / 3 - travelStart },
    });
  }

  // Create Three.js objects — fat lines for extrusion
  const extrusionMap = new Map<MoveType, LineSegments2>();
  for (const [type, arr] of typeArrays.entries()) {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(arr);
    const material = new LineMaterial({
      color: hexToColor(MOVE_TYPE_COLORS[type]).getHex(),
      linewidth: nozzleDiameter,
      worldUnits: true,
      dashed: true,
      dashSize: 1e10,  // effectively solid — disables endcap extensions
      gapSize: 0,
    });
    // Patch fragment shader: invert edges for visual depth (works on both light and dark colors)
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        'gl_FragColor = vec4( diffuseColor.rgb, alpha );',
        `// Blend toward inverted color at edges for contrast on any base color
        float edgeFade = smoothstep(0.3, 0.5, norm) * 0.15;
        vec3 inverted = vec3(1.0) - diffuseColor.rgb;
        gl_FragColor = vec4( mix(diffuseColor.rgb, inverted, edgeFade), alpha );`,
      );
    };
    const lineSegs = new LineSegments2(geometry, material);
    lineSegs.computeLineDistances();
    extrusionMap.set(type, lineSegs);
  }

  // Travel: thin standard lines
  const travelGeometry = new THREE.BufferGeometry();
  travelGeometry.setAttribute('position', new THREE.BufferAttribute(travelArray, 3));
  const travelMaterial = new THREE.LineBasicMaterial({
    color: hexToColor(MOVE_TYPE_COLORS.travel),
    transparent: true,
    opacity: 0.3,
  });
  const travelLines = new THREE.LineSegments(travelGeometry, travelMaterial);

  return { extrusion: extrusionMap, travel: travelLines, layerIndices, extruderIndices: typeExtruderArrays };
}

/**
 * Apply layer range. For LineSegments2 (InstancedBufferGeometry), we control
 * visibility by setting geometry.instanceCount. Since layers are stored
 * contiguously and we always show from layer 0, we just need the end of
 * the last visible layer's segments.
 *
 * For travel (standard LineSegments), we use setDrawRange on vertex count.
 */
function applyLayerRange(
  extrusion: Map<MoveType, LineSegments2>,
  travel: THREE.LineSegments,
  layerIndices: LayerIndex[],
  minLayer: number,
  maxLayer: number,
  showTravel: boolean,
) {
  for (const [type, lineSegs] of extrusion.entries()) {
    let maxInstanceEnd = 0;
    for (let i = minLayer; i <= maxLayer; i++) {
      const idx = layerIndices[i]?.extrusion.get(type);
      if (idx) {
        const instanceEnd = (idx.start + idx.count) / 2;
        if (instanceEnd > maxInstanceEnd) maxInstanceEnd = instanceEnd;
      }
    }
    if (maxInstanceEnd > 0) {
      lineSegs.geometry.instanceCount = maxInstanceEnd;
      lineSegs.visible = true;
    } else {
      lineSegs.visible = false;
    }
  }

  // Travel: standard LineSegments — draw range in vertex count
  if (showTravel) {
    let rangeEnd = 0;
    for (let i = minLayer; i <= maxLayer; i++) {
      const idx = layerIndices[i]?.travel;
      if (idx && idx.count > 0) {
        const end = idx.start + idx.count;
        if (end > rangeEnd) rangeEnd = end;
      }
    }
    if (rangeEnd > 0) {
      travel.geometry.setDrawRange(0, rangeEnd);
      travel.visible = true;
    } else {
      travel.visible = false;
    }
  } else {
    travel.visible = false;
  }
}

export function GCodePreview({
  parsedGCode,
  showTravel = false,
  bedWidth = 200,
  bedDepth = 200,
  originCenter = false,
  nozzleDiameter = 0.4,
  extruderColors = ['#dddddd'],
  onBack,
}: GCodePreviewProps) {
  const totalLayers = parsedGCode.layers.length;
  const [maxLayer, setMaxLayer] = useState(totalLayers - 1);
  const isMultiColor = extruderColors.length > 1;
  const [colorMode, setColorMode] = useState<ColorMode>(isMultiColor ? 'filament' : 'line-type');

  // Reset slider when parsedGCode changes
  useEffect(() => {
    setMaxLayer(parsedGCode.layers.length - 1);
  }, [parsedGCode]);

  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animFrameRef = useRef<number>(0);
  const initializedRef = useRef(false);

  // Pre-built geometry refs
  const geometryDataRef = useRef<{
    extrusion: Map<MoveType, LineSegments2>;
    travel: THREE.LineSegments;
    layerIndices: LayerIndex[];
    extruderIndices: Map<MoveType, Uint8Array>;
  } | null>(null);

  // Pre-build all geometry when parsedGCode or nozzle size changes
  const geometryData = useMemo(() => {
    return buildAllGeometries(parsedGCode, nozzleDiameter);
  }, [parsedGCode, nozzleDiameter]);

  // Initialize Three.js scene once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clean up any leftover canvases from React StrictMode double-mount
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 10000);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controlsRef.current = controls;

    // Bed group placeholder
    const gridGroup = new THREE.Group();
    gridGroup.name = 'bed';
    scene.add(gridGroup);

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);

    // Animation loop
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize observer — also updates LineMaterial resolution
    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      // Update LineMaterial resolution for all extrusion line objects
      const gd = geometryDataRef.current;
      if (gd) {
        for (const lineSegs of gd.extrusion.values()) {
          (lineSegs.material as LineMaterial).resolution.set(w, h);
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      initializedRef.current = false;
    };
  }, []);

  // Update bed grid when printer dimensions change
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const bedGroup = scene.getObjectByName('bed') as THREE.Group | undefined;
    if (!bedGroup) return;

    while (bedGroup.children.length > 0) {
      const child = bedGroup.children[0];
      bedGroup.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }

    const gridSize = Math.max(bedWidth, bedDepth);
    const divisionsX = Math.round(bedWidth / 10);
    const divisionsZ = Math.round(bedDepth / 10);

    const bedGeom = new THREE.PlaneGeometry(bedWidth, bedDepth);
    const bedMat = new THREE.MeshBasicMaterial({
      color: 0x222244,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    const bedMesh = new THREE.Mesh(bedGeom, bedMat);
    bedMesh.rotation.x = -Math.PI / 2;

    const grid = new THREE.GridHelper(gridSize, Math.max(divisionsX, divisionsZ), 0x444466, 0x333355);
    grid.scale.set(bedWidth / gridSize, 1, bedDepth / gridSize);

    if (!originCenter) {
      const offsetX = bedWidth / 2;
      const offsetZ = bedDepth / 2;
      grid.position.set(offsetX, 0, offsetZ);
      bedMesh.position.set(offsetX, -0.1, offsetZ);
    } else {
      bedMesh.position.set(0, -0.1, 0);
    }

    const outlinePoints = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(bedWidth, 0, 0),
      new THREE.Vector3(bedWidth, 0, bedDepth),
      new THREE.Vector3(0, 0, bedDepth),
      new THREE.Vector3(0, 0, 0),
    ];
    if (originCenter) {
      const hw = bedWidth / 2, hd = bedDepth / 2;
      outlinePoints[0].set(-hw, 0, -hd);
      outlinePoints[1].set(hw, 0, -hd);
      outlinePoints[2].set(hw, 0, hd);
      outlinePoints[3].set(-hw, 0, hd);
      outlinePoints[4].set(-hw, 0, -hd);
    }
    const outlineGeom = new THREE.BufferGeometry().setFromPoints(outlinePoints);
    const outlineMat = new THREE.LineBasicMaterial({ color: 0x6666aa });
    const outline = new THREE.LineLoop(outlineGeom, outlineMat);

    bedGroup.add(bedMesh);
    bedGroup.add(grid);
    bedGroup.add(outline);
  }, [bedWidth, bedDepth, originCenter]);

  // Fit camera to bounds
  const fitCamera = useCallback(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const { bounds } = parsedGCode;
    const sizeX = bounds.maxX - bounds.minX;
    const sizeY = bounds.maxZ - bounds.minZ;
    const sizeZ = bounds.maxY - bounds.minY;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minZ + bounds.maxZ) / 2;
    const centerZ = -(bounds.minY + bounds.maxY) / 2; // negated to match Y→-Z mapping
    const maxDim = Math.max(sizeX, sizeY, sizeZ, 1);

    const fitDistance = maxDim / (2 * Math.tan((Math.PI * camera.fov) / 360));
    camera.position.set(
      centerX + fitDistance * 0.8,
      centerY + fitDistance * 1.0,
      centerZ + fitDistance * 0.8,
    );
    camera.near = maxDim * 0.001;
    camera.far = maxDim * 100;
    camera.updateProjectionMatrix();
    controls.target.set(centerX, centerY, centerZ);
    controls.update();
  }, [parsedGCode]);

  // Add/remove geometry from scene when parsedGCode changes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Clean up previous geometry
    const prevData = geometryDataRef.current;
    if (prevData) {
      for (const lineSegs of prevData.extrusion.values()) {
        scene.remove(lineSegs);
        lineSegs.geometry.dispose();
        (lineSegs.material as THREE.Material).dispose();
      }
      scene.remove(prevData.travel);
      prevData.travel.geometry.dispose();
      (prevData.travel.material as THREE.Material).dispose();
      geometryDataRef.current = null;
    }

    if (parsedGCode.layers.length === 0) return;

    // Add new geometry to scene, set LineMaterial resolution
    const container = containerRef.current;
    const w = container?.clientWidth || 1;
    const h = container?.clientHeight || 1;
    for (const lineSegs of geometryData.extrusion.values()) {
      const mat = lineSegs.material as LineMaterial;
      mat.resolution.set(w, h);
      scene.add(lineSegs);
    }
    scene.add(geometryData.travel);
    geometryDataRef.current = geometryData;

    // Apply initial draw range
    applyLayerRange(
      geometryData.extrusion,
      geometryData.travel,
      geometryData.layerIndices,
      0,
      parsedGCode.layers.length - 1,
      showTravel,
    );

    // Fit camera on first load only
    if (!initializedRef.current) {
      fitCamera();
      initializedRef.current = true;
    }

    return () => {
      if (geometryDataRef.current) {
        for (const lineSegs of geometryDataRef.current.extrusion.values()) {
          scene.remove(lineSegs);
          lineSegs.geometry.dispose();
          (lineSegs.material as THREE.Material).dispose();
        }
        scene.remove(geometryDataRef.current.travel);
        geometryDataRef.current.travel.geometry.dispose();
        (geometryDataRef.current.travel.material as THREE.Material).dispose();
        geometryDataRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometryData]);

  // Update draw range when layer range or travel visibility changes
  useEffect(() => {
    if (!geometryDataRef.current) return;
    const { extrusion, travel, layerIndices } = geometryDataRef.current;
    const max = Math.min(maxLayer, parsedGCode.layers.length - 1);
    applyLayerRange(extrusion, travel, layerIndices, 0, max, showTravel);
  }, [maxLayer, showTravel, parsedGCode]);

  // Update material colors when colorMode or extruderColors changes
  useEffect(() => {
    const gd = geometryDataRef.current;
    if (!gd) return;

    const isMultiExtruder = extruderColors.length > 1;
    const parsedColors = extruderColors.map((c) => new THREE.Color(c));
    const fallbackColor = parsedColors[0] ?? new THREE.Color('#dddddd');

    for (const [type, lineSegs] of gd.extrusion.entries()) {
      const mat = lineSegs.material as LineMaterial;
      const geom = lineSegs.geometry as LineSegmentsGeometry;

      if (colorMode === 'filament') {
        if (isMultiExtruder) {
          // Per-instance colors from extruder indices
          mat.vertexColors = true;
          mat.color.setHex(0xffffff); // neutral base when using vertex colors
          const extArr = gd.extruderIndices.get(type);
          if (extArr) {
            // 2 vertices per segment, 3 floats per vertex
            const colors = new Float32Array(extArr.length * 6);
            for (let i = 0; i < extArr.length; i++) {
              const c = parsedColors[extArr[i]] ?? fallbackColor;
              colors[i * 6] = c.r;
              colors[i * 6 + 1] = c.g;
              colors[i * 6 + 2] = c.b;
              colors[i * 6 + 3] = c.r;
              colors[i * 6 + 4] = c.g;
              colors[i * 6 + 5] = c.b;
            }
            geom.setColors(colors);
          }
        } else {
          mat.vertexColors = false;
          mat.color.copy(fallbackColor);
        }
      } else {
        mat.vertexColors = false;
        mat.color.set(MOVE_TYPE_COLORS[type]);
      }
      mat.needsUpdate = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode, extruderColors, geometryData]);

  const topZ = totalLayers > 0 && maxLayer < totalLayers
    ? parsedGCode.layers[maxLayer].z
    : 0;

  // Determine which move types are present for the legend
  const presentTypes = useMemo(() => {
    const types = new Set<MoveType>();
    for (const layer of parsedGCode.layers) {
      for (const seg of layer.segments) {
        types.add(seg.type);
      }
    }
    const order: MoveType[] = ['wall', 'solid-fill', 'infill', 'support', 'brim', 'skirt', 'purge-tower', 'shield', 'other'];
    return order.filter((t) => types.has(t));
  }, [parsedGCode]);

  const TYPE_LABELS: Record<MoveType, string> = {
    'wall': 'Walls',
    'solid-fill': 'Solid Fill',
    'infill': 'Infill',
    'support': 'Support',
    'travel': 'Travel',
    'brim': 'Brim',
    'skirt': 'Skirt',
    'purge-tower': 'Purge Tower',
    'shield': 'Shield',
    'other': 'Other',
  };

  // Keyboard handler for layer slider
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (totalLayers <= 1) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMaxLayer((prev) => Math.min(prev + 1, totalLayers - 1));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMaxLayer((prev) => Math.max(prev - 1, 0));
    }
  }, [totalLayers]);

  // Auto-focus the container so keyboard shortcuts work immediately
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    wrapperRef.current?.focus();
  }, []);

  return (
    <div
      className="gcode-preview-container"
      ref={wrapperRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{ outline: 'none' }}
    >
      <div
        className="gcode-preview-3d"
        ref={containerRef}
      />
      {onBack && (
        <button className="gcode-preview-back" onClick={onBack}>
          Back
        </button>
      )}
      <div className="gcode-color-toggle">
        <button
          className={colorMode === 'filament' ? 'active' : ''}
          onClick={() => setColorMode('filament')}
        >
          {extruderColors.map((c, i) => (
            <span key={i} className="gcode-color-swatch" style={{ background: c }} />
          ))}
          Filament
        </button>
        <button
          className={colorMode === 'line-type' ? 'active' : ''}
          onClick={() => setColorMode('line-type')}
        >
          Line Type
        </button>
      </div>
      {colorMode === 'line-type' && presentTypes.length > 0 && (
        <div className="gcode-legend">
          {presentTypes.map((type) => (
            <div key={type} className="gcode-legend-item">
              <span className="gcode-legend-swatch" style={{ background: MOVE_TYPE_COLORS[type] }} />
              <span className="gcode-legend-label">{TYPE_LABELS[type]}</span>
            </div>
          ))}
        </div>
      )}
      {totalLayers > 1 && (
        <div className="gcode-layer-slider">
          <div className="gcode-layer-info">
            <span className="gcode-layer-number">{maxLayer + 1}</span>
            <span className="gcode-layer-z">{topZ.toFixed(2)}mm</span>
          </div>
          <div className="gcode-layer-sliders">
            <input
              type="range"
              className="gcode-layer-range gcode-layer-range-max"
              min={0}
              max={totalLayers - 1}
              value={maxLayer}
              onChange={(e) => setMaxLayer(Number(e.target.value))}
              title="Top layer"
            />
          </div>
          <div className="gcode-layer-total">
            {totalLayers} layers
          </div>
        </div>
      )}
    </div>
  );
}
