/**
 * Demo / manual test page. Deliberately has NO stylesheet of its own: the
 * only CSS on the page is the library's `styles.css` (and `fonts.css`), so
 * what you see is what a bare host page gets. The plain <h1>, <p> and
 * <button> below must look exactly like unstyled browser defaults.
 *
 * Query flags:
 *   ?fonts=0   skip fonts.css (check the system-font fallbacks)
 *   ?hostile=1 add an aggressive host stylesheet (check isolation the other way)
 *   ?only=metronome-simple | metronome-full | tuner-vintage | tuner-vintage-full | tuner-tiles | tuner-tiles-full
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

function App() {
  const [clicks, setClicks] = useState(0);
  const [closed, setClosed] = useState(0);
  return (
    <main className="demo-page">
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
