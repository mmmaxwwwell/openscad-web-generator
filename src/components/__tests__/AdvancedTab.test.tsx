// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AdvancedTab } from '../print-settings';
import { DEFAULT_PRINT_PROFILE } from '../../types/print-profile';
import type { PrintProfile } from '../../types/print-profile';

function renderTab(profileOverrides: Partial<PrintProfile> = {}) {
  const onChange = vi.fn();
  const profile = { ...DEFAULT_PRINT_PROFILE, ...profileOverrides };
  render(<AdvancedTab profile={profile} onChange={onChange} />);
  return { onChange, profile };
}

afterEach(cleanup);

describe('AdvancedTab', () => {
  it('renders with default profile', () => {
    renderTab();
    expect(screen.getByText('Pressure Advance')).toBeTruthy();
    expect(screen.getByText('Enable Pressure Advance')).toBeTruthy();
    expect(screen.getByText('Enable Arc Fitting (G2/G3)')).toBeTruthy();
    expect(screen.getByText('Fuzzy Skin Type')).toBeTruthy();
    expect(screen.getByText('Enable Hole-to-Polyhole')).toBeTruthy();
    expect(screen.getByText('Exclude Object (M486)')).toBeTruthy();
  });

  // --- Pressure Advance ---

  it('PA: enable toggle works', () => {
    const { onChange } = renderTab();
    const checkbox = screen.getByText('Enable Pressure Advance').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ pressureAdvanceEnable: true });
  });

  it('PA: PA value field shown when enabled, onChange works', () => {
    const { onChange } = renderTab({ pressureAdvanceEnable: true });
    const input = screen.getByText('PA Value').closest('label')!.querySelector('input')!;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: '0.05' } });
    expect(onChange).toHaveBeenCalledWith({ pressureAdvanceValue: 0.05 });
  });

  it('PA: adaptive toggle shown when PA enabled', () => {
    renderTab({ pressureAdvanceEnable: true });
    expect(screen.getByText('Adaptive Pressure Advance')).toBeTruthy();
  });

  it('PA: adaptive fields shown when both PA and adaptive enabled', () => {
    renderTab({ pressureAdvanceEnable: true, adaptivePressureAdvance: true });
    expect(screen.getByText('Adaptive PA Model Coefficient')).toBeTruthy();
    expect(screen.getByText('Adaptive PA for Overhangs')).toBeTruthy();
    expect(screen.getByText('PA Value for Bridges')).toBeTruthy();
  });

  it('PA: adaptive fields hidden when PA disabled', () => {
    renderTab({ pressureAdvanceEnable: false });
    expect(screen.queryByText('PA Value')).toBeNull();
    expect(screen.queryByText('Adaptive Pressure Advance')).toBeNull();
    expect(screen.queryByText('Adaptive PA Model Coefficient')).toBeNull();
  });

  // --- Arc Fitting ---

  it('Arc fitting: enable toggle, conditional resolution field', () => {
    const { onChange } = renderTab();
    // Resolution field should be hidden when arc fitting is disabled
    expect(screen.queryByText('GCode Resolution (mm)')).toBeNull();

    const checkbox = screen.getByText('Enable Arc Fitting (G2/G3)').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ arcFittingEnable: true });

    // Re-render with arc fitting enabled to check conditional field
    const { onChange: onChange2 } = renderTab({ arcFittingEnable: true });
    expect(screen.getByText('GCode Resolution (mm)')).toBeTruthy();
    const input = screen.getByText('GCode Resolution (mm)').closest('label')!.querySelector('input')!;
    fireEvent.change(input, { target: { value: '0.02' } });
    expect(onChange2).toHaveBeenCalledWith({ gcodeResolution: 0.02 });
  });

  // --- Fuzzy Skin ---

  it('Fuzzy skin: type dropdown onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Fuzzy Skin Type').closest('label')!;
    const select = label.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'external' } });
    expect(onChange).toHaveBeenCalledWith({ fuzzySkinType: 'external' });
  });

  it('Fuzzy skin: detail fields shown when type is not none', () => {
    renderTab({ fuzzySkinType: 'external' });
    expect(screen.getByText('Fuzzy Skin Mode')).toBeTruthy();
    expect(screen.getByText('Noise Type')).toBeTruthy();
    const label = screen.getByText('Noise Type').closest('label')!;
    const select = label.querySelector('select')!;
    expect(select.value).toBe('classic');
  });

  it('Fuzzy skin: detail fields hidden when type is none', () => {
    renderTab({ fuzzySkinType: 'none' });
    expect(screen.queryByText('Fuzzy Skin Mode')).toBeNull();
    expect(screen.queryByText('Noise Type')).toBeNull();
  });

  it('Fuzzy skin: detail fields shown for allwalls type', () => {
    renderTab({ fuzzySkinType: 'allwalls' });
    expect(screen.getByText('Fuzzy Skin Mode')).toBeTruthy();
    expect(screen.getByText('Noise Type')).toBeTruthy();
  });

  // --- Hole-to-Polyhole ---

  it('Hole-to-polyhole: enable toggle, conditional fields', () => {
    const { onChange } = renderTab();
    // Conditional fields hidden when disabled
    expect(screen.queryByText('Threshold (%)')).toBeNull();

    const checkbox = screen.getByText('Enable Hole-to-Polyhole').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ holeToPolyhole: true });

    // Re-render with enabled to check conditional fields
    renderTab({ holeToPolyhole: true });
    expect(screen.getByText('Threshold (%)')).toBeTruthy();
    expect(screen.getByText('Twisted Polyhole')).toBeTruthy();
  });

  // --- Other ---

  it('Exclude object onChange', () => {
    const { onChange } = renderTab();
    const checkbox = screen.getByText('Exclude Object (M486)').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ excludeObject: false });
  });

  it('Make overhang printable: enable toggle, conditional fields', () => {
    const { onChange } = renderTab();
    expect(screen.queryByText('Overhang Angle (°)')).toBeNull();

    const checkbox = screen.getByText('Make Overhang Printable').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ makeOverhangPrintable: true });

    // Re-render with enabled
    const { onChange: onChange2 } = renderTab({ makeOverhangPrintable: true });
    expect(screen.getByText('Overhang Angle (°)')).toBeTruthy();
    expect(screen.getByText('Overhang Hole Size (mm)')).toBeTruthy();

    const angleInput = screen.getByText('Overhang Angle (°)').closest('label')!.querySelector('input')!;
    fireEvent.change(angleInput, { target: { value: '60' } });
    expect(onChange2).toHaveBeenCalledWith({ makeOverhangPrintableAngle: 60 });
  });

  it('Volumetric flow: segment shown when rate > 0, hidden when 0', () => {
    renderTab({ maxVolumetricFlowSmoothingRate: 0 });
    expect(screen.queryByText('Smoothing Segment Length (mm)')).toBeNull();

    const { onChange } = renderTab({ maxVolumetricFlowSmoothingRate: 5 });
    expect(screen.getByText('Smoothing Segment Length (mm)')).toBeTruthy();
    const input = screen.getByText('Smoothing Segment Length (mm)').closest('label')!.querySelector('input')!;
    fireEvent.change(input, { target: { value: '4' } });
    expect(onChange).toHaveBeenCalledWith({ maxVolumetricFlowSmoothingSegment: 4 });
  });

  it('Print flow ratio onChange', () => {
    const { onChange } = renderTab();
    const input = screen.getByText('Print Flow Ratio').closest('label')!.querySelector('input')!;
    fireEvent.change(input, { target: { value: '0.95' } });
    expect(onChange).toHaveBeenCalledWith({ printFlowRatio: 0.95 });
  });

  it('Timelapse type onChange', () => {
    const { onChange } = renderTab();
    const select = screen.getByText('Timelapse Type').closest('label')!.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'smooth' } });
    expect(onChange).toHaveBeenCalledWith({ timelapseType: 'smooth' });
  });

  it('Spiral mode onChange', () => {
    const { onChange } = renderTab();
    const checkbox = screen.getByText('Spiral / Vase Mode').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ spiralMode: true });
  });

  it('Overhang reverse: enable toggle, conditional threshold', () => {
    const { onChange } = renderTab();
    expect(screen.queryByText('Overhang Reverse Threshold (%)')).toBeNull();

    const checkbox = screen.getByText('Overhang Reverse').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ overhangReverse: true });

    // Re-render with enabled
    const { onChange: onChange2 } = renderTab({ overhangReverse: true });
    expect(screen.getByText('Overhang Reverse Threshold (%)')).toBeTruthy();
    const input = screen.getByText('Overhang Reverse Threshold (%)').closest('label')!.querySelector('input')!;
    fireEvent.change(input, { target: { value: '60' } });
    expect(onChange2).toHaveBeenCalledWith({ overhangReverseThreshold: 60 });
  });

  it('Slow down layers onChange', () => {
    const { onChange } = renderTab();
    const input = screen.getByText('Slow Down for First N Layers').closest('label')!.querySelector('input')!;
    fireEvent.change(input, { target: { value: '3' } });
    expect(onChange).toHaveBeenCalledWith({ slowDownLayers: 3 });
  });
});
