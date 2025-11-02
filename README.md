# Meshtastic Firmware Build Service

A web-based build service for Meshtastic firmware with a VanJS+PicoCSS frontend, Bun/TypeScript API server, and Docker-based build worker.

## Architecture

### `/web` - Frontend

- VanJS + PicoCSS UI for selecting build configuration options
- Form submission to API
- Server-Sent Events (SSE) client for real-time build progress updates
- Download link display when build completes

### `/api` - Web Server

- Bun + TypeScript web server
- Receives build requests from frontend
- Job queue management using bottleneck for concurrent build limiting (max 2 concurrent builds)
- Server-Sent Events (SSE) endpoint for build progress
- Launches Docker worker processes for builds
- Firmware repository management:
  - Uses `api/firmware` as a git submodule (Meshtastic firmware repository)
  - Automatically fetches latest changes every hour
  - Provides endpoints for branches, tags, and build environments
- Build artifact management:
  - Stores builds in `.buildcache` directory
  - Stable key hashing based on configuration settings array
  - Skips rebuild if hash exists in cache
  - Provides download links for completed builds

### `/worker` - Docker Build System

- Dockerfile that clones Meshtastic firmware repository
- Build script that:
  - Runs `git fetch --all` at runtime
  - Checks out branch/tag specified in JSON config
  - Configures PlatformIO build
  - Executes build
  - Outputs artifacts to designated location

## Setup

### Prerequisites

- Docker installed and running
- Bun installed (https://bun.sh)
- Git (for initializing the firmware repository submodule)

### Initializing the Firmware Repository

The firmware repository is included as a git submodule. Initialize it with:

```bash
git submodule update --init --recursive
```

This will clone the Meshtastic firmware repository into `api/firmware`.

### Building the Docker Worker

```bash
cd worker
docker build -t meshtastic-builder:latest .
```

### Starting the API Server

```bash
cd api
bun install
bun run start
```

The API server will run on `http://localhost:3000` by default.

### Serving the Frontend

You can serve the frontend using any static file server. For example:

```bash
cd web
python3 -m http.server 8000
```

Or using Bun:

```bash
cd web
bun --serve index.html
```

The frontend automatically detects the API URL based on the environment:

- In development (localhost/127.0.0.1): Uses `http://localhost:3000`
- In production: Uses `https://configurator-api.meshenvy.org`

You can modify the `getApiUrl()` function in `web/src/main.ts` to change this behavior.

## Usage

1. Open the web frontend in your browser
2. Enter the Git branch/tag/commit you want to build from
3. Select the build environment (ESP32, T-Beam, Heltec, etc.)
4. Click "Start Build"
5. Monitor progress via Server-Sent Events
6. Download the firmware when complete

## Configuration

Build configurations are specified as JSON with the following structure:

```json
{
  "branch": "master",
  "environment": "esp32dev",
  "buildFlags": [],
  "features": {}
}
```

- `branch` (required): Git branch, tag, or commit hash
- `environment` (optional): PlatformIO environment name (default: `esp32dev`)
- `buildFlags` (optional): Additional build flags
- `features` (optional): Feature flags and options

## API Endpoints

### Firmware Information

- `GET /firmware/branches` - Get list of available branches
- `GET /firmware/tags` - Get list of available tags
- `GET /firmware/latest-tag` - Get the latest tag
- `POST /firmware/validate` - Validate a branch/tag/commit reference
- `GET /firmware/environments` - Get list of available build environments

### Build Management

- `POST /build` - Submit a build request
- `GET /build/:id` - Get build job status
- `GET /build/:id/progress` - SSE endpoint for build progress
- `GET /download/:cacheKey` - Download built firmware

## Build Cache

Builds are cached in `.buildcache` directory using SHA-256 hashes of the configuration. Identical builds will be served from cache without rebuilding.

## License

MIT
