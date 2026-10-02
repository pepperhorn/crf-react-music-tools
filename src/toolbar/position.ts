/**
 * Where a toolbar panel goes. Pure functions: no DOM, so they are unit tested
 * on their own and the hook only has to measure.
 *
 * From 640px the panel is anchored under the bar (or the host's `anchor`):
 * `left` and `width` are computed here in pixels. Under 640px the stylesheet
 * makes it a full-width card with 16px gutters and only a top is used:
 * `top`, or `compactTop` when the host asked for the card to sit at its
 * header offset.
 */

/** Space kept between the panel and the viewport edges. */
export const PANEL_GUTTER = 16;
/** Space between the panel and what it hangs under (the bar, or the host's header). */
export const PANEL_GAP = 8;

/** The narrowest `fit: 'shrink'` makes a panel; with less room than this it shifts instead. The phone card on a 360px screen is 328px. */
export const PANEL_MIN_WIDTH = 320;
/** The narrowest the tools' 760px wide layouts are ever given without shrinking: a 640px viewport less both gutters. */
export const PANEL_WIDE_MIN = 608;

export type ToolbarAlign = 'start' | 'end';
/** What to do when the panel does not fit at its aligned edge: move it (keeping its width), or narrow it (keeping its edge). */
export type ToolbarFit = 'shift' | 'shrink';
/** Under 640px: keep the card below the bar, or pin it at `topOffset` wherever the bar is. */
export type ToolbarCompactTop = 'below-bar' | 'offset';

/** The bar's box in viewport coordinates (`getBoundingClientRect`). */
export interface AnchorRect {
  left: number;
  right: number;
  bottom: number;
}

/** The panel's width: the tool's own width, or the viewport less both gutters when that is narrower. */
export function panelWidth(maxWidth: number, viewportWidth: number): number {
  return Math.max(0, Math.min(Math.round(maxWidth), Math.round(viewportWidth) - 2 * PANEL_GUTTER));
}

export interface PanelLeftInput {
  anchor: Pick<AnchorRect, 'left' | 'right'>;
  viewportWidth: number;
  /** From `panelWidth`. */
  width: number;
  align?: ToolbarAlign;
}

/**
 * The panel's left edge. `start` lines it up with the bar's left edge, `end`
 * lines its right edge up with the bar's right edge. A side that would leave
 * the viewport flips to the other; when neither fits it is clamped to the
 * gutters.
 */
export function panelLeft({ anchor, viewportWidth, width, align = 'start' }: PanelLeftInput): number {
  const min = PANEL_GUTTER;
  const max = Math.max(min, Math.round(viewportWidth) - PANEL_GUTTER - width);
  const start = Math.round(anchor.left);
  const end = Math.round(anchor.right) - width;
  const fits = (x: number) => x >= min && x <= max;
  const [preferred, flipped] = align === 'end' ? [end, start] : [start, end];
  if (fits(preferred)) return preferred;
  if (fits(flipped)) return flipped;
  return Math.min(max, Math.max(min, preferred));
}

export interface PanelBoxInput {
  anchor: Pick<AnchorRect, 'left' | 'right'>;
  viewportWidth: number;
  /** The tool's own width at 640px and up. */
  maxWidth: number;
  align?: ToolbarAlign;
  fit?: ToolbarFit;
}

/**
 * The panel's left edge and width from 640px.
 *
 * - `shift` (default): the panel is as wide as the tool, or as the viewport
 *   allows, and is moved to stay on screen (`panelWidth`, `panelLeft`).
 * - `shrink`: the aligned edge stays at the anchor's (`start`: left edges,
 *   `end`: right edges; an edge outside the gutters is brought in to the
 *   gutter) and the width is the room between that edge and the far gutter.
 *   It never flips. With less than `PANEL_MIN_WIDTH` of room it falls back to
 *   `shift`.
 */
export function panelBox({ anchor, viewportWidth, maxWidth, align = 'start', fit = 'shift' }: PanelBoxInput): { left: number; width: number } {
  if (fit === 'shrink') {
    const min = PANEL_GUTTER;
    const max = Math.round(viewportWidth) - PANEL_GUTTER;
    const edge = align === 'end' ? Math.min(max, Math.round(anchor.right)) : Math.max(min, Math.round(anchor.left));
    const room = align === 'end' ? edge - min : max - edge;
    const width = Math.min(Math.round(maxWidth), room);
    if (width >= Math.min(PANEL_MIN_WIDTH, Math.round(maxWidth))) return { left: align === 'end' ? edge - width : edge, width };
  }
  const width = panelWidth(maxWidth, viewportWidth);
  return { left: panelLeft({ anchor, viewportWidth, width, align }), width };
}

/**
 * The layout a tool should be forced into at `width`: `'compact'` when the
 * panel is narrower than the tool's wide layout is ever given otherwise
 * (which only `fit: 'shrink'` does), else `undefined` — the tool follows the
 * viewport as usual.
 */
export function panelLayout(width: number, maxWidth: number): 'compact' | undefined {
  return width < Math.min(Math.round(maxWidth), PANEL_WIDE_MIN) ? 'compact' : undefined;
}

/** `topOffset` as pixels, a CSS length, or `undefined` when missing or unusable. */
function readOffset(topOffset?: number | string): number | string | undefined {
  let offset: number | string | undefined = topOffset;
  if (typeof offset === 'string') {
    const text = offset.trim();
    offset = text === '' ? undefined : /^-?\d*\.?\d+$/.test(text) ? Number(text) : text;
  }
  if (typeof offset === 'number' && !Number.isFinite(offset)) offset = undefined;
  return offset;
}

/**
 * The panel's top edge, as a CSS length.
 *
 * - No `topOffset`: 8px under the bar, and never above the 16px top gutter.
 * - `topOffset` is how much of the top of the viewport the host's sticky or
 *   fixed header covers. The panel starts 8px below that, or 8px below the
 *   bar when the bar is lower still — it never sits above the bar.
 *   A number (or a numeric string) is pixels; any other string is used as a
 *   CSS length (`'4rem'`, `'var(--header-height)'`) and compared in CSS.
 */
export function panelTop(anchorBottom: number, topOffset?: number | string): string {
  const underBar = Math.round(anchorBottom + PANEL_GAP);
  const offset = readOffset(topOffset);
  if (offset === undefined) return `${Math.max(PANEL_GUTTER, underBar)}px`;
  if (typeof offset === 'number') return `${Math.max(Math.round(offset + PANEL_GAP), underBar)}px`;
  return `max(calc(${offset} + ${PANEL_GAP}px), ${underBar}px)`;
}

/**
 * The top edge of the under-640px card when it is not the same as `panelTop`.
 *
 * - `'below-bar'` (default): `undefined` — the card uses `panelTop`.
 * - `'offset'`: 8px below `topOffset` and nothing else, so a bar further down
 *   the page does not push the card down with it; never under the notch
 *   (`env(safe-area-inset-top)`). Without a usable `topOffset`, the 16px gutter.
 */
export function panelCompactTop(topOffset?: number | string, compactTop: ToolbarCompactTop = 'below-bar'): string | undefined {
  if (compactTop !== 'offset') return undefined;
  const offset = readOffset(topOffset);
  const length =
    offset === undefined ? `${PANEL_GUTTER}px` : typeof offset === 'number' ? `${Math.round(offset + PANEL_GAP)}px` : `calc(${offset} + ${PANEL_GAP}px)`;
  return `max(${length}, env(safe-area-inset-top))`;
}

export interface PanelPositionInput {
  anchor: AnchorRect;
  viewportWidth: number;
  /** The tool's own width at 640px and up. */
  maxWidth: number;
  align?: ToolbarAlign;
  topOffset?: number | string;
  fit?: ToolbarFit;
  compactTop?: ToolbarCompactTop;
}

export interface PanelPosition {
  /** Pixels from the viewport's left edge (used from 640px). */
  left: number;
  /** Pixels (used from 640px). */
  width: number;
  /** CSS length from the viewport's top edge. */
  top: string;
  /** CSS length used instead of `top` under 640px; only present with `compactTop: 'offset'`. */
  compactTop?: string;
}

export function computePanelPosition({ anchor, viewportWidth, maxWidth, align, topOffset, fit, compactTop }: PanelPositionInput): PanelPosition {
  const position: PanelPosition = { ...panelBox({ anchor, viewportWidth, maxWidth, align, fit }), top: panelTop(anchor.bottom, topOffset) };
  const compact = panelCompactTop(topOffset, compactTop);
  if (compact !== undefined) position.compactTop = compact;
  return position;
}
