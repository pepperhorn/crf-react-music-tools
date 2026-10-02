/**
 * Self-contained chromatic / instrument tuner.
 *
 * No host-app imports: settings come in as props and every change goes out
 * through `onSettingsChange`, so the host decides how (and whether) to persist
 * them. Mounting starts the microphone (see useMicPitch); unmounting releases
 * it. For iOS, create the AudioContext with `createTunerAudioContext()`
 * synchronously in the click that opens the tuner and pass it as
 * `audioContext` — the tuner then owns and closes it.
 *
 * Layout: wide horizontal panel at ≥640px, compact phone card below
 * (override with `layout`).
 *
 * Themes (`settings.theme`): 'vintage' (brass chassis, VU needle, amber LCD)
 * and 'tiles' (neo-brutalist note card + 8-bit block meter). Only the
 * presentation forks: the reading, the mic hook and every control's
 * behaviour are shared; the controls are rendered once with a theme-specific
 * class set. Switching theme is just a settings change, so the mic keeps
 * running. Fonts the host loads (see `fonts.css`): Poppins (UI), VT323
 * (vintage LCD), Archivo Black + Space Mono (tiles); system fonts stand in
 * when it does not.
 */
import { useEffect, useState } from 'react';
import {
  A4_MAX,
  A4_MIN,
  INSTRUMENTS,
  RESPONSE_PROFILES,
  STRINGS_VARIANTS,
  TUNER_RESPONSES,
  WIND_KEYS,
  WIND_KEY_ORDER,
  clampA4,
  getStrings,
  minFreqFor,
  noteLabel,
  responseProfile,
  type InstrumentId,
  type TunerSettings,
} from './pitch';
import { computeReading } from './reading';
import { useMicPitch } from './useMicPitch';
import { VuMeter } from './VuMeter';
import { Lcd, micErrorText } from './Lcd';
import { BlockMeter } from './BlockMeter';
import { FONT_LCD, FONT_MONO, FONT_UI, ROOT_CLASS } from '../shared/classes';
import { TilesBrand, TilesChip, TilesCents, TilesError, TilesNoteCard, TilesStripe } from './Tiles';

export type TunerLayout = 'wide' | 'compact';

export interface TunerProps {
  settings: TunerSettings;
  onSettingsChange: (next: TunerSettings) => void;
  /** Called by the close (×) button. Omit it and the button is not rendered. */
  onClose?: () => void;
  /** AudioContext created+resumed inside the opening click (iOS). Ownership transfers to the tuner. */
  audioContext?: AudioContext | null;
  /** Force a layout; by default it follows (min-width: 640px). */
  layout?: TunerLayout;
  className?: string;
}

const WIDE_QUERY = '(min-width: 640px)';

function useWideLayout(): boolean {
  const [wide, setWide] = useState(() => {
    try {
      return typeof window !== 'undefined' && !!window.matchMedia?.(WIDE_QUERY).matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
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

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffb43a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1d1a16]';
const BTN = `inline-flex h-11 items-center justify-center rounded-[14px] border-[1.5px] border-[#4a3f33] bg-[#2c2620] text-[#f3e7c6] transition-colors hover:bg-[#3a3128] ${FOCUS}`;
const BTN_SELECTED = 'border-[#c9b489] bg-[#8c7a5b] text-[#140e05] font-semibold hover:bg-[#9a8866]';
const SEG_OPT = `inline-flex h-11 items-center justify-center rounded-[14px] px-3 text-xs ${FOCUS}`;
const SEG_ON = 'bg-[#f3e7c6] text-[#140e05] font-semibold';
const SEG_OFF = 'bg-transparent text-[#d7c9aa] hover:bg-[#3a3128]';
const LCD_FONT = FONT_LCD;

// "tiles": paper + ink, square corners, hard shadows that press in on tap.
const T_FOCUS = 'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#88a7f8] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fdfcf9]';
const T_BTN = `inline-flex h-11 items-center justify-center rounded-none border-2 border-[#141210] bg-[#fdfcf9] p-0 text-[#141210] shadow-[3px_3px_0_#141210] transition-transform duration-75 hover:bg-white active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${T_FOCUS}`;
/** Segmented group: buttons butt together over an ink background, so 2px ink lines separate them. */
const T_SEG_GROUP = 'grid gap-[2px] border-2 border-[#141210] bg-[#141210]';
const T_SEG_OPT = `inline-flex h-11 min-w-0 items-center justify-center rounded-none border-0 px-1 text-[#141210] font-bold leading-tight ${T_FOCUS} focus-visible:ring-offset-0 focus-visible:relative`;
const T_SEG_ON = 'bg-[#fff56d]';
const T_SEG_OFF = 'bg-[#fdfcf9] hover:bg-white';
/** Open-string tiles cycle through the spectrum (low string first). */
const T_STRING_COLORS = ['#88a7f8', '#6bc6a0', '#fff56d', '#f86e6e', '#cc97e8', '#f58841'];
const T_GLOW = 'shadow-[0_0_0_3px_#141210,0_0_14px_4px_rgba(255,245,109,0.95)]';

function instrumentLabel(id: InstrumentId, label: string): string {
  return id === 'winds' ? 'Winds / Brass' : label;
}

/** The tiles brand-row caption: 'Chromatic · A440', 'Violin · A440', 'Written · B♭', … */
function tilesLabel(settings: TunerSettings): string {
  const a = `A${settings.a4}`;
  if (settings.mode !== 'full') return `Chromatic · ${a}`;
  switch (settings.instrument) {
    case 'strings':
      return `${STRINGS_VARIANTS.find((v) => v.id === settings.stringsVariant)?.label ?? 'Strings'} · ${a}`;
    case 'winds': {
      const key = WIND_KEYS[settings.windKey];
      return key.semitones === 0 ? `Concert · ${a}` : `Written · ${key.label}`;
    }
    case 'voice':
      return 'Voice · sing a steady note';
    default:
      return `${INSTRUMENTS.find((i) => i.id === settings.instrument)?.label ?? 'Chromatic'} · ${a}`;
  }
}

function CloseIcon({ size, square = false }: { size: number; square?: boolean }) {
  return (
    <svg
      className="tuner-icon-close"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={square ? 2.5 : 2}
      strokeLinecap={square ? 'square' : 'round'}
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** Two overlapping squares: "change the look". */
function ThemeIcon({ size }: { size: number }) {
  return (
    <svg className="tuner-icon-theme" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="12" height="12" />
      <rect x="9" y="9" width="12" height="12" fill="currentColor" fillOpacity="0.35" />
    </svg>
  );
}

export function Tuner({ settings, onSettingsChange, onClose, audioContext, layout, className = '' }: TunerProps) {
  const autoWide = useWideLayout();
  const compact = layout ? layout === 'compact' : !autoWide;
  const profile = responseProfile(settings.response);
  const { status, freq, restart } = useMicPitch(audioContext, {
    minFreq: minFreqFor(settings),
    detectIntervalMs: profile.detectIntervalMs,
    smoothing: profile,
  });
  const full = settings.mode === 'full';
  const tiles = settings.theme === 'tiles';

  const lockKey = `${settings.instrument}:${settings.stringsVariant}`;
  const [lock, setLock] = useState<{ key: string; index: number } | null>(null);
  const lockedIndex = full && lock?.key === lockKey ? lock.index : null;

  const strings = full ? getStrings(settings.instrument, settings.stringsVariant) : null;
  const reading = computeReading(status === 'listening' ? freq : null, settings, lockedIndex);

  const update = (patch: Partial<TunerSettings>) => onSettingsChange({ ...settings, ...patch });
  const setA4 = (delta: number) => update({ a4: clampA4(settings.a4 + delta) });

  // ---- Controls: rendered once, styled per theme -------------------------

  const closeBtn = onClose && (
    <button
      type="button"
      className={`tuner-btn-close ${tiles ? `${T_BTN} ${compact ? 'w-11' : 'w-12'}` : `${BTN} w-11 rounded-full p-0`} shrink-0`}
      aria-label="Close tuner"
      title="Close tuner"
      onClick={onClose}
    >
      <CloseIcon size={compact && !tiles ? 18 : 20} square={tiles} />
    </button>
  );

  const nextTheme = tiles ? 'vintage' : 'tiles';
  const themeBtn = (
    <button
      type="button"
      className={`tuner-btn-theme tuner-btn-theme-to-${nextTheme} ${tiles ? `${T_BTN} ${compact ? 'w-11' : 'w-12'}` : `${BTN} w-11 p-0 text-[#d7c9aa]`} shrink-0`}
      aria-label={`Switch to ${nextTheme} look`}
      title={`Switch to ${nextTheme} look`}
      onClick={() => update({ theme: nextTheme })}
    >
      <ThemeIcon size={compact && !tiles ? 18 : 20} />
    </button>
  );

  const modeStyle = tiles
    ? `${T_BTN} w-12 ${FONT_MONO} text-[11px] font-bold tracking-[0.04em]`
    : `${BTN} w-11 p-0 text-[10px] font-semibold tracking-[0.06em]`;
  const modeBtn = full ? (
    <button
      type="button"
      className={`tuner-btn-mode tuner-btn-less ${modeStyle} shrink-0 ${tiles ? '' : 'text-[#d7c9aa]'}`}
      aria-label="Switch to simple mode"
      title="Simple mode"
      onClick={() => update({ mode: 'simple' })}
    >
      LESS
    </button>
  ) : (
    <button
      type="button"
      className={`tuner-btn-mode tuner-btn-more ${modeStyle} shrink-0 ${tiles ? '' : 'border-[#8c7a5b]'}`}
      aria-label="Switch to full mode"
      title="More options"
      onClick={() => update({ mode: 'full' })}
    >
      MORE
    </button>
  );

  const instrumentRow = full && (
    <div
      className={`tuner-instruments grid ${tiles ? T_SEG_GROUP : 'gap-1.5'} ${compact ? 'grid-cols-3' : 'grid-cols-6'}`}
      role="group"
      aria-label="Instrument"
    >
      {INSTRUMENTS.map((inst) => {
        const on = settings.instrument === inst.id;
        const look = tiles
          ? `${T_SEG_OPT} text-[13px] ${on ? T_SEG_ON : T_SEG_OFF}`
          : `${BTN} px-1 ${compact && inst.id === 'winds' ? 'text-xs' : 'text-[13px]'} font-medium ${on ? BTN_SELECTED : ''}`;
        return (
          <button
            key={inst.id}
            type="button"
            className={`tuner-instrument-btn tuner-instrument-${inst.id} ${look}`}
            aria-pressed={on}
            onClick={() => update({ instrument: inst.id })}
          >
            {instrumentLabel(inst.id, inst.label)}
          </button>
        );
      })}
    </div>
  );

  const segGroup = (layoutCls: string) =>
    tiles ? `${T_SEG_GROUP} ${layoutCls}` : `gap-1 rounded-[10px] bg-[#2c2620] p-[3px] ${layoutCls}`;
  const segBtn = (on: boolean, extra: string) =>
    tiles ? `${T_SEG_OPT} text-[12px] ${on ? T_SEG_ON : T_SEG_OFF}` : `${SEG_OPT} ${extra} ${on ? SEG_ON : SEG_OFF}`;

  const variantSelect = full && settings.instrument === 'strings' && (
    <div
      className={`tuner-strings-variants ${segGroup(
        tiles ? (compact ? 'grid-cols-4' : 'w-[286px] shrink-0 grid-cols-4') : compact ? 'grid grid-cols-4' : 'flex',
      )}`}
      role="group"
      aria-label="Strings instrument"
    >
      {STRINGS_VARIANTS.map((v) => {
        const on = settings.stringsVariant === v.id;
        return (
          <button
            key={v.id}
            type="button"
            className={`tuner-seg-btn tuner-variant-${v.id} ${segBtn(on, compact ? 'px-1 text-[11px] leading-tight' : '')}`}
            aria-pressed={on}
            onClick={() => update({ stringsVariant: v.id })}
          >
            {tiles ? (v.short ?? v.label) : v.label}
          </button>
        );
      })}
    </div>
  );

  const keySelect = full && settings.instrument === 'winds' && (
    <div
      className={`tuner-wind-keys flex items-center ${tiles ? 'gap-3' : 'gap-2'} ${
        // Wide tiles: the keys take the whole row, so Response + A4 wrap below instead of squeezing
        // the labels. No fixed min-width: beside the sidebar the panel can be under 500px wide.
        compact ? 'w-full' : tiles ? 'w-full min-w-0' : 'min-w-0'
      }`}
    >
      <span
        className={`tuner-key-label text-[11px] tracking-[0.14em] ${
          tiles ? `${FONT_MONO} font-bold text-[#141210]` : 'text-[#b3a386]'
        }`}
      >
        KEY
      </span>
      <div
        className={`tuner-wind-key-options ${segGroup(
          tiles ? `grow ${compact ? 'grid-cols-2' : 'grid-cols-4'}` : compact ? 'grid grow grid-cols-2' : 'flex',
        )}`}
        role="group"
        aria-label="Instrument key"
      >
        {WIND_KEY_ORDER.map((k) => {
          const info = WIND_KEYS[k];
          const on = settings.windKey === k;
          return (
            <button
              key={k}
              type="button"
              className={`tuner-seg-btn tuner-key-${k} ${segBtn(on, compact ? 'px-1.5' : '')}`}
              aria-pressed={on}
              onClick={() => update({ windKey: k })}
            >
              {info.label} · {tiles ? info.short : info.instruments}
            </button>
          );
        })}
      </div>
    </div>
  );

  // Tiles shows the voice prompt in its brand caption instead.
  const voiceNote = !tiles && full && settings.instrument === 'voice' && (
    <span className="tuner-voice-note text-xs text-[#d7c9aa]">Chromatic · sing a steady note</span>
  );

  const stringButtons = strings && (
    <div
      className={`tuner-strings ${
        // Phone tiles: one row of equal tiles that shrink to fit, so six guitar strings never wrap.
        tiles ? (compact ? 'grid auto-cols-fr grid-flow-col gap-2 pr-[3px]' : 'flex flex-wrap gap-2') : 'flex flex-wrap gap-1'
      }`}
      role="group"
      aria-label="Strings — tap to lock the target"
    >
      {strings.map((midi, i) => {
        const label = noteLabel(midi);
        const locked = lockedIndex === i;
        const target = !locked && reading.targetIndex === i;
        const state = locked ? 'tuner-string-locked' : target ? 'tuner-string-target' : '';
        const look = tiles
          ? `${compact ? 'w-full min-w-0' : 'w-12 shrink-0'} rounded-none border-2 border-[#141210] p-0 text-[#141210] ${FONT_MONO} text-[15px] font-bold ${T_FOCUS} ${
              locked ? `${T_GLOW} translate-x-[2px] translate-y-[2px]` : target ? T_GLOW : 'shadow-[3px_3px_0_#141210]'
            }`
          : `min-w-11 rounded-[14px] border-[1.5px] px-1 ${LCD_FONT} text-[22px] leading-none ${FOCUS} ${
              locked
                ? 'border-[#ffb43a] bg-[#ffb43a] text-[#140e05]'
                : target
                  ? 'border-[#ffb43a] bg-[#2c2620] text-[#ffb43a]'
                  : 'border-[#4a3f33] bg-[#2c2620] text-[#f3e7c6] hover:bg-[#3a3128]'
            }`;
        return (
          <button
            key={`${midi}-${i}`}
            type="button"
            className={`tuner-string-btn ${state} inline-flex h-11 items-center justify-center ${look}`}
            style={tiles ? { background: T_STRING_COLORS[i % T_STRING_COLORS.length] } : undefined}
            aria-label={`Lock to ${label} string`}
            aria-pressed={locked}
            onClick={() => setLock(locked ? null : { key: lockKey, index: i })}
          >
            {label}
          </button>
        );
      })}
    </div>
  );

  // How steady the readout is: see RESPONSE_PROFILES. Wide: beside A4; phone: its own row.
  // Six string buttons leave no room for the caption on the wide options row
  // (it would push the row onto a second line), so guitar relies on the group's name and tooltip.
  const responseCaption = compact || !strings || strings.length <= 4;
  const responseSelect = full && (
    <div className={`tuner-response flex items-center ${tiles ? 'gap-3' : 'gap-2'} ${compact ? 'w-full' : 'shrink-0'}`}>
      {responseCaption && (
        <span
          className={`tuner-response-label text-[11px] tracking-[0.14em] ${
            tiles ? `${FONT_MONO} font-bold text-[#141210]` : 'text-[#b3a386]'
          }`}
          aria-hidden="true"
        >
          RESPONSE
        </span>
      )}
      <div
        className={`tuner-response-options ${segGroup(
          // Wide: the group's own padding / border is pulled back so the options row stays 44px tall.
          tiles
            ? compact
              ? 'grow grid-cols-3'
              : '-my-[2px] w-[186px] shrink-0 grid-cols-3'
            : compact
              ? 'grid grow grid-cols-3'
              : '-my-[3px] flex',
        )}`}
        role="group"
        aria-label="Response"
        title="Response: how quickly the meter follows the sound"
      >
        {TUNER_RESPONSES.map((r) => {
          const on = settings.response === r;
          return (
            <button
              key={r}
              type="button"
              className={`tuner-seg-btn tuner-response-${r} ${segBtn(on, '')}`}
              aria-pressed={on}
              onClick={() => update({ response: r })}
            >
              {RESPONSE_PROFILES[r].label}
            </button>
          );
        })}
      </div>
    </div>
  );

  const a4Btn = tiles ? `${T_BTN} w-11 text-xl` : `${BTN} w-11 p-0 text-lg`;
  const a4Control = full && (
    <div className={`tuner-a4 flex shrink-0 items-center ${tiles ? 'gap-2' : 'gap-1.5'}`}>
      <button
        type="button"
        className={`tuner-btn-a4-down ${a4Btn}`}
        aria-label="Lower reference pitch"
        title={`Lower A4 (min ${A4_MIN} Hz)`}
        onClick={() => setA4(-1)}
      >
        −
      </button>
      {tiles ? (
        <span className={`tuner-a4-display box-border flex h-11 items-center gap-1.5 border-2 border-[#141210] bg-white px-2.5 ${FONT_MONO} font-bold`}>
          <span className="tuner-a4-label text-[10px] tracking-[0.1em]">A4</span>
          <span className="tuner-a4-value text-[18px]" aria-live="polite">
            {settings.a4}
          </span>
        </span>
      ) : (
        <span className={`tuner-a4-value ${LCD_FONT} text-[#ffb43a] ${compact ? 'text-[20px]' : 'text-[22px]'}`} aria-live="polite">
          {compact ? `${settings.a4}` : `A4 ${settings.a4}`}
        </span>
      )}
      <button
        type="button"
        className={`tuner-btn-a4-up ${a4Btn}`}
        aria-label="Raise reference pitch"
        title={`Raise A4 (max ${A4_MAX} Hz)`}
        onClick={() => setA4(1)}
      >
        +
      </button>
    </div>
  );

  // ---- Tiles presentation ----------------------------------------------

  if (tiles) {
    const chassis = `${ROOT_CLASS} tuner-chassis tuner-theme-tiles flex flex-col rounded-none border-[3px] border-[#141210] bg-[#fdfcf9] text-[#141210] ${FONT_UI}`;
    const failed = micErrorText(status) !== null;
    const windKey = WIND_KEYS[settings.windKey];
    const badge = full && settings.instrument === 'winds' && windKey.semitones !== 0 ? `${windKey.label} inst` : null;
    const label = tilesLabel(settings);
    const card = <TilesNoteCard reading={reading} compact={compact} badge={badge} />;
    const chip = <TilesChip reading={reading} status={status} compact={compact} />;
    const cents = <TilesCents cents={reading.cents} />;
    const blocks = <BlockMeter cents={reading.cents} compact={compact} />;

    if (compact) {
      return (
        <div className={`${chassis} tuner-compact shadow-[6px_6px_0_#141210] ${className}`}>
          <div className="tuner-body flex flex-col gap-3 px-3 pb-3.5 pt-3">
            <div className="tuner-header flex items-center justify-between gap-2">
              <TilesBrand label={label} compact />
              <div className="tuner-header-controls flex shrink-0 gap-2.5 pr-[3px]">
                {themeBtn}
                {modeBtn}
                {closeBtn}
              </div>
            </div>
            {failed ? (
              <TilesError status={status} compact onRestart={restart} />
            ) : (
              <>
                <div className="tuner-top flex items-stretch gap-3 pr-[5px]">
                  {card}
                  <div className="tuner-readout flex shrink-0 flex-col items-end justify-between pb-[5px] pt-0.5">
                    {cents}
                    <div className="tuner-chip-slot mt-auto">{chip}</div>
                  </div>
                </div>
                {blocks}
              </>
            )}
            {instrumentRow}
            {variantSelect}
            {keySelect}
            {stringButtons}
            {full && <div className="tuner-response-row flex">{responseSelect}</div>}
            {full && <div className="tuner-footer flex justify-end pr-[3px]">{a4Control}</div>}
          </div>
          <TilesStripe />
        </div>
      );
    }

    return (
      <div className={`${chassis} tuner-wide ${className}`}>
        <div className="tuner-body flex flex-col justify-center gap-3.5 px-3.5 pb-4 pt-3.5">
          <div className="tuner-top flex h-[164px] shrink-0 items-stretch gap-[18px]">
            {failed ? (
              <TilesError status={status} compact={false} onRestart={restart} />
            ) : (
              <>
                {card}
                <div className="tuner-readout flex min-w-0 grow flex-col justify-between">
                  <TilesBrand label={label} compact={false} />
                  {blocks}
                  <div className="tuner-readout-foot flex items-center justify-between gap-2">
                    {chip}
                    {cents}
                  </div>
                </div>
              </>
            )}
            <div className="tuner-side flex shrink-0 flex-col justify-between pr-[3px]">
              {closeBtn}
              {themeBtn}
              {modeBtn}
            </div>
          </div>
          {instrumentRow}
          {full && (
            <div className="tuner-options flex flex-wrap items-center gap-3">
              {variantSelect}
              {stringButtons}
              {keySelect}
              <div className="tuner-options-end ml-auto flex flex-wrap items-center justify-end gap-3 pr-[3px]">
                {responseSelect}
                {a4Control}
              </div>
            </div>
          )}
        </div>
        <TilesStripe />
      </div>
    );
  }

  // ---- Vintage presentation --------------------------------------------

  const meter = (
    <div
      className={`tuner-meter flex shrink-0 items-end overflow-hidden bg-[#f3e7c6] ${
        compact ? 'w-[150px] rounded-[14px] shadow-[inset_0_2px_8px_rgba(0,0,0,0.35)]' : 'w-[290px] rounded-[10px] shadow-[inset_0_2px_10px_rgba(0,0,0,0.35)]'
      }`}
    >
      <VuMeter cents={reading.cents} compact={compact} omega={profile.needleOmega} />
    </div>
  );

  const lcd = <Lcd reading={reading} status={status} simple={!full} compact={compact} onRestart={restart} />;

  const chassis = `${ROOT_CLASS} tuner-chassis tuner-theme-vintage flex flex-col border-[1.5px] border-[#8c7a5b] bg-[#1d1a16] text-[#f3e7c6] ${FONT_UI} rounded-2xl`;

  if (compact) {
    return (
      <div className={`${chassis} tuner-compact gap-2.5 p-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.45)] ${className}`}>
        <div className="tuner-display flex h-[104px] gap-2">
          {meter}
          {lcd}
        </div>
        {instrumentRow}
        {variantSelect}
        {keySelect}
        {stringButtons}
        {full && <div className="tuner-response-row flex">{responseSelect}</div>}
        <div className="tuner-footer flex items-center justify-between gap-2">
          <div className="tuner-footer-label min-w-0">{voiceNote}</div>
          <div className="tuner-footer-controls flex items-center gap-1">
            {a4Control}
            {themeBtn}
            {modeBtn}
            {closeBtn}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${chassis} tuner-wide gap-3 p-3.5 shadow-[0_12px_32px_rgba(0,0,0,0.35)] ${className}`}>
      <div className="tuner-display flex h-[176px] gap-3">
        {meter}
        {lcd}
        <div className="tuner-side flex shrink-0 flex-col items-center justify-between">
          {closeBtn}
          {themeBtn}
          {modeBtn}
        </div>
      </div>
      {instrumentRow}
      {full && (
        <div className="tuner-options flex flex-wrap items-center gap-2">
          {variantSelect}
          {keySelect}
          {voiceNote}
          {stringButtons}
          <div className="tuner-options-end ml-auto flex flex-wrap items-center justify-end gap-2">
            {responseSelect}
            {a4Control}
          </div>
        </div>
      )}
    </div>
  );
}
