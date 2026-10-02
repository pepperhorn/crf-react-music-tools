# crf-react-music-tools

A **metronome** and an **instrument tuner** as drop-in React components.

- `MetronomeStandalone` — sample-accurate Web Audio click, tap tempo, seven time signatures, per-beat accents, six sounds, data-driven rhythm presets, simple and full modes.
- `TunerStandalone` — microphone pitch detection (YIN), chromatic and instrument modes (guitar, bass, ukulele, orchestral strings, transposing winds, voice), adjustable A4, two looks ("vintage" and "tiles").
- A precompiled stylesheet: no Tailwind, no CSS reset and no theme tokens needed in your app, and it does not restyle your page.
- Settings are remembered per device (`localStorage`), and everything is safe to server-render.
- No runtime dependencies beyond React (the optional fonts come from `@fontsource`).

> **Status: 0.1.0.** Extracted from an internal app, where both components are in daily use. The API may still change before 1.0.
>
> **Licence: to be decided.** No licence has been chosen yet, so no rights are granted until one is added.

## Install

```sh
pnpm add crf-react-music-tools
# or: npm install crf-react-music-tools
```

React 18 or 19 is a peer dependency.

## Quick start

```tsx
import { MetronomeStandalone, TunerStandalone } from 'crf-react-music-tools';
import 'crf-react-music-tools/styles.css';
import 'crf-react-music-tools/fonts.css'; // optional, see Fonts

export function Tools() {
  return (
    <>
      <MetronomeStandalone />
      <TunerStandalone />
    </>
  );
}
```

That is all: each component owns its settings, its audio and its clean-up.

Each tool is also available on its own entry point, `crf-react-music-tools/metronome` and `crf-react-music-tools/tuner`.

## Styles

### The precompiled stylesheet (default)

```ts
import 'crf-react-music-tools/styles.css';
```

About 45 kB (6 kB gzipped). It is built to be a good guest:

- **Nothing global.** Every rule only matches the library's root elements (class `crf-music-tools`) and what is inside them. There is no reset, no `html` / `body` / `button` rule, no `:root` variables. A host element that happens to have a class such as `flex` or `grid` is not affected.
- **Nothing borrowed.** No theme tokens, no dependency on your root font size (lengths are in `px`), no dependency on your page's line height, alignment or font.
- **No clash with your own Tailwind.** Tailwind's internal custom properties are renamed (`--crfmt-tw-*`), so they cannot collide with a Tailwind 3 or 4 build on the same page.

What it cannot do: stop *your* CSS from reaching in. The library's base rules and utilities have the specificity of a single class, so a host rule such as `button { … }` loses to them, but a stronger one (`#app button { … }`, anything with `!important`) wins. The components carry semantic class names (`metronome-btn-start`, `tuner-lcd`, …) if you want to adjust something on purpose.

The rhythm-presets dialog is rendered in a portal on `document.body`; it carries the same root class, so it is styled wherever it lands.

### If you already use Tailwind CSS 4

You can let your own build generate the classes instead of importing `styles.css`. Add the package to your sources:

```css
@import 'tailwindcss';
@source '../node_modules/crf-react-music-tools/dist';
```

Then do **not** import `styles.css`. Notes for this route:

- The components expect Tailwind's preflight, which your app already has.
- All colours, radii, border widths and fonts are written as explicit values, so no theme tokens are needed. A few utilities do use Tailwind's default scales (spacing such as `h-11`, `text-xs` … `text-xl`, `rounded-xl` / `rounded-2xl`, the `sm` breakpoint); if you have redefined those, the components follow your values.

### Fonts

The designs use four typefaces: **Poppins** (400–700), **Archivo Black**, **Space Mono** (400, 700) and **VT323**. They are not part of `styles.css`.

```ts
import 'crf-react-music-tools/fonts.css'; // optional
```

`fonts.css` imports them from `@fontsource/*`, which this package lists as regular dependencies so the import resolves without any extra install (including under pnpm's strict `node_modules`). Nothing is downloaded by the browser, and nothing is added to your bundle, unless you import this file. Your bundler must be able to follow CSS `@import`s into `node_modules` (Vite and Next.js do).

Without the fonts the components fall back to system faces: the system UI font for text, a heavy system sans for the display type, the system monospace for labels and the tuner's LCD. If you load the fonts some other way, or want different ones, set these custom properties on the components or any ancestor:

| Variable | Used for | Default stack starts with |
| --- | --- | --- |
| `--crfmt-font-ui` | buttons, numerals, body text | Poppins |
| `--crfmt-font-display` | brand marks, BPM, note name | Archivo Black |
| `--crfmt-font-mono` | labels, chips | Space Mono |
| `--crfmt-font-lcd` | the vintage tuner's LCD | VT323 |

## Components

### `<MetronomeStandalone>`

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `storageKey` | `string \| null` | `'crf-music-tools-metronome'` | `localStorage` key. `null` keeps settings in memory only. |
| `defaultSettings` | `MetronomeSettings` | `DEFAULT_METRONOME_SETTINGS` | Used until a stored value is found. |
| `onSettingsChange` | `(next) => void` | – | Told about every change. |
| `onClose` | `() => void` | – | When given, a close (×) button is shown; pressing it stops playback, then calls this. |
| `subtitle` | `string` | – | Small line under the brand mark (card layouts). |
| `patterns` | `readonly SubdivisionPattern[]` | `BUILTIN_PATTERNS` | Your own rhythm presets (see below). Keep the array identity stable. |
| `layout` | `'compact' \| 'wide'` | follows `(min-width: 640px)` | Force a layout. |
| `messages` | `{ noAudio?, interrupted? }` | English | Override the two notices. |
| `createEngine` | `(deps) => MetronomeEngine` | – | Engine factory, for tests or custom voices. |
| `className` | `string` | – | Added to the root element. |

Playback stops when the component unmounts. At 640px and up, simple mode is a 760px-wide panel and full mode a 414px-wide card; below that both fill the available width.

### `<TunerStandalone>`

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `storageKey` | `string \| null` | `'crf-music-tools-tuner'` | `localStorage` key. `null` keeps settings in memory only. |
| `defaultSettings` | `TunerSettings` | `DEFAULT_TUNER_SETTINGS` | Used until a stored value is found. |
| `onSettingsChange` | `(next) => void` | – | Told about every change. |
| `onStart` | `() => void` | – | Called inside the Start click. |
| `onClose` | `() => void` | – | Called after the close (×) button has released the microphone. |
| `startLabel` | `string` | `'Start tuner'` | Text of the start button. |
| `layout` | `'compact' \| 'wide'` | follows `(min-width: 640px)` | Force a layout. |
| `className` | `string` | – | Added to the root element. |

The component first shows a **Start tuner** button, in the current theme. The microphone is only requested after that button is pressed, and is released (track stopped, `AudioContext` closed) when the tuner's close button is pressed or the component unmounts. It is at most 760px wide.

### Low-level components

Use these when your app owns the state — a settings store, a floating panel, playback that continues while the view is hidden.

#### `<Metronome>` + `useMetronome()`

`Metronome` is presentational: no audio, no storage.

```tsx
import { Metronome, useMetronome } from 'crf-react-music-tools';

function MyMetronome() {
  const metronome = useMetronome({ storageKey: 'my-app-metronome' });
  return <Metronome {...metronome} onClose={hidePanel} />;
}
```

`useMetronome(options?)` creates the `MetronomeEngine` on the first Start (never during render), keeps `running` in sync, pushes settings changes to the playing engine, reports audio problems, and disposes the engine when the component using it unmounts. It returns exactly the props `<Metronome>` needs.

| Option | |
| --- | --- |
| `settings`, `onSettingsChange` | Control the settings yourself; storage is then not used. |
| `storageKey`, `defaultSettings` | Uncontrolled settings: where to persist them and what to start from. |
| `patterns`, `createEngine`, `messages` | As on `MetronomeStandalone`. |

| `<Metronome>` prop | Type | |
| --- | --- | --- |
| `settings` | `MetronomeSettings` | `{ mode, bpm, signature, subdivision, sound, accents }` |
| `onSettingsChange` | `(next) => void` | Every change, as a complete settings object. |
| `running` | `boolean` | Whether your engine is playing. |
| `onStart` | `() => void` | Called synchronously inside the Start click. |
| `onStop` | `() => void` | |
| `getBeatState` | `() => BeatState \| null` | Polled once per animation frame while running; `engine.getBeatState()`. |
| `onClose` | `() => void` | Optional. Without it no close button is rendered. |
| `patterns`, `layout`, `message`, `subtitle`, `className` | | Optional. |

To drive it without the hook, use `MetronomeEngine` directly: `engine.start(settings)` (inside the click), `engine.stop()`, `engine.setSettings(settings)`, `engine.subscribe((running, interrupted) => …)`, `engine.getBeatState()`, `engine.dispose()`.

#### `<Tuner>`

Mounting `<Tuner>` starts the microphone; unmounting releases it.

```tsx
import { Tuner, createTunerAudioContext, usePersistentSettings, parseTunerSettings, DEFAULT_TUNER_SETTINGS } from 'crf-react-music-tools';

function MyTuner() {
  const [settings, setSettings] = usePersistentSettings('my-app-tuner', parseTunerSettings, DEFAULT_TUNER_SETTINGS);
  const [ctx, setCtx] = useState<AudioContext | null | undefined>();
  if (ctx === undefined) return <button onClick={() => setCtx(createTunerAudioContext())}>Open tuner</button>;
  return <Tuner settings={settings} onSettingsChange={setSettings} audioContext={ctx} onClose={() => setCtx(undefined)} />;
}
```

| `<Tuner>` prop | Type | |
| --- | --- | --- |
| `settings` | `TunerSettings` | `{ mode, instrument, stringsVariant, windKey, a4, theme, response }` |
| `onSettingsChange` | `(next) => void` | Every change, as a complete settings object. |
| `audioContext` | `AudioContext \| null` | A context created with `createTunerAudioContext()` inside the opening click. The tuner takes ownership and closes it. |
| `onClose` | `() => void` | Optional. Without it no close button is rendered. |
| `layout`, `className` | | Optional. |

To build your own display, `useMicPitch(audioContext, options)` returns `{ status, freq, restart }`, and `computeReading(freq, settings, lockedStringIndex)` turns a frequency into a note, cents and hint.

### Other exports

- `usePersistentSettings(key, parse, defaults)` — `[value, setValue]` backed by `localStorage`, hydration-safe, falling back to memory when storage is unavailable.
- Metronome model: `DEFAULT_METRONOME_SETTINGS`, `parseMetronomeSettings`, `SIGNATURES`, `SOUNDS`, `BPM_MIN` / `BPM_MAX` / `BPM_DEFAULT`, `clampBpm`, `tempoName`, `withSignature`, `cycleAccent`, `defaultAccents`, `tapTempo`, `BUILTIN_PATTERNS`, `parsePatterns`, `resolvePattern`, `patternTags`, `filterPatterns`, `VOICES`, `createTickTimer`, and their types.
- Tuner model: `DEFAULT_TUNER_SETTINGS`, `parseTunerSettings`, `INSTRUMENTS`, `STRINGS_VARIANTS`, `STRING_PRESETS`, `WIND_KEYS`, `TUNER_THEMES`, `TUNER_RESPONSES`, `RESPONSE_PROFILES`, `A4_MIN` / `A4_MAX` / `A4_DEFAULT`, `clampA4`, `detectPitch`, `freqToNote`, `midiToFreq`, `centsBetween`, `noteName`, `noteLabel`, `parseNote`, `getStrings`, `nearestString`, `writtenMidi`, `formatCents`, `formatHz`, and their types.
- `METRONOME_STORAGE_KEY`, `TUNER_STORAGE_KEY`, `METRONOME_MESSAGES`.

## Metronome patterns

The subdivision buttons and the Presets list are data. A pattern divides the beat into `division` equal slots and spans `beats` beats before it loops; each slot is one of:

- `beat` — sounds at the emphasis of the beat it falls in (accent / normal / soft),
- `sub` — a quiet tick,
- `rest` — silent.

```json
{
  "$schema": "./node_modules/crf-react-music-tools/dist/patterns.schema.json",
  "version": 1,
  "patterns": [
    { "id": "quarter", "label": "Beat", "title": "Beat only", "description": "One click on every beat.", "tags": ["basic"], "division": 1, "slots": ["beat"] },
    { "id": "swing", "label": "Swing", "title": "Swing eighths", "description": "Long–short eighths on a triplet grid.", "tags": ["swing"], "division": 3, "slots": ["beat", "rest", "sub"] },
    { "id": "tresillo", "label": "Tresillo", "title": "Tresillo (3+3+2)", "tags": ["latin"], "division": 4, "beats": 2, "slots": ["beat", "rest", "rest", "beat", "rest", "rest", "beat", "rest"] }
  ]
}
```

| Field | | |
| --- | --- | --- |
| `id` | required | Slug, `^[a-z0-9][a-z0-9-]{0,31}$`, unique. This is what is stored in a user's settings. |
| `label` | required | 1–12 characters, shown on the quick-toggle button. |
| `title` | optional | 1–40 characters, shown in the Presets list. Defaults to `label`. |
| `description` | optional | Up to 200 characters. |
| `tags` | optional | Up to 8 lowercase tags; they become the filter chips. |
| `division` | required | Slots per beat, 1–12. |
| `beats` | optional | Beats the pattern spans, 1–8. Default 1. |
| `slots` | required | Exactly `division × beats` entries, at least one of them `beat` or `sub`. |

The first five patterns are the quick toggles; all of them appear under Presets.

```tsx
import { MetronomeStandalone, parsePatterns } from 'crf-react-music-tools';
import myPatterns from './patterns.json';

const PATTERNS = parsePatterns(myPatterns); // once, at module level

<MetronomeStandalone patterns={PATTERNS} />;
```

`parsePatterns` validates the document and drops invalid entries one by one, so a bad pattern never breaks the metronome. The JSON Schema is published as `crf-react-music-tools/patterns.schema.json` (`dist/patterns.schema.json` in the package; `src/metronome/patterns.schema.json` in this repository), and the built-in list is `src/metronome/patterns.json`.

## Server rendering

Both components can be rendered on the server (Next.js, Astro, Remix, …). The server render and the first client render always use the default settings and the compact layout, so hydration matches; stored settings and the real layout are applied straight after mount. No audio object is created during render — the metronome's engine is made on the first Start and the tuner's `AudioContext` in its Start click.

In frameworks with server components, render them from a client component (`'use client'`).

## Audio, microphone and iOS

- **A user gesture is required.** Browsers — iOS Safari most strictly — only let audio start from a tap or click. The metronome starts its `AudioContext` synchronously inside the Start press, and the tuner creates its context inside the Start press. If you use the low-level components, keep that property: call `onStart` / `engine.start()` / `createTunerAudioContext()` directly in the event handler, not after an `await` or a timeout.
- **The microphone needs a secure origin**: `https://`, or `localhost` during development. On an insecure origin the tuner says so instead of asking.
- **Interruptions.** A phone call, Siri or backgrounding the page can suspend audio. The metronome stops and shows a notice; the tuner resumes when it can and otherwise offers a Restart button.
- **The iOS ringer switch** silences Web Audio. That is the platform's behaviour.
- **Privacy.** Microphone audio is analysed in the browser and is never recorded or sent anywhere.

## Browser support

Current evergreen browsers: Chrome / Edge 111+, Firefox 128+, Safari 16.4+ (the same floor as Tailwind CSS 4, which generates the stylesheet). The components need the Web Audio API, and the tuner needs `getUserMedia`.

## Development

```sh
pnpm install
pnpm dev         # demo page on http://localhost:5180 (bound to 0.0.0.0)
pnpm test        # vitest: `node` project (*.test.ts) and `dom` project (*.test.tsx, jsdom)
pnpm typecheck   # tsc --noEmit, strict
pnpm build       # dist/: ESM + .d.ts, styles.css, fonts.css, patterns.schema.json
pnpm pack        # build, then create the tarball
```

- `src/metronome`, `src/tuner` — the components, each self-contained. `src/shared` — the persistence hook and shared class fragments.
- `src/styles` — the Tailwind input, the scoped base rules and `fonts.css`. `scripts/build-css.mjs` compiles and scopes the stylesheet.
- `demo/` — a page with every component in every mode and theme. It has no CSS of its own, so it shows exactly what a bare host page gets. `?fonts=0` skips the fonts; `?hostile=1` adds an aggressive host stylesheet.

When you add or change classes in a component, keep them host-independent: explicit values instead of theme tokens (`border-[#141210]`, not `border-border`), and a semantic class name next to the utilities.
