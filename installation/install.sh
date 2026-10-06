#!/bin/bash

# Navigate to the directory where the script is located
cd "$(dirname "$0")"

echo "Checking for NVIDIA GPU..."

if command -v nvidia-smi &> /dev/null; then
    # nvidia-smi is available, check VRAM
    VRAM_MB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -n 1 | awk '{print $1}')
    
    if [[ "$VRAM_MB" =~ ^[0-9]+$ ]] && [ "$VRAM_MB" -ge 4000 ]; then
        echo "Compatible NVIDIA GPU detected (VRAM: ${VRAM_MB}MB)."
        echo "Starting GPU-accelerated Docker container..."
        docker compose -f ../docker-compose.yml up -d
    else
        echo "NVIDIA GPU found, but VRAM (${VRAM_MB}MB) is less than the required 4GB (4000MB)."
        echo "Falling back to CPU-only Docker container..."
        docker compose -f ../docker-compose.cpu.yml up -d
    fi
else
    echo "No NVIDIA GPU detected (nvidia-smi not found)."
    echo "Starting CPU-only Docker container..."
    docker compose -f ../docker-compose.cpu.yml up -d
fi

echo "======================================================="
echo "HorizonAI is starting up!"
echo "Please wait a few moments for the containers to initialize."
echo "Access the application at: http://localhost:3000"
echo "======================================================="
