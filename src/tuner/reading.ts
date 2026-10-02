/**
 * Turns a smoothed frequency plus the tuner settings into what the LCD,
 * needle and string buttons show. Pure, so it is node-testable.
 */
import {
  IN_TUNE_CENTS,
  WIND_KEYS,
  centsBetween,
  freqToNote,
  getStrings,
  midiToFreq,
  nearestString,
  noteLabel,
  noteName,
  noteOctave,
  writtenMidi,
  type TunerSettings,
} from './pitch';

export interface TunerReading {
  hasSignal: boolean;
  /** Big note letter (with ♯/♭ glyph), or null when there is nothing to show. */
  note: string | null;
  octave: number | null;
  /** Offset from the target in cents (positive = sharp); null without signal. */
  cents: number | null;
  inTune: boolean;
  /** Pill text: 'IN TUNE', a direction hint, or the idle prompt. */
  hint: string;
  /** Small line: '296.7 Hz' or 'CONCERT B♭3 · 233.5 Hz'. */
  detail: string | null;
  /** 'WRITTEN · B♭' under the note for transposing winds. */
  written: string | null;
  /** String button to highlight (locked string, or nearest within a semitone). */
  targetIndex: number | null;
  locked: boolean;
}

export function formatCents(c: number): string {
  const r = Math.round(c);
  if (r === 0) return '0 ¢';
  return `${r > 0 ? '+' : ''}${r} ¢`;
}

export function formatHz(freq: number): string {
  return `${freq.toFixed(1)} Hz`;
}

function hintFor(c: number, voice: boolean): string {
  if (Math.abs(c) <= IN_TUNE_CENTS) return 'IN TUNE';
  if (c > 0) return voice ? 'SING LOWER ▼' : 'SHARP ▼ TUNE DOWN';
  return voice ? 'SING HIGHER ▲' : 'FLAT ▲ TUNE UP';
}

export function computeReading(
  freq: number | null,
  settings: TunerSettings,
  lockedString: number | null,
): TunerReading {
  const full = settings.mode === 'full';
  const voice = full && settings.instrument === 'voice';
  const idle = voice ? 'Sing a steady note' : 'Play any note';
  const strings = full ? getStrings(settings.instrument, settings.stringsVariant) : null;
  const locked = strings !== null && lockedString !== null && lockedString >= 0 && lockedString < strings.length;

  const base: TunerReading = {
    hasSignal: false,
    note: null,
    octave: null,
    cents: null,
    inTune: false,
    hint: idle,
    detail: null,
    written: null,
    targetIndex: locked ? lockedString : null,
    locked,
  };

  if (locked && strings) {
    const midi = strings[lockedString!];
    base.note = noteName(midi);
    base.octave = noteOctave(midi);
  }

  if (freq === null || !(freq > 0)) return base;

  const a4 = settings.a4;
  const finish = (r: Omit<TunerReading, 'inTune' | 'hint' | 'hasSignal'> & { cents: number }): TunerReading => ({
    ...r,
    hasSignal: true,
    inTune: Math.abs(r.cents) <= IN_TUNE_CENTS,
    hint: hintFor(r.cents, voice),
  });

  if (locked && strings) {
    const midi = strings[lockedString!];
    return finish({
      ...base,
      cents: centsBetween(freq, midiToFreq(midi, a4)),
      detail: formatHz(freq),
    });
  }

  const n = freqToNote(freq, a4);

  if (full && settings.instrument === 'winds') {
    const key = WIND_KEYS[settings.windKey];
    const w = writtenMidi(n.midi, settings.windKey);
    const transposing = key.semitones !== 0;
    return finish({
      ...base,
      note: noteName(w, { flats: true }),
      octave: noteOctave(w),
      cents: n.cents,
      written: transposing ? `WRITTEN · ${key.label}` : null,
      detail: transposing ? `CONCERT ${noteLabel(n.midi, { flats: true })} · ${formatHz(freq)}` : formatHz(freq),
    });
  }

  let targetIndex: number | null = null;
  if (strings) {
    const near = nearestString(freq, strings, a4);
    if (near && Math.abs(near.cents) < 100) targetIndex = near.index;
  }

  return finish({
    ...base,
    note: n.name,
    octave: n.octave,
    cents: n.cents,
    detail: formatHz(freq),
    targetIndex,
  });
}
