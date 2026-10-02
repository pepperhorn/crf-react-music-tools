import { describe, it, expect } from 'vitest';
import { PANEL_GAP, PANEL_GUTTER, computePanelPosition, panelLeft, panelTop, panelWidth } from './position';

const bar = (left: number, right: number, bottom = 50) => ({ left, right, bottom });

describe('panelWidth', () => {
  it('is the tool width when the viewport has room, else the viewport less both gutters', () => {
    expect(panelWidth(760, 1280)).toBe(760);
    expect(panelWidth(760, 700)).toBe(700 - 2 * PANEL_GUTTER);
    expect(panelWidth(414, 360)).toBe(328);
    expect(panelWidth(760, 10)).toBe(0);
  });
});

describe('panelLeft', () => {
  it("start: lines up with the bar's left edge", () => {
    expect(panelLeft({ anchor: bar(100, 188), viewportWidth: 1280, width: 760, align: 'start' })).toBe(100);
  });

  it("end: lines the panel's right edge up with the bar's right edge", () => {
    expect(panelLeft({ anchor: bar(1176, 1264), viewportWidth: 1280, width: 760, align: 'end' })).toBe(1264 - 760);
  });

  it('start flips to end when it would run off the right (bar at the right of the header)', () => {
    expect(panelLeft({ anchor: bar(1176, 1264), viewportWidth: 1280, width: 760, align: 'start' })).toBe(504);
  });

  it('end flips to start when it would run off the left (bar at the left of the header)', () => {
    expect(panelLeft({ anchor: bar(16, 104), viewportWidth: 1280, width: 760, align: 'end' })).toBe(16);
  });

  it('clamps to the gutters when neither side fits', () => {
    // 800px viewport, 760px panel: only [16, 24] is on screen.
    expect(panelLeft({ anchor: bar(300, 388), viewportWidth: 800, width: 760, align: 'start' })).toBe(24);
    expect(panelLeft({ anchor: bar(300, 388), viewportWidth: 800, width: 760, align: 'end' })).toBe(16);
  });

  it('never leaves the viewport on either side, wherever the bar is', () => {
    for (const align of ['start', 'end'] as const)
      for (const vw of [640, 700, 800, 1024, 1280, 1920])
        for (const width of [414, 760].map((w) => panelWidth(w, vw)))
          for (let left = -200; left < vw + 200; left += 37) {
            const x = panelLeft({ anchor: bar(left, left + 88), viewportWidth: vw, width, align });
            expect(x).toBeGreaterThanOrEqual(PANEL_GUTTER);
            expect(x + width).toBeLessThanOrEqual(vw - PANEL_GUTTER);
          }
  });

  it('rounds to whole pixels', () => {
    expect(panelLeft({ anchor: bar(100.4, 188.4), viewportWidth: 1280, width: 760, align: 'start' })).toBe(100);
  });
});

describe('panelTop', () => {
  it('default: just under the bar, and never above the top gutter when the bar has scrolled away', () => {
    expect(panelTop(50)).toBe(`${50 + PANEL_GAP}px`);
    expect(panelTop(49.6)).toBe('58px');
    expect(panelTop(-300)).toBe(`${PANEL_GUTTER}px`);
  });

  it('topOffset as a number clears the host header, but never sits above the bar', () => {
    // Bar inside a 64px header: below the header, not just below the bar.
    expect(panelTop(50, 64)).toBe('72px');
    // Bar in the page, below the header: under the bar.
    expect(panelTop(200, 64)).toBe('208px');
    // Bar scrolled behind the header.
    expect(panelTop(-300, 64)).toBe('72px');
    expect(panelTop(50, 0)).toBe('58px');
  });

  it('topOffset as a CSS length is compared in CSS, with the same never-above-the-bar rule', () => {
    expect(panelTop(50, '4rem')).toBe('max(calc(4rem + 8px), 58px)');
    expect(panelTop(50, 'var(--header-h)')).toBe('max(calc(var(--header-h) + 8px), 58px)');
    expect(panelTop(50, ' 64px ')).toBe('max(calc(64px + 8px), 58px)');
    // A numeric string is pixels.
    expect(panelTop(50, '64')).toBe('72px');
    // Empty or unusable: as if not given.
    expect(panelTop(50, '')).toBe('58px');
    expect(panelTop(50, Number.NaN)).toBe('58px');
  });
});

describe('computePanelPosition', () => {
  it('puts the three together', () => {
    expect(
      computePanelPosition({ anchor: bar(1176, 1264, 48), viewportWidth: 1280, maxWidth: 414, align: 'end', topOffset: 64 }),
    ).toEqual({ left: 850, width: 414, top: '72px' });
    expect(computePanelPosition({ anchor: bar(16, 104, 48), viewportWidth: 700, maxWidth: 760 })).toEqual({
      left: 16,
      width: 668,
      top: '56px',
    });
  });
});
