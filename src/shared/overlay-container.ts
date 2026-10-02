/**
 * Where the library's own overlays (the metronome's presets dialog) are
 * portalled to. `null` — the default — means `document.body`.
 *
 * The toolbar's floating panel provides its own portal element here, so an
 * overlay opened from inside the panel lands in the same stacking context and
 * is drawn above the panel whatever z-index the host gave it.
 */
import { createContext } from 'react';

export const OverlayContainerContext = createContext<HTMLElement | null>(null);
