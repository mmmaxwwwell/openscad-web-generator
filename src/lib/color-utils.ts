// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Color parsing utilities shared between the OpenSCAD worker and tests.
 */

// CSS/SVG named colors supported by OpenSCAD (subset covering common ones).
// Values are [r, g, b] in 0-1 range.
export const NAMED_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0], white: [1, 1, 1], red: [1, 0, 0], green: [0, 0.502, 0],
  blue: [0, 0, 1], yellow: [1, 1, 0], cyan: [0, 1, 1], magenta: [1, 0, 1],
  gray: [0.502, 0.502, 0.502], grey: [0.502, 0.502, 0.502],
  silver: [0.753, 0.753, 0.753], maroon: [0.502, 0, 0],
  olive: [0.502, 0.502, 0], navy: [0, 0, 0.502], purple: [0.502, 0, 0.502],
  teal: [0, 0.502, 0.502], aqua: [0, 1, 1], fuchsia: [1, 0, 1],
  orange: [1, 0.647, 0], pink: [1, 0.753, 0.796], lime: [0, 1, 0],
  brown: [0.647, 0.165, 0.165], coral: [1, 0.498, 0.314],
  gold: [1, 0.843, 0], khaki: [0.941, 0.902, 0.549],
  ivory: [1, 1, 0.941], indigo: [0.294, 0, 0.510],
  crimson: [0.863, 0.078, 0.235], tomato: [1, 0.388, 0.278],
  salmon: [0.980, 0.502, 0.447], sienna: [0.627, 0.322, 0.176],
  tan: [0.824, 0.706, 0.549], wheat: [0.961, 0.871, 0.702],
  violet: [0.933, 0.510, 0.933], turquoise: [0.251, 0.878, 0.816],
  orchid: [0.855, 0.439, 0.839], plum: [0.867, 0.627, 0.867],
  peru: [0.804, 0.522, 0.247], chocolate: [0.824, 0.412, 0.118],
  beige: [0.961, 0.961, 0.863], linen: [0.980, 0.941, 0.902],
  snow: [1, 0.980, 0.980], honeydew: [0.941, 1, 0.941],
  lavender: [0.902, 0.902, 0.980],
  darkred: [0.545, 0, 0], darkgreen: [0, 0.392, 0], darkblue: [0, 0, 0.545],
  darkgray: [0.663, 0.663, 0.663], darkgrey: [0.663, 0.663, 0.663],
  lightgray: [0.827, 0.827, 0.827], lightgrey: [0.827, 0.827, 0.827],
  lightblue: [0.678, 0.847, 0.902], lightgreen: [0.565, 0.933, 0.565],
  dimgray: [0.412, 0.412, 0.412], dimgrey: [0.412, 0.412, 0.412],
};

/**
 * Parse a color string from OpenSCAD echo output.
 * Handles both "[r, g, b, a]" array format and named CSS colors like "black".
 */
export function parseColorString(s: string): [number, number, number, number] | null {
  const trimmed = s.trim().replace(/^"|"$/g, '');

  // Try named color first
  const named = NAMED_COLORS[trimmed.toLowerCase()];
  if (named) {
    return [named[0], named[1], named[2], 1];
  }

  // Try parsing as "[r, g, b, a]" array
  const nums = trimmed.replace(/[\[\]]/g, '').split(',').map(v => parseFloat(v.trim()));
  if (nums.length >= 3 && nums.every(n => !isNaN(n))) {
    return [nums[0], nums[1], nums[2], nums[3] ?? 1];
  }

  // Try hex color "#rrggbb"
  const hex = trimmed.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (hex) {
    return [parseInt(hex[1], 16) / 255, parseInt(hex[2], 16) / 255, parseInt(hex[3], 16) / 255, 1];
  }

  return null;
}
