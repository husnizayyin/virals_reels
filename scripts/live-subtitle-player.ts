import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { extractAudioForWhisper, detectSilenceIntervals } from '../src/core/audioExtractor.js';
import { runWhisperTranscription, WordToken } from '../src/core/whisperRunner.js';

// ANSI escape codes for rich terminal styling
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const YELLOW_BG = '\x1b[43m\x1b[30m';
const YELLOW_TEXT = '\x1b[93m\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';
const CLEAR_SCREEN = '\x1b[2J\x1b[H';

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

async function main() {
  const args = process.argv.slice(2);
  let videoPath = args[0];

  // Auto-detect latest video if not provided
  if (!videoPath) {
    const uploadsDir = path.resolve(process.cwd(), 'storage/uploads');
    if (fs.existsSync(uploadsDir)) {
      const files = (await fs.promises.readdir(uploadsDir))
        .filter(f => f.endsWith('.mp4') || f.endsWith('.mov') || f.endsWith('.mkv'))
        .map(f => ({
          name: f,
          fullPath: path.join(uploadsDir, f),
          time: fs.statSync(path.join(uploadsDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);

      if (files.length > 0) {
        videoPath = files[0].fullPath;
      }
    }
  }

  if (!videoPath || !fs.existsSync(videoPath)) {
    console.error(`${RED}Error: File video tidak ditemukan.${RESET}`);
    console.log(`Gunakan perintah: npm run subtitle:live -- <path/ke/video.mp4>`);
    process.exit(1);
  }

  console.log(`${CLEAR_SCREEN}`);
  console.log(`${BOLD}${CYAN}======================================================${RESET}`);
  console.log(`${BOLD}${CYAN}   LIVE TERMINAL SUBTITLE     ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================${RESET}\n`);
  console.log(`📂 Memproses file video: ${GRAY}${videoPath}${RESET}`);

  const tempDir = path.resolve(process.cwd(), 'storage/temp/cli_live');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const wavPath = path.join(tempDir, 'extracted.wav');

  // Step 1: Ekstraksi audio jika belum ada
  process.stdout.write(`⏳ 1/3 Mengekstrak audio 16kHz mono... `);
  await extractAudioForWhisper(videoPath, wavPath);
  console.log(`${GREEN}SELESAI${RESET}`);

  // Step 2: Deteksi hening (silencedetect)
  process.stdout.write(`⏳ 2/3 Mendeteksi jeda hening (Voice Activity)... `);
  const silenceIntervals = await detectSilenceIntervals(wavPath);
  console.log(`${GREEN}SELESAI (${silenceIntervals.length} interval hening)${RESET}`);

  // Step 3: Whisper Transcription
  process.stdout.write(`⏳ 3/3 Membaca ucapan dengan Whisper (-ojf token level)... `);
  const result = await runWhisperTranscription(wavPath, {
    silenceIntervals,
    language: 'id'
  });
  console.log(`${GREEN}SELESAI (${result.tokens.length} kata teridentifikasi)${RESET}\n`);

  if (result.tokens.length === 0) {
    console.log(`${RED}Tidak ada kata yang terdeteksi dalam audio.${RESET}`);
    process.exit(0);
  }

  // Pre-calculate chunks of words (karaoke chunks 3-4 words per group)
  const chunks: { words: WordToken[]; start: number; end: number }[] = [];
  let currentGroup: WordToken[] = [];

  for (let i = 0; i < result.tokens.length; i++) {
    const tok = result.tokens[i];
    const prev = currentGroup[currentGroup.length - 1];

    if (prev && (tok.start - prev.end > 250 || currentGroup.length >= 4)) {
      chunks.push({
        words: [...currentGroup],
        start: currentGroup[0].start,
        end: prev.end
      });
      currentGroup = [tok];
    } else {
      currentGroup.push(tok);
    }
  }
  if (currentGroup.length > 0) {
    chunks.push({
      words: currentGroup,
      start: currentGroup[0].start,
      end: currentGroup[currentGroup.length - 1].end
    });
  }

  // Determine total duration
  const lastToken = result.tokens[result.tokens.length - 1];
  const totalDurationMs = Math.max(lastToken.end + 2000, 10000);

  console.log(`${BOLD}${CYAN}Memulai Live Playback di Terminal dalam 3 detik (atau tekan [Enter] langsung)...${RESET}\n`);
  await new Promise<void>((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    }, 3000);

    if (process.stdin.isTTY) {
      process.stdin.once('data', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve();
        }
      });
    }
  });

  // Start background audio if aplay is available
  let audioProc: any = null;
  if (fs.existsSync('/usr/bin/aplay')) {
    audioProc = spawn('/usr/bin/aplay', ['-q', wavPath], { stdio: 'ignore' });
  }

  // Cleanup on exit
  process.on('SIGINT', () => {
    if (audioProc) audioProc.kill();
    console.log(`\n${GRAY}Live player dihentikan.${RESET}`);
    process.exit(0);
  });

  const startTime = Date.now();

  const timer = setInterval(() => {
    const elapsedMs = Date.now() - startTime;

    if (elapsedMs > totalDurationMs) {
      clearInterval(timer);
      if (audioProc) audioProc.kill();
      console.log(`\n\n${GREEN}${BOLD}✓ Live Playback Selesai!${RESET}\n`);
      process.exit(0);
    }

    // Check if current time falls into a silence interval
    const isSilent = silenceIntervals.some(
      s => elapsedMs >= s.startMs && elapsedMs < s.endMs
    );

    // Find current active chunk
    const activeChunk = chunks.find(
      c => elapsedMs >= c.start && elapsedMs <= c.end + 120
    );

    // Progress bar calculations
    const pct = Math.min(100, Math.floor((elapsedMs / totalDurationMs) * 100));
    const barWidth = 35;
    const filled = Math.floor((pct / 100) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

    // Render Subtitle Line
    let subtitleDisplay = `${GRAY}🔇 [Hening / Tidak Ada Ucapan]${RESET}`;
    let activeWordText = '';

    if (!isSilent && activeChunk) {
      const renderedWords = activeChunk.words.map((w) => {
        const isCurrentWord = elapsedMs >= w.start && elapsedMs <= w.end;
        if (isCurrentWord) {
          activeWordText = w.word.toUpperCase();
          return `${YELLOW_BG}${BOLD} ${w.word.toUpperCase()} ${RESET}`;
        } else {
          return `${BOLD}${w.word.toUpperCase()}${RESET}`;
        }
      });
      subtitleDisplay = renderedWords.join(' ');
    }

    // Terminal redraw
    process.stdout.write(`\x1b[H`);
    process.stdout.write(`${BOLD}${CYAN}================================================================${RESET}\n`);
    process.stdout.write(`${BOLD}  🎬 LIVE TERMINAL SUBTITLE PLAYBACK  |  ViralReels Studio    ${RESET}\n`);
    process.stdout.write(`${BOLD}${CYAN}================================================================${RESET}\n\n`);

    process.stdout.write(`  Waktu    : [${BOLD}${CYAN}${formatTime(elapsedMs)}${RESET} / ${formatTime(totalDurationMs)}]  ${CYAN}[${bar}] ${pct}%${RESET}\n`);
    process.stdout.write(`  Status   : ${isSilent ? `${RED}${BOLD}🔇 HENING (MULUT DIAM)${RESET}` : `${GREEN}${BOLD}🗣️  BERBICARA (AKTIF)${RESET} `}  ${activeWordText ? `${GRAY}| Kata: ${YELLOW_TEXT}${activeWordText}${RESET}` : ''}\n\n`);
    process.stdout.write(`${BOLD}  ────────────────────────────────────────────────────────────${RESET}\n`);
    process.stdout.write(`  SUBTITLE : \n\n`);
    process.stdout.write(`             ${subtitleDisplay}\n\n`);
    process.stdout.write(`${BOLD}  ────────────────────────────────────────────────────────────${RESET}\n`);
    process.stdout.write(`${GRAY}  (Tekan Ctrl+C untuk keluar)${RESET}\n`);
  }, 40); // 25 updates per second for ultra-smooth 40ms karaoke sync
}

main().catch((err) => {
  console.error(`${RED}Terjadi kesalahan:${RESET}`, err);
  process.exit(1);
});
