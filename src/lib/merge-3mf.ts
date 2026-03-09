/**
 * Merge multiple single-color STL files into one multi-color 3MF.
 *
 * Each input is an STL (binary) produced by OpenSCAD for one color.
 * Output is a merged 3MF with ColorGroups assigning each mesh its color.
 *
 * 3MF = ZIP archive containing:
 *   [Content_Types].xml
 *   _rels/.rels
 *   3D/3dmodel.model   (main XML with vertices, triangles, colors)
 *   Metadata/model_settings.config  (slicer metadata for Bambu/Orca/Prusa)
 */

import { zipSync } from 'fflate';

export interface ColoredModel {
  /** RGBA color in linear space, as [r, g, b, a] with values 0–1 */
  color: [number, number, number, number];
  /** Raw STL file bytes (binary format) */
  data: Uint8Array;
}

interface Mesh {
  vertices: { x: number; y: number; z: number }[];
  triangles: { v1: number; v2: number; v3: number }[];
}

/** Convert linear RGB component to sRGB. */
function linearToSRGB(linear: number): number {
  if (linear <= 0.0031308) {
    return linear * 12.92;
  }
  const a = 0.055;
  return (1.0 + a) * Math.pow(linear, 1 / 2.4) - a;
}

/** Convert float 0–1 to 2-digit hex. */
function toHex(value: number): string {
  const clamped = Math.max(0, Math.min(1, value));
  const byte = Math.round(clamped * 255);
  return byte.toString(16).padStart(2, '0').toUpperCase();
}

/** Convert linear RGBA to sRGB hex color string (#RRGGBBAA). */
function colorToHex(color: [number, number, number, number]): string {
  const r = linearToSRGB(color[0]);
  const g = linearToSRGB(color[1]);
  const b = linearToSRGB(color[2]);
  const a = color[3]; // alpha is not gamma-corrected
  return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(a)}`;
}

/** Escape XML special characters. */
function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Extract mesh data from an STL file (binary or ASCII).
 * Deduplicates vertices using a spatial hash map.
 */
function extractMeshFromSTL(data: Uint8Array): Mesh {
  const vertices: Mesh['vertices'] = [];
  const triangles: Mesh['triangles'] = [];
  const vertexMap = new Map<string, number>();

  function addVertex(x: number, y: number, z: number): number {
    const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const idx = vertices.length;
    vertices.push({ x, y, z });
    vertexMap.set(key, idx);
    return idx;
  }

  // Detect ASCII vs binary: ASCII starts with "solid"
  const header = new TextDecoder().decode(data.subarray(0, 5));
  if (header === 'solid') {
    // ASCII STL
    const text = new TextDecoder().decode(data);
    const facetRe = /facet\s+normal\s+\S+\s+\S+\s+\S+\s+outer\s+loop\s+vertex\s+(\S+)\s+(\S+)\s+(\S+)\s+vertex\s+(\S+)\s+(\S+)\s+(\S+)\s+vertex\s+(\S+)\s+(\S+)\s+(\S+)\s+endloop\s+endfacet/g;
    let m: RegExpExecArray | null;
    while ((m = facetRe.exec(text)) !== null) {
      const v1 = addVertex(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
      const v2 = addVertex(parseFloat(m[4]), parseFloat(m[5]), parseFloat(m[6]));
      const v3 = addVertex(parseFloat(m[7]), parseFloat(m[8]), parseFloat(m[9]));
      triangles.push({ v1, v2, v3 });
    }
  } else {
    // Binary STL
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const numTriangles = view.getUint32(80, true);

    for (let i = 0; i < numTriangles; i++) {
      const offset = 84 + i * 50;
      const v1 = addVertex(
        view.getFloat32(offset + 12, true),
        view.getFloat32(offset + 16, true),
        view.getFloat32(offset + 20, true),
      );
      const v2 = addVertex(
        view.getFloat32(offset + 24, true),
        view.getFloat32(offset + 28, true),
        view.getFloat32(offset + 32, true),
      );
      const v3 = addVertex(
        view.getFloat32(offset + 36, true),
        view.getFloat32(offset + 40, true),
        view.getFloat32(offset + 44, true),
      );
      triangles.push({ v1, v2, v3 });
    }
  }

  return { vertices, triangles };
}

/**
 * Merge multiple single-color STL files into one multi-color 3MF.
 *
 * Follows the same approach as colorscad's 3mfmerge:
 * - Each color gets its own ColorGroup with one color
 * - Each mesh is assigned its ColorGroup at object level
 * - A ComponentsObject groups all meshes
 * - Slicer metadata names each part by its color
 */
export function merge3mf(inputs: ColoredModel[]): Uint8Array {
  if (inputs.length === 0) {
    throw new Error('No inputs to merge');
  }

  // Resource IDs start at 1 and increment.
  // Layout: colorgroup1, mesh1, colorgroup2, mesh2, ..., componentsObject
  // Each color gets: colorGroupId, then meshId
  let nextId = 1;

  interface MeshEntry {
    colorGroupId: number;
    meshId: number;
    mesh: Mesh;
    color: [number, number, number, number];
    colorHex: string;
    colorLabel: string;
  }

  const entries: MeshEntry[] = [];

  for (const input of inputs) {
    const mesh = extractMeshFromSTL(input.data);
    if (mesh.vertices.length === 0) continue; // skip empty meshes

    const colorGroupId = nextId++;
    const meshId = nextId++;
    const colorHex = colorToHex(input.color);
    const colorLabel = `[${input.color.join(', ')}]`;

    entries.push({ colorGroupId, meshId, mesh, color: input.color, colorHex, colorLabel });
  }

  const componentsObjectId = nextId++;

  // Build the model XML
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">');
  lines.push('  <metadata name="Application">OpenSCAD Web Generator</metadata>');
  lines.push('  <resources>');

  for (const entry of entries) {
    // ColorGroup with a single color
    lines.push(`    <colorgroup id="${entry.colorGroupId}">`);
    lines.push(`      <color color="${entry.colorHex}" />`);
    lines.push(`    </colorgroup>`);

    // Mesh object with object-level color property
    lines.push(`    <object id="${entry.meshId}" type="model" pid="${entry.colorGroupId}" pindex="0" name="${escXml(entry.colorLabel)}">`);
    lines.push('      <mesh>');
    lines.push('        <vertices>');
    for (const v of entry.mesh.vertices) {
      lines.push(`          <vertex x="${v.x}" y="${v.y}" z="${v.z}" />`);
    }
    lines.push('        </vertices>');
    lines.push('        <triangles>');
    for (const t of entry.mesh.triangles) {
      lines.push(`          <triangle v1="${t.v1}" v2="${t.v2}" v3="${t.v3}" />`);
    }
    lines.push('        </triangles>');
    lines.push('      </mesh>');
    lines.push('    </object>');
  }

  // Components object grouping all meshes
  lines.push(`    <object id="${componentsObjectId}" type="model">`);
  lines.push('      <components>');
  for (const entry of entries) {
    lines.push(`        <component objectid="${entry.meshId}" />`);
  }
  lines.push('      </components>');
  lines.push('    </object>');

  lines.push('  </resources>');
  lines.push('  <build>');
  lines.push(`    <item objectid="${componentsObjectId}" />`);
  lines.push('  </build>');
  lines.push('</model>');

  const modelXml = lines.join('\n');

  // Build slicer metadata (Bambu Studio / OrcaSlicer compatibility)
  const metaLines: string[] = [];
  metaLines.push('<?xml version="1.0" encoding="UTF-8"?>');
  metaLines.push('<config>');
  metaLines.push(`  <object id="${componentsObjectId}">`);
  for (const entry of entries) {
    metaLines.push(`    <part id="${entry.meshId}" subtype="normal_part">`);
    metaLines.push(`      <metadata key="name" value="${escXml(entry.colorLabel)}" />`);
    metaLines.push('    </part>');
  }
  metaLines.push('  </object>');
  metaLines.push('</config>');
  const modelSettings = metaLines.join('\n');

  // Content types
  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />',
    '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />',
    '  <Default Extension="config" ContentType="application/vnd.openxmlformats-package.relationships+xml" />',
    '</Types>',
  ].join('\n');

  // Relationships
  const rels = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />',
    '</Relationships>',
  ].join('\n');

  const enc = new TextEncoder();

  // Create ZIP
  const zipData = zipSync({
    '[Content_Types].xml': enc.encode(contentTypes),
    '_rels': {
      '.rels': enc.encode(rels),
    },
    '3D': {
      '3dmodel.model': enc.encode(modelXml),
    },
    'Metadata': {
      'model_settings.config': enc.encode(modelSettings),
    },
  });

  return zipData;
}
