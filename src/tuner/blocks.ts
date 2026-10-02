/**
 * Pure model for the "tiles" theme's 8-bit block meter: 21 columns for
 * −50..+50 cents in 5-cent steps, each a stack of square blocks.
 *
 * - The reading's column (cents / 5, rounded, clamped to ±10) is fully lit.
 * - Columns from the centre out to (not including) the reading are lit as a
 *   staircase: 1 + round((rows − 2) · |i| / |active|) blocks, so the centre
 *   column always shows one block and the steps climb towards the reading.
 * - At 0 the centre column alone is lit; with no signal nothing is.
 *
 * Rounding is half-to-even to match the approved mockup generator exactly
 * (e.g. +18 ¢ lights the staircase 1,1,2,3,4 rather than 1,2,2,3,4).
 *
 * No React, no DOM, no host-app imports.
 */

export const TILES_INK = '#141210';
export const TILES_PAPER = '#fdfcf9';
export const TILES_YELLOW = '#fff56d';

/** The 12-colour spectrum stripe along the bottom of the tiles chassis. */
export const TILES_SPECTRUM = [
  '#f86e6e',
  '#f58841',
  '#ffbc57',
  '#b8a334',
  '#fff56d',
  '#b3f888',
  '#93d154',
  '#6bc6a0',
  '#7ee8df',
  '#88a7f8',
  '#cc97e8',
  '#e277b1',
] as const;

export const BLOCK_COLUMNS = 21;
export const BLOCK_ROWS = 4;
const HALF = (BLOCK_COLUMNS - 1) / 2; // 10
const STEP_CENTS = 5;

/** Round half to even (Python's round), so ties match the mockup generator. */
export function roundHalfEven(x: number): number {
  const r = Math.round(x);
  if (Math.abs(x % 1) === 0.5 && r % 2 !== 0) return r - 1;
  return r === 0 ? 0 : r; // no -0
}

/** Full colour of the column at `cents` offset: green in the middle, warming to red at the edges. */
export function blockColor(cents: number): string {
  const a = Math.abs(cents);
  if (a <= 0) return '#6bc6a0';
  if (a <= 5) return '#93d154';
  if (a <= 15) return '#fff56d';
  if (a <= 25) return '#ffbc57';
  if (a <= 35) return '#f58841';
  return '#f86e6e';
}

/** Blend `hex` towards the paper colour: `amount` 0 = paper, 1 = the colour itself. */
export function tint(hex: string, amount = 0.3): string {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [pr, pg, pb] = [0xfd, 0xfc, 0xf9];
  const mix = (p: number, c: number) => roundHalfEven(p + (c - p) * amount).toString(16).padStart(2, '0');
  return `#${mix(pr, r)}${mix(pg, g)}${mix(pb, b)}`;
}

export interface BlockColumn {
  /** Column position, −10..+10. */
  index: number;
  /** Cents this column stands for, −50..+50. */
  cents: number;
  /** Lit colour. */
  color: string;
  /** Unlit (pale) colour. */
  tint: string;
  /** Lit blocks counted from the bottom, 0..rows. */
  lit: number;
  /** The reading's column (fully lit, glowing, marker above). */
  active: boolean;
}

export interface BlockMeterModel {
  /** Index (−10..+10) of the reading's column, or null without signal. */
  active: number | null;
  columns: BlockColumn[];
}

export function blockMeterModel(cents: number | null, rows: number = BLOCK_ROWS): BlockMeterModel {
  const act =
    cents === null || !Number.isFinite(cents) ? null : Math.max(-HALF, Math.min(HALF, roundHalfEven(cents / STEP_CENTS)));
  const columns: BlockColumn[] = [];
  for (let i = -HALF; i <= HALF; i++) {
    const color = blockColor(i * STEP_CENTS);
    let lit = 0;
    if (act !== null) {
      if (i === act) lit = rows;
      else if (act !== 0 && ((i >= 0 && i < act) || (i > act && i <= 0)))
        lit = 1 + roundHalfEven(((rows - 2) * Math.abs(i)) / Math.abs(act));
    }
    columns.push({ index: i, cents: i * STEP_CENTS, color, tint: tint(color), lit, active: act !== null && i === act });
  }
  return { active: act, columns };
}
