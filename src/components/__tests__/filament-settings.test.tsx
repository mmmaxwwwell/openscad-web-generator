// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FilamentManager } from '../FilamentManager';
import type { FilamentProfile } from '../../hooks/useFilaments';

afterEach(cleanup);

const BASE_FILAMENT: FilamentProfile = {
  id: 'custom-1',
  builtin: false,
  name: 'Test PLA',
  type: 'pla',
  nozzleTemp: 210,
  bedTemp: 60,
  fanSpeed: 100,
  printSpeed: 50,
  retractDist: 4,
  retractSpeed: 45,
  firstLayerNozzleTemp: 215,
  firstLayerBedTemp: 65,
  minSpeed: 20,
  minLayerTime: 6,
  notes: 'test notes',
  // OrcaSlicer advanced fields
  flowRatio: 1.0,
  enablePressureAdvance: false,
  pressureAdvance: 0.04,
  adaptivePressureAdvance: false,
  overhangFanThreshold: 0,
  coolPlateTemp: 55,
  coolPlateTempInitialLayer: 60,
  engPlateTemp: 70,
  engPlateTempInitialLayer: 75,
  texturedPlateTemp: 65,
  texturedPlateTempInitialLayer: 70,
};

function renderManager(filamentOverrides: Partial<FilamentProfile> = {}) {
  const filament = { ...BASE_FILAMENT, ...filamentOverrides };
  const props = {
    filaments: [filament],
    onAdd: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onClose: vi.fn(),
  };
  render(<FilamentManager {...props} />);
  return props;
}

/** Click "Edit" on the first (non-builtin) filament to open FilamentForm */
function openEditForm() {
  const editBtn = screen.getByText('Edit');
  fireEvent.click(editBtn);
}

/** Open the Advanced section in the currently visible form */
function openAdvanced() {
  const summary = screen.getByText('Advanced');
  fireEvent.click(summary);
}

describe('FilamentManager', () => {
  describe('renders filament list', () => {
    it('shows filament name and details', () => {
      renderManager();
      expect(screen.getByText('Test PLA')).toBeTruthy();
      expect(screen.getByText(/210.*C.*60.*C.*100%.*50/)).toBeTruthy();
    });

    it('shows notes', () => {
      renderManager();
      expect(screen.getByText('test notes')).toBeTruthy();
    });

    it('shows Edit/Copy/Delete for custom filaments', () => {
      renderManager();
      expect(screen.getByText('Edit')).toBeTruthy();
      expect(screen.getByText('Copy')).toBeTruthy();
      expect(screen.getByText('Delete')).toBeTruthy();
    });

    it('hides Edit/Delete for built-in filaments', () => {
      renderManager({ builtin: true });
      expect(screen.queryByText('Edit')).toBeNull();
      expect(screen.queryByText('Delete')).toBeNull();
      expect(screen.getByText('Copy')).toBeTruthy();
    });
  });

  describe('edit form — basic fields', () => {
    it('renders basic fields when editing', () => {
      renderManager();
      openEditForm();
      expect(screen.getByText('Name')).toBeTruthy();
      expect(screen.getByText('Type')).toBeTruthy();
      expect(screen.getByText(/Nozzle Temp/)).toBeTruthy();
      expect(screen.getByText('Bed Temp (°C)')).toBeTruthy();
      expect(screen.getByText(/Fan Speed/)).toBeTruthy();
      expect(screen.getByText(/Print Speed/)).toBeTruthy();
      expect(screen.getByText(/Retract Dist/)).toBeTruthy();
      expect(screen.getByText(/Retract Speed/)).toBeTruthy();
      expect(screen.getByText('Notes')).toBeTruthy();
    });

    it('name field populates with filament name', () => {
      renderManager();
      openEditForm();
      const input = screen.getByText('Name').closest('label')!.querySelector('input')!;
      expect(input.value).toBe('Test PLA');
    });

    it('type field populates with filament type', () => {
      renderManager();
      openEditForm();
      const select = screen.getByText('Type').closest('label')!.querySelector('select')!;
      expect(select.value).toBe('pla');
    });

    it('name change calls onUpdate on save', () => {
      const props = renderManager();
      openEditForm();
      const input = screen.getByText('Name').closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: 'Updated PLA' } });
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ name: 'Updated PLA' }));
    });

    it('nozzle temp change', () => {
      const props = renderManager();
      openEditForm();
      const input = screen.getByText(/Nozzle Temp/).closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '220' } });
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ nozzleTemp: 220 }));
    });

    it('bed temp change', () => {
      const props = renderManager();
      openEditForm();
      const input = screen.getByText('Bed Temp (°C)').closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '70' } });
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ bedTemp: 70 }));
    });

    it('fan speed change', () => {
      const props = renderManager();
      openEditForm();
      const input = screen.getByText(/Fan Speed/).closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '80' } });
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ fanSpeed: 80 }));
    });

    it('print speed change', () => {
      const props = renderManager();
      openEditForm();
      const input = screen.getByText(/Print Speed/).closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '80' } });
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ printSpeed: 80 }));
    });

    it('retract dist change', () => {
      const props = renderManager();
      openEditForm();
      const input = screen.getByText(/Retract Dist/).closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '5' } });
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ retractDist: 5 }));
    });

    it('retract speed change', () => {
      const props = renderManager();
      openEditForm();
      const input = screen.getByText(/Retract Speed/).closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '60' } });
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ retractSpeed: 60 }));
    });

    it('type select change', () => {
      const props = renderManager();
      openEditForm();
      const select = screen.getByText('Type').closest('label')!.querySelector('select')!;
      fireEvent.change(select, { target: { value: 'petg' } });
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ type: 'petg' }));
    });

    it('cancel edit does not call onUpdate', () => {
      const props = renderManager();
      openEditForm();
      fireEvent.click(screen.getByText('Cancel'));
      expect(props.onUpdate).not.toHaveBeenCalled();
    });
  });

  describe('edit form — advanced fields', () => {
    it('renders Advanced section', () => {
      renderManager();
      openEditForm();
      expect(screen.getByText('Advanced')).toBeTruthy();
    });

    it('flow ratio slider renders with correct value', () => {
      renderManager();
      openEditForm();
      openAdvanced();
      const label = screen.getByText(/Flow Ratio.*1\.00/).closest('label')!;
      const input = label.querySelector('input[type="range"]')!;
      expect(input.value).toBe('1');
    });

    it('flow ratio change', () => {
      const props = renderManager();
      openEditForm();
      openAdvanced();
      const label = screen.getByText(/Flow Ratio/).closest('label')!;
      const input = label.querySelector('input[type="range"]')!;
      fireEvent.change(input, { target: { value: '0.95' } });
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ flowRatio: 0.95 }));
    });

    it('renders Pressure Advance section', () => {
      renderManager();
      openEditForm();
      openAdvanced();
      expect(screen.getByText('Pressure Advance')).toBeTruthy();
      expect(screen.getByText('Enable Pressure Advance')).toBeTruthy();
    });

    it('enable pressure advance checkbox', () => {
      const props = renderManager();
      openEditForm();
      openAdvanced();
      const checkbox = screen.getByText('Enable Pressure Advance').closest('label')!.querySelector('input[type="checkbox"]')!;
      expect(checkbox.checked).toBe(false);
      fireEvent.click(checkbox);
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ enablePressureAdvance: true }));
    });

    it('PA value and adaptive PA shown when PA enabled', () => {
      renderManager({ enablePressureAdvance: true });
      openEditForm();
      openAdvanced();
      expect(screen.getByText('PA Value')).toBeTruthy();
      expect(screen.getByText('Adaptive Pressure Advance')).toBeTruthy();
    });

    it('PA value and adaptive PA hidden when PA disabled', () => {
      renderManager({ enablePressureAdvance: false });
      openEditForm();
      openAdvanced();
      expect(screen.queryByText('PA Value')).toBeNull();
      expect(screen.queryByText('Adaptive Pressure Advance')).toBeNull();
    });

    it('PA value change', () => {
      const props = renderManager({ enablePressureAdvance: true });
      openEditForm();
      openAdvanced();
      const input = screen.getByText('PA Value').closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '0.06' } });
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ pressureAdvance: 0.06 }));
    });

    it('adaptive pressure advance toggle', () => {
      const props = renderManager({ enablePressureAdvance: true });
      openEditForm();
      openAdvanced();
      const checkbox = screen.getByText('Adaptive Pressure Advance').closest('label')!.querySelector('input[type="checkbox"]')!;
      fireEvent.click(checkbox);
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ adaptivePressureAdvance: true }));
    });

    it('renders Overhang Fan section', () => {
      renderManager();
      openEditForm();
      openAdvanced();
      expect(screen.getByText('Overhang Fan')).toBeTruthy();
      expect(screen.getByText('Overhang Fan Threshold')).toBeTruthy();
    });

    it('overhang fan threshold dropdown has all options', () => {
      renderManager();
      openEditForm();
      openAdvanced();
      const select = screen.getByText('Overhang Fan Threshold').closest('label')!.querySelector('select')!;
      const options = Array.from(select.querySelectorAll('option'));
      expect(options.map(o => o.textContent)).toEqual(['Auto', '25%', '50%', '75%', '95%']);
    });

    it('overhang fan threshold change', () => {
      const props = renderManager();
      openEditForm();
      openAdvanced();
      const select = screen.getByText('Overhang Fan Threshold').closest('label')!.querySelector('select')!;
      fireEvent.change(select, { target: { value: '50' } });
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ overhangFanThreshold: 50 }));
    });

    it('renders Multi-Plate Bed Temperatures section', () => {
      renderManager();
      openEditForm();
      openAdvanced();
      expect(screen.getByText('Multi-Plate Bed Temperatures')).toBeTruthy();
      expect(screen.getByText('Cool Plate Temp')).toBeTruthy();
      expect(screen.getByText('Cool Plate Initial')).toBeTruthy();
      expect(screen.getByText('Hot Plate Temp')).toBeTruthy();
      expect(screen.getByText('Hot Plate Initial')).toBeTruthy();
      expect(screen.getByText('Engineering Plate Temp')).toBeTruthy();
      expect(screen.getByText('Eng Plate Initial')).toBeTruthy();
      expect(screen.getByText('Textured Plate Temp')).toBeTruthy();
      expect(screen.getByText('Textured Plate Initial')).toBeTruthy();
    });

    it('cool plate temp change', () => {
      const props = renderManager();
      openEditForm();
      openAdvanced();
      const input = screen.getByText('Cool Plate Temp').closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '50' } });
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ coolPlateTemp: 50 }));
    });

    it('cool plate initial layer temp change', () => {
      const props = renderManager();
      openEditForm();
      openAdvanced();
      const input = screen.getByText('Cool Plate Initial').closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '55' } });
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ coolPlateTempInitialLayer: 55 }));
    });

    it('hot plate temp maps to bedTemp field', () => {
      const props = renderManager();
      openEditForm();
      openAdvanced();
      const input = screen.getByText('Hot Plate Temp').closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '75' } });
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ bedTemp: 75 }));
    });

    it('hot plate initial maps to firstLayerBedTemp field', () => {
      const props = renderManager();
      openEditForm();
      openAdvanced();
      const input = screen.getByText('Hot Plate Initial').closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '72' } });
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ firstLayerBedTemp: 72 }));
    });

    it('engineering plate temp change', () => {
      const props = renderManager();
      openEditForm();
      openAdvanced();
      const input = screen.getByText('Engineering Plate Temp').closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '80' } });
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ engPlateTemp: 80 }));
    });

    it('eng plate initial layer temp change', () => {
      const props = renderManager();
      openEditForm();
      openAdvanced();
      const input = screen.getByText('Eng Plate Initial').closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '85' } });
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ engPlateTempInitialLayer: 85 }));
    });

    it('textured plate temp change', () => {
      const props = renderManager();
      openEditForm();
      openAdvanced();
      const input = screen.getByText('Textured Plate Temp').closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '68' } });
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ texturedPlateTemp: 68 }));
    });

    it('textured plate initial layer temp change', () => {
      const props = renderManager();
      openEditForm();
      openAdvanced();
      const input = screen.getByText('Textured Plate Initial').closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '73' } });
      fireEvent.click(screen.getByText('Save'));
      expect(props.onUpdate).toHaveBeenCalledWith('custom-1', expect.objectContaining({ texturedPlateTempInitialLayer: 73 }));
    });
  });

  describe('add new filament', () => {
    it('clicking Add Custom Filament shows form', () => {
      renderManager();
      fireEvent.click(screen.getByText('Add Custom Filament'));
      // Form should be visible with "Add" button
      expect(screen.getByText('New Filament')).toBeTruthy();
      expect(screen.getByText('Add')).toBeTruthy();
    });

    it('adding filament calls onAdd with all fields', () => {
      const props = renderManager();
      fireEvent.click(screen.getByText('Add Custom Filament'));

      // Fill in name (required)
      const nameInput = screen.getByText('Name').closest('label')!.querySelector('input')!;
      fireEvent.change(nameInput, { target: { value: 'New PETG' } });

      // Change type
      const typeSelect = screen.getByText('Type').closest('label')!.querySelector('select')!;
      fireEvent.change(typeSelect, { target: { value: 'petg' } });

      fireEvent.click(screen.getByText('Add'));
      expect(props.onAdd).toHaveBeenCalledWith(expect.objectContaining({
        name: 'New PETG',
        type: 'petg',
        // OrcaSlicer defaults
        flowRatio: 1.0,
        enablePressureAdvance: false,
        pressureAdvance: 0.04,
        adaptivePressureAdvance: false,
        overhangFanThreshold: 0,
      }));
    });

    it('cancel add does not call onAdd', () => {
      const props = renderManager();
      fireEvent.click(screen.getByText('Add Custom Filament'));
      fireEvent.click(screen.getByText('Cancel'));
      expect(props.onAdd).not.toHaveBeenCalled();
    });

    it('empty name does not call onAdd', () => {
      const props = renderManager();
      fireEvent.click(screen.getByText('Add Custom Filament'));
      fireEvent.click(screen.getByText('Add'));
      expect(props.onAdd).not.toHaveBeenCalled();
    });
  });

  describe('actions', () => {
    it('delete calls onDelete', () => {
      const props = renderManager();
      fireEvent.click(screen.getByText('Delete'));
      expect(props.onDelete).toHaveBeenCalledWith('custom-1');
    });

    it('copy calls onDuplicate', () => {
      const props = renderManager();
      fireEvent.click(screen.getByText('Copy'));
      expect(props.onDuplicate).toHaveBeenCalledWith('custom-1');
    });

    it('close button calls onClose', () => {
      const props = renderManager();
      fireEvent.click(screen.getByText('×'));
      expect(props.onClose).toHaveBeenCalled();
    });
  });
});
