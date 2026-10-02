/**
 * Demo / manual test page. Deliberately has NO stylesheet of its own: the
 * only CSS on the page is the library's `styles.css` (and `fonts.css`), so
 * what you see is what a bare host page gets. The plain <h1>, <p> and
 * <button> below must look exactly like unstyled browser defaults.
 *
 * Query flags:
 *   ?fonts=0   skip fonts.css (check the system-font fallbacks)
 *   ?hostile=1 add an aggressive host stylesheet (check isolation the other way)
 *   ?header=0 hide the sticky site header that holds the toolbar
 *   ?align=start | end, ?offset=<px or CSS length> (or `none`): the toolbar's `align` / `topOffset`
 *   ?only=toolbar | metronome-simple | metronome-full | tuner-vintage | tuner-vintage-full | tuner-tiles | tuner-tiles-full
 */
import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DEFAULT_METRONOME_SETTINGS,
  DEFAULT_TUNER_SETTINGS,
  MetronomeStandalone,
  TunerStandalone,
  type MetronomeSettings,
  type TunerSettings,
} from '@pepperhorn/react-music-tools';
import { MusicToolsBar, type MusicTool } from '@pepperhorn/react-music-tools/toolbar';
import '@pepperhorn/react-music-tools/styles.css';

const params = new URLSearchParams(location.search);
if (params.get('fonts') !== '0') void import('@pepperhorn/react-music-tools/fonts.css');
if (params.get('hostile') === '1') {
  const style = document.createElement('style');
  style.textContent = `
    html { font-size: 10px; }
    body { font: 20px/2 Georgia, serif; text-align: center; letter-spacing: 2px; color: purple; }
    * { box-sizing: content-box; }
    button { background: tomato; color: white; padding: 20px; border: 4px dotted blue; border-radius: 20px; text-transform: lowercase; margin: 8px; }
    div { margin: 0; } p { margin: 2em; } span { font-style: italic; } svg { display: inline; }
  `;
  document.head.append(style);
}
const only = params.get('only');

const metronome = (patch: Partial<MetronomeSettings>): MetronomeSettings => ({ ...DEFAULT_METRONOME_SETTINGS, ...patch });
const tuner = (patch: Partial<TunerSettings>): TunerSettings => ({ ...DEFAULT_TUNER_SETTINGS, ...patch });

function Example({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  if (only && only !== id) return null;
  return (
    <section id={id} className="demo-example" style={{ margin: '0 0 32px' }}>
      <h2 className="demo-example-title">{title}</h2>
      {children}
    </section>
  );
}

const HEADER_HEIGHT = 56;
const align = params.get('align') === 'start' ? 'start' : 'end';
const offsetParam = params.get('offset');
const topOffset = offsetParam === 'none' ? undefined : (offsetParam ?? HEADER_HEIGHT);

/**
 * A fake site header, sticky at the top of a long page, with the toolbar at
 * its right edge. `overflow: hidden` and `backdrop-filter` are there on
 * purpose: both would clip (or re-anchor) a panel rendered inside the header,
 * which is why the toolbar's panels are portalled to <body>.
 */
function SiteHeader({ onOpenChange }: { onOpenChange: (open: MusicTool | null) => void }) {
  return (
    <header
      id="demo-header"
      className="demo-site-header"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        height: HEADER_HEIGHT,
        boxSizing: 'border-box',
        margin: '-8px -8px 16px',
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        overflow: 'hidden',
        background: 'rgba(255, 255, 255, 0.72)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderBottom: '1px solid #d6d3cd',
      }}
    >
      <strong id="demo-header-title" className="demo-site-title">Site header</strong>
      <MusicToolsBar
        align={align}
        topOffset={topOffset}
        subtitle="Demo"
        storageKeys={{ tuner: 'crf-music-tools-demo-toolbar-tuner', metronome: 'crf-music-tools-demo-toolbar-metronome' }}
        onOpenChange={onOpenChange}
      />
    </header>
  );
}

function App() {
  const [clicks, setClicks] = useState(0);
  const [closed, setClosed] = useState(0);
  const [openTool, setOpenTool] = useState<MusicTool | null>(null);
  return (
    <main className="demo-page">
      {params.get('header') !== '0' && <SiteHeader onOpenChange={setOpenTool} />}
      <h1 id="host-heading" className="demo-heading">@pepperhorn/react-music-tools</h1>
      <p id="host-paragraph" className="demo-intro">
        This heading, paragraph and button belong to the host page. The library stylesheet must leave them alone.
      </p>
      <button id="host-button" className="demo-host-button" type="button" onClick={() => setClicks((n) => n + 1)}>
        Host button (clicked {clicks})
      </button>
      {/* Generic class names a host might use for its own purposes: must not pick up utility styles. */}
      <div id="host-collision" className="flex grid fixed hidden border-2 uppercase p-4">
        Host element with the classes “flex grid fixed hidden border-2 uppercase p-4”.
      </div>

      <Example id="toolbar" title="Header toolbar — MusicToolsBar">
        <p id="toolbar-note" className="demo-note">
          The two buttons at the right of the sticky header above are <code>&lt;MusicToolsBar align="end" topOffset={'{'}56{'}'} /&gt;</code>.
          The header has <code>overflow: hidden</code> and a <code>backdrop-filter</code>; the panels open below it, on screen, wherever the
          page is scrolled. Start the metronome and close its panel: it keeps playing and the button turns green.
        </p>
        <p id="toolbar-open" className="demo-note">Open panel: {openTool ?? 'none'}</p>
      </Example>

      <Example id="metronome-simple" title="MetronomeStandalone — simple">
        <MetronomeStandalone storageKey="crf-music-tools-demo-metronome-simple" defaultSettings={metronome({ mode: 'simple' })} />
      </Example>
      <Example id="metronome-full" title="MetronomeStandalone — full, with subtitle and close">
        <MetronomeStandalone
          storageKey="crf-music-tools-demo-metronome-full"
          defaultSettings={metronome({ mode: 'full' })}
          subtitle="Demo"
          onClose={() => setClosed((n) => n + 1)}
        />
        <p id="metronome-closed" className="demo-note">onClose called {closed} times</p>
      </Example>
      <Example id="tuner-vintage" title="TunerStandalone — vintage, simple">
        <TunerStandalone storageKey="crf-music-tools-demo-tuner-vintage" defaultSettings={tuner({ theme: 'vintage', mode: 'simple' })} />
      </Example>
      <Example id="tuner-vintage-full" title="TunerStandalone — vintage, full">
        <TunerStandalone storageKey="crf-music-tools-demo-tuner-vintage-full" defaultSettings={tuner({ theme: 'vintage', mode: 'full' })} />
      </Example>
      <Example id="tuner-tiles" title="TunerStandalone — tiles, simple">
        <TunerStandalone storageKey="crf-music-tools-demo-tuner-tiles" defaultSettings={tuner({ theme: 'tiles', mode: 'simple' })} />
      </Example>
      <Example id="tuner-tiles-full" title="TunerStandalone — tiles, full">
        <TunerStandalone storageKey="crf-music-tools-demo-tuner-tiles-full" defaultSettings={tuner({ theme: 'tiles', mode: 'full' })} />
      </Example>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
