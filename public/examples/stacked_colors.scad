// SPDX-License-Identifier: AGPL-3.0-or-later
// Two stacked cubes of different colors for testing multi-color 3MF.
// The red cube sits on the bed (Z=0..10) and the white cube sits on top (Z=10..20).

/* [Dimensions] */
// Size of each cube in mm
size = 10; // [5:1:50]

/* [Colors] */
// Color of the bottom cube
bottom_color = "red";
// Color of the top cube
top_color = "white";

color(bottom_color) cube([size, size, size]);
color(top_color) translate([0, 0, size]) cube([size, size, size]);
