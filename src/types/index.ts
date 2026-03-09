// Supported parameter value types
export type ScadParamType = 'number' | 'string' | 'boolean' | 'vector' | 'enum';

// A single parsed parameter from the PARAMS section
export interface ScadParam {
  name: string;
  type: ScadParamType;
  default: ScadValue;
  help: string;           // concatenated help text from preceding comments
  options?: string[];     // for enum type: list of allowed values
}

// Possible runtime values for a parameter
export type ScadValue = number | string | boolean | number[];

// A named parameter set from the PARAM_SETS section
export interface ScadParamSet {
  name: string;
  // Only contains overrides — params not listed keep their defaults
  values: Record<string, ScadValue>;
}

// A viewpoint from the VIEWPOINTS section
export interface ScadViewpoint {
  rotX: number;
  rotY: number;
  rotZ: number;
  transX: number;
  transY: number;
  transZ: number;
  distance: number;
  label: string;          // empty string if no label provided
}

// Complete parsed result from a .scad file
export interface ScadFile {
  params: ScadParam[];
  paramSets: ScadParamSet[];
  viewpoints: ScadViewpoint[];
  source: string;         // full original file content
}

// File metadata for storage listing
export interface FileInfo {
  id: string;
  name: string;
  lastModified: Date;
  size?: number;
}

// Storage adapter interface
export interface StorageAdapter {
  listFiles(): Promise<FileInfo[]>;
  loadFile(id: string): Promise<string>;
  saveFile(id: string, content: string): Promise<void>;
  deleteFile(id: string): Promise<void>;
}
