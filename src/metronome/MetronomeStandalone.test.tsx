import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { Metronome } from './Metronome';
import { MetronomeStandalone } from './MetronomeStandalone';
import { METRONOME_MESSAGES, METRONOME_STORAGE_KEY, useMetronome, type UseMetronomeOptions } from './useMetronome';
import { DEFAULT_METRONOME_SETTINGS, type MetronomeSettings } from './model';
import { renderOnServer, serverRenderThenHydrate } from '../test/hydration';
import { fakeEngineKit, stubMetronomeMedia, stubRaf, type FakeEngineKit } from '../test/metronome-test-kit';

let kit: FakeEngineKit;
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const btn = (name: string | RegExp) => screen.getByRole('button', { name });
const bpm = () => q('.metronome-bpm-value')?.textContent;
/** Let the fake audio clock run: one scheduler tick every 50 ms. */
const play = (seconds: number) => act(() => {
  for (let t = 0; t < seconds; t += 0.05) kit.advance(0.05);
});
const stored = (key = METRONOME_STORAGE_KEY) => JSON.parse(localStorage.getItem(key) ?? 'null') as MetronomeSettings | null;

/** The hook used directly, as a host that renders <Metronome> itself would. */
function HookHost(options: UseMetronomeOptions) {
  const metronome = useMetronome({ createEngine: kit.createEngine, ...options });
  return <Metronome {...metronome} />;
}

describe('MetronomeStandalone / useMetronome', () => {
  beforeEach(() => {
    kit = fakeEngineKit();
    stubMetronomeMedia({ wide: false });
    stubRaf();
  });
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders on the server with the defaults and creates no engine', () => {
    localStorage.setItem(METRONOME_STORAGE_KEY, JSON.stringify({ ...DEFAULT_METRONOME_SETTINGS, bpm: 90 }));
    const html = renderOnServer(<MetronomeStandalone createEngine={kit.createEngine} />);
    expect(html).toContain('crf-music-tools');
    expect(html).toMatch(/metronome-bpm-value[^>]*>120</);
    expect(kit.engines).toHaveLength(0);
  });

  it('hydrates cleanly, then shows the stored settings', async () => {
    const r = await serverRenderThenHydrate(<MetronomeStandalone createEngine={kit.createEngine} />, {
      beforeHydrate: () => localStorage.setItem(METRONOME_STORAGE_KEY, JSON.stringify({ ...DEFAULT_METRONOME_SETTINGS, bpm: 90, mode: 'full' })),
    });
    expect(r.recoverableErrors).toEqual([]);
    expect(r.hydrationWarnings).toEqual([]);
    expect(r.container.querySelector('.metronome-bpm-value')?.textContent).toBe('90');
    expect(r.container.querySelector('.metronome-chassis')?.className).toMatch(/metronome-full/);
    expect(kit.engines).toHaveLength(0);
    r.unmount();
  });

  it('persists changes under the default key, or the one given', () => {
    const first = render(<MetronomeStandalone createEngine={kit.createEngine} />);
    fireEvent.click(btn('Faster'));
    expect(bpm()).toBe('121');
    expect(stored()?.bpm).toBe(121);
    first.unmount();

    render(<MetronomeStandalone createEngine={kit.createEngine} storageKey="my-app-metronome" defaultSettings={{ ...DEFAULT_METRONOME_SETTINGS, bpm: 60 }} />);
    expect(bpm()).toBe('60');
    fireEvent.click(btn('Slower'));
    expect(stored('my-app-metronome')?.bpm).toBe(59);
    expect(stored()?.bpm).toBe(121);
  });

  it('makes the engine lazily and starts it synchronously inside the Start click', () => {
    render(<MetronomeStandalone createEngine={kit.createEngine} />);
    expect(kit.engines).toHaveLength(0);
    // No act(): whatever has happened by the time click() returns happened inside the gesture.
    act(() => {
      btn('Start').click();
      expect(kit.engines).toHaveLength(1);
      expect(kit.ctx.resume).toHaveBeenCalledOnce();
      expect(kit.engines[0].isRunning).toBe(true);
    });
    expect(btn('Stop')).toBeTruthy();
    fireEvent.click(btn('Stop'));
    expect(kit.engines[0].isRunning).toBe(false);
    expect(btn('Start')).toBeTruthy();
    fireEvent.click(btn('Start'));
    expect(kit.engines).toHaveLength(1); // reused
  });

  it('pushes settings changes to the playing engine', () => {
    render(<MetronomeStandalone createEngine={kit.createEngine} />);
    fireEvent.click(btn('Start'));
    const setSettings = vi.spyOn(kit.engines[0], 'setSettings');
    fireEvent.click(btn('Faster'));
    expect(setSettings).toHaveBeenLastCalledWith(expect.objectContaining({ bpm: 121 }));
    expect(kit.engines[0].isRunning).toBe(true);
    play(2);
    expect(kit.hits.length).toBeGreaterThan(2);
  });

  it('starts with the settings as they are at the click, not as they were at mount', () => {
    localStorage.setItem(METRONOME_STORAGE_KEY, JSON.stringify({ ...DEFAULT_METRONOME_SETTINGS, bpm: 200 }));
    render(<MetronomeStandalone createEngine={kit.createEngine} />);
    fireEvent.click(btn('Start'));
    play(1);
    const times = kit.hits.map((h) => h.time);
    expect(times[1] - times[0]).toBeCloseTo(60 / 200, 5);
  });

  it('shows a notice when audio cannot start, and clears it on the next good start', () => {
    render(<MetronomeStandalone createEngine={kit.createEngine} />);
    kit.failContext = true;
    fireEvent.click(btn('Start'));
    expect(screen.getByRole('alert').textContent).toBe(METRONOME_MESSAGES.noAudio);
    expect(btn('Start')).toBeTruthy();
    kit.failContext = false;
    fireEvent.click(btn('Start'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(btn('Stop')).toBeTruthy();
  });

  it('shows the interruption notice when the audio is taken away', async () => {
    render(<MetronomeStandalone createEngine={kit.createEngine} messages={{ interrupted: 'Paused by the system.' }} />);
    fireEvent.click(btn('Start'));
    await act(async () => {
      await Promise.resolve();
    });
    kit.ctx.resume.mockImplementation(() => Promise.reject(new Error('no')));
    await act(async () => {
      kit.setContextState('interrupted');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(btn('Start')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Paused by the system.');
  });

  it('disposes the engine on unmount', () => {
    const view = render(<MetronomeStandalone createEngine={kit.createEngine} />);
    fireEvent.click(btn('Start'));
    view.unmount();
    expect(kit.engines[0].isRunning).toBe(false);
    expect(kit.ctx.close).toHaveBeenCalledOnce();
  });

  it('survives StrictMode: one live engine, disposed at the end', () => {
    const view = render(
      <StrictMode>
        <MetronomeStandalone createEngine={kit.createEngine} />
      </StrictMode>,
    );
    fireEvent.click(btn('Start'));
    expect(kit.engines).toHaveLength(1);
    expect(btn('Stop')).toBeTruthy();
    view.unmount();
    expect(kit.engines[0].isRunning).toBe(false);
  });

  it('has no close button unless onClose is given; closing stops playback first', () => {
    const first = render(<MetronomeStandalone createEngine={kit.createEngine} />);
    expect(screen.queryByRole('button', { name: 'Close metronome' })).toBeNull();
    first.unmount();

    const onClose = vi.fn(() => expect(kit.engines[0].isRunning).toBe(false));
    render(<MetronomeStandalone createEngine={kit.createEngine} onClose={onClose} />);
    fireEvent.click(btn('Start'));
    fireEvent.click(btn('Close metronome'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('has no subtitle unless one is given', () => {
    const { unmount } = render(<MetronomeStandalone createEngine={kit.createEngine} />);
    expect(q('.metronome-subtitle')).toBeNull();
    unmount();
    render(<MetronomeStandalone createEngine={kit.createEngine} subtitle="Practice room" />);
    expect(q('.metronome-subtitle')?.textContent).toBe('Practice room');
  });

  describe('useMetronome', () => {
    it('controlled: uses the given settings and never touches storage', () => {
      const onSettingsChange = vi.fn();
      const set = vi.spyOn(Storage.prototype, 'setItem');
      render(<HookHost settings={{ ...DEFAULT_METRONOME_SETTINGS, bpm: 72 }} onSettingsChange={onSettingsChange} />);
      expect(bpm()).toBe('72');
      fireEvent.click(btn('Faster'));
      expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ bpm: 73 }));
      expect(bpm()).toBe('72'); // the host did not apply it
      expect(set).not.toHaveBeenCalled();
    });

    it('uncontrolled: reports changes as well as storing them', () => {
      const onSettingsChange = vi.fn();
      render(<HookHost onSettingsChange={onSettingsChange} />);
      fireEvent.click(btn('Faster'));
      expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ bpm: 121 }));
      expect(stored()?.bpm).toBe(121);
    });

    it('storageKey null keeps settings in memory', () => {
      render(<HookHost storageKey={null} />);
      fireEvent.click(btn('Faster'));
      expect(bpm()).toBe('121');
      expect(localStorage.length).toBe(0);
    });

    it('hands custom patterns to the engine it creates', () => {
      const createEngine = vi.fn(kit.createEngine);
      const patterns = [{ id: 'only', label: 'Only', title: 'Only', description: '', tags: [], division: 1, beats: 1, slots: ['beat' as const] }];
      render(<HookHost createEngine={createEngine} patterns={patterns} />);
      fireEvent.click(btn('Start'));
      expect(createEngine).toHaveBeenCalledWith({ patterns });
      expect(q('.metronome-sub-only')).not.toBeNull();
    });
  });
});
