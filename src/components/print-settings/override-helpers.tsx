// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MouseEvent, ReactElement } from 'react';
import type { PrintProfile } from '../../types/print-profile';

/**
 * Creates helper functions for override indicators in print settings tabs.
 * When `overrides` is undefined (normal PrintDialog usage), helpers are no-ops.
 */
export function createOverrideHelpers(
  overrides?: Partial<PrintProfile>,
  onResetField?: (field: keyof PrintProfile) => void,
) {
  /** Returns CSS class suffix: ' override-active' | ' override-inherited' | '' */
  const oc = (field: keyof PrintProfile): string => {
    if (!overrides) return '';
    return field in overrides ? ' override-active' : ' override-inherited';
  };

  /** Returns a reset button if the field is overridden, or null */
  const resetBtn = (field: keyof PrintProfile): ReactElement | null => {
    if (!overrides || !(field in overrides) || !onResetField) return null;
    return (
      <button
        className="override-reset-btn"
        title="Reset to plate default"
        onClick={(e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          onResetField(field);
        }}
      >
        ↺
      </button>
    );
  };

  return { oc, resetBtn };
}

/** Warning indicator shown next to plate-level fields that have per-object overrides */
export function PerObjectWarning({ field, perObjectOverrides }: { field: keyof PrintProfile; perObjectOverrides?: Set<keyof PrintProfile> }) {
  if (!perObjectOverrides?.has(field)) return null;
  return (
    <span className="build-plate-field-override-warning" title="This value is overridden on one or more objects">
      &#9888;
    </span>
  );
}
