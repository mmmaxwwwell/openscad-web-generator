// A parametric cube for testing.

// BEGIN_PARAMS
// Size of the cube in mm
size = 10;


// Height multiplier
height_factor = 1;
// END_PARAMS

cube([size, size, size * height_factor], center = true);
