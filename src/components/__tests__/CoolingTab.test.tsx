// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CoolingTab } from '../print-settings';
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
    fanSpeed: 100,
    fanMaxSpeed: 100,
    firstLayerFan: 0,
    enableOverhangBridgeFan: true,
    overhangFanSpeed: 100,
    overhangFanThreshold: 0,
    closeFanFirstLayers: 1,
    fanCoolingLayerTime: 60,
    slowDownLayerTime: 5,
    minSpeed: 10,
    minLayerTime: 5,
  };
  render(
    <CoolingTab
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

describe('CoolingTab', () => {
  it('renders with default props', () => {
    renderTab();
    expect(screen.getByText(/Fan Min Speed/)).toBeTruthy();
    expect(screen.getByText(/Fan Max Speed/)).toBeTruthy();
    expect(screen.getByText(/First Layer Fan/)).toBeTruthy();
    expect(screen.getByText('Overhang Fan')).toBeTruthy();
    expect(screen.getByText('Layer Cooling')).toBeTruthy();
  });

  it('renders "From PLA" hints when not overridden', () => {
    renderTab();
    const hints = screen.getAllByText('From PLA');
    expect(hints.length).toBeGreaterThan(0);
  });

  it('renders "reset" buttons when overridden', () => {
    renderTab({}, {
      isOverriddenFields: [
        'fanSpeed', 'fanMaxSpeed', 'firstLayerFan',
        'enableOverhangBridgeFan', 'overhangFanSpeed', 'overhangFanThreshold',
        'closeFanFirstLayers', 'fanCoolingLayerTime', 'slowDownLayerTime',
        'minSpeed', 'minLayerTime',
      ],
    });
    const resetButtons = screen.getAllByText('reset');
    expect(resetButtons.length).toBeGreaterThan(0);
  });

  it('clicking reset calls resetFilamentField', () => {
    const { resetFilamentField } = renderTab({}, {
      isOverriddenFields: ['fanSpeed'],
    });
    const resetButton = screen.getAllByText('reset')[0];
    fireEvent.click(resetButton);
    expect(resetFilamentField).toHaveBeenCalledWith('fanSpeed');
  });

  it('fan min speed slider calls updateFilamentField', () => {
    const { updateFilamentField } = renderTab();
    const label = screen.getByText(/Fan Min Speed/);
    const slider = label.closest('label')?.querySelector('input[type="range"]');
    expect(slider).toBeTruthy();
    fireEvent.change(slider!, { target: { value: '50' } });
    expect(updateFilamentField).toHaveBeenCalledWith('fanSpeed', 50);
  });

  it('fan max speed slider calls updateFilamentField', () => {
    const { updateFilamentField } = renderTab();
    const label = screen.getByText(/Fan Max Speed/);
    const slider = label.closest('label')?.querySelector('input[type="range"]');
    expect(slider).toBeTruthy();
    fireEvent.change(slider!, { target: { value: '80' } });
    expect(updateFilamentField).toHaveBeenCalledWith('fanMaxSpeed', 80);
  });

  it('first layer fan slider calls updateFilamentField', () => {
    const { updateFilamentField } = renderTab();
    const label = screen.getByText(/First Layer Fan/);
    const slider = label.closest('label')?.querySelector('input[type="range"]');
    expect(slider).toBeTruthy();
    fireEvent.change(slider!, { target: { value: '20' } });
    expect(updateFilamentField).toHaveBeenCalledWith('firstLayerFan', 20);
  });

  it('overhang fan enable checkbox calls updateFilamentField', () => {
    const { updateFilamentField } = renderTab();
    const label = screen.getByText('Enable Overhang/Bridge Fan');
    const checkbox = label.closest('label')?.querySelector('input[type="checkbox"]');
    expect(checkbox).toBeTruthy();
    fireEvent.click(checkbox!);
    expect(updateFilamentField).toHaveBeenCalledWith('enableOverhangBridgeFan', false);
  });

  it('overhang fan speed calls updateFilamentField', () => {
    const { updateFilamentField } = renderTab();
    const label = screen.getByText(/Overhang Fan Speed/);
    const slider = label.closest('label')?.querySelector('input[type="range"]');
    expect(slider).toBeTruthy();
    fireEvent.change(slider!, { target: { value: '75' } });
    expect(updateFilamentField).toHaveBeenCalledWith('overhangFanSpeed', 75);
  });

  it('overhang fan threshold dropdown calls updateFilamentField', () => {
    const { updateFilamentField } = renderTab();
    const label = screen.getByText('Overhang Fan Threshold');
    const select = label.closest('label')?.querySelector('select');
    expect(select).toBeTruthy();
    fireEvent.change(select!, { target: { value: '25' } });
    expect(updateFilamentField).toHaveBeenCalledWith('overhangFanThreshold', 25);
  });

  it('close fan first layers calls updateFilamentField', () => {
    const { updateFilamentField } = renderTab();
    const label = screen.getByText('Close Fan First X Layers');
    const input = label.closest('label')?.querySelector('input[type="number"]');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: '3' } });
    expect(updateFilamentField).toHaveBeenCalledWith('closeFanFirstLayers', 3);
  });

  it('fan cooling layer time calls updateFilamentField', () => {
    const { updateFilamentField } = renderTab();
    const label = screen.getByText('Fan Cooling Layer Time (s)');
    const input = label.closest('label')?.querySelector('input[type="number"]');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: '30' } });
    expect(updateFilamentField).toHaveBeenCalledWith('fanCoolingLayerTime', 30);
  });

  it('slow down layer time calls updateFilamentField', () => {
    const { updateFilamentField } = renderTab();
    const label = screen.getByText('Slow Down Layer Time (s)');
    const input = label.closest('label')?.querySelector('input[type="number"]');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: '10' } });
    expect(updateFilamentField).toHaveBeenCalledWith('slowDownLayerTime', 10);
  });

  it('slow down min speed calls updateFilamentField', () => {
    const { updateFilamentField } = renderTab();
    const label = screen.getByText('Slow Down Min Speed (mm/s)');
    const input = label.closest('label')?.querySelector('input[type="number"]');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: '15' } });
    expect(updateFilamentField).toHaveBeenCalledWith('minSpeed', 15);
  });

  it('min layer time calls updateFilamentField', () => {
    const { updateFilamentField } = renderTab();
    const label = screen.getByText('Min Layer Time (s)');
    const input = label.closest('label')?.querySelector('input[type="number"]');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: '8' } });
    expect(updateFilamentField).toHaveBeenCalledWith('minLayerTime', 8);
  });

  it('slow down layers (profile-level) calls onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Slow Down Layers');
    const input = label.closest('label')?.querySelector('input[type="number"]');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { value: '3' } });
    expect(onChange).toHaveBeenCalledWith({ slowDownLayers: 3 });
  });
});
