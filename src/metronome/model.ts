/**
 * Pure metronome logic: settings, time signatures, data-driven subdivision
 * patterns, the step grid the scheduler walks, accent → loudness mapping,
 * tap tempo and settings parsing.
 *
 * Self-contained on purpose — no Web Audio, no React, no DOM, no host-app
 * imports — so the metronome can be lifted into another project as-is.
 */
import patternsJson from './patterns.json';

// ---------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------

export const BPM_MIN = 40;
export const BPM_MAX = 240;
export const BPM_DEFAULT = 120;

/** Round to a whole BPM inside [BPM_MIN, BPM_MAX]. NaN becomes the default. */
export function clampBpm(bpm: number): number {
  if (Number.isNaN(bpm)) return BPM_DEFAULT;
  return Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(bpm)));
}

/** Italian tempo marking for a BPM (coarse bands, for display only). */
export function tempoName(bpm: number): string {
  if (bpm < 60) return 'Largo';
  if (bpm < 76) return 'Adagio';
  if (bpm < 108) return 'Andante';
  if (bpm < 120) return 'Moderato';
  if (bpm < 168) return 'Allegro';
  return 'Presto';
}

// ---------------------------------------------------------------------------
// Accents and time signatures
// ---------------------------------------------------------------------------

/** Per-beat emphasis: 0 off (silent), 1 soft, 2 normal, 3 accent. */
export type AccentLevel = 0 | 1 | 2 | 3;

export type SignatureId = '2/4' | '3/4' | '4/4' | '5/4' | '6/8' | '7/8' | '12/8';

export interface SignatureDef {
  id: SignatureId;
  /** Display label (same as the id). */
  label: string;
  /** Beats per bar: the numerator. BPM counts these, whatever the denominator. */
  beats: number;
  /** Default accent pattern, one level per beat. Do not mutate; use `defaultAccents`. */
  accents: readonly AccentLevel[];
}

function sig(id: SignatureId, accents: AccentLevel[]): SignatureDef {
  return { id, label: id, beats: accents.length, accents };
}

/** Time signatures in display order. */
export const SIGNATURES: readonly SignatureDef[] = [
  sig('2/4', [3, 2]),
  sig('3/4', [3, 2, 2]),
  sig('4/4', [3, 2, 2, 2]),
  sig('5/4', [3, 2, 2, 2, 2]),
  sig('6/8', [3, 1, 1, 2, 1, 1]),
  sig('7/8', [3, 1, 2, 1, 2, 1, 1]),
  sig('12/8', [3, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1]),
];

const SIGNATURE_BY_ID = new Map<string, SignatureDef>(SIGNATURES.map((s) => [s.id, s]));

/** A fresh, mutable copy of a signature's default accent pattern. */
export function defaultAccents(id: SignatureId): AccentLevel[] {
  return [...(SIGNATURE_BY_ID.get(id) ?? SIGNATURES[2]).accents];
}

// ---------------------------------------------------------------------------
// Sounds
// ---------------------------------------------------------------------------

export type SoundId = 'tone' | 'wood' | 'tom' | 'clap' | 'rim' | 'bell';

export interface SoundDef {
  id: SoundId;
  label: string;
}

/** Click sounds in display order. How each is synthesised lives in voices.ts. */
export const SOUNDS: readonly SoundDef[] = [
  { id: 'tone', label: 'Tone' },
  { id: 'wood', label: 'Woodblock' },
  { id: 'tom', label: '808 Tom' },
  { id: 'clap', label: 'Clap' },
  { id: 'rim', label: 'Rim click' },
  { id: 'bell', label: 'Cowbell' },
];

const SOUND_IDS = new Set<string>(SOUNDS.map((s) => s.id));

// ---------------------------------------------------------------------------
// Subdivision patterns (data-driven; see patterns.json / patterns.schema.json)
// ---------------------------------------------------------------------------

export const PATTERN_SCHEMA_VERSION = 1;

/**
 * What one slot of a pattern does:
 * - `beat`: sounds at the emphasis level of the beat it falls inside
 * - `sub`:  quiet tick
 * - `rest`: silent, time still advances
 */
export type SlotKind = 'beat' | 'sub' | 'rest';

export interface SubdivisionPattern {
  /** Unique slug, `^[a-z0-9][a-z0-9-]{0,31}$`. Stored in settings. */
  id: string;
  /** 1–12 characters (code points, as in the JSON schema), shown on the quick toggle. */
  label: string;
  /** 1–40 characters, the full name shown in the presets list. Defaults to `label`. */
  title: string;
  /** 0–200 characters, one line about the rhythm. Defaults to "". */
  description: string;
  /** Up to 8 lowercase tags for filtering the presets list. Defaults to []. */
  tags: string[];
  /** Equal slots per beat, 1–12. */
  division: number;
  /** Beats the pattern spans before looping, 1–8 (always present once parsed). */
  beats: number;
  /** Exactly `division * beats` entries. */
  slots: SlotKind[];
}

const PATTERN_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SLOT_KINDS = new Set<unknown>(['beat', 'sub', 'rest']);
const TAG_RE = /^[a-z0-9][a-z0-9 -]{0,19}$/;
const MAX_TAGS = 8;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function intInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

/**
 * Tags are lenient, unlike the other fields: each is trimmed and lowercased,
 * anything that is not a valid tag (or is a repeat) is dropped, and only the
 * first MAX_TAGS survive. A bad tag never costs the pattern.
 */
function parseTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().toLowerCase();
    if (!TAG_RE.test(tag) || out.includes(tag)) continue;
    out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

/** String length the way JSON Schema's minLength / maxLength count it: in code points, not UTF-16 units. */
function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n += 1;
  return n;
}

function parsePattern(v: unknown): SubdivisionPattern | null {
  if (!isRecord(v)) return null;
  const { id, label, division, slots } = v;
  if (typeof id !== 'string' || !PATTERN_ID_RE.test(id)) return null;
  if (typeof label !== 'string' || label.length < 1 || codePoints(label) > 12) return null;
  const title = v.title === undefined ? label : v.title;
  if (typeof title !== 'string' || title.length < 1 || codePoints(title) > 40) return null;
  const description = v.description === undefined ? '' : v.description;
  if (typeof description !== 'string' || codePoints(description) > 200) return null;
  if (!intInRange(division, 1, 12)) return null;
  const beats = v.beats === undefined ? 1 : v.beats;
  if (!intInRange(beats, 1, 8)) return null;
  if (!Array.isArray(slots) || slots.length !== division * beats) return null;
  if (!slots.every((s) => SLOT_KINDS.has(s))) return null;
  // A pattern that never sounds would be a silent metronome.
  if (slots.every((s) => s === 'rest')) return null;
  return { id, label, title, description, tags: parseTags(v.tags), division, beats, slots: [...(slots as SlotKind[])] };
}

/**
 * Tolerant reader for a patterns document (`{ version: 1, patterns: [...] }`).
 * Invalid entries and later duplicates of an id are dropped individually;
 * garbage or an unknown version yields `[]`. Never throws.
 */
export function parsePatterns(input: unknown): SubdivisionPattern[] {
  if (!isRecord(input) || input.version !== PATTERN_SCHEMA_VERSION || !Array.isArray(input.patterns)) return [];
  const out: SubdivisionPattern[] = [];
  const seen = new Set<string>();
  for (const raw of input.patterns) {
    const p = parsePattern(raw);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/**
 * The patterns shipped in patterns.json, in display order. The first five are
 * the core subdivisions shown as quick toggles; the rest are presets.
 */
export const BUILTIN_PATTERNS: readonly SubdivisionPattern[] = parsePatterns(patternsJson);

/** Last-resort pattern, hardcoded so it exists even if patterns.json is emptied. */
const QUARTER: SubdivisionPattern = {
  id: 'quarter',
  label: 'Beat',
  title: 'Beat only',
  description: 'One click on every beat.',
  tags: ['basic'],
  division: 1,
  beats: 1,
  slots: ['beat'],
};

/**
 * Look a pattern up by id. An unknown id plays as the first pattern in the
 * list (or a plain one-click-per-beat if the list is empty) — the stored id is
 * left alone, so a preset that is only temporarily missing comes back later.
 */
export function resolvePattern(patterns: readonly SubdivisionPattern[], id: string): SubdivisionPattern {
  return patterns.find((p) => p.id === id) ?? patterns[0] ?? { ...QUARTER, tags: [...QUARTER.tags], slots: [...QUARTER.slots] };
}

/** Every tag used by `patterns`, once each, sorted. */
export function patternTags(patterns: readonly SubdivisionPattern[]): string[] {
  return [...new Set(patterns.flatMap((p) => p.tags))].sort();
}

/**
 * The patterns carrying ALL of `selectedTags`, in their original order. An
 * empty selection returns every pattern. Always a fresh array.
 */
export function filterPatterns(
  patterns: readonly SubdivisionPattern[],
  selectedTags: readonly string[],
): SubdivisionPattern[] {
  return patterns.filter((p) => selectedTags.every((t) => p.tags.includes(t)));
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type MetronomeMode = 'simple' | 'full';

export interface MetronomeSettings {
  mode: MetronomeMode;
  bpm: number;
  signature: SignatureId;
  /** A `SubdivisionPattern` id. Resolved against the pattern list at use time. */
  subdivision: string;
  sound: SoundId;
  /** One level per beat of `signature`. */
  accents: AccentLevel[];
}

export const DEFAULT_METRONOME_SETTINGS: MetronomeSettings = {
  mode: 'simple',
  bpm: BPM_DEFAULT,
  signature: '4/4',
  subdivision: 'quarter',
  sound: 'wood',
  accents: [3, 2, 2, 2],
};

function isAccentLevel(v: unknown): v is AccentLevel {
  return v === 0 || v === 1 || v === 2 || v === 3;
}

/**
 * Tolerant validator for persisted settings: each bad or missing field falls
 * back to its default. A numeric bpm is clamped rather than discarded.
 * `subdivision` only has to look like a pattern id — it is not checked against
 * any pattern list. `accents` must match the signature's beat count with every
 * entry present and 0–3, else it resets to that signature's default. Always returns a
 * fresh object.
 */
export function parseMetronomeSettings(input: unknown): MetronomeSettings {
  const v = isRecord(input) ? input : {};
  const d = DEFAULT_METRONOME_SETTINGS;

  const signature = (typeof v.signature === 'string' && SIGNATURE_BY_ID.get(v.signature)?.id) || d.signature;
  const beats = SIGNATURE_BY_ID.get(signature)!.beats;
  const accents =
    // Array.from makes holes real `undefined`s: `every` skips them, so `new Array(4)` would pass.
    Array.isArray(v.accents) && v.accents.length === beats && Array.from(v.accents).every(isAccentLevel)
      ? ([...v.accents] as AccentLevel[])
      : defaultAccents(signature);

  return {
    mode: v.mode === 'simple' || v.mode === 'full' ? v.mode : d.mode,
    bpm: typeof v.bpm === 'number' && Number.isFinite(v.bpm) ? clampBpm(v.bpm) : d.bpm,
    signature,
    subdivision:
      typeof v.subdivision === 'string' && PATTERN_ID_RE.test(v.subdivision) ? v.subdivision : d.subdivision,
    sound: typeof v.sound === 'string' && SOUND_IDS.has(v.sound) ? (v.sound as SoundId) : d.sound,
    accents,
  };
}

/** Switch time signature. Always resets accents to the new signature's default. */
export function withSignature(settings: MetronomeSettings, id: SignatureId): MetronomeSettings {
  return { ...settings, signature: id, accents: defaultAccents(id) };
}

/**
 * Step one beat's emphasis down a level, wrapping:
 * accent → normal → soft → off → accent. Out-of-range beats are ignored.
 */
export function cycleAccent(settings: MetronomeSettings, beatIndex: number): MetronomeSettings {
  const lvl = settings.accents[beatIndex];
  if (!Number.isInteger(beatIndex) || lvl === undefined) return settings;
  const accents = [...settings.accents];
  accents[beatIndex] = ((lvl + 3) % 4) as AccentLevel;
  return { ...settings, accents };
}

// ---------------------------------------------------------------------------
// Step grid
// ---------------------------------------------------------------------------

export interface Step {
  /** Beat within the bar, 0-based. */
  beat: number;
  /** Slot within that beat, 0 … division-1. */
  sub: number;
  /** True on the first slot of a beat — the beat grid, whatever the slot does. */
  isBeat: boolean;
  /** What the pattern does in this slot. */
  slot: SlotKind;
  /** Seconds until the next step. */
  duration: number;
}

/** Slots in one bar: beats in the signature × the pattern's division. */
export function stepsPerBar(settings: MetronomeSettings, pattern: SubdivisionPattern): number {
  return settings.accents.length * pattern.division;
}

/**
 * Describe slot number `stepIndex` counted from the start of playback.
 *
 * BPM counts the written beat (the numerator's unit): a beat lasts 60 / bpm
 * seconds whatever the denominator, and every slot lasts 60 / bpm / division.
 * The pattern restarts from its slot 0 at each bar line, so a multi-beat
 * pattern that does not divide the bar is cut short there.
 */
export function stepAt(settings: MetronomeSettings, pattern: SubdivisionPattern, stepIndex: number): Step {
  const { division } = pattern;
  const barSlot = stepIndex % stepsPerBar(settings, pattern);
  const sub = barSlot % division;
  return {
    beat: Math.floor(barSlot / division),
    sub,
    isBeat: sub === 0,
    slot: pattern.slots[barSlot % pattern.slots.length],
    duration: 60 / settings.bpm / division,
  };
}

export type Tier = 0 | 1 | 2;

export interface StepSound {
  /** Linear loudness handed to the voice, 0–1. */
  gain: number;
  /** Pitch tier of the voice: 0 low, 1 mid, 2 high. */
  tier: Tier;
}

const LEVEL_GAIN = [0, 0.3, 0.6, 1] as const;
const LEVEL_TIER = [0, 0, 1, 2] as const;
const SUB_SOUND: StepSound = { gain: 0.22, tier: 0 };

/**
 * What a step should sound like, or null for silence. A beat whose level is
 * 0 (off) silences every slot inside it; `rest` slots are always silent.
 */
export function stepSound(settings: MetronomeSettings, step: Step): StepSound | null {
  const lvl = settings.accents[step.beat];
  if (!lvl || step.slot === 'rest') return null;
  if (step.slot === 'sub') return { ...SUB_SOUND };
  return { gain: LEVEL_GAIN[lvl], tier: LEVEL_TIER[lvl] };
}

// ---------------------------------------------------------------------------
// Tap tempo
// ---------------------------------------------------------------------------

/** Taps older than this (ms) are forgotten, so a pause starts a fresh count. */
export const TAP_WINDOW_MS = 2500;

export interface TapResult {
  /** Tap history to pass back in on the next tap (includes this one). */
  times: number[];
  /** Tempo from the average interval, or null until there are two taps. */
  bpm: number | null;
}

/** Register a tap at `nowMs` against the previous taps `timesMs`. */
export function tapTempo(timesMs: readonly number[], nowMs: number): TapResult {
  const times = timesMs.filter((t) => nowMs - t < TAP_WINDOW_MS);
  times.push(nowMs);
  if (times.length < 2) return { times, bpm: null };
  const interval = (nowMs - times[0]) / (times.length - 1);
  return { times, bpm: clampBpm(60000 / interval) };
}
