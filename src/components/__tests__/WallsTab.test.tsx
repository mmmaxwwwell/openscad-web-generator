// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { WallsTab } from '../print-settings/WallsTab';
import type { PrintProfile } from '../../types/print-profile';
import { DEFAULT_PRINT_PROFILE } from '../../types/print-profile';

function renderTab(profileOverrides: Partial<PrintProfile> = {}) {
  const onChange = vi.fn();
  const profile = { ...DEFAULT_PRINT_PROFILE, ...profileOverrides };
  render(<WallsTab profile={profile} onChange={onChange} />);
  return { onChange, profile };
}

afterEach(cleanup);

describe('WallsTab', () => {
  it('renders with default profile', () => {
    renderTab();
    expect(screen.getByText('Wall Loops')).toBeTruthy();
    expect(screen.getByText('Wall Sequence')).toBeTruthy();
    expect(screen.getByText('Wall Generator')).toBeTruthy();
    expect(screen.getByText('Top Layers')).toBeTruthy();
    expect(screen.getByText('Bottom Layers')).toBeTruthy();
    expect(screen.getByText('Wall Options')).toBeTruthy();
  });

  // Number fields
  it('wall loops onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Wall Loops').closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith({ wallLoops: 5 });
  });

  it('top layers onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Top Layers').closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '6' } });
    expect(onChange).toHaveBeenCalledWith({ topLayers: 6 });
  });

  it('bottom layers onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Bottom Layers').closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '6' } });
    expect(onChange).toHaveBeenCalledWith({ bottomLayers: 6 });
  });

  // Dropdown fields
  it('wall sequence onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Wall Sequence').closest('label')!;
    const select = label.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'outer_inner' } });
    expect(onChange).toHaveBeenCalledWith({ wallSequence: 'outer_inner' });
  });

  it('wall generator onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Wall Generator').closest('label')!;
    const select = label.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'classic' } });
    expect(onChange).toHaveBeenCalledWith({ wallGenerator: 'classic' });
  });

  // Checkboxes
  it('precise outer wall onChange', () => {
    const { onChange } = renderTab();
    const checkbox = screen.getByText('Precise Outer Wall').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ preciseOuterWall: false });
  });

  it('detect thin wall onChange', () => {
    const { onChange } = renderTab();
    const checkbox = screen.getByText('Detect Thin Wall').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ detectThinWall: false });
  });

  it('detect overhang wall onChange', () => {
    const { onChange } = renderTab();
    const checkbox = screen.getByText('Detect Overhang Wall').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ detectOverhangWall: false });
  });

  it('only one wall on first layer onChange', () => {
    const { onChange } = renderTab();
    const checkbox = screen.getByText('Only One Wall on First Layer').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ onlyOneWallFirstLayer: true });
  });

  it('only one wall on top onChange', () => {
    const { onChange } = renderTab();
    const checkbox = screen.getByText('Only One Wall on Top').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ onlyOneWallTop: true });
  });

  it('extra perimeters on overhangs onChange', () => {
    const { onChange } = renderTab();
    const checkbox = screen.getByText('Extra Perimeters on Overhangs').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ extraPerimetersOnOverhangs: false });
  });

  it('staggered inner seams onChange', () => {
    const { onChange } = renderTab();
    const checkbox = screen.getByText('Staggered Inner Seams').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ staggeredInnerSeams: true });
  });

  it('slowdown for curled perimeters onChange', () => {
    const { onChange } = renderTab();
    const checkbox = screen.getByText('Slowdown for Curled Perimeters').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ slowdownForCurledPerimeters: false });
  });

  // Arachne conditional settings
  it('shows arachne settings when wallGenerator is arachne (default)', () => {
    renderTab();
    expect(screen.getByText('Min Bead Width (%)')).toBeTruthy();
    expect(screen.getByText('Min Feature Size (%)')).toBeTruthy();
    expect(screen.getByText(/Wall Transition Angle/)).toBeTruthy();
    expect(screen.getByText('Wall Transition Filter Deviation (%)')).toBeTruthy();
    expect(screen.getByText('Wall Transition Length (%)')).toBeTruthy();
    expect(screen.getByText('Wall Distribution Count')).toBeTruthy();
  });

  it('hides arachne settings when wallGenerator is classic', () => {
    renderTab({ wallGenerator: 'classic' });
    expect(screen.queryByText('Min Bead Width (%)')).toBeNull();
    expect(screen.queryByText('Min Feature Size (%)')).toBeNull();
    expect(screen.queryByText(/Wall Transition Angle/)).toBeNull();
    expect(screen.queryByText('Wall Transition Filter Deviation (%)')).toBeNull();
    expect(screen.queryByText('Wall Transition Length (%)')).toBeNull();
    expect(screen.queryByText('Wall Distribution Count')).toBeNull();
  });

  it('min bead width onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Min Bead Width (%)').closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '90' } });
    expect(onChange).toHaveBeenCalledWith({ minBeadWidth: 90 });
  });

  it('min feature size onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Min Feature Size (%)').closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '30' } });
    expect(onChange).toHaveBeenCalledWith({ minFeatureSize: 30 });
  });

  it('wall transition angle onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText(/Wall Transition Angle/).closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '15' } });
    expect(onChange).toHaveBeenCalledWith({ wallTransitionAngle: 15 });
  });

  it('wall transition filter deviation onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Wall Transition Filter Deviation (%)').closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '30' } });
    expect(onChange).toHaveBeenCalledWith({ wallTransitionFilterDeviation: 30 });
  });

  it('wall transition length onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Wall Transition Length (%)').closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '80' } });
    expect(onChange).toHaveBeenCalledWith({ wallTransitionLength: 80 });
  });

  it('wall distribution count onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Wall Distribution Count').closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith({ wallDistributionCount: 2 });
  });
});
