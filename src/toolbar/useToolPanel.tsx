/**
 * What the toolbar's tools share: the floating, non-modal panel — where it
 * goes, Escape, focus, the portal, and the one-panel-at-a-time rule.
 *
 * - One at a time: opening a panel takes a module-level slot; whichever panel
 *   held it closes, without moving focus. It is shared by every tool button on
 *   the page, in a `MusicToolsBar` or on its own. What closing means beyond
 *   hiding the panel is the tool's business: the tuner unmounts and releases
 *   the microphone, the metronome keeps playing.
 * - Position: measured from the bar — or the host's `anchor` — when the panel
 *   opens and again on resize (see position.ts). Under 640px the stylesheet
 *   makes it a full-width card.
 * - Escape closes the panel only when focus is inside it or on its button, and
 *   never when another dialog owns the key.
 * - Portal: the panel is rendered into its own element on `document.body`, so
 *   a host header with `overflow: hidden`, a transform or a `backdrop-filter`
 *   (which would otherwise clip it, or become the containing block of a
 *   `position: fixed` child) cannot affect it. That element carries the
 *   library's root class, so the scoped stylesheet applies, and is the
 *   stacking context the panel's z-index lives on.
 * - Body swaps: a host that replaces `document.body` on navigation while
 *   keeping the bar alive (Astro's view transitions with `transition:persist`)
 *   would leave the portal behind in the discarded body. After the swap the
 *   portal is moved to the new body and measured again; if the bar itself did
 *   not survive, the panel closes. The events are named as plain strings: on
 *   any other host they simply never fire.
 *
 * The panel is always closed on the server and on the first client render, and
 * nothing here touches `window` or `document` during render, so hydration
 * matches.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ROOT_CLASS } from '../shared/classes';
import { OverlayContainerContext } from '../shared/overlay-container';
import {
  PANEL_GAP,
  PANEL_GUTTER,
  computePanelPosition,
  panelLayout,
  type AnchorRect,
  type PanelPosition,
  type ToolbarAlign,
  type ToolbarCompactTop,
  type ToolbarFit,
} from './position';

/** Class of the bar the panels are anchored under. A tool button on its own is its own anchor. */
export const TOOLBAR_CLASS = 'crfmt-toolbar';

const BEFORE_BODY_SWAP_EVENT = 'astro:before-swap';
/** Fired on `document` by Astro's view-transition router once the new body is in place. */
export const AFTER_BODY_SWAP_EVENT = 'astro:after-swap';

/**
 * The portal element: a zero-size fixed box that only exists to be a stacking
 * context. The default z-index sits above the usual sticky headers and app
 * bars (Bootstrap 1030, MUI 1100) and below the usual modals (MUI 1300).
 */
const PORTAL_CLASS = `${ROOT_CLASS} crfmt-tool-portal fixed left-0 top-0 z-[var(--crfmt-toolbar-panel-z,1150)]`;

/**
 * What the panels hang under, when it is not the bar: a ref, an element, or a
 * CSS selector (the button's closest matching ancestor, else the first match
 * in the document).
 */
export type ToolbarAnchor = RefObject<HTMLElement | null> | HTMLElement | string;

/**
 * Fixed; under 640px a card with 16px gutters, from 640px anchored at the
 * computed left / width. Never taller than the viewport below its top edge:
 * it scrolls inside. Under 640px the top is `--crfmt-panel-top-compact` when
 * the host pinned the card at its header offset, else the same top as from
 * 640px. No z-index of its own — the portal element has it — so the presets
 * dialog, portalled beside it, stacks above.
 */
const PANEL_CLASS =
  'crfmt-tool-panel fixed left-4 right-4 top-[var(--crfmt-panel-top-compact,var(--crfmt-panel-top))] max-h-[calc(100dvh-var(--crfmt-panel-top-compact,var(--crfmt-panel-top))-16px)] overflow-y-auto overscroll-contain outline-none sm:left-[var(--crfmt-panel-left)] sm:right-auto sm:top-[var(--crfmt-panel-top)] sm:max-h-[calc(100dvh-var(--crfmt-panel-top)-16px)] sm:w-[var(--crfmt-panel-width)]';

// ---- one panel at a time -------------------------------------------------

type SlotOwner = object;
let slot: SlotOwner | null = null;
const slotListeners = new Set<(owner: SlotOwner | null) => void>();

function setSlot(owner: SlotOwner | null): void {
  if (slot === owner) return;
  slot = owner;
  for (const fn of [...slotListeners]) fn(owner);
}

// ---- measuring -----------------------------------------------------------

interface Measured {
  anchor: AnchorRect;
  viewportWidth: number;
}

/**
 * The element the panel hangs under: the host's `anchor` when it resolves to
 * one, else the bar the button is in, else the button itself.
 */
export function resolveAnchor(toggle: HTMLElement | null, anchor?: ToolbarAnchor | null): HTMLElement | null {
  let el: HTMLElement | null = null;
  if (typeof anchor === 'string') {
    try {
      el = toggle?.closest<HTMLElement>(anchor) ?? document.querySelector<HTMLElement>(anchor);
    } catch {
      // Not a valid selector: as if not given.
    }
  } else if (anchor) {
    el = 'nodeType' in anchor ? anchor : anchor.current;
  }
  return el ?? toggle?.closest<HTMLElement>(`.${TOOLBAR_CLASS}`) ?? toggle;
}

function measure(toggle: HTMLElement | null, anchor?: ToolbarAnchor | null): Measured {
  const rect = resolveAnchor(toggle, anchor)?.getBoundingClientRect();
  // Without the scrollbar where there is one.
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 0;
  return {
    anchor: rect
      ? { left: rect.left, right: rect.right, bottom: rect.bottom }
      : { left: PANEL_GUTTER, right: PANEL_GUTTER, bottom: PANEL_GUTTER - PANEL_GAP },
    viewportWidth,
  };
}

const OTHER_DIALOG = '[role="dialog"], [role="alertdialog"]';

/** True when `node` sits inside a dialog other than `panel`. */
export function inOtherDialog(node: EventTarget | null, panel: HTMLElement | null): boolean {
  if (!(node instanceof Element)) return false;
  const dialog = node.closest(OTHER_DIALOG);
  return dialog !== null && dialog !== panel;
}

// ---- the hook ------------------------------------------------------------

export interface UseToolPanelOptions {
  /** The tool's own width from 640px (the panel is narrower when the viewport is). */
  maxWidth: number;
  align?: ToolbarAlign;
  topOffset?: number | string;
  anchor?: ToolbarAnchor | null;
  fit?: ToolbarFit;
  compactTop?: ToolbarCompactTop;
  /** Called from the event that opened or closed the panel. */
  onOpenChange?: (open: boolean) => void;
}

export interface ToolPanelState {
  open: boolean;
  /** Where the panel goes; `null` while closed. */
  position: PanelPosition | null;
  /** `'compact'` when `fit: 'shrink'` made the panel too narrow for the tool's wide layout; pass it to the tool. */
  layout: 'compact' | undefined;
  panelId: string;
  toggleRef: RefObject<HTMLButtonElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  /** Open the panel (closing any other tool's). Call from the click handler. */
  openPanel: () => void;
  /** Close and return focus to the button (X, Escape). */
  close: () => void;
  /** Close without moving focus (the button itself, another tool opening). */
  hide: () => void;
  /** Measure the bar again (after a resize or a body swap). */
  remeasure: () => void;
}

export function useToolPanel({ maxWidth, align, topOffset, anchor, fit, compactTop, onOpenChange }: UseToolPanelOptions): ToolPanelState {
  const [measured, setMeasured] = useState<Measured | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [owner] = useState<SlotOwner>(() => ({}));
  const open = measured !== null;
  // The handlers below keep a stable identity; these carry what they need.
  const openRef = useRef(false);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  // Resolved at each measure, so a ref filled after render and a selector both work.
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  const openPanel = useCallback(() => {
    setMeasured(measure(toggleRef.current, anchorRef.current));
    if (!openRef.current) {
      openRef.current = true;
      // Before the slot changes hands, so a bar hears "this one opened" before "that one closed".
      onOpenChangeRef.current?.(true);
    }
    setSlot(owner);
  }, [owner]);

  const hide = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    setMeasured(null);
    if (slot === owner) setSlot(null);
    onOpenChangeRef.current?.(false);
  }, [owner]);

  const close = useCallback(() => {
    hide();
    toggleRef.current?.focus();
  }, [hide]);

  const remeasure = useCallback(() => setMeasured((m) => (m ? measure(toggleRef.current, anchorRef.current) : m)), []);

  // Another tool took the slot: close this panel, leaving focus where it went.
  // Unmounting while open frees the slot (effects never run on the server).
  useEffect(() => {
    const onSlot = (current: SlotOwner | null) => {
      if (current === owner || !openRef.current) return;
      openRef.current = false;
      setMeasured(null);
      onOpenChangeRef.current?.(false);
    };
    slotListeners.add(onSlot);
    return () => {
      slotListeners.delete(onSlot);
      if (slot === owner) setSlot(null);
    };
  }, [owner]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const panel = panelRef.current;
      // Orphaned by a body swap we were not told about: not ours to answer.
      if (!panel || !panel.isConnected) return;
      // Another dialog (a sheet, a confirm, …) owns this Escape.
      if (inOtherDialog(e.target, panel) || inOtherDialog(document.activeElement, panel)) return;
      // Only ours when the user is in this tool: Escape pressed elsewhere on
      // the page (a form field, a menu, nothing at all) must not close it.
      const focused = document.activeElement;
      if (!focused || !(panel.contains(focused) || focused === toggleRef.current)) return;
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', remeasure);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', remeasure);
    };
  }, [open, close, remeasure]);

  const position = measured ? computePanelPosition({ ...measured, maxWidth, align, topOffset, fit, compactTop }) : null;
  const layout = position ? panelLayout(position.width, maxWidth) : undefined;

  return { open, position, layout, panelId, toggleRef, panelRef, openPanel, close, hide, remeasure };
}

// ---- the panel -----------------------------------------------------------

export interface ToolPanelProps {
  panel: ToolPanelState;
  /** Accessible name of the dialog, e.g. 'Tuner'. */
  label: string;
  /** The tool's own classes (corners, padding, …), added to the shared panel classes. */
  className?: string;
  /** z-index of the portal element; by default the stylesheet's `--crfmt-toolbar-panel-z` (1150). */
  zIndex?: number;
  children: ReactNode;
}

/** The floating, non-modal dialog that holds a tool. Renders nothing while closed. */
export function ToolPanel(props: ToolPanelProps) {
  // Split so that nothing below ever runs during a server render.
  return props.panel.open ? <OpenToolPanel {...props} /> : null;
}

function OpenToolPanel({ panel, label, className = '', zIndex, children }: ToolPanelProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const { panelRef, toggleRef, hide, remeasure } = panel;

  // The portal element, made after mount and removed with the panel.
  useLayoutEffect(() => {
    const el = document.createElement('div');
    el.className = PORTAL_CLASS;
    document.body.appendChild(el);
    setHost(el);
    return () => {
      el.remove();
      setHost(null);
    };
  }, []);

  useLayoutEffect(() => {
    if (!host) return;
    if (zIndex === undefined) host.style.removeProperty('--crfmt-toolbar-panel-z');
    else host.style.setProperty('--crfmt-toolbar-panel-z', String(zIndex));
  }, [host, zIndex]);

  useEffect(() => {
    if (!host) return;
    panelRef.current?.focus({ preventScroll: true });
    let hadFocus = false;
    const onBeforeSwap = () => {
      hadFocus = !!panelRef.current?.contains(document.activeElement);
    };
    const onAfterSwap = () => {
      // The bar went with the old page: nothing to hang under.
      if (!toggleRef.current?.isConnected) {
        hide();
        return;
      }
      if (host.parentNode !== document.body) document.body.appendChild(host);
      remeasure();
      // Moving the element dropped focus.
      if (hadFocus) panelRef.current?.focus({ preventScroll: true });
      hadFocus = false;
    };
    document.addEventListener(BEFORE_BODY_SWAP_EVENT, onBeforeSwap);
    document.addEventListener(AFTER_BODY_SWAP_EVENT, onAfterSwap);
    return () => {
      document.removeEventListener(BEFORE_BODY_SWAP_EVENT, onBeforeSwap);
      document.removeEventListener(AFTER_BODY_SWAP_EVENT, onAfterSwap);
    };
  }, [host, panelRef, toggleRef, hide, remeasure]);

  if (!host || !panel.position) return null;
  const { left, top, width, compactTop } = panel.position;
  const style = {
    '--crfmt-panel-left': `${left}px`,
    '--crfmt-panel-top': top,
    '--crfmt-panel-width': `${width}px`,
    ...(compactTop !== undefined ? { '--crfmt-panel-top-compact': compactTop } : {}),
  } as CSSProperties;

  return createPortal(
    <OverlayContainerContext.Provider value={host}>
      <div
        ref={panelRef}
        id={panel.panelId}
        role="dialog"
        aria-modal="false"
        aria-label={label}
        tabIndex={-1}
        style={style}
        className={`${PANEL_CLASS}${className ? ` ${className}` : ''}`}
      >
        {children}
      </div>
    </OverlayContainerContext.Provider>,
    host,
  );
}
