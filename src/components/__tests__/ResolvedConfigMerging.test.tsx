// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QualityTab } from '../print-settings/QualityTab';
import { SpeedTab } from '../print-settings/SpeedTab';
import { SupportTab } from '../print-settings/SupportTab';
import { InfillTab } from '../print-settings/InfillTab';
import { DEFAULT_PRINT_PROFILE } from '../../types/print-profile';
import type { PrintProfile } from '../../types/print-profile';

afterEach(cleanup);

/**
 * Tests for the resolved config merging priority chain across all settings tabs.
 * Priority: resolvedConfigs (post-slice) > autoValues (pre-slice) > hardcoded fallback
 *
 * Three field patterns are tested:
 * 1. Line width fields (QualityTab, SupportTab, InfillTab): resolved > auto > 0.4 fallback
 * 2. Speed fields (SpeedTab, SupportTab): resolved > "auto" placeholder
 * 3. Angle fields (InfillTab): resolved > "auto" placeholder, 45° fallback on uncheck
 */

// ---------------------------------------------------------------------------
// QualityTab — LineWidthField priority
// ---------------------------------------------------------------------------
describe('QualityTab resolved config merging', () => {
  function renderQuality(opts: {
    profileOverrides?: Partial<PrintProfile>;
    autoValues?: Record<string, number>;
    resolvedConfigs?: Record<string, string>;
  } = {}) {
    const onChange = vi.fn();
    const profile = { ...DEFAULT_PRINT_PROFILE, ...opts.profileOverrides };
    render(
      <QualityTab
        profile={profile}
        onChange={onChange}
        autoValues={opts.autoValues}
        resolvedConfigs={opts.resolvedConfigs}
      />
    );
    return { onChange };
  }

  // Helper: find the line width field container by label regex, return the number input
  function getLineWidthInput(label: RegExp): HTMLInputElement {
    const el = screen.getByText(label);
    return el.closest('label')!.querySelector('input[type="number"]')! as HTMLInputElement;
  }

  // Helper: find the auto checkbox for a line width field
  function getAutoCheckbox(label: RegExp): HTMLInputElement {
    const el = screen.getByText(label);
    return el.closest('label')!.querySelector('input[type="checkbox"]')! as HTMLInputElement;
  }

  it('shows hardcoded fallback (0.4) when auto, no autoValues, no resolvedConfigs', () => {
    // outerWallLineWidth defaults to 0 (auto)
    renderQuality();
    const input = getLineWidthInput(/^Outer Wall/);
    expect(input.disabled).toBe(true);
    expect(Number(input.value)).toBe(0.4);
  });

  it('shows autoValue when auto, autoValues provided, no resolvedConfigs', () => {
    renderQuality({
      autoValues: { outerWallLineWidth: 0.6 },
    });
    const input = getLineWidthInput(/^Outer Wall/);
    expect(input.disabled).toBe(true);
    expect(Number(input.value)).toBe(0.6);
  });

  it('shows resolvedConfig when auto, resolvedConfigs provided, no autoValues', () => {
    renderQuality({
      resolvedConfigs: { outer_wall_line_width: '0.45' },
    });
    const input = getLineWidthInput(/^Outer Wall/);
    expect(input.disabled).toBe(true);
    expect(Number(input.value)).toBe(0.45);
  });

  it('resolvedConfig takes priority over autoValue when both provided', () => {
    renderQuality({
      autoValues: { outerWallLineWidth: 0.6 },
      resolvedConfigs: { outer_wall_line_width: '0.42' },
    });
    const input = getLineWidthInput(/^Outer Wall/);
    expect(Number(input.value)).toBe(0.42);
  });

  it('shows actual value when not auto, ignoring autoValues and resolvedConfigs', () => {
    renderQuality({
      profileOverrides: { outerWallLineWidth: 0.5 },
      autoValues: { outerWallLineWidth: 0.6 },
      resolvedConfigs: { outer_wall_line_width: '0.42' },
    });
    const input = getLineWidthInput(/^Outer Wall/);
    expect(input.disabled).toBe(false);
    expect(Number(input.value)).toBe(0.5);
  });

  it('shows "(resolved)" label when resolvedConfigs available and auto', () => {
    renderQuality({
      resolvedConfigs: { outer_wall_line_width: '0.45' },
    });
    expect(screen.getAllByText('(resolved)').length).toBeGreaterThan(0);
  });

  it('shows "(est.)" label when only autoValues available and auto', () => {
    renderQuality({
      autoValues: { outerWallLineWidth: 0.6 },
    });
    // "(est.)" should appear for the field with autoValue
    expect(screen.getAllByText('(est.)').length).toBeGreaterThan(0);
  });

  it('unchecking auto pre-fills with resolved value when available', () => {
    const { onChange } = renderQuality({
      resolvedConfigs: { outer_wall_line_width: '0.42' },
    });
    const checkbox = getAutoCheckbox(/^Outer Wall/);
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ outerWallLineWidth: 0.42 });
  });

  it('unchecking auto pre-fills with auto value when no resolved value', () => {
    const { onChange } = renderQuality({
      autoValues: { outerWallLineWidth: 0.6 },
    });
    const checkbox = getAutoCheckbox(/^Outer Wall/);
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ outerWallLineWidth: 0.6 });
  });

  it('all 8 line width fields use the priority chain', () => {
    const resolvedConfigs: Record<string, string> = {
      line_width: '0.41',
      outer_wall_line_width: '0.42',
      inner_wall_line_width: '0.43',
      top_surface_line_width: '0.44',
      internal_solid_infill_line_width: '0.45',
      sparse_infill_line_width: '0.46',
      support_line_width: '0.47',
      initial_layer_line_width: '0.48',
    };
    renderQuality({ resolvedConfigs });
    // All "(resolved)" labels should appear — at least 7 (lineWidth defaults to 0.4, not auto)
    const resolvedLabels = screen.getAllByText('(resolved)');
    expect(resolvedLabels.length).toBeGreaterThanOrEqual(7);
  });
});

// ---------------------------------------------------------------------------
// SpeedTab — AutoSpeedField priority
// ---------------------------------------------------------------------------
describe('SpeedTab resolved config merging', () => {
  function renderSpeed(opts: {
    profileOverrides?: Partial<PrintProfile>;
    autoValues?: Record<string, number>;
    resolvedConfigs?: Record<string, string>;
  } = {}) {
    const onChange = vi.fn();
    const profile = { ...DEFAULT_PRINT_PROFILE, enableOverhangSpeed: true, ...opts.profileOverrides };
    render(
      <SpeedTab
        profile={profile}
        onChange={onChange}
        autoValues={opts.autoValues}
        resolvedConfigs={opts.resolvedConfigs}
      />
    );
    return { onChange };
  }

  function getOverhangInput(label: RegExp): HTMLInputElement {
    const el = screen.getByText(label);
    return el.closest('label')!.querySelector('input[type="number"]')! as HTMLInputElement;
  }

  function getOverhangAutoCheckbox(label: RegExp): HTMLInputElement {
    const el = screen.getByText(label);
    return el.closest('label')!.querySelector('input[type="checkbox"]')! as HTMLInputElement;
  }

  it('shows "auto" placeholder when auto, no resolvedConfigs', () => {
    renderSpeed();
    const input = getOverhangInput(/25% Overhang/);
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe('auto');
    expect(input.value).toBe('');
  });

  it('shows resolved value when auto, resolvedConfigs provided', () => {
    renderSpeed({
      resolvedConfigs: { overhang_1_4_speed: '80' },
    });
    const input = getOverhangInput(/25% Overhang/);
    expect(input.disabled).toBe(true);
    expect(Number(input.value)).toBe(80);
  });

  it('shows actual value when not auto, ignoring resolvedConfigs', () => {
    renderSpeed({
      profileOverrides: { overhang1_4Speed: 60 },
      resolvedConfigs: { overhang_1_4_speed: '80' },
    });
    const input = getOverhangInput(/25% Overhang/);
    expect(input.disabled).toBe(false);
    expect(Number(input.value)).toBe(60);
  });

  it('shows "(resolved)" label when resolved value available and auto', () => {
    renderSpeed({
      resolvedConfigs: { overhang_1_4_speed: '80' },
    });
    expect(screen.getAllByText('(resolved)').length).toBeGreaterThan(0);
  });

  it('does not show "(resolved)" when no resolvedConfigs', () => {
    renderSpeed();
    expect(screen.queryByText('(resolved)')).toBeNull();
  });

  it('unchecking auto pre-fills with resolved value when available', () => {
    const { onChange } = renderSpeed({
      resolvedConfigs: { overhang_1_4_speed: '80' },
    });
    const checkbox = getOverhangAutoCheckbox(/25% Overhang/);
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ overhang1_4Speed: 80 });
  });

  it('unchecking auto pre-fills with fallback when no resolved value', () => {
    const { onChange } = renderSpeed();
    const checkbox = getOverhangAutoCheckbox(/25% Overhang/);
    fireEvent.click(checkbox);
    // fallbackValue for 25% overhang is 50
    expect(onChange).toHaveBeenCalledWith({ overhang1_4Speed: 50 });
  });

  it('all 4 overhang fields accept resolvedConfigs', () => {
    renderSpeed({
      resolvedConfigs: {
        overhang_1_4_speed: '80',
        overhang_2_4_speed: '60',
        overhang_3_4_speed: '40',
        overhang_4_4_speed: '20',
      },
    });
    expect(Number(getOverhangInput(/25% Overhang/).value)).toBe(80);
    expect(Number(getOverhangInput(/50% Overhang/).value)).toBe(60);
    expect(Number(getOverhangInput(/75% Overhang/).value)).toBe(40);
    expect(Number(getOverhangInput(/100% Overhang/).value)).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// SupportTab — mixed speed + line width fields
// ---------------------------------------------------------------------------
describe('SupportTab resolved config merging', () => {
  function renderSupport(opts: {
    profileOverrides?: Partial<PrintProfile>;
    autoValues?: Record<string, number>;
    resolvedConfigs?: Record<string, string>;
  } = {}) {
    const onChange = vi.fn();
    const profile = { ...DEFAULT_PRINT_PROFILE, supportEnabled: true, ...opts.profileOverrides };
    render(
      <SupportTab
        profile={profile}
        onChange={onChange}
        autoValues={opts.autoValues}
        resolvedConfigs={opts.resolvedConfigs}
      />
    );
    return { onChange };
  }

  it('supportSpeed shows "auto" placeholder when no resolved value', () => {
    renderSupport({ profileOverrides: { supportSpeed: 0 } });
    const label = screen.getByText(/^Support Speed/).closest('label')!;
    const input = label.querySelector('input[type="number"]')! as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe('auto');
  });

  it('supportSpeed shows resolved value when available', () => {
    renderSupport({
      profileOverrides: { supportSpeed: 0 },
      resolvedConfigs: { support_speed: '45' },
    });
    const label = screen.getByText(/^Support Speed/).closest('label')!;
    const input = label.querySelector('input[type="number"]')! as HTMLInputElement;
    expect(Number(input.value)).toBe(45);
  });

  it('supportLineWidth uses resolved > auto > fallback priority', () => {
    // Test with resolved value
    renderSupport({
      profileOverrides: { supportLineWidth: 0 },
      autoValues: { supportLineWidth: 0.6 },
      resolvedConfigs: { support_line_width: '0.48' },
    });
    const labelEl = screen.getByText(/^Support Line Width/).closest('label')!;
    const input = labelEl.querySelector('input[type="number"]')! as HTMLInputElement;
    expect(Number(input.value)).toBe(0.48);
  });

  it('supportLineWidth falls back to autoValue when no resolved', () => {
    renderSupport({
      profileOverrides: { supportLineWidth: 0 },
      autoValues: { supportLineWidth: 0.6 },
    });
    const labelEl = screen.getByText(/^Support Line Width/).closest('label')!;
    const input = labelEl.querySelector('input[type="number"]')! as HTMLInputElement;
    expect(Number(input.value)).toBe(0.6);
  });

  it('supportInterfaceSpacing uses resolved > auto > 0.3 fallback', () => {
    // With resolved
    renderSupport({
      profileOverrides: { supportInterfaceSpacing: 0 },
      resolvedConfigs: { support_interface_spacing: '0.35' },
    });
    const labelEl = screen.getByText(/^Interface Spacing/).closest('label')!;
    const input = labelEl.querySelector('input[type="number"]')! as HTMLInputElement;
    expect(Number(input.value)).toBe(0.35);
  });

  it('supportInterfaceSpacing shows "(est.)" when only autoValue', () => {
    renderSupport({
      profileOverrides: { supportInterfaceSpacing: 0 },
      autoValues: { supportInterfaceSpacing: 0.3 },
    });
    // Should show "(est.)" somewhere in SupportTab
    const estLabels = screen.getAllByText('(est.)');
    expect(estLabels.length).toBeGreaterThan(0);
  });

  it('supportInterfaceSpeed shows resolved value when available', () => {
    renderSupport({
      profileOverrides: { supportInterfaceSpeed: 0 },
      resolvedConfigs: { support_interface_speed: '30' },
    });
    const label = screen.getByText(/^Interface Speed/).closest('label')!;
    const input = label.querySelector('input[type="number"]')! as HTMLInputElement;
    expect(Number(input.value)).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// InfillTab — line width + bridge angle fields
// ---------------------------------------------------------------------------
describe('InfillTab resolved config merging', () => {
  function renderInfill(opts: {
    profileOverrides?: Partial<PrintProfile>;
    autoValues?: Record<string, number>;
    resolvedConfigs?: Record<string, string>;
  } = {}) {
    const onChange = vi.fn();
    const profile = { ...DEFAULT_PRINT_PROFILE, ...opts.profileOverrides };
    render(
      <InfillTab
        profile={profile}
        onChange={onChange}
        autoValues={opts.autoValues}
        resolvedConfigs={opts.resolvedConfigs}
      />
    );
    return { onChange };
  }

  it('sparseInfillLineWidth uses resolved > auto > 0.4 fallback', () => {
    renderInfill({
      profileOverrides: { sparseInfillLineWidth: 0 },
      autoValues: { sparseInfillLineWidth: 0.6 },
      resolvedConfigs: { sparse_infill_line_width: '0.44' },
    });
    const labelEl = screen.getByText(/^Sparse Infill Line Width/).closest('label')!;
    const input = labelEl.querySelector('input[type="number"]')! as HTMLInputElement;
    expect(Number(input.value)).toBe(0.44);
  });

  it('sparseInfillLineWidth falls back to autoValue', () => {
    renderInfill({
      profileOverrides: { sparseInfillLineWidth: 0 },
      autoValues: { sparseInfillLineWidth: 0.6 },
    });
    const labelEl = screen.getByText(/^Sparse Infill Line Width/).closest('label')!;
    const input = labelEl.querySelector('input[type="number"]')! as HTMLInputElement;
    expect(Number(input.value)).toBe(0.6);
  });

  it('sparseInfillLineWidth falls back to 0.4 hardcoded', () => {
    renderInfill({
      profileOverrides: { sparseInfillLineWidth: 0 },
    });
    const labelEl = screen.getByText(/^Sparse Infill Line Width/).closest('label')!;
    const input = labelEl.querySelector('input[type="number"]')! as HTMLInputElement;
    expect(Number(input.value)).toBe(0.4);
  });

  it('bridgeAngle shows "auto" placeholder when no resolved value', () => {
    renderInfill({ profileOverrides: { bridgeAngle: 0 } });
    const labelEl = screen.getByText(/^Bridge Angle/).closest('label')!;
    const input = labelEl.querySelector('input[type="number"]')! as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe('auto');
    expect(input.value).toBe('');
  });

  it('bridgeAngle shows resolved value when available', () => {
    renderInfill({
      profileOverrides: { bridgeAngle: 0 },
      resolvedConfigs: { bridge_angle: '90' },
    });
    const labelEl = screen.getByText(/^Bridge Angle/).closest('label')!;
    const input = labelEl.querySelector('input[type="number"]')! as HTMLInputElement;
    expect(Number(input.value)).toBe(90);
  });

  it('bridgeAngle shows "(resolved)" label when resolved', () => {
    renderInfill({
      profileOverrides: { bridgeAngle: 0 },
      resolvedConfigs: { bridge_angle: '90' },
    });
    expect(screen.getAllByText('(resolved)').length).toBeGreaterThan(0);
  });

  it('unchecking bridgeAngle auto pre-fills with resolved value', () => {
    const { onChange } = renderInfill({
      profileOverrides: { bridgeAngle: 0 },
      resolvedConfigs: { bridge_angle: '90' },
    });
    const labelEl = screen.getByText(/^Bridge Angle/).closest('label')!;
    const checkbox = labelEl.querySelector('input[type="checkbox"]')! as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ bridgeAngle: 90 });
  });

  it('unchecking bridgeAngle auto pre-fills with 45 fallback when no resolved', () => {
    const { onChange } = renderInfill({
      profileOverrides: { bridgeAngle: 0 },
    });
    const labelEl = screen.getByText(/^Bridge Angle/).closest('label')!;
    const checkbox = labelEl.querySelector('input[type="checkbox"]')! as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ bridgeAngle: 45 });
  });

  it('internalBridgeAngle shows resolved value when available', () => {
    renderInfill({
      profileOverrides: { internalBridgeAngle: 0 },
      resolvedConfigs: { internal_bridge_angle: '135' },
    });
    const labelEl = screen.getByText(/^Internal Bridge Angle/).closest('label')!;
    const input = labelEl.querySelector('input[type="number"]')! as HTMLInputElement;
    expect(Number(input.value)).toBe(135);
  });

  it('shows actual bridgeAngle value when not auto, ignoring resolved', () => {
    renderInfill({
      profileOverrides: { bridgeAngle: 60 },
      resolvedConfigs: { bridge_angle: '90' },
    });
    const labelEl = screen.getByText(/^Bridge Angle/).closest('label')!;
    const input = labelEl.querySelector('input[type="number"]')! as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(Number(input.value)).toBe(60);
  });
});
