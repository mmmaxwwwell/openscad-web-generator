/** Shim: re-export THREE from npm package for Kiri:Moto compatibility */
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export {
    THREE,
    SVGLoader,
    BufferGeometryUtils,
    LineMaterial,
    Line2,
    LineGeometry,
    LineSegments2,
    LineSegmentsGeometry,
};

// Stub for MeshBVHLib - not needed for slicing
export const MeshBVHLib = {};
