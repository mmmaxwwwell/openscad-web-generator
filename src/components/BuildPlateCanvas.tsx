// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BuildPlateObject, PrimeTowerConfig } from '../types/build-plate';
import { extractColorMeshes } from '../lib/merge-3mf';

// ============================================================
// Types
// ============================================================

export interface BuildPlateCanvasProps {
  objects: BuildPlateObject[];
  selectedObjectId: string | null;
  bedWidth: number;
  bedDepth: number;
  maxHeight: number;
  originCenter: boolean;
  primeTower: PrimeTowerConfig;
  /** Estimated tower depth in mm (Y dimension), computed from flush volumes */
  estimatedTowerDepth?: number;
  onSelectObject: (id: string | null) => void;
  onUpdateTransform: (id: string, transform: { position?: { x: number; y: number }; rotation?: number; scale?: { x: number; y: number; z: number } }) => void;
  /** Callback when the prime tower is dragged to a new position */
  onUpdatePrimeTowerPosition?: (position: { x: number; y: number }) => void;
  /** Enable grid snapping for position (1mm) and rotation (15°) */
  gridSnap?: boolean;
}

/** Cache entry for parsed mesh geometry */
interface GeometryCache {
  /** Key: hash of meshData byteLength + first/last bytes (fast fingerprint) */
  key: string;
  /** The parsed Three.js group (cloned for each instance) */
  group: THREE.Group;
}

// ============================================================
// Helpers
// ============================================================

const SELECTION_COLOR = 0x00aaff;
const DEFAULT_MODEL_COLOR = 0x4a90d9;
const BED_COLOR = 0x333333;
const BED_LINE_COLOR = 0x555555;
const BED_BORDER_COLOR = 0x888888;
const PRIME_TOWER_COLOR = 0x3366cc;
const ORIGIN_ARROW_LENGTH = 20;
const ROTATION_HANDLE_COLOR = 0x00ff88;
const SCALE_HANDLE_COLOR = 0xff6644;
const HANDLE_CUBE_SIZE = 5; // mm — scale handle cube side length
const ROTATION_HANDLE_TUBE = 2.5; // mm — torus tube radius (touch target)
const POSITION_SNAP_MM = 1;
const ROTATION_SNAP_DEG = 15;

type InteractionMode = 'none' | 'drag' | 'rotate' | 'scale' | 'drag-prime-tower';

/** Snap a value to the nearest multiple of step */
function snapValue(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** Fast fingerprint for an ArrayBuffer — not cryptographic, just for change detection */
function meshFingerprint(data: ArrayBuffer): string {
  const view = new Uint8Array(data);
  const len = view.length;
  if (len === 0) return '0';
  // Use length + first 8 + last 8 bytes
  const head = Array.from(view.slice(0, 8)).join(',');
  const tail = Array.from(view.slice(Math.max(0, len - 8))).join(',');
  return `${len}:${head}:${tail}`;
}

/** Parse mesh data into a Three.js group, using colorGroups for multi-color 3MF */
function parseMeshData(
  data: ArrayBuffer,
  format: 'stl' | '3mf',
  colorGroups?: Array<{ color: string; name?: string }>,
): THREE.Group {
  const group = new THREE.Group();

  if (format === 'stl') {
    const loader = new STLLoader();
    const geometry = loader.parse(data.slice(0)); // clone buffer for safety
    const material = new THREE.MeshPhongMaterial({
      color: DEFAULT_MODEL_COLOR,
      specular: 0x222222,
      shininess: 40,
    });
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
  } else {
    // For multi-color 3MF with colorGroups, extract per-color meshes and render each
    // with its own color material instead of using ThreeMFLoader (which loses color info)
    if (colorGroups && colorGroups.length > 1) {
      const colorMeshes = extractColorMeshes(data);
      if (colorMeshes.length > 0) {
        for (const cm of colorMeshes) {
          if (cm.vertices.length === 0) continue;
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(cm.vertices, 3));
          geometry.computeVertexNormals();
          const material = new THREE.MeshPhongMaterial({
            color: new THREE.Color(cm.colorHex.slice(0, 7)), // strip alpha if present
            specular: 0x222222,
            shininess: 40,
          });
          const mesh = new THREE.Mesh(geometry, material);
          group.add(mesh);
        }
        return group;
      }
      // Fall through to ThreeMFLoader if extraction fails
    }

    const loader = new ThreeMFLoader();
    const parsed = loader.parse(data.slice(0)) as THREE.Group;
    // Move children to our group
    while (parsed.children.length > 0) {
      const child = parsed.children[0];
      parsed.remove(child);
      group.add(child);
    }
    // Apply materials to meshes
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshPhongMaterial;
        if (!mat) {
          child.material = new THREE.MeshPhongMaterial({
            color: DEFAULT_MODEL_COLOR,
            specular: 0x222222,
            shininess: 40,
          });
        } else if (mat.vertexColors) {
          mat.specular = new THREE.Color(0x222222);
          mat.shininess = 40;
        } else if (mat.name === THREE.Loader.DEFAULT_MATERIAL_NAME) {
          mat.color.setHex(DEFAULT_MODEL_COLOR);
          mat.specular = new THREE.Color(0x222222);
          mat.shininess = 40;
        }
      }
    });
  }

  return group;
}

/** Add selection highlight (bright edge outline) to an object group */
function addSelectionHighlight(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const edges = new THREE.EdgesGeometry(child.geometry, 30);
      const lineMat = new THREE.LineBasicMaterial({
        color: SELECTION_COLOR,
        transparent: true,
        opacity: 0.8,
        linewidth: 2,
      });
      const lines = new THREE.LineSegments(edges, lineMat);
      lines.userData.isSelectionHighlight = true;
      child.add(lines);
    }
  });
}

/** Remove selection highlight from an object group */
function removeSelectionHighlight(group: THREE.Group): void {
  const toRemove: THREE.Object3D[] = [];
  group.traverse((child) => {
    if (child.userData.isSelectionHighlight) {
      toRemove.push(child);
    }
  });
  toRemove.forEach((obj) => {
    obj.parent?.remove(obj);
    if (obj instanceof THREE.LineSegments) {
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
  });
}

/** Create bed grid lines */
function createBedGrid(
  bedWidth: number,
  bedDepth: number,
  originCenter: boolean
): THREE.Group {
  const group = new THREE.Group();

  // Grid spacing: 10mm
  const spacing = 10;
  const gridMaterial = new THREE.LineBasicMaterial({ color: BED_LINE_COLOR, transparent: true, opacity: 0.4 });
  const borderMaterial = new THREE.LineBasicMaterial({ color: BED_BORDER_COLOR, transparent: true, opacity: 0.7 });

  // Compute grid bounds in Three.js coords (X right, Z forward/back, Y up)
  // Model space: X right, Y back, Z up → Three.js: X right, Y up, -Z = model Y
  let xMin: number, xMax: number, zMin: number, zMax: number;
  if (originCenter) {
    xMin = -bedWidth / 2;
    xMax = bedWidth / 2;
    zMin = -bedDepth / 2;
    zMax = bedDepth / 2;
  } else {
    xMin = 0;
    xMax = bedWidth;
    zMin = -bedDepth; // model Y=bedDepth maps to Z=-bedDepth in Three.js
    zMax = 0;
  }

  // Grid lines parallel to X axis
  const gridGeometries: THREE.BufferGeometry[] = [];
  for (let z = zMin; z <= zMax + 0.01; z += spacing) {
    const points = [new THREE.Vector3(xMin, 0, z), new THREE.Vector3(xMax, 0, z)];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    gridGeometries.push(geo);
    group.add(new THREE.Line(geo, gridMaterial));
  }

  // Grid lines parallel to Z axis
  for (let x = xMin; x <= xMax + 0.01; x += spacing) {
    const points = [new THREE.Vector3(x, 0, zMin), new THREE.Vector3(x, 0, zMax)];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    gridGeometries.push(geo);
    group.add(new THREE.Line(geo, gridMaterial));
  }

  // Border rectangle
  const borderPoints = [
    new THREE.Vector3(xMin, 0, zMin),
    new THREE.Vector3(xMax, 0, zMin),
    new THREE.Vector3(xMax, 0, zMax),
    new THREE.Vector3(xMin, 0, zMax),
    new THREE.Vector3(xMin, 0, zMin),
  ];
  const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPoints);
  group.add(new THREE.Line(borderGeo, borderMaterial));

  // Bed surface (subtle plane)
  const planeGeo = new THREE.PlaneGeometry(bedWidth, bedDepth);
  const planeMat = new THREE.MeshBasicMaterial({
    color: BED_COLOR,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
  });
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.set((xMin + xMax) / 2, -0.1, (zMin + zMax) / 2);
  plane.userData.isBedPlane = true;
  group.add(plane);

  group.userData.isBed = true;
  return group;
}

/** Create origin indicator arrows (X=red, Y=green) */
function createOriginIndicator(originCenter: boolean): THREE.Group {
  const group = new THREE.Group();

  // Origin position in Three.js coords
  const originX = originCenter ? 0 : 0;
  const originZ = originCenter ? 0 : 0;

  // X axis arrow (red)
  const xDir = new THREE.Vector3(1, 0, 0);
  const xArrow = new THREE.ArrowHelper(xDir, new THREE.Vector3(originX, 0.5, originZ), ORIGIN_ARROW_LENGTH, 0xff0000, 4, 2);
  group.add(xArrow);

  // Y axis arrow (green) — model Y maps to Three.js -Z
  const yDir = new THREE.Vector3(0, 0, -1);
  const yArrow = new THREE.ArrowHelper(yDir, new THREE.Vector3(originX, 0.5, originZ), ORIGIN_ARROW_LENGTH, 0x00ff00, 4, 2);
  group.add(yArrow);

  // Z axis arrow (blue, up)
  const zDir = new THREE.Vector3(0, 1, 0);
  const zArrow = new THREE.ArrowHelper(zDir, new THREE.Vector3(originX, 0.5, originZ), ORIGIN_ARROW_LENGTH * 0.5, 0x0088ff, 4, 2);
  group.add(zArrow);

  return group;
}

/** Create prime tower mesh */
function createPrimeTower(config: PrimeTowerConfig, originCenter: boolean, towerDepth?: number): THREE.Group {
  const group = new THREE.Group();
  if (!config.enabled) return group;

  const height = 200; // visual height, actual depends on print
  const depth = towerDepth && towerDepth > 0 ? towerDepth : config.width;
  const geo = new THREE.BoxGeometry(config.width, height, depth);
  const mat = new THREE.MeshPhongMaterial({
    color: PRIME_TOWER_COLOR,
    transparent: true,
    opacity: 0.3,
    specular: 0x111111,
    shininess: 20,
  });
  const mesh = new THREE.Mesh(geo, mat);

  // Position: model space (x, y) → Three.js (x, y/2 for centering vertically, -y for Z)
  const threeX = originCenter ? config.position.x : config.position.x;
  const threeZ = originCenter ? -config.position.y : -config.position.y;
  mesh.position.set(threeX, height / 2, threeZ);

  // Edge lines
  const edges = new THREE.EdgesGeometry(geo);
  const lineMat = new THREE.LineBasicMaterial({ color: PRIME_TOWER_COLOR, transparent: true, opacity: 0.5 });
  const lines = new THREE.LineSegments(edges, lineMat);
  lines.position.copy(mesh.position);
  group.add(mesh);
  group.add(lines);

  group.userData.isPrimeTower = true;
  return group;
}

/**
 * Convert model-space position to Three.js position.
 * Model: X right, Y back, Z up
 * Three.js: X right, Y up, Z = -modelY
 */
function modelToThree(modelX: number, modelY: number): { x: number; z: number } {
  return { x: modelX, z: -modelY };
}

/** Create rotation and scale handles for the selected object group */
function createHandles(objectGroup: THREE.Group): THREE.Group {
  const handles = new THREE.Group();
  handles.userData.isHandles = true;

  const box = new THREE.Box3().setFromObject(objectGroup);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  // Rotation handle: torus ring above the object, lying flat on XZ plane
  const radius = Math.max(size.x, size.z) / 2 + 12;
  const torusGeo = new THREE.TorusGeometry(radius, ROTATION_HANDLE_TUBE, 8, 48);
  const torusMat = new THREE.MeshBasicMaterial({
    color: ROTATION_HANDLE_COLOR,
    transparent: true,
    opacity: 0.5,
  });
  const torus = new THREE.Mesh(torusGeo, torusMat);
  torus.rotation.x = Math.PI / 2; // lay flat on XZ plane
  torus.position.set(center.x, box.max.y + 6, center.z);
  torus.userData.isRotationHandle = true;
  handles.add(torus);

  // Scale handles: small cubes at the 4 corners of the bounding box on the bed plane
  const handleGeo = new THREE.BoxGeometry(HANDLE_CUBE_SIZE, HANDLE_CUBE_SIZE, HANDLE_CUBE_SIZE);
  const handleMat = new THREE.MeshBasicMaterial({ color: SCALE_HANDLE_COLOR });
  const corners = [
    new THREE.Vector3(box.min.x, 0, box.min.z),
    new THREE.Vector3(box.max.x, 0, box.min.z),
    new THREE.Vector3(box.min.x, 0, box.max.z),
    new THREE.Vector3(box.max.x, 0, box.max.z),
  ];
  for (const corner of corners) {
    const cube = new THREE.Mesh(handleGeo.clone(), handleMat.clone());
    cube.position.set(corner.x, HANDLE_CUBE_SIZE / 2, corner.z);
    cube.userData.isScaleHandle = true;
    handles.add(cube);
  }

  return handles;
}

// ============================================================
// Component
// ============================================================

export function BuildPlateCanvas({
  objects,
  selectedObjectId,
  bedWidth,
  bedDepth,
  maxHeight: _maxHeight,
  originCenter,
  primeTower,
  estimatedTowerDepth,
  onSelectObject,
  onUpdateTransform,
  onUpdatePrimeTowerPosition,
  gridSnap = false,
}: BuildPlateCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animFrameRef = useRef<number>(0);

  // Object groups in the scene, keyed by object ID
  const objectGroupsRef = useRef<Map<string, THREE.Group>>(new Map());
  // Geometry cache: fingerprint → parsed group (to avoid re-parsing unchanged meshes)
  const geometryCacheRef = useRef<Map<string, GeometryCache>>(new Map());
  // Bed and prime tower groups
  const bedGroupRef = useRef<THREE.Group | null>(null);
  const originGroupRef = useRef<THREE.Group | null>(null);
  const primeTowerGroupRef = useRef<THREE.Group | null>(null);

  // Drag state
  const isDraggingRef = useRef(false);
  const dragObjectIdRef = useRef<string | null>(null);
  /** Offset from object origin to pointer hit point at drag start (Three.js coords) */
  const dragOffsetRef = useRef<THREE.Vector3>(new THREE.Vector3());
  /** Reusable raycaster for drag operations */
  const dragRaycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  /** Bed plane for drag projection (Y=0 in Three.js space) */
  const bedPlaneRef = useRef<THREE.Plane>(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));

  // Interaction mode: none | drag | rotate | scale
  const interactionModeRef = useRef<InteractionMode>('none');
  // Handles group (rotation ring + scale cubes) — direct child of scene
  const handlesGroupRef = useRef<THREE.Group | null>(null);
  // Rotation interaction state
  const rotateStartAngleRef = useRef(0);
  const rotateObjectStartRef = useRef(0); // degrees
  // Scale interaction state
  const scaleStartDistRef = useRef(1);
  const scaleObjectStartRef = useRef({ x: 1, y: 1, z: 1 });

  // Stable refs for callbacks
  const onSelectObjectRef = useRef(onSelectObject);
  onSelectObjectRef.current = onSelectObject;
  const onUpdateTransformRef = useRef(onUpdateTransform);
  onUpdateTransformRef.current = onUpdateTransform;
  const onUpdatePrimeTowerPositionRef = useRef(onUpdatePrimeTowerPosition);
  onUpdatePrimeTowerPositionRef.current = onUpdatePrimeTowerPosition;
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const originCenterRef = useRef(originCenter);
  originCenterRef.current = originCenter;
  const selectedObjectIdRef = useRef(selectedObjectId);
  selectedObjectIdRef.current = selectedObjectId;
  const gridSnapRef = useRef(gridSnap);
  gridSnapRef.current = gridSnap;

  // Initialize Three.js scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      10000
    );
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.maxPolarAngle = Math.PI / 2 - 0.05; // Don't go below bed
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    controlsRef.current = controls;

    // Lighting
    scene.add(new THREE.AmbientLight(0x666666));

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(1, 1.5, 1).normalize();
    scene.add(dirLight);

    const backLight = new THREE.DirectionalLight(0xffffff, 0.4);
    backLight.position.set(-1, 0.5, -1).normalize();
    scene.add(backLight);

    // Initial camera position — overview of bed
    const maxBed = Math.max(bedWidth, bedDepth);
    const fitDist = maxBed / (2 * Math.tan((Math.PI * 45) / 360));
    camera.position.set(fitDist * 0.8, fitDist * 0.6, fitDist * 0.8);
    camera.near = 0.1;
    camera.far = maxBed * 10;
    camera.updateProjectionMatrix();

    // Look at bed center
    const centerX = originCenter ? 0 : bedWidth / 2;
    const centerZ = originCenter ? 0 : -bedDepth / 2;
    controls.target.set(centerX, 0, centerZ);
    controls.update();

    // Animation loop
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
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
      // Clean up handles
      if (handlesGroupRef.current) {
        disposeGroup(handlesGroupRef.current);
        handlesGroupRef.current = null;
      }
      // Clean up geometry cache
      geometryCacheRef.current.forEach((entry) => {
        disposeGroup(entry.group);
      });
      geometryCacheRef.current.clear();
      objectGroupsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update bed grid when bed dimensions change
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove old bed
    if (bedGroupRef.current) {
      scene.remove(bedGroupRef.current);
      disposeGroup(bedGroupRef.current);
    }
    if (originGroupRef.current) {
      scene.remove(originGroupRef.current);
      disposeGroup(originGroupRef.current);
    }

    // Create new bed
    const bed = createBedGrid(bedWidth, bedDepth, originCenter);
    scene.add(bed);
    bedGroupRef.current = bed;

    const origin = createOriginIndicator(originCenter);
    scene.add(origin);
    originGroupRef.current = origin;
  }, [bedWidth, bedDepth, originCenter]);

  // Update prime tower
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (primeTowerGroupRef.current) {
      scene.remove(primeTowerGroupRef.current);
      disposeGroup(primeTowerGroupRef.current);
    }

    const tower = createPrimeTower(primeTower, originCenter, estimatedTowerDepth);
    scene.add(tower);
    primeTowerGroupRef.current = tower;
  }, [primeTower, originCenter, estimatedTowerDepth]);

  // Memoize object fingerprints to detect changes
  const objectFingerprints = useMemo(() => {
    return objects.map((obj) => ({
      id: obj.id,
      meshKey: meshFingerprint(obj.meshData),
      posX: obj.position.x,
      posY: obj.position.y,
      rotation: obj.rotation,
      scaleX: obj.scale.x,
      scaleY: obj.scale.y,
      scaleZ: obj.scale.z,
      format: obj.meshFormat,
      colorCount: obj.colorGroups?.length ?? 0,
    }));
  }, [objects]);

  // Update objects in the scene
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const currentGroups = objectGroupsRef.current;
    const cache = geometryCacheRef.current;
    const currentIds = new Set(objects.map((o) => o.id));

    // Remove objects no longer present
    for (const [id, group] of currentGroups) {
      if (!currentIds.has(id)) {
        scene.remove(group);
        disposeGroup(group);
        currentGroups.delete(id);
      }
    }

    // Add or update objects
    for (const obj of objects) {
      const fp = meshFingerprint(obj.meshData);
      const colorSuffix = obj.colorGroups?.length ? `:c${obj.colorGroups.length}` : '';
      const objCacheKey = fp + colorSuffix;
      const existing = currentGroups.get(obj.id);

      if (existing && existing.userData.meshKey === objCacheKey) {
        // Mesh unchanged — just update transform
        applyTransform(existing, obj, originCenter);

        // Update selection state
        if (obj.id === selectedObjectId && !existing.userData.isSelected) {
          addSelectionHighlight(existing);
          existing.userData.isSelected = true;
        } else if (obj.id !== selectedObjectId && existing.userData.isSelected) {
          removeSelectionHighlight(existing);
          existing.userData.isSelected = false;
        }
        continue;
      }

      // Mesh changed or new object — parse or use cache
      if (existing) {
        scene.remove(existing);
        disposeGroup(existing);
        currentGroups.delete(obj.id);
      }

      let parsedGroup: THREE.Group;
      const cached = cache.get(objCacheKey);
      if (cached) {
        parsedGroup = cached.group.clone(true);
      } else {
        try {
          parsedGroup = parseMeshData(obj.meshData, obj.meshFormat, obj.colorGroups);
          cache.set(objCacheKey, { key: objCacheKey, group: parsedGroup.clone(true) });
        } catch {
          // Skip objects that fail to parse
          continue;
        }
      }

      // Wrap in a container group for transform
      const container = new THREE.Group();
      container.userData.objectId = obj.id;
      container.userData.meshKey = objCacheKey;

      // Z-up to Y-up rotation applied to the parsed geometry
      parsedGroup.rotation.x = -Math.PI / 2;

      // Compute bounding box to place bottom on bed
      const box = new THREE.Box3().setFromObject(parsedGroup);
      parsedGroup.position.y = -box.min.y;

      container.add(parsedGroup);
      applyTransform(container, obj, originCenter);

      // Selection highlight
      if (obj.id === selectedObjectId) {
        addSelectionHighlight(container);
        container.userData.isSelected = true;
      }

      scene.add(container);
      currentGroups.set(obj.id, container);
    }

    // Clean geometry cache — remove entries not used by any current object
    const usedKeys = new Set(objects.map((o) => {
      const k = meshFingerprint(o.meshData);
      const cs = o.colorGroups?.length ? `:c${o.colorGroups.length}` : '';
      return k + cs;
    }));
    for (const [key, entry] of cache) {
      if (!usedKeys.has(key)) {
        disposeGroup(entry.group);
        cache.delete(key);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectFingerprints, selectedObjectId, originCenter]);

  // Manage rotation/scale handles for the selected object
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove old handles
    if (handlesGroupRef.current) {
      scene.remove(handlesGroupRef.current);
      disposeGroup(handlesGroupRef.current);
      handlesGroupRef.current = null;
    }

    if (!selectedObjectId) return;

    const objectGroup = objectGroupsRef.current.get(selectedObjectId);
    if (!objectGroup) return;

    const handles = createHandles(objectGroup);
    scene.add(handles);
    handlesGroupRef.current = handles;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectFingerprints, selectedObjectId, originCenter]);

  /** Convert client coords to normalized device coords */
  const clientToNDC = useCallback((clientX: number, clientY: number): THREE.Vector2 => {
    const renderer = rendererRef.current;
    if (!renderer) return new THREE.Vector2();
    const rect = renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
  }, []);

  /** Find which object group (if any) is hit by a raycast at the given NDC position */
  const hitTestObjects = useCallback((ndc: THREE.Vector2): string | null => {
    const camera = cameraRef.current;
    if (!camera) return null;

    const raycaster = dragRaycasterRef.current;
    raycaster.setFromCamera(ndc, camera);

    const objectMeshes: THREE.Object3D[] = [];
    for (const [, group] of objectGroupsRef.current) {
      group.traverse((child) => {
        if (child instanceof THREE.Mesh && !child.userData.isBedPlane) {
          objectMeshes.push(child);
        }
      });
    }

    const intersects = raycaster.intersectObjects(objectMeshes, false);
    if (intersects.length > 0) {
      let hitObject = intersects[0].object;
      while (hitObject.parent && !hitObject.userData.objectId) {
        hitObject = hitObject.parent;
      }
      if (hitObject.userData.objectId) {
        return hitObject.userData.objectId as string;
      }
    }
    return null;
  }, []);

  /** Project NDC position onto bed plane (Y=0), returns Three.js coords */
  const projectToBed = useCallback((ndc: THREE.Vector2): THREE.Vector3 | null => {
    const camera = cameraRef.current;
    if (!camera) return null;

    const raycaster = dragRaycasterRef.current;
    raycaster.setFromCamera(ndc, camera);

    const intersection = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(bedPlaneRef.current, intersection);
    return hit ? intersection : null;
  }, []);

  /** Check if pointer hits a rotation or scale handle */
  const hitTestHandles = useCallback((ndc: THREE.Vector2): InteractionMode => {
    const camera = cameraRef.current;
    const handles = handlesGroupRef.current;
    if (!camera || !handles) return 'none';

    const raycaster = dragRaycasterRef.current;
    raycaster.setFromCamera(ndc, camera);

    const meshes: THREE.Object3D[] = [];
    handles.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.push(child);
    });

    const intersects = raycaster.intersectObjects(meshes, false);
    if (intersects.length > 0) {
      const hit = intersects[0].object;
      if (hit.userData.isRotationHandle) return 'rotate';
      if (hit.userData.isScaleHandle) return 'scale';
    }
    return 'none';
  }, []);

  /** Check if pointer hits the prime tower */
  const hitTestPrimeTower = useCallback((ndc: THREE.Vector2): boolean => {
    const camera = cameraRef.current;
    const tower = primeTowerGroupRef.current;
    if (!camera || !tower || !tower.userData.isPrimeTower) return false;

    const raycaster = dragRaycasterRef.current;
    raycaster.setFromCamera(ndc, camera);

    const meshes: THREE.Object3D[] = [];
    tower.traverse((child) => {
      if (child instanceof THREE.Mesh && !child.userData.isBedPlane) meshes.push(child);
    });

    return raycaster.intersectObjects(meshes, false).length > 0;
  }, []);

  /** Compute angle of a point relative to the selected object's center on the bed plane (radians) */
  const angleFromObjectCenter = useCallback((bedPoint: THREE.Vector3): number => {
    const objectId = selectedObjectIdRef.current;
    if (!objectId) return 0;
    const group = objectGroupsRef.current.get(objectId);
    if (!group) return 0;
    return Math.atan2(bedPoint.z - group.position.z, bedPoint.x - group.position.x);
  }, []);

  /** Compute distance from a bed point to the selected object's center on the bed plane */
  const distFromObjectCenter = useCallback((bedPoint: THREE.Vector3): number => {
    const objectId = selectedObjectIdRef.current;
    if (!objectId) return 0;
    const group = objectGroupsRef.current.get(objectId);
    if (!group) return 0;
    const dx = bedPoint.x - group.position.x;
    const dz = bedPoint.z - group.position.z;
    return Math.sqrt(dx * dx + dz * dz);
  }, []);

  // Pointer event handling for selection + drag + rotate + scale
  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return;

    // Only handle primary button (left click / single touch)
    if (event.button !== 0) return;

    const ndc = clientToNDC(event.clientX, event.clientY);

    // 1. Check handles first (only when an object is selected)
    if (selectedObjectIdRef.current) {
      const handleHit = hitTestHandles(ndc);
      if (handleHit !== 'none') {
        const bedPoint = projectToBed(ndc);
        if (bedPoint) {
          interactionModeRef.current = handleHit;
          isDraggingRef.current = true;
          dragObjectIdRef.current = selectedObjectIdRef.current;

          if (handleHit === 'rotate') {
            rotateStartAngleRef.current = angleFromObjectCenter(bedPoint);
            // Find the current object's rotation in degrees
            const obj = objectsRef.current.find((o) => o.id === selectedObjectIdRef.current);
            rotateObjectStartRef.current = obj?.rotation ?? 0;
          } else if (handleHit === 'scale') {
            scaleStartDistRef.current = distFromObjectCenter(bedPoint);
            const obj = objectsRef.current.find((o) => o.id === selectedObjectIdRef.current);
            scaleObjectStartRef.current = obj?.scale ? { ...obj.scale } : { x: 1, y: 1, z: 1 };
          }

          (event.target as HTMLElement).setPointerCapture(event.pointerId);
          if (controlsRef.current) controlsRef.current.enabled = false;
          if (containerRef.current) {
            containerRef.current.style.cursor = handleHit === 'rotate' ? 'crosshair' : 'nwse-resize';
          }
        }
        return;
      }
    }

    // 2. Check prime tower hit (drag)
    if (hitTestPrimeTower(ndc)) {
      const tower = primeTowerGroupRef.current;
      if (tower) {
        const bedPoint = projectToBed(ndc);
        if (bedPoint) {
          // Find the tower mesh position
          let towerPos = new THREE.Vector3();
          tower.traverse((child) => {
            if (child instanceof THREE.Mesh) towerPos = child.position.clone();
          });
          dragOffsetRef.current.set(
            bedPoint.x - towerPos.x,
            0,
            bedPoint.z - towerPos.z
          );

          interactionModeRef.current = 'drag-prime-tower';
          isDraggingRef.current = true;
          dragObjectIdRef.current = '__prime_tower__';

          (event.target as HTMLElement).setPointerCapture(event.pointerId);
          if (controlsRef.current) controlsRef.current.enabled = false;
          if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
        }
      }
      return;
    }

    // 3. Check object hit (drag)
    const hitObjectId = hitTestObjects(ndc);

    if (hitObjectId) {
      onSelectObjectRef.current(hitObjectId);

      const group = objectGroupsRef.current.get(hitObjectId);
      if (group) {
        const bedPoint = projectToBed(ndc);
        if (bedPoint) {
          dragOffsetRef.current.set(
            bedPoint.x - group.position.x,
            0,
            bedPoint.z - group.position.z
          );

          interactionModeRef.current = 'drag';
          isDraggingRef.current = true;
          dragObjectIdRef.current = hitObjectId;

          (event.target as HTMLElement).setPointerCapture(event.pointerId);
          if (controlsRef.current) controlsRef.current.enabled = false;
          if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
        }
      }
    } else {
      // 4. Clicked empty space — deselect
      onSelectObjectRef.current(null);
    }
  }, [clientToNDC, hitTestObjects, hitTestHandles, hitTestPrimeTower, projectToBed, angleFromObjectCenter, distFromObjectCenter]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !dragObjectIdRef.current) {
      // Hover cursor: check handles, then objects
      const ndc = clientToNDC(event.clientX, event.clientY);
      const handleHit = hitTestHandles(ndc);
      if (handleHit !== 'none') {
        if (containerRef.current) {
          containerRef.current.style.cursor = handleHit === 'rotate' ? 'crosshair' : 'nwse-resize';
        }
        return;
      }
      if (hitTestPrimeTower(ndc)) {
        if (containerRef.current) containerRef.current.style.cursor = 'grab';
        return;
      }
      const hitId = hitTestObjects(ndc);
      if (containerRef.current) {
        containerRef.current.style.cursor = hitId ? 'grab' : '';
      }
      return;
    }

    const ndc = clientToNDC(event.clientX, event.clientY);
    const bedPoint = projectToBed(ndc);
    if (!bedPoint) return;

    const mode = interactionModeRef.current;

    if (mode === 'drag-prime-tower') {
      // Move the prime tower meshes directly
      const tower = primeTowerGroupRef.current;
      if (tower) {
        let newThreeX = bedPoint.x - dragOffsetRef.current.x;
        let newThreeZ = bedPoint.z - dragOffsetRef.current.z;

        if (gridSnapRef.current) {
          let modelX = newThreeX;
          let modelY = -newThreeZ;
          modelX = snapValue(modelX, POSITION_SNAP_MM);
          modelY = snapValue(modelY, POSITION_SNAP_MM);
          newThreeX = modelX;
          newThreeZ = -modelY;
        }

        tower.traverse((child) => {
          if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
            child.position.x = newThreeX;
            child.position.z = newThreeZ;
          }
        });
      }
      return;
    }

    const group = objectGroupsRef.current.get(dragObjectIdRef.current);
    if (!group) return;

    if (mode === 'drag') {
      let newThreeX = bedPoint.x - dragOffsetRef.current.x;
      let newThreeZ = bedPoint.z - dragOffsetRef.current.z;

      if (gridSnapRef.current) {
        // Convert to model space, snap, convert back
        let modelX = newThreeX;
        let modelY = -newThreeZ;
        modelX = snapValue(modelX, POSITION_SNAP_MM);
        modelY = snapValue(modelY, POSITION_SNAP_MM);
        newThreeX = modelX;
        newThreeZ = -modelY;
      }

      group.position.x = newThreeX;
      group.position.z = newThreeZ;
    } else if (mode === 'rotate') {
      const currentAngle = angleFromObjectCenter(bedPoint);
      let deltaDeg = ((currentAngle - rotateStartAngleRef.current) * 180) / Math.PI;
      let newRotation = rotateObjectStartRef.current - deltaDeg; // negative because Three.js Y-up rotation is opposite

      if (gridSnapRef.current) {
        newRotation = snapValue(newRotation, ROTATION_SNAP_DEG);
      }

      // Apply visual rotation: model degrees → Three.js Y rotation
      group.rotation.y = -(newRotation * Math.PI) / 180;
    } else if (mode === 'scale') {
      const currentDist = distFromObjectCenter(bedPoint);
      if (scaleStartDistRef.current > 0.01) {
        const ratio = currentDist / scaleStartDistRef.current;
        const startScale = scaleObjectStartRef.current;
        const newScale = {
          x: startScale.x * ratio,
          y: startScale.y * ratio,
          z: startScale.z * ratio,
        };
        // Clamp to reasonable range
        const clamp = (v: number) => Math.max(0.1, Math.min(10, v));
        // Apply visual scale (swap Y/Z for coord system)
        group.scale.set(clamp(newScale.x), clamp(newScale.z), clamp(newScale.y));
      }
    }
  }, [clientToNDC, projectToBed, hitTestObjects, hitTestHandles, hitTestPrimeTower, angleFromObjectCenter, distFromObjectCenter]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !dragObjectIdRef.current) return;

    const objectId = dragObjectIdRef.current;
    const mode = interactionModeRef.current;

    // Release pointer capture
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);

    // Re-enable orbit controls
    if (controlsRef.current) controlsRef.current.enabled = true;

    // Commit prime tower position
    if (mode === 'drag-prime-tower') {
      const tower = primeTowerGroupRef.current;
      if (tower && onUpdatePrimeTowerPositionRef.current) {
        let threeX = 0, threeZ = 0;
        tower.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            threeX = child.position.x;
            threeZ = child.position.z;
          }
        });
        const modelX = threeX;
        const modelY = -threeZ;
        onUpdatePrimeTowerPositionRef.current({ x: modelX, y: modelY });
      }
      isDraggingRef.current = false;
      dragObjectIdRef.current = null;
      interactionModeRef.current = 'none';
      if (containerRef.current) containerRef.current.style.cursor = '';
      return;
    }

    // Commit transform based on mode
    const group = objectGroupsRef.current.get(objectId);
    if (group) {
      if (mode === 'drag') {
        const modelX = group.position.x;
        const modelY = -group.position.z;
        onUpdateTransformRef.current(objectId, {
          position: { x: modelX, y: modelY },
        });
      } else if (mode === 'rotate') {
        // Three.js Y rotation → model space degrees (negate, convert from radians)
        const rotationDeg = -(group.rotation.y * 180) / Math.PI;
        onUpdateTransformRef.current(objectId, {
          rotation: rotationDeg,
        });
      } else if (mode === 'scale') {
        // Three.js scale (with Y/Z swap) → model space scale
        onUpdateTransformRef.current(objectId, {
          scale: { x: group.scale.x, y: group.scale.z, z: group.scale.y },
        });
      }
    }

    // Reset state
    isDraggingRef.current = false;
    dragObjectIdRef.current = null;
    interactionModeRef.current = 'none';

    if (containerRef.current) containerRef.current.style.cursor = '';
  }, []);

  // Compute selected object info for numeric overlay
  const selectedObject = selectedObjectId ? objects.find((o) => o.id === selectedObjectId) : null;

  return (
    <div
      className="build-plate-canvas"
      style={{ width: '100%', height: '100%', touchAction: 'none', position: 'relative' }}
    >
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ width: '100%', height: '100%', touchAction: 'none' }}
      />
      {selectedObject && (
        <div
          className="build-plate-transform-overlay"
          style={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            background: 'rgba(0,0,0,0.7)',
            color: '#fff',
            padding: '6px 10px',
            borderRadius: 4,
            fontSize: 12,
            fontFamily: 'monospace',
            pointerEvents: 'none',
            display: 'flex',
            gap: 12,
          }}
        >
          <span>X: {selectedObject.position.x.toFixed(1)}</span>
          <span>Y: {selectedObject.position.y.toFixed(1)}</span>
          <span>Rot: {selectedObject.rotation.toFixed(1)}&deg;</span>
          <span>Scale: {selectedObject.scale.x.toFixed(2)}</span>
          {gridSnap && <span style={{ color: '#ffaa00' }}>SNAP</span>}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Utility functions
// ============================================================

/** Apply model-space transform to a Three.js group */
function applyTransform(
  group: THREE.Group,
  obj: BuildPlateObject,
  _originCenter: boolean
): void {
  const { x: threeX, z: threeZ } = modelToThree(obj.position.x, obj.position.y);
  group.position.x = threeX;
  group.position.z = threeZ;
  // Y position stays at 0 (on bed) — objects are placed on bed by mesh offset

  // Rotation around Y in Three.js = rotation around Z in model space
  // Model rotation is in degrees
  group.rotation.y = -(obj.rotation * Math.PI) / 180;

  // Scale
  group.scale.set(obj.scale.x, obj.scale.z, obj.scale.y); // swap Y/Z for coord system
}

/** Dispose all geometries and materials in a group */
function disposeGroup(group: THREE.Group | THREE.Object3D): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        child.material?.dispose();
      }
    } else if (child instanceof THREE.LineSegments || child instanceof THREE.Line) {
      child.geometry?.dispose();
      if (child.material instanceof THREE.Material) {
        child.material.dispose();
      }
    }
  });
}
