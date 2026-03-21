// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { InfillTab } from '../print-settings/InfillTab';
import type { PrintProfile } from '../../types/print-profile';
import { DEFAULT_PRINT_PROFILE } from '../../types/print-profile';

function renderTab(profileOverrides: Partial<PrintProfile> = {}) {
  const onChange = vi.fn();
  const profile = { ...DEFAULT_PRINT_PROFILE, ...profileOverrides };
  render(<InfillTab profile={profile} onChange={onChange} />);
  return { onChange, profile };
}

afterEach(cleanup);

describe('InfillTab', () => {
  it('renders with default profile', () => {
    renderTab();
    expect(screen.getByText(/Infill Density/)).toBeTruthy();
    expect(screen.getByText('Infill Pattern')).toBeTruthy();
    expect(screen.getByText(/Infill Angle/)).toBeTruthy();
    expect(screen.getByText(/Infill Overlap/)).toBeTruthy();
    expect(screen.getByText('Infill Combination')).toBeTruthy();
    expect(screen.getByText(/Sparse Infill Line Width/)).toBeTruthy();
  });

  it('density slider onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText(/Infill Density/).closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '30' } });
    expect(onChange).toHaveBeenCalledWith({ sparseInfillDensity: 30 });
  });

  it('infill pattern onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText('Infill Pattern').closest('label')!;
    const select = label.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'grid' } });
    expect(onChange).toHaveBeenCalledWith({ sparseInfillPattern: 'grid' });
  });

  it('infill angle onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText(/Infill Angle/).closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '90' } });
    expect(onChange).toHaveBeenCalledWith({ infillAngle: 90 });
  });

  it('overlap slider onChange', () => {
    const { onChange } = renderTab();
    const label = screen.getByText(/Infill Overlap/).closest('label')!;
    const input = label.querySelector('input')!;
    fireEvent.change(input, { target: { value: '30' } });
    expect(onChange).toHaveBeenCalledWith({ infillOverlap: 30 });
  });

  it('infill combination checkbox onChange', () => {
    const { onChange } = renderTab();
    const checkbox = screen.getByText('Infill Combination').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ infillCombination: true });
  });

  it('sparse infill line width defaults to auto', () => {
    renderTab();
    // Default value of 0 means auto — label shows "(auto)"
    expect(screen.getByText(/Sparse Infill Line Width.*auto/)).toBeTruthy();
  });

  it('sparse infill line width toggle from auto to manual', () => {
    const { onChange } = renderTab({ sparseInfillLineWidth: 0 });
    // Find the auto/manual checkbox within the line width label
    const label = screen.getByText(/Sparse Infill Line Width/).closest('label')!;
    const checkbox = label.querySelector('input[type="checkbox"]')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ sparseInfillLineWidth: 0.4 });
  });
});
