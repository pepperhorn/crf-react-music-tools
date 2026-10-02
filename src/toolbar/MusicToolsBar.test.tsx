import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode, createRef, type ReactNode } from 'react';
import { render, fireEvent, act, within } from '@testing-library/react';
import { MusicToolsBar, MetronomeToolButton, TunerToolButton, MetronomeIcon, TuningForkIcon, type MusicToolsBarProps } from './index';
import * as root from '../index';
import { METRONOME_STORAGE_KEY } from '../metronome/useMetronome';
import { DEFAULT_METRONOME_SETTINGS } from '../metronome/model';
import { TUNER_STORAGE_KEY } from '../tuner/TunerStandalone';
import { DEFAULT_TUNER_SETTINGS } from '../tuner/pitch';
import { renderOnServer, serverRenderThenHydrate } from '../test/hydration';
import { installAudioMocks, stubTunerMedia, uninstallAudioMocks, type AudioMocks } from '../test/tuner-audio-mock';
import { fakeEngineKit, type FakeEngineKit } from '../test/metronome-test-kit';

let mocks: AudioMocks;
let kit: FakeEngineKit;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// `document.body` is looked up on every call: the view-transition tests swap it.
const page = () => within(document.body);
const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const tunerToggle = () => q<HTMLButtonElement>('.crfmt-tool-toggle-tuner')!;
const metronomeToggle = () => q<HTMLButtonElement>('.crfmt-tool-toggle-metronome')!;
const tunerPanel = () => page().queryByRole('dialog', { name: 'Tuner' });
const metronomePanel = () => page().queryByRole('dialog', { name: 'Metronome' });
const inMetronome = () => within(metronomePanel()!);
const inTuner = () => within(tunerPanel()!);
const engine = () => kit.engines[0];
const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null');

function Bar(props: MusicToolsBarProps) {
  return <MusicToolsBar createEngine={kit.createEngine} {...props} />;
}

function rect(left: number, right: number, bottom: number): DOMRect {
  return { left, right, bottom, top: bottom - 40, width: right - left, height: 40, x: left, y: bottom - 40, toJSON: () => ({}) } as DOMRect;
}
/** jsdom has no layout: say where the bar is and how wide the viewport is. */
function place(left: number, right: number, bottom: number, viewport = 1280) {
  q('.crfmt-toolbar')!.getBoundingClientRect = () => rect(left, right, bottom);
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: viewport });
}
const panelVar = (panel: HTMLElement | null, name: string) => panel!.style.getPropertyValue(name);

beforeEach(() => {
  localStorage.clear();
  mocks = installAudioMocks('ok');
  stubTunerMedia({ wide: true });
  kit = fakeEngineKit();
});
afterEach(() => {
  uninstallAudioMocks();
  delete (document.documentElement as unknown as Record<string, unknown>).clientWidth;
});

describe('MusicToolsBar: the closed bar', () => {
  it('is exported from the root entry and from ./toolbar', () => {
    expect(root.MusicToolsBar).toBe(MusicToolsBar);
    expect(root.MetronomeToolButton).toBe(MetronomeToolButton);
    expect(root.TunerToolButton).toBe(TunerToolButton);
    expect(root.MetronomeIcon).toBe(MetronomeIcon);
    expect(root.TuningForkIcon).toBe(TuningForkIcon);
  });

  it('shows two closed icon buttons, tuner first, inside the scoped root', () => {
    render(<Bar />);
    const bar = q('.crfmt-toolbar')!;
    expect(bar.className).toMatch(/(^|\s)crf-music-tools(\s|$)/);
    const labels = [...bar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Open tuner', 'Open metronome']);
    for (const btn of [tunerToggle(), metronomeToggle()]) {
      expect(btn.className).toMatch(/(^|\s)crfmt-tool-toggle(\s|$)/);
      expect(btn.getAttribute('type')).toBe('button');
      expect(btn.getAttribute('aria-expanded')).toBe('false');
      expect(btn.hasAttribute('aria-controls')).toBe(false);
      expect(btn.querySelector('svg')).toBeTruthy();
    }
    expect(page().queryByRole('dialog')).toBeNull();
    expect(q('.crfmt-tool-portal')).toBeNull();
    expect(kit.engines).toHaveLength(0);
    expect(mocks.contexts).toHaveLength(0);
    expect(mocks.getUserMedia).not.toHaveBeenCalled();
  });

  it('the icons are the tuning fork and the metronome, drawn with currentColor', () => {
    render(
      <>
        <TuningForkIcon className="my-fork" />
        <MetronomeIcon size={32} />
      </>,
    );
    const fork = q('.crfmt-icon-tuning-fork')!;
    const metro = q('.crfmt-icon-metronome')!;
    expect([...fork.querySelectorAll('path')].map((p) => p.getAttribute('d'))).toEqual(['M8 2v7a4 4 0 0 0 8 0V2', 'M12 13v9']);
    expect([...metro.querySelectorAll('path')].map((p) => p.getAttribute('d'))).toEqual(['M9 3h6l4 18H5z', 'M12 16l5-10', 'M7 16h10']);
    for (const svg of [fork, metro]) {
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.getAttribute('stroke-width')).toBe('2');
      expect(svg.getAttribute('stroke-linecap')).toBe('round');
      expect(svg.getAttribute('stroke-linejoin')).toBe('round');
      expect(svg.getAttribute('fill')).toBe('none');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
    expect(fork.getAttribute('class')).toMatch(/my-fork/);
    expect(fork.getAttribute('width')).toBe('20');
    expect(metro.getAttribute('width')).toBe('32');
  });

  it('`tools` chooses which tools are shown, and their order', () => {
    const one = render(<Bar tools={['metronome']} />);
    expect([...document.querySelectorAll('.crfmt-toolbar button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Open metronome']);
    one.unmount();
    const flipped = render(<Bar tools={['metronome', 'tuner']} />);
    expect([...document.querySelectorAll('.crfmt-toolbar button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Open metronome', 'Open tuner']);
    flipped.unmount();
    render(<Bar tools={['tuner', 'tuner']} />);
    expect([...document.querySelectorAll('.crfmt-toolbar button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Open tuner']);
  });

  it('buttons are 40px by default with a larger hit area, a focus ring with offset, and restylable through custom properties', () => {
    render(<Bar className="my-bar" buttonClassName="my-button" />);
    expect(q('.crfmt-toolbar')!.className).toMatch(/my-bar/);
    expect(q('.crfmt-toolbar')!.className).toContain('gap-[var(--crfmt-toolbar-gap,8px)]');
    for (const btn of [tunerToggle(), metronomeToggle()]) {
      const cls = btn.className;
      expect(cls).toMatch(/my-button/);
      expect(cls).toContain('h-[var(--crfmt-toolbar-size,40px)]');
      expect(cls).toContain('w-[var(--crfmt-toolbar-size,40px)]');
      // At least 44px to hit, whatever size the host chooses.
      expect(cls).toContain('before:inset-[min(-3px,calc((var(--crfmt-toolbar-size,40px)-44px)/2))]');
      expect(cls).toContain('rounded-[var(--crfmt-toolbar-radius,10px)]');
      expect(cls).toContain('bg-[var(--crfmt-toolbar-button-bg,#fff)]');
      expect(cls).toContain('border-[color:var(--crfmt-toolbar-button-border,');
      expect(cls).toContain('text-[color:var(--crfmt-toolbar-button-color,#141210)]');
      expect(cls).toContain('focus-visible:outline-2');
      expect(cls).toContain('focus-visible:outline-offset-2');
    }
    fireEvent.click(metronomeToggle());
    expect(metronomeToggle().className).toMatch(/crfmt-tool-toggle-open/);
    expect(metronomeToggle().className).toContain('bg-[var(--crfmt-toolbar-open-bg,#fff56d)]');
    expect(metronomeToggle().className).not.toContain('bg-[var(--crfmt-toolbar-button-bg,#fff)]');
    expect(tunerToggle().className).not.toMatch(/crfmt-tool-toggle-open/);
  });

  it('labels can be translated', () => {
    render(
      <Bar
        labels={{
          openTuner: 'Stimmgerät öffnen',
          closeTuner: 'Stimmgerät schließen',
          tuner: 'Stimmgerät',
          openMetronome: 'Metronom öffnen',
          closeMetronome: 'Metronom schließen',
          openMetronomeRunning: 'Metronom öffnen (läuft)',
          metronome: 'Metronom',
        }}
      />,
    );
    expect(tunerToggle().getAttribute('aria-label')).toBe('Stimmgerät öffnen');
    expect(tunerToggle().getAttribute('title')).toBe('Stimmgerät öffnen');
    fireEvent.click(tunerToggle());
    expect(tunerToggle().getAttribute('aria-label')).toBe('Stimmgerät schließen');
    expect(page().getByRole('dialog', { name: 'Stimmgerät' })).toBeTruthy();
    fireEvent.click(metronomeToggle());
    expect(metronomeToggle().getAttribute('aria-label')).toBe('Metronom schließen');
    const panel = page().getByRole('dialog', { name: 'Metronom' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Start' }));
    fireEvent.click(metronomeToggle());
    expect(metronomeToggle().getAttribute('aria-label')).toBe('Metronom öffnen (läuft)');
  });
});

describe('MusicToolsBar: panels', () => {
  it('a button opens its tool in a labelled, non-modal dialog and closes it again', () => {
    render(<Bar />);
    fireEvent.click(metronomeToggle());
    const p = metronomePanel()!;
    expect(p.getAttribute('aria-modal')).toBe('false');
    expect(p.className).toMatch(/(^|\s)crfmt-tool-panel(\s|$)/);
    expect(p.className).toMatch(/crfmt-tool-panel-metronome/);
    expect(p.querySelector('.metronome-chassis')).toBeTruthy();
    expect(metronomeToggle().getAttribute('aria-label')).toBe('Close metronome');
    expect(metronomeToggle().getAttribute('title')).toBe('Close metronome');
    expect(metronomeToggle().getAttribute('aria-expanded')).toBe('true');
    expect(metronomeToggle().getAttribute('aria-controls')).toBe(p.id);
    expect(document.activeElement).toBe(p);
    fireEvent.click(metronomeToggle());
    expect(metronomePanel()).toBeNull();
    expect(metronomeToggle().getAttribute('aria-label')).toBe('Open metronome');
    expect(metronomeToggle().hasAttribute('aria-controls')).toBe(false);
  });

  it('opening the metronome closes the tuner panel and releases its mic, without stealing focus', async () => {
    render(<Bar />);
    fireEvent.click(tunerToggle());
    await flush();
    expect(tunerPanel()).toBeTruthy();

    fireEvent.click(metronomeToggle());
    expect(metronomePanel()).toBeTruthy();
    expect(tunerPanel()).toBeNull();
    expect(tunerToggle().getAttribute('aria-expanded')).toBe('false');
    expect(mocks.tracks[0].stop).toHaveBeenCalled();
    expect(mocks.contexts[0].close).toHaveBeenCalled();
    expect(document.activeElement).toBe(metronomePanel());
    expect(document.querySelectorAll('.crfmt-tool-portal')).toHaveLength(1);
  });

  it('opening the tuner closes the metronome panel, but the metronome keeps playing', async () => {
    render(<Bar />);
    fireEvent.click(metronomeToggle());
    fireEvent.click(inMetronome().getByRole('button', { name: 'Start' }));
    expect(engine().isRunning).toBe(true);

    fireEvent.click(tunerToggle());
    await flush();
    expect(tunerPanel()).toBeTruthy();
    expect(metronomePanel()).toBeNull();
    expect(engine().isRunning).toBe(true);
    expect(metronomeToggle().getAttribute('aria-label')).toBe('Open metronome (running)');
    expect(document.activeElement).toBe(tunerPanel());
    expect(mocks.getUserMedia).toHaveBeenCalledOnce();
  });

  it('two separate tool buttons also share the one-panel rule', async () => {
    render(
      <>
        <TunerToolButton />
        <MetronomeToolButton createEngine={kit.createEngine} />
      </>,
    );
    expect(q('.crfmt-toolbar')).toBeNull();
    expect(tunerToggle().closest('.crf-music-tools')).toBeTruthy();
    expect(metronomeToggle().closest('.crf-music-tools')).toBeTruthy();
    fireEvent.click(tunerToggle());
    await flush();
    fireEvent.click(metronomeToggle());
    expect(tunerPanel()).toBeNull();
    expect(metronomePanel()).toBeTruthy();
    fireEvent.click(tunerToggle());
    expect(metronomePanel()).toBeNull();
    expect(tunerPanel()).toBeTruthy();
  });

  it('onOpenChange reports the open tool, with no stray null when one replaces the other', async () => {
    const onOpenChange = vi.fn();
    render(<Bar onOpenChange={onOpenChange} />);
    fireEvent.click(tunerToggle());
    fireEvent.click(metronomeToggle());
    fireEvent.click(inMetronome().getByRole('button', { name: 'Close metronome' }));
    fireEvent.click(tunerToggle());
    fireEvent.keyDown(tunerPanel()!, { key: 'Escape' });
    expect(onOpenChange.mock.calls.map((c) => c[0])).toEqual(['tuner', 'metronome', null, 'tuner', null]);
  });

  it('X closes and returns focus to the button', async () => {
    render(<Bar />);
    fireEvent.click(metronomeToggle());
    fireEvent.click(inMetronome().getByRole('button', { name: 'Close metronome' }));
    expect(metronomePanel()).toBeNull();
    expect(document.activeElement).toBe(metronomeToggle());

    fireEvent.click(tunerToggle());
    await flush();
    fireEvent.click(inTuner().getByRole('button', { name: 'Close tuner' }));
    expect(tunerPanel()).toBeNull();
    expect(mocks.tracks[0].stop).toHaveBeenCalled();
    expect(mocks.contexts[0].close).toHaveBeenCalled();
    expect(document.activeElement).toBe(tunerToggle());
  });

  it('Escape closes when focus is in the panel or on its button, and returns focus to the button', async () => {
    render(<Bar />);
    fireEvent.click(tunerToggle());
    await flush();
    expect(document.activeElement).toBe(tunerPanel());
    fireEvent.keyDown(tunerPanel()!, { key: 'Escape' });
    expect(tunerPanel()).toBeNull();
    expect(mocks.tracks[0].stop).toHaveBeenCalled();
    expect(document.activeElement).toBe(tunerToggle());

    // On a control inside the panel.
    fireEvent.click(metronomeToggle());
    const start = inMetronome().getByRole('button', { name: 'Start' });
    start.focus();
    fireEvent.keyDown(start, { key: 'Escape' });
    expect(metronomePanel()).toBeNull();
    expect(document.activeElement).toBe(metronomeToggle());

    // On the bar button.
    fireEvent.click(metronomeToggle());
    metronomeToggle().focus();
    fireEvent.keyDown(metronomeToggle(), { key: 'Escape' });
    expect(metronomePanel()).toBeNull();
  });

  it('Escape elsewhere on the page does not close the panel (and never kills the mic)', async () => {
    render(
      <>
        <Bar />
        <input aria-label="Elsewhere on the page" />
      </>,
    );
    const elsewhere = page().getByLabelText('Elsewhere on the page');
    fireEvent.click(tunerToggle());
    await flush();

    elsewhere.focus();
    fireEvent.keyDown(elsewhere, { key: 'Escape' });
    expect(tunerPanel()).toBeTruthy();
    elsewhere.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(tunerPanel()).toBeTruthy();
    // Focus on the OTHER tool's button is not this panel's business either.
    metronomeToggle().focus();
    fireEvent.keyDown(metronomeToggle(), { key: 'Escape' });
    expect(tunerPanel()).toBeTruthy();
    expect(mocks.tracks[0].stop).not.toHaveBeenCalled();
  });

  it('ignores an Escape that something else handled, or that belongs to another dialog', () => {
    render(
      <>
        <Bar />
        <div role="dialog" aria-label="Other">
          <button type="button">inside other</button>
        </div>
        <div role="alertdialog" aria-label="Confirm">
          <button type="button">inside alert</button>
        </div>
      </>,
    );
    fireEvent.click(metronomeToggle());

    const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    handled.preventDefault();
    act(() => {
      document.dispatchEvent(handled);
    });
    expect(metronomePanel()).toBeTruthy();

    fireEvent.keyDown(page().getByText('inside other'), { key: 'Escape' });
    fireEvent.keyDown(page().getByText('inside alert'), { key: 'Escape' });
    expect(metronomePanel()).toBeTruthy();

    page().getByText('inside other').focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(metronomePanel()).toBeTruthy();

    metronomePanel()!.focus();
    fireEvent.keyDown(metronomePanel()!, { key: 'Escape' });
    expect(metronomePanel()).toBeNull();
  });

  it('Escape with the presets overlay open closes the overlay, not the panel; the overlay is drawn above the panel', () => {
    render(<Bar />);
    fireEvent.click(metronomeToggle());
    const presets = () => page().queryByRole('dialog', { name: 'Rhythm presets' });
    fireEvent.click(inMetronome().getByRole('button', { name: 'Presets' }));
    expect(presets()).toBeTruthy();
    // Same stacking context as the panel (which has no z-index of its own), so its z-index puts it on top.
    expect(presets()!.closest('.crfmt-tool-portal')).toBe(metronomePanel()!.closest('.crfmt-tool-portal'));
    expect(metronomePanel()!.contains(presets())).toBe(false);
    expect(metronomePanel()!.className).not.toMatch(/(^|\s)z-/);

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(presets()).toBeNull();
    expect(metronomePanel()).toBeTruthy();

    fireEvent.click(inMetronome().getByRole('button', { name: 'Presets' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(presets()).toBeNull();
    expect(metronomePanel()).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(metronomePanel()).toBeNull();
  });
});

describe('MusicToolsBar: tuner', () => {
  it('creates and resumes the AudioContext synchronously inside the opening click, with no Start card', async () => {
    render(<Bar />);
    let contextsDuringClick = -1;
    let resumedDuringClick = false;
    // On document: runs after React's handler (at the root), still inside the same click dispatch.
    const probe = () => {
      contextsDuringClick = mocks.contexts.length;
      resumedDuringClick = mocks.contexts[0]?.resume.mock.calls.length === 1;
    };
    document.addEventListener('click', probe);
    fireEvent.click(tunerToggle());
    document.removeEventListener('click', probe);
    expect(contextsDuringClick).toBe(1);
    expect(resumedDuringClick).toBe(true);
    expect(tunerPanel()!.querySelector('.tuner-chassis')).toBeTruthy();
    expect(page().queryByRole('button', { name: 'Start tuner' })).toBeNull();
    await flush();
    expect(mocks.getUserMedia).toHaveBeenCalledOnce();
    expect(mocks.contexts).toHaveLength(1); // the tuner adopted the gesture's context
    expect(mocks.contexts[0].createMediaStreamSource).toHaveBeenCalledOnce();
  });

  it('shows a reading, and the button closes the panel and releases the mic', async () => {
    render(<Bar />);
    fireEvent.click(tunerToggle());
    await flush();
    mocks.setFreq(440);
    for (let i = 0; i < 40; i++) act(() => mocks.frames(1));
    expect(tunerPanel()!.querySelector('.tuner-lcd-note')?.textContent).toBe('A');
    expect(mocks.tracks[0].readyState).toBe('live');

    fireEvent.click(tunerToggle());
    expect(tunerPanel()).toBeNull();
    expect(mocks.tracks[0].stop).toHaveBeenCalledOnce();
    expect(mocks.contexts[0].close).toHaveBeenCalledOnce();
    expect(mocks.pendingRafCount()).toBe(0);
  });

  it('a fresh AudioContext and track for each open', async () => {
    render(<Bar />);
    fireEvent.click(tunerToggle());
    await flush();
    fireEvent.click(tunerToggle());
    fireEvent.click(tunerToggle());
    await flush();
    expect(mocks.contexts).toHaveLength(2);
    expect(mocks.contexts[1].state).toBe('running');
    expect(mocks.tracks.filter((t) => t.readyState === 'live')).toHaveLength(1);
  });

  it('releases the mic when the bar unmounts while the panel is open', async () => {
    const r = render(<Bar />);
    fireEvent.click(tunerToggle());
    await flush();
    r.unmount();
    expect(mocks.tracks[0].stop).toHaveBeenCalled();
    expect(mocks.contexts[0].close).toHaveBeenCalled();
    expect(q('.crfmt-tool-portal')).toBeNull();
  });

  it('StrictMode: one live track while open and none after close', async () => {
    render(
      <StrictMode>
        <Bar />
      </StrictMode>,
    );
    fireEvent.click(tunerToggle());
    await flush();
    expect(mocks.tracks.filter((t) => t.readyState === 'live')).toHaveLength(1);
    expect(document.querySelectorAll('.crfmt-tool-portal')).toHaveLength(1);
    fireEvent.click(tunerToggle());
    expect(mocks.tracks.filter((t) => t.readyState === 'live')).toHaveLength(0);
    expect(q('.crfmt-tool-portal')).toBeNull();
  });

  it('shows the blocked-mic message when permission is denied', async () => {
    uninstallAudioMocks();
    mocks = installAudioMocks('denied');
    stubTunerMedia({ wide: true });
    render(<Bar />);
    fireEvent.click(tunerToggle());
    await flush();
    expect(inTuner().getByRole('alert').textContent).toMatch(/blocked/i);
  });

  it('persists settings per device and restores them on the next mount', async () => {
    const r = render(<Bar />);
    fireEvent.click(tunerToggle());
    await flush();
    fireEvent.click(inTuner().getByRole('button', { name: 'Switch to full mode' }));
    fireEvent.click(inTuner().getByRole('button', { name: 'Bass' }));
    fireEvent.click(inTuner().getByRole('button', { name: 'Raise reference pitch' }));
    expect(stored(TUNER_STORAGE_KEY)).toMatchObject({ mode: 'full', instrument: 'bass', a4: 441 });
    r.unmount();

    render(<Bar />);
    fireEvent.click(tunerToggle());
    await flush();
    expect(inTuner().getByRole('button', { name: 'Bass' }).getAttribute('aria-pressed')).toBe('true');
    expect(inTuner().getByText('A4 441')).toBeTruthy();
  });

  it('the tiles look squares the panel off and leaves room for its hard shadow', async () => {
    render(<Bar />);
    fireEvent.click(tunerToggle());
    await flush();
    expect(tunerPanel()!.className).not.toMatch(/crfmt-tool-panel-tiles/);
    fireEvent.click(inTuner().getByRole('button', { name: 'Switch to tiles look' }));
    expect(stored(TUNER_STORAGE_KEY)).toMatchObject({ theme: 'tiles' });
    expect(tunerPanel()!.className).toMatch(/crfmt-tool-panel-tiles/);
    // Same mic session: switching the look does not reopen the microphone.
    expect(mocks.getUserMedia).toHaveBeenCalledOnce();
    expect(mocks.tracks[0].stop).not.toHaveBeenCalled();
  });
});

describe('MusicToolsBar: metronome', () => {
  it('Start runs the engine synchronously inside the click', () => {
    render(<Bar />);
    fireEvent.click(metronomeToggle());
    let runningInsideClick: boolean | undefined;
    const afterReact = () => {
      runningInsideClick = engine()?.isRunning;
    };
    document.addEventListener('click', afterReact);
    fireEvent.click(inMetronome().getByRole('button', { name: 'Start' }));
    document.removeEventListener('click', afterReact);
    expect(runningInsideClick).toBe(true);
    expect(kit.ctx.resume).toHaveBeenCalledOnce();
    expect(inMetronome().getByRole('button', { name: 'Stop' })).toBeTruthy();
  });

  it('keeps playing when the panel closes, and the button shows it', () => {
    render(<Bar />);
    fireEvent.click(metronomeToggle());
    expect(q('.crfmt-tool-toggle-dot')).toBeNull();
    fireEvent.click(inMetronome().getByRole('button', { name: 'Start' }));
    expect(metronomeToggle().className).toMatch(/crfmt-tool-toggle-running/);
    expect(metronomeToggle().getAttribute('aria-label')).toBe('Close metronome');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(metronomePanel()).toBeNull();
    expect(engine().isRunning).toBe(true);
    expect(metronomeToggle().getAttribute('aria-label')).toBe('Open metronome (running)');
    expect(metronomeToggle().getAttribute('title')).toBe('Open metronome (running)');
    expect(metronomeToggle().className).toMatch(/crfmt-tool-toggle-running/);
    expect(metronomeToggle().className).toContain('bg-[var(--crfmt-toolbar-running-bg,#6bc6a0)]');
    const dot = q('.crfmt-tool-toggle-dot')!;
    expect(dot.getAttribute('aria-hidden')).toBe('true');
    // Pulses only for people who have not asked for reduced motion.
    expect(dot.className).toMatch(/motion-safe:animate-\[crfmt-toolbar-pulse/);
    expect(dot.className).not.toMatch(/(^|\s)animate-/);
    expect(tunerToggle().className).not.toMatch(/crfmt-tool-toggle-running/);

    // Still scheduling clicks.
    const before = kit.hits.length;
    kit.advance(2);
    expect(kit.hits.length).toBeGreaterThan(before);

    // Reopening shows Stop, on the same engine.
    fireEvent.click(metronomeToggle());
    fireEvent.click(inMetronome().getByRole('button', { name: 'Stop' }));
    expect(kit.engines).toHaveLength(1);
    expect(engine().isRunning).toBe(false);
    expect(metronomeToggle().className).not.toMatch(/crfmt-tool-toggle-running/);
    expect(q('.crfmt-tool-toggle-dot')).toBeNull();
    fireEvent.click(metronomeToggle());
    expect(metronomeToggle().getAttribute('aria-label')).toBe('Open metronome');
  });

  it('disposes the engine when the bar unmounts, even while playing with the panel closed', () => {
    const r = render(<Bar />);
    fireEvent.click(metronomeToggle());
    fireEvent.click(inMetronome().getByRole('button', { name: 'Start' }));
    fireEvent.click(metronomeToggle());
    const dispose = vi.spyOn(engine(), 'dispose');
    r.unmount();
    expect(dispose).toHaveBeenCalledOnce();
    expect(engine().isRunning).toBe(false);
    expect(kit.ctx.close).toHaveBeenCalledOnce();
  });

  it('pushes settings changes to the running engine and persists them', () => {
    render(<Bar />);
    fireEvent.click(metronomeToggle());
    fireEvent.click(inMetronome().getByRole('button', { name: 'Start' }));
    const setSettings = vi.spyOn(engine(), 'setSettings');
    fireEvent.click(inMetronome().getByRole('button', { name: 'Switch to full mode' }));
    fireEvent.click(inMetronome().getByRole('button', { name: 'Faster' }));
    expect(setSettings).toHaveBeenLastCalledWith(expect.objectContaining({ bpm: 121 }));
    expect(stored(METRONOME_STORAGE_KEY)).toMatchObject({ mode: 'full', bpm: 121 });
  });

  it('restores saved settings; storage keys can be changed or switched off', async () => {
    localStorage.setItem(METRONOME_STORAGE_KEY, JSON.stringify({ ...DEFAULT_METRONOME_SETTINGS, bpm: 90 }));
    const first = render(<Bar />);
    fireEvent.click(metronomeToggle());
    expect(metronomePanel()!.querySelector('.metronome-bpm-value')?.textContent).toBe('90');
    first.unmount();

    const second = render(
      <Bar
        storageKeys={{ metronome: 'my-metronome', tuner: 'my-tuner' }}
        defaultSettings={{ metronome: { ...DEFAULT_METRONOME_SETTINGS, bpm: 60 }, tuner: { ...DEFAULT_TUNER_SETTINGS, mode: 'full' } }}
      />,
    );
    fireEvent.click(metronomeToggle());
    expect(metronomePanel()!.querySelector('.metronome-bpm-value')?.textContent).toBe('60');
    fireEvent.click(inMetronome().getByRole('button', { name: 'Slower' }));
    expect(stored('my-metronome')).toMatchObject({ bpm: 59 });
    expect(stored(METRONOME_STORAGE_KEY)).toMatchObject({ bpm: 90 });
    fireEvent.click(tunerToggle());
    await flush();
    fireEvent.click(inTuner().getByRole('button', { name: 'Raise reference pitch' }));
    expect(stored('my-tuner')).toMatchObject({ a4: 441, mode: 'full' });
    expect(stored(TUNER_STORAGE_KEY)).toBeNull();
    second.unmount();

    localStorage.clear();
    render(<Bar storageKeys={{ metronome: null, tuner: null }} />);
    fireEvent.click(metronomeToggle());
    fireEvent.click(inMetronome().getByRole('button', { name: 'Faster' }));
    expect(metronomePanel()!.querySelector('.metronome-bpm-value')?.textContent).toBe('121');
    fireEvent.click(tunerToggle());
    await flush();
    fireEvent.click(inTuner().getByRole('button', { name: 'Switch to tiles look' }));
    expect(localStorage.length).toBe(0);
  });

  it('shows the no-audio and interruption notices in the panel', async () => {
    kit.failContext = true;
    render(<Bar messages={{ interrupted: 'Paused by the system.' }} />);
    fireEvent.click(metronomeToggle());
    fireEvent.click(inMetronome().getByRole('button', { name: 'Start' }));
    expect(inMetronome().getByRole('alert').textContent).toMatch(/sound/i);
    expect(metronomeToggle().className).not.toMatch(/crfmt-tool-toggle-running/);

    kit.failContext = false;
    fireEvent.click(inMetronome().getByRole('button', { name: 'Start' }));
    await act(async () => {});
    expect(inMetronome().queryByRole('alert')).toBeNull();

    act(() => kit.setContextState('interrupted'));
    expect(engine().isRunning).toBe(false);
    expect(metronomeToggle().className).not.toMatch(/crfmt-tool-toggle-running/);
    expect(inMetronome().getByRole('alert').textContent).toBe('Paused by the system.');
  });

  it('passes the subtitle and custom patterns through', () => {
    const patterns = [{ id: 'only', label: 'Only', title: 'Only', description: '', tags: [], division: 1, beats: 1, slots: ['beat' as const] }];
    const createEngine = vi.fn(kit.createEngine);
    render(
      <MusicToolsBar
        createEngine={createEngine}
        patterns={patterns}
        subtitle="Practice room"
        defaultSettings={{ metronome: { ...DEFAULT_METRONOME_SETTINGS, mode: 'full' } }}
      />,
    );
    fireEvent.click(metronomeToggle());
    expect(metronomePanel()!.querySelector('.metronome-subtitle')?.textContent).toBe('Practice room');
    expect(metronomePanel()!.querySelector('.metronome-sub-only')).not.toBeNull();
    fireEvent.click(inMetronome().getByRole('button', { name: 'Start' }));
    expect(createEngine).toHaveBeenCalledWith({ patterns });
  });
});

describe('MusicToolsBar: portal and position', () => {
  it('renders the panel in a portal on document.body that carries the scoped root class', () => {
    const r = render(
      <header id="host-header" style={{ overflow: 'hidden' }}>
        <Bar />
      </header>,
    );
    fireEvent.click(metronomeToggle());
    const host = q('.crfmt-tool-portal')!;
    expect(host.parentElement).toBe(document.body);
    expect(host.className).toMatch(/(^|\s)crf-music-tools(\s|$)/);
    expect(host.contains(metronomePanel())).toBe(true);
    expect(q('#host-header')!.contains(metronomePanel())).toBe(false);
    expect(r.container.contains(metronomePanel())).toBe(false);
    fireEvent.click(metronomeToggle());
    expect(q('.crfmt-tool-portal')).toBeNull();
  });

  it('is fixed, capped to the viewport and scrolls inside; a full-width card under 640px, anchored from 640px', () => {
    render(<Bar panelClassName="my-panel" />);
    fireEvent.click(tunerToggle());
    const cls = tunerPanel()!.className;
    expect(cls).toMatch(/(^|\s)fixed(\s|$)/);
    expect(cls).toMatch(/(^|\s)left-4(\s|$)/);
    expect(cls).toMatch(/(^|\s)right-4(\s|$)/);
    expect(cls).toContain('top-[var(--crfmt-panel-top)]');
    expect(cls).toContain('max-h-[calc(100dvh-var(--crfmt-panel-top)-16px)]');
    expect(cls).toMatch(/(^|\s)overflow-y-auto(\s|$)/);
    expect(cls).toContain('sm:left-[var(--crfmt-panel-left)]');
    expect(cls).toContain('sm:right-auto');
    expect(cls).toContain('sm:w-[var(--crfmt-panel-width)]');
    expect(cls).toMatch(/my-panel/);
    expect(q('.crfmt-tool-portal')!.className).toContain('z-[var(--crfmt-toolbar-panel-z,1150)]');
  });

  it("anchors under the bar, aligned with the bar's left edge by default", () => {
    render(<Bar />);
    place(100, 188, 50);
    fireEvent.click(tunerToggle());
    expect(panelVar(tunerPanel(), '--crfmt-panel-left')).toBe('100px');
    expect(panelVar(tunerPanel(), '--crfmt-panel-top')).toBe('58px');
    expect(panelVar(tunerPanel(), '--crfmt-panel-width')).toBe('760px');
  });

  it('a bar at the right edge of the header: flips (or aligns end) and stays on screen', () => {
    const r = render(<Bar />);
    place(1176, 1264, 50);
    fireEvent.click(tunerToggle());
    expect(panelVar(tunerPanel(), '--crfmt-panel-left')).toBe('504px');
    r.unmount();

    render(<Bar align="end" defaultSettings={{ metronome: { ...DEFAULT_METRONOME_SETTINGS, mode: 'full' } }} />);
    place(1100, 1188, 50);
    fireEvent.click(metronomeToggle());
    expect(panelVar(metronomePanel(), '--crfmt-panel-width')).toBe('414px');
    expect(panelVar(metronomePanel(), '--crfmt-panel-left')).toBe(`${1188 - 414}px`);
    // The simple metronome is wider: the same panel moves to stay under the bar's right edge.
    fireEvent.click(inMetronome().getByRole('button', { name: 'Switch to simple mode' }));
    expect(panelVar(metronomePanel(), '--crfmt-panel-width')).toBe('760px');
    expect(panelVar(metronomePanel(), '--crfmt-panel-left')).toBe(`${1188 - 760}px`);
  });

  it('topOffset keeps the panel clear of the host header: a number, or any CSS length', () => {
    const a = render(<Bar topOffset={64} />);
    place(1176, 1264, 50);
    fireEvent.click(tunerToggle());
    expect(panelVar(tunerPanel(), '--crfmt-panel-top')).toBe('72px');
    a.unmount();

    render(<Bar topOffset="var(--header-height)" />);
    place(1176, 1264, 50);
    fireEvent.click(tunerToggle());
    expect(panelVar(tunerPanel(), '--crfmt-panel-top')).toBe('max(calc(var(--header-height) + 8px), 58px)');
  });

  it('measures again when the window is resized', () => {
    render(<Bar />);
    place(100, 188, 50);
    fireEvent.click(tunerToggle());
    place(20, 108, 90, 700);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    // 668px wide in a 700px viewport: only the 16px gutter is left.
    expect(panelVar(tunerPanel(), '--crfmt-panel-left')).toBe('16px');
    expect(panelVar(tunerPanel(), '--crfmt-panel-top')).toBe('98px');
    expect(panelVar(tunerPanel(), '--crfmt-panel-width')).toBe('668px');
  });

  it('panelZIndex sets the stacking order on the portal', () => {
    const a = render(<Bar />);
    fireEvent.click(tunerToggle());
    expect(q('.crfmt-tool-portal')!.style.getPropertyValue('--crfmt-toolbar-panel-z')).toBe('');
    a.unmount();
    render(<Bar panelZIndex={5000} />);
    fireEvent.click(metronomeToggle());
    expect(q('.crfmt-tool-portal')!.style.getPropertyValue('--crfmt-toolbar-panel-z')).toBe('5000');
  });
});

describe('MusicToolsBar: anchor', () => {
  /** A host strip wider than the bar, with other controls in it. */
  function Strip({ children, id = 'strip' }: { children: ReactNode; id?: string }) {
    return (
      <div id={id} className="host-strip">
        <button type="button">Host control</button>
        {children}
      </div>
    );
  }
  const placeEl = (sel: string, left: number, right: number, bottom: number) => {
    q(sel)!.getBoundingClientRect = () => rect(left, right, bottom);
  };

  it('default: the nearest .crfmt-toolbar ancestor, whatever it sits in', () => {
    render(
      <Strip>
        <Bar />
      </Strip>,
    );
    place(400, 488, 50);
    placeEl('#strip', 100, 900, 70);
    fireEvent.click(tunerToggle());
    expect(panelVar(tunerPanel(), '--crfmt-panel-left')).toBe('400px');
    expect(panelVar(tunerPanel(), '--crfmt-panel-top')).toBe('58px');
  });

  it('a ref: the panel hangs under the host strip, left edges aligned', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <div id="strip" ref={ref}>
        <Bar anchor={ref} />
      </div>,
    );
    place(400, 488, 50);
    placeEl('#strip', 100, 900, 70);
    fireEvent.click(tunerToggle());
    expect(panelVar(tunerPanel(), '--crfmt-panel-left')).toBe('100px');
    expect(panelVar(tunerPanel(), '--crfmt-panel-top')).toBe('78px');
    // Both tools, and `align`, use it.
    fireEvent.click(metronomeToggle());
    expect(panelVar(metronomePanel(), '--crfmt-panel-left')).toBe('100px');
  });

  it('an element', () => {
    const strip = document.createElement('div');
    strip.getBoundingClientRect = () => rect(200, 1000, 90);
    render(<Bar anchor={strip} align="end" />);
    place(400, 488, 50);
    fireEvent.click(tunerToggle());
    expect(panelVar(tunerPanel(), '--crfmt-panel-left')).toBe(`${1000 - 760}px`);
    expect(panelVar(tunerPanel(), '--crfmt-panel-top')).toBe('98px');
  });

  it('a selector: the closest ancestor of the button first, then the document', () => {
    const a = render(
      <>
        <div id="other" className="host-strip" />
        <Strip id="mine">
          <Bar anchor=".host-strip" />
        </Strip>
      </>,
    );
    place(400, 488, 50);
    placeEl('#other', 10, 500, 30);
    placeEl('#mine', 120, 900, 70);
    fireEvent.click(tunerToggle());
    expect(panelVar(tunerPanel(), '--crfmt-panel-left')).toBe('120px');
    a.unmount();

    // Not an ancestor: found in the document.
    render(
      <>
        <div id="elsewhere" />
        <Bar anchor="#elsewhere" />
      </>,
    );
    place(400, 488, 50);
    placeEl('#elsewhere', 60, 700, 110);
    fireEvent.click(tunerToggle());
    expect(panelVar(tunerPanel(), '--crfmt-panel-left')).toBe('60px');
    expect(panelVar(tunerPanel(), '--crfmt-panel-top')).toBe('118px');
  });

  it('falls back to the bar when the anchor is missing: no match, an invalid selector, an empty ref', () => {
    for (const anchor of ['.nothing-here', '!!not a selector', createRef<HTMLElement>()]) {
      const r = render(<Bar anchor={anchor} />);
      place(400, 488, 50);
      fireEvent.click(tunerToggle());
      expect(panelVar(tunerPanel(), '--crfmt-panel-left')).toBe('400px');
      r.unmount();
    }
  });

  it('is read again on every measure, and works on the single tool buttons', () => {
    render(
      <Strip>
        <TunerToolButton anchor="#strip" />
        <MetronomeToolButton anchor="#strip" createEngine={kit.createEngine} />
      </Strip>,
    );
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1280 });
    placeEl('#strip', 100, 900, 70);
    fireEvent.click(metronomeToggle());
    expect(panelVar(metronomePanel(), '--crfmt-panel-left')).toBe('100px');
    fireEvent.click(tunerToggle());
    expect(panelVar(tunerPanel(), '--crfmt-panel-left')).toBe('100px');
    placeEl('#strip', 140, 940, 80);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(panelVar(tunerPanel(), '--crfmt-panel-left')).toBe('140px');
    expect(panelVar(tunerPanel(), '--crfmt-panel-top')).toBe('88px');
  });
});

describe('MusicToolsBar: fit', () => {
  // A sidebar layout: 820px viewport, the bar starting at x = 280.
  it("default ('shift'): full width, moved left over the sidebar; the tool keeps its wide layout", () => {
    render(<Bar />);
    place(280, 368, 50, 820);
    fireEvent.click(tunerToggle());
    expect(panelVar(tunerPanel(), '--crfmt-panel-left')).toBe('44px');
    expect(panelVar(tunerPanel(), '--crfmt-panel-width')).toBe('760px');
    expect(q('.tuner-lcd-compact')).toBeNull();
  });

  it("'shrink': the left edge stays at the bar, the width is what is left, and the tools use their stacked layout", () => {
    render(<Bar fit="shrink" />);
    place(280, 368, 50, 820);
    fireEvent.click(tunerToggle());
    expect(panelVar(tunerPanel(), '--crfmt-panel-left')).toBe('280px');
    expect(panelVar(tunerPanel(), '--crfmt-panel-width')).toBe('524px');
    expect(q('.tuner-lcd-compact')).toBeTruthy();

    fireEvent.click(metronomeToggle());
    expect(panelVar(metronomePanel(), '--crfmt-panel-left')).toBe('280px');
    expect(panelVar(metronomePanel(), '--crfmt-panel-width')).toBe('524px');
    expect(q('.metronome-chassis')!.className).toMatch(/(^|\s)metronome-compact(\s|$)/);
    // The full card is 414px: it fits, so nothing is forced.
    fireEvent.click(inMetronome().getByRole('button', { name: 'Switch to full mode' }));
    expect(panelVar(metronomePanel(), '--crfmt-panel-width')).toBe('414px');
    expect(q('.metronome-chassis')!.className).not.toMatch(/(^|\s)metronome-compact(\s|$)/);
  });

  it("'shrink' with room to spare is the same as the default, wide layout included", () => {
    render(<Bar fit="shrink" />);
    place(100, 188, 50);
    fireEvent.click(tunerToggle());
    expect(panelVar(tunerPanel(), '--crfmt-panel-left')).toBe('100px');
    expect(panelVar(tunerPanel(), '--crfmt-panel-width')).toBe('760px');
    expect(q('.tuner-lcd-compact')).toBeNull();
  });

  it("'shrink' with align 'end' keeps the right edge; on the single tool button too", () => {
    render(<TunerToolButton fit="shrink" align="end" />);
    tunerToggle().getBoundingClientRect = () => rect(500, 540, 50);
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 820 });
    fireEvent.click(tunerToggle());
    expect(panelVar(tunerPanel(), '--crfmt-panel-left')).toBe('16px');
    expect(panelVar(tunerPanel(), '--crfmt-panel-width')).toBe('524px');
  });
});

describe('MusicToolsBar: compactTop', () => {
  it('the phone card uses its own top when there is one, and the anchored panel never does', () => {
    render(<Bar />);
    fireEvent.click(tunerToggle());
    const cls = tunerPanel()!.className.split(/\s+/);
    expect(cls).toContain('top-[var(--crfmt-panel-top-compact,var(--crfmt-panel-top))]');
    expect(cls).toContain('max-h-[calc(100dvh-var(--crfmt-panel-top-compact,var(--crfmt-panel-top))-16px)]');
    expect(cls).toContain('sm:top-[var(--crfmt-panel-top)]');
    expect(cls).toContain('sm:max-h-[calc(100dvh-var(--crfmt-panel-top)-16px)]');
  });

  it("default ('below-bar'): no compact top is set, so the card stays below the bar", () => {
    render(<Bar topOffset={48} />);
    place(16, 104, 400, 360);
    fireEvent.click(tunerToggle());
    expect(panelVar(tunerPanel(), '--crfmt-panel-top')).toBe('408px');
    expect(panelVar(tunerPanel(), '--crfmt-panel-top-compact')).toBe('');
  });

  it("'offset': the card is pinned 8px under topOffset wherever the bar is; from 640px nothing changes", () => {
    const a = render(<Bar topOffset={48} compactTop="offset" />);
    place(16, 104, 400, 360);
    fireEvent.click(tunerToggle());
    expect(panelVar(tunerPanel(), '--crfmt-panel-top-compact')).toBe('max(56px, env(safe-area-inset-top))');
    expect(panelVar(tunerPanel(), '--crfmt-panel-top')).toBe('408px');
    a.unmount();

    render(<MetronomeToolButton topOffset="var(--header-height)" compactTop="offset" createEngine={kit.createEngine} />);
    fireEvent.click(metronomeToggle());
    expect(panelVar(metronomePanel(), '--crfmt-panel-top-compact')).toBe('max(calc(var(--header-height) + 8px), env(safe-area-inset-top))');
  });
});

describe('MusicToolsBar: button styling hooks', () => {
  it('border width, transition and cursor are custom properties with the old values as fallbacks', () => {
    render(<Bar />);
    for (const btn of [tunerToggle(), metronomeToggle()]) {
      const cls = btn.className.split(/\s+/);
      expect(cls).toContain('border-[length:var(--crfmt-toolbar-border-width,1px)]');
      expect(cls).not.toContain('border');
      expect(cls).toContain('cursor-[var(--crfmt-toolbar-cursor,pointer)]');
      expect(cls).not.toContain('cursor-pointer');
      expect(cls).toContain(
        '[transition:var(--crfmt-toolbar-transition,color_150ms_cubic-bezier(0.4,0,0.2,1),background-color_150ms_cubic-bezier(0.4,0,0.2,1),border-color_150ms_cubic-bezier(0.4,0,0.2,1))]',
      );
      expect(cls).not.toContain('transition-colors');
    }
  });

  it('the running dot: size, border width, pulse duration and pulse depth', () => {
    render(<Bar />);
    fireEvent.click(metronomeToggle());
    fireEvent.click(inMetronome().getByRole('button', { name: 'Start' }));
    const cls = q('.crfmt-tool-toggle-dot')!.className.split(/\s+/);
    expect(cls).toContain('h-[var(--crfmt-toolbar-dot-size,10px)]');
    expect(cls).toContain('w-[var(--crfmt-toolbar-dot-size,10px)]');
    expect(cls).toContain('border-[length:var(--crfmt-toolbar-dot-border-width,1px)]');
    expect(cls).not.toContain('border');
    expect(cls).toContain('motion-safe:animate-[crfmt-toolbar-pulse_var(--crfmt-toolbar-dot-pulse-duration,1.6s)_ease-in-out_infinite]');
    const keyframes = [...document.querySelectorAll('style')].map((el) => el.textContent).join('');
    expect(keyframes).toContain('@keyframes crfmt-toolbar-pulse{50%{opacity:var(--crfmt-toolbar-dot-pulse-opacity,.35)}}');
  });
});

describe('MusicToolsBar: server rendering', () => {
  it('SSR: only the two closed buttons, no panel, and no browser globals touched', () => {
    localStorage.setItem(METRONOME_STORAGE_KEY, JSON.stringify({ ...DEFAULT_METRONOME_SETTINGS, mode: 'full' }));
    // renderOnServer removes window/document/navigator/localStorage, so any access would throw.
    const html = renderOnServer(<Bar topOffset={64} align="end" panelZIndex={99} />);
    expect(html).toContain('crfmt-toolbar');
    expect(html).toContain('aria-label="Open tuner"');
    expect(html).toContain('aria-label="Open metronome"');
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(2);
    expect(html).not.toContain('crfmt-tool-panel');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('chassis');
    expect(kit.engines).toHaveLength(0);
    expect(mocks.contexts).toHaveLength(0);
  });

  it('the first client render is the server HTML, whatever is stored on the device', async () => {
    const r = await serverRenderThenHydrate(<Bar />, {
      beforeHydrate: () => {
        localStorage.setItem(METRONOME_STORAGE_KEY, JSON.stringify({ ...DEFAULT_METRONOME_SETTINGS, mode: 'full', bpm: 96 }));
        localStorage.setItem(TUNER_STORAGE_KEY, JSON.stringify({ ...DEFAULT_TUNER_SETTINGS, theme: 'tiles', mode: 'full' }));
      },
    });
    expect(r.recoverableErrors).toEqual([]);
    expect(r.hydrationWarnings).toEqual([]);
    // The same markup, compared after the HTML parser (which unescapes quotes in attributes).
    const server = document.createElement('div');
    server.innerHTML = r.html;
    expect(r.container.innerHTML).toBe(server.innerHTML);
    expect(q('.crfmt-tool-portal')).toBeNull();
    // And the hydrated bar opens straight into the saved settings.
    fireEvent.click(metronomeToggle());
    expect(metronomePanel()!.querySelector('.metronome-full')).toBeTruthy();
    expect(metronomePanel()!.querySelector('.metronome-bpm-value')?.textContent).toBe('96');
    r.unmount();
    expect(q('.crfmt-tool-portal')).toBeNull();
  });
});

describe('MusicToolsBar: Astro view transitions (the body is swapped)', () => {
  let originalBody: HTMLElement;
  beforeEach(() => {
    originalBody = document.body;
  });
  afterEach(() => {
    // testing-library's `screen` and later tests expect the original body.
    if (document.body !== originalBody) document.documentElement.replaceChild(originalBody, document.body);
  });

  /** What Astro's router does: announce, replace <body> (moving persisted islands across), announce. */
  function swapBody(persist: HTMLElement | null) {
    act(() => {
      document.dispatchEvent(new Event('astro:before-swap'));
    });
    const next = document.createElement('body');
    if (persist) next.appendChild(persist);
    document.documentElement.replaceChild(next, document.body);
    act(() => {
      document.dispatchEvent(new Event('astro:after-swap'));
    });
  }

  it('a persisted bar keeps its open panel: the portal moves to the new body and is measured again', async () => {
    const r = render(<Bar />);
    place(100, 188, 50);
    fireEvent.click(tunerToggle());
    await flush();
    expect(document.activeElement).toBe(tunerPanel());
    const host = q('.crfmt-tool-portal')!;

    place(300, 388, 70);
    swapBody(r.container);

    expect(document.body).not.toBe(originalBody);
    expect(host.isConnected).toBe(true);
    expect(host.parentElement).toBe(document.body);
    expect(tunerPanel()).toBeTruthy();
    expect(tunerToggle().getAttribute('aria-expanded')).toBe('true');
    expect(panelVar(tunerPanel(), '--crfmt-panel-left')).toBe('300px');
    expect(panelVar(tunerPanel(), '--crfmt-panel-top')).toBe('78px');
    // Same microphone session, and focus is back where it was.
    expect(mocks.tracks[0].stop).not.toHaveBeenCalled();
    expect(mocks.getUserMedia).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(tunerPanel());

    // Still fully working: Escape closes it and tidies the portal away.
    fireEvent.keyDown(tunerPanel()!, { key: 'Escape' });
    expect(tunerPanel()).toBeNull();
    expect(q('.crfmt-tool-portal')).toBeNull();
    expect(mocks.tracks[0].stop).toHaveBeenCalled();
    r.unmount();
  });

  it('a persisted bar keeps the metronome playing across the swap, and says so', () => {
    const r = render(<Bar />);
    fireEvent.click(metronomeToggle());
    fireEvent.click(inMetronome().getByRole('button', { name: 'Start' }));
    fireEvent.click(metronomeToggle());
    swapBody(r.container);
    expect(engine().isRunning).toBe(true);
    expect(metronomeToggle().getAttribute('aria-label')).toBe('Open metronome (running)');
    fireEvent.click(metronomeToggle());
    expect(q('.crfmt-tool-portal')!.parentElement).toBe(document.body);
    expect(inMetronome().getByRole('button', { name: 'Stop' })).toBeTruthy();
    r.unmount();
  });

  it('a bar that did not survive the swap closes its panel, releases the mic and stops the metronome', async () => {
    const r = render(<Bar />);
    fireEvent.click(metronomeToggle());
    fireEvent.click(inMetronome().getByRole('button', { name: 'Start' }));
    fireEvent.click(tunerToggle());
    await flush();
    const host = q('.crfmt-tool-portal')!;

    swapBody(null);

    expect(host.isConnected).toBe(false);
    expect(document.body.querySelector('.crfmt-tool-portal')).toBeNull();
    expect(mocks.tracks[0].stop).toHaveBeenCalled();
    expect(mocks.contexts[0].close).toHaveBeenCalled();
    expect(engine().isRunning).toBe(false);
    r.unmount();
  });

  it('a swap we were not told about: the next open still lands in the live body', () => {
    const r = render(<Bar />);
    const next = document.createElement('body');
    next.appendChild(r.container);
    document.documentElement.replaceChild(next, document.body);
    fireEvent.click(metronomeToggle());
    expect(q('.crfmt-tool-portal')!.parentElement).toBe(next);
    r.unmount();
  });
});
