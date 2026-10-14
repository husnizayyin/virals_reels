import fs from 'fs';
import path from 'path';
import { TEMP_DIR, OUTPUTS_DIR } from '../config/env.js';

/**
 * Removes temporary directory and its contents for a specific jobId
 */
export async function cleanJobTempDir(jobId: string): Promise<void> {
  const jobTempPath = path.join(TEMP_DIR, jobId);
  try {
    if (fs.existsSync(jobTempPath)) {
      await fs.promises.rm(jobTempPath, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(`[FileCleaner] Warning: Failed to clean temp dir for job ${jobId}:`, err);
  }
}

/**
 * Safely removes a single file if it exists
 */
export async function removeFileSafe(filePath: string): Promise<void> {
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  } catch (err) {
    console.warn(`[FileCleaner] Warning: Failed to remove file ${filePath}:`, err);
  }
}

/**
 * Cleans output files older than specified hours (default 24 hours per PRD)
 */
export async function cleanExpiredOutputs(maxAgeHours: number = 24): Promise<number> {
  let cleanedCount = 0;
  const now = Date.now();
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

  try {
    if (!fs.existsSync(OUTPUTS_DIR)) return 0;

    const files = await fs.promises.readdir(OUTPUTS_DIR);
    for (const file of files) {
      if (file === '.gitkeep') continue;
      const fullPath = path.join(OUTPUTS_DIR, file);
      const stat = await fs.promises.stat(fullPath);
      if (stat.isFile() && now - stat.mtimeMs > maxAgeMs) {
        await fs.promises.unlink(fullPath);
        cleanedCount++;
      }
    }
  } catch (err) {
    console.warn('[FileCleaner] Failed to clean expired outputs:', err);
  }

  return cleanedCount;
}
