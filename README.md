# 🎬 ViralReels Studio Pro

> **Automated Local 9:16 Video Pipeline for Shorts, Reels & TikTok**  
> **0% Cloud API Dependency • 100% Local Inferencing & Processing**

ViralReels Studio is an on-premise, high-performance automated video processing engine designed specifically for short-form content. It generates word-level dynamic karaoke subtitles, auto-crops to 9:16 (1080x1920), normalizes audio loudness to EBU R128 (-14 LUFS), and leverages Intel QuickSync (`h264_qsv`) hardware acceleration with seamless CPU fallback.

---

## ⚡ Key Highlights

1. **Zero External API Costs**: All speech recognition is handled locally by `whisper.cpp` (AVX2 optimized C++ binary), eliminating cloud transcription latency and recurring API bills.
2. **High-Retention Dynamic Subtitles**: Word-by-word karaoke highlighting grouped in 3-word chunks with automatic 480px bottom safe-zone margins (preventing Meta Reels / TikTok UI button overlap).
3. **Hardware-Tuned Performance**: Configured specifically for Intel 12th Gen hybrid architecture (Core i5-1235U baseline):
   - Whisper thread cap (`-t 4`) to prevent thermal throttling.
   - Queue concurrency set to `1` rendering job at a time.
   - RAM usage capped under 2.5 GB.
   - Hardware Intel QuickSync (`h264_qsv`) with automatic fallback to CPU (`libx264`).
4. **BullMQ Asynchronous Architecture**: Clean separation between HTTP ingestion and heavy encoding workers via Redis task queues.
5. **Interactive Web Studio**: Built-in glassmorphic dark-mode web application for drag-and-drop video uploads, live stage progress tracking, and instant 9:16 playback.

---

## 🏗️ Architecture & Processing Flow

```
+-------------------------------------------------------------------------+
|                                Client UI                                |
|          (Upload MP4/MOV, Set Style Preset, Monitor Progress)           |
+-------------------------------------------------------------------------+
                                     |
                                     v HTTP POST (Multipart)
+-------------------------------------------------------------------------+
|                          Fastify API Gateway                            |
|             (File Validation, Storage Staging, Queue Enqueue)           |
+-------------------------------------------------------------------------+
                                     |
                                     v Job Data
+-------------------------------------------------------------------------+
|                         BullMQ + Redis Engine                           |
+-------------------------------------------------------------------------+
                                     |
                                     v Worker Task Execution
+-------------------------------------------------------------------------+
|                         Processing Pipeline                             |
|                                                                         |
|  [Step 1: Audio Extractor] ---> FFmpeg -> 16kHz Mono WAV                |
|               |                                                         |
|               v                                                         |
|  [Step 2: Whisper ASR]     ---> whisper.cpp CLI -> JSON Timestamps      |
|               |                                                         |
|               v                                                         |
|  [Step 3: ASS Engine]      ---> Parse JSON -> Chunking -> Dynamic .ass  |
|               |                                                         |
|               v                                                         |
|  [Step 4: Intel QSV Mix]   ---> FFmpeg + QSV + ASS Filter + loudnorm    |
+-------------------------------------------------------------------------+
                                     |
                                     v Final Video Saved
+-------------------------------------------------------------------------+
|                  Storage Engine (/storage/outputs/)                     |
|                   (Status: COMPLETED, Downloadable)                     |
+-------------------------------------------------------------------------+
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js**: v20+ LTS (Tested on Node.js v24 LTS)
- **Linux (Ubuntu / WSL2)** or **Windows 11**
- **C/C++ Build Tools**: `gcc`, `g++`, `make`, `cmake`, `curl`

### 2. Install Node Dependencies
```bash
npm install
```

### 3. Setup Environment & Binaries
Run the autonomous setup script to download the Whisper GGML base model (`~142MB`), compile `whisper-cli`, install static FFmpeg with `libass` support, and set up standalone Redis:
```bash
npm run setup:env
```
*(On Windows, run `scripts\setup-env.bat`)*

### 4. Start Redis
If Redis is not already running on your system, start the local standalone binary:
```bash
./bin/redis-server --daemonize yes
```
*(Or start system Redis: `sudo systemctl start redis`)*

### 5. Launch ViralReels Studio
```bash
# Development mode with hot-reload
npm run dev

# Or build and start production
npm run build
npm start
```

Open your browser and navigate to:
👉 **`http://localhost:3000`**

---

## 📡 API Reference

### 1. Submit Video Job
- **Endpoint**: `POST /api/v1/jobs`
- **Content-Type**: `multipart/form-data`
- **Parameters**:
  - `file`: Video file (`.mp4`, `.mov`, `.mkv`), max 500 MB, max 180s.
  - `language`: `id` (default: Bahasa Indonesia), `en`, or `auto`.
  - `highlightColor`: Hex string (e.g., `#FFE600`, `#00F0FF`, `#FF007A`).
  - `marginV`: Safe vertical margin in pixels (default: `480`).
  - `maxWordsPerChunk`: Maximum words per subtitle line (default: `3`).

**Response (202 Accepted)**:
```json
{
  "success": true,
  "jobId": "job_c7a8e9d0-f1b2-4d3e-9a1b-2c3d4e5f6a7b",
  "status": "QUEUED",
  "message": "Video successfully scheduled for processing."
}
```

### 2. Poll Job Status
- **Endpoint**: `GET /api/v1/jobs/:jobId`

**Response (200 OK - In Progress)**:
```json
{
  "jobId": "job_c7a8e9d0-f1b2-4d3e-9a1b-2c3d4e5f6a7b",
  "status": "COMPOSITING",
  "progress": 85,
  "result": null,
  "error": null,
  "createdAt": "2026-10-14T06:10:00.000Z"
}
```

**Response (200 OK - Completed)**:
```json
{
  "jobId": "job_c7a8e9d0-f1b2-4d3e-9a1b-2c3d4e5f6a7b",
  "status": "COMPLETED",
  "progress": 100,
  "result": {
    "downloadUrl": "/api/v1/downloads/job_c7a8e9d0.mp4",
    "duration": 42.5,
    "processingTimeSeconds": 18.2,
    "hardwareAccelerationUsed": true,
    "encoderUsed": "h264_qsv"
  },
  "error": null
}
```

### 3. Download Master Video
- **Endpoint**: `GET /api/v1/downloads/:filename`
- Supports HTTP 206 Partial Content range requests for seamless browser seeking.

### 4. Hardware Diagnostics
- **Endpoint**: `GET /api/v1/hardware`
- Returns active CPU info, thread allocations, and Intel QSV driver status.

---

## 📁 Repository Structure

```
viralreels-studio/
├── bin/                         # Local compiled Whisper & FFmpeg binaries
├── models/                      # Whisper GGML models (ggml-base.bin)
├── storage/
│   ├── uploads/                 # Upload staging area
│   ├── temp/                    # Intermediate WAV and ASS files (auto-purged)
│   └── outputs/                 # Final rendered 9:16 MP4 videos
├── scripts/
│   ├── setup-env.sh             # Linux/WSL dependency and model downloader
│   └── setup-env.bat            # Windows setup helper
├── src/
│   ├── config/
│   │   ├── env.ts               # Zod validated configuration schema
│   │   ├── hardware.ts          # Dynamic QSV detection & hardware limits
│   │   └── presets.ts           # Typography, safe-margins & BGR color converter
│   ├── core/
│   │   ├── ingestion.ts         # FFprobe duration, format & audio channel validator
│   │   ├── audioExtractor.ts    # 16kHz mono PCM WAV extraction
│   │   ├── whisperRunner.ts     # Non-blocking child_process Whisper wrapper
│   │   ├── assBuilder.ts        # Dynamic 3-word karaoke ASS generator
│   │   └── videoCompositor.ts   # FFmpeg QSV/libx264 9:16 compositor & loudnorm
│   ├── queue/
│   │   ├── connection.ts        # IORedis client configuration
│   │   ├── videoQueue.ts        # BullMQ queue & job state store
│   │   └── videoWorker.ts       # Pipeline worker logic with concurrency = 1
│   ├── routes/
│   │   └── jobRoutes.ts         # Fastify route definitions & streaming
│   ├── utils/
│   │   ├── fileCleaner.ts       # Temp directory and 24h expired output cleaner
│   │   └── timeFormatter.ts     # H:MM:SS.CC centisecond ASS time converter
│   └── server.ts                # Fastify server entry point
├── public/                      # Glassmorphic Interactive Web Studio
│   ├── index.html
│   ├── style.css
│   └── app.js
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🛡️ License
MIT License.
