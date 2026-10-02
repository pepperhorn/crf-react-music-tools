/**
 * Tailwind class fragments shared by the metronome view and its presets
 * overlay (the "tiles" neo-brutalist look: paper #fdfcf9, ink #141210, square
 * corners, hard offset shadows, selected = yellow #fff56d).
 */

export { FONT_DISPLAY, FONT_MONO, FONT_UI, ROOT_CLASS } from '../shared/classes';

export const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141210] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fff56d] focus-visible:z-10';
/** Every button: square, ≥44px tall, no long-press selection. Add your own display/alignment. */
export const BTN_CORE = `min-h-11 cursor-pointer select-none touch-manipulation rounded-none text-[#141210] [-webkit-touch-callout:none] ${FOCUS}`;
/** A button with centred content. */
export const BTN = `${BTN_CORE} inline-flex items-center justify-center`;
/** Hard-shadowed button that sinks into its shadow when pressed. */
export const SHADOW_BTN = `metronome-btn-shadow ${BTN} border-2 border-[#141210] shadow-[3px_3px_0_#141210] transition-transform duration-75 active:translate-x-[2px] active:translate-y-[2px]`;
export const PAPER_BTN = 'bg-[#fdfcf9] hover:bg-[#fff9b3]';
