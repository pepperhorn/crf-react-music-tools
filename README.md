# @pepperhorn/react-music-tools

A **metronome** and an **instrument tuner** as drop-in React components.

- `MetronomeStandalone` — sample-accurate Web Audio click, tap tempo, seven time signatures, per-beat accents, six sounds, data-driven rhythm presets, simple and full modes.
- `TunerStandalone` — microphone pitch detection (YIN), chromatic and instrument modes (guitar, bass, ukulele, orchestral strings, transposing winds, voice), adjustable A4, two looks ("vintage" and "tiles").
- `MusicToolsBar` — both tools as two icon buttons for a page header, each opening in a floating panel; the metronome keeps playing with its panel closed.
- A precompiled stylesheet: no Tailwind, no CSS reset and no theme tokens needed in your app, and it does not restyle your page.
- Settings are remembered per device (`localStorage`), and everything is safe to server-render.
- No runtime dependencies beyond React (the optional fonts come from `@fontsource`).

> **Status: 0.1.0.** Extracted from an internal app, where both components are in daily use. The API may still change before 1.0.

Licence: [MIT](./LICENSE).

## Install

```sh
pnpm add @pepperhorn/react-music-tools
# or: npm install @pepperhorn/react-music-tools
```

React 18 or 19 is a peer dependency.

## Quick start

```tsx
import { MetronomeStandalone, TunerStandalone } from '@pepperhorn/react-music-tools';
import '@pepperhorn/react-music-tools/styles.css';
import '@pepperhorn/react-music-tools/fonts.css'; // optional, see Fonts

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

Each tool is also available on its own entry point, `@pepperhorn/react-music-tools/metronome` and `@pepperhorn/react-music-tools/tuner`, and the header toolbar on `@pepperhorn/react-music-tools/toolbar`.

## Header toolbar

To put both tools in a page header without building the buttons and floating panels yourself:

```tsx
import { MusicToolsBar } from '@pepperhorn/react-music-tools/toolbar';
import '@pepperhorn/react-music-tools/styles.css';

<header className="site-header">
  …
  <MusicToolsBar align="end" topOffset={64} />
</header>
```

It renders two 40px icon buttons (a tuning fork and a metronome). Each opens its tool in a floating, non-modal dialog:

- **One panel at a time.** Opening one closes the other, without moving focus back.
- **Tuner**: opens straight from the button — the `AudioContext` is created inside that click, so there is no "Start tuner" step — and the microphone is released when the panel closes or the bar unmounts.
- **Metronome**: the engine belongs to the bar, not to the panel, so it **keeps playing while the panel is closed**. The button then turns green, shows a small pulsing dot (still, under `prefers-reduced-motion`) and is named "Open metronome (running)". Playback stops when the bar unmounts.
- **Keyboard**: focus moves into the panel when it opens; the × button and Escape close it and return focus to the button. Escape only acts when focus is in the panel or on its button, and never when another dialog owns the key. The buttons carry `aria-expanded` / `aria-controls`.
- **Settings** are remembered per device, under the same default keys as the standalone components.
- **Server rendering**: the server and the first client render are just the two closed buttons.

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `tools` | `('tuner' \| 'metronome')[]` | `['tuner', 'metronome']` | Which buttons to show, in order. |
| `align` | `'start' \| 'end'` | `'start'` | From 640px, which edge of the bar the panel lines up with. Use `'end'` for a bar at the right of the header. A side that would leave the viewport flips to the other, and the panel is always kept 16px inside both edges. |
| `topOffset` | `number \| string` | – | How much of the top of the viewport your sticky / fixed header covers: px, or any CSS length (`'4rem'`, `'var(--header-height)'`). See below. |
| `anchor` | `RefObject<HTMLElement>` \| `HTMLElement` \| `string` | the bar | What the panels hang under. A ref, an element, or a CSS selector — the button's closest matching ancestor, else the first match in the document. See below. |
| `fit` | `'shift' \| 'shrink'` | `'shift'` | From 640px, what happens when the panel does not fit at its aligned edge: keep its width and move it, or keep its edge and narrow it. See below. |
| `compactTop` | `'below-bar' \| 'offset'` | `'below-bar'` | Under 640px, whether the card stays below the bar or is pinned 8px under `topOffset`. See below. |
| `panelZIndex` | `number` | `1150` | z-index of the panels. |
| `storageKeys` | `{ tuner?, metronome? }` | `'crf-music-tools-tuner'`, `'crf-music-tools-metronome'` | `localStorage` keys. `null` keeps that tool's settings in memory only. |
| `defaultSettings` | `{ tuner?, metronome? }` | the library defaults | Used until stored values are found. |
| `patterns` | `readonly SubdivisionPattern[]` | `BUILTIN_PATTERNS` | The metronome's rhythm presets. Keep the array identity stable. |
| `subtitle` | `string` | – | Small line under the metronome's brand mark. |
| `messages` | `{ noAudio?, interrupted? }` | English | The metronome's two notices, shown in its panel. |
| `labels` | `Partial<MusicToolsLabels>` | English | The buttons' and panels' accessible names: `openTuner`, `closeTuner`, `tuner`, `openMetronome`, `openMetronomeRunning`, `closeMetronome`, `metronome`. |
| `onOpenChange` | `(open: 'tuner' \| 'metronome' \| null) => void` | – | Which panel is open now. |
| `className`, `buttonClassName`, `panelClassName` | `string` | – | Added to the bar, to each button and to the floating panel. |
| `createEngine` | `(deps) => MetronomeEngine` | – | Engine factory, for tests or custom voices. |

For only one of the tools, or to place the buttons apart, use `<TunerToolButton>` and `<MetronomeToolButton>`. They take the same positioning and class props, `storageKey` / `defaultSettings` / `onSettingsChange` for their own tool, and `onOpenChange(open: boolean)`; the one-panel-at-a-time rule still holds between them. The icons are exported as `TuningForkIcon` and `MetronomeIcon` (`size`, `className`; drawn with `currentColor`).

### Where the panel goes

- **Under 640px** it is a full-width card with 16px gutters.
- **From 640px** it hangs under the bar (or your `anchor`), as wide as the tool (760px; 414px for the metronome's full mode) or as the viewport allows.
- It is never taller than the space below its top edge; it scrolls inside instead.
- It is measured when it opens and again when the window is resized.

**Sticky and fixed headers — `topOffset`.** Without it the panel starts 8px below the bar. In a header that is taller than the bar, that leaves the panel overlapping the bottom of the header, so tell the bar how tall the header is: the panel then starts 8px below `topOffset`, or 8px below the bar if the bar is lower still (a bar in the page content rather than in the header). It never sits above the bar.

```tsx
<MusicToolsBar topOffset={64} />                       {/* a 64px header */}
<MusicToolsBar topOffset="var(--header-height)" />     {/* any CSS length */}
```

**A bar inside a wider strip — `anchor`.** By default the panel lines up with the bar itself (the nearest `.crfmt-toolbar` ancestor of the button; a tool button used on its own is its own anchor). When the bar is one item in a wider strip of your own controls, name the strip and the panel hangs under it instead: `align` then refers to the strip's edges, and the panel starts 8px below the strip's bottom edge.

```tsx
<div className="tools-strip" ref={stripRef}>
  <button>…</button>
  <MusicToolsBar anchor={stripRef} />          {/* a ref */}
  <MusicToolsBar anchor=".tools-strip" />      {/* or a selector: the closest ancestor, else document.querySelector */}
</div>
```

The anchor is looked up each time the panel is measured, so a ref that is filled after render works. Anything that does not resolve (an empty ref, no match, an invalid selector) falls back to the default.

**A panel that does not fit — `fit`.** With the default, `'shift'`, the panel keeps its full width: it flips to the other edge of the anchor, or is moved until it is inside the viewport. In a layout with a sidebar that can put it over the sidebar — at an 820px viewport, a 760px panel anchored at x = 280 ends up at x = 44. `fit="shrink"` keeps the aligned edge where it is and narrows the panel to the room between that edge and the 16px gutter on the far side (524px in that example); it never flips. A panel narrower than the tool's wide layout is ever given otherwise (608px; 414px for the metronome's full mode) switches the tool to its stacked, phone layout, which fills any width. Below 320px of room, `'shrink'` gives up and behaves like `'shift'`.

**A fixed top bar with the toolbar further down — `compactTop`.** Under 640px the card normally stays below the bar, like the anchored panel. If your phone layout has a fixed top bar and the toolbar sits lower in the page, `compactTop="offset"` pins the card 8px under `topOffset` wherever the bar is — `max(topOffset + 8px, env(safe-area-inset-top))` — and caps its height from there. The card can then cover the bar itself; it is closed with its × button or Escape. From 640px nothing changes. Without a `topOffset` the card sits at the 16px gutter.

```tsx
<MusicToolsBar topOffset="3rem" compactTop="offset" fit="shrink" anchor=".tools-strip" />
```

**Headers that clip.** The panel is rendered in a portal on `document.body`, so a header with `overflow: hidden`, a `transform` or a `backdrop-filter` neither clips it nor becomes its containing block. The portal element carries the library's root class, so the stylesheet applies there too. Two consequences: custom properties for the *panel* (`--crfmt-font-*`, `--crfmt-toolbar-panel-z`) must be set on `:root` / `body` or through `panelClassName`, not on your header; and in the tab order the panel comes after the rest of the page (focus is moved into it on open and back to the button on close).

### Restyling the buttons

The buttons look right on a bare page — white with a hairline border and a dark icon, yellow with a dark border while open, green while the metronome runs — and every value is a custom property you can set on the bar or any ancestor:

| Variable | Default | |
| --- | --- | --- |
| `--crfmt-toolbar-size` | `40px` | Width and height of a button. The hit area stays at least 44px. |
| `--crfmt-toolbar-gap` | `8px` | Space between the buttons. |
| `--crfmt-toolbar-radius` | `10px` | Corner radius. |
| `--crfmt-toolbar-border-width` | `1px` | Border width of a button. |
| `--crfmt-toolbar-cursor` | `pointer` | Cursor over a button. |
| `--crfmt-toolbar-transition` | `color 150ms cubic-bezier(0.4,0,0.2,1), background-color …, border-color …` | The button's whole `transition` (`none` switches it off). |
| `--crfmt-toolbar-button-bg` | `#fff` | Fill. |
| `--crfmt-toolbar-button-hover-bg` | `#f4f2ee` | Fill on hover. |
| `--crfmt-toolbar-button-border` | `#d6d3cd` | Border. |
| `--crfmt-toolbar-button-color` | `#141210` | Icon colour. |
| `--crfmt-toolbar-open-bg` | `#fff56d` | Fill while the panel is open. |
| `--crfmt-toolbar-running-bg` | `#6bc6a0` | Fill while the metronome is playing. |
| `--crfmt-toolbar-running-hover-bg` | `#7fd0ad` | The same, on hover. |
| `--crfmt-toolbar-active-border` | `#141210` | Border while open or running, and around the dot. |
| `--crfmt-toolbar-dot-bg` | `#f86e6e` | The "running" dot. |
| `--crfmt-toolbar-dot-size` | `10px` | Width and height of the dot. |
| `--crfmt-toolbar-dot-border-width` | `1px` | Border width of the dot. |
| `--crfmt-toolbar-dot-pulse-duration` | `1.6s` | Length of one pulse. |
| `--crfmt-toolbar-dot-pulse-opacity` | `.35` | Opacity at the low point of the pulse (`1` keeps the dot steady). |
| `--crfmt-toolbar-focus` | `#141210` | Focus ring (2px, offset 2px). Change it on a dark header. |
| `--crfmt-toolbar-panel-z` | `1150` | z-index of the panels (set on `:root`, or use `panelZIndex`). The default is above the usual sticky headers and app bars and below the usual modals. |

```css
.site-header {
  --crfmt-toolbar-button-bg: transparent;
  --crfmt-toolbar-button-border: rgb(255 255 255 / 0.4);
  --crfmt-toolbar-button-color: #fff;
  --crfmt-toolbar-focus: #fff;
}
```

For anything else there are semantic class names — `crfmt-toolbar`, `crfmt-tool`, `crfmt-tool-toggle` (plus `-tuner` / `-metronome`, `-open`, `-running`), `crfmt-tool-toggle-dot`, `crfmt-tool-portal`, `crfmt-tool-panel` (plus `-tuner` / `-metronome`) — and `className` / `buttonClassName` / `panelClassName`. The library's rules have the specificity of one class, so a class of yours declared after `styles.css` wins.

### Astro view transitions

The metronome plays for as long as the bar stays mounted, so with Astro's `<ClientRouter />` keep the island alive across navigations:

```astro
<MusicToolsBar client:load transition:persist align="end" topOffset={64} />
```

A view transition replaces `document.body`, which would strand the panel's portal in the discarded body. The bar listens for `astro:before-swap` / `astro:after-swap`: a persisted bar moves its open panel into the new body and measures again (the tuner keeps its microphone session), and a bar that was not persisted closes its panel, releases the microphone and stops the metronome. Nothing is imported from Astro; on other hosts those events never fire.

## Styles

### The precompiled stylesheet (default)

```ts
import '@pepperhorn/react-music-tools/styles.css';
```

About 54 kB (8 kB gzipped). It is built to be a good guest:

- **Nothing global.** Every rule only matches the library's root elements (class `crf-music-tools`) and what is inside them. There is no reset, no `html` / `body` / `button` rule, no `:root` variables. A host element that happens to have a class such as `flex` or `grid` is not affected.
- **Nothing borrowed.** No theme tokens, no dependency on your root font size (lengths are in `px`), no dependency on your page's line height, alignment or font.
- **No clash with your own Tailwind.** Tailwind's internal custom properties are renamed (`--crfmt-tw-*`), so they cannot collide with a Tailwind 3 or 4 build on the same page.

What it cannot do: stop *your* CSS from reaching in. The library's base rules and utilities have the specificity of a single class, so a host rule such as `button { … }` loses to them, but a stronger one (`#app button { … }`, anything with `!important`) wins. The components carry semantic class names (`metronome-btn-start`, `tuner-lcd`, …) if you want to adjust something on purpose.

The rhythm-presets dialog and the header toolbar's floating panels are rendered in portals on `document.body`; they carry the same root class, so they are styled wherever they land.

### If you already use Tailwind CSS 4

You can let your own build generate the classes instead of importing `styles.css`. Add the package to your sources:

```css
@import 'tailwindcss';
@source '../node_modules/@pepperhorn/react-music-tools/dist';
```

Then do **not** import `styles.css`. Notes for this route:

- The components expect Tailwind's preflight, which your app already has.
- All colours, radii, border widths and fonts are written as explicit values, so no theme tokens are needed. A few utilities do use Tailwind's default scales (spacing such as `h-11`, `text-xs` … `text-xl`, `rounded-xl` / `rounded-2xl`, the `sm` breakpoint); if you have redefined those, the components follow your values.

### Fonts

The designs use four typefaces: **Poppins** (400–700), **Archivo Black**, **Space Mono** (400, 700) and **VT323**. They are not part of `styles.css`.

```ts
import '@pepperhorn/react-music-tools/fonts.css'; // optional
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
import { Metronome, useMetronome } from '@pepperhorn/react-music-tools';

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
import { Tuner, createTunerAudioContext, usePersistentSettings, parseTunerSettings, DEFAULT_TUNER_SETTINGS } from '@pepperhorn/react-music-tools';

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
- Toolbar: `MusicToolsBar`, `TunerToolButton`, `MetronomeToolButton`, `TuningForkIcon`, `MetronomeIcon`, `DEFAULT_MUSIC_TOOLS_LABELS`, the positioning functions `computePanelPosition`, `panelBox`, `panelLeft`, `panelWidth`, `panelTop`, `panelCompactTop`, `panelLayout` (with `PANEL_GAP`, `PANEL_GUTTER`, `PANEL_MIN_WIDTH`, `PANEL_WIDE_MIN`), and their types.

## Metronome patterns

The subdivision buttons and the Presets list are data. A pattern divides the beat into `division` equal slots and spans `beats` beats before it loops; each slot is one of:

- `beat` — sounds at the emphasis of the beat it falls in (accent / normal / soft),
- `sub` — a quiet tick,
- `rest` — silent.

```json
{
  "$schema": "./node_modules/@pepperhorn/react-music-tools/dist/patterns.schema.json",
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
import { MetronomeStandalone, parsePatterns } from '@pepperhorn/react-music-tools';
import myPatterns from './patterns.json';

const PATTERNS = parsePatterns(myPatterns); // once, at module level

<MetronomeStandalone patterns={PATTERNS} />;
```

`parsePatterns` validates the document and drops invalid entries one by one, so a bad pattern never breaks the metronome. The JSON Schema is published as `@pepperhorn/react-music-tools/patterns.schema.json` (`dist/patterns.schema.json` in the package; `src/metronome/patterns.schema.json` in this repository), and the built-in list is `src/metronome/patterns.json`.

## Server rendering

All the components can be rendered on the server (Next.js, Astro, Remix, …). The server render and the first client render always use the default settings and the compact layout, so hydration matches; stored settings and the real layout are applied straight after mount. No audio object is created during render — the metronome's engine is made on the first Start and the tuner's `AudioContext` in its Start click. The header toolbar renders only its two closed buttons until one is pressed.

In frameworks with server components, render them from a client component (`'use client'`).

## Audio, microphone and iOS

- **A user gesture is required.** Browsers — iOS Safari most strictly — only let audio start from a tap or click. The metronome starts its `AudioContext` synchronously inside the Start press, and the tuner creates its context inside the Start press (in the header toolbar: inside the press on the tuner button). If you use the low-level components, keep that property: call `onStart` / `engine.start()` / `createTunerAudioContext()` directly in the event handler, not after an `await` or a timeout.
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

- `src/metronome`, `src/tuner` — the components, each self-contained. `src/toolbar` — the header toolbar built on them. `src/shared` — the persistence hook and shared class fragments.
- `src/styles` — the Tailwind input, the scoped base rules and `fonts.css`. `scripts/build-css.mjs` compiles and scopes the stylesheet.
- `demo/` — a page with every component in every mode and theme, under a sticky header that holds the toolbar. It has no CSS of its own, so it shows exactly what a bare host page gets. `?fonts=0` skips the fonts; `?hostile=1` adds an aggressive host stylesheet; `?strip=1`, `?sidebar=280`, `?anchor=strip`, `?fit=shrink` and `?compact-top=offset` exercise the toolbar's positioning options (the full list is at the top of `demo/main.tsx`).

When you add or change classes in a component, keep them host-independent: explicit values instead of theme tokens (`border-[#141210]`, not `border-border`), and a semantic class name next to the utilities.
