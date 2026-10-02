import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { TunerStandalone, TUNER_STORAGE_KEY } from './TunerStandalone';
import { DEFAULT_TUNER_SETTINGS, type TunerSettings } from './pitch';
import { renderOnServer, serverRenderThenHydrate } from '../test/hydration';
import { FakeAudioContext, installAudioMocks, stubTunerMedia, uninstallAudioMocks, type AudioMocks } from '../test/tuner-audio-mock';

let mocks: AudioMocks;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
function frames(n: number) {
  for (let i = 0; i < n; i++) act(() => mocks.frames(1));
}
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const startBtn = () => screen.getByRole('button', { name: 'Start tuner' });
const stored = (key = TUNER_STORAGE_KEY) => JSON.parse(localStorage.getItem(key) ?? 'null') as TunerSettings | null;
const store = (patch: Partial<TunerSettings>, key = TUNER_STORAGE_KEY) =>
  localStorage.setItem(key, JSON.stringify({ ...DEFAULT_TUNER_SETTINGS, ...patch }));

describe('TunerStandalone', () => {
  beforeEach(() => {
    mocks = installAudioMocks('ok');
    stubTunerMedia({ wide: true });
  });
  afterEach(() => {
    uninstallAudioMocks();
    localStorage.clear();
  });

  it('does not touch the microphone or Web Audio until Start is pressed', async () => {
    render(<TunerStandalone />);
    await flush();
    expect(startBtn()).toBeTruthy();
    expect(q('.tuner-gate')?.className).toMatch(/crf-music-tools/);
    expect(mocks.getUserMedia).not.toHaveBeenCalled();
    expect(mocks.contexts).toHaveLength(0);
  });

  it('creates and resumes the AudioContext synchronously inside the Start click', async () => {
    render(<TunerStandalone />);
    const button = startBtn();
    let contextsDuringClick = -1;
    let resumedDuringClick = false;
    const probe = () => {
      // On document: runs after React's handler (at the root), still inside the same click dispatch.
      contextsDuringClick = mocks.contexts.length;
      resumedDuringClick = mocks.contexts[0]?.resume.mock.calls.length === 1;
    };
    document.addEventListener('click', probe);
    fireEvent.click(button);
    document.removeEventListener('click', probe);
    expect(contextsDuringClick).toBe(1);
    expect(resumedDuringClick).toBe(true);
    await flush();
    expect(mocks.getUserMedia).toHaveBeenCalledOnce();
    expect(mocks.contexts).toHaveLength(1); // the tuner adopted the gesture's context
    expect(mocks.contexts[0].createMediaStreamSource).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Start tuner' })).toBeNull();
  });

  it('shows a reading once the mic is live', async () => {
    render(<TunerStandalone />);
    fireEvent.click(startBtn());
    await flush();
    mocks.setFreq(440);
    frames(40);
    expect(q('.tuner-lcd-note')?.textContent).toBe('A');
  });

  it('close releases the track and the context, calls onClose, and returns to the Start button', async () => {
    const onClose = vi.fn();
    render(<TunerStandalone onClose={onClose} />);
    fireEvent.click(startBtn());
    await flush();
    expect(mocks.tracks[0].readyState).toBe('live');
    fireEvent.click(screen.getByRole('button', { name: 'Close tuner' }));
    expect(mocks.tracks[0].stop).toHaveBeenCalledOnce();
    expect(mocks.contexts[0].close).toHaveBeenCalledOnce();
    expect(mocks.pendingRafCount()).toBe(0);
    expect(onClose).toHaveBeenCalledOnce();
    expect(startBtn()).toBeTruthy();
  });

  it('always offers the close button, even without onClose', async () => {
    render(<TunerStandalone />);
    fireEvent.click(startBtn());
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Close tuner' }));
    expect(mocks.tracks[0].stop).toHaveBeenCalledOnce();
  });

  it('a second Start gets a fresh context and a fresh track', async () => {
    render(<TunerStandalone />);
    fireEvent.click(startBtn());
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Close tuner' }));
    fireEvent.click(startBtn());
    await flush();
    expect(mocks.contexts).toHaveLength(2);
    expect(mocks.tracks).toHaveLength(2);
    expect(mocks.tracks[1].readyState).toBe('live');
  });

  it('releases the mic when unmounted while listening', async () => {
    const view = render(<TunerStandalone />);
    fireEvent.click(startBtn());
    await flush();
    view.unmount();
    expect(mocks.tracks[0].stop).toHaveBeenCalledOnce();
    expect(mocks.contexts[0].close).toHaveBeenCalledOnce();
  });

  it('releases a mic that is only granted after unmount', async () => {
    uninstallAudioMocks();
    mocks = installAudioMocks('pending');
    stubTunerMedia({ wide: true });
    const view = render(<TunerStandalone />);
    fireEvent.click(startBtn());
    await flush();
    view.unmount();
    mocks.resolvePending();
    await flush();
    expect(mocks.tracks[0].stop).toHaveBeenCalledOnce();
  });

  it('StrictMode: ends with exactly one live track, and none after close', async () => {
    render(
      <StrictMode>
        <TunerStandalone />
      </StrictMode>,
    );
    fireEvent.click(startBtn());
    await flush();
    expect(mocks.tracks.filter((t) => t.readyState === 'live')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close tuner' }));
    expect(mocks.tracks.filter((t) => t.readyState === 'live')).toHaveLength(0);
  });

  it('renders on the server with the defaults and no audio', () => {
    store({ theme: 'tiles' });
    const html = renderOnServer(<TunerStandalone />);
    expect(html).toContain('Start tuner');
    expect(html).toContain('tuner-theme-vintage');
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('hydrates cleanly, then applies the stored theme to the Start card', async () => {
    const r = await serverRenderThenHydrate(<TunerStandalone />, { beforeHydrate: () => store({ theme: 'tiles' }) });
    expect(r.recoverableErrors).toEqual([]);
    expect(r.hydrationWarnings).toEqual([]);
    expect(r.container.querySelector('.tuner-gate')?.className).toMatch(/tuner-theme-tiles/);
    expect(mocks.getUserMedia).not.toHaveBeenCalled();
    r.unmount();
  });

  it('persists settings under the default key, or the one given', async () => {
    const first = render(<TunerStandalone />);
    fireEvent.click(startBtn());
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to tiles look' }));
    expect(stored()?.theme).toBe('tiles');
    first.unmount();

    const onSettingsChange = vi.fn();
    render(<TunerStandalone storageKey="my-app-tuner" defaultSettings={{ ...DEFAULT_TUNER_SETTINGS, mode: 'full' }} onSettingsChange={onSettingsChange} />);
    fireEvent.click(startBtn());
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Raise reference pitch' }));
    expect(stored('my-app-tuner')?.a4).toBe(441);
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ a4: 441 }));
    expect(stored()?.a4).toBe(440);
  });

  it('the Start button is themed, labelled and at least 44px tall by class', () => {
    store({ theme: 'tiles' });
    render(<TunerStandalone startLabel="Enable microphone" />);
    const button = screen.getByRole('button', { name: 'Enable microphone' });
    expect(button.className).toMatch(/tuner-btn-start/);
    expect(button.className).toMatch(/\bh-14\b/);
    expect(q('.tuner-gate')?.className).toMatch(/tuner-theme-tiles/);
  });

  it('reports a blocked microphone instead of a reading', async () => {
    uninstallAudioMocks();
    mocks = installAudioMocks('denied');
    stubTunerMedia({ wide: true });
    render(<TunerStandalone />);
    fireEvent.click(startBtn());
    await flush();
    expect(screen.getByRole('alert').textContent).toMatch(/blocked/i);
  });
});
