import { describe, it, expect } from 'vitest';
import { BLOCK_COLUMNS, TILES_INK, blockColor, blockMeterModel, roundHalfEven, tint } from './blocks';

const lit = (cents: number | null) => blockMeterModel(cents).columns.map((c) => c.lit);

describe('blockMeterModel', () => {
  it('has 21 columns for −50..+50 cents in 5-cent steps', () => {
    const m = blockMeterModel(0);
    expect(m.columns).toHaveLength(BLOCK_COLUMNS);
    expect(m.columns.map((c) => c.cents)).toEqual(Array.from({ length: 21 }, (_, i) => -50 + i * 5));
  });

  it('lights nothing without signal', () => {
    for (const c of [null, Number.NaN, Infinity]) {
      const m = blockMeterModel(c);
      expect(m.active).toBeNull();
      expect(m.columns.every((col) => col.lit === 0 && !col.active)).toBe(true);
    }
  });

  // Expected staircases are copied from the approved mockup generator (gen.py).
  it.each([
    [0, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
    [2, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
    [3, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
    [-7, [0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
    [18, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 4, 0, 0, 0, 0, 0, 0]],
    [37, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 2, 2, 3, 4, 0, 0, 0]],
    [-50, [4, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ])('%s ¢ lights the reading column fully and a staircase from the centre', (cents, expected) => {
    expect(lit(cents)).toEqual(expected);
  });

  it('marks exactly one active column, clamped to the ends', () => {
    expect(blockMeterModel(18).active).toBe(4);
    expect(blockMeterModel(-7).active).toBe(-1);
    expect(blockMeterModel(500).active).toBe(10);
    expect(blockMeterModel(-500).active).toBe(-10);
    const m = blockMeterModel(-23);
    expect(m.columns.filter((c) => c.active).map((c) => c.cents)).toEqual([-25]);
  });

  it('honours a different row count', () => {
    expect(blockMeterModel(50, 6).columns.at(-1)!.lit).toBe(6);
  });
});

describe('block colours', () => {
  it('green centre warming to red at the edges', () => {
    expect([0, 5, 10, 15, 20, 25, 30, 35, 40, 50].map(blockColor)).toEqual([
      '#6bc6a0',
      '#93d154',
      '#fff56d',
      '#fff56d',
      '#ffbc57',
      '#ffbc57',
      '#f58841',
      '#f58841',
      '#f86e6e',
      '#f86e6e',
    ]);
    expect(blockColor(-20)).toBe(blockColor(20));
  });

  it('tints towards paper like the mockup generator', () => {
    expect(tint('#6bc6a0')).toBe('#d1ecde');
    expect(tint('#fff56d')).toBe('#fefacf');
    expect(tint('#f86e6e')).toBe('#fcd1cf');
    expect(tint(TILES_INK, 0.18)).toBe('#d3d2cf');
    expect(blockMeterModel(0).columns[10].tint).toBe('#d1ecde');
  });

  it('roundHalfEven matches Python round()', () => {
    expect([0.5, 1.5, 2.5, -0.5, -1.5, -2.5, 3.6, -3.6, 2.4].map(roundHalfEven)).toEqual([0, 2, 2, 0, -2, -2, 4, -4, 2]);
  });
});
