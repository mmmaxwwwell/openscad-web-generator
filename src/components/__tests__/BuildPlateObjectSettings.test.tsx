// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { BuildPlateObjectSettings } from '../BuildPlateObjectSettings';
import type { BuildPlateObjectSettingsProps } from '../BuildPlateObjectSettings';
import type { BuildPlateObject } from '../../types/build-plate';
import { DEFAULT_PRINT_PROFILE } from '../../types/print-profile';
import type { PrintProfile } from '../../types/print-profile';

// @vitest-environment jsdom

// ── Helpers ────────────────────────────────────────────────────────────────

function makeObject(overrides: Partial<BuildPlateObject> = {}): BuildPlateObject {
  return {
    id: 'obj-1',
    name: 'Test Object',
    type: 'stl',
    meshData: new ArrayBuffer(16),
    meshFormat: 'stl',
    position: { x: 100, y: 50 },
    rotation: 30,
    scale: { x: 1, y: 1, z: 1 },
    copies: 1,
    ...overrides,
  };
}

function makeProps(overrides: Partial<BuildPlateObjectSettingsProps> = {}): BuildPlateObjectSettingsProps {
  return {
    object: makeObject(),
    plateProfile: { ...DEFAULT_PRINT_PROFILE },
    onUpdateOverrides: vi.fn(),
    onClearOverrides: vi.fn(),
    onResetField: vi.fn(),
    onUpdateTransform: vi.fn(),
    onSetExtruder: vi.fn(),
    ...overrides,
  };
}

function renderSettings(overrides: Partial<BuildPlateObjectSettingsProps> = {}) {
  const props = makeProps(overrides);
  const result = render(<BuildPlateObjectSettings {...props} />);
  return { ...result, props };
}

/** Get the transform section's inputs by querying within the transform grid */
function getTransformInputs(container: HTMLElement) {
  const transformSection = container.querySelector('.build-plate-transform-section')!;
  return within(transformSection).getAllByRole('spinbutton') as HTMLInputElement[];
}

/** Click a settings tab button by its label text */
function clickTab(container: HTMLElement, tabName: string) {
  const tabBar = container.querySelector('.build-plate-settings-tab-bar')!;
  const btn = within(tabBar as HTMLElement).getByText(tabName);
  fireEvent.click(btn);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('BuildPlateObjectSettings', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Transform inputs ──────────────────────────────────────────────────

  describe('transform inputs', () => {
    it('renders Position & Transform heading', () => {
      renderSettings();
      expect(screen.getByText('Position & Transform')).toBeTruthy();
    });

    it('displays current position and rotation values', () => {
      const { container } = renderSettings({
        object: makeObject({ position: { x: 120.5, y: 80.3 }, rotation: 45 }),
      });
      const inputs = getTransformInputs(container);
      // X, Y, Rot, then Scale X
      expect(inputs[0].value).toBe('120.5');
      expect(inputs[1].value).toBe('80.3');
      expect(inputs[2].value).toBe('45');
    });

    it('updates X position via onUpdateTransform', () => {
      const { container, props } = renderSettings();
      const inputs = getTransformInputs(container);
      fireEvent.change(inputs[0], { target: { value: '150' } });
      expect(props.onUpdateTransform).toHaveBeenCalledWith('obj-1', {
        position: { x: 150, y: 50 },
      });
    });

    it('updates Y position via onUpdateTransform', () => {
      const { container, props } = renderSettings();
      const inputs = getTransformInputs(container);
      fireEvent.change(inputs[1], { target: { value: '200' } });
      expect(props.onUpdateTransform).toHaveBeenCalledWith('obj-1', {
        position: { x: 100, y: 200 },
      });
    });

    it('updates rotation via onUpdateTransform', () => {
      const { container, props } = renderSettings();
      const inputs = getTransformInputs(container);
      fireEvent.change(inputs[2], { target: { value: '90' } });
      expect(props.onUpdateTransform).toHaveBeenCalledWith('obj-1', {
        rotation: 90,
      });
    });

    it('uniform scale changes all axes', () => {
      const { container, props } = renderSettings();
      const inputs = getTransformInputs(container);
      // Scale X is after X, Y, Rot
      fireEvent.change(inputs[3], { target: { value: '2' } });
      expect(props.onUpdateTransform).toHaveBeenCalledWith('obj-1', {
        scale: { x: 2, y: 2, z: 2 },
      });
    });

    it('non-uniform scale shows Y and Z inputs after unchecking Uniform', () => {
      const { container } = renderSettings();
      const countBefore = getTransformInputs(container).length;

      // Click the Uniform checkbox to toggle it off
      const transformSection = container.querySelector('.build-plate-transform-section')!;
      const checkbox = within(transformSection as HTMLElement).getByRole('checkbox');
      fireEvent.click(checkbox);

      const countAfter = getTransformInputs(container).length;
      expect(countAfter).toBe(countBefore + 2);
    });

    it('non-uniform scale changes only one axis', () => {
      const { container, props } = renderSettings({
        object: makeObject({ scale: { x: 1, y: 1.5, z: 2 } }),
      });
      // Click Uniform checkbox off
      const transformSection = container.querySelector('.build-plate-transform-section')!;
      const checkbox = within(transformSection as HTMLElement).getByRole('checkbox');
      fireEvent.click(checkbox);

      const inputs = getTransformInputs(container);
      // inputs: X=0, Y=1, Rot=2, ScaleX=3, ScaleY=4, ScaleZ=5
      fireEvent.change(inputs[4], { target: { value: '3' } });
      expect(props.onUpdateTransform).toHaveBeenCalledWith('obj-1', {
        scale: { x: 1, y: 3, z: 2 },
      });
    });
  });

  // ── Extruder assignment ────────────────────────────────────────────────

  describe('extruder assignment', () => {
    it('shows extruder dropdown for multicolor objects', () => {
      renderSettings({
        object: makeObject({
          colorGroups: [{ color: '#FF0000' }, { color: '#00FF00' }],
        }),
      });
      expect(screen.getByText('Extruder Assignment')).toBeTruthy();
      expect(screen.getByText(/Extruder 1/)).toBeTruthy();
      expect(screen.getByText(/Extruder 2/)).toBeTruthy();
    });

    it('does not show extruder dropdown for single-color objects', () => {
      renderSettings({
        object: makeObject({ colorGroups: undefined }),
      });
      expect(screen.queryByText('Extruder Assignment')).toBeNull();
    });

    it('does not show extruder dropdown when onSetExtruder is not provided', () => {
      renderSettings({
        object: makeObject({
          colorGroups: [{ color: '#FF0000' }],
        }),
        onSetExtruder: undefined,
      });
      expect(screen.queryByText('Extruder Assignment')).toBeNull();
    });

    it('calls onSetExtruder when selection changes', () => {
      const { props } = renderSettings({
        object: makeObject({
          colorGroups: [{ color: '#FF0000' }, { color: '#00FF00' }],
        }),
      });
      const extruderSection = screen.getByText('Extruder Assignment').closest('.build-plate-extruder-section')!;
      const select = within(extruderSection as HTMLElement).getByRole('combobox') as HTMLSelectElement;
      fireEvent.change(select, { target: { value: '1' } });
      expect(props.onSetExtruder).toHaveBeenCalledWith('obj-1', 1);
    });

    it('displays color in extruder options', () => {
      renderSettings({
        object: makeObject({
          colorGroups: [{ color: '#FF0000' }, { color: '#00FF00' }],
        }),
      });
      expect(screen.getByText('Extruder 1 (#FF0000)')).toBeTruthy();
      expect(screen.getByText('Extruder 2 (#00FF00)')).toBeTruthy();
    });
  });

  // ── Override summary ───────────────────────────────────────────────────

  describe('override summary', () => {
    it('shows "Using plate defaults" when no overrides', () => {
      renderSettings({ object: makeObject({ printOverrides: undefined }) });
      expect(screen.getByText('Using plate defaults')).toBeTruthy();
    });

    it('shows "Using plate defaults" for empty overrides', () => {
      renderSettings({ object: makeObject({ printOverrides: {} }) });
      expect(screen.getByText('Using plate defaults')).toBeTruthy();
    });

    it('shows override count singular', () => {
      renderSettings({
        object: makeObject({ printOverrides: { wallLoops: 5 } }),
      });
      expect(screen.getByText('1 field overridden')).toBeTruthy();
    });

    it('shows override count plural', () => {
      renderSettings({
        object: makeObject({
          printOverrides: { wallLoops: 5, layerHeight: 0.1, sparseInfillDensity: 30 },
        }),
      });
      expect(screen.getByText('3 fields overridden')).toBeTruthy();
    });

    it('does not show Reset All when no overrides', () => {
      const { container } = renderSettings({ object: makeObject({ printOverrides: undefined }) });
      const summarySection = container.querySelector('.build-plate-override-summary')!;
      expect(within(summarySection as HTMLElement).queryByText('Reset All')).toBeNull();
    });

    it('shows Reset All button when overrides exist', () => {
      const { container } = renderSettings({
        object: makeObject({ printOverrides: { wallLoops: 5 } }),
      });
      const summarySection = container.querySelector('.build-plate-override-summary')!;
      expect(within(summarySection as HTMLElement).getByText('Reset All')).toBeTruthy();
    });

    it('calls onClearOverrides when Reset All is clicked', () => {
      const { container, props } = renderSettings({
        object: makeObject({ printOverrides: { wallLoops: 5 } }),
      });
      const summarySection = container.querySelector('.build-plate-override-summary')!;
      fireEvent.click(within(summarySection as HTMLElement).getByText('Reset All'));
      expect(props.onClearOverrides).toHaveBeenCalled();
    });
  });

  // ── Settings tabs ──────────────────────────────────────────────────────

  describe('settings tabs', () => {
    it('renders all 7 tab buttons', () => {
      const { container } = renderSettings();
      const tabBar = container.querySelector('.build-plate-settings-tab-bar')!;
      const expectedTabs = ['Quality', 'Walls', 'Infill', 'Speed', 'Support', 'Adhesion', 'Advanced'];
      for (const tab of expectedTabs) {
        expect(within(tabBar as HTMLElement).getByText(tab)).toBeTruthy();
      }
    });

    it('does not render Cooling or Retraction tabs', () => {
      const { container } = renderSettings();
      const tabBar = container.querySelector('.build-plate-settings-tab-bar')!;
      expect(within(tabBar as HTMLElement).queryByText('Cooling')).toBeNull();
      expect(within(tabBar as HTMLElement).queryByText('Retraction')).toBeNull();
    });

    it('Quality tab is active by default', () => {
      const { container } = renderSettings();
      const tabBar = container.querySelector('.build-plate-settings-tab-bar')!;
      const qualityBtn = within(tabBar as HTMLElement).getByText('Quality');
      expect(qualityBtn.className).toContain('active');
    });

    it('switching tabs activates the clicked tab', () => {
      const { container } = renderSettings();
      const tabBar = container.querySelector('.build-plate-settings-tab-bar')!;
      const tabs = ['Walls', 'Infill', 'Speed', 'Support', 'Adhesion', 'Advanced'];
      for (const tab of tabs) {
        const btn = within(tabBar as HTMLElement).getByText(tab);
        fireEvent.click(btn);
        expect(btn.className).toContain('active');
      }
    });

    it('tab onChange calls onUpdateOverrides', () => {
      const { container, props } = renderSettings();
      // Quality tab is default — find layer height input in the tab content
      const tabContent = container.querySelector('.build-plate-settings-tab-content')!;
      const layerInput = within(tabContent as HTMLElement).getByDisplayValue('0.2');
      fireEvent.change(layerInput, { target: { value: '0.1' } });
      expect(props.onUpdateOverrides).toHaveBeenCalled();
    });
  });

  // ── Merged profile display ────────────────────────────────────────────

  describe('merged profile', () => {
    it('shows plate value when no override', () => {
      // Use Walls tab with wallLoops for a clean single-input check
      const { container } = renderSettings({
        plateProfile: { ...DEFAULT_PRINT_PROFILE, wallLoops: 7 },
        object: makeObject({ printOverrides: undefined }),
      });
      clickTab(container, 'Walls');
      const tabContent = container.querySelector('.build-plate-settings-tab-content')!;
      expect(within(tabContent as HTMLElement).getByDisplayValue('7')).toBeTruthy();
    });

    it('shows overridden value instead of plate value', () => {
      const { container } = renderSettings({
        plateProfile: { ...DEFAULT_PRINT_PROFILE, wallLoops: 7 },
        object: makeObject({ printOverrides: { wallLoops: 3 } }),
      });
      clickTab(container, 'Walls');
      const tabContent = container.querySelector('.build-plate-settings-tab-content')!;
      expect(within(tabContent as HTMLElement).getByDisplayValue('3')).toBeTruthy();
      expect(within(tabContent as HTMLElement).queryByDisplayValue('7')).toBeNull();
    });
  });

  // ── Override indicators ───────────────────────────────────────────────

  describe('override indicators', () => {
    it('adds override-active class for overridden fields', () => {
      const { container } = renderSettings({
        object: makeObject({ printOverrides: { layerHeight: 0.1 } }),
      });
      const activeFields = container.querySelectorAll('.override-active');
      expect(activeFields.length).toBeGreaterThan(0);
    });

    it('adds override-inherited class for non-overridden fields when overrides exist', () => {
      const { container } = renderSettings({
        object: makeObject({ printOverrides: { layerHeight: 0.1 } }),
      });
      const inheritedFields = container.querySelectorAll('.override-inherited');
      expect(inheritedFields.length).toBeGreaterThan(0);
    });

    it('no override classes when no overrides', () => {
      const { container } = renderSettings({
        object: makeObject({ printOverrides: undefined }),
      });
      expect(container.querySelectorAll('.override-active').length).toBe(0);
      expect(container.querySelectorAll('.override-inherited').length).toBe(0);
    });

    it('shows reset button for overridden fields', () => {
      const { container } = renderSettings({
        object: makeObject({ printOverrides: { layerHeight: 0.1 } }),
      });
      const tabContent = container.querySelector('.build-plate-settings-tab-content')!;
      const resetBtns = (tabContent as HTMLElement).querySelectorAll('.override-reset-btn');
      expect(resetBtns.length).toBeGreaterThan(0);
    });

    it('does not show reset buttons when no overrides', () => {
      const { container } = renderSettings({
        object: makeObject({ printOverrides: undefined }),
      });
      const resetBtns = container.querySelectorAll('.override-reset-btn');
      expect(resetBtns.length).toBe(0);
    });

    it('reset button calls onResetField with the correct field name', () => {
      const { container, props } = renderSettings({
        object: makeObject({ printOverrides: { layerHeight: 0.1 } }),
      });
      const tabContent = container.querySelector('.build-plate-settings-tab-content')!;
      const resetBtn = (tabContent as HTMLElement).querySelector('.override-reset-btn')!;
      fireEvent.click(resetBtn);
      expect(props.onResetField).toHaveBeenCalledWith('layerHeight');
    });
  });

  // ── Override creation via field change ─────────────────────────────────

  describe('creating overrides', () => {
    it('changing a field calls onUpdateOverrides with the changed field', () => {
      const { container, props } = renderSettings();
      const tabContent = container.querySelector('.build-plate-settings-tab-content')!;
      const layerInput = within(tabContent as HTMLElement).getByDisplayValue('0.2');
      fireEvent.change(layerInput, { target: { value: '0.15' } });
      const call = (props.onUpdateOverrides as ReturnType<typeof vi.fn>).mock.calls[0][0] as Partial<PrintProfile>;
      expect(call).toHaveProperty('layerHeight');
    });

    it('changing wall loops on Walls tab creates wall override', () => {
      const { container, props } = renderSettings();
      clickTab(container, 'Walls');
      const tabContent = container.querySelector('.build-plate-settings-tab-content')!;
      const wallInput = within(tabContent as HTMLElement).getByDisplayValue(
        String(DEFAULT_PRINT_PROFILE.wallLoops),
      );
      fireEvent.change(wallInput, { target: { value: '5' } });
      const call = (props.onUpdateOverrides as ReturnType<typeof vi.fn>).mock.calls[0][0] as Partial<PrintProfile>;
      expect(call).toHaveProperty('wallLoops');
    });

    it('changing adhesion type on Adhesion tab creates adhesion override', () => {
      const { container, props } = renderSettings();
      clickTab(container, 'Adhesion');
      const tabContent = container.querySelector('.build-plate-settings-tab-content')!;
      const selects = (tabContent as HTMLElement).querySelectorAll('select');
      // First select is adhesion type
      fireEvent.change(selects[0], { target: { value: 'brim' } });
      const call = (props.onUpdateOverrides as ReturnType<typeof vi.fn>).mock.calls[0][0] as Partial<PrintProfile>;
      expect(call).toHaveProperty('adhesionType');
    });
  });
});
