/**
 * Style Presets and Color Conversion Utilities
 * Handles ASS typography, resolution bounds, safe margins, and BGR color transformations.
 */

export interface SubtitlePreset {
  id: string;
  name: string;
  fontName: string;
  fontSize: number;
  highlightHex: string;
  baseHex: string;
  outlineColorHex: string;
  outlineWidth: number;
  shadowWidth: number;
  marginV: number;
  maxWordsPerChunk: number;
}

/**
 * Converts standard Hex color (#RRGGBB or #RGB) into ASS BGR format (&H00BBGGRR&)
 */
export function hexToAssColor(hex: string, alphaHex: string = '00'): string {
  let clean = hex.trim().replace(/^#/, '');

  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }

  if (clean.length !== 6) {
    // Fallback to neon yellow
    clean = 'FFE600';
  }

  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);

  // ASS uses &HAABBGGRR& where AA is opacity (00 = fully opaque)
  return `&H${alphaHex}${b}${g}${r}&`.toUpperCase();
}

export const CANVAS = {
  width: 1080,
  height: 1920,
  aspectRatio: '9:16'
} as const;

export const DEFAULT_PRESET: SubtitlePreset = {
  id: 'reel_neon_yellow',
  name: 'Viral Neon Yellow',
  fontName: 'Montserrat Black',
  fontSize: 72,
  highlightHex: '#FFE600',
  baseHex: '#FFFFFF',
  outlineColorHex: '#000000',
  outlineWidth: 5,
  shadowWidth: 0,
  marginV: 480, // Safe-zone for Meta Reels / TikTok / Shorts UI
  maxWordsPerChunk: 3
};

export const COLOR_PRESETS = [
  { id: 'neon_yellow', name: 'Neon Yellow', hex: '#FFE600' },
  { id: 'electric_cyan', name: 'Electric Cyan', hex: '#00F0FF' },
  { id: 'neon_green', name: 'Neon Green', hex: '#00FF66' },
  { id: 'sunset_orange', name: 'Sunset Orange', hex: '#FF6B00' },
  { id: 'hot_pink', name: 'Hot Pink', hex: '#FF007A' },
  { id: 'pure_white', name: 'Pure White', hex: '#FFFFFF' }
] as const;
