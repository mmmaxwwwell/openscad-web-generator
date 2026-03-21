#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Copy Nix-built OrcaSlicer native libraries into the Android project.
# Run this before building the APK with native slicer support.
#
# Usage: nix develop -c bash scripts/copy-android-slicer.sh
#
# This builds (or fetches from cache) the orcaslicer-android packages
# and copies the .so files and headers to the expected locations.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ANDROID_DIR="$PROJECT_DIR/android/app/src/main"

echo "Building OrcaSlicer for Android ARM64..."
ARM64_OUT=$(nix build .#orcaslicer-android-arm64 --no-link --print-out-paths)

echo "Building OrcaSlicer for Android ARM32..."
ARM32_OUT=$(nix build .#orcaslicer-android-arm32 --no-link --print-out-paths)

# Copy shared libraries to jniLibs
echo "Copying native libraries..."
mkdir -p "$ANDROID_DIR/jniLibs/arm64-v8a"
mkdir -p "$ANDROID_DIR/jniLibs/armeabi-v7a"
cp "$ARM64_OUT/lib/libslic3r.so" "$ANDROID_DIR/jniLibs/arm64-v8a/"
cp "$ARM32_OUT/lib/libslic3r.so" "$ANDROID_DIR/jniLibs/armeabi-v7a/"

# Copy headers for JNI compilation (use ARM64 headers — they're identical)
echo "Copying headers..."
rm -rf "$ANDROID_DIR/jni/include"
mkdir -p "$ANDROID_DIR/jni/include"
cp -r "$ARM64_OUT/include/"* "$ANDROID_DIR/jni/include/"

echo ""
echo "Done! Native slicer libraries copied to:"
echo "  $ANDROID_DIR/jniLibs/arm64-v8a/libslic3r.so"
echo "  $ANDROID_DIR/jniLibs/armeabi-v7a/libslic3r.so"
echo "  $ANDROID_DIR/jni/include/ (headers)"
echo ""
echo "You can now build the APK with: nix develop -c npm run apk"
