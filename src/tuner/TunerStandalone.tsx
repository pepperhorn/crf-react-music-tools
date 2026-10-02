/**
 * Drop-in tuner: the view, the microphone and per-device settings in one
 * component.
 *
 *   import { TunerStandalone } from 'crf-react-music-tools';
 *   import 'crf-react-music-tools/styles.css';
 *
 *   <TunerStandalone />
 *
 * The microphone is never requested on mount. The component first shows a
 * "Start tuner" button; the AudioContext is created and resumed inside that
 * click (iOS / Safari only allow audio to start from a user gesture) and only
 * then is <Tuner> mounted, which asks for the mic. The tuner's close (×)
 * button — or unmounting the component — stops the track, closes the context
 * and returns to the Start button.
 */
import { useState } from 'react';
import { Tuner, type TunerLayout } from './Tuner';
import { createTunerAudioContext } from './useMicPitch';
import { DEFAULT_TUNER_SETTINGS, parseTunerSettings, type TunerSettings } from './pitch';
import { TilesStripe } from './Tiles';
import { usePersistentSettings } from '../shared/usePersistentSettings';
import { FONT_DISPLAY, FONT_LCD, FONT_MONO, FONT_UI, ROOT_CLASS } from '../shared/classes';

/** Default localStorage key for the tuner's settings. */
export const TUNER_STORAGE_KEY = 'crf-music-tools-tuner';

export interface TunerStandaloneProps {
  /** localStorage key for the settings. Default 'crf-music-tools-tuner'; `null` keeps them in memory only. */
  storageKey?: string | null;
  /** Settings used until a stored value is found. */
  defaultSettings?: TunerSettings;
  /** Called with every settings change. */
  onSettingsChange?: (next: TunerSettings) => void;
  /** Called when listening starts (inside the Start click). */
  onStart?: () => void;
  /** Called after the tuner's close button has released the microphone. */
  onClose?: () => void;
  /** Force a layout; by default it follows (min-width: 640px). */
  layout?: TunerLayout;
  /** Text of the start button. */
  startLabel?: string;
  className?: string;
}

const NOTE = 'Uses your microphone. Sound stays on this device.';

export function TunerStandalone({
  storageKey = TUNER_STORAGE_KEY,
  defaultSettings = DEFAULT_TUNER_SETTINGS,
  onSettingsChange,
  onStart,
  onClose,
  layout,
  startLabel = 'Start tuner',
  className = '',
}: TunerStandaloneProps) {
  const [settings, setSettings] = usePersistentSettings<TunerSettings>(storageKey, parseTunerSettings, defaultSettings);
  // The context made in the Start click; <Tuner> owns (and closes) it.
  const [session, setSession] = useState<{ ctx: AudioContext | null } | null>(null);

  const change = (next: TunerSettings) => {
    setSettings(next);
    onSettingsChange?.(next);
  };
  // Must stay synchronous in the gesture for iOS.
  const start = () => {
    setSession({ ctx: createTunerAudioContext() });
    onStart?.();
  };
  // Unmounting <Tuner> stops the track and closes the context.
  const stop = () => {
    setSession(null);
    onClose?.();
  };

  const width = 'w-full max-w-[760px]';

  if (session) {
    return (
      <Tuner
        settings={settings}
        onSettingsChange={change}
        onClose={stop}
        audioContext={session.ctx}
        layout={layout}
        className={`tuner-standalone ${width} ${className}`}
      />
    );
  }

  if (settings.theme === 'tiles') {
    return (
      <div
        className={`${ROOT_CLASS} tuner-standalone tuner-gate tuner-theme-tiles flex flex-col border-[3px] border-[#141210] bg-[#fdfcf9] text-[#141210] ${FONT_UI} ${width} ${className}`}
      >
        <div className="tuner-gate-body flex flex-col gap-3 px-3.5 pb-4 pt-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="tuner-gate-text flex min-w-0 flex-col gap-1.5">
            <span className={`tuner-brand ${FONT_DISPLAY} text-[22px] uppercase leading-none tracking-[-0.03em]`}>
              Tun<span className="tuner-brand-dot text-[#f86e6e]">·</span>er
            </span>
            <span className={`tuner-gate-note ${FONT_MONO} text-[11px] leading-snug tracking-[0.04em]`}>{NOTE}</span>
          </div>
          <div className="tuner-gate-action pb-[5px] pr-[5px]">
            <button
              type="button"
              className={`tuner-btn-start inline-flex h-14 w-full cursor-pointer select-none items-center justify-center rounded-none border-[3px] border-[#141210] bg-[#6bc6a0] px-6 text-[15px] font-bold uppercase tracking-[0.08em] text-[#141210] shadow-[5px_5px_0_#141210] transition-transform duration-75 hover:bg-[#7fd0ad] active:translate-x-[2px] active:translate-y-[2px] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#88a7f8] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fdfcf9] sm:w-auto ${FONT_UI}`}
              onClick={start}
            >
              {startLabel}
            </button>
          </div>
        </div>
        <TilesStripe />
      </div>
    );
  }

  return (
    <div
      className={`${ROOT_CLASS} tuner-standalone tuner-gate tuner-theme-vintage flex flex-col gap-3 rounded-2xl border-[1.5px] border-[#8c7a5b] bg-[#1d1a16] p-3.5 text-[#f3e7c6] shadow-[0_12px_32px_rgba(0,0,0,0.35)] sm:flex-row sm:items-center sm:justify-between ${FONT_UI} ${width} ${className}`}
    >
      <div className="tuner-gate-text flex min-w-0 flex-col gap-1 rounded-[10px] border-2 border-[#3a3026] bg-[#140e05] px-3.5 py-2.5 sm:grow">
        <span className={`tuner-gate-title ${FONT_LCD} text-[34px] leading-none tracking-[0.06em] text-[#ffb43a] [text-shadow:0_0_10px_rgba(255,180,58,0.45)]`}>
          TUNER
        </span>
        <span className="tuner-gate-note text-[12px] leading-snug text-[#d7c9aa]">{NOTE}</span>
      </div>
      <button
        type="button"
        className="tuner-btn-start inline-flex h-14 w-full shrink-0 cursor-pointer select-none items-center justify-center rounded-[14px] border-[1.5px] border-[#ffb43a] bg-[#ffb43a] px-6 text-[15px] font-semibold text-[#140e05] transition-colors hover:bg-[#ffc563] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffb43a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1d1a16] sm:w-auto"
        onClick={start}
      >
        {startLabel}
      </button>
    </div>
  );
}
