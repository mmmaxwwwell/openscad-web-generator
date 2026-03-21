// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SpeedTab } from '../print-settings';
import { DEFAULT_PRINT_PROFILE } from '../../types/print-profile';
import type { PrintProfile } from '../../types/print-profile';

function renderTab(profileOverrides: Partial<PrintProfile> = {}) {
  const onChange = vi.fn();
  const profile = { ...DEFAULT_PRINT_PROFILE, ...profileOverrides };
  const { container } = render(<SpeedTab profile={profile} onChange={onChange} />);
  return { onChange, profile, container };
}

afterEach(cleanup);

describe('SpeedTab', () => {
  it('renders all four section headers', () => {
    renderTab();
    expect(screen.getByText('Speeds')).toBeTruthy();
    expect(screen.getByText('Acceleration')).toBeTruthy();
    expect(screen.getByText('Jerk')).toBeTruthy();
    expect(screen.getByText('Klipper Accel-to-Decel')).toBeTruthy();
  });

  describe('Speed fields', () => {
    it('renders speed inputs with unique default values', () => {
      renderTab();
      expect(screen.getByDisplayValue('300')).toBeTruthy(); // travelSpeed
      expect(screen.getByDisplayValue('6.5')).toBeTruthy(); // smallPerimeterThreshold
    });

    // Speed labels are like "Outer Wall (mm/s)" — these also appear in Jerk section
    // Use getAllByText and take [0] for the Speed section (first in DOM)
    it('calls onChange for outerWallSpeed', () => {
      const { onChange } = renderTab();
      // "Outer Wall (mm/s)" appears in both Speed and Jerk — take first
      const labels = screen.getAllByText(/^Outer Wall \(mm\/s\)/);
      const input = labels[0].closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '90' } });
      expect(onChange).toHaveBeenCalledWith({ outerWallSpeed: 90 });
    });

    it('calls onChange for gapFillSpeed', () => {
      const { onChange } = renderTab();
      // "Gap Fill (mm/s)" is unique to Speed section
      const label = screen.getByText(/Gap Fill/).closest('label')!;
      const input = label.querySelector('input')!;
      fireEvent.change(input, { target: { value: '40' } });
      expect(onChange).toHaveBeenCalledWith({ gapFillSpeed: 40 });
    });

    it('calls onChange for travelSpeed', () => {
      const { onChange } = renderTab();
      // "Travel (mm/s)" appears in both Speed and Jerk — take first
      const labels = screen.getAllByText(/^Travel \(mm\/s\)/);
      const input = labels[0].closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '250' } });
      expect(onChange).toHaveBeenCalledWith({ travelSpeed: 250 });
    });

    it('calls onChange for smallPerimeterThreshold', () => {
      const { onChange } = renderTab();
      const label = screen.getByText(/Small Perimeter Threshold/).closest('label')!;
      const input = label.querySelector('input')!;
      fireEvent.change(input, { target: { value: '8' } });
      expect(onChange).toHaveBeenCalledWith({ smallPerimeterThreshold: 8 });
    });
  });

  describe('Acceleration fields', () => {
    // Acceleration labels have "mm/s²" which makes them unique from Speed/Jerk

    it('calls onChange for bridgeAcceleration', () => {
      const { onChange } = renderTab();
      // Use the superscript 2 character (rendered from &sup2;)
      const labels = screen.getAllByText(/^Bridge/);
      // Find the one in acceleration section (has mm/s² text)
      const accelLabel = labels.find(l => l.textContent?.includes('²'));
      const input = accelLabel!.closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '800' } });
      expect(onChange).toHaveBeenCalledWith({ bridgeAcceleration: 800 });
    });

    it('calls onChange for defaultAcceleration', () => {
      const { onChange } = renderTab();
      // "Default" appears in both Acceleration and Jerk. Find by ²
      const labels = screen.getAllByText(/^Default/);
      const accelLabel = labels.find(l => l.textContent?.includes('²'));
      const input = accelLabel!.closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '3000' } });
      expect(onChange).toHaveBeenCalledWith({ defaultAcceleration: 3000 });
    });
  });

  describe('Jerk fields', () => {
    it('calls onChange for infillJerk', () => {
      const { onChange } = renderTab();
      // "Infill (mm/s)" in jerk section is unique — Speed section uses "Sparse Infill"
      const label = screen.getByText(/^Infill \(mm\/s\)/).closest('label')!;
      const input = label.querySelector('input')!;
      fireEvent.change(input, { target: { value: '8' } });
      expect(onChange).toHaveBeenCalledWith({ infillJerk: 8 });
    });

    it('calls onChange for defaultJerk', () => {
      const { onChange } = renderTab();
      // "Default (mm/s)" — in jerk section (not acceleration which has ²)
      const labels = screen.getAllByText(/^Default/);
      const jerkLabel = labels.find(l => l.textContent && l.textContent.includes('mm/s') && !l.textContent.includes('²'));
      const input = jerkLabel!.closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { value: '8' } });
      expect(onChange).toHaveBeenCalledWith({ defaultJerk: 8 });
    });
  });

  describe('Klipper Accel-to-Decel', () => {
    it('renders enable checkbox unchecked by default', () => {
      renderTab();
      const checkbox = screen.getByText('Enable Accel-to-Decel').closest('label')!.querySelector('input')!;
      expect(checkbox.checked).toBe(false);
    });

    it('calls onChange when enable checkbox is toggled', () => {
      const { onChange } = renderTab();
      const checkbox = screen.getByText('Enable Accel-to-Decel').closest('label')!.querySelector('input')!;
      fireEvent.click(checkbox);
      expect(onChange).toHaveBeenCalledWith({ accelToDecelEnable: true });
    });

    it('hides accel-to-decel factor when disabled', () => {
      renderTab({ accelToDecelEnable: false });
      expect(screen.queryByText(/Accel-to-Decel Factor/)).toBeNull();
    });

    it('shows accel-to-decel factor when enabled', () => {
      renderTab({ accelToDecelEnable: true });
      expect(screen.getByText(/Accel-to-Decel Factor/)).toBeTruthy();
    });

    it('calls onChange for accel-to-decel factor', () => {
      const { onChange } = renderTab({ accelToDecelEnable: true });
      const label = screen.getByText(/Accel-to-Decel Factor/).closest('label')!;
      const input = label.querySelector('input')!;
      fireEvent.change(input, { target: { value: '75' } });
      expect(onChange).toHaveBeenCalledWith({ accelToDecelFactor: 75 });
    });
  });
});
