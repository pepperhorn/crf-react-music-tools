/** Public API of the metronome. */
export { Metronome } from './Metronome';
export type { MetronomeProps, MetronomeLayout } from './Metronome';
export { MetronomeStandalone } from './MetronomeStandalone';
export type { MetronomeStandaloneProps } from './MetronomeStandalone';
export { useMetronome, METRONOME_STORAGE_KEY, METRONOME_MESSAGES } from './useMetronome';
export type { UseMetronomeOptions, UseMetronomeResult } from './useMetronome';

export { MetronomeEngine, createTickTimer } from './engine';
export type { BeatState, MetronomeEngineDeps, MetronomeListener, MetronomeTimer } from './engine';
export { VOICES } from './voices';
export type { Voice } from './voices';

export {
  BPM_MIN,
  BPM_MAX,
  BPM_DEFAULT,
  clampBpm,
  tempoName,
  SIGNATURES,
  SOUNDS,
  defaultAccents,
  withSignature,
  cycleAccent,
  tapTempo,
  DEFAULT_METRONOME_SETTINGS,
  parseMetronomeSettings,
  PATTERN_SCHEMA_VERSION,
  BUILTIN_PATTERNS,
  parsePatterns,
  resolvePattern,
  patternTags,
  filterPatterns,
} from './model';
export type {
  AccentLevel,
  MetronomeMode,
  MetronomeSettings,
  SignatureDef,
  SignatureId,
  SlotKind,
  SoundDef,
  SoundId,
  SubdivisionPattern,
  TapResult,
  Tier,
} from './model';
