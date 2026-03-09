/** Stub: mesh/tool.js — minimal for widget.js loadVertices normalize option */
class MeshTool {
    constructor(params = {}) {
        this.precision = Math.pow(10, params.precision || 6);
    }

    normalizeVertices(data) {
        // passthrough — full normalize not needed for slicer
        return { toFloat32() { return data; } };
    }
}

export function tool(params) {
    return new MeshTool(params);
}
