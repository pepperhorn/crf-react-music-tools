/**
 * Self-contained metronome view (the "tiles" neo-brutalist look).
 *
 * Presentational only: no host-app imports, no stores, no audio. Settings come
 * in as props and every change goes out through `onSettingsChange`; the host
 * owns the engine and passes `running`, `onStart` / `onStop` and
 * `getBeatState` (see engine.ts). Because the host owns playback, unmounting
 * this view does not stop the click.
 *
 * Modes: Simple (default) and Full, switched with MORE / LESS. Both offer the
 * first five subdivision patterns as quick toggles and the whole list, with
 * tag filters, behind the Presets button (see PresetsOverlay.tsx).
 * Layouts: at ≥640px Simple is a 760px-wide rectangle and Full a 9:16 card;
 * below that both are a full-width stacked card (override with `layout`).
 * The first render is always the compact card, so server and client markup
 * match; the real layout is applied before paint.
 *
 * The bouncing ball and the lit tile are written straight to the DOM from one
 * requestAnimationFrame loop that only runs while `running` — no React state
 * per frame.
 *
 * Fonts: Archivo Black (brand, BPM), Space Mono (labels), Poppins (buttons,
 * numerals) — the host loads them (see `fonts.css`); system fonts stand in
 * when it does not.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { BeatState } from './engine';
import { PresetsOverlay } from './PresetsOverlay';
import { BTN, BTN_CORE, FONT_DISPLAY, FONT_MONO, FONT_UI, PAPER_BTN, ROOT_CLASS, SHADOW_BTN } from './styles';
import {
  BUILTIN_PATTERNS,
  SIGNATURES,
  SOUNDS,
  clampBpm,
  cycleAccent,
  resolvePattern,
  tapTempo,
  tempoName,
  withSignature,
  type AccentLevel,
  type MetronomeSettings,
  type SubdivisionPattern,
} from './model';

export type MetronomeLayout = 'compact' | 'wide';

export interface MetronomeProps {
  settings: MetronomeSettings;
  onSettingsChange: (next: MetronomeSettings) => void;
  /** Whether the host's engine is playing. */
  running: boolean;
  /** Called synchronously inside the Start click, so the host can unlock audio (iOS). */
  onStart: () => void;
  onStop: () => void;
  /** Called by the close (×) button. Omit it and the button is not rendered. */
  onClose?: () => void;
  /** Where playback is now; polled once per animation frame while `running`. */
  getBeatState: () => BeatState | null;
  /** Subdivision patterns to offer: the first five are quick toggles, all of them are in the Presets list. */
  patterns?: readonly SubdivisionPattern[];
  /** Force a layout; by default it follows (min-width: 640px). */
  layout?: MetronomeLayout;
  /** Short notice shown inside the chassis (e.g. audio is unavailable). */
  message?: string | null;
  /** Small line under the brand mark on the card layouts. Omitted by default. */
  subtitle?: string;
  className?: string;
}

/** Hold − / + this long before it starts repeating. */
export const HOLD_DELAY_MS = 400;
/** Interval between repeats while − / + is held. */
export const HOLD_REPEAT_MS = 70;

/** A tempo change is announced to screen readers once it has stood still this long. */
export const BPM_ANNOUNCE_DELAY_MS = 600;

/** How many patterns get a quick toggle; the rest are reached through Presets. */
const QUICK_PATTERNS = 5;

// ---------------------------------------------------------------------------
// Tile / ball geometry (from the mockups)
// ---------------------------------------------------------------------------

export interface BeatGeometry {
  /** Height of the tile zone, px. */
  zone: number;
  /** Tile height per accent level (0 off, 1 soft, 2 normal, 3 accent), px. */
  heights: readonly [number, number, number, number];
  /** Ball diameter, px. */
  ball: number;
}

/** The 760px Simple rectangle. */
const GEOM_WIDE_SIMPLE: BeatGeometry = { zone: 130, heights: [44, 44, 62, 84], ball: 18 };
/** The Full card and both phone cards. */
const GEOM_CARD: BeatGeometry = { zone: 116, heights: [40, 40, 56, 72], ball: 16 };

const ARC_PX = 24;
/** The jump from the last beat back to beat 1 goes higher. */
const ARC_WRAP_PX = 34;

export interface BallPosition {
  /** Horizontal centre as a fraction of the tile row (0 → 1). */
  f: number;
  /** Top of the ball inside the tile zone, px. */
  top: number;
  /** Index of the sounding tile, or -1 when nothing is playing. */
  active: number;
}

/**
 * Where the ball is for a beat state: sitting on top of the current tile at
 * phase 0, then along an arc to the next tile, each end at that tile's own
 * height. `null` (stopped, or before the first beat) rests on tile 1.
 */
export function ballPosition(accents: readonly AccentLevel[], geom: BeatGeometry, state: BeatState | null): BallPosition {
  const n = Math.max(1, accents.length);
  const bi = state ? Math.max(0, Math.min(state.beat, n - 1)) : 0;
  const p = state ? Math.max(0, Math.min(1, state.phase)) : 0;
  const bj = (bi + 1) % n;
  const hi = geom.heights[accents[bi] ?? 0];
  const hj = geom.heights[accents[bj] ?? 0];
  const arc = (bj === 0 && n > 2 ? ARC_WRAP_PX : ARC_PX) * 4 * p * (1 - p);
  return {
    f: (bi + (bj - bi) * p + 0.5) / n,
    top: geom.zone - (hi + (hj - hi) * p) - arc - (geom.ball + 2),
    active: state ? bi : -1,
  };
}

const BALL_F_VAR = '--metronome-ball-f';
const BALL_TOP_VAR = '--metronome-ball-top';
const fmtF = (f: number) => f.toFixed(4);
const fmtTop = (top: number) => `${top.toFixed(1)}px`;

// ---------------------------------------------------------------------------
// Layout detection
// ---------------------------------------------------------------------------

const WIDE_QUERY = '(min-width: 640px)';
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

/** False on the server and on the first client render; corrected before paint. */
function useWideLayout(): boolean {
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    let mql: MediaQueryList | undefined;
    try {
      mql = window.matchMedia?.(WIDE_QUERY);
    } catch {
      return;
    }
    if (!mql) return;
    const onChange = () => setWide(mql!.matches);
    onChange();
    mql.addEventListener?.('change', onChange);
    return () => mql!.removeEventListener?.('change', onChange);
  }, []);
  return wide;
}

function prefersReducedMotion(): boolean {
  try {
    return !!window.matchMedia?.(REDUCED_QUERY).matches;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Styling
// ---------------------------------------------------------------------------

const SMALL_MONO = `${FONT_MONO} text-[11px] font-bold tracking-[0.04em]`;
/** A cell of a segmented grid (ink gaps between cells). */
const CELL = `${BTN} h-11 min-w-0 overflow-hidden`;
const CELL_ON = 'bg-[#fff56d]';
const CELL_OFF = 'bg-[#fdfcf9] hover:bg-[#fff9b3]';
const SEG_GRID = 'grid gap-[2px] border-2 border-[#141210] bg-[#141210]';
const SECTION_LABEL = `${FONT_MONO} text-[10px] font-bold uppercase leading-none tracking-[0.12em]`;

const LEVEL_NAMES = ['off', 'soft', 'normal', 'accent'] as const;
const LEVEL_TILE = [
  'bg-white border-dashed shadow-none',
  'bg-[#b3f888] border-solid shadow-[2px_2px_0_#141210]',
  'bg-[#88a7f8] border-solid shadow-[2px_2px_0_#141210]',
  'bg-[#f86e6e] border-solid shadow-[2px_2px_0_#141210]',
] as const;
/** The tiles app's "now playing" glow; `data-active` is set from the frame loop. */
const TILE = `metronome-beat-tile box-border flex items-center justify-center border-2 border-[#141210] transition-transform duration-[60ms] motion-reduce:transition-none data-[active=true]:scale-[1.06] data-[active=true]:shadow-[0_0_0_3px_#141210,0_0_16px_4px_rgba(255,245,109,0.95)]`;

const SPECTRUM = [
  '#f86e6e',
  '#f58841',
  '#ffbc57',
  '#b8a334',
  '#fff56d',
  '#b3f888',
  '#93d154',
  '#6bc6a0',
  '#7ee8df',
  '#88a7f8',
  '#cc97e8',
  '#e277b1',
] as const;

function Stripe({ className }: { className: string }) {
  return (
    <div className={`metronome-stripe flex shrink-0 ${className}`} aria-hidden="true">
      {SPECTRUM.map((c) => (
        <div key={c} className="metronome-stripe-cell flex-1" style={{ background: c }} />
      ))}
    </div>
  );
}

function ListIcon() {
  return (
    <svg className="metronome-icon-presets" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" aria-hidden="true">
      <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="metronome-icon-close" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// − / + with hold-to-repeat
// ---------------------------------------------------------------------------

interface RepeatButtonProps {
  onStep: () => void;
  label: string;
  className: string;
  children: ReactNode;
}

/**
 * Steps once on press, then repeats while held. The click that follows a
 * pointer press is swallowed (the press already stepped); a click with no
 * press before it — keyboard, assistive tech — steps once.
 *
 * `pressed` deliberately outlives pointerleave / pointercancel / blur: a touch
 * tap sends `pointerdown, pointerup, pointerout, pointerleave, click`, so
 * clearing it on leave would let the trailing click step a second time. Only
 * the click itself (or a key press) consumes it. A press that never produces
 * a click leaves it set, which is harmless: keyboard and assistive-tech
 * clicks have `detail === 0` and always step, and the next press sets it anew.
 */
function RepeatButton({ onStep, label, className, children }: RepeatButtonProps) {
  const stepRef = useRef(onStep);
  stepRef.current = onStep;
  const delay = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const pressed = useRef(false);

  const stop = () => {
    if (delay.current !== null) clearTimeout(delay.current);
    if (repeat.current !== null) clearInterval(repeat.current);
    delay.current = null;
    repeat.current = null;
  };
  useEffect(() => stop, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stop();
    pressed.current = true;
    stepRef.current();
    delay.current = setTimeout(() => {
      delay.current = null;
      repeat.current = setInterval(() => stepRef.current(), HOLD_REPEAT_MS);
    }, HOLD_DELAY_MS);
  };

  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onBlur={stop}
      onKeyDown={() => {
        pressed.current = false;
      }}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        const fromPress = pressed.current && e.detail !== 0;
        pressed.current = false;
        if (!fromPress) stepRef.current();
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Metronome({
  settings,
  onSettingsChange,
  running,
  onStart,
  onStop,
  onClose,
  getBeatState,
  patterns = BUILTIN_PATTERNS,
  layout,
  message,
  subtitle,
  className = '',
}: MetronomeProps) {
  const autoWide = useWideLayout();
  const compact = layout ? layout === 'compact' : !autoWide;
  const full = settings.mode === 'full';
  const wideSimple = !compact && !full;
  const geom = wideSimple ? GEOM_WIDE_SIMPLE : GEOM_CARD;
  const { accents } = settings;
  const crowded = accents.length > 7;
  const gap = crowded ? 3 : 6;

  // Latest values for handlers and the frame loop, without re-subscribing.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const changeRef = useRef(onSettingsChange);
  changeRef.current = onSettingsChange;
  const beatStateRef = useRef(getBeatState);
  beatStateRef.current = getBeatState;
  const geomRef = useRef(geom);
  geomRef.current = geom;

  const update = (patch: Partial<MetronomeSettings>) => onSettingsChange({ ...settings, ...patch });

  // --- tempo ---------------------------------------------------------------
  // Tracks the tempo between renders so a fast auto-repeat never steps from a stale value.
  const bpmRef = useRef(settings.bpm);
  bpmRef.current = settings.bpm;
  const setBpm = (bpm: number) => {
    const next = clampBpm(bpm);
    if (next === bpmRef.current) return;
    bpmRef.current = next;
    changeRef.current({ ...settingsRef.current, bpm: next });
  };
  const tapsRef = useRef<number[]>([]);
  const onTap = () => {
    const result = tapTempo(tapsRef.current, performance.now());
    tapsRef.current = result.times;
    if (result.bpm !== null) setBpm(result.bpm);
  };

  // Screen readers: say the tempo once it stops changing, not on every step of
  // a hold-repeat. Empty until the first change, so nothing is read on mount.
  const [announcedBpm, setAnnouncedBpm] = useState<number | null>(null);
  const lastAnnouncedRef = useRef(settings.bpm);
  useEffect(() => {
    const bpm = settings.bpm;
    if (bpm === lastAnnouncedRef.current) return;
    const id = setTimeout(() => {
      lastAnnouncedRef.current = bpm;
      setAnnouncedBpm(bpm);
    }, BPM_ANNOUNCE_DELAY_MS);
    return () => clearTimeout(id);
  }, [settings.bpm]);
  const bpmLive = (
    <div className="metronome-bpm-live sr-only" role="status" aria-live="polite" aria-atomic="true">
      {announcedBpm === null ? '' : `${announcedBpm} beats per minute`}
    </div>
  );

  // --- presets overlay -----------------------------------------------------
  const [presetsOpen, setPresetsOpen] = useState(false);
  const presetsBtnRef = useRef<HTMLButtonElement | null>(null);
  const closePresets = () => {
    setPresetsOpen(false);
    presetsBtnRef.current?.focus();
  };

  // --- ball + lit tile -----------------------------------------------------
  const ballRef = useRef<HTMLDivElement | null>(null);
  const tileRefs = useRef<Array<HTMLDivElement | null>>([]);
  const litRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const paint = (state: BeatState | null) => {
      const pos = ballPosition(settingsRef.current.accents, geomRef.current, state);
      const ball = ballRef.current;
      if (ball) {
        ball.style.setProperty(BALL_F_VAR, fmtF(pos.f));
        ball.style.setProperty(BALL_TOP_VAR, fmtTop(pos.top));
      }
      const tile = pos.active < 0 ? null : (tileRefs.current[pos.active] ?? null);
      if (tile !== litRef.current) {
        litRef.current?.removeAttribute('data-active');
        tile?.setAttribute('data-active', 'true');
        litRef.current = tile;
      }
    };
    if (!running) {
      paint(null);
      return;
    }
    const reduced = prefersReducedMotion();
    let id = 0;
    const frame = () => {
      const state = beatStateRef.current();
      // Reduced motion: no flight, the ball just sits on the sounding beat.
      paint(state && reduced ? { beat: state.beat, phase: 0 } : state);
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(id);
      paint(null);
    };
  }, [running]);

  // --- pieces --------------------------------------------------------------
  const rest = ballPosition(accents, geom, null);
  const ballStyle = {
    width: geom.ball,
    height: geom.ball,
    marginLeft: -geom.ball / 2,
    left: `calc((100% + ${gap}px) * var(${BALL_F_VAR}) - ${gap / 2}px)`,
    top: `var(${BALL_TOP_VAR})`,
    [BALL_F_VAR]: fmtF(rest.f),
    [BALL_TOP_VAR]: fmtTop(rest.top),
  } as CSSProperties;

  const numeralSize = crowded ? 'text-[14px] [-webkit-text-stroke:2px_#141210]' : wideSimple ? 'text-[26px] [-webkit-text-stroke:3px_#141210]' : 'text-[20px] [-webkit-text-stroke:3px_#141210]';

  const beats = (
    <div
      className="metronome-beats relative flex items-end"
      style={{ height: geom.zone, gap }}
      // Simple: read-only tiles, exposed as a list so each one's emphasis is
      // announced. Full: the tiles are buttons that carry it themselves.
      role={full ? 'group' : 'list'}
      aria-label="Beats"
    >
      <div
        ref={ballRef}
        className="metronome-ball pointer-events-none absolute z-[5] box-border rounded-full border-2 border-[#141210] bg-[#fff56d]"
        style={ballStyle}
        aria-hidden="true"
      />
      {accents.map((lvl, i) => {
        const tile = (
          <div
            ref={(el) => {
              tileRefs.current[i] = el;
            }}
            className={`${TILE} ${LEVEL_TILE[lvl]} ${full ? 'w-full' : 'min-w-0 flex-1'}`}
            style={{ height: geom.heights[lvl] }}
            data-level={lvl}
            role={full ? undefined : 'listitem'}
            aria-label={full ? undefined : `Beat ${i + 1}, ${LEVEL_NAMES[lvl]}`}
          >
            <span className={`metronome-beat-num ${FONT_UI} ${numeralSize} font-semibold leading-none text-white [paint-order:stroke]`}>
              {i + 1}
            </span>
          </div>
        );
        if (!full) return <div key={i} className="metronome-beat contents">{tile}</div>;
        return (
          <button
            key={i}
            type="button"
            className={`metronome-beat ${BTN_CORE} flex min-w-0 flex-1 items-end bg-transparent`}
            style={{ height: geom.zone }}
            aria-label={`Beat ${i + 1}, ${LEVEL_NAMES[lvl]}. Tap to change`}
            onClick={() => onSettingsChange(cycleAccent(settings, i))}
          >
            {tile}
          </button>
        );
      })}
    </div>
  );

  const brand = (size: string) => (
    <div className={`metronome-brand ${FONT_DISPLAY} ${size} uppercase leading-none tracking-[-0.03em]`}>
      Metro<span className="metronome-brand-dot text-[#f86e6e]">·</span>nome
    </div>
  );

  const closeBtn = (width: string) =>
    onClose && (
    <button
      type="button"
      className={`metronome-btn-close ${SHADOW_BTN} ${PAPER_BTN} h-11 ${width} shrink-0`}
      aria-label="Close metronome"
      title="Close metronome"
      onClick={onClose}
    >
      <CloseIcon />
    </button>
    );

  const modeBtn = (width: string) =>
    full ? (
      <button
        type="button"
        className={`metronome-btn-mode metronome-btn-less ${SHADOW_BTN} ${PAPER_BTN} ${SMALL_MONO} h-11 ${width} shrink-0`}
        aria-label="Switch to simple mode"
        title="Simple mode"
        onClick={() => update({ mode: 'simple' })}
      >
        LESS
      </button>
    ) : (
      <button
        type="button"
        className={`metronome-btn-mode metronome-btn-more ${SHADOW_BTN} ${PAPER_BTN} ${SMALL_MONO} h-11 ${width} shrink-0`}
        aria-label="Switch to full mode"
        title="More options"
        onClick={() => update({ mode: 'full' })}
      >
        MORE
      </button>
    );

  const stepBtn = (dir: 1 | -1, extra: string) => (
    <RepeatButton
      onStep={() => setBpm(bpmRef.current + dir)}
      label={dir > 0 ? 'Faster' : 'Slower'}
      className={`${dir > 0 ? 'metronome-btn-faster' : 'metronome-btn-slower'} ${SHADOW_BTN} ${PAPER_BTN} ${FONT_UI} text-[22px] font-bold ${extra}`}
    >
      {dir > 0 ? '+' : '−'}
    </RepeatButton>
  );

  const tapBtn = (extra: string) => (
    <button
      type="button"
      className={`metronome-btn-tap ${SHADOW_BTN} ${FONT_MONO} bg-[#88a7f8] text-[13px] font-bold tracking-[0.04em] hover:bg-[#a3bbfa] ${extra}`}
      aria-label="Tap tempo"
      title="Tap tempo"
      onClick={onTap}
    >
      TAP
    </button>
  );

  const startBtn = (extra: string) => (
    <button
      type="button"
      className={`metronome-btn-start metronome-btn-shadow ${running ? 'metronome-btn-running bg-[#f86e6e]' : 'bg-[#6bc6a0]'} ${BTN} ${FONT_UI} border-[3px] border-[#141210] font-bold uppercase tracking-[0.08em] shadow-[5px_5px_0_#141210] transition-transform duration-75 active:translate-x-[2px] active:translate-y-[2px] ${extra}`}
      onClick={running ? onStop : onStart}
    >
      {running ? 'Stop' : 'Start'}
    </button>
  );

  const selectedSub = resolvePattern(patterns, settings.subdivision);
  const quickSubs = patterns.slice(0, QUICK_PATTERNS);
  /** The selected pattern is one only the Presets list can reach. */
  const presetOn = !quickSubs.some((p) => p.id === selectedSub.id);
  const subFillers = QUICK_PATTERNS - quickSubs.length;

  /** Always says "Presets", even when the button's visible text is the selected preset's label. */
  const presetsName = presetOn ? `Presets: ${selectedSub.label}` : 'Presets';

  const presetsCell = !full && (
    <button
      ref={presetsBtnRef}
      type="button"
      className={`metronome-btn-presets ${CELL} ${presetOn ? CELL_ON : CELL_OFF}`}
      aria-label={presetsName}
      title={presetOn ? `Presets: ${selectedSub.title}` : 'Rhythm presets'}
      aria-pressed={presetOn}
      aria-haspopup="dialog"
      onClick={() => setPresetsOpen(true)}
    >
      <ListIcon />
    </button>
  );

  const subGrid = (
    <div
      className={`metronome-subdivisions ${SEG_GRID} ${full ? 'grid-cols-5' : 'grid-cols-[repeat(5,minmax(0,1fr))_44px]'}`}
      role="group"
      aria-label="Subdivision"
    >
      {quickSubs.map((p) => {
        const on = p.id === selectedSub.id;
        return (
          <button
            key={p.id}
            type="button"
            className={`metronome-sub-btn metronome-sub-${p.id} ${CELL} ${on ? CELL_ON : CELL_OFF} ${
              full ? `${FONT_UI} text-[13px] font-bold` : `${FONT_MONO} text-[10px] font-bold uppercase tracking-[-0.02em]`
            }`}
            aria-pressed={on}
            onClick={() => update({ subdivision: p.id })}
          >
            {p.label}
          </button>
        );
      })}
      {Array.from({ length: subFillers }, (_, i) => (
        <div key={`filler-${i}`} className="metronome-sub-filler bg-[#fdfcf9]" aria-hidden="true" />
      ))}
      {presetsCell}
    </div>
  );

  const presetsBtn = full && (
    <button
      ref={presetsBtnRef}
      type="button"
      className={`metronome-btn-presets ${SHADOW_BTN} ${presetOn ? 'bg-[#fff56d]' : PAPER_BTN} ${SMALL_MONO} h-11 shrink-0 px-3 uppercase`}
      aria-label={presetsName}
      title={presetOn ? `Presets: ${selectedSub.title}` : 'Rhythm presets'}
      aria-pressed={presetOn}
      aria-haspopup="dialog"
      onClick={() => setPresetsOpen(true)}
    >
      {presetOn ? selectedSub.label : 'Presets'}
    </button>
  );

  const presetsOverlay = presetsOpen && (
    <PresetsOverlay
      patterns={patterns}
      selectedId={selectedSub.id}
      onSelect={(id) => {
        if (id !== settings.subdivision) update({ subdivision: id });
        closePresets();
      }}
      onClose={closePresets}
    />
  );

  const message_ = message ? (
    <div
      role="alert"
      className={`metronome-message ${FONT_UI} border-2 border-[#141210] bg-[#fff56d] px-2 py-1 text-[12px] font-semibold leading-snug`}
    >
      {message}
    </div>
  ) : null;

  const chassis = `${ROOT_CLASS} metronome-chassis ${full ? 'metronome-full' : 'metronome-simple'} box-border flex flex-col border-[3px] border-[#141210] bg-[#fdfcf9] text-[#141210] ${FONT_UI}`;

  // --- 760px Simple rectangle ---------------------------------------------
  if (wideSimple) {
    return (
      <div className={`${chassis} metronome-wide min-h-[204px] w-full max-w-[760px] ${className}`}>
        <div className="metronome-body box-border flex grow items-stretch gap-[18px] pb-4 pl-[14px] pr-[18px] pt-[14px]">
          <div className="metronome-tempo flex w-[280px] shrink-0 flex-col gap-[10px]">
            <div className="metronome-bpm-box box-border flex grow items-center justify-between border-[3px] border-[#141210] bg-white px-3 py-1 shadow-[5px_5px_0_#141210]">
              <div className={`metronome-bpm-value ${FONT_DISPLAY} text-[76px] leading-none tracking-[-0.04em]`}>{settings.bpm}</div>
              <div className={`metronome-bpm-meta ${FONT_MONO} flex flex-col items-end gap-2 uppercase`}>
                <div className="metronome-bpm-label text-[13px] font-bold leading-none tracking-[0.12em]">BPM</div>
                <div className="metronome-signature-chip whitespace-nowrap border-2 border-[#141210] bg-[#fff56d] px-2 py-1 text-[24px] font-bold leading-none">
                  {settings.signature}
                </div>
              </div>
            </div>
            {subGrid}
          </div>
          <div className="metronome-stage flex min-w-0 grow flex-col justify-between">
            <div className="metronome-stage-head flex items-baseline justify-between">
              {brand('text-[18px]')}
              <div className={`metronome-tempo-name ${FONT_MONO} text-[11px] uppercase leading-none tracking-[0.12em]`}>{tempoName(settings.bpm)}</div>
            </div>
            {beats}
          </div>
          <div className="metronome-controls flex w-[104px] shrink-0 flex-col gap-[10px]">
            <div className="metronome-steppers flex gap-[10px]">
              {stepBtn(-1, 'h-11 min-w-0 flex-1')}
              {stepBtn(1, 'h-11 min-w-0 flex-1')}
            </div>
            {tapBtn('h-11')}
            {startBtn('grow text-[15px]')}
          </div>
          <div className="metronome-side flex shrink-0 flex-col justify-between">
            {closeBtn('w-12')}
            {modeBtn('w-12')}
          </div>
        </div>
        {message_ && <div className="metronome-message-row px-[14px] pb-2">{message_}</div>}
        <Stripe className="h-2 border-t-2 border-[#141210]" />
        {bpmLive}
        {presetsOverlay}
      </div>
    );
  }

  // --- cards: wide Full (9:16) and both phone cards ------------------------
  const header = (
    <div className="metronome-header flex flex-col gap-[10px]">
      <div className="metronome-header-row flex items-center justify-between gap-2 pr-[3px]">
        <div className="metronome-title flex min-w-0 flex-col gap-1">
          {brand('text-[24px]')}
          {subtitle && (
            <div className={`metronome-subtitle ${FONT_MONO} text-[10px] uppercase leading-none tracking-[0.22em] text-[#5a5651]`}>{subtitle}</div>
          )}
        </div>
        <div className="metronome-header-actions flex shrink-0 gap-[10px]">
          {modeBtn('w-[52px]')}
          {closeBtn('w-11')}
        </div>
      </div>
      <Stripe className="h-[9px] border-2 border-[#141210]" />
    </div>
  );

  const bpmBox = (
    <div className="metronome-bpm-box box-border flex min-w-0 grow items-center justify-between gap-2 border-[3px] border-[#141210] bg-white px-[14px] py-2 shadow-[5px_5px_0_#141210]">
      <div className={`metronome-bpm-value ${FONT_DISPLAY} text-[72px] leading-none tracking-[-0.04em]`}>{settings.bpm}</div>
      <div className={`metronome-bpm-meta ${FONT_MONO} flex flex-col items-end gap-[6px] uppercase tracking-[0.12em]`}>
        <div className="metronome-bpm-label text-[14px] font-bold leading-none">BPM</div>
        <div className="metronome-tempo-name text-[11px] leading-none">{tempoName(settings.bpm)}</div>
        <div className="metronome-signature-chip whitespace-nowrap border-2 border-[#141210] bg-[#fff56d] px-[6px] py-[3px] text-[11px] leading-none">
          {settings.signature}
        </div>
      </div>
    </div>
  );

  const beatsSection = (
    <div className="metronome-beats-section flex flex-col gap-[6px]">
      {full && (
        <div className={`metronome-beats-head ${FONT_MONO} flex items-baseline justify-between text-[10px] uppercase leading-none tracking-[0.12em]`}>
          <span className="metronome-beats-label font-bold">Beats</span>
          <span className="metronome-beats-hint">Tap to change emphasis</span>
        </div>
      )}
      {beats}
    </div>
  );

  const fullOptions = full && (
    <>
      <div className="metronome-signature-section flex flex-col gap-[6px]">
        <div className={`metronome-section-label ${SECTION_LABEL}`}>Time signature</div>
        <div className={`metronome-signatures ${SEG_GRID} grid-cols-7`} role="group" aria-label="Time signature">
          {SIGNATURES.map((s) => {
            const on = s.id === settings.signature;
            return (
              <button
                key={s.id}
                type="button"
                className={`metronome-signature-btn ${CELL} ${on ? CELL_ON : CELL_OFF} ${FONT_UI} text-[14px] font-bold`}
                aria-pressed={on}
                onClick={() => {
                  if (!on) onSettingsChange(withSignature(settings, s.id));
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="metronome-subdivision-section flex flex-col gap-[6px]">
        <div className="metronome-section-head flex items-end justify-between gap-2 pr-[3px]">
          <div className={`metronome-section-label ${SECTION_LABEL}`}>Subdivision</div>
          {presetsBtn}
        </div>
        {subGrid}
      </div>
      <div className="metronome-sound-section flex flex-col gap-[6px]">
        <div className={`metronome-section-label ${SECTION_LABEL}`}>Sound</div>
        <div className="metronome-sounds grid grid-cols-3 gap-[10px] pr-[3px]" role="group" aria-label="Sound">
          {SOUNDS.map((s) => {
            const on = s.id === settings.sound;
            return (
              <button
                key={s.id}
                type="button"
                className={`metronome-sound-btn metronome-sound-${s.id} ${SHADOW_BTN} ${on ? 'bg-[#fff56d]' : PAPER_BTN} ${FONT_UI} h-11 min-w-0 text-[13px] font-bold`}
                aria-pressed={on}
                onClick={() => update({ sound: s.id })}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );

  if (compact) {
    return (
      <div className={`${chassis} metronome-compact w-full gap-3 p-[14px] ${className}`}>
        {header}
        <div className="metronome-tempo-row flex h-[96px] shrink-0 items-stretch pr-[5px]">{bpmBox}</div>
        <div className="metronome-controls flex shrink-0 items-stretch gap-[10px] pr-[5px]">
          {stepBtn(-1, `h-11 ${full ? 'min-w-0 flex-1' : 'w-12 shrink-0'}`)}
          {stepBtn(1, `h-11 ${full ? 'min-w-0 flex-1' : 'w-12 shrink-0'}`)}
          {tapBtn(`h-11 ${full ? 'min-w-0 flex-1' : 'w-14 shrink-0'}`)}
          {!full && startBtn('h-11 min-w-0 flex-1 text-[15px]')}
        </div>
        {message_}
        {beatsSection}
        {full ? fullOptions : subGrid}
        {full && <div className="metronome-start-row pb-[5px] pr-[5px] pt-1">{startBtn('h-14 w-full text-[17px]')}</div>}
        {bpmLive}
        {presetsOverlay}
      </div>
    );
  }

  return (
    <div className={`${chassis} metronome-wide min-h-[736px] w-full max-w-[414px] gap-3 p-[14px] ${className}`}>
      {header}
      <div className="metronome-tempo-row flex h-[100px] shrink-0 items-stretch gap-[10px] pr-[5px]">
        {bpmBox}
        <div className="metronome-steppers flex w-12 shrink-0 flex-col gap-[10px]">
          {stepBtn(1, 'flex-1')}
          {stepBtn(-1, 'flex-1')}
        </div>
        {tapBtn('w-14 shrink-0')}
      </div>
      {message_}
      {beatsSection}
      {fullOptions}
      <div className="metronome-start-row flex grow items-end pb-[5px] pr-[5px]">{startBtn('h-14 w-full text-[17px]')}</div>
      {bpmLive}
      {presetsOverlay}
    </div>
  );
}
