include <BOSL2/std.scad>
include <BOSL2/gears.scad>
scaleFactor = 4.38;
$fn = 32;
height = 68*scaleFactor;
diameter = 16*scaleFactor;
flange_diameter = 14*scaleFactor;
flange_height = 8*scaleFactor;
cap_height = 15*scaleFactor;
tail_height = 4*scaleFactor;
tail_attachment_diameter = 5*scaleFactor;
wall_thickness = 1*scaleFactor;
slop = 0.4;
cap_corner_radius = 1.5*scaleFactor;

body_height = height - cap_height - tail_height;

view = "printing";
//view = "assy";
//view = "large_printing";

module body() {
    translate([0,0,-tail_height])
    difference(){
        union(){
            translate([0,0,body_height + tail_height])
            cylinder(d = flange_diameter, h = flange_height);
            translate([0,0,tail_height])
            cylinder(d = diameter, h = body_height);
        }
        cylinder(h = tail_height * 2, d = tail_attachment_diameter);
        translate([0,0,tail_height + wall_thickness*2])
        cylinder(h = body_height + tail_height + wall_thickness * 4, d = flange_diameter - wall_thickness *2);
    }
}

module tail(){
    difference(){
        union(){
            translate([0,0,tail_height/2])
        spur_gear((diameter/2)/(3.14*3.14), 60, tail_height);
            difference(){
                union(){
                    cylinder(d = tail_attachment_diameter - slop, h = tail_height + wall_thickness * 2);
                    translate([0,0,tail_height + wall_thickness * 2.8])
                    sphere(d = tail_attachment_diameter + wall_thickness/4);
                }
                cube([wall_thickness,tail_attachment_diameter + wall_thickness*2, tail_height + wall_thickness * 20], center = true);
            }
        }
        cylinder(d = flange_diameter - wall_thickness * 4, h = tail_height/2);
    }
}

module cap(){
    difference(){
        minkowski(){
            cylinder(d = diameter - cap_corner_radius, h = cap_height - cap_corner_radius/2);
            difference(){
                sphere(d = cap_corner_radius);
                translate([0,0,-cap_height/2])
                cube([diameter,diameter,cap_height], center = true);
            }
        }
        cylinder(d = flange_diameter + slop*2, h = cap_height - cap_corner_radius);
    }
}

if(view == "printing"){
    body();
    translate([diameter * 1.2,0,0])
    tail();
    
    translate([0,-diameter  * 1.2,0])
    cap();
}

