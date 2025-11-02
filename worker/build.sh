#!/bin/bash
set -e

# Configuration file path (mounted from API)
CONFIG_FILE="${CONFIG_FILE:-/config.json}"
OUTPUT_DIR="${OUTPUT_DIR:-/output}"

# Check if config file exists
if [ ! -f "$CONFIG_FILE" ]; then
  echo "ERROR: Configuration file not found at $CONFIG_FILE"
  exit 1
fi

# Parse JSON config (requires jq, but we'll use Python if jq not available)
BRANCH=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['branch'])" 2>/dev/null || echo "main")
ENVIRONMENT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('environment', 'esp32dev'))" 2>/dev/null || echo "esp32dev")

echo "Building Meshtastic firmware..."
echo "Branch: $BRANCH"
echo "Environment: $ENVIRONMENT"

# Navigate to firmware directory
cd /firmware

# Fetch latest from all branches
echo "Fetching latest changes from all branches..."
git fetch --all

# Checkout specified branch
echo "Checking out branch: $BRANCH"
git checkout "$BRANCH" || git checkout -b "$BRANCH" "origin/$BRANCH"

# Update submodules if they exist
if [ -f .gitmodules ]; then
  echo "Updating submodules..."
  git submodule update --init --recursive
fi

# Build using PlatformIO
echo "Building firmware with PlatformIO..."
platformio run --environment "$ENVIRONMENT"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Copy build artifacts
BUILD_DIR=".pio/build/$ENVIRONMENT"
if [ -d "$BUILD_DIR" ]; then
  echo "Copying build artifacts to $OUTPUT_DIR..."
  cp -r "$BUILD_DIR"/* "$OUTPUT_DIR/" || true
  
  # Also copy any firmware.bin or similar files
  find "$BUILD_DIR" -name "*.bin" -o -name "*.elf" | while read -r file; do
    cp "$file" "$OUTPUT_DIR/" || true
  done
else
  echo "WARNING: Build directory $BUILD_DIR not found"
fi

echo "Build complete. Artifacts in $OUTPUT_DIR"

