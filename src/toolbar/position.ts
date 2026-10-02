/**
 * Where a toolbar panel goes. Pure functions: no DOM, so they are unit tested
 * on their own and the hook only has to measure.
 *
 * From 640px the panel is anchored under the bar: `left` and `width` are
 * computed here in pixels. Under 640px the stylesheet makes it a full-width
 * card with 16px gutters and only `top` is used.
 */

/** Space kept between the panel and the viewport edges. */
export const PANEL_GUTTER = 16;
/** Space between the panel and what it hangs under (the bar, or the host's header). */
export const PANEL_GAP = 8;

export type ToolbarAlign = 'start' | 'end';

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
  let offset: number | string | undefined = topOffset;
  if (typeof offset === 'string') {
    const text = offset.trim();
    offset = text === '' ? undefined : /^-?\d*\.?\d+$/.test(text) ? Number(text) : text;
  }
  if (typeof offset === 'number' && !Number.isFinite(offset)) offset = undefined;
  if (offset === undefined) return `${Math.max(PANEL_GUTTER, underBar)}px`;
  if (typeof offset === 'number') return `${Math.max(Math.round(offset + PANEL_GAP), underBar)}px`;
  return `max(calc(${offset} + ${PANEL_GAP}px), ${underBar}px)`;
}

export interface PanelPositionInput {
  anchor: AnchorRect;
  viewportWidth: number;
  /** The tool's own width at 640px and up. */
  maxWidth: number;
  align?: ToolbarAlign;
  topOffset?: number | string;
}

export interface PanelPosition {
  /** Pixels from the viewport's left edge (used from 640px). */
  left: number;
  /** Pixels (used from 640px). */
  width: number;
  /** CSS length from the viewport's top edge. */
  top: string;
}

export function computePanelPosition({ anchor, viewportWidth, maxWidth, align, topOffset }: PanelPositionInput): PanelPosition {
  const width = panelWidth(maxWidth, viewportWidth);
  return { left: panelLeft({ anchor, viewportWidth, width, align }), width, top: panelTop(anchor.bottom, topOffset) };
}
