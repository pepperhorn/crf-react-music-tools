import type { TunerReading } from './reading';
import { formatCents } from './reading';
import type { MicStatus } from './useMicPitch';
import { FONT_LCD, FONT_UI } from '../shared/classes';

/** VT323 is the LCD face; the host loads it (see `fonts.css`), else a system monospace stands in. */
const LCD_FONT = FONT_LCD;
const AMBER = 'text-[#ffb43a]';
const DIM = 'text-[#c98a2a]';
const GLOW_BIG = '[text-shadow:0_0_14px_rgba(255,180,58,0.55)]';
const GLOW_MID = '[text-shadow:0_0_10px_rgba(255,180,58,0.45)]';

export interface LcdProps {
  reading: TunerReading;
  status: MicStatus;
  simple: boolean;
  compact: boolean;
  /** Recover a lost mic / interrupted sound; call from the click (a user gesture). */
  onRestart?: () => void;
}

export interface MicErrorText {
  title: string;
  body: string;
  /** A tap can fix it (show the Restart button). */
  recoverable: boolean;
}

/** Title + body for mic failure states (shared by both themes); null when the mic is fine. */
export function micErrorText(status: MicStatus): MicErrorText | null {
  if (status === 'denied')
    return {
      title: 'MIC BLOCKED',
      body: 'Microphone access is blocked. Allow it for this site in your browser settings, then reopen the tuner.',
      recoverable: false,
    };
  if (status === 'insecure')
    return { title: 'NEEDS HTTPS', body: 'The microphone only works over a secure (https) connection.', recoverable: false };
  if (status === 'unavailable') return { title: 'NO MIC', body: 'No microphone is available on this device.', recoverable: false };
  if (status === 'lost') return { title: 'MIC LOST', body: 'The microphone stopped — tap Restart to listen again.', recoverable: true };
  if (status === 'interrupted')
    return { title: 'INTERRUPTED', body: 'Sound was interrupted — tap Restart to resume.', recoverable: true };
  return null;
}

/** The 44px Restart button shown on a recoverable mic error. `look` carries the theme's classes. */
export function RestartButton({ onRestart, look }: { onRestart: () => void; look: string }) {
  return (
    <button
      type="button"
      className={`tuner-btn-restart inline-flex h-11 shrink-0 items-center justify-center px-4 ${look}`}
      aria-label="Restart the microphone"
      onClick={onRestart}
    >
      Restart
    </button>
  );
}

/** The phone LCD is narrow: 'SHARP ▼ TUNE DOWN' → 'SHARP ▼', 'FLAT ▲ TUNE UP' → 'FLAT ▲'. */
export function compactHint(hint: string): string {
  return hint.replace(/ TUNE (DOWN|UP)$/, '');
}

function Lamp({ compact }: { compact: boolean }) {
  return (
    <span
      className={`tuner-lamp inline-flex items-center rounded-full bg-[#12301a] ${compact ? 'gap-1.5' : 'gap-2 px-3 py-1'}`}
    >
      <span
        className={`tuner-lamp-dot rounded-full bg-[#58e06a] shadow-[0_0_10px_#58e06a] ${compact ? 'h-2 w-2' : 'h-3 w-3'}`}
        aria-hidden="true"
      />
      <span className={`tuner-lcd-hint ${LCD_FONT} tracking-[0.1em] text-[#7df08c] ${compact ? 'text-[18px] leading-none pr-1' : 'text-[24px] leading-none'}`}>
        IN TUNE
      </span>
    </span>
  );
}

export function Lcd({ reading, status, simple, compact, onRestart }: LcdProps) {
  const err = micErrorText(status);
  const shell = `tuner-lcd relative min-w-0 grow rounded-[10px] border-2 border-[#3a3026] bg-[#140e05] ${LCD_FONT} ${AMBER}`;

  if (err) {
    const restart = err.recoverable && onRestart;
    return (
      <div
        className={`${shell} tuner-lcd-error-state flex ${
          restart && compact ? 'flex-col items-start justify-between' : 'flex-col justify-center gap-1'
        } ${compact ? 'px-2.5 py-2' : 'px-[18px] py-3.5'}`}
      >
        <div
          className={`tuner-lcd-error leading-none ${GLOW_MID} ${
            compact ? (restart ? 'text-[28px]' : 'text-[34px]') : restart ? 'text-[44px]' : 'text-[56px]'
          }`}
        >
          {err.title}
        </div>
        <p
          role="alert"
          className={`tuner-lcd-error-body leading-tight ${DIM} ${compact ? 'text-[16px]' : 'text-[20px]'} ${
            // The phone LCD has room for the title and the button only; the explanation stays for screen readers.
            restart && compact ? 'sr-only' : ''
          }`}
        >
          {err.body}
        </p>
        {restart && (
          <RestartButton
            onRestart={onRestart}
            look={`self-start rounded-[14px] border-[1.5px] border-[#ffb43a] bg-[#2c2620] ${FONT_UI} text-sm font-semibold text-[#ffb43a] hover:bg-[#3a3128] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffb43a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#140e05] ${compact ? '' : 'mt-1'}`}
          />
        )}
      </div>
    );
  }

  const starting = status === 'starting';
  const note = reading.note ?? '–';
  const noteDim = reading.note === null ? 'opacity-50' : '';
  const centsText = reading.cents === null ? null : formatCents(reading.cents);
  const idleLine = starting ? 'STARTING MIC…' : reading.hint;

  if (compact) {
    const right = reading.hasSignal
      ? reading.written && reading.detail
        ? reading.detail.replace(/^CONCERT (\S+) · .*$/, 'CONCERT $1')
        : reading.detail?.replace(/ Hz$/, '') ?? ''
      : '';
    return (
      <div className={`${shell} tuner-lcd-compact flex flex-col justify-between rounded-[14px] px-2.5 py-2`}>
        <div className="tuner-lcd-top flex items-end justify-between gap-1">
          <div className="tuner-lcd-pitch flex items-end gap-0.5">
            <span className={`tuner-lcd-note text-[64px] leading-[0.8] ${GLOW_BIG} ${noteDim}`}>{note}</span>
            {reading.octave !== null && <span className="tuner-lcd-octave text-[26px] leading-none">{reading.octave}</span>}
          </div>
          {centsText && <span className={`tuner-lcd-cents text-[30px] leading-[0.9] ${GLOW_MID}`}>{centsText}</span>}
        </div>
        <div className={`tuner-lcd-bottom flex items-center justify-between gap-2 text-[18px] leading-none ${DIM}`}>
          {reading.hasSignal && reading.inTune ? (
            <Lamp compact />
          ) : (
            <span className="tuner-lcd-hint truncate">{reading.hasSignal ? compactHint(reading.hint) : idleLine}</span>
          )}
          {right && <span className="tuner-lcd-detail shrink-0">{right}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className={`${shell} tuner-lcd-wide flex items-center justify-between gap-3 px-[18px] py-3.5`}>
      <div className="tuner-lcd-left flex min-w-0 flex-col gap-2">
        <div className="tuner-lcd-pitch flex items-end gap-1">
          <span className={`tuner-lcd-note leading-[0.8] ${GLOW_BIG} ${noteDim} ${simple ? 'text-[136px]' : 'text-[128px]'}`}>{note}</span>
          {reading.octave !== null && <span className="tuner-lcd-octave text-[44px] leading-none">{reading.octave}</span>}
        </div>
        {reading.written && <span className={`tuner-lcd-written text-[20px] leading-none tracking-[0.06em] ${DIM}`}>{reading.written}</span>}
      </div>
      <div className="tuner-lcd-right flex min-w-0 flex-col items-end gap-2 text-right">
        {reading.hasSignal &&
          (reading.inTune ? (
            <Lamp compact={false} />
          ) : (
            <span className="tuner-hint-pill inline-flex items-center rounded-xl bg-[#2a1f0f] px-2.5 py-1">
              <span className="tuner-lcd-hint text-[20px] leading-none tracking-[0.1em]">{reading.hint}</span>
            </span>
          ))}
        {reading.hasSignal ? (
          <>
            {simple ? (
              centsText && <span className={`tuner-lcd-cents text-[22px] leading-none ${DIM}`}>{centsText}</span>
            ) : (
              <>
                {centsText && <span className={`tuner-lcd-cents text-[52px] leading-[0.9] ${GLOW_MID}`}>{centsText}</span>}
                {reading.detail && <span className={`tuner-lcd-detail text-[22px] leading-none ${DIM}`}>{reading.detail}</span>}
              </>
            )}
          </>
        ) : (
          <span className={`tuner-lcd-hint text-[22px] leading-none ${DIM}`}>{idleLine}</span>
        )}
      </div>
    </div>
  );
}
