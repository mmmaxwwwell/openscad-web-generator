# SPDX-License-Identifier: AGPL-3.0-or-later
#
# CMake build for Android JNI slicer bindings.
# Links against pre-built libslic3r.so from the Nix build (nix/orcaslicer-android.nix).
#
# The Nix output must be copied to the project before building:
#   android/app/src/main/jniLibs/<abi>/libslic3r.so  (prebuilt shared library)
#   android/app/src/main/jni/include/                 (headers from Nix output)
#
# See scripts/copy-android-slicer.sh for the copy step.

cmake_minimum_required(VERSION 3.13)
project(slicer_jni CXX)

set(CMAKE_CXX_STANDARD 17)

# Suppress narrowing warnings from OrcaSlicer headers (GCode.hpp coord_t → size_t on ARM32)
add_compile_options(-Wno-c++11-narrowing)

# Pre-built libslic3r.so from Nix
add_library(slic3r SHARED IMPORTED)
set_target_properties(slic3r PROPERTIES
    IMPORTED_LOCATION "${CMAKE_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libslic3r.so"
)

# JNI bindings library
add_library(slicer_jni SHARED
    slicer_jni.cpp
)

target_include_directories(slicer_jni PRIVATE
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_SOURCE_DIR}/include/eigen3
)

target_link_libraries(slicer_jni PRIVATE
    slic3r
    android
    log
)
