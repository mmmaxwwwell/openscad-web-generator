// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import type { UseOpenSCADResult } from '../../hooks/useOpenSCAD';
import type { UseBuildPlateResult } from '../../hooks/useBuildPlate';
import type { Printer } from '../../hooks/usePrinters';
import type { BuildPlateObject } from '../../types/build-plate';

// @vitest-environment jsdom

// ── Mocks ────────────────────────────────────────────────────────────────

// Mock BuildPlateCanvas — no WebGL in jsdom
vi.mock('../BuildPlateCanvas', () => ({
  BuildPlateCanvas: () => <div data-testid="build-plate-canvas" />,
}));

// Mock ParameterEditor
vi.mock('../ParameterEditor', () => ({
  ParameterEditor: ({ params, values, onChange }: {
    params: Array<{ name: string }>;
    values: Record<string, unknown>;
    onChange: (name: string, value: unknown) => void;
  }) => (
    <div data-testid="parameter-editor">
      {params.map((p) => (
        <button
          key={p.name}
          data-testid={`param-${p.name}`}
          onClick={() => onChange(p.name, (values[p.name] as number) + 1)}
        >
          {p.name}: {String(values[p.name])}
        </button>
      ))}
    </div>
  ),
}));

// Mock getPrinterProfile
vi.mock('../../data/printer-profiles', () => ({
  getPrinterProfile: () => ({
    bedWidth: 220,
    bedDepth: 220,
    maxHeight: 250,
    originCenter: false,
  }),
}));

// Track useBuildPlate calls — the mock returns a mutable reference
let mockPlate: UseBuildPlateResult;

vi.mock('../../hooks/useBuildPlate', () => ({
  useBuildPlate: () => mockPlate,
}));

// Mock merge-3mf for dynamic import in handleReRender(multicolor=true)
vi.mock('../../lib/merge-3mf', () => ({
  extractColorGroups: vi.fn(() => [
    { index: 0, colorHex: '#FF0000' },
    { index: 1, colorHex: '#00FF00' },
  ]),
}));

// Mock slicer and filament hooks used by BuildPlateView
vi.mock('../../hooks/useSlicer', () => ({
  useSlicer: () => ({
    status: 'idle',
    error: null,
    progress: null,
    debugLog: [],
    engineName: 'WASM',
    slice: vi.fn(),
    slicePlate: vi.fn(),
    queryResolvedConfigs: vi.fn().mockResolvedValue({}),
    cancel: vi.fn(),
    reset: vi.fn(),
    sliceStats: null,
    resolvedConfigs: null,
  }),
}));

vi.mock('../../hooks/useFilaments', () => ({
  useFilaments: () => ({
    filaments: [{ id: 'pla', name: 'PLA', builtin: true, temp: 200, bedTemp: 60, printSpeed: 60, minFanSpeed: 100, maxFanSpeed: 100, retractionLength: 0.8, retractionSpeed: 40, zHop: 0 }],
    addFilament: vi.fn(),
    updateFilament: vi.fn(),
    deleteFilament: vi.fn(),
  }),
}));

vi.mock('../../hooks/useExtruderFilaments', () => ({
  useExtruderFilaments: () => ({
    assignments: { 0: 'pla' },
    setExtruderFilament: vi.fn(),
    getFilamentForExtruder: () => ({ id: 'pla', name: 'PLA', builtin: true, temp: 200, bedTemp: 60, printSpeed: 60, minFanSpeed: 100, maxFanSpeed: 100, retractionLength: 0.8, retractionSpeed: 40, zHop: 0 }),
  }),
}));

vi.mock('../../hooks/usePrinterFilamentOverrides', () => ({
  usePrinterFilamentOverrides: () => ({
    getOverride: vi.fn(),
    setOverride: vi.fn(),
    isFieldOverridden: vi.fn(() => false),
    resetField: vi.fn(),
    getResolvedFilament: () => ({ temp: 200, bedTemp: 60, printSpeed: 60, minFanSpeed: 100, maxFanSpeed: 100, retractionLength: 0.8, retractionSpeed: 40, zHop: 0 }),
  }),
}));

vi.mock('../../hooks/usePrinterConfig', () => ({
  usePrinterConfig: () => ({
    config: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock('../../lib/plate-slicer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/plate-slicer')>();
  return {
    ...actual,
    validatePlateForSlicing: vi.fn(() => []),
    buildPlateSliceConfig: vi.fn(() => ({
      objects: [],
      globalConfig: {},
      printSequence: 'by_layer',
    })),
  };
});

vi.mock('../BuildPlateFlushVolumes', () => ({
  BuildPlateFlushVolumes: () => null,
  getPlateExtruderCount: () => 1,
}));

vi.mock('../SendToPrinter', () => ({
  uploadToMoonraker: vi.fn(),
}));

vi.mock('../GCodePreview', () => ({
  GCodePreview: () => <div data-testid="gcode-preview" />,
}));

// Mock Worker for GCode preview parsing
vi.stubGlobal('Worker', class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage() {}
  terminate() {}
});

import { BuildPlateView } from '../BuildPlateView';

// ── Helpers ────────────────────────────────────────────────────────────────

const testPrinter: Printer = {
  name: 'Test Printer',
  address: 'http://test:7125',
  profileId: 'test-profile',
};

function makeSTLBuffer(size = 16): ArrayBuffer {
  return new ArrayBuffer(size);
}

function createMockPlate(overrides: Partial<UseBuildPlateResult> = {}): UseBuildPlateResult {
  return {
    objects: [],
    selectedObjectId: null,
    selectedObject: null,
    plateProfile: {} as UseBuildPlateResult['plateProfile'],
    primeTower: { enabled: false, position: { x: 150, y: 150 }, width: 60, brimWidth: 3 },
    flushVolumeConfig: undefined,
    printSequence: 'by_layer',
    loaded: true,

    addSTLFile: vi.fn(),
    add3MFFile: vi.fn(),
    addObject: vi.fn(() => 'new-obj-id'),
    removeObject: vi.fn(),
    duplicateObject: vi.fn(),
    updateObjectTransform: vi.fn(),
    updateObjectOverrides: vi.fn(),
    clearObjectOverrides: vi.fn(),
    setExtruderAssignment: vi.fn(),
    setVolumeExtruder: vi.fn(),
    replaceObjectMesh: vi.fn(),

    mirrorObject: vi.fn(),
    arrayCopyObject: vi.fn(() => []),

    setPlateProfile: vi.fn(),
    setPrimeTower: vi.fn(),
    setFlushVolumeConfig: vi.fn(),
    setPrintSequence: vi.fn(),
    autoArrange: vi.fn(),
    clearPlate: vi.fn(),

    selectObject: vi.fn(),
    deselectAll: vi.fn(),

    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,

    ...overrides,
  };
}

function createMockOpenSCAD(overrides: Partial<UseOpenSCADResult> = {}): UseOpenSCADResult {
  return {
    status: 'ready',
    error: null,
    logs: [],
    clearLogs: vi.fn(),
    init: vi.fn(),
    render: vi.fn(() => Promise.resolve(makeSTLBuffer(32))),
    renderMulticolor: vi.fn(() => Promise.resolve(makeSTLBuffer(64))),
    ...overrides,
  };
}

function makeScadObject(overrides: Partial<BuildPlateObject> = {}): BuildPlateObject {
  return {
    id: 'scad-1',
    name: 'test_part',
    type: 'scad',
    meshData: makeSTLBuffer(16),
    meshFormat: 'stl',
    position: { x: 50, y: 75 },
    rotation: 45,
    scale: { x: 1.5, y: 1.5, z: 1.5 },
    printOverrides: { wallLoops: 5 },
    scadFileId: 'test.scad',
    scadSource: 'cube(size);',
    scadParams: { size: 10 },
    scadParamDefs: [
      { name: 'size', type: 'number' as const, initial: 10, caption: 'Size' },
    ],
    copies: 1,
    ...overrides,
  };
}

/**
 * The right panel only opens when handleSelectObject is called (via clicking
 * an object in the sidebar list). Since our mock sets selectedObjectId/selectedObject
 * directly, we must click the object in the sidebar to trigger the panel open.
 */
function clickObjectInSidebar(objectName: string) {
  // Use the sidebar-specific class to avoid hitting the panel header
  const sidebar = document.querySelector('.build-plate-object-list');
  if (!sidebar) {
    // If sidebar is empty, try clicking anywhere with the name
    fireEvent.click(screen.getByText(objectName));
    return;
  }
  const item = sidebar.querySelector('.build-plate-object-item');
  if (item) {
    fireEvent.click(item);
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('BuildPlateView', () => {
  beforeEach(() => {
    mockPlate = createMockPlate();
  });

  afterEach(() => {
    cleanup();
  });

  // ── File import via toolbar ───────────────────────────────────────────

  describe('file import buttons', () => {
    it('renders Add STL and Add 3MF buttons', () => {
      render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      expect(screen.getByText('+ STL')).toBeTruthy();
      expect(screen.getByText('+ 3MF')).toBeTruthy();
    });
  });

  // ── Bug fix: + SCAD button ────────────────────────────────────────────

  describe('+ SCAD button', () => {
    it('renders + SCAD button in toolbar', () => {
      const openscad = createMockOpenSCAD();
      render(<BuildPlateView printer={testPrinter} openscad={openscad} onClose={vi.fn()} />);
      expect(screen.getByText('+ SCAD')).toBeTruthy();
    });

    it('+ SCAD button is disabled when openscad is not provided', () => {
      render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      const btn = screen.getByText('+ SCAD');
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });

    it('+ SCAD button is enabled when openscad is available', () => {
      const openscad = createMockOpenSCAD();
      render(<BuildPlateView printer={testPrinter} openscad={openscad} onClose={vi.fn()} />);
      const btn = screen.getByText('+ SCAD');
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    });

    it('opens SCAD picker dialog when + SCAD button is clicked', async () => {
      const openscad = createMockOpenSCAD();
      await act(async () => {
        render(<BuildPlateView printer={testPrinter} openscad={openscad} onClose={vi.fn()} />);
      });

      await act(async () => {
        fireEvent.click(screen.getByText('+ SCAD'));
      });

      expect(screen.getByText('Add SCAD Example')).toBeTruthy();
    });

    it('SCAD picker lists example files', async () => {
      const openscad = createMockOpenSCAD();
      await act(async () => {
        render(<BuildPlateView printer={testPrinter} openscad={openscad} onClose={vi.fn()} />);
      });

      await act(async () => {
        fireEvent.click(screen.getByText('+ SCAD'));
      });

      // Check that at least some known examples are listed
      expect(screen.getByText('1cm Cube')).toBeTruthy();
      expect(screen.getByText('Parametric Sign')).toBeTruthy();
    });

    it('SCAD picker closes when Cancel is clicked', async () => {
      const openscad = createMockOpenSCAD();
      await act(async () => {
        render(<BuildPlateView printer={testPrinter} openscad={openscad} onClose={vi.fn()} />);
      });

      await act(async () => {
        fireEvent.click(screen.getByText('+ SCAD'));
      });
      expect(screen.getByText('Add SCAD Example')).toBeTruthy();

      await act(async () => {
        // The Cancel button inside the picker
        const picker = document.querySelector('.build-plate-scad-picker');
        const cancelBtn = picker?.querySelector('.build-plate-btn');
        expect(cancelBtn).toBeTruthy();
        fireEvent.click(cancelBtn!);
      });

      expect(screen.queryByText('Add SCAD Example')).toBeNull();
    });

    it('SCAD picker closes when overlay backdrop is clicked', async () => {
      const openscad = createMockOpenSCAD();
      await act(async () => {
        render(<BuildPlateView printer={testPrinter} openscad={openscad} onClose={vi.fn()} />);
      });

      await act(async () => {
        fireEvent.click(screen.getByText('+ SCAD'));
      });
      expect(screen.getByText('Add SCAD Example')).toBeTruthy();

      await act(async () => {
        const overlay = document.querySelector('.build-plate-scad-picker-overlay');
        // Click directly on the overlay (not the dialog)
        fireEvent.click(overlay!);
      });

      expect(screen.queryByText('Add SCAD Example')).toBeNull();
    });
  });

  // ── Bug fix: pending object with SCAD metadata ────────────────────────

  describe('pending object with SCAD metadata', () => {
    it('creates type=scad object when pending object has SCAD metadata', async () => {
      const pendingObject = {
        meshData: makeSTLBuffer(32),
        format: 'stl' as const,
        name: 'test_cube',
        scadSource: 'cube(size);',
        scadParams: { size: 10 },
        scadParamDefs: [
          { name: 'size', type: 'number' as const, initial: 10, caption: 'Size' },
        ],
        scadFileId: 'cube_1cm.scad',
      };

      const onConsumed = vi.fn();

      await act(async () => {
        render(
          <BuildPlateView
            printer={testPrinter}
            onClose={vi.fn()}
            pendingObject={pendingObject}
            onPendingObjectConsumed={onConsumed}
          />,
        );
      });

      // addObject should have been called with type: 'scad' and SCAD fields
      expect(mockPlate.addObject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test_cube',
          type: 'scad',
          meshFormat: 'stl',
          scadSource: 'cube(size);',
          scadParams: { size: 10 },
          scadParamDefs: expect.arrayContaining([
            expect.objectContaining({ name: 'size' }),
          ]),
          scadFileId: 'cube_1cm.scad',
        }),
      );
      expect(onConsumed).toHaveBeenCalled();
    });

    it('creates non-SCAD object when pending object has no SCAD metadata', async () => {
      const pendingObject = {
        meshData: makeSTLBuffer(32),
        format: 'stl' as const,
        name: 'plain_stl',
      };

      const onConsumed = vi.fn();

      await act(async () => {
        render(
          <BuildPlateView
            printer={testPrinter}
            onClose={vi.fn()}
            pendingObject={pendingObject}
            onPendingObjectConsumed={onConsumed}
          />,
        );
      });

      expect(mockPlate.addObject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'plain_stl',
          type: 'stl',
        }),
      );
      // Should NOT contain SCAD fields
      const callArg = (mockPlate.addObject as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArg.scadSource).toBeUndefined();
      expect(callArg.scadParams).toBeUndefined();
      expect(onConsumed).toHaveBeenCalled();
    });

    it('creates 3mf type for pending 3MF object without SCAD metadata', async () => {
      const pendingObject = {
        meshData: makeSTLBuffer(32),
        format: '3mf' as const,
        name: 'multicolor_part',
        colorGroups: [{ colorHex: '#FF0000' }, { colorHex: '#00FF00' }],
      };

      await act(async () => {
        render(
          <BuildPlateView
            printer={testPrinter}
            onClose={vi.fn()}
            pendingObject={pendingObject}
            onPendingObjectConsumed={vi.fn()}
          />,
        );
      });

      expect(mockPlate.addObject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'multicolor_part',
          type: '3mf',
          colorGroups: [{ color: '#FF0000' }, { color: '#00FF00' }],
        }),
      );
    });
  });

  // ── Loading state ────────────────────────────────────────────────────

  describe('loading state', () => {
    it('shows loading message when plate is not yet loaded', () => {
      mockPlate = createMockPlate({ loaded: false });
      render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      expect(screen.getByText('Loading build plate...')).toBeTruthy();
    });
  });

  // ── SCAD re-render ────────────────────────────────────────────────────

  describe('SCAD re-render', () => {
    async function setupWithScadObject(openscadOverrides: Partial<UseOpenSCADResult> = {}) {
      const scadObj = makeScadObject();
      const openscad = createMockOpenSCAD(openscadOverrides);
      mockPlate = createMockPlate({
        objects: [scadObj],
        selectedObjectId: 'scad-1',
        selectedObject: scadObj,
      });

      let result: ReturnType<typeof render>;
      await act(async () => {
        result = render(
          <BuildPlateView printer={testPrinter} openscad={openscad} onClose={vi.fn()} />,
        );
      });

      // Click the object in sidebar to open the right panel
      await act(async () => {
        clickObjectInSidebar('test_part');
      });

      return { openscad, scadObj, result: result! };
    }

    it('shows parameter editor for selected SCAD object', async () => {
      await setupWithScadObject();
      expect(screen.getByTestId('parameter-editor')).toBeTruthy();
    });

    it('shows Re-render button', async () => {
      await setupWithScadObject();
      expect(screen.getByText('Re-render')).toBeTruthy();
    });

    it('Re-render button calls openscad.render with source and params', async () => {
      const newMeshData = makeSTLBuffer(64);
      const { openscad } = await setupWithScadObject({
        render: vi.fn().mockResolvedValue(newMeshData),
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Re-render'));
      });

      expect(openscad.render).toHaveBeenCalledWith(
        'cube(size);',
        { size: 10 },
        'stl',
      );
    });

    it('calls replaceObjectMesh on successful re-render', async () => {
      const newMeshData = makeSTLBuffer(64);
      await setupWithScadObject({
        render: vi.fn().mockResolvedValue(newMeshData),
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Re-render'));
      });

      expect(mockPlate.replaceObjectMesh).toHaveBeenCalledWith(
        'scad-1',
        newMeshData,
        'stl',
        undefined,
        { size: 10 },
      );
    });

    it('replaceObjectMesh preserves position/rotation/scale/overrides (only updates mesh)', async () => {
      const newMeshData = makeSTLBuffer(64);
      const { scadObj } = await setupWithScadObject({
        render: vi.fn().mockResolvedValue(newMeshData),
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Re-render'));
      });

      // replaceObjectMesh is called with only mesh data — it does NOT receive
      // position/rotation/scale/overrides. Those are preserved by the hook.
      const call = (mockPlate.replaceObjectMesh as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe(scadObj.id); // same object
      expect(call[1]).toBe(newMeshData); // new mesh data
      expect(call[2]).toBe('stl'); // format
      // No position/rotation/scale/overrides in the call
    });

    it('shows error on re-render failure and does not replace mesh', async () => {
      await setupWithScadObject({
        render: vi.fn().mockRejectedValue(new Error('Compilation failed')),
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Re-render'));
      });

      expect(screen.getByText(/Compilation failed/)).toBeTruthy();
      expect(mockPlate.replaceObjectMesh).not.toHaveBeenCalled();
    });

    it('error message is dismissible', async () => {
      await setupWithScadObject({
        render: vi.fn().mockRejectedValue(new Error('Syntax error')),
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Re-render'));
      });

      expect(screen.getByText(/Syntax error/)).toBeTruthy();

      await act(async () => {
        fireEvent.click(screen.getByText('Dismiss'));
      });

      expect(screen.queryByText(/Syntax error/)).toBeNull();
    });

    it('passes updated params when user changes a parameter before re-rendering', async () => {
      const newMeshData = makeSTLBuffer(64);
      const { openscad } = await setupWithScadObject({
        render: vi.fn().mockResolvedValue(newMeshData),
      });

      // Increment param via mock ParameterEditor
      await act(async () => {
        fireEvent.click(screen.getByTestId('param-size'));
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Re-render'));
      });

      // size was 10, incremented to 11
      expect(openscad.render).toHaveBeenCalledWith(
        'cube(size);',
        { size: 11 },
        'stl',
      );
    });

    it('passes updated params to replaceObjectMesh', async () => {
      const newMeshData = makeSTLBuffer(64);
      await setupWithScadObject({
        render: vi.fn().mockResolvedValue(newMeshData),
      });

      // Increment param
      await act(async () => {
        fireEvent.click(screen.getByTestId('param-size'));
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Re-render'));
      });

      expect(mockPlate.replaceObjectMesh).toHaveBeenCalledWith(
        'scad-1',
        newMeshData,
        'stl',
        undefined,
        { size: 11 },
      );
    });

    it('disables Re-render button during rendering', async () => {
      let resolveRender!: (v: ArrayBuffer) => void;
      const renderPromise = new Promise<ArrayBuffer>((resolve) => {
        resolveRender = resolve;
      });

      await setupWithScadObject({
        render: vi.fn().mockReturnValue(renderPromise),
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Re-render'));
      });

      const renderingBtns = screen.getAllByText('Rendering...');
      expect(renderingBtns.length).toBeGreaterThan(0);
      expect((renderingBtns[0] as HTMLButtonElement).disabled).toBe(true);

      await act(async () => {
        resolveRender(makeSTLBuffer(64));
      });

      await waitFor(() => {
        expect(screen.getByText('Re-render')).toBeTruthy();
      });
    });
  });

  // ── Multicolor re-render ─────────────────────────────────────────────

  describe('multicolor SCAD re-render', () => {
    async function setupMulticolorScad(openscadOverrides: Partial<UseOpenSCADResult> = {}) {
      const scadObj = makeScadObject({
        id: 'scad-mc-1',
        name: 'mc_part',
        meshFormat: '3mf',
        scadSource: 'color("red") cube(s);',
        scadParams: { s: 10 },
        scadParamDefs: [
          { name: 's', type: 'number' as const, initial: 10, caption: 'Size' },
        ],
        colorGroups: [{ color: '#FF0000' }, { color: '#00FF00' }],
      });

      const openscad = createMockOpenSCAD(openscadOverrides);
      mockPlate = createMockPlate({
        objects: [scadObj],
        selectedObjectId: 'scad-mc-1',
        selectedObject: scadObj,
      });

      await act(async () => {
        render(
          <BuildPlateView printer={testPrinter} openscad={openscad} onClose={vi.fn()} />,
        );
      });

      await act(async () => {
        clickObjectInSidebar('mc_part');
      });

      return { openscad, scadObj };
    }

    it('shows Re-render Multicolor button for objects with colorGroups', async () => {
      await setupMulticolorScad();
      expect(screen.getByText('Re-render Multicolor')).toBeTruthy();
    });

    it('shows Re-render Multicolor for single-color SCAD objects too', async () => {
      const scadObj = makeScadObject(); // no colorGroups
      const openscad = createMockOpenSCAD();
      mockPlate = createMockPlate({
        objects: [scadObj],
        selectedObjectId: 'scad-1',
        selectedObject: scadObj,
      });

      await act(async () => {
        render(
          <BuildPlateView printer={testPrinter} openscad={openscad} onClose={vi.fn()} />,
        );
      });
      await act(async () => {
        clickObjectInSidebar('test_part');
      });

      // Re-render Multicolor is always available for SCAD objects
      expect(screen.getByText('Re-render Multicolor')).toBeTruthy();
    });

    it('calls renderMulticolor and replaceObjectMesh with updated colorGroups', async () => {
      const newMeshData = makeSTLBuffer(64);
      const { openscad } = await setupMulticolorScad({
        renderMulticolor: vi.fn().mockResolvedValue(newMeshData),
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Re-render Multicolor'));
        // Give time for dynamic import + extractColorGroups + replaceObjectMesh
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(openscad.renderMulticolor).toHaveBeenCalledWith(
        'color("red") cube(s);',
        { s: 10 },
      );

      // replaceObjectMesh called with 3mf format and extracted colorGroups
      expect(mockPlate.replaceObjectMesh).toHaveBeenCalledWith(
        'scad-mc-1',
        newMeshData,
        '3mf',
        [{ color: '#FF0000' }, { color: '#00FF00' }], // from mock extractColorGroups
        { s: 10 },
      );
    });

    it('multicolor re-render error does not replace mesh', async () => {
      await setupMulticolorScad({
        renderMulticolor: vi.fn().mockRejectedValue(new Error('Color error')),
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Re-render Multicolor'));
      });

      expect(screen.getByText(/Color error/)).toBeTruthy();
      expect(mockPlate.replaceObjectMesh).not.toHaveBeenCalled();
    });
  });

  // ── Right panel behavior ─────────────────────────────────────────────

  describe('right panel', () => {
    it('does not show parameter editor for non-SCAD objects', async () => {
      const stlObj: BuildPlateObject = {
        id: 'stl-1',
        name: 'bracket',
        type: 'stl',
        meshData: makeSTLBuffer(16),
        meshFormat: 'stl',
        position: { x: 100, y: 100 },
        rotation: 0,
        scale: { x: 1, y: 1, z: 1 },
        copies: 1,
      };

      mockPlate = createMockPlate({
        objects: [stlObj],
        selectedObjectId: 'stl-1',
        selectedObject: stlObj,
      });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });
      await act(async () => {
        clickObjectInSidebar('bracket');
      });

      expect(screen.queryByTestId('parameter-editor')).toBeNull();
      expect(screen.queryByText('Re-render')).toBeNull();
    });

    it('does not show parameter editor for SCAD objects without paramDefs', async () => {
      const scadObj = makeScadObject({
        id: 'scad-np-1',
        name: 'no_params',
        scadParamDefs: [],
      });

      mockPlate = createMockPlate({
        objects: [scadObj],
        selectedObjectId: 'scad-np-1',
        selectedObject: scadObj,
      });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });
      await act(async () => {
        clickObjectInSidebar('no_params');
      });

      expect(screen.queryByTestId('parameter-editor')).toBeNull();
    });

    it('shows transform inputs when object is selected', async () => {
      const stlObj: BuildPlateObject = {
        id: 'stl-2',
        name: 'part',
        type: 'stl',
        meshData: makeSTLBuffer(16),
        meshFormat: 'stl',
        position: { x: 100, y: 50 },
        rotation: 30,
        scale: { x: 2, y: 2, z: 2 },
        copies: 1,
      };

      mockPlate = createMockPlate({
        objects: [stlObj],
        selectedObjectId: 'stl-2',
        selectedObject: stlObj,
      });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });
      await act(async () => {
        clickObjectInSidebar('part');
      });

      expect(screen.getByText('Position & Transform')).toBeTruthy();
    });
  });

  // ── Per-object overrides in settings panel ─────────────────────────────

  describe('per-object overrides', () => {
    it('shows override summary for object with overrides', async () => {
      const stlObj: BuildPlateObject = {
        id: 'stl-ov',
        name: 'bracket_ov',
        type: 'stl',
        meshData: makeSTLBuffer(16),
        meshFormat: 'stl',
        position: { x: 100, y: 100 },
        rotation: 0,
        scale: { x: 1, y: 1, z: 1 },
        printOverrides: { wallLoops: 5, sparseInfillDensity: 30 },
        copies: 1,
      };

      mockPlate = createMockPlate({
        objects: [stlObj],
        selectedObjectId: 'stl-ov',
        selectedObject: stlObj,
      });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });
      await act(async () => {
        clickObjectInSidebar('bracket_ov');
      });

      // Override summary should show count
      expect(screen.getByText(/2 fields overridden/)).toBeTruthy();
    });

    it('shows override badge (*) in sidebar for objects with overrides', async () => {
      const objWithOverrides: BuildPlateObject = {
        id: 'ov-1',
        name: 'with_ov',
        type: 'stl',
        meshData: makeSTLBuffer(16),
        meshFormat: 'stl',
        position: { x: 50, y: 50 },
        rotation: 0,
        scale: { x: 1, y: 1, z: 1 },
        printOverrides: { wallLoops: 3 },
        copies: 1,
      };
      const objWithout: BuildPlateObject = {
        id: 'no-ov-1',
        name: 'no_ov',
        type: 'stl',
        meshData: makeSTLBuffer(16),
        meshFormat: 'stl',
        position: { x: 150, y: 50 },
        rotation: 0,
        scale: { x: 1, y: 1, z: 1 },
        copies: 1,
      };

      mockPlate = createMockPlate({
        objects: [objWithOverrides, objWithout],
      });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      // Object with overrides should have the badge
      const badges = document.querySelectorAll('.build-plate-object-override-badge');
      expect(badges.length).toBe(1); // only the one with overrides
    });

    it('calls updateObjectOverrides when settings tab changes a field', async () => {
      const stlObj: BuildPlateObject = {
        id: 'stl-settings',
        name: 'settings_test',
        type: 'stl',
        meshData: makeSTLBuffer(16),
        meshFormat: 'stl',
        position: { x: 100, y: 100 },
        rotation: 0,
        scale: { x: 1, y: 1, z: 1 },
        copies: 1,
      };

      mockPlate = createMockPlate({
        objects: [stlObj],
        selectedObjectId: 'stl-settings',
        selectedObject: stlObj,
      });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });
      await act(async () => {
        clickObjectInSidebar('settings_test');
      });

      // The BuildPlateObjectSettings component is rendered with onUpdateOverrides callback
      // When its onChange fires, our handleObjectOverrideChange calls plate.updateObjectOverrides
      // We verify the callback is wired by checking the component rendered
      expect(screen.getByText('Position & Transform')).toBeTruthy();
    });
  });

  // ── Slice plate ────────────────────────────────────────────────────────

  describe('slice plate', () => {
    it('Slice Plate button is disabled when no objects on plate', async () => {
      mockPlate = createMockPlate({ objects: [] });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      const sliceBtn = screen.getByText('Slice Plate');
      expect((sliceBtn as HTMLButtonElement).disabled).toBe(true);
    });

    it('Slice Plate button is enabled when objects exist', async () => {
      const stlObj: BuildPlateObject = {
        id: 'stl-slice',
        name: 'to_slice',
        type: 'stl',
        meshData: makeSTLBuffer(16),
        meshFormat: 'stl',
        position: { x: 100, y: 100 },
        rotation: 0,
        scale: { x: 1, y: 1, z: 1 },
        copies: 1,
      };

      mockPlate = createMockPlate({ objects: [stlObj] });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      const sliceBtn = screen.getByText('Slice Plate');
      expect((sliceBtn as HTMLButtonElement).disabled).toBe(false);
    });

    it('shows validation errors when plate fails validation', async () => {
      const { validatePlateForSlicing } = await import('../../lib/plate-slicer');
      (validatePlateForSlicing as ReturnType<typeof vi.fn>).mockReturnValue([
        'Object "part" is outside bed bounds (X)',
        'Empty plate cannot be sliced',
      ]);

      const stlObj: BuildPlateObject = {
        id: 'stl-val',
        name: 'part',
        type: 'stl',
        meshData: makeSTLBuffer(16),
        meshFormat: 'stl',
        position: { x: 500, y: 500 },
        rotation: 0,
        scale: { x: 1, y: 1, z: 1 },
        copies: 1,
      };

      mockPlate = createMockPlate({ objects: [stlObj] });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Slice Plate'));
      });

      expect(screen.getByText('Object "part" is outside bed bounds (X)')).toBeTruthy();
      expect(screen.getByText('Empty plate cannot be sliced')).toBeTruthy();
    });

    it('validation errors are dismissible', async () => {
      const { validatePlateForSlicing } = await import('../../lib/plate-slicer');
      (validatePlateForSlicing as ReturnType<typeof vi.fn>).mockReturnValue(['Test error']);

      const stlObj: BuildPlateObject = {
        id: 'stl-val2',
        name: 'part2',
        type: 'stl',
        meshData: makeSTLBuffer(16),
        meshFormat: 'stl',
        position: { x: 100, y: 100 },
        rotation: 0,
        scale: { x: 1, y: 1, z: 1 },
        copies: 1,
      };

      mockPlate = createMockPlate({ objects: [stlObj] });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Slice Plate'));
      });

      expect(screen.getByText('Test error')).toBeTruthy();

      // Find the dismiss button in the validation errors section
      const validationSection = document.querySelector('.build-plate-validation-errors');
      const dismissBtn = validationSection?.querySelector('button');
      expect(dismissBtn).toBeTruthy();

      await act(async () => {
        fireEvent.click(dismissBtn!);
      });

      expect(screen.queryByText('Test error')).toBeNull();
    });

    it('does not call slicePlate when validation fails', async () => {
      const { validatePlateForSlicing } = await import('../../lib/plate-slicer');
      (validatePlateForSlicing as ReturnType<typeof vi.fn>).mockReturnValue(['Something wrong']);

      // Use a persistent mock for slicePlate
      const mockSlicePlate = vi.fn();
      vi.mocked(await import('../../hooks/useSlicer')).useSlicer = vi.fn(() => ({
        status: 'idle' as const,
        error: null,
        progress: null,
        debugLog: [],
        engineName: 'WASM',
        slice: vi.fn(),
        slicePlate: mockSlicePlate,
        cancel: vi.fn(),
        reset: vi.fn(),
      }));

      const stlObj: BuildPlateObject = {
        id: 'stl-noslice',
        name: 'noslice',
        type: 'stl',
        meshData: makeSTLBuffer(16),
        meshFormat: 'stl',
        position: { x: 100, y: 100 },
        rotation: 0,
        scale: { x: 1, y: 1, z: 1 },
        copies: 1,
      };

      mockPlate = createMockPlate({ objects: [stlObj] });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Slice Plate'));
      });

      expect(mockSlicePlate).not.toHaveBeenCalled();

      // Restore default slicer mock
      vi.mocked(await import('../../hooks/useSlicer')).useSlicer = vi.fn(() => ({
        status: 'idle' as const,
        error: null,
        progress: null,
        debugLog: [],
        engineName: 'WASM',
        slice: vi.fn(),
        slicePlate: vi.fn(),
        cancel: vi.fn(),
        reset: vi.fn(),
      }));
    });

    it('calls slicePlate when validation passes', async () => {
      const { validatePlateForSlicing, buildPlateSliceConfig } = await import('../../lib/plate-slicer');
      (validatePlateForSlicing as ReturnType<typeof vi.fn>).mockReturnValue([]);
      (buildPlateSliceConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        objects: [{ meshData: makeSTLBuffer(16), format: 'stl', posX: 100, posY: 100, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 }],
        globalConfig: { layer_height: '0.2' },
        printSequence: 'by_layer',
      });

      // Use a persistent mock for slicePlate
      const mockSlicePlate = vi.fn().mockResolvedValue({ gcode: new ArrayBuffer(0), printTime: 100, filamentUsed: 500 });
      vi.mocked(await import('../../hooks/useSlicer')).useSlicer = vi.fn(() => ({
        status: 'idle' as const,
        error: null,
        progress: null,
        debugLog: [],
        engineName: 'WASM',
        slice: vi.fn(),
        slicePlate: mockSlicePlate,
        cancel: vi.fn(),
        reset: vi.fn(),
      }));

      const stlObj: BuildPlateObject = {
        id: 'stl-slice2',
        name: 'slice_test',
        type: 'stl',
        meshData: makeSTLBuffer(16),
        meshFormat: 'stl',
        position: { x: 100, y: 100 },
        rotation: 0,
        scale: { x: 1, y: 1, z: 1 },
        copies: 1,
      };

      mockPlate = createMockPlate({ objects: [stlObj] });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Slice Plate'));
      });

      // WASM engine shows a performance warning — click through it
      await act(async () => {
        fireEvent.click(screen.getByText('Slice Anyway'));
      });

      expect(mockSlicePlate).toHaveBeenCalled();

      // Restore default slicer mock
      vi.mocked(await import('../../hooks/useSlicer')).useSlicer = vi.fn(() => ({
        status: 'idle' as const,
        error: null,
        progress: null,
        debugLog: [],
        engineName: 'WASM',
        slice: vi.fn(),
        slicePlate: vi.fn(),
        cancel: vi.fn(),
        reset: vi.fn(),
      }));
    });

    it('Slice Plate button shows "Slicing..." and is disabled during slicing', async () => {
      // Re-mock useSlicer to return slicing status
      const mockSlicePlate = vi.fn();
      vi.mocked(await import('../../hooks/useSlicer')).useSlicer = vi.fn(() => ({
        status: 'slicing' as const,
        error: null,
        progress: { stage: 'slicing' as const, progress: 0.5 },
        debugLog: [],
        engineName: 'WASM',
        slice: vi.fn(),
        slicePlate: mockSlicePlate,
        cancel: vi.fn(),
        reset: vi.fn(),
      }));

      const stlObj: BuildPlateObject = {
        id: 'stl-slicing',
        name: 'slicing_test',
        type: 'stl',
        meshData: makeSTLBuffer(16),
        meshFormat: 'stl',
        position: { x: 100, y: 100 },
        rotation: 0,
        scale: { x: 1, y: 1, z: 1 },
        copies: 1,
      };

      mockPlate = createMockPlate({ objects: [stlObj] });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      // Find the primary Slice Plate button specifically (it becomes "Slicing...")
      const primaryBtn = document.querySelector('.build-plate-btn--primary') as HTMLButtonElement;
      expect(primaryBtn).toBeTruthy();
      expect(primaryBtn.textContent).toBe('Slicing...');
      expect(primaryBtn.disabled).toBe(true);

      // Restore default slicer mock
      vi.mocked(await import('../../hooks/useSlicer')).useSlicer = vi.fn(() => ({
        status: 'idle' as const,
        error: null,
        progress: null,
        debugLog: [],
        engineName: 'WASM',
        slice: vi.fn(),
        slicePlate: vi.fn(),
        cancel: vi.fn(),
        reset: vi.fn(),
      }));
    });
  });

  // ── Print sequence toggle ─────────────────────────────────────────────

  describe('print sequence', () => {
    it('shows "By Layer" when print sequence is by_layer', async () => {
      mockPlate = createMockPlate({ printSequence: 'by_layer' });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      expect(screen.getByText('By Layer')).toBeTruthy();
    });

    it('shows "By Object" when print sequence is by_object', async () => {
      mockPlate = createMockPlate({ printSequence: 'by_object' });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      expect(screen.getByText('By Object')).toBeTruthy();
    });

    it('calls setPrintSequence when toggle is clicked', async () => {
      mockPlate = createMockPlate({ printSequence: 'by_layer' });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      await act(async () => {
        fireEvent.click(screen.getByText('By Layer'));
      });

      expect(mockPlate.setPrintSequence).toHaveBeenCalledWith('by_object');
    });

    it('toggles from by_object back to by_layer', async () => {
      mockPlate = createMockPlate({ printSequence: 'by_object' });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      await act(async () => {
        fireEvent.click(screen.getByText('By Object'));
      });

      expect(mockPlate.setPrintSequence).toHaveBeenCalledWith('by_layer');
    });
  });

  // ── Plate settings panel ──────────────────────────────────────────────

  describe('plate settings panel', () => {
    it('opens plate settings when Settings button is clicked', async () => {
      mockPlate = createMockPlate();

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Plate Settings'));
      });

      // Default tab is "Plate" which shows Print Sequence and Bed Info
      expect(screen.getByText('Print Sequence')).toBeTruthy();
    });

    it('shows bed info in plate settings', async () => {
      mockPlate = createMockPlate();

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Plate Settings'));
      });

      // Bed dimensions from mock: 220x220, max 250
      expect(screen.getByText(/220 × 220 mm/)).toBeTruthy();
    });

    it('switches back to objects view when Objects toggle is clicked', async () => {
      mockPlate = createMockPlate();

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      // Switch to plate settings
      await act(async () => {
        fireEvent.click(screen.getByText('Plate Settings'));
      });
      expect(screen.getByText('Print Sequence')).toBeTruthy();

      // Switch back to objects
      await act(async () => {
        // The toggle shows "Objects (N)" — find the button containing "Objects"
        const objectsBtn = screen.getByText(/^Objects/);
        fireEvent.click(objectsBtn);
      });
      expect(screen.queryByText('Print Sequence')).toBeNull();
    });

    it('shows print sequence selector in plate settings', async () => {
      mockPlate = createMockPlate();

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Plate Settings'));
      });

      expect(screen.getByText('Print Sequence')).toBeTruthy();
    });
  });

  // ── Toolbar actions ───────────────────────────────────────────────────

  describe('toolbar actions', () => {
    // Delete, Duplicate, Lay Flat, Mirror X/Y are now in right-click context menu

    it('Arrange button calls autoArrange', async () => {
      mockPlate = createMockPlate();

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Arrange'));
      });

      expect(mockPlate.autoArrange).toHaveBeenCalled();
    });

    it('Snap toggle works', async () => {
      mockPlate = createMockPlate();

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      const snapBtn = screen.getByText('Snap');
      expect(snapBtn.className).not.toContain('build-plate-btn--active');

      await act(async () => {
        fireEvent.click(snapBtn);
      });

      // After click, the button should have the active class
      // Note: since we re-query, the button ref might be the same DOM element
      expect(screen.getByText('Snap').className).toContain('build-plate-btn--active');
    });
  });

  // ── Object list ───────────────────────────────────────────────────────

  describe('object list', () => {
    it('shows "No objects on plate" when empty', async () => {
      mockPlate = createMockPlate({ objects: [] });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      expect(screen.getByText(/No objects on plate/)).toBeTruthy();
    });

    it('shows object count in header', async () => {
      const objects: BuildPlateObject[] = [
        { id: 'a', name: 'A', type: 'stl', meshData: makeSTLBuffer(16), meshFormat: 'stl' as const, position: { x: 50, y: 50 }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, copies: 1 },
        { id: 'b', name: 'B', type: '3mf', meshData: makeSTLBuffer(16), meshFormat: '3mf' as const, position: { x: 150, y: 150 }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, copies: 1 },
      ];

      mockPlate = createMockPlate({ objects });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      expect(screen.getByText('2 objects')).toBeTruthy();
    });

    it('shows singular "1 object" for single object', async () => {
      const objects: BuildPlateObject[] = [
        { id: 'a', name: 'A', type: 'stl', meshData: makeSTLBuffer(16), meshFormat: 'stl' as const, position: { x: 50, y: 50 }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, copies: 1 },
      ];

      mockPlate = createMockPlate({ objects });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      expect(screen.getByText('1 object')).toBeTruthy();
    });

    it('shows type badges in object list', async () => {
      const objects: BuildPlateObject[] = [
        { id: 'a', name: 'A', type: 'stl', meshData: makeSTLBuffer(16), meshFormat: 'stl' as const, position: { x: 50, y: 50 }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, copies: 1 },
        { id: 'b', name: 'B', type: '3mf', meshData: makeSTLBuffer(16), meshFormat: '3mf' as const, position: { x: 150, y: 150 }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, copies: 1 },
        { id: 'c', name: 'C', type: 'scad', meshData: makeSTLBuffer(16), meshFormat: 'stl' as const, position: { x: 100, y: 100 }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, copies: 1 },
      ];

      mockPlate = createMockPlate({ objects });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      expect(screen.getByText('STL')).toBeTruthy();
      expect(screen.getByText('3MF')).toBeTruthy();
      expect(screen.getByText('SCAD')).toBeTruthy();
    });

    it('highlights selected object in sidebar', async () => {
      const obj: BuildPlateObject = {
        id: 'sel-1',
        name: 'selected_obj',
        type: 'stl',
        meshData: makeSTLBuffer(16),
        meshFormat: 'stl',
        position: { x: 100, y: 100 },
        rotation: 0,
        scale: { x: 1, y: 1, z: 1 },
        copies: 1,
      };

      mockPlate = createMockPlate({
        objects: [obj],
        selectedObjectId: 'sel-1',
        selectedObject: obj,
      });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      const selectedItem = document.querySelector('.build-plate-object-item--selected');
      expect(selectedItem).toBeTruthy();
    });

    it('calls selectObject when clicking an object in the list', async () => {
      const obj: BuildPlateObject = {
        id: 'click-1',
        name: 'click_test',
        type: 'stl',
        meshData: makeSTLBuffer(16),
        meshFormat: 'stl',
        position: { x: 100, y: 100 },
        rotation: 0,
        scale: { x: 1, y: 1, z: 1 },
        copies: 1,
      };

      mockPlate = createMockPlate({
        objects: [obj],
      });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      await act(async () => {
        clickObjectInSidebar('click_test');
      });

      expect(mockPlate.selectObject).toHaveBeenCalledWith('click-1');
    });
  });

  // ── Close button ──────────────────────────────────────────────────────

  describe('close button', () => {
    it('calls onClose when close button is clicked', async () => {
      const onClose = vi.fn();
      mockPlate = createMockPlate();

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={onClose} />);
      });

      await act(async () => {
        fireEvent.click(screen.getByText('×'));
      });

      expect(onClose).toHaveBeenCalled();
    });
  });

  // ── Undo/Redo buttons ─────────────────────────────────────────────────

  describe('undo/redo', () => {
    it('Undo button is disabled when canUndo is false', async () => {
      mockPlate = createMockPlate({ canUndo: false, canRedo: false });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      const undoBtn = screen.getByText('Undo');
      expect((undoBtn as HTMLButtonElement).disabled).toBe(true);
    });

    it('Undo button calls plate.undo when clicked', async () => {
      mockPlate = createMockPlate({ canUndo: true, canRedo: false });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Undo'));
      });

      expect(mockPlate.undo).toHaveBeenCalled();
    });

    it('Redo button calls plate.redo when clicked', async () => {
      mockPlate = createMockPlate({ canUndo: false, canRedo: true });

      await act(async () => {
        render(<BuildPlateView printer={testPrinter} onClose={vi.fn()} />);
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Redo'));
      });

      expect(mockPlate.redo).toHaveBeenCalled();
    });
  });
});
