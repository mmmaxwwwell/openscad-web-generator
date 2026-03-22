// A parametric two-color cube for testing multicolor re-render.
// Two stacked boxes: red (bottom) and blue (top).

// BEGIN_PARAMS
// Size of the cube in mm
size = 10;


// Height multiplier
height_factor = 1;
// END_PARAMS

h = size * height_factor;

color("red") cube([size, size, h / 2]);
color("blue") translate([0, 0, h / 2]) cube([size, size, h / 2]);
