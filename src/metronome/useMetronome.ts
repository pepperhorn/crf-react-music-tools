/**
 * Everything a host needs around the presentational <Metronome>: settings
 * (persisted per device unless you control them), a lazily created
 * `MetronomeEngine`, the running flag, Start / Stop and the notice shown when
 * audio cannot start or is interrupted.
 *
 *   const metronome = useMetronome();
 *   return <Metronome {...metronome} />;
 *
 * - The engine is made on the first Start, never during render, so this is
 *   safe to call during server rendering.
 * - `onStart` creates and resumes the AudioContext, so it must run
 *   synchronously inside the click / tap (iOS). <Metronome> does that.
 * - Settings changes reach a playing engine as they happen.
 * - The engine is disposed when the component using the hook unmounts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { MetronomeEngine, type BeatState, type MetronomeEngineDeps } from './engine';
import { DEFAULT_METRONOME_SETTINGS, parseMetronomeSettings, type MetronomeSettings, type SubdivisionPattern } from './model';
import { usePersistentSettings } from '../shared/usePersistentSettings';

/** Default localStorage key for the metronome's settings. */
export const METRONOME_STORAGE_KEY = 'crf-music-tools-metronome';

export const METRONOME_MESSAGES = {
  /** No AudioContext could be created. */
  noAudio: 'No sound: this browser could not start audio.',
  /** The engine stopped itself because the audio was taken away (phone call, backgrounded app). */
  interrupted: 'Sound was interrupted. Press Start to resume.',
} as const;

export interface UseMetronomeOptions {
  /** Control the settings yourself. When set, nothing is read from or written to storage. */
  settings?: MetronomeSettings;
  /** Called with every settings change (in both controlled and uncontrolled use). */
  onSettingsChange?: (next: MetronomeSettings) => void;
  /** localStorage key for uncontrolled settings; `null` keeps them in memory only. */
  storageKey?: string | null;
  /** Settings used until a stored value is found. */
  defaultSettings?: MetronomeSettings;
  /** Subdivision patterns for a custom list (see `parsePatterns`). Read when the engine is created. */
  patterns?: readonly SubdivisionPattern[];
  /** Engine factory, for tests or custom voices. Default: `new MetronomeEngine({ patterns })`. */
  createEngine?: (deps: MetronomeEngineDeps) => MetronomeEngine;
  /** Override the notices. */
  messages?: Partial<Record<keyof typeof METRONOME_MESSAGES, string>>;
}

/** Spread onto `<Metronome>`. */
export interface UseMetronomeResult {
  settings: MetronomeSettings;
  onSettingsChange: (next: MetronomeSettings) => void;
  running: boolean;
  /** Call synchronously inside the click / tap. */
  onStart: () => void;
  onStop: () => void;
  getBeatState: () => BeatState | null;
  message: string | null;
  patterns?: readonly SubdivisionPattern[];
}

export function useMetronome(options: UseMetronomeOptions = {}): UseMetronomeResult {
  const { settings: controlled, storageKey = METRONOME_STORAGE_KEY, defaultSettings, patterns } = options;
  const isControlled = controlled !== undefined;
  const [stored, setStored] = usePersistentSettings<MetronomeSettings>(
    isControlled ? null : storageKey,
    parseMetronomeSettings,
    defaultSettings ?? DEFAULT_METRONOME_SETTINGS,
  );
  const settings = controlled ?? stored;

  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const engineRef = useRef<MetronomeEngine | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  // Latest values for the handlers, which keep a stable identity.
  const latest = useRef({ settings, options, isControlled });
  latest.current = { settings, options, isControlled };

  // Dispose on unmount only.
  useEffect(
    () => () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      engineRef.current?.dispose();
      engineRef.current = null;
    },
    [],
  );

  // Tempo, sound, accents… reach a playing engine as they change.
  useEffect(() => {
    engineRef.current?.setSettings(settings);
  }, [settings]);

  const change = useCallback(
    (next: MetronomeSettings) => {
      if (!latest.current.isControlled) setStored(next);
      latest.current.options.onSettingsChange?.(next);
    },
    [setStored],
  );

  // Must stay synchronous in the gesture for iOS.
  const onStart = useCallback(() => {
    const { options: o, settings: now } = latest.current;
    try {
      let engine = engineRef.current;
      if (!engine) {
        const deps: MetronomeEngineDeps = o.patterns ? { patterns: o.patterns } : {};
        engine = o.createEngine ? o.createEngine(deps) : new MetronomeEngine(deps);
        unsubscribeRef.current = engine.subscribe((isRunning, interrupted) => {
          setRunning(isRunning);
          if (interrupted) setMessage(latest.current.options.messages?.interrupted ?? METRONOME_MESSAGES.interrupted);
        });
        engineRef.current = engine;
      }
      // Clear first: a start that is refused on the spot reports it from inside start().
      setMessage(null);
      engine.start(now);
    } catch {
      setMessage(o.messages?.noAudio ?? METRONOME_MESSAGES.noAudio);
    }
  }, []);

  const onStop = useCallback(() => engineRef.current?.stop(), []);
  const getBeatState = useCallback(() => engineRef.current?.getBeatState() ?? null, []);

  return { settings, onSettingsChange: change, running, onStart, onStop, getBeatState, message, ...(patterns ? { patterns } : {}) };
}
