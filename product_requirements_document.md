# Product Requirements Document (PRD)

## Project Title: ViralReels Studio
**Version:** 1.0.0  
**Status:** Ready for Implementation  
**Target Hardware Baseline:** Intel Core i5-1235U (10 Cores, 12 Threads), 16 GB RAM, Intel Iris Xe Graphics  
**Target OS:** Linux (Ubuntu / WSL2) & Windows 11  

---

## 1. Executive Summary & Core Objectives

ViralReels Studio adalah sistem pipeline pemrosesan video otomatis berbasis web lokal (*on-premise*) yang dirancang khusus untuk mengoptimalkan video pendek (Reels / Shorts / TikTok). Sistem ini berfokus pada peningkatan retensi penonton secara otomatis tanpa ketergantungan pada API kecerdasan buatan pihak ketiga yang berbayar.

### Core Objectives:
1. **0% External API Dependency:** Menggunakan inferensi model wicara lokal (*Whisper.cpp*) dan manipulasi media berbasis CLI (*FFmpeg*).
2. **High Retention Automation:** Menghasilkan subtitle dinamis per kata (*karaoke-style highlighting*), cropping otomatis ke rasio 9:16 (1080x1920), dan normalisasi audio EBU R128 (-14 LUFS).
3. **Hardware-Tuned Performance:** Mengoptimalkan pemanfaatan arsitektur hybrid Intel Gen 12 (Core i5-1235U) dengan hardware acceleration Intel QuickSync (`h264_qsv`) dan alokasi thread terkontrol untuk mencegah *thermal throttling*.
4. **Autonomous Execution Ready:** Struktur dokumen dan spesifikasi modul dirancang agar dapat diimplementasikan secara otomatis oleh coding agent / AntiGravity.

---

## 2. Technical Stack & Hardware Specification

### 2.1 Software Stack
* **Runtime:** Node.js (v20+ LTS) dengan TypeScript murni (ESM mode).
* **HTTP Framework:** Fastify (kinerja tinggi, native stream handling, `@fastify/multipart`, `@fastify/static`).
* **Task Queue & State:** BullMQ + IORedis (koneksi ke instance Redis lokal).
* **ASR (Speech-to-Text) Engine:** `whisper.cpp` (kompilasi C++ lokal dengan instruksi AVX2/OpenBLAS tanpa runtime Python).
* **Media Processing:** FFmpeg 6.0+ (wajib terkompilasi dengan modul `libass` dan hardware encoder `h264_qsv`).
* **Validation & Types:** Zod untuk skema konfigurasi dan parsing payload.

### 2.2 Hardware Constraints & Limits (Intel Core i5-1235U)
* **TDP:** 15W Base.
* **Core Distribution:** 2 P-Cores (4 Threads) + 8 E-Cores (8 Threads).
* **Whisper Thread Allocation:** Dibatasi maksimal `-t 4` untuk menjaga suhu laptop stabil di bawah batas throttling.
* **Worker Queue Concurrency:** Concurrency dibatasi pada nilai `1` rendering job pada satu waktu.
* **Memory Headroom:** Penggunaan RAM maksimum per proses rendering tidak boleh melebihi 2.5 GB.

---

## 3. High-Level Architecture Flow

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
|  [Step 1: Audio Extractor] ---> ffmpeg -> 16kHz Mono WAV                |
|               |                                                         |
|               v                                                         |
|  [Step 2: Whisper ASR]     ---> whisper.cpp CLI -> JSON Timestamps      |
|               |                                                         |
|               v                                                         |
|  [Step 3: ASS Engine]      ---> Parse JSON -> Chunking -> Dynamic .ass  |
|               |                                                         |
|               v                                                         |
|  [Step 4: Intel QSV Mix]   ---> ffmpeg + QSV + ASS Filter + loudnorm    |
+-------------------------------------------------------------------------+
                                     |
                                     v Final Video Saved
+-------------------------------------------------------------------------+
|                  Storage Engine (/storage/outputs/)                     |
|                   (Status: COMPLETED, Downloadable)                     |
+-------------------------------------------------------------------------+
```

---

## 4. Module Specifications

### 4.1 Ingestion & Validation Service (`src/core/ingestion.ts`)
* **Tanggung Jawab:** Menerima file upload, validasi integritas media, dan penyimpanan sementara di storage.
* **Aturan Validasi:**
  * Ukuran file maksimum: `500 MB`.
  * Format container yang diizinkan: `video/mp4`, `video/quicktime` (.mov), `video/x-matroska` (.mkv).
  * Durasi maksimum: 180 detik (dianalisis menggunakan `ffprobe`).
  * Validasi ketersediaan audio stream minimal 1 channel.

### 4.2 Audio Extraction Service (`src/core/audioExtractor.ts`)
* **Tanggung Jawab:** Mengisolasi track audio ke format ideal untuk model wicara.
* **FFmpeg Specification:**
  ```bash
  ffmpeg -y -i "{input_path}" -vn -ar 16000 -ac 1 -c:a pcm_s16le "{output_wav_path}"
  ```
* **Kriteria Sukses:** Menghasilkan file audio format `.wav`, sample rate 16000 Hz, 1 channel (mono), bit depth 16-bit PCM.

### 4.3 Local Transcription Service (`src/core/whisperRunner.ts`)
* **Tanggung Jawab:** Mengeksekusi binary `whisper.cpp` melalui child process Node.js.
* **Path Binary:** `./bin/whisper-cli` (atau `whisper-cli.exe` di Windows).
* **Model Path:** `./models/ggml-base.bin`.
* **Argument CLI:**
  * `-m ./models/ggml-base.bin`
  * `-f "{wav_path}"`
  * `-oj` (Menghasilkan output JSON)
  * `-osow` (Output per kata / one-word-level timestamp)
  * `-l id` (Default: Bahasa Indonesia, fallback: `auto`)
  * `-t 4` (Thread cap)
* **Data Output Structure:**
  ```typescript
  export interface WordToken {
    word: string;
    start: number; // millisecond
    end: number;   // millisecond
    confidence?: number;
  }

  export interface TranscriptionOutput {
    text: string;
    tokens: WordToken[];
  }
  ```

### 4.4 High-Retention Subtitle Generator (`src/core/assBuilder.ts`)
* **Tanggung Jawab:** Mengompilasi array token kata menjadi file format **Advanced SubStation Alpha (.ass)**.
* **Spesifikasi Tampilan:**
  * **Canvas Resolution:** 1080 x 1920 (9:16).
  * **Chunking Algorithm:** Mengelompokkan kata menjadi maksimal 3 kata per baris agar penonton membaca dengan ritme cepat.
  * **Safe-Zone Layout:** Margin vertikal bawah (`MarginV`) disetel ke `480px` untuk memastikan subtitle tidak tertutup oleh antarmuka bawaan Meta (avatar akun, tombol share/like, judul audio, dan caption text).
  * **Color Styling:**
    * Base Word: White (`&H00FFFFFF&`).
    * Active Word (Highlight): Neon Yellow (`&H0000E6FF&`) atau Custom Preset.
    * Outline: 5px Solid Black (`&H00000000&`).
    * Shadow: 0px.
* **Struktur Template ASS:**
  ```ini
  [Script Info]
  ScriptType: v4.00+
  PlayResX: 1080
  PlayResY: 1920
  ScaledBorderAndShadow: yes

  [V4+ Styles]
  Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
  Style: ReelHighlight,Montserrat Black,72,&H00FFFFFF,&H0000E6FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,0,2,80,80,480,1

  [Events]
  Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
  ```

### 4.5 Intel QSV Compositor & Audio Normalizer (`src/core/videoCompositor.ts`)
* **Tanggung Jawab:** Menggabungkan video sumber, auto-crop 9:16 di titik tengah, burning subtitle `.ass`, dan normalisasi volume audio.
* **Auto-Fallback Engine:**
  * Sistem mengecek ketersediaan encoder hardware: `ffmpeg -encoders | grep h264_qsv`.
  * Jika QSV tersedia: gunakan `-c:v h264_qsv -preset veryfast -b:v 6500k`.
  * Jika QSV tidak tersedia: otomatis fallback ke CPU `-c:v libx264 -preset fast -crf 22`.
* **Execution Command Template:**
  ```bash
  ffmpeg -y \
    -init_hw_device qsv=hw -filter_hw_device hw \
    -i "{input_video}" \
    -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,ass='{ass_file_path}'" \
    -af "loudnorm=I=-14:TP=-1.0:LRA=11" \
    -c:v h264_qsv \
    -preset veryfast \
    -b:v 6500k \
    -maxrate 8500k \
    -bufsize 13000k \
    -c:a aac \
    -b:a 192k \
    -movflags +faststart \
    "{output_video_path}"
  ```

---

## 5. Job Queue & State Engine (`src/queue/`)

Pipeline dikelola secara asinkron menggunakan BullMQ untuk memisahkan siklus hidup HTTP request dari proses encoding berat.

### 5.1 Pipeline Steps & Progress Mapping
1. `QUEUED`: Tugas berhasil didaftarkan ke Redis (`0%`).
2. `EXTRACTING_AUDIO`: FFmpeg mengekstrak audio PCM (`15%`).
3. `TRANSCRIBING`: Whisper.cpp memproses transkripsi (`45%`).
4. `GENERATING_SUBTITLES`: Mengompilasi file `.ass` (`60%`).
5. `COMPOSITING`: Rendering final video dengan akselerasi QSV (`90%`).
6. `COMPLETED`: File tersimpan di storage output, siap diunduh (`100%`).
7. `FAILED`: Pencatatan log error dan eksekusi pembersihan file sementara.

### 5.2 Failure & Temporary Cleanup Policy
Setiap eksekusi job dibungkus dalam blok `try...finally`:
* File sementara di direktori `storage/temp/{jobId}/*` wajib dihapus segera setelah status job berubah menjadi `COMPLETED` atau `FAILED`.
* Direktori `storage/outputs/` dikelola dengan cron job untuk menghapus file hasil render yang berusia lebih dari 24 jam.

---

## 6. API Interface Definitions

### 6.1 Submit Processing Job
* **Method:** `POST /api/v1/jobs`
* **Content-Type:** `multipart/form-data`
* **Body:**
  * `file`: File media (binary).
  * `language`: `id` | `en` (opsional, default: `id`).
  * `highlightColor`: Hex string warna highlight (opsional, default: `#FFE600`).
* **Response (202 Accepted):**
  ```json
  {
    "success": true,
    "jobId": "job_c7a8e9d0-f1b2-4d3e-9a1b-2c3d4e5f6a7b",
    "status": "QUEUED",
    "message": "Video successfully scheduled for processing."
  }
  ```

### 6.2 Get Job Status & Result
* **Method:** `GET /api/v1/jobs/:jobId`
* **Response (200 OK):**
  ```json
  {
    "jobId": "job_c7a8e9d0-f1b2-4d3e-9a1b-2c3d4e5f6a7b",
    "status": "COMPOSITING",
    "progress": 75,
    "result": null,
    "error": null,
    "createdAt": "2026-10-14T06:10:00.000Z"
  }
  ```
* **Response Saat Selesai:**
  ```json
  {
    "jobId": "job_c7a8e9d0-f1b2-4d3e-9a1b-2c3d4e5f6a7b",
    "status": "COMPLETED",
    "progress": 100,
    "result": {
      "downloadUrl": "/api/v1/downloads/job_c7a8e9d0.mp4",
      "duration": 42.5,
      "processingTimeSeconds": 18.2
    },
    "error": null
  }
  ```

---

## 7. Directory Structure

```
viralreels-studio/
├── bin/
│   ├── .gitkeep
│   └── whisper-cli              # Compiled Whisper binary (Linux ELF / Windows EXE)
├── models/
│   ├── .gitkeep
│   └── ggml-base.bin            # GGML Whisper Base Model (~142MB)
├── storage/
│   ├── uploads/                 # File masukan asli dari client
│   ├── temp/                    # Intermediate WAV dan ASS files
│   └── outputs/                 # Video final MP4 9:16
├── scripts/
│   ├── setup-env.sh             # Script unduh binary whisper & model ggml (Linux/WSL)
│   └── setup-env.bat            # Script unduh model (Windows)
├── src/
│   ├── config/
│   │   ├── env.ts               # Skema environment variable (Zod validated)
│   │   ├── hardware.ts          # Profil core limits & deteksi QSV
│   │   └── presets.ts           # Konstanta typography dan color conversion
│   ├── core/
│   │   ├── audioExtractor.ts    # Ekstraksi audio via FFmpeg
│   │   ├── whisperRunner.ts     # Wrapper eksekusi child_process whisper.cpp
│   │   ├── assBuilder.ts        # Generator subtitle dinamis format .ass
│   │   └── videoCompositor.ts   # FFmpeg hardware compositor
│   ├── queue/
│   │   ├── connection.ts        # Inisialisasi koneksi Redis
│   │   ├── videoQueue.ts        # Inisialisasi Queue & Job definitions
│   │   └── videoWorker.ts       # Pipeline worker logic
│   ├── routes/
│   │   └── jobRoutes.ts         # Fastify route controllers
│   ├── utils/
│   │   ├── fileCleaner.ts       # Utility penghapusan file sementara
│   │   └── timeFormatter.ts     # Konversi milidetik ke timestamp ASS (H:MM:SS.CS)
│   └── server.ts                # Entry point server Fastify
├── package.json
├── tsconfig.json
└── README.md
```

---

## 8. AntiGravity / AI Autonomous Agent Execution Directives

Bagi AI agent yang mengompilasi atau membangun repository ini:

1. **Step 1 - Scaffolding:** Inisialisasi konfigurasi TypeScript (`tsconfig.json`) dengan target `ES2022`, module resolution `NodeNext`, dan strict type checks aktif.
2. **Step 2 - Model Download Helper:** Tuliskan `scripts/setup-env.sh` yang secara otomatis mengunduh model:
   `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin` ke dalam folder `./models/`.
3. **Step 3 - ASS Time Converter Logic:** Buat unit utility di `src/utils/timeFormatter.ts` yang mampu mengonversi durasi desimal atau milidetik ke string format `H:MM:SS.CC` (contoh: `0:01:23.45`). Format centisecond (`CS`) wajib dua digit.
4. **Step 4 - Dynamic QSV Detection:** Di `src/config/hardware.ts`, lakukan pengecekan sinkron atau asinkron saat server start untuk memastikan apakah hardware driver Intel QSV tersedia di lingkungan runtime. Sediakan flag boolean `hasQsvSupport`.
5. **Step 5 - Resilient Child Process Spawning:** Pada saat menjalankan `whisper-cli`, tangkap data dari stream `stderr` dan `stdout` secara non-blocking agar buffer buffer OS tidak meluap (*pipe buffer overflow*).