import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { hardwareConfig } from '../config/hardware.js';
import { env } from '../config/env.js';

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
}

/**
 * Runs whisper.cpp CLI with non-blocking stream handling to avoid pipe buffer overflows.
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
      `whisper-cli executable not found at ${whisperCli}. Run "npm run setup:env" or bash scripts/setup-env.sh to install it.`
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
    '-oj',                    // output json
    '-sow',                   // split on word rather than token
    '-of', outputPrefix,      // output base filename
    '-l', language,
    '-t', threads.toString()
  ];

  return new Promise<TranscriptionOutput>((resolve, reject) => {
    const child = spawn(whisperCli, args);

    let stdoutBuffer = '';
    let stderrBuffer = '';

    // Non-blocking consumption of stdout
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
    });

    // Non-blocking consumption of stderr
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
          const result = parseWhisperJson(parsed);
          return resolve(result);
        }

        // If no JSON file, attempt to parse JSON from stdout
        try {
          const parsedFromStdout = JSON.parse(stdoutBuffer);
          const result = parseWhisperJson(parsedFromStdout);
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
 */
function parseWhisperJson(data: any): TranscriptionOutput {
  const tokens: WordToken[] = [];
  let fullText = '';

  const transcription = data.transcription || data.segments || [];

  for (const seg of transcription) {
    if (seg.text) {
      fullText += (fullText ? ' ' : '') + seg.text.trim();
    }

    // Check for tokens (when -osow is used, segments or tokens contain word level details)
    const segTokens = seg.tokens || [];
    if (segTokens.length > 0) {
      for (const tok of segTokens) {
        const text = (tok.text || tok.word || '').trim();
        if (!text || text === '[_BEG_]' || text === '[_TT_]' || text.startsWith('[_')) {
          continue;
        }

        // Offsets can be in milliseconds or timestamps
        let startMs = 0;
        let endMs = 0;

        if (tok.offsets?.from !== undefined) {
          startMs = tok.offsets.from;
          endMs = tok.offsets.to;
        } else if (tok.t0 !== undefined) {
          // Centiseconds or milliseconds in some versions
          startMs = typeof tok.t0 === 'number' ? tok.t0 * 10 : 0;
          endMs = typeof tok.t1 === 'number' ? tok.t1 * 10 : startMs + 300;
        } else if (tok.timestamps?.from) {
          startMs = parseTimestampToMs(tok.timestamps.from);
          endMs = parseTimestampToMs(tok.timestamps.to);
        } else {
          startMs = seg.offsets?.from || 0;
          endMs = seg.offsets?.to || startMs + 300;
        }

        tokens.push({
          word: text,
          start: Math.round(startMs),
          end: Math.round(endMs),
          confidence: tok.p || tok.confidence
        });
      }
    } else {
      // Fallback: segment level words splitting if token timestamps are missing
      const segText = (seg.text || '').trim();
      const words = segText.split(/\s+/).filter(Boolean);
      const segStart = seg.offsets?.from ?? (seg.timestamps?.from ? parseTimestampToMs(seg.timestamps.from) : 0);
      const segEnd = seg.offsets?.to ?? (seg.timestamps?.to ? parseTimestampToMs(seg.timestamps.to) : segStart + 2000);
      const durationPerWord = words.length > 0 ? (segEnd - segStart) / words.length : 500;

      words.forEach((word: string, index: number) => {
        tokens.push({
          word,
          start: Math.round(segStart + index * durationPerWord),
          end: Math.round(segStart + (index + 1) * durationPerWord)
        });
      });
    }
  }

  // Deduplicate and sort by start time
  tokens.sort((a, b) => a.start - b.start);

  return {
    text: fullText || tokens.map((t) => t.word).join(' '),
    tokens
  };
}

function parseTimestampToMs(ts: string): number {
  if (!ts) return 0;
  // formats like "00:00:01,234" or "00:00:01.234"
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
