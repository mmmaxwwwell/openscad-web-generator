// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AdhesionTab } from '../print-settings';
import { DEFAULT_PRINT_PROFILE } from '../../types/print-profile';
import type { PrintProfile } from '../../types/print-profile';

function renderTab(profileOverrides: Partial<PrintProfile> = {}) {
  const onChange = vi.fn();
  const profile = { ...DEFAULT_PRINT_PROFILE, ...profileOverrides };
  render(<AdhesionTab profile={profile} onChange={onChange} />);
  return { onChange, profile };
}

afterEach(cleanup);

describe('AdhesionTab', () => {
  it('renders with default profile (skirt selected, skirt fields visible)', () => {
    renderTab();
    expect(screen.getByText('Adhesion Type')).toBeTruthy();
    const label = screen.getByText('Adhesion Type').closest('label')!;
    const select = label.querySelector('select')!;
    expect(select.value).toBe('skirt');
    expect(screen.getByText('Skirt Loops')).toBeTruthy();
    expect(screen.getByText('Skirt Distance (mm)')).toBeTruthy();
  });

  it('onChange for adhesionType', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Adhesion Type').closest('label')!;
    const select = label.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'brim' } });
    expect(onChange).toHaveBeenCalledWith({ adhesionType: 'brim' });
  });

  it('onChange for skirtCount', () => {
    const { onChange } = renderTab();
    const input = screen.getByText('Skirt Loops').closest('label')!.querySelector('input')!;
    fireEvent.change(input, { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith({ skirtCount: 5 });
  });

  it('onChange for skirtDistance', () => {
    const { onChange } = renderTab();
    const input = screen.getByText('Skirt Distance (mm)').closest('label')!.querySelector('input')!;
    fireEvent.change(input, { target: { value: '4' } });
    expect(onChange).toHaveBeenCalledWith({ skirtDistance: 4 });
  });

  it('skirt fields hidden when brim selected', () => {
    renderTab({ adhesionType: 'brim' });
    expect(screen.queryByText('Skirt Loops')).toBeNull();
    expect(screen.queryByText('Skirt Distance (mm)')).toBeNull();
  });

  it('brim fields shown when brim selected', () => {
    renderTab({ adhesionType: 'brim' });
    expect(screen.getByText('Brim Width (mm)')).toBeTruthy();
    expect(screen.getByText('Brim Type')).toBeTruthy();
  });

  it('onChange for brimWidth', () => {
    const { onChange } = renderTab({ adhesionType: 'brim' });
    const input = screen.getByText('Brim Width (mm)').closest('label')!.querySelector('input')!;
    fireEvent.change(input, { target: { value: '12' } });
    expect(onChange).toHaveBeenCalledWith({ brimWidth: 12 });
  });

  it('onChange for brimType', () => {
    const { onChange } = renderTab({ adhesionType: 'brim' });
    const label = screen.getByText('Brim Type').closest('label')!;
    const select = label.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'brim_ears' } });
    expect(onChange).toHaveBeenCalledWith({ brimType: 'brim_ears' });
  });

  it('brim ears fields shown when brimType is ear', () => {
    renderTab({ adhesionType: 'brim', brimType: 'brim_ears' });
    expect(screen.getByText('Ears Detection Length (mm)')).toBeTruthy();
    expect(screen.getByText('Ears Max Angle (°)')).toBeTruthy();
  });

  it('brim ears fields hidden when brimType is auto', () => {
    renderTab({ adhesionType: 'brim', brimType: 'auto_brim' });
    expect(screen.queryByText('Ears Detection Length (mm)')).toBeNull();
    expect(screen.queryByText('Ears Max Angle (°)')).toBeNull();
  });

  it('onChange for brimEarsDetectionLength', () => {
    const { onChange } = renderTab({ adhesionType: 'brim', brimType: 'brim_ears' });
    const input = screen.getByText('Ears Detection Length (mm)').closest('label')!.querySelector('input')!;
    fireEvent.change(input, { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith({ brimEarsDetectionLength: 2 });
  });

  it('onChange for brimEarsMaxAngle', () => {
    const { onChange } = renderTab({ adhesionType: 'brim', brimType: 'brim_ears' });
    const input = screen.getByText('Ears Max Angle (°)').closest('label')!.querySelector('input')!;
    fireEvent.change(input, { target: { value: '130' } });
    expect(onChange).toHaveBeenCalledWith({ brimEarsMaxAngle: 130 });
  });

  it('raft fields shown when raft selected', () => {
    renderTab({ adhesionType: 'raft' });
    expect(screen.getByText('Raft Layers')).toBeTruthy();
  });

  it('onChange for raftLayers', () => {
    const { onChange } = renderTab({ adhesionType: 'raft' });
    const input = screen.getByText('Raft Layers').closest('label')!.querySelector('input')!;
    fireEvent.change(input, { target: { value: '3' } });
    expect(onChange).toHaveBeenCalledWith({ raftLayers: 3 });
  });

  it('no type-specific fields shown when none selected', () => {
    renderTab({ adhesionType: 'none' });
    expect(screen.queryByText('Skirt Loops')).toBeNull();
    expect(screen.queryByText('Skirt Distance (mm)')).toBeNull();
    expect(screen.queryByText('Brim Width (mm)')).toBeNull();
    expect(screen.queryByText('Brim Type')).toBeNull();
    expect(screen.queryByText('Raft Layers')).toBeNull();
  });
});
