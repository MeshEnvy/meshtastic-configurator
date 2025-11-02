FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && \
    apt-get install -y \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install PlatformIO
RUN pip install --no-cache-dir platformio

# Clone Meshtastic firmware repository
RUN git clone https://github.com/meshtastic/firmware.git /firmware

# Set working directory
WORKDIR /firmware

# Copy build script
COPY build.sh /build.sh
RUN chmod +x /build.sh

# Default entrypoint
ENTRYPOINT ["/build.sh"]

