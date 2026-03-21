// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QualityTab } from '../print-settings/QualityTab';
import { DEFAULT_PRINT_PROFILE } from '../../types/print-profile';
import type { PrintProfile } from '../../types/print-profile';

// @vitest-environment jsdom

function renderTab(profileOverrides: Partial<PrintProfile> = {}) {
  const onChange = vi.fn();
  const profile = { ...DEFAULT_PRINT_PROFILE, ...profileOverrides };
  render(<QualityTab profile={profile} onChange={onChange} />);
  return { onChange, profile };
}

afterEach(cleanup);

describe('QualityTab', () => {
  it('renders with default profile', () => {
    const { onChange } = renderTab();
    expect(onChange).not.toHaveBeenCalled();
  });

  // -- Layer heights --
  it('renders layer height slider', () => {
    renderTab();
    expect(screen.getByText(/^Layer Height/)).toBeTruthy();
  });

  it('onChange called with layerHeight when slider changes', () => {
    const { onChange } = renderTab();
    const label = screen.getByText(/^Layer Height/).closest('label')!;
    const slider = label.querySelector('input')!;
    fireEvent.change(slider, { target: { value: '0.3' } });
    expect(onChange).toHaveBeenCalledWith({ layerHeight: 0.3 });
  });

  it('renders first layer height input', () => {
    renderTab();
    expect(screen.getByText(/First Layer Height/)).toBeTruthy();
  });

  it('onChange called with initialLayerPrintHeight', () => {
    const { onChange } = renderTab();
    const label = screen.getByText(/First Layer Height/).closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '0.25' } });
    expect(onChange).toHaveBeenCalledWith({ initialLayerPrintHeight: 0.25 });
  });

  it('renders adaptive layer height checkbox', () => {
    renderTab();
    expect(screen.getByText('Adaptive Layer Height')).toBeTruthy();
  });

  it('onChange called with adaptiveLayerHeight', () => {
    const { onChange } = renderTab();
    const checkbox = screen.getByText('Adaptive Layer Height').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ adaptiveLayerHeight: true });
  });

  it('renders precise Z height checkbox', () => {
    renderTab();
    expect(screen.getByText('Precise Z Height')).toBeTruthy();
  });

  it('onChange called with preciseZHeight', () => {
    const { onChange } = renderTab();
    const checkbox = screen.getByText('Precise Z Height').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ preciseZHeight: true });
  });

  // -- Line widths --
  const LINE_WIDTH_FIELDS: Array<{ label: RegExp; key: keyof PrintProfile }> = [
    { label: /^Default/, key: 'lineWidth' },
    { label: /^Outer Wall/, key: 'outerWallLineWidth' },
    { label: /^Inner Wall/, key: 'innerWallLineWidth' },
    { label: /^Top Surface/, key: 'topSurfaceLineWidth' },
    { label: /^Internal Solid Infill/, key: 'internalSolidInfillLineWidth' },
    { label: /^Sparse Infill/, key: 'sparseInfillLineWidth' },
    { label: /^Support/, key: 'supportLineWidth' },
    { label: /^Initial Layer/, key: 'initialLayerLineWidth' },
  ];

  for (const { label, key } of LINE_WIDTH_FIELDS) {
    it(`renders line width field for ${key}`, () => {
      renderTab();
      expect(screen.getByText(label)).toBeTruthy();
    });

    it(`onChange called with ${key} when auto checkbox toggled`, () => {
      // Default line width has value 0.4, others are 0 (auto)
      const isDefault = key === 'lineWidth';
      const { onChange } = renderTab();
      // Find the label text, then the auto checkbox in that container
      const labelEl = screen.getByText(label);
      const container = labelEl.closest('label')!;
      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      const autoCheckbox = checkboxes[0];
      fireEvent.click(autoCheckbox);
      if (isDefault) {
        // lineWidth default is 0.4 (not auto), clicking auto sets to 0
        expect(onChange).toHaveBeenCalledWith({ [key]: 0 });
      } else {
        // others default to 0 (auto), clicking auto unchecks -> sets to 0.4
        expect(onChange).toHaveBeenCalledWith({ [key]: 0.4 });
      }
    });
  }

  // -- Seam --
  it('renders seam position dropdown', () => {
    renderTab();
    expect(screen.getByText('Seam Position')).toBeTruthy();
  });

  it('onChange called with seamPosition', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Seam Position').closest('label')!;
    const select = label.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'random' } });
    expect(onChange).toHaveBeenCalledWith({ seamPosition: 'random' });
  });

  it('renders seam gap input', () => {
    renderTab();
    expect(screen.getByText('Seam Gap (mm)')).toBeTruthy();
  });

  it('onChange called with seamGap', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Seam Gap (mm)').closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '0.15' } });
    expect(onChange).toHaveBeenCalledWith({ seamGap: 0.15 });
  });

  it('renders staggered inner seams checkbox', () => {
    renderTab();
    expect(screen.getByText('Staggered Inner Seams')).toBeTruthy();
  });

  it('onChange called with staggeredInnerSeams', () => {
    const { onChange } = renderTab();
    const checkbox = screen.getByText('Staggered Inner Seams').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ staggeredInnerSeams: true });
  });

  // -- Scarf joint seam --
  it('renders scarf joint seam section', () => {
    renderTab();
    expect(screen.getByText('Scarf Joint Seam')).toBeTruthy();
  });

  it('renders slope type dropdown', () => {
    renderTab();
    expect(screen.getByText('Slope Type')).toBeTruthy();
  });

  it('onChange called with seamScarfType', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Slope Type').closest('label')!;
    const select = label.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'external' } });
    expect(onChange).toHaveBeenCalledWith({ seamScarfType: 'external' });
  });

  // Scarf conditional fields (only shown when seamScarfType !== 'none')
  it('shows conditional scarf fields when seamScarfType is external', () => {
    renderTab({ seamScarfType: 'external' });
    expect(screen.getByText('Conditional')).toBeTruthy();
    expect(screen.getByText(/Angle Threshold/)).toBeTruthy();
    expect(screen.getByText(/Overhang Threshold/)).toBeTruthy();
    expect(screen.getByText(/Joint Speed/)).toBeTruthy();
    expect(screen.getByText('Flow Ratio')).toBeTruthy();
    expect(screen.getByText(/Start Height/)).toBeTruthy();
    expect(screen.getByText('Entire Loop')).toBeTruthy();
    expect(screen.getByText(/Min Length/)).toBeTruthy();
    expect(screen.getByText('Steps')).toBeTruthy();
    expect(screen.getByText('Inner Walls')).toBeTruthy();
  });

  it('hides conditional scarf fields when slopeType is none', () => {
    renderTab({ seamScarfType: 'none' });
    expect(screen.queryByText('Conditional')).toBeNull();
  });

  it('onChange called with scarfSlopeConditional', () => {
    const { onChange } = renderTab({ seamScarfType: 'external' });
    const checkbox = screen.getByText('Conditional').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ scarfSlopeConditional: true });
  });

  it('onChange called with scarfAngleThreshold', () => {
    const { onChange } = renderTab({ seamScarfType: 'external' });
    const label = screen.getByText(/Angle Threshold/).closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '140' } });
    expect(onChange).toHaveBeenCalledWith({ scarfAngleThreshold: 140 });
  });

  it('onChange called with scarfOverhangThreshold', () => {
    const { onChange } = renderTab({ seamScarfType: 'external' });
    const label = screen.getByText(/Overhang Threshold/).closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '50' } });
    expect(onChange).toHaveBeenCalledWith({ scarfOverhangThreshold: 50 });
  });

  it('onChange called with scarfJointSpeed', () => {
    const { onChange } = renderTab({ seamScarfType: 'external' });
    const label = screen.getByText(/Joint Speed/).closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '20' } });
    expect(onChange).toHaveBeenCalledWith({ scarfJointSpeed: 20 });
  });

  it('onChange called with scarfJointFlowRatio', () => {
    const { onChange } = renderTab({ seamScarfType: 'external' });
    const label = screen.getByText('Flow Ratio').closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '0.95' } });
    expect(onChange).toHaveBeenCalledWith({ scarfJointFlowRatio: 0.95 });
  });

  it('onChange called with scarfStartHeight', () => {
    const { onChange } = renderTab({ seamScarfType: 'external' });
    const label = screen.getByText(/Start Height/).closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '0.5' } });
    expect(onChange).toHaveBeenCalledWith({ scarfStartHeight: 0.5 });
  });

  it('onChange called with scarfEntireLoop', () => {
    const { onChange } = renderTab({ seamScarfType: 'external' });
    const checkbox = screen.getByText('Entire Loop').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ scarfEntireLoop: true });
  });

  it('onChange called with scarfMinLength', () => {
    const { onChange } = renderTab({ seamScarfType: 'external' });
    const label = screen.getByText(/Min Length/).closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '20' } });
    expect(onChange).toHaveBeenCalledWith({ scarfMinLength: 20 });
  });

  it('onChange called with scarfSteps', () => {
    const { onChange } = renderTab({ seamScarfType: 'external' });
    const label = screen.getByText('Steps').closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '15' } });
    expect(onChange).toHaveBeenCalledWith({ scarfSteps: 15 });
  });

  it('onChange called with scarfInnerWalls', () => {
    const { onChange } = renderTab({ seamScarfType: 'external' });
    const checkbox = screen.getByText('Inner Walls').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ scarfInnerWalls: true });
  });
});
