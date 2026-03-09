// BEGIN_PARAMS
// The overall width of the box in mm.
// Must be at least 10mm for structural integrity.
width = 50;


// The overall depth of the box in mm.
depth = 40;


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
// Affects airflow characteristics.
vent_shape = "circle"; // [circle, square, hexagon]


// Outer dimensions as [x, y, z] for reference.
outer_dims = [50, 40, 30];
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
// depth = 80
// height = 60
// vent_shape = "hexagon"
// label = "Large Hex"
// END_PARAM_SETS

// ==========================================
// Main geometry below
// ==========================================

module rounded_box(w, d, h, r=2) {
    hull() {
        for (x = [r, w-r], y = [r, d-r]) {
            translate([x, y, 0])
                cylinder(h=h, r=r, $fn=20);
        }
    }
}

difference() {
    // Outer shell
    rounded_box(width, depth, height);

    // Inner cavity
    translate([wall, wall, wall])
        rounded_box(width - 2*wall, depth - 2*wall, height, max(0.5, 2 - wall));

    // Label emboss on front face
    if (label != "") {
        translate([width/2, 0.5, height/2])
            rotate([90, 0, 0])
                linear_extrude(1)
                    text(label, size=8, halign="center", valign="center");
    }

    // Ventilation holes on one side
    if (vents) {
        hole_count = floor((height - 10) / 8);
        for (i = [0:hole_count-1]) {
            translate([-0.5, depth/2, 8 + i*8]) {
                rotate([0, 90, 0]) {
                    if (vent_shape == "circle") {
                        cylinder(h=wall+1, r=2.5, $fn=16);
                    } else if (vent_shape == "square") {
                        translate([-2.5, -2.5, 0])
                            cube([5, 5, wall+1]);
                    } else if (vent_shape == "hexagon") {
                        cylinder(h=wall+1, r=3, $fn=6);
                    }
                }
            }
        }
    }
}
