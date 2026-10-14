@echo off
setlocal enabledelayedexpansion

echo ======================================================
echo         ViralReels Studio Environment Setup (Windows)
echo ======================================================

cd /d "%~dp0.."

if not exist "models" mkdir models
if not exist "bin" mkdir bin
if not exist "storage\uploads" mkdir storage\uploads
if not exist "storage\temp" mkdir storage\temp
if not exist "storage\outputs" mkdir storage\outputs

set "MODEL_PATH=models\ggml-base.bin"
set "MODEL_URL=https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"

if exist "%MODEL_PATH%" (
    echo [OK] Whisper model already exists: %MODEL_PATH%
) else (
    echo [..] Downloading Whisper base model (~142MB)...
    curl -L --progress-bar -o "%MODEL_PATH%" "%MODEL_URL%"
    if %ERRORLEVEL% EQU 0 (
        echo [OK] Whisper model downloaded successfully.
    ) else (
        echo [ERR] Failed to download Whisper model.
    )
)

echo.
echo Note: For Windows, ensure ffmpeg.exe and whisper-cli.exe are placed in ./bin/ or added to your PATH.
echo Ensure Redis is running via WSL or Memurai / native Redis port.
echo ======================================================
pause
