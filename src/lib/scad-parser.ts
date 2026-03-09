import type {
  ScadParam,
  ScadParamSet,
  ScadParamType,
  ScadValue,
  ScadFile,
} from '../types';

/**
 * Extract text between two marker comments from a scad file.
 * Returns null if markers are not found.
 */
function extractSection(source: string, beginMarker: string, endMarker: string): string | null {
  const beginIdx = source.indexOf(beginMarker);
  if (beginIdx === -1) return null;
  const endIdx = source.indexOf(endMarker, beginIdx);
  if (endIdx === -1) return null;
  return source.slice(beginIdx + beginMarker.length, endIdx);
}

/**
 * Parse a scad value string into a typed JS value.
 * Handles numbers, strings (quoted), booleans, and vectors ([...]).
 */
export function parseValue(raw: string): { value: ScadValue; type: ScadParamType } {
  const trimmed = raw.trim();

  // Boolean
  if (trimmed === 'true') return { value: true, type: 'boolean' };
  if (trimmed === 'false') return { value: false, type: 'boolean' };

  // String (double-quoted)
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return { value: trimmed.slice(1, -1), type: 'string' };
  }

  // Vector / list: [a, b, c]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1);
    const nums = inner.split(',').map((s) => Number(s.trim()));
    if (nums.every((n) => !isNaN(n))) {
      return { value: nums, type: 'vector' };
    }
  }

  // Number
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== '') {
    return { value: num, type: 'number' };
  }

  // Fallback: treat as string
  return { value: trimmed, type: 'string' };
}

/**
 * Check if inline comment contains an options list like [circle, square, hexagon].
 * Returns the list of options or null.
 */
function parseInlineOptions(inlineComment: string): string[] | null {
  const match = inlineComment.match(/\[([^\]]+)\]/);
  if (!match) return null;
  const items = match[1].split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  return items.length > 0 ? items : null;
}

// ─── Parameters ──────────────────────────────────────────

export function parseParams(source: string): ScadParam[] {
  const section = extractSection(source, '// BEGIN_PARAMS', '// END_PARAMS');
  if (!section) return [];

  // Split into parameter blocks separated by two or more blank lines
  const blocks = section.split(/\n(?:\s*\n){2,}/);
  const params: ScadParam[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    // The last non-empty line should be the assignment
    const assignmentLine = lines[lines.length - 1];
    // Match: name = value; with optional inline comment
    const assignMatch = assignmentLine.match(
      /^(\w+)\s*=\s*(.+?)\s*;\s*(?:\/\/\s*(.*))?$/
    );
    if (!assignMatch) continue;

    const [, name, rawValue, inlineComment] = assignMatch;

    // Parse value
    const { value, type: inferredType } = parseValue(rawValue);

    // Check for enum options in inline comment
    let type: ScadParamType = inferredType;
    let options: string[] | undefined;
    if (inlineComment) {
      const opts = parseInlineOptions(inlineComment);
      if (opts) {
        type = 'enum';
        options = opts;
      }
    }

    // Collect help text from preceding comment lines
    const helpLines: string[] = [];
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      if (line.startsWith('//')) {
        helpLines.push(line.replace(/^\/\/\s?/, ''));
      }
    }
    const help = helpLines.join(' ');

    params.push({ name, type, default: value, help, ...(options ? { options } : {}) });
  }

  return params;
}

// ─── Parameter Sets ──────────────────────────────────────

export function parseParamSets(source: string): ScadParamSet[] {
  const section = extractSection(source, '// BEGIN_PARAM_SETS', '// END_PARAM_SETS');
  if (!section) return [];

  // Split by blank lines to get individual sets
  const blocks = section.split(/\n\s*\n/);
  const sets: ScadParamSet[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    // First line should be: // set: <Name>
    const headerMatch = lines[0].match(/^\/\/\s*set:\s*(.+)$/);
    if (!headerMatch) continue;

    const name = headerMatch[1].trim();
    const values: Record<string, ScadValue> = {};

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Match: // paramName = value
      const paramMatch = line.match(/^\/\/\s*(\w+)\s*=\s*(.+)$/);
      if (!paramMatch) continue;

      const { value } = parseValue(paramMatch[2]);
      values[paramMatch[1]] = value;
    }

    sets.push({ name, values });
  }

  return sets;
}

// ─── Full File Parser ────────────────────────────────────

export function parseScadFile(source: string): ScadFile {
  return {
    params: parseParams(source),
    paramSets: parseParamSets(source),
    source,
  };
}
