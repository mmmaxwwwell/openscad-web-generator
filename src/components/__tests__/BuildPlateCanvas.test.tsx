// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { BuildPlateObject, PrimeTowerConfig } from '../../types/build-plate';

// @vitest-environment jsdom

// ============================================================
// Three.js mocks — jsdom has no WebGL
// ============================================================

// Track scene.add calls to verify objects are added
const sceneAddSpy = vi.fn();
const sceneRemoveSpy = vi.fn();

// Track what groups were created
const createdGroups: Array<{ userData: Record<string, unknown>; children: unknown[] }> = [];
const raycasterInstances: Array<Record<string, unknown>> = [];
const orbitControlsInstances: Array<Record<string, unknown>> = [];

function vec3(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    set(nx: number, ny: number, nz: number) { this.x = nx; this.y = ny; this.z = nz; return this; },
    copy(v: { x: number; y: number; z: number }) { this.x = v.x; this.y = v.y; this.z = v.z; return this; },
    normalize() { return this; },
    clone() { return vec3(this.x, this.y, this.z); },
  };
}

function mockBox3() {
  return {
    min: vec3(), max: vec3(10, 10, 10),
    setFromObject() { return this; },
    getCenter(t: ReturnType<typeof vec3>) { t.set(5, 5, 5); return t; },
    getSize(t: ReturnType<typeof vec3>) { t.set(10, 10, 10); return t; },
  };
}

function mockGroup() {
  const children: unknown[] = [];
  const g: Record<string, unknown> = {
    type: 'Group', children,
    userData: {} as Record<string, unknown>,
    position: vec3(), rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1, set(sx: number, sy: number, sz: number) { this.x = sx; this.y = sy; this.z = sz; } },
    add(child: unknown) { children.push(child); },
    remove(child: unknown) { const i = children.indexOf(child); if (i >= 0) children.splice(i, 1); },
    traverse(fn: (c: unknown) => void) { fn(g); },
    clone() { return mockGroup(); },
    parent: null,
  };
  createdGroups.push(g as { userData: Record<string, unknown>; children: unknown[] });
  return g;
}

function mockGeo(): Record<string, unknown> {
  const g: Record<string, unknown> = { dispose() {}, setFromPoints() { return this; }, computeBoundingBox() {}, boundingBox: mockBox3() };
  g.clone = () => mockGeo();
  return g;
}

function mockMat(): Record<string, unknown> {
  const m: Record<string, unknown> = { dispose() {}, color: { setHex() {} } };
  m.clone = () => mockMat();
  return m;
}

// Canvas element for WebGLRenderer
const mockCanvas = document.createElement('canvas');
mockCanvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} } as DOMRect);

vi.mock('three', () => {
  // All constructors must be regular functions (not arrows) to work with `new`
  function Scene(this: Record<string, unknown>) { this.background = null; this.add = sceneAddSpy; this.remove = sceneRemoveSpy; this.children = []; }
  function PerspectiveCamera(this: Record<string, unknown>) { this.position = vec3(); this.aspect = 1; this.near = 0.1; this.far = 10000; this.updateProjectionMatrix = vi.fn(); }
  function WebGLRenderer(this: Record<string, unknown>) { this.setPixelRatio = vi.fn(); this.setSize = vi.fn(); this.render = vi.fn(); this.dispose = vi.fn(); this.domElement = mockCanvas; }
  function Group(this: Record<string, unknown>) { Object.assign(this, mockGroup()); }
  function Mesh(this: Record<string, unknown>, geo: unknown, mat: unknown) { this.geometry = geo; this.material = mat; this.position = vec3(); this.rotation = { x: 0, y: 0, z: 0 }; this.scale = { x: 1, y: 1, z: 1 }; this.userData = {}; this.add = vi.fn(); }
  function Line(this: Record<string, unknown>) { this.geometry = mockGeo(); this.material = mockMat(); }
  function LineSegments(this: Record<string, unknown>) { this.geometry = mockGeo(); this.material = mockMat(); this.position = vec3(); this.userData = {}; }
  function BoxGeometry() { return mockGeo(); }
  function PlaneGeometry() { return mockGeo(); }
  function BufferGeometry() { return mockGeo(); }
  function EdgesGeometry() { return mockGeo(); }
  function TorusGeometry() { return mockGeo(); }
  function MeshPhongMaterial(this: Record<string, unknown>) { Object.assign(this, mockMat()); this.specular = null; this.shininess = 0; this.vertexColors = false; this.name = ''; }
  function MeshBasicMaterial(this: Record<string, unknown>) { Object.assign(this, mockMat()); }
  function LineBasicMaterial(this: Record<string, unknown>) { Object.assign(this, mockMat()); }
  function ArrowHelper() {}
  function Box3(this: Record<string, unknown>) { Object.assign(this, mockBox3()); }
  function Vector2(this: { x: number; y: number }, x = 0, y = 0) { this.x = x; this.y = y; }
  function Vector3(this: Record<string, unknown>, x = 0, y = 0, z = 0) { Object.assign(this, vec3(x, y, z)); }
  function Plane(this: Record<string, unknown>) { this.normal = vec3(0, 1, 0); this.constant = 0; }
  function Raycaster(this: Record<string, unknown>) { this.setFromCamera = vi.fn(); this.intersectObjects = vi.fn(() => []); this.ray = { intersectPlane: vi.fn(() => null) }; raycasterInstances.push(this); }
  function Color() {}
  function AmbientLight() {}
  function DirectionalLight(this: Record<string, unknown>) { this.position = vec3(); }

  return {
    Scene, PerspectiveCamera, WebGLRenderer, Group, Mesh, Line, LineSegments,
    BoxGeometry, PlaneGeometry, BufferGeometry, EdgesGeometry, TorusGeometry,
    MeshPhongMaterial, MeshBasicMaterial, LineBasicMaterial, ArrowHelper,
    Box3, Vector2, Vector3, Plane, Raycaster, Color, AmbientLight, DirectionalLight,
    DoubleSide: 2,
    TOUCH: { ROTATE: 0, DOLLY_PAN: 2 },
    Loader: { DEFAULT_MATERIAL_NAME: '' },
  };
});

vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: function OrbitControls(this: Record<string, unknown>) {
    this.enableDamping = false; this.dampingFactor = 0.1; this.maxPolarAngle = 0;
    this.touches = {}; this.target = vec3(); this.update = vi.fn(); this.dispose = vi.fn(); this.enabled = true;
    orbitControlsInstances.push(this);
  },
}));

vi.mock('three/examples/jsm/loaders/STLLoader.js', () => ({
  STLLoader: function STLLoader(this: Record<string, unknown>) {
    this.parse = vi.fn(() => mockGeo());
  },
}));

vi.mock('three/examples/jsm/loaders/3MFLoader.js', () => ({
  ThreeMFLoader: function ThreeMFLoader(this: Record<string, unknown>) {
    this.parse = vi.fn(() => {
      const g = mockGroup();
      g.children.push({ geometry: mockGeo(), material: mockMat(), position: vec3(), userData: {} });
      return g;
    });
  },
}));

// Mock ResizeObserver
vi.stubGlobal('ResizeObserver', function ResizeObserver() {
  return { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() };
});

vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
vi.stubGlobal('cancelAnimationFrame', vi.fn());

// Mock pointer capture methods for drag interaction tests
HTMLElement.prototype.setPointerCapture = vi.fn();
HTMLElement.prototype.releasePointerCapture = vi.fn();

// ============================================================
// Import component after mocks
// ============================================================
import { BuildPlateCanvas } from '../BuildPlateCanvas';
import type { BuildPlateCanvasProps } from '../BuildPlateCanvas';

// ============================================================
// Test helpers
// ============================================================

function makeMinimalSTL(): ArrayBuffer {
  return new ArrayBuffer(84); // 80-byte header + 4-byte triangle count (0)
}

function makeTestObject(overrides: Partial<BuildPlateObject> = {}): BuildPlateObject {
  return {
    id: 'obj-1', name: 'Test Object', type: 'stl',
    meshData: makeMinimalSTL(), meshFormat: 'stl',
    position: { x: 100, y: 100 }, rotation: 0, scale: { x: 1, y: 1, z: 1 },
    ...overrides,
  };
}

function makeDefaultProps(overrides: Partial<BuildPlateCanvasProps> = {}): BuildPlateCanvasProps {
  return {
    objects: [], selectedObjectId: null,
    bedWidth: 220, bedDepth: 220, maxHeight: 250, originCenter: false,
    primeTower: { enabled: false, position: { x: 180, y: 180 }, width: 40, brimWidth: 3 },
    onSelectObject: vi.fn(), onUpdateTransform: vi.fn(),
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('BuildPlateCanvas', () => {
  beforeEach(() => {
    createdGroups.length = 0;
    raycasterInstances.length = 0;
    orbitControlsInstances.length = 0;
    sceneAddSpy.mockClear();
    sceneRemoveSpy.mockClear();
  });

  afterEach(cleanup);

  // -- Rendering basics --

  it('renders without crashing', () => {
    const { container } = render(<BuildPlateCanvas {...makeDefaultProps()} />);
    expect(container.querySelector('.build-plate-canvas')).toBeTruthy();
  });

  it('renders with touch-action: none for mobile support', () => {
    const { container } = render(<BuildPlateCanvas {...makeDefaultProps()} />);
    const el = container.querySelector('.build-plate-canvas') as HTMLElement;
    expect(el.style.touchAction).toBe('none');
  });

  it('appends renderer domElement to the container', () => {
    const { container } = render(<BuildPlateCanvas {...makeDefaultProps()} />);
    const innerDiv = container.querySelector('.build-plate-canvas > div');
    expect(innerDiv?.contains(mockCanvas)).toBe(true);
  });

  // -- Bed grid --

  it('adds bed grid to scene on mount', () => {
    render(<BuildPlateCanvas {...makeDefaultProps()} />);
    // Should have called scene.add for bed group (with isBed userData) and origin indicator
    const bedAdded = sceneAddSpy.mock.calls.some((c) => c[0]?.userData?.isBed === true);
    expect(bedAdded).toBe(true);
  });

  it('recreates bed grid when bed dimensions change', () => {
    const props = makeDefaultProps({ bedWidth: 200, bedDepth: 200 });
    const { rerender } = render(<BuildPlateCanvas {...props} />);
    const countBefore = sceneAddSpy.mock.calls.length;
    rerender(<BuildPlateCanvas {...makeDefaultProps({ bedWidth: 300, bedDepth: 300 })} />);
    expect(sceneAddSpy.mock.calls.length).toBeGreaterThan(countBefore);
  });

  // -- Objects --

  it('adds objects to the scene', () => {
    const obj = makeTestObject({ id: 'test-1' });
    render(<BuildPlateCanvas {...makeDefaultProps({ objects: [obj] })} />);
    const added = sceneAddSpy.mock.calls.some((c) => c[0]?.userData?.objectId === 'test-1');
    expect(added).toBe(true);
  });

  it('renders multiple objects', () => {
    const obj1 = makeTestObject({ id: 'a', position: { x: 50, y: 50 } });
    const obj2 = makeTestObject({ id: 'b', position: { x: 150, y: 150 } });
    render(<BuildPlateCanvas {...makeDefaultProps({ objects: [obj1, obj2] })} />);
    const ids = sceneAddSpy.mock.calls.filter((c) => c[0]?.userData?.objectId).map((c) => c[0].userData.objectId);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
  });

  it('removes objects from scene when removed from props', () => {
    const obj = makeTestObject({ id: 'rm-1' });
    const { rerender } = render(<BuildPlateCanvas {...makeDefaultProps({ objects: [obj] })} />);
    rerender(<BuildPlateCanvas {...makeDefaultProps({ objects: [] })} />);
    const removed = sceneRemoveSpy.mock.calls.some((c) => c[0]?.userData?.objectId === 'rm-1');
    expect(removed).toBe(true);
  });

  it('handles 3MF format objects', () => {
    const obj = makeTestObject({ id: '3mf-1', meshFormat: '3mf' });
    render(<BuildPlateCanvas {...makeDefaultProps({ objects: [obj] })} />);
    const added = sceneAddSpy.mock.calls.some((c) => c[0]?.userData?.objectId === '3mf-1');
    expect(added).toBe(true);
  });

  // -- Selection overlay --

  it('does not show numeric overlay when nothing selected', () => {
    const obj = makeTestObject();
    render(<BuildPlateCanvas {...makeDefaultProps({ objects: [obj], selectedObjectId: null })} />);
    expect(screen.queryByText(/^X:/)).toBeNull();
  });

  it('shows numeric overlay when an object is selected', () => {
    const obj = makeTestObject({ id: 's1', position: { x: 42.5, y: 73.2 }, rotation: 15, scale: { x: 1.5, y: 1.5, z: 1.5 } });
    render(<BuildPlateCanvas {...makeDefaultProps({ objects: [obj], selectedObjectId: 's1' })} />);
    expect(screen.getByText('X: 42.5')).toBeTruthy();
    expect(screen.getByText('Y: 73.2')).toBeTruthy();
    expect(screen.getByText(/Rot: 15\.0/)).toBeTruthy();
    expect(screen.getByText('Scale: 1.50')).toBeTruthy();
  });

  it('shows transform values with correct precision', () => {
    const obj = makeTestObject({ id: 'p1', position: { x: 1.123, y: 2.987 }, rotation: 45.678, scale: { x: 0.123, y: 1, z: 1 } });
    render(<BuildPlateCanvas {...makeDefaultProps({ objects: [obj], selectedObjectId: 'p1' })} />);
    expect(screen.getByText('X: 1.1')).toBeTruthy();
    expect(screen.getByText('Y: 3.0')).toBeTruthy();
    expect(screen.getByText(/Rot: 45\.7/)).toBeTruthy();
    expect(screen.getByText('Scale: 0.12')).toBeTruthy();
  });

  it('shows SNAP indicator when gridSnap enabled and object selected', () => {
    const obj = makeTestObject({ id: 'snap' });
    render(<BuildPlateCanvas {...makeDefaultProps({ objects: [obj], selectedObjectId: 'snap', gridSnap: true })} />);
    expect(screen.getByText('SNAP')).toBeTruthy();
  });

  it('hides SNAP indicator when gridSnap disabled', () => {
    const obj = makeTestObject({ id: 'ns' });
    render(<BuildPlateCanvas {...makeDefaultProps({ objects: [obj], selectedObjectId: 'ns', gridSnap: false })} />);
    expect(screen.queryByText('SNAP')).toBeNull();
  });

  // -- Selection callbacks --

  it('fires onSelectObject(null) on empty space click', () => {
    const onSelectObject = vi.fn();
    const { container } = render(<BuildPlateCanvas {...makeDefaultProps({ onSelectObject })} />);
    const inner = container.querySelector('.build-plate-canvas > div')!;
    fireEvent.pointerDown(inner, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
    expect(onSelectObject).toHaveBeenCalledWith(null);
  });

  it('ignores non-primary button clicks', () => {
    const onSelectObject = vi.fn();
    const { container } = render(<BuildPlateCanvas {...makeDefaultProps({ onSelectObject })} />);
    const inner = container.querySelector('.build-plate-canvas > div')!;
    fireEvent.pointerDown(inner, { clientX: 400, clientY: 300, button: 2, pointerId: 1 });
    expect(onSelectObject).not.toHaveBeenCalled();
  });

  // -- Prime tower --

  it('adds prime tower group when enabled', () => {
    const pt: PrimeTowerConfig = { enabled: true, position: { x: 180, y: 180 }, width: 40, brimWidth: 3 };
    render(<BuildPlateCanvas {...makeDefaultProps({ primeTower: pt })} />);
    const added = sceneAddSpy.mock.calls.some((c) => c[0]?.userData?.isPrimeTower === true);
    expect(added).toBe(true);
  });

  it('does not add prime tower content when disabled', () => {
    const pt: PrimeTowerConfig = { enabled: false, position: { x: 0, y: 0 }, width: 40, brimWidth: 3 };
    render(<BuildPlateCanvas {...makeDefaultProps({ primeTower: pt })} />);
    // When disabled, createPrimeTower returns early without setting isPrimeTower userData
    const towers = sceneAddSpy.mock.calls.filter((c) => c[0]?.userData?.isPrimeTower === true);
    expect(towers.length).toBe(0);
  });

  it('updates prime tower when config changes', () => {
    const pt1: PrimeTowerConfig = { enabled: true, position: { x: 100, y: 100 }, width: 30, brimWidth: 2 };
    const pt2: PrimeTowerConfig = { enabled: true, position: { x: 150, y: 150 }, width: 50, brimWidth: 4 };
    const { rerender } = render(<BuildPlateCanvas {...makeDefaultProps({ primeTower: pt1 })} />);
    const addBefore = sceneAddSpy.mock.calls.length;
    rerender(<BuildPlateCanvas {...makeDefaultProps({ primeTower: pt2 })} />);
    expect(sceneRemoveSpy).toHaveBeenCalled();
    expect(sceneAddSpy.mock.calls.length).toBeGreaterThan(addBefore);
  });

  // -- Pointer events --

  it('handles pointer event lifecycle without crashing', () => {
    const { container } = render(<BuildPlateCanvas {...makeDefaultProps()} />);
    const inner = container.querySelector('.build-plate-canvas > div')!;
    expect(() => {
      fireEvent.pointerDown(inner, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
      fireEvent.pointerMove(inner, { clientX: 10, clientY: 10, pointerId: 1 });
      fireEvent.pointerUp(inner, { clientX: 10, clientY: 10, pointerId: 1 });
    }).not.toThrow();
  });

  it('handles pointerCancel gracefully', () => {
    const { container } = render(<BuildPlateCanvas {...makeDefaultProps()} />);
    const inner = container.querySelector('.build-plate-canvas > div')!;
    expect(() => {
      fireEvent.pointerCancel(inner, { pointerId: 1 });
    }).not.toThrow();
  });

  // -- Origin center mode --

  it('renders in originCenter mode without crashing', () => {
    const obj = makeTestObject({ id: 'c1', position: { x: 0, y: 0 } });
    render(<BuildPlateCanvas {...makeDefaultProps({ objects: [obj], originCenter: true })} />);
    expect(screen.queryByText('.build-plate-canvas')).toBeDefined();
  });

  // -- Cleanup --

  it('cleans up on unmount', () => {
    const { unmount } = render(<BuildPlateCanvas {...makeDefaultProps()} />);
    expect(() => unmount()).not.toThrow();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  // ============================================================
  // Canvas interaction tests
  // ============================================================

  /** Configure raycaster to simulate hitting an object on next intersectObjects call */
  function setupObjectHit(objectId: string) {
    const rc = raycasterInstances[raycasterInstances.length - 1] as Record<string, ReturnType<typeof vi.fn> & Record<string, ReturnType<typeof vi.fn>>>;
    rc.intersectObjects.mockReturnValueOnce([
      { object: { userData: { objectId }, parent: null }, distance: 10, point: vec3() },
    ]);
    // projectToBed needs ray.intersectPlane to return truthy
    rc.ray.intersectPlane.mockReturnValue(true);
  }

  /** Configure raycaster to simulate hitting a rotation handle */
  function setupRotationHandleHit() {
    const rc = raycasterInstances[raycasterInstances.length - 1] as Record<string, ReturnType<typeof vi.fn> & Record<string, ReturnType<typeof vi.fn>>>;
    rc.intersectObjects.mockReturnValueOnce([
      { object: { userData: { isRotationHandle: true } }, distance: 5 },
    ]);
    rc.ray.intersectPlane.mockReturnValue(true);
  }

  /** Configure raycaster to simulate hitting a scale handle */
  function setupScaleHandleHit() {
    const rc = raycasterInstances[raycasterInstances.length - 1] as Record<string, ReturnType<typeof vi.fn> & Record<string, ReturnType<typeof vi.fn>>>;
    rc.intersectObjects.mockReturnValueOnce([
      { object: { userData: { isScaleHandle: true } }, distance: 5 },
    ]);
    rc.ray.intersectPlane.mockReturnValue(true);
  }

  /** Configure raycaster to simulate hitting the prime tower */
  function setupPrimeTowerHit() {
    const rc = raycasterInstances[raycasterInstances.length - 1] as Record<string, ReturnType<typeof vi.fn> & Record<string, ReturnType<typeof vi.fn>>>;
    rc.intersectObjects.mockReturnValueOnce([
      { object: { userData: {}, parent: null }, distance: 10 },
    ]);
    rc.ray.intersectPlane.mockReturnValue(true);
  }

  describe('object drag interaction', () => {
    it('calls onUpdateTransform with position on completed drag', () => {
      const onUpdateTransform = vi.fn();
      const onSelectObject = vi.fn();
      const obj = makeTestObject({ id: 'drag-1', position: { x: 100, y: 100 } });
      const { container } = render(
        <BuildPlateCanvas {...makeDefaultProps({ objects: [obj], onUpdateTransform, onSelectObject })} />
      );
      const inner = container.querySelector('.build-plate-canvas > div')!;
      setupObjectHit('drag-1');
      fireEvent.pointerDown(inner, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerMove(inner, { clientX: 410, clientY: 310, pointerId: 1 });
      fireEvent.pointerUp(inner, { clientX: 410, clientY: 310, pointerId: 1 });
      expect(onUpdateTransform).toHaveBeenCalledWith('drag-1', {
        position: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
      });
    });

    it('selects the object on drag start', () => {
      const onSelectObject = vi.fn();
      const obj = makeTestObject({ id: 'sel-1' });
      const { container } = render(
        <BuildPlateCanvas {...makeDefaultProps({ objects: [obj], onSelectObject })} />
      );
      const inner = container.querySelector('.build-plate-canvas > div')!;
      setupObjectHit('sel-1');
      fireEvent.pointerDown(inner, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
      expect(onSelectObject).toHaveBeenCalledWith('sel-1');
    });

    it('disables OrbitControls during drag and re-enables on pointerUp', () => {
      const obj = makeTestObject({ id: 'oc-1' });
      const { container } = render(
        <BuildPlateCanvas {...makeDefaultProps({ objects: [obj] })} />
      );
      const inner = container.querySelector('.build-plate-canvas > div')!;
      const oc = orbitControlsInstances[orbitControlsInstances.length - 1];
      expect(oc.enabled).toBe(true);
      setupObjectHit('oc-1');
      fireEvent.pointerDown(inner, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
      expect(oc.enabled).toBe(false);
      fireEvent.pointerUp(inner, { clientX: 400, clientY: 300, pointerId: 1 });
      expect(oc.enabled).toBe(true);
    });

    it('sets cursor to grabbing during drag and resets on pointerUp', () => {
      const obj = makeTestObject({ id: 'cur-1' });
      const { container } = render(
        <BuildPlateCanvas {...makeDefaultProps({ objects: [obj] })} />
      );
      const inner = container.querySelector('.build-plate-canvas > div')!;
      setupObjectHit('cur-1');
      fireEvent.pointerDown(inner, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
      expect(inner.style.cursor).toBe('grabbing');
      fireEvent.pointerUp(inner, { clientX: 400, clientY: 300, pointerId: 1 });
      expect(inner.style.cursor).toBe('');
    });
  });

  describe('rotation handle interaction', () => {
    it('commits rotation via onUpdateTransform', () => {
      const onUpdateTransform = vi.fn();
      const obj = makeTestObject({ id: 'rot-1', position: { x: 100, y: 100 } });
      const { container } = render(
        <BuildPlateCanvas {...makeDefaultProps({
          objects: [obj], selectedObjectId: 'rot-1', onUpdateTransform,
        })} />
      );
      const inner = container.querySelector('.build-plate-canvas > div')!;
      setupRotationHandleHit();
      fireEvent.pointerDown(inner, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerMove(inner, { clientX: 420, clientY: 320, pointerId: 1 });
      fireEvent.pointerUp(inner, { clientX: 420, clientY: 320, pointerId: 1 });
      expect(onUpdateTransform).toHaveBeenCalledWith('rot-1', {
        rotation: expect.any(Number),
      });
    });

    it('sets cursor to crosshair during rotation', () => {
      const obj = makeTestObject({ id: 'rc-1', position: { x: 100, y: 100 } });
      const { container } = render(
        <BuildPlateCanvas {...makeDefaultProps({
          objects: [obj], selectedObjectId: 'rc-1',
        })} />
      );
      const inner = container.querySelector('.build-plate-canvas > div')!;
      setupRotationHandleHit();
      fireEvent.pointerDown(inner, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
      expect(inner.style.cursor).toBe('crosshair');
    });
  });

  describe('scale handle interaction', () => {
    it('commits scale via onUpdateTransform', () => {
      const onUpdateTransform = vi.fn();
      const obj = makeTestObject({ id: 'sc-1', position: { x: 100, y: 100 } });
      const { container } = render(
        <BuildPlateCanvas {...makeDefaultProps({
          objects: [obj], selectedObjectId: 'sc-1', onUpdateTransform,
        })} />
      );
      const inner = container.querySelector('.build-plate-canvas > div')!;
      setupScaleHandleHit();
      fireEvent.pointerDown(inner, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerMove(inner, { clientX: 420, clientY: 320, pointerId: 1 });
      fireEvent.pointerUp(inner, { clientX: 420, clientY: 320, pointerId: 1 });
      expect(onUpdateTransform).toHaveBeenCalledWith('sc-1', {
        scale: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) }),
      });
    });

    it('sets cursor to nwse-resize during scale', () => {
      const obj = makeTestObject({ id: 'scc-1', position: { x: 100, y: 100 } });
      const { container } = render(
        <BuildPlateCanvas {...makeDefaultProps({
          objects: [obj], selectedObjectId: 'scc-1',
        })} />
      );
      const inner = container.querySelector('.build-plate-canvas > div')!;
      setupScaleHandleHit();
      fireEvent.pointerDown(inner, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
      expect(inner.style.cursor).toBe('nwse-resize');
    });
  });

  describe('hover cursor', () => {
    it('shows grab cursor when hovering over object', () => {
      const obj = makeTestObject({ id: 'hov-1' });
      const { container } = render(
        <BuildPlateCanvas {...makeDefaultProps({ objects: [obj] })} />
      );
      const inner = container.querySelector('.build-plate-canvas > div')!;
      const rc = raycasterInstances[raycasterInstances.length - 1] as Record<string, ReturnType<typeof vi.fn>>;
      // hitTestObjects returns a hit during hover
      rc.intersectObjects.mockReturnValueOnce([
        { object: { userData: { objectId: 'hov-1' }, parent: null } },
      ]);
      fireEvent.pointerMove(inner, { clientX: 400, clientY: 300, pointerId: 1 });
      expect(inner.style.cursor).toBe('grab');
    });

    it('shows default cursor when hovering over empty space', () => {
      const obj = makeTestObject({ id: 'hov-2' });
      const { container } = render(
        <BuildPlateCanvas {...makeDefaultProps({ objects: [obj] })} />
      );
      const inner = container.querySelector('.build-plate-canvas > div')!;
      // intersectObjects returns [] by default → no hit
      fireEvent.pointerMove(inner, { clientX: 400, clientY: 300, pointerId: 1 });
      expect(inner.style.cursor).toBe('');
    });

    it('shows crosshair cursor when hovering over rotation handle', () => {
      const obj = makeTestObject({ id: 'hov-rh', position: { x: 100, y: 100 } });
      const { container } = render(
        <BuildPlateCanvas {...makeDefaultProps({
          objects: [obj], selectedObjectId: 'hov-rh',
        })} />
      );
      const inner = container.querySelector('.build-plate-canvas > div')!;
      const rc = raycasterInstances[raycasterInstances.length - 1] as Record<string, ReturnType<typeof vi.fn>>;
      rc.intersectObjects.mockReturnValueOnce([
        { object: { userData: { isRotationHandle: true } } },
      ]);
      fireEvent.pointerMove(inner, { clientX: 400, clientY: 300, pointerId: 1 });
      expect(inner.style.cursor).toBe('crosshair');
    });

    it('shows nwse-resize cursor when hovering over scale handle', () => {
      const obj = makeTestObject({ id: 'hov-sh', position: { x: 100, y: 100 } });
      const { container } = render(
        <BuildPlateCanvas {...makeDefaultProps({
          objects: [obj], selectedObjectId: 'hov-sh',
        })} />
      );
      const inner = container.querySelector('.build-plate-canvas > div')!;
      const rc = raycasterInstances[raycasterInstances.length - 1] as Record<string, ReturnType<typeof vi.fn>>;
      rc.intersectObjects.mockReturnValueOnce([
        { object: { userData: { isScaleHandle: true } } },
      ]);
      fireEvent.pointerMove(inner, { clientX: 400, clientY: 300, pointerId: 1 });
      expect(inner.style.cursor).toBe('nwse-resize');
    });
  });

  describe('grid snap during interaction', () => {
    it('does not crash during drag with gridSnap enabled', () => {
      const obj = makeTestObject({ id: 'snap-d' });
      const { container } = render(
        <BuildPlateCanvas {...makeDefaultProps({ objects: [obj], gridSnap: true })} />
      );
      const inner = container.querySelector('.build-plate-canvas > div')!;
      setupObjectHit('snap-d');
      expect(() => {
        fireEvent.pointerDown(inner, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
        fireEvent.pointerMove(inner, { clientX: 415, clientY: 312, pointerId: 1 });
        fireEvent.pointerUp(inner, { clientX: 415, clientY: 312, pointerId: 1 });
      }).not.toThrow();
    });

    it('does not crash during rotation with gridSnap enabled', () => {
      const obj = makeTestObject({ id: 'snap-r', position: { x: 100, y: 100 } });
      const { container } = render(
        <BuildPlateCanvas {...makeDefaultProps({
          objects: [obj], selectedObjectId: 'snap-r', gridSnap: true,
        })} />
      );
      const inner = container.querySelector('.build-plate-canvas > div')!;
      setupRotationHandleHit();
      expect(() => {
        fireEvent.pointerDown(inner, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
        fireEvent.pointerMove(inner, { clientX: 430, clientY: 280, pointerId: 1 });
        fireEvent.pointerUp(inner, { clientX: 430, clientY: 280, pointerId: 1 });
      }).not.toThrow();
    });
  });

  describe('multi-pointer and touch safety', () => {
    it('handles touch pointer events the same as mouse', () => {
      const onUpdateTransform = vi.fn();
      const obj = makeTestObject({ id: 'touch-1', position: { x: 100, y: 100 } });
      const { container } = render(
        <BuildPlateCanvas {...makeDefaultProps({ objects: [obj], onUpdateTransform })} />
      );
      const inner = container.querySelector('.build-plate-canvas > div')!;
      setupObjectHit('touch-1');
      // Use non-zero pointerId (typical for touch)
      fireEvent.pointerDown(inner, { clientX: 200, clientY: 200, button: 0, pointerId: 42 });
      fireEvent.pointerMove(inner, { clientX: 210, clientY: 210, pointerId: 42 });
      fireEvent.pointerUp(inner, { clientX: 210, clientY: 210, pointerId: 42 });
      expect(onUpdateTransform).toHaveBeenCalledWith('touch-1', {
        position: expect.any(Object),
      });
    });

    it('handles two rapid pointerdown events without crashing', () => {
      const obj = makeTestObject({ id: 'multi-1' });
      const { container } = render(
        <BuildPlateCanvas {...makeDefaultProps({ objects: [obj] })} />
      );
      const inner = container.querySelector('.build-plate-canvas > div')!;
      expect(() => {
        fireEvent.pointerDown(inner, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
        fireEvent.pointerDown(inner, { clientX: 200, clientY: 200, button: 0, pointerId: 2 });
        fireEvent.pointerUp(inner, { clientX: 200, clientY: 200, pointerId: 2 });
        fireEvent.pointerUp(inner, { clientX: 100, clientY: 100, pointerId: 1 });
      }).not.toThrow();
    });

    it('handles pointerCancel during drag and re-enables OrbitControls', () => {
      const obj = makeTestObject({ id: 'cancel-1' });
      const { container } = render(
        <BuildPlateCanvas {...makeDefaultProps({ objects: [obj] })} />
      );
      const inner = container.querySelector('.build-plate-canvas > div')!;
      setupObjectHit('cancel-1');
      const oc = orbitControlsInstances[orbitControlsInstances.length - 1];
      fireEvent.pointerDown(inner, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
      expect(oc.enabled).toBe(false);
      // pointerCancel is mapped to handlePointerUp
      fireEvent.pointerCancel(inner, { pointerId: 1 });
      expect(oc.enabled).toBe(true);
    });
  });

  describe('prime tower drag', () => {
    it('calls onUpdatePrimeTowerPosition on tower drag', () => {
      const onUpdatePrimeTowerPosition = vi.fn();
      const pt: PrimeTowerConfig = { enabled: true, position: { x: 180, y: 180 }, width: 40, brimWidth: 3 };
      const { container } = render(
        <BuildPlateCanvas {...makeDefaultProps({ primeTower: pt, onUpdatePrimeTowerPosition })} />
      );
      const inner = container.querySelector('.build-plate-canvas > div')!;
      setupPrimeTowerHit();
      fireEvent.pointerDown(inner, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
      fireEvent.pointerMove(inner, { clientX: 410, clientY: 310, pointerId: 1 });
      fireEvent.pointerUp(inner, { clientX: 410, clientY: 310, pointerId: 1 });
      expect(onUpdatePrimeTowerPosition).toHaveBeenCalledWith({
        x: expect.any(Number),
        y: expect.any(Number),
      });
    });

    it('sets cursor to grabbing during prime tower drag', () => {
      const pt: PrimeTowerConfig = { enabled: true, position: { x: 180, y: 180 }, width: 40, brimWidth: 3 };
      const { container } = render(
        <BuildPlateCanvas {...makeDefaultProps({ primeTower: pt, onUpdatePrimeTowerPosition: vi.fn() })} />
      );
      const inner = container.querySelector('.build-plate-canvas > div')!;
      setupPrimeTowerHit();
      fireEvent.pointerDown(inner, { clientX: 400, clientY: 300, button: 0, pointerId: 1 });
      expect(inner.style.cursor).toBe('grabbing');
      fireEvent.pointerUp(inner, { clientX: 400, clientY: 300, pointerId: 1 });
      expect(inner.style.cursor).toBe('');
    });
  });
});
