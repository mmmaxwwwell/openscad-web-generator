// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { RetractionTab } from '../print-settings';
import { DEFAULT_PRINT_PROFILE } from '../../types/print-profile';
import type { PrintProfile } from '../../types/print-profile';

function renderTab(
  profileOverrides: Partial<PrintProfile> = {},
  overrides: { isOverriddenFields?: string[] } = {}
) {
  const onChange = vi.fn();
  const updateFilamentField = vi.fn();
  const resetFilamentField = vi.fn();
  const isOverridden = vi.fn((field: string) =>
    (overrides.isOverriddenFields ?? []).includes(field)
  );
  const profile = { ...DEFAULT_PRINT_PROFILE, ...profileOverrides };
  const resolved = {
    retractDist: 0.8,
    retractSpeed: 30,
    deretractionSpeed: 0,
  };
  render(
    <RetractionTab
      profile={profile}
      onChange={onChange}
      resolved={resolved as any}
      filamentName="PLA"
      isOverridden={isOverridden as any}
      updateFilamentField={updateFilamentField as any}
      resetFilamentField={resetFilamentField as any}
    />
  );
  return { onChange, updateFilamentField, resetFilamentField, isOverridden };
}

afterEach(cleanup);

describe('RetractionTab', () => {
  it('renders with default props', () => {
    renderTab();
    expect(screen.getByText('Retraction Length (mm)')).toBeTruthy();
    expect(screen.getByText('Retraction Speed (mm/s)')).toBeTruthy();
    expect(screen.getByText('Deretraction Speed (mm/s)')).toBeTruthy();
    expect(screen.getByText('Z-Hop')).toBeTruthy();
    expect(screen.getByText('Wipe & Coast')).toBeTruthy();
    expect(screen.getByText('Toolchange')).toBeTruthy();
  });

  it('renders "From PLA" for filament-level fields', () => {
    renderTab();
    const hints = screen.getAllByText('From PLA');
    expect(hints.length).toBeGreaterThan(0);
  });

  it('retraction length calls updateFilamentField', () => {
    const { updateFilamentField } = renderTab();
    const label = screen.getByText('Retraction Length (mm)');
    const input = label.closest('label')?.querySelector('input[type="number"]');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: '1.2' } });
    expect(updateFilamentField).toHaveBeenCalledWith('retractDist', 1.2);
  });

  it('retraction speed calls updateFilamentField', () => {
    const { updateFilamentField } = renderTab();
    const label = screen.getByText('Retraction Speed (mm/s)');
    const input = label.closest('label')?.querySelector('input[type="number"]');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: '45' } });
    expect(updateFilamentField).toHaveBeenCalledWith('retractSpeed', 45);
  });

  it('deretraction speed calls updateFilamentField', () => {
    const { updateFilamentField } = renderTab();
    const label = screen.getByText('Deretraction Speed (mm/s)');
    const input = label.closest('label')?.querySelector('input[type="number"]');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: '20' } });
    expect(updateFilamentField).toHaveBeenCalledWith('deretractionSpeed', 20);
  });

  it('retract on layer change checkbox calls onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Retract on Layer Change');
    const checkbox = label.closest('label')?.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeTruthy();
    fireEvent.click(checkbox!);
    expect(onChange).toHaveBeenCalledWith({ retractOnLayerChange: false });
  });

  it('z-hop height calls onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Z-Hop Height (mm)');
    const input = label.closest('label')?.querySelector('input[type="number"]');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: '0.4' } });
    expect(onChange).toHaveBeenCalledWith({ zHopHeight: 0.4 });
  });

  it('z-hop type dropdown calls onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Z-Hop Type');
    const select = label.closest('label')?.querySelector('select');
    expect(select).toBeTruthy();
    fireEvent.change(select!, { target: { value: 'spiral' } });
    expect(onChange).toHaveBeenCalledWith({ zHopType: 'spiral' });
  });

  it('wipe distance calls onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Wipe Distance (mm)');
    const input = label.closest('label')?.querySelector('input[type="number"]');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: '3' } });
    expect(onChange).toHaveBeenCalledWith({ wipeDistance: 3 });
  });

  it('coast distance calls onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Coast Distance (mm)');
    const input = label.closest('label')?.querySelector('input[type="number"]');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: '0.5' } });
    expect(onChange).toHaveBeenCalledWith({ coastDistance: 0.5 });
  });

  it('retract length toolchange calls onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Retract Length Toolchange (mm)');
    const input = label.closest('label')?.querySelector('input[type="number"]');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: '15' } });
    expect(onChange).toHaveBeenCalledWith({ retractLengthToolchange: 15 });
  });
});
