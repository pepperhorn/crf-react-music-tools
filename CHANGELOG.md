# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-02

First version, extracted from an internal app.

### Added

- `Metronome` and `Tuner`: the presentational components, with their models,
  the metronome audio engine and the tuner's microphone pitch hook.
- `MetronomeStandalone` and `TunerStandalone`: drop-in components that own
  their settings, audio and clean-up. The tuner asks for the microphone only
  after its Start button is pressed.
- `useMetronome` and `usePersistentSettings` hooks.
- `@pepperhorn/react-music-tools/styles.css`: a precompiled stylesheet scoped to the
  library's own elements, usable without Tailwind CSS.
- `@pepperhorn/react-music-tools/fonts.css`: optional self-hosted fonts.
- `@pepperhorn/react-music-tools/patterns.schema.json`: JSON Schema for custom
  metronome rhythm patterns.
- `MusicToolsBar`: a ready-made header toolbar — the tuner and the metronome as
  two icon buttons, each opening in a floating, non-modal panel. One panel at a
  time; the tuner opens straight from its button and releases the microphone
  when its panel closes; the metronome keeps playing with its panel closed and
  the button shows it. The panels are portalled to `document.body` (so a
  header with `overflow: hidden`, a transform or a `backdrop-filter` cannot
  clip them), stay inside the viewport (`align`, automatic flip, `topOffset`
  for sticky headers) and survive Astro view transitions. The buttons are
  restylable through `--crfmt-toolbar-*` custom properties.
- `TunerToolButton`, `MetronomeToolButton`, `TuningForkIcon`, `MetronomeIcon`
  and the positioning functions, for hosts that want only part of the toolbar.
- Entry points `@pepperhorn/react-music-tools/metronome`,
  `@pepperhorn/react-music-tools/tuner` and `@pepperhorn/react-music-tools/toolbar`.

### Changed (compared with the components in the app they came from)

- The close button is optional: it is rendered only when `onClose` is given.
- The metronome has no subtitle unless the `subtitle` prop is set.
- Classes that depended on the app's Tailwind theme are now explicit values.
- Font stacks have system fallbacks and can be overridden with
  `--crfmt-font-*` custom properties.
