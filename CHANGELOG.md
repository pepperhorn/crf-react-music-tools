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
- `crf-react-music-tools/styles.css`: a precompiled stylesheet scoped to the
  library's own elements, usable without Tailwind CSS.
- `crf-react-music-tools/fonts.css`: optional self-hosted fonts.
- `crf-react-music-tools/patterns.schema.json`: JSON Schema for custom
  metronome rhythm patterns.
- Entry points `crf-react-music-tools/metronome` and `crf-react-music-tools/tuner`.

### Changed (compared with the components in the app they came from)

- The close button is optional: it is rendered only when `onClose` is given.
- The metronome has no subtitle unless the `subtitle` prop is set.
- Classes that depended on the app's Tailwind theme are now explicit values.
- Font stacks have system fallbacks and can be overridden with
  `--crfmt-font-*` custom properties.
