import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TUNER_SETTINGS,
  IN_TUNE_CENTS,
  INSTRUMENTS,
  RESPONSE_PROFILES,
  TUNER_RESPONSES,
  STRING_PRESETS,
  STRINGS_VARIANTS,
  WIND_KEYS,
  centsBetween,
  clampA4,
  createPitchSmoother,
  detectPitch,
  freqToNote,
  getStrings,
  midiToFreq,
  minFreqFor,
  nearestString,
  noteName,
  parseNote,
  parseTunerSettings,
  rms,
  responseProfile,
  smoothPitch,
  writtenMidi,
  type PitchHistory,
  type TunerResponse,
} from './pitch';

const SR = 48000;

function sine(freq: number, n: number, amp = 0.5, sr = SR): Float32Array {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return buf;
}

function sawtooth(freq: number, n: number, amp = 0.5, sr = SR): Float32Array {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const phase = (freq * i) / sr;
    buf[i] = amp * (2 * (phase - Math.floor(phase + 0.5)));
  }
  return buf;
}

// Deterministic PRNG so the noise test is stable.
function noise(n: number, amp: number, seed = 12345): Float32Array {
  let s = seed >>> 0;
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    buf[i] = amp * ((s / 0xffffffff) * 2 - 1);
  }
  return buf;
}

const FREQS = [41.2, 82.41, 110, 440, 659.25, 1046.5];

describe('detectPitch', () => {
  for (const f of FREQS) {
    it(`detects a ${f} Hz sine (4096 buffer) within 0.5%`, () => {
      const got = detectPitch(sine(f, 4096), SR);
      expect(got).not.toBeNull();
      expect(Math.abs(got! - f) / f).toBeLessThan(0.005);
    });
    it(`detects a ${f} Hz sawtooth (4096 buffer) within 0.5%`, () => {
      const got = detectPitch(sawtooth(f, 4096), SR);
      expect(got).not.toBeNull();
      expect(Math.abs(got! - f) / f).toBeLessThan(0.005);
    });
    if (f >= 82) {
      it(`detects a ${f} Hz sine and sawtooth (2048 buffer) within 0.5%`, () => {
        for (const buf of [sine(f, 2048), sawtooth(f, 2048)]) {
          const got = detectPitch(buf, SR);
          expect(got).not.toBeNull();
          expect(Math.abs(got! - f) / f).toBeLessThan(0.005);
        }
      });
    }
  }

  it('decimated (≥44.1 kHz) detection stays within 3 cents on sines from 41 Hz to 1.76 kHz, at 48 and 44.1 kHz', () => {
    for (const sr of [48000, 44100]) {
      for (const f of [41.2, 82.41, 196, 440, 1046.5, 1760]) {
        const got = detectPitch(sine(f, 4096, 0.5, sr), sr);
        expect(got, `${f} Hz @ ${sr}`).not.toBeNull();
        expect(Math.abs(centsBetween(got!, f)), `${f} Hz @ ${sr}`).toBeLessThan(3);
      }
    }
  });

  it('detects at 44.1 kHz too', () => {
    const got = detectPitch(sine(196, 4096, 0.5, 44100), 44100);
    expect(Math.abs(got! - 196) / 196).toBeLessThan(0.005);
  });

  it('is accurate to about a cent on a pure sine', () => {
    const got = detectPitch(sine(440, 4096), SR)!;
    expect(Math.abs(centsBetween(got, 440))).toBeLessThan(1);
  });

  it('returns null for silence', () => {
    expect(detectPitch(new Float32Array(4096), SR)).toBeNull();
  });

  it('returns null for low-level white noise', () => {
    expect(detectPitch(noise(4096, 0.005), SR)).toBeNull();
  });

  it('returns null for loud white noise (no periodicity)', () => {
    expect(detectPitch(noise(4096, 0.5), SR)).toBeNull();
  });

  it('respects the rmsGate option', () => {
    const quiet = sine(440, 4096, 0.005);
    expect(detectPitch(quiet, SR)).toBeNull();
    const got = detectPitch(quiet, SR, { rmsGate: 0.001 });
    expect(Math.abs(got! - 440) / 440).toBeLessThan(0.005);
  });

  it('returns null when the pitch is outside minFreq/maxFreq', () => {
    expect(detectPitch(sine(1046.5, 4096), SR, { maxFreq: 800 })).toBeNull();
  });
});

describe('rms', () => {
  it('is 0 for silence and an empty buffer', () => {
    expect(rms(new Float32Array(16))).toBe(0);
    expect(rms(new Float32Array(0))).toBe(0);
  });
  it('is amp/sqrt(2) for a sine', () => {
    expect(rms(sine(440, 4800, 1))).toBeCloseTo(Math.SQRT1_2, 3);
  });
});

describe('note maths', () => {
  it('midiToFreq', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(69, 432)).toBeCloseTo(432, 6);
    expect(midiToFreq(40)).toBeCloseTo(82.407, 2);
    expect(midiToFreq(81)).toBeCloseTo(880, 6);
  });

  it('centsBetween', () => {
    expect(centsBetween(880, 440)).toBeCloseTo(1200, 6);
    expect(centsBetween(440, 440)).toBe(0);
    expect(centsBetween(440 * Math.pow(2, 18 / 1200), 440)).toBeCloseTo(18, 6);
    expect(centsBetween(440 * Math.pow(2, -7 / 1200), 440)).toBeCloseTo(-7, 6);
  });

  it('noteName uses real sharp/flat glyphs', () => {
    expect(noteName(60)).toBe('C');
    expect(noteName(61)).toBe('C♯');
    expect(noteName(61, { flats: true })).toBe('D♭');
    expect(noteName(70, { flats: true })).toBe('B♭');
    expect(noteName(63, { flats: true })).toBe('E♭');
    expect(noteName(69)).toBe('A');
  });

  it('parseNote', () => {
    expect(parseNote('E2')).toBe(40);
    expect(parseNote('A4')).toBe(69);
    expect(parseNote('C4')).toBe(60);
    expect(parseNote('C#4')).toBe(61);
    expect(parseNote('C♯4')).toBe(61);
    expect(parseNote('Bb3')).toBe(58);
    expect(parseNote('B♭3')).toBe(58);
    expect(parseNote('E1')).toBe(28);
    expect(parseNote('C-1')).toBe(0);
    expect(() => parseNote('H2')).toThrow();
    expect(() => parseNote('E')).toThrow();
  });

  it('freqToNote at A4=440', () => {
    expect(freqToNote(440)).toEqual({ midi: 69, name: 'A', octave: 4, cents: 0, freq: 440 });
    const e2 = freqToNote(82.41);
    expect(e2.midi).toBe(40);
    expect(e2.name).toBe('E');
    expect(e2.octave).toBe(2);
    expect(Math.abs(e2.cents)).toBeLessThan(1);
    const sharpD = freqToNote(296.7);
    expect(sharpD.name).toBe('D');
    expect(sharpD.octave).toBe(4);
    expect(sharpD.cents).toBeGreaterThan(15);
    expect(sharpD.cents).toBeLessThan(20);
  });

  it('freqToNote rounds to the nearest note, cents within ±50', () => {
    const n = freqToNote(440 * Math.pow(2, 49 / 1200));
    expect(n.midi).toBe(69);
    expect(n.cents).toBeCloseTo(49, 6);
    const m = freqToNote(440 * Math.pow(2, 51 / 1200));
    expect(m.midi).toBe(70);
    expect(m.name).toBe('A♯');
    expect(m.cents).toBeCloseTo(-49, 6);
  });

  it('freqToNote with A4=432', () => {
    const a = freqToNote(432, 432);
    expect(a.midi).toBe(69);
    expect(a.cents).toBeCloseTo(0, 6);
    const b = freqToNote(440, 432);
    expect(b.midi).toBe(69);
    expect(b.cents).toBeCloseTo(31.77, 1);
  });

  it('octave boundary: B3 vs C4', () => {
    expect(freqToNote(midiToFreq(59))).toMatchObject({ name: 'B', octave: 3 });
    expect(freqToNote(midiToFreq(60))).toMatchObject({ name: 'C', octave: 4 });
  });

  it('IN_TUNE_CENTS is 5', () => {
    expect(IN_TUNE_CENTS).toBe(5);
  });
});

describe('transposition', () => {
  it('WIND_KEYS semitones and labels', () => {
    expect(WIND_KEYS.C.semitones).toBe(0);
    expect(WIND_KEYS.Bb.semitones).toBe(2);
    expect(WIND_KEYS.Eb.semitones).toBe(9);
    expect(WIND_KEYS.F.semitones).toBe(7);
    expect(WIND_KEYS.Bb.label).toBe('B♭');
    expect(WIND_KEYS.Eb.label).toBe('E♭');
    expect(WIND_KEYS.C.label).toBe('C');
    expect(WIND_KEYS.F.label).toBe('F');
    for (const k of Object.values(WIND_KEYS)) expect(k.instruments.length).toBeGreaterThan(0);
  });

  it('writtenMidi', () => {
    // Concert Bb3 on a Bb trumpet reads as written C4.
    expect(writtenMidi(58, 'Bb')).toBe(60);
    // Concert Eb4 on an alto sax reads as written C5.
    expect(writtenMidi(63, 'Eb')).toBe(72);
    // Concert F3 on a horn reads as written C4.
    expect(writtenMidi(53, 'F')).toBe(60);
    expect(writtenMidi(60, 'C')).toBe(60);
  });
});

describe('presets', () => {
  const names = (ms: number[] | null) =>
    ms?.map((m) => `${noteName(m)}${Math.floor(m / 12) - 1}`);

  it('string tables', () => {
    expect(names(getStrings('guitar', 'violin'))).toEqual(['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
    expect(names(getStrings('bass', 'violin'))).toEqual(['E1', 'A1', 'D2', 'G2']);
    expect(names(getStrings('ukulele', 'violin'))).toEqual(['G4', 'C4', 'E4', 'A4']);
    expect(names(getStrings('strings', 'violin'))).toEqual(['G3', 'D4', 'A4', 'E5']);
    expect(names(getStrings('strings', 'viola'))).toEqual(['C3', 'G3', 'D4', 'A4']);
    expect(names(getStrings('strings', 'cello'))).toEqual(['C2', 'G2', 'D3', 'A3']);
    expect(names(getStrings('strings', 'doublebass'))).toEqual(['E1', 'A1', 'D2', 'G2']);
  });

  it('non-string instruments have no strings', () => {
    expect(getStrings('winds', 'violin')).toBeNull();
    expect(getStrings('voice', 'cello')).toBeNull();
  });

  it('exposes instrument and variant lists', () => {
    expect(INSTRUMENTS.map((i) => i.id)).toEqual([
      'guitar',
      'bass',
      'ukulele',
      'strings',
      'winds',
      'voice',
    ]);
    expect(STRINGS_VARIANTS.map((v) => v.id)).toEqual(['violin', 'viola', 'cello', 'doublebass']);
    expect(STRING_PRESETS.guitar).toHaveLength(6);
  });

  it('getStrings returns a copy (callers cannot mutate the table)', () => {
    const s = getStrings('guitar', 'violin')!;
    s[0] = 0;
    expect(getStrings('guitar', 'violin')![0]).toBe(40);
  });
});

describe('nearestString', () => {
  const guitar = getStrings('guitar', 'violin')!;

  it('picks the closest string by cents', () => {
    expect(nearestString(84, guitar)).toMatchObject({ index: 0, midi: 40 });
    expect(nearestString(112, guitar)).toMatchObject({ index: 1, midi: 45 });
    expect(nearestString(330, guitar)).toMatchObject({ index: 5, midi: 64 });
  });

  it('reports cents against the string', () => {
    const r = nearestString(84, guitar)!;
    expect(r.cents).toBeCloseTo(centsBetween(84, midiToFreq(40)), 6);
    expect(r.freq).toBeCloseTo(midiToFreq(40), 6);
  });

  it('honours a4', () => {
    const r = nearestString(432, getStrings('strings', 'violin')!, 432)!;
    expect(r.midi).toBe(69);
    expect(r.cents).toBeCloseTo(0, 6);
  });

  it('works for unsorted (re-entrant) tunings like ukulele', () => {
    const uke = getStrings('ukulele', 'violin')!;
    expect(nearestString(392, uke)).toMatchObject({ index: 0, midi: 67 });
    expect(nearestString(262, uke)).toMatchObject({ index: 1, midi: 60 });
  });

  it('returns null for an empty list', () => {
    expect(nearestString(440, [])).toBeNull();
  });
});

describe('settings', () => {
  it('defaults', () => {
    expect(DEFAULT_TUNER_SETTINGS).toEqual({
      mode: 'simple',
      instrument: 'guitar',
      stringsVariant: 'violin',
      windKey: 'Bb',
      a4: 440,
      theme: 'vintage',
      response: 'medium',
    });
  });

  it('clampA4', () => {
    expect(clampA4(440)).toBe(440);
    expect(clampA4(400)).toBe(430);
    expect(clampA4(500)).toBe(450);
    expect(clampA4(441.6)).toBe(442);
    expect(clampA4(Number.NaN)).toBe(440);
    expect(clampA4(Infinity)).toBe(440);
  });

  it('parses a valid object', () => {
    const s = { mode: 'full', instrument: 'strings', stringsVariant: 'cello', windKey: 'Eb', a4: 442, theme: 'tiles', response: 'slow' };
    expect(parseTunerSettings(s)).toEqual(s);
  });

  it('falls back field by field', () => {
    expect(
      parseTunerSettings({ mode: 'bogus', instrument: 'bass', stringsVariant: 7, windKey: 'F', a4: '442' }),
    ).toEqual({ mode: 'simple', instrument: 'bass', stringsVariant: 'violin', windKey: 'F', a4: 440, theme: 'vintage', response: 'medium' });
  });

  it('theme defaults to vintage (existing saved settings keep their look) and is validated', () => {
    expect(DEFAULT_TUNER_SETTINGS.theme).toBe('vintage');
    // Settings saved before themes existed have no theme field.
    expect(parseTunerSettings({ mode: 'full', instrument: 'bass' }).theme).toBe('vintage');
    expect(parseTunerSettings({ theme: 'tiles' }).theme).toBe('tiles');
    expect(parseTunerSettings({ theme: 'vintage' }).theme).toBe('vintage');
    for (const junk of ['neon', 'TILES', 1, null, true, {}, ['tiles']]) {
      expect(parseTunerSettings({ theme: junk, mode: 'full' })).toMatchObject({ theme: 'vintage', mode: 'full' });
    }
  });

  it('response defaults to medium (settings saved before it existed have no such field) and is validated', () => {
    expect(DEFAULT_TUNER_SETTINGS.response).toBe('medium');
    expect(parseTunerSettings({ mode: 'full', instrument: 'bass', theme: 'tiles' }).response).toBe('medium');
    for (const junk of ['turbo', 'SLOW', '', 2, null, true, {}, ['fast']]) {
      expect(parseTunerSettings({ response: junk, mode: 'full' })).toMatchObject({ response: 'medium', mode: 'full' });
    }
  });

  it('response round-trips through JSON for every value', () => {
    for (const response of TUNER_RESPONSES) {
      const saved = JSON.stringify({ ...DEFAULT_TUNER_SETTINGS, response });
      expect(parseTunerSettings(JSON.parse(saved))).toEqual({ ...DEFAULT_TUNER_SETTINGS, response });
    }
  });

  it('clamps a4', () => {
    expect(parseTunerSettings({ a4: 470 }).a4).toBe(450);
    expect(parseTunerSettings({ a4: 431.2 }).a4).toBe(431);
  });

  it('returns defaults for junk', () => {
    for (const junk of [null, undefined, 'x', 42, [], true]) {
      expect(parseTunerSettings(junk)).toEqual(DEFAULT_TUNER_SETTINGS);
    }
  });

  it('returns a fresh object (not the shared default)', () => {
    expect(parseTunerSettings(null)).not.toBe(DEFAULT_TUNER_SETTINGS);
  });
});

describe('minFreqFor', () => {
  const base = { ...DEFAULT_TUNER_SETTINGS, mode: 'full' as const };
  it('keeps 35 Hz for chromatic, bass, double bass, winds and voice', () => {
    expect(minFreqFor({ ...DEFAULT_TUNER_SETTINGS, mode: 'simple', instrument: 'guitar' })).toBe(35);
    expect(minFreqFor({ ...base, instrument: 'bass' })).toBe(35);
    expect(minFreqFor({ ...base, instrument: 'strings', stringsVariant: 'doublebass' })).toBe(35);
    expect(minFreqFor({ ...base, instrument: 'winds' })).toBe(35);
    expect(minFreqFor({ ...base, instrument: 'voice' })).toBe(35);
  });
  it('sits a fourth below the lowest open string for guitar, ukulele, violin, viola and cello', () => {
    expect(minFreqFor({ ...base, instrument: 'guitar' })).toBeCloseTo(midiToFreq(parseNote('E2') - 5), 6);
    expect(minFreqFor({ ...base, instrument: 'strings', stringsVariant: 'violin' })).toBeCloseTo(midiToFreq(parseNote('G3') - 5), 6);
    expect(minFreqFor({ ...base, instrument: 'strings', stringsVariant: 'cello' })).toBeCloseTo(midiToFreq(parseNote('C2') - 5), 6);
    expect(minFreqFor({ ...base, instrument: 'ukulele' })).toBeGreaterThan(100);
  });
});

describe('smoothPitch (pure)', () => {
  it('returns the median of the recent window', () => {
    let h: PitchHistory = { samples: [], lastSignalAt: null };
    let out: number | null = null;
    for (const [i, f] of [440, 441, 600, 439, 440].entries()) {
      ({ history: h, freq: out } = smoothPitch(h, f, i * 20));
    }
    expect(out).toBe(440);
  });

  it('a single outlier does not move the output', () => {
    let h: PitchHistory = { samples: [], lastSignalAt: null };
    let out: number | null = null;
    for (const [i, f] of [440, 440, 440, 880].entries()) {
      ({ history: h, freq: out } = smoothPitch(h, f, i * 20));
    }
    expect(out).toBe(440);
  });

  it('holds the last value briefly on dropout, then clears', () => {
    let h: PitchHistory = { samples: [], lastSignalAt: null };
    ({ history: h } = smoothPitch(h, 440, 0));
    ({ history: h } = smoothPitch(h, 440, 20));
    const held = smoothPitch(h, null, 200, { holdMs: 400 });
    expect(held.freq).toBe(440);
    const gone = smoothPitch(held.history, null, 500, { holdMs: 400 });
    expect(gone.freq).toBeNull();
    expect(gone.history.samples).toEqual([]);
  });

  it('null with no history stays null', () => {
    expect(smoothPitch({ samples: [], lastSignalAt: null }, null, 0).freq).toBeNull();
  });

  it('resets the window when the pitch jumps to a new note and holds there', () => {
    let h: PitchHistory = { samples: [], lastSignalAt: null };
    let out: number | null = null;
    for (const [i, f] of [440, 440, 440, 440, 440, 330, 330, 330].entries()) {
      ({ history: h, freq: out } = smoothPitch(h, f, i * 20));
    }
    expect(out).toBe(330);
  });

  it('an even window yields the lower middle detection, never an average of two', () => {
    // Averaging an octave error with the true note would invent a pitch nobody played.
    let h: PitchHistory = { samples: [], lastSignalAt: null };
    let out: number | null = null;
    for (const [i, f] of [82.4, 164.8].entries()) {
      ({ history: h, freq: out } = smoothPitch(h, f, i * 20));
    }
    expect(out).toBe(82.4);
  });

  describe('window changing mid-run (the Response setting)', () => {
    const feed = (h: PitchHistory, values: number[], t0: number, windowSize: number) => {
      let out: number | null = null;
      values.forEach((f, i) => ({ history: h, freq: out } = smoothPitch(h, f, t0 + i * 20, { windowSize })));
      return { history: h, freq: out };
    };

    it('shrinking during silence: the held value is the median of the NEW window, not the old one', () => {
      // Slow (9): five detections of 440 then four of 330 → the median of nine is still 440.
      const slow = feed({ samples: [], lastSignalAt: null }, [440, 440, 440, 440, 440, 330, 330, 330, 330], 0, 9);
      expect(slow.freq).toBe(440);
      expect(smoothPitch(slow.history, null, 200, { windowSize: 9, holdMs: 900 }).freq).toBe(440);
      // Switch to Fast (3) while silent: only the last three count, and they are all 330.
      const held = smoothPitch(slow.history, null, 200, { windowSize: 3, holdMs: 900 });
      expect(held.freq).toBe(330);
      expect(held.history.samples).toEqual([330, 330, 330]);
      expect(held.history.lastSignalAt).toBe(slow.history.lastSignalAt);
      // And it stays that way on the next silent tick.
      expect(smoothPitch(held.history, null, 220, { windowSize: 3, holdMs: 900 }).freq).toBe(330);
    });

    it('shrinking with signal: the window is cut down on the next detection', () => {
      const slow = feed({ samples: [], lastSignalAt: null }, [440, 440, 440, 440, 440, 440, 440, 330, 330], 0, 9);
      expect(slow.freq).toBe(440);
      const fast = smoothPitch(slow.history, 330, 180, { windowSize: 3 });
      expect(fast.freq).toBe(330);
      expect(fast.history.samples).toEqual([330, 330, 330]);
    });

    it('growing: the short history is kept and fills up to the new window', () => {
      const fast = feed({ samples: [], lastSignalAt: null }, [440, 440, 440, 440], 0, 3);
      expect(fast.history.samples).toEqual([440, 440, 440]);
      // Silent at the moment of the switch: the three kept detections still answer.
      expect(smoothPitch(fast.history, null, 100, { windowSize: 9, holdMs: 900 }).freq).toBe(440);
      // New note under Slow (9): it needs to outnumber the three kept ones.
      const three = feed(fast.history, [330, 330, 330], 100, 9);
      expect(three.history.samples).toHaveLength(6);
      expect(three.freq).toBe(330); // lower middle of three 330s and three 440s
      const two = feed(fast.history, [330, 330], 100, 9);
      expect(two.freq).toBe(440);
      const full = feed(fast.history, Array(12).fill(330), 100, 9);
      expect(full.history.samples).toHaveLength(9);
    });
  });

  it('does not mutate the input history', () => {
    const h: PitchHistory = { samples: [440], lastSignalAt: 0 };
    smoothPitch(h, 441, 20);
    expect(h).toEqual({ samples: [440], lastSignalAt: 0 });
  });
});

describe('createPitchSmoother', () => {
  it('wraps smoothPitch with internal state', () => {
    const s = createPitchSmoother({ holdMs: 300 });
    expect(s.push(440, 0)).toBe(440);
    expect(s.push(442, 20)).toBe(440); // lower middle of [440, 442]
    expect(s.push(null, 100)).not.toBeNull();
    expect(s.push(null, 1000)).toBeNull();
    s.push(220, 1100);
    s.reset();
    expect(s.push(null, 1101)).toBeNull();
  });
});

describe('response profiles', () => {
  const { slow, medium, fast } = RESPONSE_PROFILES;

  it('lists slow, medium, fast in that order with labels', () => {
    expect(TUNER_RESPONSES).toEqual(['slow', 'medium', 'fast']);
    expect(TUNER_RESPONSES.map((r) => RESPONSE_PROFILES[r].label)).toEqual(['Slow', 'Medium', 'Fast']);
  });

  it('medium is exactly the behaviour before the setting existed', () => {
    // Literal previous values: DETECT_INTERVAL_MS = 30, smoothPitch defaults
    // windowSize 5 / holdMs 600, VuMeter OMEGA = 14.
    expect(medium).toEqual({ label: 'Medium', detectIntervalMs: 30, windowSize: 5, holdMs: 600, needleOmega: 14 });
  });

  it('slow is strictly smoother and fast strictly lighter on every dimension', () => {
    expect(slow.detectIntervalMs).toBeGreaterThan(medium.detectIntervalMs);
    expect(fast.detectIntervalMs).toBeLessThan(medium.detectIntervalMs);
    expect(slow.windowSize).toBeGreaterThan(medium.windowSize);
    expect(fast.windowSize).toBeLessThan(medium.windowSize);
    expect(slow.holdMs).toBeGreaterThan(medium.holdMs);
    expect(fast.holdMs).toBeLessThan(medium.holdMs);
    expect(slow.needleOmega).toBeLessThan(medium.needleOmega);
    expect(fast.needleOmega).toBeGreaterThan(medium.needleOmega);
  });

  it('fast still rejects a single outlier; windows are odd so the median is a true middle', () => {
    for (const r of TUNER_RESPONSES) expect(RESPONSE_PROFILES[r].windowSize % 2).toBe(1);
    expect(fast.windowSize).toBeGreaterThanOrEqual(3);
  });

  it('responseProfile falls back to medium for anything unknown', () => {
    expect(responseProfile('slow')).toBe(slow);
    expect(responseProfile('nope' as TunerResponse)).toBe(medium);
    expect(responseProfile(undefined as unknown as TunerResponse)).toBe(medium);
  });

  it('profiles are frozen', () => {
    expect(Object.isFrozen(RESPONSE_PROFILES)).toBe(true);
    expect(Object.isFrozen(RESPONSE_PROFILES.slow)).toBe(true);
  });

  /**
   * Drive the smoother the way useMicPitch does: 60 Hz frames, a detection
   * whenever the profile's interval has elapsed, the output held in between.
   * Returns the displayed value (in cents from A440) at every frame.
   */
  function simulate(response: TunerResponse, inputCents: (tMs: number) => number, durationMs: number): Array<{ t: number; cents: number }> {
    const p = RESPONSE_PROFILES[response];
    const frame = 1000 / 60;
    let history: PitchHistory = { samples: [], lastSignalAt: null };
    let last = -Infinity;
    let shown: number | null = null;
    const out: Array<{ t: number; cents: number }> = [];
    for (let t = 0; t <= durationMs; t += frame) {
      if (t - last >= p.detectIntervalMs) {
        last = t;
        const r = smoothPitch(history, 440 * Math.pow(2, inputCents(t) / 1200), t, p);
        history = r.history;
        shown = r.freq;
      }
      if (shown !== null) out.push({ t, cents: 1200 * Math.log2(shown / 440) });
    }
    return out;
  }

  /** Deterministic noise in [-1, 1) (mulberry32). */
  function noise(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
    };
  }

  const std = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length);
  };

  it('jittery input: the readout spread is slow < medium < fast, and it changes less often', () => {
    const run = (r: TunerResponse) => {
      const rnd = noise(42);
      // ±12 cents of jitter around the note, a fresh value every frame.
      const frames = simulate(r, () => 12 * rnd(), 20000).filter((f) => f.t > 1000);
      let changes = 0;
      for (let i = 1; i < frames.length; i++) if (frames[i].cents !== frames[i - 1].cents) changes += 1;
      return { spread: std(frames.map((f) => f.cents)), changes };
    };
    const s = run('slow');
    const m = run('medium');
    const f = run('fast');
    expect(s.spread).toBeLessThan(m.spread);
    expect(m.spread).toBeLessThan(f.spread);
    expect(s.changes).toBeLessThan(m.changes);
    expect(m.changes).toBeLessThan(f.changes);
    // Every profile is steadier than the raw input (uniform ±12 → σ ≈ 6.9).
    expect(f.spread).toBeLessThan(6.9);
  });

  it('step response: fast settles soonest, and slow still follows within 400 ms', () => {
    const settle = (r: TunerResponse) => {
      const frames = simulate(r, (t) => (t < 1000 ? 0 : 30), 3000);
      const first = frames.find((f) => f.t >= 1000 && Math.abs(f.cents - 30) < 0.5)!;
      return first.t - 1000;
    };
    const s = settle('slow');
    const m = settle('medium');
    const f = settle('fast');
    expect(f).toBeLessThan(m);
    expect(m).toBeLessThan(s);
    expect(s).toBeLessThanOrEqual(400);
    expect(f).toBeLessThanOrEqual(60);
  });

  it('needle spring: slow settles within about 0.6 s, fast within about 0.25 s (critically damped: ~5/ω)', () => {
    expect(5 / slow.needleOmega).toBeLessThanOrEqual(0.6);
    expect(5 / fast.needleOmega).toBeLessThanOrEqual(0.25);
  });
});
