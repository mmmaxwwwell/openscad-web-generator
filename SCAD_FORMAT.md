# .scad File Convention Specification

This document defines the structured comment conventions used by the OpenSCAD Web Parameter Editor to extract parameters, parameter sets, and viewpoints from `.scad` files.

---

## Overview

A compliant `.scad` file may contain three special sections, each delimited by marker comments. All sections are optional. They should appear near the top of the file, before the main geometry code.

---

## 1. Parameter Section

### Markers
```
// BEGIN_PARAMS
...
// END_PARAMS
```

### Rules
- Each parameter is a standard OpenSCAD variable assignment: `name = value;`
- Parameters are separated from each other by **exactly two blank lines**.
- **Adjacent comment lines** immediately preceding a parameter assignment are treated as **help text** for that parameter. Multiple adjacent comment lines are concatenated.
- A blank line between a comment and a parameter **breaks** the association (the comment is ignored).

### Supported Value Types
| Type | Example | UI Control |
|------|---------|------------|
| Number (int/float) | `width = 10;` | Number input |
| String | `label = "hello";` | Text input |
| Boolean | `center = true;` | Checkbox |
| Vector | `size = [10, 20, 30];` | Multiple number inputs |
| List of options | `shape = "circle"; // [circle, square, triangle]` | Dropdown select |

**List of options**: If a comment on the same line as the assignment contains a bracketed comma-separated list, the parameter is treated as an enum/dropdown. The comment is the options list, NOT help text. Help text must be on preceding lines.

### Example
```scad
// BEGIN_PARAMS
// The overall width of the enclosure in mm.
// Must be at least 10mm for structural integrity.
width = 50;


// The height of the enclosure in mm.
height = 30;


// Label to emboss on the front face.
label = "My Box";


// Whether to center the model at the origin.
center = true;


// Shape of the ventilation holes.
// Affects airflow characteristics.
vent_shape = "circle"; // [circle, square, hexagon]


// Dimensions as [width, depth, height].
dimensions = [100, 60, 40];
// END_PARAMS
```

Parsed result for `width`:
- Name: `width`
- Default value: `50`
- Type: `number`
- Help text: `"The overall width of the enclosure in mm. Must be at least 10mm for structural integrity."`

Parsed result for `vent_shape`:
- Name: `vent_shape`
- Default value: `"circle"`
- Type: `enum`
- Options: `["circle", "square", "hexagon"]`
- Help text: `"Shape of the ventilation holes. Affects airflow characteristics."`

---

## 2. Parameter Sets Section

### Markers
```
// BEGIN_PARAM_SETS
...
// END_PARAM_SETS
```

### Rules
- Each set begins with `// set: <Set Name>` (the name is everything after `// set: ` to end of line).
- Following lines are `// paramName = value` (one per line). Only include params that differ from defaults; omitted params keep their default value.
- Sets are separated by **one blank line**.
- Values follow the same syntax as the parameter section (numbers, strings, booleans, vectors).

### Example
```scad
// BEGIN_PARAM_SETS
// set: Small Box
// width = 30
// height = 20
// label = "Small"

// set: Large Box
// width = 100
// height = 60
// label = "Large"
// center = false

// set: Demo
// width = 50
// height = 50
// vent_shape = "hexagon"
// dimensions = [80, 80, 50]
// END_PARAM_SETS
```

### Parsing Notes
- The set name is used as-is for display in the UI.
- Values do not have trailing semicolons (they are inside comments).
- String values include their quotes: `// label = "Small"` -> value is `"Small"`.

---

## 3. Viewpoints Section

### Markers
```
// BEGIN_VIEWPOINTS
...
// END_VIEWPOINTS
```

### Rules
- One viewpoint per line.
- Format: `// rotX,rotY,rotZ,transX,transY,transZ,distance`
- All values are numbers (integers or floats).
- An optional label can follow after `//` on the same line: `// 25,35,0,0,0,0,200  // Front view`
- The label is everything after the second `//`, trimmed.
- The app generates one preview image per viewpoint line.

### Camera Mapping
These values map to OpenSCAD's `--camera` argument:
```
--camera=transX,transY,transZ,rotX,rotY,rotZ,distance
```
**Note the argument order differs from the file format.** The file format puts rotation first (more intuitive for users), but the CLI flag expects translation first. The app must reorder when constructing the CLI argument.

### Example
```scad
// BEGIN_VIEWPOINTS
// 25,35,0,0,0,0,200       // Front perspective
// 0,0,0,0,0,0,300         // Top down
// 90,0,0,0,0,0,150        // Right side
// 55,0,25,10,0,0,250      // Isometric
// END_VIEWPOINTS
```

---

## 4. Complete Example File

```scad
// BEGIN_VIEWPOINTS
// 25,35,0,0,0,0,200       // Front perspective
// 0,0,0,0,0,0,300         // Top down
// 90,0,45,0,0,0,180       // Angled side
// END_VIEWPOINTS

// BEGIN_PARAMS
// The overall width of the box in mm.
width = 50;


// The overall height of the box in mm.
height = 30;


// Wall thickness in mm.
// Minimum recommended: 1.2mm for FDM printing.
wall = 2;


// Text to emboss on the lid.
label = "My Box";


// Whether to add ventilation holes.
vents = true;


// Shape of ventilation holes.
vent_shape = "circle"; // [circle, square, hexagon]
// END_PARAMS

// BEGIN_PARAM_SETS
// set: Thin Walls
// wall = 1.2
// label = "Thin"

// set: Thick & Solid
// wall = 4
// vents = false
// label = "Solid"

// set: Large Hex Vents
// width = 100
// height = 60
// vent_shape = "hexagon"
// END_PARAM_SETS

// ==========================================
// Main geometry below — do not edit above
// ==========================================

difference() {
    cube([width, width, height]);
    translate([wall, wall, wall])
        cube([width - 2*wall, width - 2*wall, height]);
    if (vents) {
        // ventilation holes would go here
    }
}
```

---

## 5. Parser Error Handling

The parser should be **lenient**:
- If a section marker is missing, skip that section (return empty array).
- If a parameter line can't be parsed, skip it and log a warning.
- If a viewpoint line can't be parsed, skip it and log a warning.
- Never crash on malformed input — the user might be editing the file.
