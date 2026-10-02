/** Every string the toolbar itself puts on the page (all are accessible names / tooltips). */
export interface MusicToolsLabels {
  /** The tuner button while its panel is closed. */
  openTuner: string;
  /** The tuner button while its panel is open. */
  closeTuner: string;
  /** Accessible name of the tuner panel. */
  tuner: string;
  /** The metronome button while its panel is closed and it is not playing. */
  openMetronome: string;
  /** The metronome button while its panel is closed and it is playing. */
  openMetronomeRunning: string;
  /** The metronome button while its panel is open. */
  closeMetronome: string;
  /** Accessible name of the metronome panel. */
  metronome: string;
}

export const DEFAULT_MUSIC_TOOLS_LABELS: MusicToolsLabels = {
  openTuner: 'Open tuner',
  closeTuner: 'Close tuner',
  tuner: 'Tuner',
  openMetronome: 'Open metronome',
  openMetronomeRunning: 'Open metronome (running)',
  closeMetronome: 'Close metronome',
  metronome: 'Metronome',
};
