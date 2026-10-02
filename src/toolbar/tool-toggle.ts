/**
 * The toolbar's icon button: white with a hairline, yellow with an ink border
 * while its panel is open, green with an ink border while the metronome runs.
 *
 * Every colour and size is a literal value wrapped in a custom property, so
 * the button looks right on a bare page and a host can restyle it by setting
 * `--crfmt-toolbar-*` on the bar or any ancestor (see the README).
 *
 * The `::before` enlarges the hit area to at least 44px whatever the size.
 */
export type ToolToggleState = 'idle' | 'open' | 'running';

const BASE =
  "crfmt-tool-toggle relative inline-flex h-[var(--crfmt-toolbar-size,40px)] w-[var(--crfmt-toolbar-size,40px)] shrink-0 cursor-pointer select-none touch-manipulation items-center justify-center rounded-[var(--crfmt-toolbar-radius,10px)] border text-[color:var(--crfmt-toolbar-button-color,#141210)] transition-colors [-webkit-touch-callout:none] before:absolute before:inset-[min(-3px,calc((var(--crfmt-toolbar-size,40px)-44px)/2))] before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--crfmt-toolbar-focus,#141210)]";

const ACTIVE_BORDER = 'border-[color:var(--crfmt-toolbar-active-border,#141210)]';

const STATE: Record<ToolToggleState, string> = {
  idle: 'border-[color:var(--crfmt-toolbar-button-border,#d6d3cd)] bg-[var(--crfmt-toolbar-button-bg,#fff)] hover:bg-[var(--crfmt-toolbar-button-hover-bg,#f4f2ee)]',
  open: `${ACTIVE_BORDER} bg-[var(--crfmt-toolbar-open-bg,#fff56d)]`,
  running: `${ACTIVE_BORDER} bg-[var(--crfmt-toolbar-running-bg,#6bc6a0)] hover:bg-[var(--crfmt-toolbar-running-hover-bg,#7fd0ad)]`,
};

/** Classes for a toolbar button in `state`. */
export function toolToggleClass(state: ToolToggleState): string {
  return `${BASE} ${STATE[state]}`;
}
