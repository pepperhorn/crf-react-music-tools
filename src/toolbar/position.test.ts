import { describe, it, expect } from 'vitest';
import {
  PANEL_GAP,
  PANEL_GUTTER,
  PANEL_MIN_WIDTH,
  PANEL_WIDE_MIN,
  computePanelPosition,
  panelBox,
  panelCompactTop,
  panelLayout,
  panelLeft,
  panelTop,
  panelWidth,
} from './position';

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

describe("panelBox, fit: 'shift' (the default)", () => {
  it('is panelWidth and panelLeft: full width, flipped or clamped into the viewport', () => {
    expect(panelBox({ anchor: bar(100, 188), viewportWidth: 1280, maxWidth: 760 })).toEqual({ left: 100, width: 760 });
    // A sidebar layout: the panel keeps its width and moves left, over the sidebar.
    expect(panelBox({ anchor: bar(280, 804), viewportWidth: 820, maxWidth: 760 })).toEqual({ left: 44, width: 760 });
    expect(panelBox({ anchor: bar(280, 804), viewportWidth: 820, maxWidth: 760, fit: 'shift', align: 'end' })).toEqual({ left: 44, width: 760 });
  });
});

describe("panelBox, fit: 'shrink'", () => {
  it('start: the left edge stays at the anchor and the width is what is left before the right gutter', () => {
    // 820px viewport, strip starting at 280 (a sidebar): 820 - 16 - 280.
    expect(panelBox({ anchor: bar(280, 804), viewportWidth: 820, maxWidth: 760, fit: 'shrink' })).toEqual({ left: 280, width: 524 });
    expect(panelBox({ anchor: bar(280.4, 804), viewportWidth: 820, maxWidth: 414, fit: 'shrink' })).toEqual({ left: 280, width: 414 });
  });

  it("end: the right edge stays at the anchor's and the width is what is left after the left gutter", () => {
    // A strip ending at 540 with a sidebar on the right: 540 - 16.
    expect(panelBox({ anchor: bar(16, 540), viewportWidth: 820, maxWidth: 760, fit: 'shrink', align: 'end' })).toEqual({ left: 16, width: 524 });
    expect(panelBox({ anchor: bar(16, 540), viewportWidth: 820, maxWidth: 414, fit: 'shrink', align: 'end' })).toEqual({ left: 126, width: 414 });
  });

  it('is the same as shift when the panel fits at its aligned edge', () => {
    for (const align of ['start', 'end'] as const) {
      const input = { anchor: align === 'start' ? bar(100, 188) : bar(1176, 1264), viewportWidth: 1280, maxWidth: 760, align };
      expect(panelBox({ ...input, fit: 'shrink' })).toEqual(panelBox({ ...input, fit: 'shift' }));
    }
  });

  it('never flips: an edge that would need it shrinks instead', () => {
    // Shift would flip this to the bar's right edge (504).
    expect(panelBox({ anchor: bar(900, 1264), viewportWidth: 1280, maxWidth: 760, fit: 'shrink' })).toEqual({ left: 900, width: 364 });
    expect(panelBox({ anchor: bar(16, 400), viewportWidth: 1280, maxWidth: 760, fit: 'shrink', align: 'end' })).toEqual({ left: 16, width: 384 });
  });

  it('an anchor edge outside the gutters is brought in to the gutter', () => {
    expect(panelBox({ anchor: bar(-40, 300), viewportWidth: 820, maxWidth: 760, fit: 'shrink' })).toEqual({ left: 16, width: 760 });
    expect(panelBox({ anchor: bar(300, 900), viewportWidth: 820, maxWidth: 760, fit: 'shrink', align: 'end' })).toEqual({ left: 44, width: 760 });
  });

  it(`shrinks down to ${PANEL_MIN_WIDTH}px; with less room than that it falls back to shifting`, () => {
    const at = (left: number, align: 'start' | 'end' = 'start') =>
      panelBox({ anchor: align === 'start' ? bar(left, left + 88) : bar(left - 88, left), viewportWidth: 820, maxWidth: 760, fit: 'shrink', align });
    expect(at(820 - 16 - PANEL_MIN_WIDTH)).toEqual({ left: 484, width: PANEL_MIN_WIDTH });
    expect(at(820 - 16 - PANEL_MIN_WIDTH + 1)).toEqual(panelBox({ anchor: bar(485, 573), viewportWidth: 820, maxWidth: 760 }));
    expect(at(16 + PANEL_MIN_WIDTH, 'end')).toEqual({ left: 16, width: PANEL_MIN_WIDTH });
    expect(at(16 + PANEL_MIN_WIDTH - 1, 'end')).toEqual(
      panelBox({ anchor: bar(247, 335), viewportWidth: 820, maxWidth: 760, align: 'end' }),
    );
    // A bar scrolled out sideways: nothing to hang under.
    expect(at(2000)).toEqual(panelBox({ anchor: bar(2000, 2088), viewportWidth: 820, maxWidth: 760 }));
  });

  it('never leaves the viewport and is never narrower than the minimum (or the viewport allows)', () => {
    for (const align of ['start', 'end'] as const)
      for (const vw of [640, 700, 820, 1024, 1280, 1920])
        for (const maxWidth of [414, 760])
          for (let left = -200; left < vw + 200; left += 37) {
            const box = panelBox({ anchor: bar(left, left + 88), viewportWidth: vw, maxWidth, align, fit: 'shrink' });
            expect(box.left).toBeGreaterThanOrEqual(PANEL_GUTTER);
            expect(box.left + box.width).toBeLessThanOrEqual(vw - PANEL_GUTTER);
            expect(box.width).toBeGreaterThanOrEqual(Math.min(PANEL_MIN_WIDTH, panelWidth(maxWidth, vw)));
            expect(box.width).toBeLessThanOrEqual(maxWidth);
          }
  });
});

describe('panelLayout', () => {
  it('is undefined (the tool follows the viewport) unless the panel was squeezed below what its wide layout takes', () => {
    expect(panelLayout(760, 760)).toBeUndefined();
    // The narrowest a 760px tool gets without shrinking: a 640px viewport less the gutters.
    expect(panelLayout(PANEL_WIDE_MIN, 760)).toBeUndefined();
    expect(panelLayout(PANEL_WIDE_MIN - 1, 760)).toBe('compact');
    expect(panelLayout(524, 760)).toBe('compact');
    // The metronome's full card is 414px in its wide layout.
    expect(panelLayout(414, 414)).toBeUndefined();
    expect(panelLayout(413, 414)).toBe('compact');
  });
});

describe('panelCompactTop', () => {
  it("'below-bar' (the default) has no separate compact top", () => {
    expect(panelCompactTop(56)).toBeUndefined();
    expect(panelCompactTop(56, 'below-bar')).toBeUndefined();
  });

  it("'offset': topOffset plus the gap alone, wherever the bar is, and never under the notch", () => {
    expect(panelCompactTop(48, 'offset')).toBe('max(56px, env(safe-area-inset-top))');
    expect(panelCompactTop('48', 'offset')).toBe('max(56px, env(safe-area-inset-top))');
    expect(panelCompactTop(0, 'offset')).toBe('max(8px, env(safe-area-inset-top))');
    expect(panelCompactTop('3rem', 'offset')).toBe('max(calc(3rem + 8px), env(safe-area-inset-top))');
    expect(panelCompactTop(' var(--header-h) ', 'offset')).toBe('max(calc(var(--header-h) + 8px), env(safe-area-inset-top))');
  });

  it("'offset' without a usable topOffset: the top gutter", () => {
    expect(panelCompactTop(undefined, 'offset')).toBe('max(16px, env(safe-area-inset-top))');
    expect(panelCompactTop('', 'offset')).toBe('max(16px, env(safe-area-inset-top))');
    expect(panelCompactTop(Number.NaN, 'offset')).toBe('max(16px, env(safe-area-inset-top))');
  });
});

describe('computePanelPosition with fit and compactTop', () => {
  it('passes both through; the anchored top is unchanged', () => {
    expect(
      computePanelPosition({ anchor: bar(280, 804, 300), viewportWidth: 820, maxWidth: 760, topOffset: 48, fit: 'shrink', compactTop: 'offset' }),
    ).toEqual({ left: 280, width: 524, top: '308px', compactTop: 'max(56px, env(safe-area-inset-top))' });
    expect(computePanelPosition({ anchor: bar(280, 804, 300), viewportWidth: 820, maxWidth: 760, topOffset: 48 }).compactTop).toBeUndefined();
  });
});
