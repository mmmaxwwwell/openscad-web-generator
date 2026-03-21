// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SupportTab } from '../print-settings';
import { DEFAULT_PRINT_PROFILE } from '../../types/print-profile';
import type { PrintProfile } from '../../types/print-profile';

function renderTab(profileOverrides: Partial<PrintProfile> = {}) {
  const onChange = vi.fn();
  const profile = { ...DEFAULT_PRINT_PROFILE, ...profileOverrides };
  render(<SupportTab profile={profile} onChange={onChange} />);
  return { onChange, profile };
}

afterEach(cleanup);

describe('SupportTab', () => {
  it('renders with default profile (support disabled)', () => {
    renderTab();
    const checkbox = screen.getByText('Enable Supports').closest('label')!.querySelector('input')!;
    expect(checkbox.checked).toBe(false);
  });

  it('hides support fields when disabled', () => {
    renderTab({ supportEnabled: false });
    expect(screen.queryByText('Support Type')).toBeNull();
    expect(screen.queryByText(/Threshold Angle/)).toBeNull();
    expect(screen.queryByText(/Support Density/)).toBeNull();
  });

  it('shows support fields when enabled', () => {
    renderTab({ supportEnabled: true });
    expect(screen.getByText('Support Type')).toBeTruthy();
    expect(screen.getByText(/Threshold Angle/)).toBeTruthy();
    expect(screen.getByText(/Support Density/)).toBeTruthy();
    expect(screen.getByText(/XY Offset/)).toBeTruthy();
    expect(screen.getByText(/Z Gap/)).toBeTruthy();
    expect(screen.getByText('On Build Plate Only')).toBeTruthy();
    expect(screen.getByText('Interface Top Layers')).toBeTruthy();
  });

  it('calls onChange for supportEnabled', () => {
    const { onChange } = renderTab();
    const checkbox = screen.getByText('Enable Supports').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ supportEnabled: true });
  });

  it('calls onChange for supportType dropdown', () => {
    const { onChange } = renderTab({ supportEnabled: true });
    const label = screen.getByText('Support Type').closest('label')!;
    const select = label.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'tree_auto' } });
    expect(onChange).toHaveBeenCalledWith({ supportType: 'tree_auto' });
  });

  it('calls onChange for threshold angle', () => {
    const { onChange } = renderTab({ supportEnabled: true });
    const label = screen.getByText(/Threshold Angle/).closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '60' } });
    expect(onChange).toHaveBeenCalledWith({ supportThresholdAngle: 60 });
  });

  it('calls onChange for support density', () => {
    const { onChange } = renderTab({ supportEnabled: true });
    const label = screen.getByText(/Support Density/).closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '30' } });
    expect(onChange).toHaveBeenCalledWith({ supportDensity: 30 });
  });

  it('calls onChange for XY offset', () => {
    const { onChange } = renderTab({ supportEnabled: true });
    const label = screen.getByText(/XY Offset/).closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '0.5' } });
    expect(onChange).toHaveBeenCalledWith({ supportXYOffset: 0.5 });
  });

  it('calls onChange for Z gap', () => {
    const { onChange } = renderTab({ supportEnabled: true });
    const label = screen.getByText(/Z Gap/).closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith({ supportZGap: 2 });
  });

  it('calls onChange for supportOnBuildPlateOnly', () => {
    const { onChange } = renderTab({ supportEnabled: true });
    const checkbox = screen.getByText('On Build Plate Only').closest('label')!.querySelector('input')!;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ supportOnBuildPlateOnly: true });
  });

  it('calls onChange for interface layers', () => {
    const { onChange } = renderTab({ supportEnabled: true });
    const label = screen.getByText('Interface Top Layers').closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith({ supportInterfaceLayers: 5 });
  });

  it('handles support line width auto toggle', () => {
    const { onChange } = renderTab({ supportEnabled: true });
    const label = screen.getByText(/Support Line Width/).closest('label')!;
    const checkbox = label.querySelector('input[type="checkbox"]')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ supportLineWidth: 0.4 });
  });

  it('shows tree support note when type is tree_auto', () => {
    renderTab({ supportEnabled: true, supportType: 'tree_auto' });
    expect(screen.getByText('Tree Support Settings')).toBeTruthy();
  });

  it('hides tree support note when type is normal_auto', () => {
    renderTab({ supportEnabled: true, supportType: 'normal_auto' });
    expect(screen.queryByText('Tree Support Settings')).toBeNull();
  });
});
