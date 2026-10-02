import { describe, expect, it } from 'vitest';
import {
  BPM_MAX,
  BPM_MIN,
  BUILTIN_PATTERNS,
  DEFAULT_METRONOME_SETTINGS,
  PATTERN_SCHEMA_VERSION,
  SIGNATURES,
  SOUNDS,
  TAP_WINDOW_MS,
  clampBpm,
  cycleAccent,
  defaultAccents,
  filterPatterns,
  parseMetronomeSettings,
  parsePatterns,
  patternTags,
  resolvePattern,
  stepAt,
  stepSound,
  stepsPerBar,
  tapTempo,
  tempoName,
  withSignature,
  type MetronomeSettings,
  type SubdivisionPattern,
} from './model';
import patternsJson from './patterns.json';
import patternsSchema from './patterns.schema.json';

const base: MetronomeSettings = DEFAULT_METRONOME_SETTINGS;

describe('tables', () => {
  it('lists signatures in order with their default accents', () => {
    expect(SIGNATURES.map((s) => s.id)).toEqual(['2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '12/8']);
    expect(SIGNATURES.map((s) => s.accents)).toEqual([
      [3, 2],
      [3, 2, 2],
      [3, 2, 2, 2],
      [3, 2, 2, 2, 2],
      [3, 1, 1, 2, 1, 1],
      [3, 1, 2, 1, 2, 1, 1],
      [3, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1],
    ]);
    expect(SIGNATURES.every((s) => s.label === s.id && s.beats === s.accents.length)).toBe(true);
  });

  it('lists sounds in order with labels', () => {
    expect(SOUNDS.map((s) => [s.id, s.label])).toEqual([
      ['tone', 'Tone'],
      ['wood', 'Woodblock'],
      ['tom', '808 Tom'],
      ['clap', 'Clap'],
      ['rim', 'Rim click'],
      ['bell', 'Cowbell'],
    ]);
  });

  it('defaultAccents returns a fresh copy each call', () => {
    const a = defaultAccents('6/8');
    expect(a).toEqual([3, 1, 1, 2, 1, 1]);
    a[0] = 0;
    expect(defaultAccents('6/8')[0]).toBe(3);
  });

  it('has the documented defaults', () => {
    expect(DEFAULT_METRONOME_SETTINGS).toEqual({
      mode: 'simple',
      bpm: 120,
      signature: '4/4',
      subdivision: 'quarter',
      sound: 'wood',
      accents: [3, 2, 2, 2],
    });
  });
});

describe('clampBpm', () => {
  it('clamps and rounds', () => {
    expect([BPM_MIN, BPM_MAX]).toEqual([40, 240]);
    expect(clampBpm(10)).toBe(40);
    expect(clampBpm(999)).toBe(240);
    expect(clampBpm(119.6)).toBe(120);
    expect(clampBpm(Infinity)).toBe(240);
    expect(clampBpm(-Infinity)).toBe(40);
  });

  it('falls back to the default for NaN', () => {
    expect(clampBpm(NaN)).toBe(120);
  });
});

describe('tempoName', () => {
  it('names each band at its boundaries', () => {
    expect(tempoName(40)).toBe('Largo');
    expect(tempoName(59)).toBe('Largo');
    expect(tempoName(60)).toBe('Adagio');
    expect(tempoName(75)).toBe('Adagio');
    expect(tempoName(76)).toBe('Andante');
    expect(tempoName(107)).toBe('Andante');
    expect(tempoName(108)).toBe('Moderato');
    expect(tempoName(119)).toBe('Moderato');
    expect(tempoName(120)).toBe('Allegro');
    expect(tempoName(167)).toBe('Allegro');
    expect(tempoName(168)).toBe('Presto');
    expect(tempoName(240)).toBe('Presto');
  });
});

describe('parseMetronomeSettings', () => {
  it('returns defaults for garbage', () => {
    for (const junk of [null, undefined, 42, 'x', [], true]) {
      expect(parseMetronomeSettings(junk)).toEqual(DEFAULT_METRONOME_SETTINGS);
    }
  });

  it('never hands back the shared default objects', () => {
    const a = parseMetronomeSettings(null);
    expect(a).not.toBe(DEFAULT_METRONOME_SETTINGS);
    expect(a.accents).not.toBe(DEFAULT_METRONOME_SETTINGS.accents);
  });

  it('keeps a fully valid object', () => {
    const good: MetronomeSettings = {
      mode: 'full',
      bpm: 92,
      signature: '7/8',
      subdivision: 'swing',
      sound: 'bell',
      accents: [3, 0, 2, 1, 2, 1, 0],
    };
    expect(parseMetronomeSettings(good)).toEqual(good);
    expect(parseMetronomeSettings(good).accents).not.toBe(good.accents);
  });

  it('falls back per field', () => {
    expect(
      parseMetronomeSettings({ mode: 'huge', bpm: '120', signature: '9/8', subdivision: 'Not A Slug', sound: 'gong' }),
    ).toEqual(DEFAULT_METRONOME_SETTINGS);
    expect(parseMetronomeSettings({ mode: 'full', sound: 'tom' })).toEqual({
      ...DEFAULT_METRONOME_SETTINGS,
      mode: 'full',
      sound: 'tom',
    });
  });

  it('keeps any syntactically valid pattern id, known or not', () => {
    expect(parseMetronomeSettings({ subdivision: 'swing' }).subdivision).toBe('swing');
    expect(parseMetronomeSettings({ subdivision: 'preset-not-loaded' }).subdivision).toBe('preset-not-loaded');
    expect(parseMetronomeSettings({ subdivision: 7 }).subdivision).toBe('quarter');
    expect(parseMetronomeSettings({ subdivision: '' }).subdivision).toBe('quarter');
  });

  it('clamps and rounds a numeric bpm, defaults a non-finite one', () => {
    expect(parseMetronomeSettings({ bpm: 999 }).bpm).toBe(240);
    expect(parseMetronomeSettings({ bpm: 3 }).bpm).toBe(40);
    expect(parseMetronomeSettings({ bpm: 100.4 }).bpm).toBe(100);
    expect(parseMetronomeSettings({ bpm: NaN }).bpm).toBe(120);
    expect(parseMetronomeSettings({ bpm: null }).bpm).toBe(120);
  });

  it('resets accents that do not fit the signature', () => {
    const def68 = [3, 1, 1, 2, 1, 1];
    // missing
    expect(parseMetronomeSettings({ signature: '6/8' }).accents).toEqual(def68);
    // wrong length (a 4/4 pattern left behind)
    expect(parseMetronomeSettings({ signature: '6/8', accents: [3, 2, 2, 2] }).accents).toEqual(def68);
    // out of range / non-integer / wrong type entries
    expect(parseMetronomeSettings({ signature: '6/8', accents: [3, 1, 1, 4, 1, 1] }).accents).toEqual(def68);
    expect(parseMetronomeSettings({ signature: '6/8', accents: [3, 1, 1, -1, 1, 1] }).accents).toEqual(def68);
    expect(parseMetronomeSettings({ signature: '6/8', accents: [3, 1, 1, 1.5, 1, 1] }).accents).toEqual(def68);
    expect(parseMetronomeSettings({ signature: '6/8', accents: [3, 1, 1, '2', 1, 1] }).accents).toEqual(def68);
    expect(parseMetronomeSettings({ signature: '6/8', accents: 'nope' }).accents).toEqual(def68);
    // valid custom pattern survives
    expect(parseMetronomeSettings({ signature: '6/8', accents: [0, 0, 0, 0, 0, 0] }).accents).toEqual([
      0, 0, 0, 0, 0, 0,
    ]);
  });

  it('resets a sparse accents array (holes are not levels)', () => {
    // `every` skips holes, so an array of the right length with nothing in it used to pass.
    expect(parseMetronomeSettings({ accents: new Array(4) }).accents).toEqual([3, 2, 2, 2]);
    const holed: unknown[] = [3, 2, 2, 2];
    delete holed[2];
    const out = parseMetronomeSettings({ accents: holed }).accents;
    expect(out).toEqual([3, 2, 2, 2]);
    expect(Object.keys(out)).toHaveLength(4); // dense
  });

  it('uses the default signature’s accents when the signature itself is bad', () => {
    expect(parseMetronomeSettings({ signature: 'x', accents: [3, 1, 1, 2, 1, 1] }).accents).toEqual([3, 2, 2, 2]);
  });
});

describe('withSignature', () => {
  it('switches signature and resets accents to its default', () => {
    const edited = { ...base, accents: [0, 0, 0, 0] as MetronomeSettings['accents'], bpm: 90 };
    const next = withSignature(edited, '12/8');
    expect(next).toEqual({ ...edited, signature: '12/8', accents: [3, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1] });
    expect(edited.signature).toBe('4/4'); // input untouched
  });

  it('resets accents even when re-selecting the current signature', () => {
    const edited = { ...base, accents: [0, 0, 0, 0] as MetronomeSettings['accents'] };
    expect(withSignature(edited, '4/4').accents).toEqual([3, 2, 2, 2]);
  });
});

describe('cycleAccent', () => {
  it('cycles accent → normal → soft → off → accent', () => {
    let s = base; // beat 0 starts at 3 (accent)
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      s = cycleAccent(s, 0);
      seen.push(s.accents[0]);
    }
    expect(seen).toEqual([2, 1, 0, 3, 2]);
  });

  it('only touches the given beat and does not mutate', () => {
    const next = cycleAccent(base, 2);
    expect(next.accents).toEqual([3, 2, 1, 2]);
    expect(base.accents).toEqual([3, 2, 2, 2]);
  });

  it('ignores an out-of-range beat', () => {
    expect(cycleAccent(base, 4)).toEqual(base);
    expect(cycleAccent(base, -1)).toEqual(base);
    expect(cycleAccent(base, 1.5)).toEqual(base);
  });
});

const P = (id: string): SubdivisionPattern => resolvePattern(BUILTIN_PATTERNS, id);
const doc = (patterns: unknown[], version: unknown = 1) => ({ version, patterns });
const valid = { id: 'x', label: 'X', division: 2, slots: ['beat', 'sub'] };

describe('parsePatterns', () => {
  it('parses a valid document, defaulting beats to 1', () => {
    expect(parsePatterns(doc([valid]))).toEqual([
      { id: 'x', label: 'X', title: 'X', description: '', tags: [], division: 2, beats: 1, slots: ['beat', 'sub'] },
    ]);
  });

  it('returns [] for garbage and never throws', () => {
    for (const junk of [null, undefined, 3, 'x', [], {}, { version: 1 }, { version: 1, patterns: 'no' }, [valid]]) {
      expect(parsePatterns(junk)).toEqual([]);
    }
  });

  it('returns [] for the wrong version', () => {
    expect(PATTERN_SCHEMA_VERSION).toBe(1);
    expect(parsePatterns(doc([valid], 2))).toEqual([]);
    expect(parsePatterns(doc([valid], '1'))).toEqual([]);
    expect(parsePatterns({ patterns: [valid] })).toEqual([]);
  });

  it('drops entries with an invalid field, keeping the rest', () => {
    const bad: unknown[] = [
      null,
      'eighth',
      { ...valid, id: undefined },
      { ...valid, id: '' },
      { ...valid, id: 'Has-Caps' },
      { ...valid, id: '-leading' },
      { ...valid, id: 'a'.repeat(33) },
      { ...valid, id: 'sp ace' },
      { ...valid, label: '' },
      { ...valid, label: 'thirteen-char' },
      { ...valid, label: 7 },
      { ...valid, division: 0 },
      { ...valid, division: 13 },
      { ...valid, division: 2.5 },
      { ...valid, division: '2' },
      { ...valid, beats: 0 },
      { ...valid, beats: 9 },
      { ...valid, beats: 1.5 },
      { ...valid, beats: null },
      { ...valid, slots: 'beat,sub' },
      { ...valid, slots: ['beat', 'boom'] },
      { ...valid, slots: ['beat', 1] },
      { ...valid, title: '' },
      { ...valid, title: 'a'.repeat(41) },
      { ...valid, title: 5 },
      { ...valid, description: 'a'.repeat(201) },
      { ...valid, description: null },
    ];
    for (const entry of bad) {
      expect(parsePatterns(doc([entry, { ...valid, id: 'ok' }])).map((p) => p.id)).toEqual(['ok']);
    }
  });

  it('accepts the id and label length limits', () => {
    const id = 'a' + '-'.repeat(31);
    expect(parsePatterns(doc([{ ...valid, id, label: 'twelve-chars' }]))).toHaveLength(1);
    expect(parsePatterns(doc([{ ...valid, id: '8ths' }]))).toHaveLength(1);
  });

  it('drops a wrong slot count (must be division × beats)', () => {
    expect(parsePatterns(doc([{ ...valid, slots: ['beat'] }]))).toEqual([]);
    expect(parsePatterns(doc([{ ...valid, slots: ['beat', 'sub', 'sub'] }]))).toEqual([]);
    expect(parsePatterns(doc([{ ...valid, beats: 2, slots: ['beat', 'sub'] }]))).toEqual([]);
    expect(parsePatterns(doc([{ ...valid, slots: [] }]))).toEqual([]);
  });

  it('drops a pattern with no sounding slot', () => {
    const ids = (entries: unknown[]) => parsePatterns(doc(entries)).map((p) => p.id);
    expect(ids([{ ...valid, slots: ['rest', 'rest'] }, { ...valid, id: 'ok' }])).toEqual(['ok']);
    expect(ids([{ ...valid, id: 'silent', division: 1, slots: ['rest'] }])).toEqual([]);
    // one sounding slot of either kind is enough
    expect(ids([{ ...valid, id: 'a', slots: ['rest', 'sub'] }, { ...valid, id: 'b', slots: ['beat', 'rest'] }])).toEqual(['a', 'b']);
  });

  it('counts label, title and description length in code points, like the JSON schema', () => {
    const drum = '🥁'; // one code point, two UTF-16 units
    expect(drum).toHaveLength(2);
    const [p] = parsePatterns(
      doc([{ ...valid, label: drum.repeat(12), title: drum.repeat(40), description: drum.repeat(200) }]),
    );
    expect(p).toBeTruthy();
    expect([...p.label]).toHaveLength(12);
    // one over each limit is still rejected
    expect(parsePatterns(doc([{ ...valid, label: drum.repeat(13) }]))).toEqual([]);
    expect(parsePatterns(doc([{ ...valid, title: drum.repeat(41) }]))).toEqual([]);
    expect(parsePatterns(doc([{ ...valid, description: drum.repeat(201) }]))).toEqual([]);
  });

  it('patterns.schema.json states the same limits the parser enforces', () => {
    const pattern = patternsSchema.$defs.pattern.properties;
    expect([pattern.label.minLength, pattern.label.maxLength]).toEqual([1, 12]);
    expect([pattern.title.minLength, pattern.title.maxLength]).toEqual([1, 40]);
    expect(pattern.description.maxLength).toBe(200);
    // at least one slot that sounds
    expect(pattern.slots.contains).toEqual({ enum: ['beat', 'sub'] });
    // and the shipped file satisfies that rule
    for (const p of patternsJson.patterns) expect(p.slots.some((k) => k !== 'rest')).toBe(true);
  });

  it('keeps the first of duplicate ids', () => {
    const out = parsePatterns(doc([valid, { ...valid, label: 'Second' }, { ...valid, id: 'y' }]));
    expect(out.map((p) => [p.id, p.label])).toEqual([
      ['x', 'X'],
      ['y', 'X'],
    ]);
  });

  it('parses a multi-beat pattern', () => {
    const tresillo = {
      id: 'tresillo',
      label: 'Tresillo',
      division: 4,
      beats: 2,
      slots: ['beat', 'rest', 'rest', 'beat', 'rest', 'rest', 'beat', 'rest'],
    };
    expect(parsePatterns(doc([tresillo]))).toEqual([{ ...tresillo, title: 'Tresillo', description: '', tags: [] }]);
  });

  it('copies slots rather than aliasing the input', () => {
    const slots = ['beat', 'sub'];
    const [p] = parsePatterns(doc([{ ...valid, slots }]));
    expect(p.slots).not.toBe(slots);
  });

  it('title defaults to the label, description to "", tags to []', () => {
    const [p] = parsePatterns(doc([valid]));
    expect([p.title, p.description, p.tags]).toEqual(['X', '', []]);
    const [q] = parsePatterns(doc([{ ...valid, title: 'Eighth notes', description: 'Two even clicks per beat.', tags: ['basic'] }]));
    expect([q.label, q.title, q.description, q.tags]).toEqual(['X', 'Eighth notes', 'Two even clicks per beat.', ['basic']]);
  });

  it('accepts the title and description length limits', () => {
    const [p] = parsePatterns(doc([{ ...valid, title: 't'.repeat(40), description: 'd'.repeat(200) }]));
    expect(p.title).toHaveLength(40);
    expect(p.description).toHaveLength(200);
    expect(parsePatterns(doc([{ ...valid, description: '' }]))).toHaveLength(1);
  });

  it('normalises tags: trimmed, lowercased, de-duplicated, invalid ones dropped, at most 8', () => {
    const tags = (t: unknown) => parsePatterns(doc([{ ...valid, tags: t }]))[0].tags;
    expect(tags(['  Latin ', 'LATIN', 'latin', 'two words', '6-8'])).toEqual(['latin', 'two words', '6-8']);
    // A bad tag is dropped; the pattern survives.
    expect(tags(['ok', '', '   ', '-leading', 'bad_char', 'é', 7, null, 'x'.repeat(21), 'y'.repeat(20)])).toEqual(['ok', 'y'.repeat(20)]);
    expect(tags(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'])).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    // Not a list at all: no tags, pattern still loads.
    expect(tags('basic')).toEqual([]);
    expect(tags(null)).toEqual([]);
    expect(tags({ a: 1 })).toEqual([]);
  });

  it('copies tags rather than aliasing the input', () => {
    const tags = ['basic'];
    const [p] = parsePatterns(doc([{ ...valid, tags }]));
    expect(p.tags).not.toBe(tags);
  });

  it('patterns.json: every built-in survives parsing, the first five being the quick toggles', () => {
    expect(parsePatterns(patternsJson)).toEqual(BUILTIN_PATTERNS);
    expect(BUILTIN_PATTERNS).toHaveLength(patternsJson.patterns.length);
    expect(BUILTIN_PATTERNS.slice(0, 5).map((p) => p.id)).toEqual(['quarter', 'eighth', 'triplet', 'sixteenth', 'swing']);
    expect(BUILTIN_PATTERNS.map((p) => [p.id, p.label, p.division, p.beats, p.slots.join(' ')])).toEqual([
      ['quarter', 'Beat', 1, 1, 'beat'],
      ['eighth', '8ths', 2, 1, 'beat sub'],
      ['triplet', 'Triplet', 3, 1, 'beat sub sub'],
      ['sixteenth', '16ths', 4, 1, 'beat sub sub sub'],
      ['swing', 'Swing', 3, 1, 'beat rest sub'],
      ['gallop', 'Gallop', 4, 1, 'beat rest sub sub'],
      ['reverse-gallop', 'Rev gallop', 4, 1, 'beat sub sub rest'],
      ['dotted', 'Dotted', 4, 1, 'beat rest rest sub'],
      ['offbeat', 'Offbeat', 2, 1, 'rest sub'],
      ['tresillo', 'Tresillo', 4, 2, 'beat rest rest beat rest rest beat rest'],
    ]);
  });

  it('patterns.json: titles, descriptions and tags', () => {
    expect(BUILTIN_PATTERNS.map((p) => [p.id, p.title, p.description, p.tags.join(',')])).toEqual([
      ['quarter', 'Beat only', 'One click on every beat.', 'basic'],
      ['eighth', 'Eighth notes', 'Two even clicks per beat.', 'basic'],
      ['triplet', 'Triplets', 'Three even clicks per beat.', 'basic,triplet'],
      ['sixteenth', 'Sixteenth notes', 'Four even clicks per beat.', 'basic'],
      ['swing', 'Swing eighths', 'Long–short eighths on a triplet grid.', 'basic,swing,triplet'],
      ['gallop', 'Gallop', 'An eighth then two sixteenths in each beat.', 'sixteenths'],
      ['reverse-gallop', 'Reverse gallop', 'Two sixteenths then an eighth in each beat.', 'sixteenths'],
      ['dotted', 'Dotted eighth + sixteenth', 'A long note and a short pickup in each beat.', 'sixteenths'],
      ['offbeat', 'Offbeats only', 'Silent on the beat, click on the and.', 'syncopated'],
      ['tresillo', 'Tresillo (3+3+2)', 'The 3+3+2 grouping across two beats.', 'syncopated,latin'],
    ]);
  });
});

describe('patternTags / filterPatterns', () => {
  it('patternTags lists every tag once, sorted', () => {
    expect(patternTags(BUILTIN_PATTERNS)).toEqual(['basic', 'latin', 'sixteenths', 'swing', 'syncopated', 'triplet']);
    expect(patternTags([])).toEqual([]);
  });

  it('filterPatterns: no tags selected returns everything, in order', () => {
    expect(filterPatterns(BUILTIN_PATTERNS, [])).toEqual([...BUILTIN_PATTERNS]);
    expect(filterPatterns(BUILTIN_PATTERNS, [])).not.toBe(BUILTIN_PATTERNS);
  });

  it('filterPatterns: a pattern must carry ALL selected tags', () => {
    const ids = (tags: string[]) => filterPatterns(BUILTIN_PATTERNS, tags).map((p) => p.id);
    expect(ids(['basic'])).toEqual(['quarter', 'eighth', 'triplet', 'sixteenth', 'swing']);
    expect(ids(['triplet'])).toEqual(['triplet', 'swing']);
    expect(ids(['basic', 'triplet', 'swing'])).toEqual(['swing']);
    expect(ids(['syncopated', 'latin'])).toEqual(['tresillo']);
    expect(ids(['latin', 'basic'])).toEqual([]);
    expect(ids(['nope'])).toEqual([]);
  });
});

describe('resolvePattern', () => {
  it('finds a pattern by id', () => {
    expect(resolvePattern(BUILTIN_PATTERNS, 'triplet').id).toBe('triplet');
  });

  it('falls back to the first pattern for an unknown id', () => {
    expect(resolvePattern(BUILTIN_PATTERNS, 'gone').id).toBe('quarter');
    const custom = parsePatterns(doc([{ ...valid, id: 'only' }]));
    expect(resolvePattern(custom, 'gone').id).toBe('only');
  });

  it('falls back to the built-in quarter for an empty list', () => {
    expect(resolvePattern([], 'eighth')).toEqual({
      id: 'quarter',
      label: 'Beat',
      title: 'Beat only',
      description: 'One click on every beat.',
      tags: ['basic'],
      division: 1,
      beats: 1,
      slots: ['beat'],
    });
  });
});

describe('stepAt', () => {
  it('quarter: one slot per beat, wrapping at the bar', () => {
    const q = P('quarter');
    expect(stepsPerBar(base, q)).toBe(4);
    expect(stepAt(base, q, 0)).toEqual({ beat: 0, sub: 0, isBeat: true, slot: 'beat', duration: 0.5 });
    expect(stepAt(base, q, 3)).toEqual({ beat: 3, sub: 0, isBeat: true, slot: 'beat', duration: 0.5 });
    expect(stepAt(base, q, 4).beat).toBe(0);
    expect(stepAt(base, q, 9).beat).toBe(1);
  });

  it('the beat is 60/bpm regardless of denominator', () => {
    const s = withSignature({ ...base, bpm: 90 }, '6/8');
    expect(stepAt(s, P('quarter'), 0).duration).toBeCloseTo(60 / 90, 12);
  });

  it('eighth / triplet / sixteenth split the beat evenly', () => {
    for (const [id, n] of [['eighth', 2], ['triplet', 3], ['sixteenth', 4]] as const) {
      const p = P(id);
      expect(stepsPerBar(base, p)).toBe(4 * n);
      for (let i = 0; i < n * 4; i++) {
        const st = stepAt(base, p, i);
        expect(st.beat).toBe(Math.floor(i / n));
        expect(st.sub).toBe(i % n);
        expect(st.isBeat).toBe(i % n === 0);
        expect(st.slot).toBe(i % n === 0 ? 'beat' : 'sub');
        expect(st.duration).toBeCloseTo(0.5 / n, 12);
      }
    }
  });

  it('swing falls out of the data: hit at 0, rest at 1/3, sub at 2/3', () => {
    const s: MetronomeSettings = { ...base, subdivision: 'swing', bpm: 100 };
    const p = P('swing');
    const steps = [0, 1, 2, 3].map((i) => stepAt(s, p, i));
    expect(steps.map((st) => st.slot)).toEqual(['beat', 'rest', 'sub', 'beat']);
    expect(steps.map((st) => st.beat)).toEqual([0, 0, 0, 1]);
    expect(steps.map((st) => st.isBeat)).toEqual([true, false, false, true]);
    for (const st of steps) expect(st.duration).toBeCloseTo(0.6 / 3, 12);
    expect(steps[0].duration + steps[1].duration + steps[2].duration).toBeCloseTo(0.6, 12);
  });

  it('12/8 wraps after twelve beats', () => {
    const s = withSignature(base, '12/8');
    const p = P('eighth');
    expect(stepsPerBar(s, p)).toBe(24);
    expect(stepAt(s, p, 22)).toMatchObject({ beat: 11, sub: 0 });
    expect(stepAt(s, p, 23)).toMatchObject({ beat: 11, sub: 1 });
    expect(stepAt(s, p, 24)).toMatchObject({ beat: 0, sub: 0 });
    expect(stepAt(s, p, 24 * 5 + 7)).toMatchObject({ beat: 3, sub: 1 });
  });

  it('a 2-beat pattern in 3/4 restarts at every bar line', () => {
    const [two] = parsePatterns(
      doc([{ id: 'two', label: 'Two', division: 2, beats: 2, slots: ['beat', 'rest', 'sub', 'sub'] }]),
    );
    const s = withSignature(base, '3/4');
    expect(stepsPerBar(s, two)).toBe(6);
    // bar 1: beats 1-2 play the whole pattern, beat 3 its first half; bar 2 starts over.
    const slots = Array.from({ length: 12 }, (_, i) => stepAt(s, two, i).slot);
    expect(slots).toEqual([
      'beat', 'rest', 'sub', 'sub', 'beat', 'rest',
      'beat', 'rest', 'sub', 'sub', 'beat', 'rest',
    ]);
    expect(stepAt(s, two, 5)).toMatchObject({ beat: 2, sub: 1, isBeat: false });
    expect(stepAt(s, two, 6)).toMatchObject({ beat: 0, sub: 0, isBeat: true });
  });

  it('isBeat follows the beat grid, not the slot kind', () => {
    const [off] = parsePatterns(doc([{ id: 'off', label: 'Off', division: 2, slots: ['rest', 'beat'] }]));
    expect(stepAt(base, off, 0)).toMatchObject({ isBeat: true, slot: 'rest' });
    expect(stepAt(base, off, 1)).toMatchObject({ isBeat: false, slot: 'beat' });
  });
});

describe('stepSound', () => {
  const s: MetronomeSettings = { ...base, subdivision: 'eighth', accents: [3, 2, 1, 0] };
  const p = P('eighth');

  it('maps beat accent levels to gain and tier', () => {
    expect(stepSound(s, stepAt(s, p, 0))).toEqual({ gain: 1, tier: 2 });
    expect(stepSound(s, stepAt(s, p, 2))).toEqual({ gain: 0.6, tier: 1 });
    expect(stepSound(s, stepAt(s, p, 4))).toEqual({ gain: 0.3, tier: 0 });
  });

  it('plays sub slots quietly on the low tier', () => {
    expect(stepSound(s, stepAt(s, p, 1))).toEqual({ gain: 0.22, tier: 0 });
    expect(stepSound(s, stepAt(s, p, 5))).toEqual({ gain: 0.22, tier: 0 });
  });

  it('a rest slot is silent', () => {
    expect(stepSound(s, stepAt(s, P('swing'), 1))).toBeNull();
  });

  it('a muted beat silences every slot inside it', () => {
    expect(stepSound(s, stepAt(s, p, 6))).toBeNull();
    expect(stepSound(s, stepAt(s, p, 7))).toBeNull();
  });

  it('an off-grid "beat" slot takes the level of the beat it falls inside', () => {
    const [off] = parsePatterns(doc([{ id: 'off', label: 'Off', division: 2, slots: ['rest', 'beat'] }]));
    expect(stepSound(s, stepAt(s, off, 1))).toEqual({ gain: 1, tier: 2 });
    expect(stepSound(s, stepAt(s, off, 3))).toEqual({ gain: 0.6, tier: 1 });
    expect(stepSound(s, stepAt(s, off, 7))).toBeNull();
  });
});

describe('tapTempo', () => {
  it('first tap yields no tempo', () => {
    expect(tapTempo([], 1000)).toEqual({ times: [1000], bpm: null });
  });

  it('averages the intervals across the kept taps', () => {
    expect(tapTempo([1000], 1500)).toEqual({ times: [1000, 1500], bpm: 120 });
    // 3 intervals over 1800 ms → 600 ms → 100 bpm
    expect(tapTempo([0, 610, 1190], 1800)).toEqual({ times: [0, 610, 1190, 1800], bpm: 100 });
  });

  it('drops taps 2500 ms old or older', () => {
    expect(TAP_WINDOW_MS).toBe(2500);
    expect(tapTempo([0, 1000], 2500)).toEqual({ times: [1000, 2500], bpm: 40 });
    expect(tapTempo([1, 1000], 2500).times).toEqual([1, 1000, 2500]);
    // a long pause starts a fresh count
    expect(tapTempo([0, 500, 1000], 9000)).toEqual({ times: [9000], bpm: null });
  });

  it('clamps the result', () => {
    expect(tapTempo([1000], 1050).bpm).toBe(240);
    expect(tapTempo([1000], 3400).bpm).toBe(40);
    expect(tapTempo([1000], 1000).bpm).toBe(240); // zero interval
  });

  it('does not mutate its input', () => {
    const times = [1000];
    tapTempo(times, 1500);
    expect(times).toEqual([1000]);
  });
});
