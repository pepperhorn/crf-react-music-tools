import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNER_SETTINGS, midiToFreq, parseNote, type TunerSettings } from './pitch';
import { computeReading, formatCents, formatHz } from './reading';

const s = (over: Partial<TunerSettings> = {}): TunerSettings => ({ ...DEFAULT_TUNER_SETTINGS, ...over });
const cents = (midi: number, c: number, a4 = 440) => midiToFreq(midi, a4) * Math.pow(2, c / 1200);

describe('formatting', () => {
  it('formats cents with a sign and no negative zero', () => {
    expect(formatCents(18.2)).toBe('+18 ¢');
    expect(formatCents(-7.4)).toBe('-7 ¢');
    expect(formatCents(-0.3)).toBe('0 ¢');
    expect(formatCents(0)).toBe('0 ¢');
  });
  it('formats Hz to one decimal', () => {
    expect(formatHz(296.71)).toBe('296.7 Hz');
  });
});

describe('computeReading', () => {
  it('no signal: idle prompt, no note', () => {
    const r = computeReading(null, s(), null);
    expect(r.hasSignal).toBe(false);
    expect(r.note).toBeNull();
    expect(r.cents).toBeNull();
    expect(r.hint).toBe('Play any note');
    expect(r.inTune).toBe(false);
  });

  it('voice uses voice wording', () => {
    const v = s({ mode: 'full', instrument: 'voice' });
    expect(computeReading(null, v, null).hint).toBe('Sing a steady note');
    expect(computeReading(cents(64, -7), v, null).hint).toBe('SING HIGHER ▲');
    expect(computeReading(cents(64, 20), v, null).hint).toBe('SING LOWER ▼');
  });

  it('simple mode is chromatic with sharps and ignores the instrument', () => {
    const r = computeReading(cents(parseNote('C#4'), 18), s({ mode: 'simple', instrument: 'winds', windKey: 'Bb' }), null);
    expect(r.note).toBe('C♯');
    expect(r.octave).toBe(4);
    expect(r.cents).toBeCloseTo(18, 5);
    expect(r.hint).toBe('SHARP ▼ TUNE DOWN');
    expect(r.written).toBeNull();
    expect(r.detail).toBe(formatHz(cents(parseNote('C#4'), 18)));
  });

  it('flat reading hints tune up; within 5 cents is in tune', () => {
    expect(computeReading(cents(57, -12), s(), null).hint).toBe('FLAT ▲ TUNE UP');
    const r = computeReading(cents(57, 4.9), s(), null);
    expect(r.inTune).toBe(true);
    expect(r.hint).toBe('IN TUNE');
  });

  it('respects a non-440 A4', () => {
    const r = computeReading(442, s({ a4: 442 }), null);
    expect(r.note).toBe('A');
    expect(r.cents).toBeCloseTo(0, 5);
  });

  it('strings unlocked: chromatic note, nearest string highlighted', () => {
    const r = computeReading(cents(parseNote('D4'), 18), s({ mode: 'full', instrument: 'strings', stringsVariant: 'violin' }), null);
    expect(r.note).toBe('D');
    expect(r.octave).toBe(4);
    expect(r.targetIndex).toBe(1);
    expect(r.locked).toBe(false);
  });

  it('strings locked: cents measured against the locked string', () => {
    // Playing A2 while locked to the low E2 string of a guitar → +500 cents.
    const r = computeReading(cents(parseNote('A2'), 0), s({ mode: 'full', instrument: 'guitar' }), 0);
    expect(r.note).toBe('E');
    expect(r.octave).toBe(2);
    expect(r.cents).toBeCloseTo(500, 3);
    expect(r.targetIndex).toBe(0);
    expect(r.locked).toBe(true);
    expect(r.hint).toBe('SHARP ▼ TUNE DOWN');
  });

  it('locked string with no signal still shows the target note', () => {
    const r = computeReading(null, s({ mode: 'full', instrument: 'guitar' }), 5);
    expect(r.note).toBe('E');
    expect(r.octave).toBe(4);
    expect(r.cents).toBeNull();
  });

  it('winds in B♭: written note big, concert pitch with flats in the detail', () => {
    const concert = cents(parseNote('Bb3'), 3);
    const r = computeReading(concert, s({ mode: 'full', instrument: 'winds', windKey: 'Bb' }), null);
    expect(r.note).toBe('C');
    expect(r.octave).toBe(4);
    expect(r.written).toBe('WRITTEN · B♭');
    expect(r.detail).toBe(`CONCERT B♭3 · ${formatHz(concert)}`);
    expect(r.inTune).toBe(true);
  });

  it('winds in E♭ and F transpose up a 6th / 5th, with flat spelling', () => {
    const eb = computeReading(midiToFreq(parseNote('C4')), s({ mode: 'full', instrument: 'winds', windKey: 'Eb' }), null);
    expect(`${eb.note}${eb.octave}`).toBe('A4');
    const f = computeReading(midiToFreq(parseNote('Bb3')), s({ mode: 'full', instrument: 'winds', windKey: 'F' }), null);
    expect(`${f.note}${f.octave}`).toBe('F4');
    const flat = computeReading(midiToFreq(parseNote('C4')), s({ mode: 'full', instrument: 'winds', windKey: 'C' }), null);
    expect(flat.written).toBeNull();
    const ab = computeReading(midiToFreq(parseNote('G#4')), s({ mode: 'full', instrument: 'winds', windKey: 'C' }), null);
    expect(ab.note).toBe('A♭');
  });

  it('ignores an out-of-range locked index', () => {
    const r = computeReading(cents(parseNote('A2'), 0), s({ mode: 'full', instrument: 'bass' }), 9);
    expect(r.locked).toBe(false);
    expect(r.note).toBe('A');
  });
});
