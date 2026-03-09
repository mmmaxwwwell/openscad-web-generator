include <BOSL2/std.scad>
include <qr.scad>

// BEGIN_PARAMS
// URL for the QR code on top of the case.
// Leave empty for no QR code.
qr_code_url = "";
// END_PARAMS

qr_thickness = 1;  // mm - thickness of QR code modules

// ============================================================
// COORDINATE SYSTEM OVERVIEW
// ============================================================
// The Fi Mini body is centered at the origin.
//   X axis = length (long dimension of Fi)
//   Y axis = width (short dimension of Fi)
//   Z axis = height/thickness
//
// The Fi body spans:
//   X: -fi_length/2  to +fi_length/2
//   Y: -fi_width/2   to +fi_width/2
//   Z: -fi_height/2  to +fi_height/2
//
// Below the Fi (in -Z) sits the collar, then the bottom case wall.
// Above the Fi (in +Z) sits the top case wall.
//
// VERTICAL STACKING (bottom to top):
//   z = -(fi_height/2 + collar_thickness + wall_thickness)  : bottom of case
//   z = -(fi_height/2 + collar_thickness)                   : top of bottom wall / bottom of collar
//   z = -(fi_height/2)                                      : top of collar / bottom of Fi
//   z = +(fi_height/2)                                      : top of Fi
//   z = +(fi_height/2 + top_thickness)                      : top of case
//
// LATERAL LAYOUT (Y axis cross-section, one side):
//   y = 0                                                   : center
//   y = fi_width/2                                          : edge of Fi body
//   y = fi_width/2 + 1.5                                    : 1.5mm gap (clearance from Fi to screw shaft)
//   y = fi_width/2 + 1.5 + screw_shaft_d/2                 : screw centerline
//   y = fi_width/2 + 1.5 + screw_shaft_d/2 + screw_head_d/2: outer edge of screw head
//   y = case_width/2                                        : outer edge of case (+0.5mm margin beyond screw head)
//   (mirrored on -Y side)

// ============================================================
// Fi Mini GPS Tracker Dimensions
// ============================================================
// Source: https://support.tryfi.com/hc/en-us/articles/42830556728979
// Device dimensions without strap attachment.
fi_length     = 43;      // mm - length of Fi Mini (X axis)
fi_width      = 31;      // mm - width of Fi Mini (Y axis)
fi_height     = 11.5;    // mm - height/thickness of Fi Mini (Z axis)
fi_corner_r   = 9;       // mm - corner radius on vertical edges

// ============================================================
// M3x6mm Socket Head Cap Screw (DIN 912 / ISO 4762)
// ============================================================
// Source: https://www.engineersedge.com/hardware/_metric_socket_head_cap_screws_14054.htm
screw_shaft_d = 2.75;       // mm - shaft/thread outer diameter (M3)
screw_shaft_l = 6;       // mm - thread/shaft length
screw_head_d  = 5.5;     // mm - socket head diameter
screw_head_h  = 3;       // mm - socket head height

// ============================================================
// Case Parameters
// ============================================================
wall_thickness = 2;      // mm - wall thickness on sides and bottom
top_thickness  = 1;      // mm - wall thickness on top of case
edge_rounding  = 2;      // mm - rounding on top and bottom case edges (dog comfort)

// ============================================================
// USB-C Port Cutout Parameters
// ============================================================
// The USB-C port is on the long side (-Y end) of the Fi Mini,
// positioned approximately 3/4 of the way up (toward +Z).
// Standard USB-C receptacle opening: ~8.4mm wide x 2.6mm tall.
// We add clearance for plug insertion and slight misalignment.
usbc_width  = 14;     // mm - cutout width along case wall (X axis), generous for plug
usbc_height = 8;      // mm - cutout height (Z axis), generous for plug
usbc_depth  = 10;     // mm - cutout depth through wall (Y axis, oversized for clean cut)
usbc_rounding = 2;    // mm - rounding radius on cutout corners
// Z offset: top of cutout aligns with cavity ceiling
// Cavity ceiling is at fi_height/2 + wall_thickness - top_thickness
usbc_z_offset = fi_height/2 + (wall_thickness - top_thickness) - usbc_height/2;

// ============================================================
// Collar Parameters (runs along length, underneath Fi Mini)
// ============================================================
// The collar is a strap (e.g. a pet collar) that passes underneath the Fi.
// It runs along the X axis (length), centered in Y.
// It sits between the bottom of the Fi and the bottom case wall.
collar_width     = 25.4; // mm - 1 inch collar width (Y dimension)
collar_thickness = 3;    // mm - collar thickness (Z dimension)

// ============================================================
// Screw Layout
// ============================================================
// Screws run along each side (left and right, +Y and -Y).
// They are evenly distributed along the X axis (length of Fi).
// The screws hold the top and bottom case halves together.
num_screws_per_side = 3; // 3 screws on +Y side, 3 on -Y side = 6 total

// ============================================================
// Derived Dimensions
// ============================================================

// Case length: Fi length + wall_thickness on each end
case_length = fi_length + 2 * wall_thickness;

// Case width: must accommodate Fi body + gap + screw shaft + screw head + margin
// on each side. The screw head must clear the Fi body with material on both sides.
// Inner clearance from Fi edge to inner screw head edge:
//   gap + screw_shaft_d/2 - screw_head_d/2
// This must be >= 0, so gap >= (screw_head_d - screw_shaft_d) / 2 = 1.375mm.
// We use 1.5mm gap for a small margin.
// Breakdown per side from center:
//   fi_width/2            = half the Fi body
//   + 1.5                 = 1.5mm clearance gap (ensures screw head clears Fi)
//   + screw_shaft_d/2     = from gap to screw center (half shaft diameter)
//   + screw_head_d/2      = from screw center to outer edge of head
//   + 0.5                 = 0.5mm material margin outside the screw head
// Multiply by 2 for both sides, add to fi_width.
case_width  = fi_width + 2 * (1.5 + screw_shaft_d / 2 + screw_head_d / 2 + 0.5);

// case_height: Fi height + top/bottom walls only (without collar).
// NOT used for the actual case shell — see full_case_height below.
// Kept for reference; the actual shell uses full_case_height which
// includes the collar: fi_height + collar_thickness + 2*wall_thickness.
case_height = fi_height + 2 * wall_thickness;

// Clearance for screw holes (loose fit for M3)
screw_hole_d    = screw_shaft_d + 0.3;  // 3.3mm through-hole for M3 shaft
screw_head_bore = screw_head_d  + 0.5;  // 6.0mm counterbore for socket head

// ============================================================
// Fi Mini Body Module
// ============================================================
// Generates a solid representing the Fi Mini tracker, centered at origin.
// Uses BOSL2 cuboid() with rounding on vertical (Z) edges only:
//   - The four vertical corners are rounded with radius fi_corner_r
//   - Top and bottom faces remain flat (no rounding on horizontal edges)
//   - The bounding box stays exactly fi_length x fi_width x fi_height
//     (rounding cuts inward from the corners, does not expand the shape)
module fi_mini_body() {
    cuboid(
        [fi_length, fi_width, fi_height],
        rounding = fi_corner_r,  // radius applied to selected edges
        edges = "Z",             // only round the 4 vertical (Z-parallel) edges
        $fn = 40                 // smoothness of rounded edges
    );
}

// ============================================================
// Collar Cutout Module
// ============================================================
// Generates a rectangular volume representing the collar slot.
// This will be subtracted from the case to create the channel
// the collar passes through.
//
// Positioning:
//   - Centered in X and Y (collar runs along the full case length + overhang)
//   - The collar sits directly below the Fi body:
//       Fi bottom face is at z = -fi_height/2
//       Collar occupies z = -fi_height/2 - collar_thickness  to  z = -fi_height/2
//   - translate Z = -(fi_height + collar_thickness) / 2  centers the collar slab
//     at the midpoint between -fi_height/2 and -fi_height/2 - collar_thickness
//   - Length is case_length + 20mm so it extends 10mm past each end of the case
//     (ensures the collar channel is open-ended on both sides)
module collar_cutout() {
    translate([0, 0, -(fi_height + collar_thickness) / 2])
        cube([case_length + 20, collar_width, collar_thickness], center = true);
}


// ============================================================
// M3x6 SHCS Module
// ============================================================
// Generates a single M3x6mm socket head cap screw, oriented with:
//   - Head at the bottom (z = 0 to z = screw_head_h)
//   - Shaft extending upward (z = screw_head_h to z = screw_head_h + screw_shaft_l)
//
// The screw is built at the origin with the base of the head at z=0.
// Callers translate it into position.
module m3x6_shcs() {
    // Head: cylinder from z=0 to z=screw_head_h (3mm tall, 5.5mm diameter)
    cylinder(d = screw_head_d, h = screw_head_h, $fn = 30);
    // Shaft: cylinder from z=screw_head_h to z=screw_head_h+screw_shaft_l
    // (6mm tall, 3mm diameter, extends upward from top of head)
    translate([0, 0, screw_head_h])
        cylinder(d = screw_shaft_d, h = screw_shaft_l, $fn = 30);
}

// ============================================================
// Screw Row Module
// ============================================================
// Places num_screws_per_side (3) screws evenly spaced along the X axis
// on one side of the Fi Mini.
//
// Parameters:
//   side: +1 for the +Y side, -1 for the -Y side
//
// Y positioning (lateral):
//   The screw centerline is placed at:
//     y = side * (fi_width/2 + 1 + screw_shaft_d/2)
//   This means:
//     fi_width/2       = edge of the Fi body
//     + 1.5            = 1.5mm clearance gap (screw head clears Fi edge by 0.125mm)
//     + screw_shaft_d/2 = to the center of the screw shaft (1.375mm for M2.75)
//   The screw head (5.5mm dia) extends further outward; the case wall provides
//   1mm of material beyond the head edge.
//
// Z positioning (vertical):
//   Screw heads sit flush with the bottom of the case:
//     z_bottom = -(fi_height/2 + collar_thickness + wall_thickness)
//   This is the absolute bottom of the case. The head occupies z_bottom to
//   z_bottom + screw_head_h, and the shaft extends upward from there into
//   the top case half where threads bite into the material.
//
// X distribution:
//   Screws are spread across screw_spread, which is fi_length minus twice
//   the case corner radius (fi_corner_r + wall_thickness) to keep end screws
//   inside the straight section of the case wall, away from rounded corners.
//   BOSL2 xcopies(l=screw_spread, n=3) places 3 copies evenly, centered at x=0.
module screw_row(side = 1) {
    // Lateral offset: Fi edge + 1.5mm gap + half shaft diameter to screw center
    y_pos = side * (fi_width / 2 + 1.5 + screw_shaft_d / 2);
    // Vertical offset: bottom of case (below Fi center by half Fi + collar + wall)
    z_bottom = -(fi_height / 2 + collar_thickness + wall_thickness);
    // Inset the screw spread so end screws clear the case's rounded corners.
    // The case corner radius is fi_corner_r + wall_thickness. We inset by
    // that radius so the outermost screws sit just inside the straight section.
    screw_spread = fi_length - 2 * (fi_corner_r + wall_thickness);
    translate([0, y_pos, z_bottom])
        xcopies(l = screw_spread, n = num_screws_per_side)
            m3x6_shcs();
}

// ============================================================
// All Screws Module
// ============================================================
// Places screw rows on both the +Y and -Y sides of the case.
// Total: num_screws_per_side * 2 = 6 screws.
module all_screws() {
    screw_row(side = 1);   // +Y side (right when viewed from above, +X = forward)
    screw_row(side = -1);  // -Y side (left when viewed from above)
}


// ============================================================
// USB-C Port Cutout Module
// ============================================================
// Carves a rounded rectangular opening in the -Y (long) side of the case
// so a USB-C charging cable can be plugged in while the Fi is in the case.
// Positioned 3/4 of the way up the Fi body.
// Uses hull() of 4 cylinders to create a stadium/rounded-rect shape.
module usbc_cutout() {
    // Half-dimensions minus rounding for cylinder center placement
    hw = usbc_width / 2 - usbc_rounding;
    hh = usbc_height / 2 - usbc_rounding;

    translate([0, -(fi_width / 2 + wall_thickness), usbc_z_offset])
        rotate([90, 0, 0])
            hull() {
                for (x = [-hw, hw], z = [-hh, hh])
                    translate([x, z, 0])
                        cylinder(r = usbc_rounding, h = usbc_depth, center = true, $fn = 20);
            }
}

// ============================================================
// Full Case Module
// ============================================================
// Generates the complete case as a single solid, ready to be split
// into top and bottom halves using intersection.
//
// Construction:
//   1. Start with a solid cuboid representing the outer shell of the case.
//      - X: case_length (fi_length + 2*wall_thickness)
//      - Y: case_width  (fi_width + screw clearance + margins)
//      - Z: full_case_height = fi_height + collar_thickness + 2*wall_thickness
//      The case is centered in X/Y. In Z it is shifted down so that the
//      Fi cavity remains centered at the origin:
//        top of case  = fi_height/2 + wall_thickness
//        bottom of case = -(fi_height/2 + collar_thickness + wall_thickness)
//
//   2. Subtract fi_mini_body() — carves out the Fi tracker cavity at origin.
//
//   3. Subtract collar_cutout() — carves out the collar channel below the Fi,
//      extending past both ends of the case so the collar can slide through.
//
//   4. Subtract all_screws() — carves out screw head counterbores and shaft
//      holes on both sides. Heads are flush with the bottom; shafts thread
//      up into the top half.
//
// The full_case_height spans from z_bottom to z_top:
//   z_top    = fi_height/2 + wall_thickness
//   z_bottom = -(fi_height/2 + collar_thickness + wall_thickness)
//   full_case_height = z_top - z_bottom
//                    = fi_height + collar_thickness + 2*wall_thickness
//
// The case center in Z is offset from origin because the collar adds
// asymmetry below. The center of the case cuboid is at:
//   z_center = (z_top + z_bottom) / 2
//            = (wall_thickness - collar_thickness) / 2

full_case_height = fi_height + collar_thickness + 2 * wall_thickness;

module full_case() {
    difference() {
        // Outer shell: solid block encompassing Fi + collar + walls.
        // Centered in X/Y. In Z, shifted so that:
        //   top  = fi_height/2 + wall_thickness
        //   bottom = -(fi_height/2 + collar_thickness + wall_thickness)
        translate([0, 0, (wall_thickness - collar_thickness) / 2])
            minkowski() {
                cuboid(
                    [case_length - 2*edge_rounding, case_width - 2*edge_rounding, full_case_height - 2*edge_rounding],
                    rounding = fi_corner_r + wall_thickness - edge_rounding,
                    edges = "Z",
                    $fn = 40
                );
                sphere(r = edge_rounding, $fn = 20);
            }

        // Subtract Fi Mini cavity, extended upward so the top wall is
        // top_thickness at center. The extra height shifts the cavity
        // up by (wall_thickness - top_thickness)/2.
        translate([0, 0, (wall_thickness - top_thickness) / 2])
            cuboid(
                [fi_length, fi_width, fi_height + wall_thickness - top_thickness + 0.01],
                rounding = fi_corner_r,
                edges = "Z",
                $fn = 40
            );

        // Subtract collar channel (open-ended, extends past case)
        collar_cutout();

        // Subtract screw volumes (counterbores + shaft holes)
        all_screws();

        // Subtract USB-C port opening on the -Y (long) side
        usbc_cutout();
    }
}


// ============================================================
// Split and Orient for 3D Printing
// ============================================================
// Split plane: z = -fi_height/2 (where collar meets Fi body)
//
// Top half: contains the Fi cavity and top wall. Translated down
//   by fi_height/2 so the flat split face sits on the build plate (z=0).
//   The rounded top of the case faces upward.
//
// Cap (bottom half): contains the collar channel and screw counterbores.
//   Flipped 180° so the rounded outer bottom becomes the top and the
//   flat split face sits on the build plate (z=0). Translated in Y
//   by case_width + 5mm so it sits next to the top half.

// ============================================================
// QR Code Module
// ============================================================
// Generates a QR code centered on the top surface of the case.
// The QR code is 1mm thick and sits flush with the top surface,
// inset into the case body.
//
// In the original coordinate system (before split), the top
// surface of the case outer shell is at:
//   z_top = (wall_thickness - collar_thickness)/2 + full_case_height/2
// The QR code is placed face-up on this surface.

case_z_top = (wall_thickness - collar_thickness) / 2 + full_case_height / 2;

qr_size = 25;  // mm - QR code fits within the top surface

module qr_code() {
    translate([0, 0, case_z_top - qr_thickness + 0.01])
        qr(qr_code_url,
           width = qr_size, height = qr_size, thickness = qr_thickness, center = true);
}

// ============================================================
// Top Half Module (for reuse)
// ============================================================
module top_half() {
    intersection() {
        full_case();
        translate([0, 0, (split_z + 50) / 2])
            cube([200, 200, 50 - split_z], center = true);
    }
}

split_z = -fi_height / 2;

// Top half — body (black), with QR code subtracted if a URL is provided
translate([0, 0, fi_height / 2])
    color("black")
        if (qr_code_url != "") {
            difference() {
                top_half();
                qr_code();
            }
        } else {
            top_half();
        }

// QR code (white), only the part that intersects the top half
if (qr_code_url != "")
    translate([0, 0, fi_height / 2])
        color("white")
            intersection() {
                qr_code();
                top_half();
            }

// Cap (bottom half) — everything below split_z, flipped 180° and
// translated so the bottom of the cap sits on z=0, offset in Y
translate([0, case_width + 5, 2 * split_z])
    rotate([180, 0, 0])
        translate([0, 0, split_z])
            color("black")
                intersection() {
                    full_case();
                    translate([0, 0, (split_z - 50) / 2])
                        cube([200, 200, split_z + 50], center = true);
                }
