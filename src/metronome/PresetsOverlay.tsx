/**
 * The metronome's rhythm-preset picker: a modal overlay listing every
 * subdivision pattern with its title, description, tags and a little picture
 * of its slots, filterable by tag.
 *
 * Rendered through a portal to `document.body`, so the 204px-tall Simple
 * chassis (and the host's scrolling panel) cannot clip it. The parent only
 * mounts it after a click, so it never renders on the server.
 *
 * Keyboard: focus moves in on open, Tab stays inside, and Escape closes this
 * overlay only — it is handled in the capture phase on `document`, stopped and
 * marked `defaultPrevented`, so a host listener further out (e.g. the one
 * that closes a panel the metronome sits in) never acts on it.
 *
 * Body swaps: a host that replaces `document.body` on navigation (Astro's
 * view transitions do, while keeping this component's island alive) would
 * leave the portal behind in the discarded body with the key trap still on
 * `document`. So the overlay closes itself on the host's "about to swap"
 * event, and the key trap does nothing while the dialog is not in the
 * document — the second guard covers any swap we were not told about.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { filterPatterns, patternTags, type SlotKind, type SubdivisionPattern } from './model';
import { BTN, BTN_CORE, FONT_DISPLAY, FONT_MONO, FONT_UI, PAPER_BTN, SHADOW_BTN } from './styles';
import { ROOT_CLASS } from '../shared/classes';

export interface PresetsOverlayProps {
  patterns: readonly SubdivisionPattern[];
  /** Id of the pattern playing now (its row is shown selected). */
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

/**
 * Fired on `document` by Astro's view-transition router just before it swaps
 * the body. Named as a plain string: this folder imports nothing from Astro,
 * and on any other host the event simply never fires.
 */
const BEFORE_BODY_SWAP_EVENT = 'astro:before-swap';

const POP_KEYFRAMES =
  '@keyframes metronome-presets-pop{from{opacity:0;transform:translateY(8px) scale(.96)}to{opacity:1;transform:none}}';

const CHIP = `metronome-preset-chip ${BTN} ${FONT_MONO} h-11 border-2 border-[#141210] px-3 text-[11px] font-bold uppercase tracking-[0.04em]`;

const SLOT_LOOK: Record<SlotKind, string> = {
  beat: 'h-[12px] w-[10px] bg-[#141210]',
  sub: 'h-[7px] w-[10px] border-2 border-[#141210]',
  rest: 'h-[12px] w-[10px] border-[1.5px] border-dashed border-[#141210]',
};

/** One small square per slot, grouped per beat. Decorative. */
function SlotStrip({ pattern }: { pattern: SubdivisionPattern }) {
  const groups: SlotKind[][] = [];
  for (let i = 0; i < pattern.slots.length; i += pattern.division) groups.push(pattern.slots.slice(i, i + pattern.division));
  return (
    <span className="metronome-preset-slots flex min-w-0 flex-wrap items-end justify-end gap-x-[6px] gap-y-1" aria-hidden="true">
      {groups.map((group, g) => (
        <span key={g} className="metronome-preset-beat-group flex items-end gap-[2px]">
          {group.map((kind, i) => (
            <span key={i} className={`metronome-preset-slot metronome-preset-slot-${kind} block ${SLOT_LOOK[kind]}`} data-slot={kind} />
          ))}
        </span>
      ))}
    </span>
  );
}

function CloseIcon() {
  return (
    <svg className="metronome-icon-close" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function PresetsOverlay({ patterns, selectedId, onSelect, onClose }: PresetsOverlayProps) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      const dialog = dialogRef.current;
      // Orphaned (its body was swapped out): trapping keys now would block the whole page.
      if (!dialog || !dialog.isConnected) return;
      if (e.key === 'Escape') {
        // Ours alone: nothing further out should also close on it.
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled])')];
      if (focusable.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active) || active === dialog) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      }
    };
    const onBeforeSwap = () => closeRef.current();
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener(BEFORE_BODY_SWAP_EVENT, onBeforeSwap);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener(BEFORE_BODY_SWAP_EVENT, onBeforeSwap);
    };
  }, []);

  const tags = patternTags(patterns);
  const shown = filterPatterns(patterns, selectedTags);
  const toggleTag = (tag: string) =>
    setSelectedTags((sel) => (sel.includes(tag) ? sel.filter((t) => t !== tag) : [...sel, tag]));

  return createPortal(
    <div
      className={`${ROOT_CLASS} metronome-presets-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(20,18,16,0.55)] p-4`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <style>{POP_KEYFRAMES}</style>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Rhythm presets"
        tabIndex={-1}
        className={`metronome-presets-overlay ${FONT_UI} flex max-h-[85dvh] w-full max-w-[480px] flex-col gap-3 border-[3px] border-[#141210] bg-[#fdfcf9] p-[14px] text-[#141210] shadow-[5px_5px_0_#141210] outline-none motion-safe:animate-[metronome-presets-pop_140ms_ease-out] sm:max-h-[80dvh]`}
      >
        <div className="metronome-presets-header flex shrink-0 items-center justify-between gap-3 pr-[3px]">
          <div className={`metronome-presets-title ${FONT_DISPLAY} text-[24px] uppercase leading-none tracking-[-0.03em]`}>Presets</div>
          <button
            type="button"
            className={`metronome-btn-presets-close ${SHADOW_BTN} ${PAPER_BTN} h-11 w-11 shrink-0`}
            aria-label="Close presets"
            title="Close presets"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="metronome-preset-tags-filter flex shrink-0 flex-wrap gap-2" role="group" aria-label="Filter by tag">
          <button
            type="button"
            className={`metronome-preset-chip-all ${CHIP} ${selectedTags.length === 0 ? 'bg-[#fff56d]' : PAPER_BTN}`}
            aria-pressed={selectedTags.length === 0}
            onClick={() => setSelectedTags([])}
          >
            All
          </button>
          {tags.map((tag) => {
            const on = selectedTags.includes(tag);
            return (
              <button key={tag} type="button" className={`${CHIP} ${on ? 'bg-[#fff56d]' : PAPER_BTN}`} aria-pressed={on} onClick={() => toggleTag(tag)}>
                {tag}
              </button>
            );
          })}
        </div>

        <div className="metronome-presets-list -m-1 flex min-h-0 flex-col gap-2 overflow-y-auto p-1">
          {shown.length === 0 && (
            <p className="metronome-presets-empty border-2 border-dashed border-[#141210] px-3 py-4 text-center text-[13px]">No presets match these tags.</p>
          )}
          {shown.map((p) => {
            const on = p.id === selectedId;
            return (
              <button
                key={p.id}
                type="button"
                className={`metronome-preset-row metronome-preset-${p.id} ${BTN_CORE} flex w-full shrink-0 flex-col items-stretch gap-1 border-2 border-[#141210] px-3 py-2 text-left ${on ? 'metronome-preset-selected bg-[#fff56d]' : PAPER_BTN}`}
                aria-pressed={on}
                onClick={() => onSelect(p.id)}
              >
                <span className="metronome-preset-title block text-[15px] font-semibold leading-tight">{p.title}</span>
                {p.description && <span className="metronome-preset-description block text-[12px] font-normal leading-snug">{p.description}</span>}
                <span className="metronome-preset-foot flex items-end justify-between gap-3 pt-1">
                  <span className={`metronome-preset-tags ${FONT_MONO} flex flex-wrap gap-x-2 text-[10px] uppercase leading-none tracking-[0.1em] text-[#5a5651]`}>
                    {p.tags.map((t) => (
                      <span key={t} className="metronome-preset-tag">
                        {t}
                      </span>
                    ))}
                  </span>
                  <SlotStrip pattern={p} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
