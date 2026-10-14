#!/usr/bin/env bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================${NC}"
echo -e "${BLUE}        ViralReels Studio Environment Setup           ${NC}"
echo -e "${BLUE}======================================================${NC}"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Ensure directories exist
mkdir -p bin models storage/uploads storage/temp storage/outputs

# 1. Download Whisper GGML Model
MODEL_PATH="$PROJECT_ROOT/models/ggml-base.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"

if [ -f "$MODEL_PATH" ] && [ -s "$MODEL_PATH" ]; then
    echo -e "${GREEN}[✓] Whisper model already exists: $MODEL_PATH${NC}"
else
    echo -e "${YELLOW}[→] Downloading Whisper base model (~142MB)...${NC}"
    curl -L --progress-bar -o "$MODEL_PATH" "$MODEL_URL"
    echo -e "${GREEN}[✓] Whisper model downloaded successfully.${NC}"
fi

# 2. Check / Setup Whisper-cli binary
WHISPER_CLI="$PROJECT_ROOT/bin/whisper-cli"
if [ -f "$WHISPER_CLI" ] && [ -x "$WHISPER_CLI" ]; then
    echo -e "${GREEN}[✓] whisper-cli binary already installed at $WHISPER_CLI${NC}"
else
    echo -e "${YELLOW}[→] Building whisper.cpp binary locally...${NC}"
    BUILD_DIR="/tmp/whisper_cpp_build_$$"
    mkdir -p "$BUILD_DIR"
    git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$BUILD_DIR"
    
    # Build whisper-cli
    if command -v cmake >/dev/null 2>&1; then
        echo -e "${BLUE}[*] Compiling with CMake (Static)...${NC}"
        cmake -B "$BUILD_DIR/build" -S "$BUILD_DIR" -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_EXAMPLES=ON
        cmake --build "$BUILD_DIR/build" --config Release --target whisper-cli -j 4
        if [ -f "$BUILD_DIR/build/bin/whisper-cli" ]; then
            cp "$BUILD_DIR/build/bin/whisper-cli" "$WHISPER_CLI"
        elif [ -f "$BUILD_DIR/build/bin/Release/whisper-cli" ]; then
            cp "$BUILD_DIR/build/bin/Release/whisper-cli" "$WHISPER_CLI"
        else
            find "$BUILD_DIR/build" -name "whisper-cli" -exec cp {} "$WHISPER_CLI" \;
        fi
    else
        echo -e "${BLUE}[*] Compiling with Make...${NC}"
        make -C "$BUILD_DIR" whisper-cli -j 4
        cp "$BUILD_DIR/whisper-cli" "$WHISPER_CLI"
    fi

    chmod +x "$WHISPER_CLI"
    rm -rf "$BUILD_DIR"
    echo -e "${GREEN}[✓] whisper-cli compiled and installed at $WHISPER_CLI${NC}"
fi

# 3. Check FFmpeg with libass support
HAS_SYSTEM_FFMPEG=false
if command -v ffmpeg >/dev/null 2>&1; then
    if ffmpeg -filters 2>/dev/null | grep -q "ass"; then
        HAS_SYSTEM_FFMPEG=true
        echo -e "${GREEN}[✓] System FFmpeg found with libass filter support: $(command -v ffmpeg)${NC}"
    fi
fi

if [ "$HAS_SYSTEM_FFMPEG" = false ] && [ ! -f "$PROJECT_ROOT/bin/ffmpeg" ]; then
    echo -e "${YELLOW}[→] Downloading static FFmpeg build with libass & QSV/VAAPI support...${NC}"
    FFMPEG_TMP="/tmp/ffmpeg_static_$$"
    mkdir -p "$FFMPEG_TMP"
    FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz"
    curl -L --progress-bar -o "$FFMPEG_TMP/ffmpeg.tar.xz" "$FFMPEG_URL"
    tar -xf "$FFMPEG_TMP/ffmpeg.tar.xz" -C "$FFMPEG_TMP"
    FF_EXTRACTED=$(find "$FFMPEG_TMP" -type f -name "ffmpeg" | head -n 1)
    FP_EXTRACTED=$(find "$FFMPEG_TMP" -type f -name "ffprobe" | head -n 1)
    cp "$FF_EXTRACTED" "$PROJECT_ROOT/bin/ffmpeg"
    cp "$FP_EXTRACTED" "$PROJECT_ROOT/bin/ffprobe"
    chmod +x "$PROJECT_ROOT/bin/ffmpeg" "$PROJECT_ROOT/bin/ffprobe"
    rm -rf "$FFMPEG_TMP"
    echo -e "${GREEN}[✓] Static FFmpeg and FFprobe installed in ./bin/${NC}"
elif [ -f "$PROJECT_ROOT/bin/ffmpeg" ]; then
    echo -e "${GREEN}[✓] Local FFmpeg binary present at $PROJECT_ROOT/bin/ffmpeg${NC}"
fi

# 4. Check Redis Server
if command -v redis-server >/dev/null 2>&1; then
    echo -e "${GREEN}[✓] redis-server found in PATH: $(command -v redis-server)${NC}"
elif [ -f "$PROJECT_ROOT/bin/redis-server" ]; then
    echo -e "${GREEN}[✓] Local redis-server binary found at $PROJECT_ROOT/bin/redis-server${NC}"
else
    echo -e "${YELLOW}[→] Compiling standalone Redis server into ./bin/ (no root required)...${NC}"
    REDIS_TMP="/tmp/redis_build_$$"
    mkdir -p "$REDIS_TMP"
    curl -sL https://download.redis.io/redis-stable.tar.gz | tar -xz -C "$REDIS_TMP"
    make -C "$REDIS_TMP/redis-stable/src" redis-server redis-cli -j 4
    cp "$REDIS_TMP/redis-stable/src/redis-server" "$PROJECT_ROOT/bin/redis-server"
    cp "$REDIS_TMP/redis-stable/src/redis-cli" "$PROJECT_ROOT/bin/redis-cli"
    chmod +x "$PROJECT_ROOT/bin/redis-server" "$PROJECT_ROOT/bin/redis-cli"
    rm -rf "$REDIS_TMP"
    echo -e "${GREEN}[✓] Standalone redis-server installed in ./bin/redis-server${NC}"
fi

echo -e "\n${GREEN}======================================================${NC}"
echo -e "${GREEN}✓ All environment components ready!                  ${NC}"
echo -e "${GREEN}======================================================${NC}"
