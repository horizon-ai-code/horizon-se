$ErrorActionPreference = "Stop"

# Navigate to the directory where the script is located
Set-Location -Path $PSScriptRoot

Write-Host "Checking for NVIDIA GPU..."

# Check if nvidia-smi is in PATH
$nvidiaSmi = Get-Command "nvidia-smi" -ErrorAction SilentlyContinue

if ($nvidiaSmi) {
    # Run nvidia-smi and get VRAM
    $vramOutput = & nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits
    
    # In case of multiple GPUs, take the first one
    if ($vramOutput -is [array]) {
        $vramOutput = $vramOutput[0]
    }

    $vramMB = 0
    $isNumeric = [int32]::TryParse($vramOutput, [ref]$vramMB)

    if ($isNumeric -and $vramMB -ge 4000) {
        Write-Host "Compatible NVIDIA GPU detected (VRAM: ${vramMB}MB)." -ForegroundColor Green
        Write-Host "Starting GPU-accelerated Docker container..."
        docker compose -f ../docker-compose.yml up -d
    } else {
        if (-not $isNumeric) {
            Write-Host "NVIDIA GPU found, but could not determine VRAM size." -ForegroundColor Yellow
        } else {
            Write-Host "NVIDIA GPU found, but VRAM (${vramMB}MB) is less than the required 4GB (4000MB)." -ForegroundColor Yellow
        }
        Write-Host "Falling back to CPU-only Docker container..."
        docker compose -f ../docker-compose.cpu.yml up -d
    }
} else {
    Write-Host "No NVIDIA GPU detected (nvidia-smi not found)." -ForegroundColor Yellow
    Write-Host "Starting CPU-only Docker container..."
    docker compose -f ../docker-compose.cpu.yml up -d
}

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "HorizonAI is starting up!" -ForegroundColor Cyan
Write-Host "Please wait a few moments for the containers to initialize." -ForegroundColor Cyan
Write-Host "Access the application at: http://localhost:3000" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
