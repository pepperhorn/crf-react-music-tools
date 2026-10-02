/**
 * Pure tuner logic: YIN pitch detection, note/cents maths, transposition,
 * instrument presets, settings parsing and pitch smoothing.
 *
 * Self-contained on purpose — no React, no DOM, no host-app imports — so the
 * tuner can be lifted into another project as-is.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** |cents| at or below this counts as in tune (lamp lit). */
export const IN_TUNE_CENTS = 5;

export const A4_MIN = 430;
export const A4_MAX = 450;
export const A4_DEFAULT = 440;

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const;
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'] as const;

// ---------------------------------------------------------------------------
// Pitch detection (YIN)
// ---------------------------------------------------------------------------

export interface DetectPitchOptions {
  /** YIN absolute threshold on the CMND function. Default 0.15. */
  threshold?: number;
  /** Lowest detectable frequency in Hz. Default 35 (below E1 ≈ 41.2 Hz). */
  minFreq?: number;
  /** Highest detectable frequency in Hz. Default 2000. */
  maxFreq?: number;
  /** Buffers with RMS below this are treated as silence. Default 0.01. */
  rmsGate?: number;
}

/** Root-mean-square level of a buffer (0 for an empty buffer). */
export function rms(buf: Float32Array): number {
  if (buf.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

/**
 * Estimate the fundamental frequency of `buf` with the YIN algorithm
 * (de Cheveigné & Kawahara 2002): difference function, cumulative mean
 * normalised difference (CMND), absolute threshold, parabolic interpolation.
 *
 * Returns null when the signal is below the RMS gate, aperiodic (no CMND dip
 * under the threshold), or outside [minFreq, maxFreq].
 *
 * The lag search is capped at half the buffer, so the lowest reachable pitch
 * is roughly 2·sampleRate/buf.length (a 4096 buffer at 48 kHz reaches ~23 Hz;
 * a 2048 buffer ~47 Hz — use 4096 for bass E1). At sample rates ≥ 44.1 kHz
 * the buffer is decimated by 2 first (same reach, a quarter of the work), and
 * the search stops at sampleRate/minFreq, so a higher minFreq is cheaper.
 */
export function detectPitch(
  buf: Float32Array,
  sampleRate: number,
  opts: DetectPitchOptions = {},
): number | null {
  const threshold = opts.threshold ?? 0.15;
  const minFreq = opts.minFreq ?? 35;
  const maxFreq = opts.maxFreq ?? 2000;
  const rmsGate = opts.rmsGate ?? 0.01;

  if (buf.length < 4 || !(sampleRate > 0)) return null;
  if (rms(buf) < rmsGate) return null;

  // Decimate by 2 at 44.1/48 kHz: averaging sample pairs (a gentle low-pass,
  // -0.4 dB at 2 kHz) quarters the cost of the difference function (half the
  // lags, half the window). Measured against the full-rate search it stays in
  // the same 0–2 cent band from 41 Hz to 1.76 kHz.
  if (sampleRate >= 44100) {
    const half = new Float32Array(buf.length >> 1);
    for (let i = 0; i < half.length; i++) half[i] = 0.5 * (buf[2 * i] + buf[2 * i + 1]);
    buf = half;
    sampleRate = sampleRate / 2;
  }

  const maxTau = Math.min(Math.floor(sampleRate / minFreq), Math.floor(buf.length / 2));
  if (maxTau < 4) return null;

  // Fixed integration window so every lag sums the same number of terms.
  const W = buf.length - maxTau;

  // Difference function d(tau) and CMND d'(tau), for tau in [0, maxTau].
  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    let d = 0;
    for (let i = 0; i < W; i++) {
      const delta = buf[i] - buf[i + tau];
      d += delta * delta;
    }
    runningSum += d;
    cmnd[tau] = runningSum === 0 ? 1 : (d * tau) / runningSum;
  }

  // Absolute threshold: first lag dipping under the threshold, then walk down
  // to the bottom of that dip. The search always starts at the shortest lag —
  // starting at sampleRate/maxFreq would skip the true period of a too-high
  // note and lock onto a sub-octave dip; maxFreq is applied to the result.
  let tauEst = -1;
  for (let tau = 2; tau <= maxTau; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= maxTau && cmnd[tau + 1] < cmnd[tau]) tau++;
      tauEst = tau;
      break;
    }
  }
  if (tauEst === -1) return null;

  // Parabolic interpolation around the minimum for sub-sample precision.
  let betterTau = tauEst;
  if (tauEst > 0 && tauEst < maxTau) {
    const s0 = cmnd[tauEst - 1];
    const s1 = cmnd[tauEst];
    const s2 = cmnd[tauEst + 1];
    const denom = s0 - 2 * s1 + s2;
    if (denom !== 0) {
      const shift = (s0 - s2) / (2 * denom);
      if (Math.abs(shift) < 1) betterTau = tauEst + shift;
    }
  }

  const freq = sampleRate / betterTau;
  if (!Number.isFinite(freq) || freq < minFreq || freq > maxFreq) return null;
  return freq;
}

// ---------------------------------------------------------------------------
// Note maths
// ---------------------------------------------------------------------------

export interface NoteInfo {
  /** MIDI number of the nearest chromatic note (A4 = 69). */
  midi: number;
  /** Note letter with sharp glyph, e.g. 'C♯'. */
  name: string;
  /** Scientific-pitch octave (C4 = middle C). */
  octave: number;
  /** Offset from the nearest note in cents, in (-50, +50]. */
  cents: number;
  /** The input frequency. */
  freq: number;
}

export function midiToFreq(midi: number, a4: number = A4_DEFAULT): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/** Cents from `targetFreq` to `freq` (positive = sharp). */
export function centsBetween(freq: number, targetFreq: number): number {
  return 1200 * Math.log2(freq / targetFreq);
}

/** Pitch-class name for a MIDI note, using ♯ by default or ♭ with `flats`. */
export function noteName(midi: number, opts: { flats?: boolean } = {}): string {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  return (opts.flats ? FLAT_NAMES : SHARP_NAMES)[pc];
}

/** Scientific-pitch octave for a MIDI note (60 → 4). */
export function noteOctave(midi: number): number {
  return Math.floor(Math.round(midi) / 12) - 1;
}

/** Full label such as 'E2' or 'B♭3'. */
export function noteLabel(midi: number, opts: { flats?: boolean } = {}): string {
  return `${noteName(midi, opts)}${noteOctave(midi)}`;
}

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Parse 'E2', 'C#4', 'C♯4', 'Bb3', 'B♭3', 'C-1' into a MIDI number. Throws on bad input. */
export function parseNote(note: string): number {
  const m = /^([A-Ga-g])([#♯b♭]?)(-?\d+)$/.exec(note.trim());
  if (!m) throw new Error(`Invalid note: ${note}`);
  const pc = LETTER_PC[m[1].toUpperCase()];
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + pc + acc;
}

/** Nearest chromatic note (sharp spelling) and cents offset for a frequency. */
export function freqToNote(freq: number, a4: number = A4_DEFAULT): NoteInfo {
  const n = 12 * Math.log2(freq / a4) + 69;
  const midi = Math.round(n);
  const cents = (n - midi) * 100;
  return {
    midi,
    name: noteName(midi),
    octave: noteOctave(midi),
    cents: cents === 0 ? 0 : cents, // normalise -0
    freq,
  };
}

// ---------------------------------------------------------------------------
// Instruments and presets
// ---------------------------------------------------------------------------

export type InstrumentId = 'guitar' | 'bass' | 'ukulele' | 'strings' | 'winds' | 'voice';
export type StringsVariant = 'violin' | 'viola' | 'cello' | 'doublebass';
export type WindKey = 'C' | 'Bb' | 'Eb' | 'F';
export type TunerMode = 'simple' | 'full';
/** Visual theme: 'vintage' (brass, VU needle, amber LCD) or 'tiles' (neo-brutalist block meter). */
export type TunerTheme = 'vintage' | 'tiles';

export const TUNER_THEMES: readonly TunerTheme[] = ['vintage', 'tiles'];

/** How quickly the readout follows the sound: 'slow' is steadiest, 'fast' is snappiest. */
export type TunerResponse = 'slow' | 'medium' | 'fast';

export const TUNER_RESPONSES: readonly TunerResponse[] = ['slow', 'medium', 'fast'];

export interface ResponseProfile {
  label: string;
  /**
   * Minimum time between pitch detections (ms). Detection runs on animation
   * frames, so on a 60 Hz display the real spacing is the next multiple of
   * 16.7 ms: 15 → every frame, 30 → every 2nd (33 ms), 60 → every 4th (67 ms).
   * This is how often the note, cents and Hz text can change.
   */
  detectIntervalMs: number;
  /** Median window, in detections. The readout moves once more than half the window agrees. */
  windowSize: number;
  /** How long the last pitch stays up after the sound stops (ms). */
  holdMs: number;
  /** Stiffness (rad/s) of the vintage needle's critically damped spring; it settles in about 5/ω s. */
  needleOmega: number;
}

/**
 * The one table behind the Response setting. 'medium' is the tuner's original
 * behaviour, unchanged. Each step scales every stage the same way:
 *
 *            detect     median          median     needle     hold
 *            every      window          lag        settles
 *   slow     ~67 ms     9 (~530 ms)     ~330 ms    ~0.55 s    900 ms
 *   medium   ~33 ms     5 (~130 ms)     ~100 ms    ~0.35 s    600 ms
 *   fast     ~17 ms     3 (~33 ms)      ~33 ms     ~0.23 s    400 ms
 *
 * (Intervals as they land on a 60 Hz display. The window spans
 * (windowSize - 1) intervals.)
 *
 * "Median lag" is only the smoother's share of the delay: the time until more
 * than half the window holds detections of the new pitch. It is NOT the time
 * from a change in the sound to a change on screen. Every detection analyses
 * the last 4096 samples (~85 ms at 48 kHz, ~93 ms at 44.1 kHz), and reports a
 * new pitch only once that pitch dominates the buffer, so every profile also
 * waits for some part of those ~85 ms first. Fast therefore follows a new note
 * in very roughly a tenth of a second, not 33 ms; the profiles differ by their
 * median lag, on top of a delay they all share.
 *
 * Slow (voice, winds): detections 67 ms apart share only about a fifth of the
 * analysis buffer, so the median of nine averages out vibrato and breath
 * noise, and the text changes at most 15 times a second. Readout plus needle
 * still settle inside a second.
 *
 * Fast (plucked strings): every frame, with a median of three. That rejects
 * ONE isolated wrong detection (an octave error, a noise blip) and nothing
 * more: two wrong detections out of any three consecutive ones change the
 * readout. Consecutive Fast detections are 17 ms apart and share about 80% of
 * their buffer, so a wrong reading tends to repeat rather than come alone,
 * and Fast is noticeably less protected against octave flicker than Medium
 * (which needs three wrong out of five, over a wider span). It costs twice
 * the detection work of medium.
 *
 * The tiles block meter has no motion of its own: it is drawn straight from
 * the smoothed pitch, so the interval and window are what steady it.
 */
export const RESPONSE_PROFILES: Readonly<Record<TunerResponse, Readonly<ResponseProfile>>> = Object.freeze({
  slow: Object.freeze({ label: 'Slow', detectIntervalMs: 60, windowSize: 9, holdMs: 900, needleOmega: 9 }),
  medium: Object.freeze({ label: 'Medium', detectIntervalMs: 30, windowSize: 5, holdMs: 600, needleOmega: 14 }),
  fast: Object.freeze({ label: 'Fast', detectIntervalMs: 15, windowSize: 3, holdMs: 400, needleOmega: 22 }),
});

/** The profile for a response setting; anything unknown gets 'medium'. */
export function responseProfile(response: TunerResponse): Readonly<ResponseProfile> {
  return TUNER_RESPONSES.includes(response) ? RESPONSE_PROFILES[response] : RESPONSE_PROFILES.medium;
}

export const INSTRUMENTS: ReadonlyArray<{ id: InstrumentId; label: string }> = [
  { id: 'guitar', label: 'Guitar' },
  { id: 'bass', label: 'Bass' },
  { id: 'ukulele', label: 'Ukulele' },
  { id: 'strings', label: 'Strings' },
  { id: 'winds', label: 'Winds/Brass' },
  { id: 'voice', label: 'Voice' },
];

export const STRINGS_VARIANTS: ReadonlyArray<{
  id: StringsVariant;
  label: string;
  /** Narrow label for tight segmented controls (falls back to `label`). */
  short?: string;
}> = [
  { id: 'violin', label: 'Violin' },
  { id: 'viola', label: 'Viola' },
  { id: 'cello', label: 'Cello' },
  { id: 'doublebass', label: 'Double bass', short: 'D. bass' },
];

/** Open-string MIDI notes, in conventional display order (low string first; ukulele re-entrant G4 C4 E4 A4). */
export const STRING_PRESETS: Readonly<
  Record<'guitar' | 'bass' | 'ukulele' | StringsVariant, readonly number[]>
> = {
  guitar: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'].map(parseNote),
  bass: ['E1', 'A1', 'D2', 'G2'].map(parseNote),
  ukulele: ['G4', 'C4', 'E4', 'A4'].map(parseNote),
  violin: ['G3', 'D4', 'A4', 'E5'].map(parseNote),
  viola: ['C3', 'G3', 'D4', 'A4'].map(parseNote),
  cello: ['C2', 'G2', 'D3', 'A3'].map(parseNote),
  doublebass: ['E1', 'A1', 'D2', 'G2'].map(parseNote),
};

/** Open strings (MIDI) for an instrument, or null for winds/voice (chromatic). Returns a fresh array. */
export function getStrings(instrument: InstrumentId, stringsVariant: StringsVariant): number[] | null {
  switch (instrument) {
    case 'guitar':
    case 'bass':
    case 'ukulele':
      return [...STRING_PRESETS[instrument]];
    case 'strings':
      return [...STRING_PRESETS[stringsVariant]];
    default:
      return null;
  }
}

/** The default (chromatic) floor of the pitch search, below bass E1 ≈ 41.2 Hz. */
export const CHROMATIC_MIN_FREQ = 35;

/**
 * Lowest frequency worth searching for with these settings: a fourth below the
 * lowest open string (room for drop tunings and a badly flat string), or
 * CHROMATIC_MIN_FREQ when the range is unknown (simple mode, winds, voice) or
 * reaches that low anyway (bass, double bass). A higher floor shortens YIN's
 * lag search, which is most of the detection cost.
 */
export function minFreqFor(settings: TunerSettings): number {
  if (settings.mode !== 'full') return CHROMATIC_MIN_FREQ;
  const strings = getStrings(settings.instrument, settings.stringsVariant);
  if (!strings || strings.length === 0) return CHROMATIC_MIN_FREQ;
  return Math.max(CHROMATIC_MIN_FREQ, midiToFreq(Math.min(...strings) - 5, settings.a4));
}

export interface NearestStringResult {
  /** Index into the `strings` array. */
  index: number;
  midi: number;
  /** Target frequency of that string at the given A4. */
  freq: number;
  /** Cents from the string's target (positive = sharp). */
  cents: number;
}

/** The string whose target pitch is closest (in cents) to `freq`; null if `strings` is empty. */
export function nearestString(
  freq: number,
  strings: readonly number[],
  a4: number = A4_DEFAULT,
): NearestStringResult | null {
  let best: NearestStringResult | null = null;
  strings.forEach((midi, index) => {
    const target = midiToFreq(midi, a4);
    const cents = centsBetween(freq, target);
    if (!best || Math.abs(cents) < Math.abs(best.cents)) best = { index, midi, freq: target, cents };
  });
  return best;
}

// ---------------------------------------------------------------------------
// Transposition (winds/brass)
// ---------------------------------------------------------------------------

export interface WindKeyInfo {
  id: WindKey;
  /** Key label with real glyphs, e.g. 'B♭'. */
  label: string;
  /** Short instrument hint shown beside the key, e.g. 'Tpt, Clar, Tenor'. */
  instruments: string;
  /** Terse instrument hint for tight segmented controls, e.g. 'Tpt Clar Ten'. */
  short: string;
  /** Semitones added to concert pitch to get the written note. */
  semitones: number;
}

/**
 * Transposing keys. Written = concert + semitones:
 * B♭ instruments read a major 2nd above concert (+2), E♭ a major 6th (+9),
 * F horn a perfect 5th (+7). Tenor sax actually sounds a major 9th below
 * written, but only the pitch class/cents matter for tuning, so it shares +2
 * (the displayed octave for tenor is therefore one lower than its part).
 */
export const WIND_KEYS: Readonly<Record<WindKey, WindKeyInfo>> = {
  C: { id: 'C', label: 'C', instruments: 'Concert', short: 'Concert', semitones: 0 },
  Bb: { id: 'Bb', label: 'B♭', instruments: 'Tpt, Clar, Tenor', short: 'Tpt Clar Ten', semitones: 2 },
  Eb: { id: 'Eb', label: 'E♭', instruments: 'Alto, Bari', short: 'Alto Bari', semitones: 9 },
  F: { id: 'F', label: 'F', instruments: 'Horn', short: 'Horn', semitones: 7 },
};

export const WIND_KEY_ORDER: readonly WindKey[] = ['C', 'Bb', 'Eb', 'F'];

/** Written MIDI note for a concert MIDI note on an instrument in `key`. */
export function writtenMidi(concertMidi: number, key: WindKey): number {
  return concertMidi + WIND_KEYS[key].semitones;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface TunerSettings {
  mode: TunerMode;
  instrument: InstrumentId;
  stringsVariant: StringsVariant;
  windKey: WindKey;
  a4: number;
  theme: TunerTheme;
  response: TunerResponse;
}

export const DEFAULT_TUNER_SETTINGS: Readonly<TunerSettings> = Object.freeze({
  mode: 'simple',
  instrument: 'guitar',
  stringsVariant: 'violin',
  windKey: 'Bb',
  a4: A4_DEFAULT,
  theme: 'vintage',
  response: 'medium',
});

/** Round to an integer and clamp to 430–450; non-finite input gives 440. */
export function clampA4(a4: number): number {
  if (!Number.isFinite(a4)) return A4_DEFAULT;
  return Math.min(A4_MAX, Math.max(A4_MIN, Math.round(a4)));
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Validate untrusted (e.g. localStorage) input, falling back to defaults field by field. */
export function parseTunerSettings(raw: unknown): TunerSettings {
  const d = DEFAULT_TUNER_SETTINGS;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...d };
  const r = raw as Record<string, unknown>;
  return {
    mode: pick(r.mode, ['simple', 'full'] as const, d.mode),
    instrument: pick(r.instrument, INSTRUMENTS.map((i) => i.id), d.instrument),
    stringsVariant: pick(r.stringsVariant, STRINGS_VARIANTS.map((v) => v.id), d.stringsVariant),
    windKey: pick(r.windKey, WIND_KEY_ORDER, d.windKey),
    a4: typeof r.a4 === 'number' ? clampA4(r.a4) : d.a4,
    theme: pick(r.theme, TUNER_THEMES, d.theme),
    response: pick(r.response, TUNER_RESPONSES, d.response),
  };
}

// ---------------------------------------------------------------------------
// Smoothing
// ---------------------------------------------------------------------------

export interface PitchHistory {
  /** Most recent detected frequencies, oldest first. */
  samples: number[];
  /** Timestamp (ms) of the last non-null detection, or null. */
  lastSignalAt: number | null;
}

export interface SmoothPitchOptions {
  /** Median window length. Default 5. */
  windowSize?: number;
  /** How long to keep showing the last pitch after the signal drops (ms). Default 600. */
  holdMs?: number;
}

export const EMPTY_PITCH_HISTORY: Readonly<PitchHistory> = Object.freeze({ samples: [], lastSignalAt: null });

/**
 * Median that always returns one of the inputs: for an even count, the LOWER
 * middle value. Averaging the two middles would invent a pitch that was never
 * detected (e.g. halfway between a note and its octave error).
 */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[(s.length - 1) >> 1];
}

/**
 * Pure smoothing step. Feed each detection (or null for no signal) with the
 * current time; returns the new history and the frequency to display.
 * Output is the (lower) median of the last `windowSize` detections; on dropout the
 * last value is held for `holdMs`, after which the history is cleared.
 * `windowSize` may change between calls: a longer history is cut to the new
 * window (also while holding), a shorter one is kept and fills up.
 */
export function smoothPitch(
  history: PitchHistory,
  next: number | null,
  now: number,
  opts: SmoothPitchOptions = {},
): { history: PitchHistory; freq: number | null } {
  const windowSize = Math.max(1, opts.windowSize ?? 5);
  const holdMs = opts.holdMs ?? 600;

  if (next === null) {
    if (history.samples.length === 0 || history.lastSignalAt === null) {
      return { history: { samples: [], lastSignalAt: null }, freq: null };
    }
    if (now - history.lastSignalAt <= holdMs) {
      // Sliced to the CURRENT window: it may have shrunk since these were recorded (Slow → Fast).
      const samples = history.samples.slice(-windowSize);
      return { history: { samples, lastSignalAt: history.lastSignalAt }, freq: median(samples) };
    }
    return { history: { samples: [], lastSignalAt: null }, freq: null };
  }

  const samples = [...history.samples, next].slice(-windowSize);
  return { history: { samples, lastSignalAt: now }, freq: median(samples) };
}

export interface PitchSmoother {
  /** Push a detection (null = no signal) at time `now` (ms); returns the display frequency. */
  push(next: number | null, now: number): number | null;
  reset(): void;
}

/** Stateful convenience wrapper around `smoothPitch`. */
export function createPitchSmoother(opts: SmoothPitchOptions = {}): PitchSmoother {
  let history: PitchHistory = { samples: [], lastSignalAt: null };
  return {
    push(next, now) {
      const r = smoothPitch(history, next, now, opts);
      history = r.history;
      return r.freq;
    },
    reset() {
      history = { samples: [], lastSignalAt: null };
    },
  };
}
