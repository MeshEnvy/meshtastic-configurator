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

# Parse JSON config
BRANCH=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['branch'])" 2>/dev/null || echo "main")
ENVIRONMENT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('environment', 'esp32dev'))" 2>/dev/null || echo "esp32dev")

echo "Building Meshtastic firmware..."
echo "Branch: $BRANCH"
echo "Environment: $ENVIRONMENT"

# Build build flags from config
BUILD_FLAGS=""
# Parse config and build flags directly from the config file
BUILD_FLAGS=$(python3 <<PYEOF
import json
import sys
try:
    with open('$CONFIG_FILE') as f:
        data = json.load(f)
        config = data.get('config', {})
except:
    config = {}
flags = []

# Feature toggles
if config.get('disableNtp'):
    flags.append('-DDISABLE_NTP')
if config.get('disableWelcomeUnset'):
    flags.append('-DDISABLE_WELCOME_UNSET')

# Minimize build (enables all exclusions)
if config.get('minimizeBuild'):
    flags.append('-DMESHTASTIC_MINIMIZE_BUILD=1')

# System-level exclusions
if config.get('excludeWifi'):
    flags.append('-DMESHTASTIC_EXCLUDE_WIFI')
if config.get('excludeBluetooth'):
    flags.append('-DMESHTASTIC_EXCLUDE_BLUETOOTH')
if config.get('excludeGps'):
    flags.append('-DMESHTASTIC_EXCLUDE_GPS')
if config.get('excludeScreen'):
    flags.append('-DMESHTASTIC_EXCLUDE_SCREEN')
if config.get('excludeMqtt'):
    flags.append('-DMESHTASTIC_EXCLUDE_MQTT')
if config.get('excludePowermon'):
    flags.append('-DMESHTASTIC_EXCLUDE_POWERMON')
if config.get('excludeI2c'):
    flags.append('-DMESHTASTIC_EXCLUDE_I2C')
if config.get('excludePki'):
    flags.append('-DMESHTASTIC_EXCLUDE_PKI')
if config.get('excludePowerFsm'):
    flags.append('-DMESHTASTIC_EXCLUDE_POWER_FSM')
if config.get('excludeTz'):
    flags.append('-DMESHTASTIC_EXCLUDE_TZ')

# Module exclusions
if config.get('excludeModules'):
    flags.append('-DMESHTASTIC_EXCLUDE_MODULES')
if config.get('excludeAudio'):
    flags.append('-DMESHTASTIC_EXCLUDE_AUDIO')
if config.get('excludeDetectionSensor'):
    flags.append('-DMESHTASTIC_EXCLUDE_DETECTIONSENSOR')
if config.get('excludeEnvironmentalSensor'):
    flags.append('-DMESHTASTIC_EXCLUDE_ENVIRONMENTAL_SENSOR')
if config.get('excludeHealthTelemetry'):
    flags.append('-DMESHTASTIC_EXCLUDE_HEALTH_TELEMETRY')
if config.get('excludeExternalNotification'):
    flags.append('-DMESHTASTIC_EXCLUDE_EXTERNALNOTIFICATION')
if config.get('excludePaxcounter'):
    flags.append('-DMESHTASTIC_EXCLUDE_PAXCOUNTER')
if config.get('excludePowerTelemetry'):
    flags.append('-DMESHTASTIC_EXCLUDE_POWER_TELEMETRY')
if config.get('excludeRangetest'):
    flags.append('-DMESHTASTIC_EXCLUDE_RANGETEST')
if config.get('excludeRemoteHardware'):
    flags.append('-DMESHTASTIC_EXCLUDE_REMOTEHARDWARE')
if config.get('excludeStoreforward'):
    flags.append('-DMESHTASTIC_EXCLUDE_STOREFORWARD')
if config.get('excludeTextmessage'):
    flags.append('-DMESHTASTIC_EXCLUDE_TEXTMESSAGE')
if config.get('excludeAtak'):
    flags.append('-DMESHTASTIC_EXCLUDE_ATAK')
if config.get('excludeCannedmessages'):
    flags.append('-DMESHTASTIC_EXCLUDE_CANNEDMESSAGES')
if config.get('excludeNeighborinfo'):
    flags.append('-DMESHTASTIC_EXCLUDE_NEIGHBORINFO')
if config.get('excludeTraceroute'):
    flags.append('-DMESHTASTIC_EXCLUDE_TRACEROUTE')
if config.get('excludeWaypoint'):
    flags.append('-DMESHTASTIC_EXCLUDE_WAYPOINT')
if config.get('excludeInputbroker'):
    flags.append('-DMESHTASTIC_EXCLUDE_INPUTBROKER')
if config.get('excludeSerial'):
    flags.append('-DMESHTASTIC_EXCLUDE_SERIAL')
if config.get('excludePowerStress'):
    flags.append('-DMESHTASTIC_EXCLUDE_POWERSTRESS')
if config.get('excludeAdmin'):
    flags.append('-DMESHTASTIC_EXCLUDE_ADMIN')

print(' '.join(flags))
PYEOF
)
fi

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
if [ -n "$BUILD_FLAGS" ]; then
  echo "Using build flags: $BUILD_FLAGS"
  # Pass build flags via --build-flag option (each flag needs its own --build-flag)
  # Convert space-separated flags to array and pass each one
  PIO_ARGS=()
  for flag in $BUILD_FLAGS; do
    PIO_ARGS+=("--build-flag" "$flag")
  done
  platformio run --environment "$ENVIRONMENT" "${PIO_ARGS[@]}"
else
  platformio run --environment "$ENVIRONMENT"
fi

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

