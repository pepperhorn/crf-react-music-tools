/**
 * Presentational pieces of the "tiles" theme (neo-brutalist: paper, ink,
 * square corners, hard shadows, a spectrum stripe). Pure display — every
 * value comes in from Tuner, which owns the reading and the settings.
 *
 * Fonts: Archivo Black (note, cents, brand) and Space Mono (labels, Hz,
 * chips); the host loads both (see `fonts.css`), and system fonts stand in
 * when it does not.
 */
import type { TunerReading } from './reading';
import type { MicStatus } from './useMicPitch';
import { RestartButton, compactHint, micErrorText } from './Lcd';
import { TILES_SPECTRUM } from './blocks';
import { FONT_DISPLAY, FONT_MONO } from '../shared/classes';

export const TILES_DISPLAY = FONT_DISPLAY;
export const TILES_MONO = FONT_MONO;

export function TilesStripe() {
  return (
    <div className="tuner-stripe flex h-2 shrink-0 border-t-2 border-[#141210]" aria-hidden="true">
      {TILES_SPECTRUM.map((c) => (
        <div key={c} className="tuner-stripe-cell flex-1" style={{ background: c }} />
      ))}
    </div>
  );
}

export function TilesBrand({ label, compact }: { label: string; compact: boolean }) {
  const mark = (
    <span className={`tuner-brand ${TILES_DISPLAY} uppercase leading-none tracking-[-0.03em] ${compact ? 'text-[22px]' : 'text-[18px]'}`}>
      Tun<span className="tuner-brand-dot text-[#f86e6e]">·</span>er
    </span>
  );
  const sub = (
    <span
      className={`tuner-brand-label ${TILES_MONO} uppercase leading-tight ${compact ? 'text-[10px] tracking-[0.18em]' : 'text-[11px] tracking-[0.12em]'}`}
    >
      {label}
    </span>
  );
  return compact ? (
    <div className="tuner-brand-row flex min-w-0 flex-col gap-1">
      {mark}
      {sub}
    </div>
  ) : (
    <div className="tuner-brand-row flex items-baseline justify-between gap-2">
      {mark}
      {sub}
    </div>
  );
}

type ChipState = 'in' | 'sharp' | 'flat' | 'idle';

function chipState(reading: TunerReading): ChipState {
  if (!reading.hasSignal || reading.cents === null) return 'idle';
  if (reading.inTune) return 'in';
  return reading.cents > 0 ? 'sharp' : 'flat';
}

const CHIP_BG: Record<ChipState, string> = {
  in: 'bg-[#6bc6a0]',
  sharp: 'bg-[#f86e6e]',
  flat: 'bg-[#88a7f8]',
  idle: 'bg-white',
};

export function TilesChip({ reading, status, compact }: { reading: TunerReading; status: MicStatus; compact: boolean }) {
  const state = chipState(reading);
  const text =
    status === 'starting' && !reading.hasSignal
      ? 'STARTING MIC…'
      : (compact && state !== 'idle' ? compactHint(reading.hint) : reading.hint).toUpperCase();
  return (
    <div
      className={`tuner-chip tuner-chip-${state} inline-flex items-center gap-2 border-2 border-[#141210] px-2.5 py-1.5 ${CHIP_BG[state]} shadow-[3px_3px_0_#141210] ${TILES_MONO} font-bold uppercase leading-none tracking-[0.08em] ${
        compact ? 'text-[11px]' : 'text-[13px]'
      }`}
    >
      {state === 'in' && <span className="tuner-chip-dot h-2.5 w-2.5 shrink-0 rounded-full bg-[#141210]" aria-hidden="true" />}
      <span className="tuner-chip-text">{text}</span>
    </div>
  );
}

/** '+18', '−7' (true minus), '0'. */
function centsDigits(c: number): string {
  const r = Math.round(c);
  if (r === 0) return '0';
  return r > 0 ? `+${r}` : `−${-r}`;
}

export function TilesCents({ cents }: { cents: number | null }) {
  if (cents === null) return null;
  return (
    <div className={`tuner-cents ${TILES_DISPLAY} text-[34px] leading-none tracking-[-0.03em]`}>
      {centsDigits(cents)}
      <span className={`tuner-cents-unit ${TILES_MONO} text-[17px] font-bold`}>¢</span>
    </div>
  );
}

export interface TilesNoteCardProps {
  reading: TunerReading;
  compact: boolean;
  /** Small yellow badge for transposing winds, e.g. 'B♭ inst'. */
  badge?: string | null;
}

export function TilesNoteCard({ reading, compact, badge }: TilesNoteCardProps) {
  const inTune = reading.hasSignal && reading.inTune;
  const note = reading.note ?? '–';
  // 'CONCERT B♭3 · 233.5 Hz' → two lines; the phone card keeps only the first.
  const lines = reading.hasSignal && reading.detail ? reading.detail.split(' · ') : [];
  const hzLines = compact ? lines.slice(0, 1) : lines;
  return (
    <div
      className={`tuner-note-card ${inTune ? 'tuner-note-card-in-tune bg-[#6bc6a0]' : 'bg-white'} box-border flex items-center justify-between gap-2 border-[3px] border-[#141210] shadow-[5px_5px_0_#141210] ${
        compact ? 'min-w-0 shrink basis-[176px] px-2.5 py-1' : 'w-[230px] shrink-0 px-3 py-1'
      }`}
    >
      <div className="tuner-card-pitch flex items-end gap-0.5">
        <span
          className={`tuner-card-note ${TILES_DISPLAY} leading-none tracking-[-0.04em] ${compact ? 'text-[72px]' : 'text-[96px]'} ${
            reading.note === null ? 'opacity-40' : ''
          }`}
        >
          {note}
        </span>
        {reading.octave !== null && (
          <span className={`tuner-card-octave ${TILES_DISPLAY} leading-[1.35] ${compact ? 'text-[24px]' : 'text-[32px]'}`}>{reading.octave}</span>
        )}
      </div>
      <div
        className={`tuner-card-meta flex min-w-0 flex-col items-end gap-1.5 ${TILES_MONO} font-bold uppercase tracking-[0.08em]`}
      >
        {badge && !compact && (
          <span className="tuner-card-badge border-2 border-[#141210] bg-[#fff56d] px-1.5 py-[3px] text-[11px] leading-none">{badge}</span>
        )}
        {hzLines.length > 0 && (
          <span className={`tuner-card-hz text-right leading-[1.1] ${compact ? 'text-[10px]' : 'text-[12px]'}`}>
            {hzLines.map((l, i) => (
              <span key={i} className="tuner-card-hz-line block">
                {l}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

/** Mic failure in the tiles style: a red title card plus the explanation (and Restart, when a tap can fix it). */
export function TilesError({ status, compact, onRestart }: { status: MicStatus; compact: boolean; onRestart?: () => void }) {
  const err = micErrorText(status);
  if (!err) return null;
  const restart = err.recoverable && onRestart;
  const body = (
    <p
      role="alert"
      className={`tuner-error-body m-0 flex min-w-0 grow items-center border-2 border-[#141210] bg-white px-3 py-2 ${TILES_MONO} font-bold leading-snug ${
        compact ? 'text-[11px]' : 'text-[12px]'
      }`}
    >
      {err.body}
    </p>
  );
  return (
    <div className={`tuner-error-state flex min-w-0 grow gap-3 ${compact ? 'flex-col' : 'items-stretch'}`}>
      <div
        className={`tuner-error-card box-border flex items-center border-[3px] border-[#141210] bg-[#f86e6e] px-3 py-2 shadow-[5px_5px_0_#141210] ${
          compact ? '' : 'w-[230px] shrink-0'
        }`}
      >
        <span className={`tuner-error-title ${TILES_DISPLAY} leading-[0.95] tracking-[-0.03em] ${compact ? 'text-[30px]' : 'text-[34px]'}`}>
          {err.title}
        </span>
      </div>
      {restart ? (
        <div className={`tuner-error-actions flex min-w-0 grow gap-3 ${compact ? 'items-stretch pr-[3px]' : 'flex-col pb-[3px]'}`}>
          {body}
          <RestartButton
            onRestart={onRestart}
            look={`rounded-none border-2 border-[#141210] bg-[#fff56d] text-[#141210] ${TILES_MONO} text-[13px] font-bold shadow-[3px_3px_0_#141210] transition-transform duration-75 hover:bg-[#fff98f] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#88a7f8] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fdfcf9] ${compact ? '' : 'self-start'}`}
          />
        </div>
      ) : (
        body
      )}
    </div>
  );
}
