import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { hardwareConfig } from '../config/hardware.js';
import { env } from '../config/env.js';
import { SilenceInterval } from './audioExtractor.js';

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

export interface WhisperOptions {
  language?: string;
  threads?: number;
  modelPath?: string;
  prompt?: string;
  silenceIntervals?: SilenceInterval[];
}

/**
 * Runs whisper.cpp CLI with non-blocking stream handling, phrase-level segmentation (-ml 24),
 * prompt conditioning, and silence alignment to prevent halucinations during speech pauses.
 */
export async function runWhisperTranscription(
  wavPath: string,
  options: WhisperOptions = {}
): Promise<TranscriptionOutput> {
  const whisperCli = hardwareConfig.whisperCliPath;
  const modelPath = path.resolve(process.cwd(), options.modelPath || env.WHISPER_MODEL_PATH);
  const threads = options.threads || hardwareConfig.whisperThreadCap || 4;
  const language = options.language || 'id';

  if (!fs.existsSync(whisperCli)) {
    throw new Error(
      `whisper-cli executable not found at ${whisperCli}. Run "npm run setup:env" to install it.`
    );
  }

  if (!fs.existsSync(modelPath)) {
    throw new Error(
      `Whisper GGML model not found at ${modelPath}. Run "npm run setup:env" to download it.`
    );
  }

  const outputPrefix = wavPath.replace(/\.wav$/i, '') + '_whisper';
  const expectedJsonFile = `${outputPrefix}.json`;
  const defaultWavJsonFile = `${wavPath}.json`;

  const args = [
    '-m', modelPath,
    '-f', wavPath,
    '-ojf',                   // Full JSON output with token-level timestamps!
    '-sow',                   // split on word rather than token
    '-ml', '24',              // Compact segment length (avoids spanning speech pauses)
    '-of', outputPrefix,      // output base filename
    '-l', language,
    '-t', threads.toString(),
    '-bs', '5',               // Beam size 5 for higher transcription accuracy
    '-bo', '5',               // Best of 5 candidate evaluation
    '-wt', '0.01',            // Word timestamp probability threshold
    '-nth', '0.40',           // Aggressively suppress segments with high silence probability
    '--suppress-nst'          // Suppress hallucinated non-speech tokens
  ];

  // Prompt conditioning to dramatically improve technical terms and Indonesian spelling
  if (options.prompt && options.prompt.trim()) {
    args.push('--prompt', options.prompt.trim());
  } else if (language === 'id') {
    args.push(
      '--prompt',
      'Halo, di kesempatan ini saya membuat aplikasi clipper video Reels, Shorts, TikTok menggunakan Node.js, library FFmpeg, Python, C++ untuk memproses NLP. Bermanfaat bagi konten kreator, first project, aplikasi ini lebih cepat, terima kasih.'
    );
  } else if (language === 'en') {
    args.push('--prompt', 'Clear speech transcription for viral Reels, Shorts, and TikTok subtitles.');
  }

  return new Promise<TranscriptionOutput>((resolve, reject) => {
    const child = spawn(whisperCli, args);

    let stdoutBuffer = '';
    let stderrBuffer = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn whisper-cli: ${err.message}`));
    });

    child.on('close', async (code) => {
      if (code !== 0) {
        return reject(
          new Error(`whisper-cli exited with code ${code}. Stderr: ${stderrBuffer.slice(-1000)}`)
        );
      }

      try {
        let jsonPathToRead = '';
        if (fs.existsSync(expectedJsonFile)) {
          jsonPathToRead = expectedJsonFile;
        } else if (fs.existsSync(defaultWavJsonFile)) {
          jsonPathToRead = defaultWavJsonFile;
        }

        if (jsonPathToRead) {
          const rawContent = await fs.promises.readFile(jsonPathToRead, 'utf8');
          const parsed = JSON.parse(rawContent);
          const result = parseWhisperJson(parsed, options.silenceIntervals);
          return resolve(result);
        }

        try {
          const parsedFromStdout = JSON.parse(stdoutBuffer);
          const result = parseWhisperJson(parsedFromStdout, options.silenceIntervals);
          return resolve(result);
        } catch {
          throw new Error('whisper-cli completed but did not produce a readable JSON output.');
        }
      } catch (err: any) {
        reject(new Error(`Failed to parse whisper output: ${err.message}`));
      }
    });
  });
}

/**
 * Parses whisper.cpp JSON output into normalized TranscriptionOutput
 * Correctly reconstructs full words and millisecond boundaries from BPE subword tokens,
 * and filters out any tokens that lie entirely in detected silence intervals.
 */
function parseWhisperJson(data: any, silenceIntervals: SilenceInterval[] = []): TranscriptionOutput {
  const rawWords: WordToken[] = [];
  let fullText = '';

  const transcription = data.transcription || data.segments || [];

  for (const seg of transcription) {
    if (seg.text) {
      fullText += (fullText ? ' ' : '') + seg.text.trim();
    }

    const segTokens = seg.tokens || [];
    if (segTokens.length > 0) {
      let currentWord: WordToken | null = null;

      for (const tok of segTokens) {
        const rawText = tok.text || '';
        if (!rawText || rawText.startsWith('[_') || rawText.startsWith('[')) {
          continue;
        }

        const isNewWord = rawText.startsWith(' ') || rawText.startsWith('\n') || !currentWord;
        const cleanPiece = rawText.trim();
        if (!cleanPiece) continue;

        const startMs = tok.offsets?.from ?? (tok.timestamps?.from ? parseTimestampToMs(tok.timestamps.from) : 0);
        const endMs = tok.offsets?.to ?? (tok.timestamps?.to ? parseTimestampToMs(tok.timestamps.to) : startMs + 200);

        if (isNewWord) {
          if (currentWord && currentWord.word.trim().length > 0) {
            rawWords.push(currentWord);
          }
          currentWord = {
            word: cleanPiece,
            start: Math.round(startMs),
            end: Math.round(endMs),
            confidence: tok.p || 1
          };
        } else if (currentWord) {
          currentWord.word += cleanPiece;
          currentWord.end = Math.max(currentWord.end, Math.round(endMs));
          if (tok.p) {
            currentWord.confidence = Math.min(currentWord.confidence || 1, tok.p);
          }
        }
      }

      if (currentWord && currentWord.word.trim().length > 0) {
        rawWords.push(currentWord);
      }
    } else {
      const segText = (seg.text || '').trim();
      const words = segText.split(/\s+/).filter(Boolean);
      const segStart = seg.offsets?.from ?? (seg.timestamps?.from ? parseTimestampToMs(seg.timestamps.from) : 0);
      const segEnd = seg.offsets?.to ?? (seg.timestamps?.to ? parseTimestampToMs(seg.timestamps.to) : segStart + 2000);
      const durationPerWord = words.length > 0 ? (segEnd - segStart) / words.length : 350;

      words.forEach((word: string, index: number) => {
        rawWords.push({
          word,
          start: Math.round(segStart + index * durationPerWord),
          end: Math.round(segStart + (index + 1) * durationPerWord)
        });
      });
    }
  }

  // Filter and align words against detected silence intervals
  const finalTokens: WordToken[] = [];

  for (const w of rawWords) {
    let s = w.start;
    let e = w.end;

    // Check if word starts inside a silence interval (e.g. 0-4.8s initial silence)
    for (const silence of silenceIntervals) {
      if (s >= silence.startMs && s < silence.endMs) {
        s = silence.endMs; // Shift speech start to where silence ends
      }
      if (e > silence.startMs && e <= silence.endMs) {
        e = silence.startMs; // Cut speech end before silence starts
      }
    }

    // If after clamping the word has zero/negative duration or falls entirely inside silence, drop it!
    if (e - s < 60) {
      // If duration is too short due to silence overlap, skip it (hallucination during silence)
      continue;
    }

    finalTokens.push({
      ...w,
      start: s,
      end: e
    });
  }

  finalTokens.sort((a, b) => a.start - b.start);

  return {
    text: fullText || finalTokens.map((t) => t.word).join(' '),
    tokens: finalTokens
  };
}

function parseTimestampToMs(ts: string): number {
  if (!ts) return 0;
  const clean = ts.replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    const h = parseFloat(parts[0]) || 0;
    const m = parseFloat(parts[1]) || 0;
    const s = parseFloat(parts[2]) || 0;
    return (h * 3600 + m * 60 + s) * 1000;
  }
  return parseFloat(clean) * 1000 || 0;
}
