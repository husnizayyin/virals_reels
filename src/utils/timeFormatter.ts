/**
 * ASS Time Formatter Utility
 * Formats durations (milliseconds or decimal seconds) into the Advanced SubStation Alpha (.ass) format:
 * H:MM:SS.CC (Hours : Minutes : Seconds . Centiseconds)
 * Centiseconds (CC) must strictly be 2 digits.
 */

/**
 * Converts milliseconds to an ASS timestamp string (e.g. 83450 -> "0:01:23.45")
 *
 * @param ms - Duration in milliseconds (non-negative)
 * @returns Formatted ASS time string H:MM:SS.CC
 */
export function msToAssTime(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));

  const totalCentiseconds = Math.floor(safeMs / 10);
  const cs = totalCentiseconds % 100;

  const totalSeconds = Math.floor(safeMs / 1000);
  const s = totalSeconds % 60;

  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;

  const h = Math.floor(totalMinutes / 60);

  const pad2 = (n: number) => n.toString().padStart(2, '0');

  return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
}

/**
 * Converts decimal seconds to an ASS timestamp string (e.g. 83.45 -> "0:01:23.45")
 *
 * @param seconds - Duration in seconds (e.g. 42.5)
 * @returns Formatted ASS time string H:MM:SS.CC
 */
export function secondsToAssTime(seconds: number): string {
  return msToAssTime(seconds * 1000);
}

/**
 * Unified ASS formatter accepting either milliseconds or seconds.
 *
 * @param value - Numeric duration
 * @param unit - 'ms' | 'sec' (defaults to 'ms')
 */
export function formatAssTime(value: number, unit: 'ms' | 'sec' = 'ms'): string {
  return unit === 'sec' ? secondsToAssTime(value) : msToAssTime(value);
}

/**
 * Parses ASS timestamp string (H:MM:SS.CC) back to milliseconds.
 */
export function parseAssTimeToMs(assTime: string): number {
  const parts = assTime.trim().split(':');
  if (parts.length !== 3) return 0;

  const hours = parseInt(parts[0], 10) || 0;
  const minutes = parseInt(parts[1], 10) || 0;
  const secParts = parts[2].split('.');
  const seconds = parseInt(secParts[0], 10) || 0;
  const centiseconds = parseInt((secParts[1] || '0').padEnd(2, '0').slice(0, 2), 10) || 0;

  return hours * 3600000 + minutes * 60000 + seconds * 1000 + centiseconds * 10;
}
