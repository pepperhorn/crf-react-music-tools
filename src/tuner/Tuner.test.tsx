import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Profiler, StrictMode, useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Tuner } from './Tuner';
import { DEFAULT_TUNER_SETTINGS, midiToFreq, parseNote, type TunerResponse, type TunerSettings } from './pitch';
import {
  FakeAudioContext,
  installAudioMocks,
  stubTunerMedia,
  uninstallAudioMocks,
  type AudioMocks,
} from '../test/tuner-audio-mock';

const centsUp = (note: string, c: number) => midiToFreq(parseNote(note)) * Math.pow(2, c / 1200);

let mocks: AudioMocks;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** One act() per frame, so renders/effects triggered by a frame land before the next. */
function frames(n: number) {
  for (let i = 0; i < n; i++) act(() => mocks.frames(1));
}

/** Lets a test change settings from outside, as the host's store would. */
let patchSettings: (patch: Partial<TunerSettings>) => void = () => {};

function Harness({
  initial = {},
  onClose = () => {},
  audioContext,
  spy,
}: {
  initial?: Partial<TunerSettings>;
  onClose?: () => void;
  audioContext?: AudioContext | null;
  spy?: (s: TunerSettings) => void;
}) {
  const [settings, setSettings] = useState<TunerSettings>({ ...DEFAULT_TUNER_SETTINGS, ...initial });
  patchSettings = (patch) => setSettings((s) => ({ ...s, ...patch }));
  return (
    <Tuner
      settings={settings}
      onSettingsChange={(s) => {
        spy?.(s);
        setSettings(s);
      }}
      onClose={onClose}
      audioContext={audioContext}
    />
  );
}

const q = (sel: string) => document.querySelector(sel);
const text = (sel: string) => q(sel)?.textContent ?? null;

describe('Tuner', () => {
  beforeEach(() => {
    mocks = installAudioMocks('ok');
    stubTunerMedia({ wide: true });
  });
  afterEach(() => {
    uninstallAudioMocks();
  });

  it('requests raw mic audio and uses the context handed in from the gesture', async () => {
    const ctx = new FakeAudioContext();
    render(<Harness audioContext={ctx as unknown as AudioContext} />);
    await flush();
    expect(mocks.getUserMedia).toHaveBeenCalledOnce();
    const constraints = mocks.getUserMedia.mock.calls[0][0] as MediaStreamConstraints;
    expect(constraints.audio).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
    expect(mocks.contexts).toHaveLength(1);
    expect(ctx.resume).toHaveBeenCalled();
    expect(ctx.createAnalyser).toHaveBeenCalled();
    expect(ctx.analysers.length).toBe(1);
  });

  it('creates its own context when none is given', async () => {
    render(<Harness />);
    await flush();
    expect(mocks.contexts).toHaveLength(1);
    expect(mocks.contexts[0].state).toBe('running');
  });

  it('shows the detected note, cents and direction hint', async () => {
    render(<Harness initial={{ mode: 'full', instrument: 'strings', stringsVariant: 'violin' }} />);
    await flush();
    mocks.setFreq(centsUp('D4', 18));
    frames(4);
    expect(text('.tuner-lcd-note')).toBe('D');
    expect(text('.tuner-lcd-octave')).toBe('4');
    expect(text('.tuner-lcd-cents')).toBe('+18 ¢');
    expect(text('.tuner-lcd-hint')).toBe('SHARP ▼ TUNE DOWN');
    expect(text('.tuner-lcd-detail')).toBe('296.7 Hz');
    expect(q('.tuner-lamp')).toBeNull();
  });

  it('lights the IN TUNE lamp within 5 cents and prompts when silent', async () => {
    render(<Harness />);
    await flush();
    expect(text('.tuner-lcd-hint')).toBe('Play any note');
    mocks.setFreq(centsUp('G3', 2));
    frames(4);
    expect(q('.tuner-lamp')).toBeTruthy();
    expect(text('.tuner-lcd-hint')).toBe('IN TUNE');
  });

  it('stops tracks, closes the context and cancels frames on unmount', async () => {
    const r = render(<Harness />);
    await flush();
    mocks.setFreq(440);
    frames(2);
    r.unmount();
    expect(mocks.tracks).toHaveLength(1);
    expect(mocks.tracks[0].stop).toHaveBeenCalled();
    expect(mocks.contexts[0].close).toHaveBeenCalled();
    expect(mocks.contexts[0].sources[0].disconnect).toHaveBeenCalled();
    expect(mocks.pendingRafCount()).toBe(0);
  });

  it('stops a stream that arrives after unmount', async () => {
    uninstallAudioMocks();
    mocks = installAudioMocks('pending');
    stubTunerMedia();
    const r = render(<Harness />);
    r.unmount();
    mocks.resolvePending();
    await flush();
    expect(mocks.tracks[0].stop).toHaveBeenCalled();
    expect(mocks.contexts[0].close).toHaveBeenCalled();
  });

  it('StrictMode remount does not reuse a handed-in context that is still closing', async () => {
    // Real browsers flip `state` to 'closed' only when close() resolves, so the
    // remounted effect still sees the context it just closed as 'running'.
    const ctx = new FakeAudioContext();
    ctx.close = vi.fn(() => new Promise<void>(() => {}));
    render(
      <StrictMode>
        <Harness audioContext={ctx as unknown as AudioContext} />
      </StrictMode>,
    );
    await flush();
    expect(ctx.close).toHaveBeenCalled();
    const live = mocks.contexts.filter((c) => c !== ctx && c.analysers.length > 0);
    expect(live).toHaveLength(1);
    expect(ctx.analysers).toHaveLength(0);
    mocks.setFreq(440);
    frames(4);
    expect(text('.tuner-lcd-note')).toBe('A');
  });

  it('shows MIC BLOCKED when permission is denied', async () => {
    uninstallAudioMocks();
    mocks = installAudioMocks('denied');
    stubTunerMedia();
    render(<Harness />);
    await flush();
    expect(text('.tuner-lcd-error')).toBe('MIC BLOCKED');
    expect(screen.getByRole('alert').textContent).toMatch(/microphone/i);
    expect(mocks.contexts[0].close).toHaveBeenCalled();
  });

  it('shows NO MIC when there is no microphone or no mediaDevices', async () => {
    uninstallAudioMocks();
    mocks = installAudioMocks('notfound');
    stubTunerMedia();
    const r = render(<Harness />);
    await flush();
    expect(text('.tuner-lcd-error')).toBe('NO MIC');
    r.unmount();

    uninstallAudioMocks();
    mocks = installAudioMocks('missing');
    stubTunerMedia();
    render(<Harness />);
    await flush();
    expect(text('.tuner-lcd-error')).toBe('NO MIC');
  });

  it('resumes the context after an iOS interruption or suspension while active', async () => {
    const ctx = new FakeAudioContext();
    const r = render(<Harness audioContext={ctx as unknown as AudioContext} />);
    await flush();
    expect(ctx.listenerCount('statechange')).toBe(1);
    ctx.resume.mockClear();

    ctx.setState('interrupted');
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    ctx.setState('suspended');
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    ctx.setState('running');
    expect(ctx.resume).toHaveBeenCalledTimes(2);

    r.unmount();
    expect(ctx.listenerCount('statechange')).toBe(0);
    ctx.resume.mockClear();
    ctx.setState('suspended');
    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it('resumes a suspended context when the page becomes visible again', async () => {
    const ctx = new FakeAudioContext();
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const r = render(<Harness audioContext={ctx as unknown as AudioContext} />);
    await flush();
    expect(addSpy.mock.calls.some(([t]) => t === 'visibilitychange')).toBe(true);

    ctx.state = 'suspended';
    ctx.resume.mockClear();
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(ctx.resume).not.toHaveBeenCalled();

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(ctx.resume).toHaveBeenCalledTimes(1);

    ctx.state = 'running';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(ctx.resume).toHaveBeenCalledTimes(1);

    r.unmount();
    expect(removeSpy.mock.calls.some(([t]) => t === 'visibilitychange')).toBe(true);
    ctx.state = 'suspended';
    ctx.resume.mockClear();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(ctx.resume).not.toHaveBeenCalled();
  });

  describe('lost mic and interrupted sound', () => {
    /** Run `fn` and report what had happened by the time the click finished dispatching. */
    function duringClick(target: Element, probe: () => void) {
      document.addEventListener('click', probe);
      fireEvent.click(target);
      document.removeEventListener('click', probe);
    }

    it('shows MIC LOST when the track ends; Restart makes a context inside the tap and re-acquires the mic', async () => {
      const ctx = new FakeAudioContext();
      render(<Harness audioContext={ctx as unknown as AudioContext} />);
      await flush();
      mocks.setFreq(440);
      frames(4);
      expect(text('.tuner-lcd-note')).toBe('A');

      act(() => mocks.tracks[0].end());
      expect(text('.tuner-lcd-error')).toBe('MIC LOST');
      expect(screen.getByRole('alert').textContent).toMatch(/tap Restart/i);
      const restart = screen.getByRole('button', { name: 'Restart the microphone' });
      expect(restart.className).toMatch(/(^|\s)h-11(\s|$)/);
      expect(restart.className).toMatch(/tuner-btn-restart/);

      let contextsInClick = 0;
      let resumedInClick = false;
      duringClick(restart, () => {
        contextsInClick = mocks.contexts.length;
        resumedInClick = (mocks.contexts[1]?.resume.mock.calls.length ?? 0) > 0;
      });
      expect(contextsInClick).toBe(2);
      expect(resumedInClick).toBe(true);
      await flush();

      expect(mocks.getUserMedia).toHaveBeenCalledTimes(2);
      expect(ctx.close).toHaveBeenCalled();
      expect(mocks.tracks[0].listenerCount()).toBe(0);
      expect(q('.tuner-lcd-error')).toBeNull();
      frames(4);
      expect(text('.tuner-lcd-note')).toBe('A');
    });

    it('a muted track shows INTERRUPTED until it unmutes', async () => {
      render(<Harness />);
      await flush();
      act(() => mocks.tracks[0].mute());
      expect(text('.tuner-lcd-error')).toBe('INTERRUPTED');
      act(() => mocks.tracks[0].unmute());
      expect(q('.tuner-lcd-error')).toBeNull();
    });

    it('shows INTERRUPTED when the context stays suspended, and Restart resumes it inside the tap', async () => {
      const ctx = new FakeAudioContext();
      render(<Harness audioContext={ctx as unknown as AudioContext} />);
      await flush();
      // iOS refuses to resume outside a gesture: the state does not change.
      ctx.resume.mockImplementation(async () => {});
      act(() => ctx.setState('interrupted'));
      await flush();
      expect(text('.tuner-lcd-error')).toBe('INTERRUPTED');
      expect(screen.getByRole('alert').textContent).toMatch(/interrupted.*tap Restart/i);

      ctx.resume.mockImplementation(async () => {
        ctx.state = 'running';
      });
      ctx.resume.mockClear();
      let resumedInClick = 0;
      duringClick(screen.getByRole('button', { name: 'Restart the microphone' }), () => {
        resumedInClick = ctx.resume.mock.calls.length;
      });
      expect(resumedInClick).toBe(1);
      await flush();
      expect(q('.tuner-lcd-error')).toBeNull();
      // Same mic: resuming does not re-acquire.
      expect(mocks.getUserMedia).toHaveBeenCalledOnce();
      expect(mocks.contexts).toHaveLength(1);
    });

    it('shows INTERRUPTED when resume() rejects, and clears once the context runs again by itself', async () => {
      const ctx = new FakeAudioContext();
      render(<Harness audioContext={ctx as unknown as AudioContext} />);
      await flush();
      ctx.resume.mockImplementation(() => Promise.reject(new Error('not allowed')));
      act(() => ctx.setState('suspended'));
      await flush();
      expect(text('.tuner-lcd-error')).toBe('INTERRUPTED');
      act(() => ctx.setState('running'));
      expect(q('.tuner-lcd-error')).toBeNull();
    });

    it('removes its track listeners on unmount', async () => {
      const r = render(<Harness />);
      await flush();
      expect(mocks.tracks[0].listenerCount()).toBeGreaterThan(0);
      r.unmount();
      expect(mocks.tracks[0].listenerCount()).toBe(0);
    });

    it('tiles shows both states, with the Restart button, in its error panel (wide and compact)', async () => {
      for (const wide of [true, false]) {
        stubTunerMedia({ wide });
        const ctx = new FakeAudioContext();
        const r = render(<Harness initial={{ theme: 'tiles' }} audioContext={ctx as unknown as AudioContext} />);
        await flush();
        ctx.resume.mockImplementation(async () => {});
        act(() => ctx.setState('interrupted'));
        await flush();
        expect(text('.tuner-error-title')).toBe('INTERRUPTED');
        expect(screen.getByRole('button', { name: 'Restart the microphone' }).className).toMatch(/(^|\s)h-11(\s|$)/);

        act(() => mocks.tracks[mocks.tracks.length - 1].end());
        expect(text('.tuner-error-title')).toBe('MIC LOST');
        expect(screen.getByRole('alert').textContent).toMatch(/tap Restart/i);
        expect(screen.getByRole('button', { name: 'Restart the microphone' })).toBeTruthy();
        r.unmount();
      }
    });
  });

  describe('detection cost', () => {
    it('runs detection about 30 times a second, whatever the display refresh rate', async () => {
      render(<Harness />);
      await flush();
      mocks.setFreq(440);
      const analyser = mocks.contexts[0].analysers[0];
      const reads = vi.spyOn(analyser, 'getFloatTimeDomainData');
      act(() => mocks.frames(120, 1000 / 120)); // one second at 120 Hz
      expect(reads.mock.calls.length).toBeGreaterThanOrEqual(28);
      expect(reads.mock.calls.length).toBeLessThanOrEqual(31);
      reads.mockClear();
      act(() => mocks.frames(60)); // one second at 60 Hz
      expect(reads.mock.calls.length).toBeGreaterThanOrEqual(28);
      expect(reads.mock.calls.length).toBeLessThanOrEqual(31);
    });

    it('limits the lag search to the instrument: guitar ignores a 41 Hz tone that chromatic reads', async () => {
      const r = render(<Harness />);
      await flush();
      mocks.setFreq(41.2);
      frames(6);
      expect(text('.tuner-lcd-note')).toBe('E');
      expect(text('.tuner-lcd-octave')).toBe('1');
      r.unmount();

      render(<Harness initial={{ mode: 'full', instrument: 'guitar' }} />);
      await flush();
      mocks.setFreq(41.2);
      frames(6);
      expect(text('.tuner-lcd-octave')).not.toBe('1');
    });

    it('does not re-render the tuner for sub-cent wobble on a steady note', async () => {
      let commits = 0;
      render(
        <Profiler id="tuner" onRender={() => (commits += 1)}>
          <Harness />
        </Profiler>,
      );
      await flush();
      mocks.setFreq(440);
      frames(60);
      commits = 0;
      for (let i = 0; i < 20; i++) {
        mocks.setFreq(i % 2 ? 440.05 : 440); // ±0.2 cent
        frames(2);
      }
      expect(commits).toBe(0);
    });
  });

  describe('response speed', () => {
    const angle = () => Number(/rotate\((-?[\d.e-]+)/.exec(q('.tuner-needle')!.getAttribute('transform') ?? '')?.[1] ?? NaN);
    const readsPerSecond = (ms = 1000 / 60) => {
      const reads = vi.spyOn(mocks.contexts[0].analysers[0], 'getFloatTimeDomainData');
      act(() => mocks.frames(Math.round(1000 / ms), ms));
      const n = reads.mock.calls.length;
      reads.mockRestore();
      return n;
    };

    it('detects about 15 / 30 / 60 times a second for slow / medium / fast', async () => {
      for (const [response, lo, hi] of [
        ['slow', 14, 16],
        ['medium', 28, 31],
        ['fast', 58, 61],
      ] as Array<[TunerResponse, number, number]>) {
        const r = render(<Harness initial={{ response }} />);
        await flush();
        mocks.setFreq(440);
        const at60 = readsPerSecond();
        expect(at60, `${response} @60Hz`).toBeGreaterThanOrEqual(lo);
        expect(at60, `${response} @60Hz`).toBeLessThanOrEqual(hi);
        // A 120 Hz display must not double the work.
        const at120 = readsPerSecond(1000 / 120);
        expect(at120, `${response} @120Hz`).toBeGreaterThanOrEqual(lo);
        expect(at120, `${response} @120Hz`).toBeLessThanOrEqual(hi);
        r.unmount();
        uninstallAudioMocks();
        mocks = installAudioMocks('ok');
        stubTunerMedia({ wide: true });
      }
    });

    it('keeps its rate when callbacks start late: fast every frame, medium every 2nd, slow every 4th at 60 Hz', async () => {
      // Callbacks start 0–3 ms after their frame time, differently each frame. The cadence
      // must follow the frame timestamps, not the moment the callback happened to run.
      const lags = [0.2, 2.9, 0.4, 3, 1.1, 0, 2.6, 0.3, 1.9, 0.1];
      for (const [response, every] of [
        ['fast', 1],
        ['medium', 2],
        ['slow', 4],
      ] as Array<[TunerResponse, number]>) {
        const r = render(<Harness initial={{ response }} />);
        await flush();
        mocks.setFreq(440);
        mocks.setCallbackLag((i) => lags[i % lags.length]);
        const reads = vi.spyOn(mocks.contexts[0].analysers[0], 'getFloatTimeDomainData');
        const perFrame: number[] = [];
        for (let i = 0; i < 120; i++) {
          const before = reads.mock.calls.length;
          act(() => mocks.frames(1));
          perFrame.push(reads.mock.calls.length - before);
        }
        const detected = perFrame.flatMap((n, i) => (n ? [i] : []));
        expect(detected.length, response).toBe(120 / every);
        // Perfectly regular: no skipped or doubled frame anywhere.
        for (let i = 1; i < detected.length; i++) expect(detected[i] - detected[i - 1], response).toBe(every);
        r.unmount();
        uninstallAudioMocks();
        mocks = installAudioMocks('ok');
        stubTunerMedia({ wide: true });
      }
    });

    it('a new note reaches the LCD text sooner on fast and later on slow', async () => {
      const framesUntilNote = async (response: TunerResponse) => {
        const r = render(<Harness initial={{ response }} />);
        await flush();
        mocks.setFreq(midiToFreq(parseNote('A4')));
        frames(60);
        expect(text('.tuner-lcd-note')).toBe('A');
        mocks.setFreq(centsUp('D4', 18));
        let n = 0;
        while (text('.tuner-lcd-cents') !== '+18 ¢' && n < 200) {
          frames(1);
          n += 1;
        }
        expect(text('.tuner-lcd-note')).toBe('D');
        r.unmount();
        uninstallAudioMocks();
        mocks = installAudioMocks('ok');
        stubTunerMedia({ wide: true });
        return n;
      };
      const slow = await framesUntilNote('slow');
      const medium = await framesUntilNote('medium');
      const fast = await framesUntilNote('fast');
      expect(fast).toBeLessThan(medium);
      expect(medium).toBeLessThan(slow);
      // Medium is the original behaviour: the median of 5 flips on the 3rd detection, ~33 ms apart.
      expect(medium).toBeGreaterThanOrEqual(5);
      expect(medium).toBeLessThanOrEqual(6);
      expect(slow).toBeLessThanOrEqual(24); // 400 ms
    });

    it('holds the last note longer on slow than on fast once the sound stops', async () => {
      const framesUntilBlank = async (response: TunerResponse) => {
        const r = render(<Harness initial={{ response }} />);
        await flush();
        mocks.setFreq(440);
        frames(60);
        mocks.setFreq(null);
        let n = 0;
        while (text('.tuner-lcd-note') === 'A' && n < 200) {
          frames(1);
          n += 1;
        }
        r.unmount();
        uninstallAudioMocks();
        mocks = installAudioMocks('ok');
        stubTunerMedia({ wide: true });
        return n * (1000 / 60);
      };
      const slow = await framesUntilBlank('slow');
      const medium = await framesUntilBlank('medium');
      const fast = await framesUntilBlank('fast');
      expect(fast).toBeGreaterThan(380);
      expect(fast).toBeLessThan(500);
      expect(medium).toBeGreaterThan(560);
      expect(medium).toBeLessThan(700);
      // The last detection can be up to one interval (67 ms) before the sound stopped.
      expect(slow).toBeGreaterThan(830);
      expect(slow).toBeLessThan(1050);
    });

    it('the needle is calmer on slow and snappier on fast (same pitch step, same frames)', async () => {
      const angleAfter = async (response: TunerResponse, n: number) => {
        // Start counting from the frame the new pitch reached the display, so only the spring differs.
        const r = render(<Harness initial={{ response }} />);
        await flush();
        mocks.setFreq(centsUp('A4', 30)); // +27°
        let waited = 0;
        while (text('.tuner-lcd-cents') !== '+30 ¢' && waited < 50) {
          frames(1);
          waited += 1;
        }
        frames(n);
        const a = angle();
        frames(200);
        expect(Math.abs(angle() - 27), response).toBeLessThan(0.1);
        r.unmount();
        uninstallAudioMocks();
        mocks = installAudioMocks('ok');
        stubTunerMedia({ wide: true });
        return a;
      };
      const slow = await angleAfter('slow', 8);
      const medium = await angleAfter('medium', 8);
      const fast = await angleAfter('fast', 8);
      expect(slow).toBeLessThan(medium);
      expect(medium).toBeLessThan(fast);
      expect(fast).toBeLessThan(27.5); // critically damped: no real overshoot
      // Medium is the original spring, ω = 14: the exact critically damped step from rest.
      // (The integrator used to be semi-implicit Euler, which at 60 Hz ran up to 2° — about
      // 10 ms — ahead of this curve mid-swing, e.g. 16.49° here.)
      const t = 8 / 60;
      const exact = 27 * (1 - (1 + 14 * t) * Math.exp(-14 * t));
      expect(medium).toBeCloseTo(exact, 1);
      expect(Math.abs(medium - 16.49)).toBeLessThan(2.1);
    });

    it('changing the response while open applies at once, without touching the mic or the context', async () => {
      const ctx = new FakeAudioContext();
      render(<Harness audioContext={ctx as unknown as AudioContext} initial={{ mode: 'full' }} />);
      await flush();
      mocks.setFreq(440);
      frames(10);
      expect(text('.tuner-lcd-note')).toBe('A');
      expect(readsPerSecond()).toBeLessThanOrEqual(31);

      act(() => patchSettings({ response: 'fast' }));
      await flush();
      expect(readsPerSecond()).toBeGreaterThanOrEqual(58);
      expect(text('.tuner-lcd-note')).toBe('A');

      act(() => patchSettings({ response: 'slow' }));
      await flush();
      const slowReads = readsPerSecond();
      expect(slowReads).toBeGreaterThanOrEqual(14);
      expect(slowReads).toBeLessThanOrEqual(16);
      expect(text('.tuner-lcd-note')).toBe('A');

      expect(mocks.getUserMedia).toHaveBeenCalledOnce();
      expect(mocks.contexts).toHaveLength(1);
      expect(ctx.close).not.toHaveBeenCalled();
      expect(ctx.createAnalyser).toHaveBeenCalledOnce();
      expect(mocks.tracks).toHaveLength(1);
      expect(mocks.tracks[0].stop).not.toHaveBeenCalled();
    });

    describe('changing the response keeps the smoother history', () => {
      /** Run frames until `n` more detections have happened; returns the note shown after each. */
      const notesAfterDetections = (n: number) => {
        const reads = vi.spyOn(mocks.contexts[0].analysers[0], 'getFloatTimeDomainData');
        const notes: Array<string | null> = [];
        for (let guard = 0; notes.length < n && guard < 400; guard++) {
          const before = reads.mock.calls.length;
          frames(1);
          if (reads.mock.calls.length > before) notes.push(text('.tuner-lcd-note'));
        }
        reads.mockRestore();
        return notes;
      };
      const start = async (response: TunerResponse) => {
        render(<Harness initial={{ response }} />);
        await flush();
        mocks.setFreq(midiToFreq(parseNote('A4')));
        frames(90); // more than any window: the history is all A
        expect(text('.tuner-lcd-note')).toBe('A');
      };

      // In each case the note changes to D at the moment of the switch. Had the switch
      // emptied the history, the very first detection afterwards would already read D.

      it('medium → slow: five kept As hold the readout until five Ds outnumber them in the window of nine', async () => {
        await start('medium');
        act(() => patchSettings({ response: 'slow' }));
        mocks.setFreq(midiToFreq(parseNote('D4')));
        expect(notesAfterDetections(6)).toEqual(['A', 'A', 'A', 'A', 'D', 'D']);
      });

      it('slow → fast: the last As still outvote the first D in the window of three', async () => {
        await start('slow');
        act(() => patchSettings({ response: 'fast' }));
        mocks.setFreq(midiToFreq(parseNote('D4')));
        expect(notesAfterDetections(3)).toEqual(['A', 'D', 'D']);
      });

      it('fast → medium: three kept As need three Ds to be outvoted, not the one a fresh history would', async () => {
        await start('fast');
        act(() => patchSettings({ response: 'medium' }));
        mocks.setFreq(midiToFreq(parseNote('D4')));
        expect(notesAfterDetections(4)).toEqual(['A', 'A', 'D', 'D']);
      });

      it('slow → fast during silence: the held note stays up, with no blank frame', async () => {
        await start('slow');
        mocks.setFreq(null);
        frames(8);
        act(() => patchSettings({ response: 'fast' }));
        expect(notesAfterDetections(5)).toEqual(['A', 'A', 'A', 'A', 'A']);
      });
    });

    it('a needle already in motion picks up the new damping', async () => {
      const run = async (switchTo: TunerResponse | null) => {
        const r = render(<Harness />);
        await flush();
        mocks.setFreq(centsUp('A4', 30));
        frames(8);
        const mid = angle();
        if (switchTo) act(() => patchSettings({ response: switchTo }));
        frames(6);
        const end = angle();
        r.unmount();
        uninstallAudioMocks();
        mocks = installAudioMocks('ok');
        stubTunerMedia({ wide: true });
        return { mid, end };
      };
      const stay = await run(null);
      const faster = await run('fast');
      const slower = await run('slow');
      expect(faster.mid).toBeCloseTo(stay.mid, 5);
      expect(slower.mid).toBeCloseTo(stay.mid, 5);
      expect(faster.end).toBeGreaterThan(stay.end + 0.5);
      expect(slower.end).toBeLessThan(stay.end - 0.5);
    });
  });

  describe('response control', () => {
    const group = () => screen.queryByRole('group', { name: 'Response' });
    const btn = (name: string) => screen.getByRole('button', { name });
    const pressed = () => ['Slow', 'Medium', 'Fast'].map((n) => btn(n).getAttribute('aria-pressed'));

    it.each([
      ['vintage', true],
      ['vintage', false],
      ['tiles', true],
      ['tiles', false],
    ] as const)('%s, wide=%s: Full mode only, shows the current value and writes the setting', (theme, wide) => {
      stubTunerMedia({ wide });
      const spy = vi.fn();
      render(<Harness initial={{ theme, mode: 'simple' }} spy={spy} />);
      expect(group()).toBeNull();
      expect(q('.tuner-response')).toBeNull();

      fireEvent.click(btn('Switch to full mode'));
      spy.mockClear();
      expect(group()).toBeTruthy();
      expect(group()!.closest('.tuner-response')).toBeTruthy();
      expect([...group()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Slow', 'Medium', 'Fast']);
      expect(pressed()).toEqual(['false', 'true', 'false']);
      for (const r of ['slow', 'medium', 'fast']) {
        const b = q(`.tuner-response-${r}`)!;
        expect(b.tagName).toBe('BUTTON');
        expect(b.getAttribute('type')).toBe('button');
        expect(b.className).toMatch(/(^|\s)h-11(\s|$)/);
        expect(b.className).toMatch(/tuner-seg-btn/);
      }

      fireEvent.click(btn('Slow'));
      expect(spy).toHaveBeenLastCalledWith({ ...DEFAULT_TUNER_SETTINGS, theme, mode: 'full', response: 'slow' });
      expect(pressed()).toEqual(['true', 'false', 'false']);
      fireEvent.click(btn('Fast'));
      expect(spy).toHaveBeenLastCalledWith({ ...DEFAULT_TUNER_SETTINGS, theme, mode: 'full', response: 'fast' });
      expect(pressed()).toEqual(['false', 'false', 'true']);

      fireEvent.click(btn('Switch to simple mode'));
      expect(group()).toBeNull();
    });

    it('is styled like the theme\'s other segmented controls', () => {
      const r = render(<Harness initial={{ mode: 'full', instrument: 'strings', response: 'fast' }} />);
      // Vintage: same classes as the strings sub-select (cream pill = on).
      expect(q('.tuner-response-fast')!.className).toContain(q('.tuner-variant-violin')!.className.replace(/^tuner-seg-btn tuner-variant-violin /, ''));
      expect(q('.tuner-response-slow')!.className).toContain(q('.tuner-variant-viola')!.className.replace(/^tuner-seg-btn tuner-variant-viola /, ''));
      r.unmount();
      render(<Harness initial={{ theme: 'tiles', mode: 'full', instrument: 'strings', response: 'fast' }} />);
      expect(q('.tuner-response-fast')!.className).toContain(q('.tuner-variant-violin')!.className.replace(/^tuner-seg-btn tuner-variant-violin /, ''));
      expect(q('.tuner-response-slow')!.className).toContain(q('.tuner-variant-viola')!.className.replace(/^tuner-seg-btn tuner-variant-viola /, ''));
      expect(q('.tuner-response-fast')!.className).toMatch(/bg-\[#fff56d\]/);
    });

    it('sits in the options row beside A4 on the wide panel and on its own row on the phone', () => {
      for (const theme of ['vintage', 'tiles'] as const) {
        stubTunerMedia({ wide: true });
        let r = render(<Harness initial={{ theme, mode: 'full' }} />);
        expect(q('.tuner-options-end .tuner-response'), `${theme} wide`).toBeTruthy();
        expect(q('.tuner-options-end .tuner-a4'), `${theme} wide`).toBeTruthy();
        r.unmount();
        stubTunerMedia({ wide: false });
        r = render(<Harness initial={{ theme, mode: 'full' }} />);
        expect(q('.tuner-response-row .tuner-response'), `${theme} compact`).toBeTruthy();
        expect(q('.tuner-response-row .tuner-a4'), `${theme} compact`).toBeNull();
        expect(text('.tuner-response-label'), `${theme} compact`).toBe('RESPONSE');
        r.unmount();
      }
    });

    it('wide: nothing in the options row has a fixed minimum width, and Response / A4 may wrap', () => {
      // The wide layout follows the viewport, not the panel: beside the 256px sidebar at
      // 768px the panel is only ~470px wide. Checked for real in a browser; this guards the classes.
      for (const theme of ['vintage', 'tiles'] as const) {
        const r = render(<Harness initial={{ theme, mode: 'full', instrument: 'winds' }} />);
        const keys = q('.tuner-wind-keys')!;
        expect(keys.className, theme).not.toMatch(/min-w-\[\d/);
        if (theme === 'tiles') expect(keys.className).toMatch(/(^|\s)w-full(\s|$)/); // its own row
        const end = q('.tuner-options-end')!;
        expect(end.className, theme).toMatch(/(^|\s)flex-wrap(\s|$)/);
        expect(end.className, theme).toMatch(/(^|\s)justify-end(\s|$)/);
        r.unmount();
      }
    });

    it('wide: the RESPONSE caption shows unless six string buttons share the row (guitar)', () => {
      for (const theme of ['vintage', 'tiles'] as const) {
        for (const [instrument, caption] of [
          ['guitar', false],
          ['bass', true],
          ['ukulele', true],
          ['strings', true],
          ['winds', true],
          ['voice', true],
        ] as const) {
          const r = render(<Harness initial={{ theme, mode: 'full', instrument }} />);
          expect(text('.tuner-response-label'), `${theme} ${instrument}`).toBe(caption ? 'RESPONSE' : null);
          // Always named for assistive tech, caption or not.
          expect(screen.getByRole('group', { name: 'Response' })).toBeTruthy();
          r.unmount();
        }
      }
    });

    it('choosing a response keeps the mic running', async () => {
      render(<Harness initial={{ mode: 'full' }} />);
      await flush();
      mocks.setFreq(440);
      frames(6);
      fireEvent.click(btn('Fast'));
      await flush();
      frames(4);
      fireEvent.click(btn('Slow'));
      await flush();
      frames(4);
      expect(text('.tuner-lcd-note')).toBe('A');
      expect(mocks.getUserMedia).toHaveBeenCalledOnce();
      expect(mocks.contexts).toHaveLength(1);
      expect(mocks.contexts[0].close).not.toHaveBeenCalled();
      expect(mocks.tracks[0].stop).not.toHaveBeenCalled();
    });
  });

  it('shows NEEDS HTTPS (not NO MIC) on an insecure origin', async () => {
    uninstallAudioMocks();
    mocks = installAudioMocks('missing');
    stubTunerMedia();
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    try {
      render(<Harness />);
      await flush();
      expect(text('.tuner-lcd-error')).toBe('NEEDS HTTPS');
      expect(screen.getByRole('alert').textContent).toBe('The microphone only works over a secure (https) connection.');
      expect(screen.queryByText('NO MIC')).toBeNull();
      expect(mocks.getUserMedia).not.toHaveBeenCalled();
    } finally {
      delete (window as unknown as Record<string, unknown>).isSecureContext;
    }
  });

  it('stops the stream at once if setup throws after getUserMedia resolves', async () => {
    const ctx = new FakeAudioContext();
    ctx.failSource = true;
    render(<Harness audioContext={ctx as unknown as AudioContext} />);
    await flush();
    expect(mocks.tracks).toHaveLength(1);
    expect(mocks.tracks[0].stop).toHaveBeenCalled();
    expect(text('.tuner-lcd-error')).toBe('NO MIC');
  });

  it('close button calls onClose', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close tuner' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('vintage close button keeps the shared 14px button radius (no competing radius utility)', () => {
    // `rounded-full` used to lose to the shared radius in the app this came from; with the
    // radius written as `rounded-[14px]` it would win and turn the button into a circle.
    for (const wide of [true, false]) {
      stubTunerMedia({ wide });
      const r = render(<Harness onClose={() => {}} initial={{ theme: 'vintage' }} />);
      const radius = q('.tuner-btn-close')!.className.split(/\s+/).filter((c) => /^rounded(-|$)/.test(c));
      expect(radius).toEqual(['rounded-[14px]']);
      r.unmount();
    }
  });

  it('no element carries two competing radius or border-width utilities', () => {
    // Which of two same-property utilities wins is decided by stylesheet order, not class order,
    // and that order changed when theme classes became explicit values.
    const group = (c: string) =>
      /^rounded(-(none|sm|md|lg|xl|2xl|3xl|full|\[.*\]))?$/.test(c) ? 'radius' : /^border(-(0|2|4|8|\[[\d.]+px\]))?$/.test(c) ? 'border-width' : null;
    for (const wide of [true, false])
      for (const theme of ['vintage', 'tiles'] as const)
        for (const mode of ['simple', 'full'] as const) {
          stubTunerMedia({ wide });
          const r = render(<Harness onClose={() => {}} initial={{ theme, mode, instrument: 'strings' }} />);
          for (const el of document.querySelectorAll('[class]')) {
            const seen: Record<string, string[]> = {};
            for (const c of (el.getAttribute('class') ?? '').split(/\s+/)) {
              const g = group(c);
              if (g) (seen[g] ??= []).push(c);
            }
            for (const [g, list] of Object.entries(seen)) {
              // The compact LCD deliberately widens its 10px corner to 14px, as it always has.
              if (g === 'radius' && el.classList.contains('tuner-lcd-compact')) expect(list).toEqual(['rounded-[10px]', 'rounded-[14px]']);
              else expect(list, `${theme}/${mode}/${wide ? 'wide' : 'compact'} ${el.getAttribute('class')}`).toHaveLength(1);
            }
          }
          r.unmount();
        }
  });

  it('MORE switches to full mode and LESS back to simple', async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    expect(screen.queryByRole('button', { name: 'Guitar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to full mode' }));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'full' }));
    expect(screen.getByRole('button', { name: 'Guitar' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to simple mode' }));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'simple' }));
    expect(screen.queryByRole('button', { name: 'Guitar' })).toBeNull();
  });

  it('instrument switching shows strings, the strings sub-select, the key selector or voice text', async () => {
    render(<Harness initial={{ mode: 'full', instrument: 'guitar' }} />);
    await flush();
    const strings = () => [...document.querySelectorAll('.tuner-string-btn')].map((b) => b.textContent);
    expect(strings()).toEqual(['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
    expect(screen.getByRole('button', { name: 'Guitar' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Bass' }));
    expect(strings()).toEqual(['E1', 'A1', 'D2', 'G2']);

    fireEvent.click(screen.getByRole('button', { name: 'Ukulele' }));
    expect(strings()).toEqual(['G4', 'C4', 'E4', 'A4']);

    fireEvent.click(screen.getByRole('button', { name: 'Strings' }));
    expect(screen.getByRole('button', { name: 'Violin' }).getAttribute('aria-pressed')).toBe('true');
    expect(strings()).toEqual(['G3', 'D4', 'A4', 'E5']);
    fireEvent.click(screen.getByRole('button', { name: 'Cello' }));
    expect(strings()).toEqual(['C2', 'G2', 'D3', 'A3']);

    fireEvent.click(screen.getByRole('button', { name: 'Winds / Brass' }));
    expect(strings()).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Violin' })).toBeNull();
    expect(screen.getByRole('button', { name: /B♭ · Tpt, Clar, Tenor/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /E♭ · Alto, Bari/ }));
    expect(screen.getByRole('button', { name: /E♭ · Alto, Bari/ }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Voice' }));
    expect(strings()).toEqual([]);
    expect(screen.queryByRole('button', { name: /Tpt, Clar/ })).toBeNull();
    expect(screen.getByText(/Chromatic · sing a steady note/)).toBeTruthy();
    expect(text('.tuner-lcd-hint')).toBe('Sing a steady note');
  });

  it('tapping a string locks the target to it; tapping again unlocks', async () => {
    render(<Harness initial={{ mode: 'full', instrument: 'guitar' }} />);
    await flush();
    mocks.setFreq(midiToFreq(parseNote('A2')));
    frames(4);
    expect(text('.tuner-lcd-note')).toBe('A');
    const low = screen.getByRole('button', { name: 'Lock to E2 string' });
    fireEvent.click(low);
    expect(low.getAttribute('aria-pressed')).toBe('true');
    frames(2);
    expect(text('.tuner-lcd-note')).toBe('E');
    expect(text('.tuner-lcd-octave')).toBe('2');
    expect(text('.tuner-lcd-cents')).toBe('+500 ¢');
    fireEvent.click(low);
    expect(low.getAttribute('aria-pressed')).toBe('false');
    expect(text('.tuner-lcd-note')).toBe('A');
  });

  it('A4 − / + adjust by 1 and clamp to 430–450', () => {
    const spy = vi.fn();
    render(<Harness initial={{ mode: 'full', a4: 449 }} spy={spy} />);
    const up = screen.getByRole('button', { name: 'Raise reference pitch' });
    fireEvent.click(up);
    expect(text('.tuner-a4-value')).toBe('A4 450');
    fireEvent.click(up);
    expect(text('.tuner-a4-value')).toBe('A4 450');
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ a4: 450 }));
    const down = screen.getByRole('button', { name: 'Lower reference pitch' });
    for (let i = 0; i < 30; i++) fireEvent.click(down);
    expect(text('.tuner-a4-value')).toBe('A4 430');
  });

  it('winds in B♭ show the written note big and concert pitch small', async () => {
    render(<Harness initial={{ mode: 'full', instrument: 'winds', windKey: 'Bb' }} />);
    await flush();
    mocks.setFreq(centsUp('Bb3', 3));
    frames(4);
    expect(text('.tuner-lcd-note')).toBe('C');
    expect(text('.tuner-lcd-octave')).toBe('4');
    expect(text('.tuner-lcd-written')).toBe('WRITTEN · B♭');
    expect(text('.tuner-lcd-detail')).toBe('CONCERT B♭3 · 233.5 Hz');
    // Concert key: the same pitch reads as itself.
    fireEvent.click(screen.getByRole('button', { name: /C · Concert/ }));
    expect(text('.tuner-lcd-note')).toBe('B♭');
    expect(text('.tuner-lcd-octave')).toBe('3');
    expect(q('.tuner-lcd-written')).toBeNull();
  });

  it('every button is a ≥44px touch target and key parts carry semantic class names', () => {
    render(<Harness initial={{ mode: 'full', instrument: 'strings' }} />);
    for (const sel of ['.tuner-chassis', '.tuner-meter', '.tuner-needle', '.tuner-lcd', '.tuner-btn-close', '.tuner-btn-mode', '.tuner-instrument-btn']) {
      expect(q(sel), sel).toBeTruthy();
    }
    const buttons = [...document.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(10);
    for (const b of buttons) expect(b.className, b.textContent ?? '').toMatch(/(^|\s)(h-11|min-h-11)(\s|$)/);
  });

  it('compact (phone) layout renders the same controls', async () => {
    stubTunerMedia({ wide: false });
    render(<Harness initial={{ mode: 'full', instrument: 'voice' }} />);
    expect(q('.tuner-chassis')?.className).toMatch(/tuner-compact/);
    expect(screen.getByRole('button', { name: 'Close tuner' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Switch to simple mode' })).toBeTruthy();
    expect(text('.tuner-a4-value')).toBe('440');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to simple mode' }));
    expect(screen.getByRole('button', { name: 'Switch to full mode' })).toBeTruthy();
  });

  it('needle swings with damping, and snaps under prefers-reduced-motion', async () => {
    const angle = () => Number(/rotate\((-?[\d.e-]+)/.exec(q('.tuner-needle')!.getAttribute('transform') ?? '')?.[1] ?? NaN);
    const r = render(<Harness />);
    await flush();
    expect(angle()).toBeCloseTo(0, 5);
    mocks.setFreq(centsUp('A4', 30)); // +30 cents → +27°
    frames(2);
    const early = angle();
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(27);
    frames(120);
    expect(Math.abs(angle() - 27)).toBeLessThan(1.5);
    r.unmount();

    stubTunerMedia({ reduced: true });
    render(<Harness />);
    await flush();
    mocks.setFreq(centsUp('A4', 30));
    frames(2);
    expect(Math.abs(angle() - 27)).toBeLessThan(1.5);
  });
  describe('themes', () => {
    const root = () => q('.tuner-chassis')!;
    const columns = () => [...document.querySelectorAll<HTMLElement>('.tuner-block-col')];
    const litCounts = () => columns().map((c) => c.querySelectorAll('.tuner-block-lit').length);

    it('defaults to vintage; the toggle switches the look both ways', () => {
      const spy = vi.fn();
      render(<Harness spy={spy} />);
      expect(root().className).toMatch(/(^|\s)tuner-theme-vintage(\s|$)/);
      expect(q('.tuner-needle')).toBeTruthy();
      expect(q('.tuner-block-meter')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Switch to tiles look' }));
      expect(spy).toHaveBeenLastCalledWith({ ...DEFAULT_TUNER_SETTINGS, theme: 'tiles' });
      expect(root().className).toMatch(/(^|\s)tuner-theme-tiles(\s|$)/);
      expect(root().className).not.toMatch(/tuner-theme-vintage/);
      expect(q('.tuner-block-meter')).toBeTruthy();
      expect(q('.tuner-needle')).toBeNull();
      expect(q('.tuner-lcd')).toBeNull();
      expect(q('.tuner-note-card')).toBeTruthy();
      expect(q('.tuner-stripe')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Switch to vintage look' }));
      expect(spy).toHaveBeenLastCalledWith({ ...DEFAULT_TUNER_SETTINGS, theme: 'vintage' });
      expect(root().className).toMatch(/tuner-theme-vintage/);
      expect(q('.tuner-needle')).toBeTruthy();
    });

    it('switching keeps the mic running (no new getUserMedia, nothing stopped) and the live reading', async () => {
      render(<Harness initial={{ mode: 'full', instrument: 'guitar' }} />);
      await flush();
      mocks.setFreq(midiToFreq(parseNote('A2')));
      frames(4);
      expect(text('.tuner-lcd-note')).toBe('A');
      fireEvent.click(screen.getByRole('button', { name: 'Lock to E2 string' }));

      fireEvent.click(screen.getByRole('button', { name: 'Switch to tiles look' }));
      await flush();
      frames(2);
      expect(mocks.getUserMedia).toHaveBeenCalledOnce();
      expect(mocks.contexts).toHaveLength(1);
      expect(mocks.contexts[0].close).not.toHaveBeenCalled();
      expect(mocks.tracks[0].stop).not.toHaveBeenCalled();
      // The string lock (component state) survives the switch too.
      expect(screen.getByRole('button', { name: 'Lock to E2 string' }).getAttribute('aria-pressed')).toBe('true');
      expect(text('.tuner-card-note')).toBe('E');

      fireEvent.click(screen.getByRole('button', { name: 'Switch to vintage look' }));
      await flush();
      expect(mocks.getUserMedia).toHaveBeenCalledOnce();
      expect(mocks.tracks[0].stop).not.toHaveBeenCalled();
    });

    it('switching keeps mode, instrument and every other setting', () => {
      const spy = vi.fn();
      const initial = { mode: 'full', instrument: 'strings', stringsVariant: 'cello', windKey: 'F', a4: 442, response: 'slow' } as const;
      render(<Harness initial={initial} spy={spy} />);
      fireEvent.click(screen.getByRole('button', { name: 'Switch to tiles look' }));
      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenLastCalledWith({ ...initial, theme: 'tiles' });
      expect(screen.getByRole('button', { name: 'Strings' }).getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByRole('button', { name: 'Cello' }).getAttribute('aria-pressed')).toBe('true');
      expect(text('.tuner-a4-value')).toBe('442');
      expect(screen.getByRole('button', { name: 'Switch to simple mode' })).toBeTruthy();
    });

    it.each([
      ['wide', 'simple', 'vintage'],
      ['wide', 'full', 'vintage'],
      ['compact', 'simple', 'vintage'],
      ['compact', 'full', 'vintage'],
      ['wide', 'simple', 'tiles'],
      ['wide', 'full', 'tiles'],
      ['compact', 'simple', 'tiles'],
      ['compact', 'full', 'tiles'],
    ] as const)('the theme toggle is a 44px icon button in %s / %s / %s', (layout, mode, theme) => {
      stubTunerMedia({ wide: layout === 'wide' });
      render(<Harness initial={{ mode, theme }} />);
      const other = theme === 'tiles' ? 'vintage' : 'tiles';
      const btn = screen.getByRole('button', { name: `Switch to ${other} look` });
      expect(btn.className).toMatch(/(^|\s)tuner-btn-theme(\s|$)/);
      expect(btn.className).toMatch(/(^|\s)h-11(\s|$)/);
      expect(btn.className).toMatch(/(^|\s)w-1[12](\s|$)/);
      expect(btn.querySelector('svg.tuner-icon-theme')).toBeTruthy();
      expect(root().className).toMatch(new RegExp(`tuner-theme-${theme}`));
      expect(root().className).toMatch(layout === 'wide' ? /tuner-wide/ : /tuner-compact/);
      // Wide: in the side column with close and MORE/LESS. Phone: beside the other buttons.
      const home = layout === 'wide' ? '.tuner-side' : theme === 'tiles' ? '.tuner-header-controls' : '.tuner-footer-controls';
      expect(btn.parentElement?.matches(home), home).toBe(true);
      expect(btn.parentElement?.querySelector('.tuner-btn-close')).toBeTruthy();
      expect(btn.parentElement?.querySelector('.tuner-btn-mode')).toBeTruthy();
    });

    it('block meter: nothing lit and PLAY ANY NOTE without signal (SING A STEADY NOTE for voice)', async () => {
      const r = render(<Harness initial={{ theme: 'tiles' }} />);
      await flush();
      expect(columns()).toHaveLength(21);
      expect(litCounts().every((n) => n === 0)).toBe(true);
      expect(q('.tuner-marker')).toBeNull();
      expect(text('.tuner-chip')).toBe('PLAY ANY NOTE');
      expect(q('.tuner-chip')!.className).toMatch(/tuner-chip-idle/);
      expect(q('.tuner-cents')).toBeNull();
      expect(q('.tuner-block-meter')!.getAttribute('aria-label')).toBe('Tuning meter, no signal');
      r.unmount();

      render(<Harness initial={{ theme: 'tiles', mode: 'full', instrument: 'voice' }} />);
      await flush();
      expect(text('.tuner-chip')).toBe('SING A STEADY NOTE');
      expect(text('.tuner-brand-label')).toBe('Voice · sing a steady note');
    });

    it('block meter lights the reading column fully with the marker, and a staircase from the centre', async () => {
      render(<Harness initial={{ theme: 'tiles', mode: 'full', instrument: 'strings', stringsVariant: 'violin' }} />);
      await flush();
      mocks.setFreq(centsUp('D4', 18));
      frames(4);
      // +18 ¢ → the +20 column; staircase 1,1,2,3 from the centre (as in the approved mockup).
      expect(litCounts()).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 4, 0, 0, 0, 0, 0, 0]);
      const active = document.querySelectorAll('.tuner-block-col-active');
      expect(active).toHaveLength(1);
      expect(active[0].getAttribute('data-cents')).toBe('20');
      expect(active[0].querySelector('.tuner-marker')).toBeTruthy();
      expect(document.querySelectorAll('.tuner-marker')).toHaveLength(1);
      expect(active[0].querySelector('.tuner-block-lit')!.className).toMatch(/shadow-\[0_0_8px_2px/);
      expect(text('.tuner-card-note')).toBe('D');
      expect(text('.tuner-card-octave')).toBe('4');
      expect(text('.tuner-cents')).toBe('+18¢');
      expect(text('.tuner-chip')).toBe('SHARP ▼ TUNE DOWN');
      expect(q('.tuner-chip')!.className).toMatch(/tuner-chip-sharp/);
      expect(text('.tuner-card-hz')).toBe('296.7 Hz');
      expect(text('.tuner-brand-label')).toBe('Violin · A440');
      expect(q('.tuner-string-btn.tuner-string-target')?.textContent).toBe('D4');

      mocks.setFreq(centsUp('D4', -7));
      frames(6);
      expect(litCounts()).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(text('.tuner-cents')).toBe('−7¢');
      expect(q('.tuner-chip')!.className).toMatch(/tuner-chip-flat/);
    });

    it('the note card turns green (and the chip reads IN TUNE) within 5 cents', async () => {
      render(<Harness initial={{ theme: 'tiles' }} />);
      await flush();
      expect(q('.tuner-note-card')!.className).not.toMatch(/tuner-note-card-in-tune/);
      mocks.setFreq(centsUp('G3', 2));
      frames(4);
      expect(q('.tuner-note-card')!.className).toMatch(/(^|\s)tuner-note-card-in-tune(\s|$)/);
      expect(q('.tuner-note-card')!.className).toMatch(/bg-\[#6bc6a0\]/);
      expect(text('.tuner-chip')).toBe('IN TUNE');
      expect(q('.tuner-chip-dot')).toBeTruthy();
      expect(litCounts()[10]).toBe(4);
      expect(text('.tuner-brand-label')).toBe('Chromatic · A440');

      mocks.setFreq(centsUp('G3', 30));
      frames(6);
      expect(q('.tuner-note-card')!.className).not.toMatch(/tuner-note-card-in-tune/);
      expect(q('.tuner-note-card')!.className).toMatch(/bg-white/);
    });

    it('winds show the written note, a key badge and concert pitch on the card', async () => {
      render(<Harness initial={{ theme: 'tiles', mode: 'full', instrument: 'winds', windKey: 'Bb' }} />);
      await flush();
      mocks.setFreq(centsUp('Bb3', 3));
      frames(4);
      expect(text('.tuner-card-note')).toBe('C');
      expect(text('.tuner-card-octave')).toBe('4');
      expect(text('.tuner-card-badge')).toBe('B♭ inst');
      expect([...document.querySelectorAll('.tuner-card-hz-line')].map((l) => l.textContent)).toEqual(['CONCERT B♭3', '233.5 Hz']);
      expect(text('.tuner-brand-label')).toBe('Written · B♭');
      expect(screen.getByRole('button', { name: 'B♭ · Tpt Clar Ten' }).getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: 'C · Concert' }));
      expect(text('.tuner-card-note')).toBe('B♭');
      expect(q('.tuner-card-badge')).toBeNull();
    });

    it.each([
      ['denied', 'MIC BLOCKED'],
      ['notfound', 'NO MIC'],
    ] as const)('shows %s as %s in the tiles style', async (mode, title) => {
      uninstallAudioMocks();
      mocks = installAudioMocks(mode);
      stubTunerMedia();
      render(<Harness initial={{ theme: 'tiles' }} />);
      await flush();
      expect(text('.tuner-error-title')).toBe(title);
      expect(q('.tuner-error-card')).toBeTruthy();
      expect(screen.getByRole('alert').className).toMatch(/tuner-error-body/);
      expect(q('.tuner-block-meter')).toBeNull();
      // The controls stay usable.
      expect(screen.getByRole('button', { name: 'Switch to vintage look' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Close tuner' })).toBeTruthy();
    });

    it('shows NEEDS HTTPS in the tiles style on an insecure origin', async () => {
      uninstallAudioMocks();
      mocks = installAudioMocks('missing');
      stubTunerMedia({ wide: false });
      Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
      try {
        render(<Harness initial={{ theme: 'tiles' }} />);
        await flush();
        expect(text('.tuner-error-title')).toBe('NEEDS HTTPS');
        expect(screen.getByRole('alert').textContent).toMatch(/https/);
      } finally {
        delete (window as unknown as Record<string, unknown>).isSecureContext;
      }
    });

    it('tiles: every button is a ≥44px target and the new parts carry semantic class names', () => {
      for (const wide of [true, false]) {
        stubTunerMedia({ wide });
        const r = render(<Harness initial={{ theme: 'tiles', mode: 'full', instrument: 'strings' }} />);
        for (const sel of [
          '.tuner-chassis.tuner-theme-tiles',
          '.tuner-note-card',
          '.tuner-card-note',
          '.tuner-chip',
          '.tuner-block-meter',
          '.tuner-blocks',
          '.tuner-block-col',
          '.tuner-block',
          '.tuner-scale',
          '.tuner-brand',
          '.tuner-stripe',
          '.tuner-btn-theme',
          '.tuner-btn-close',
          '.tuner-btn-mode',
          '.tuner-instrument-btn',
          '.tuner-string-btn',
          '.tuner-a4-value',
        ]) {
          expect(q(sel), sel).toBeTruthy();
        }
        const buttons = [...document.querySelectorAll('button')];
        expect(buttons.length).toBeGreaterThan(10);
        for (const b of buttons) expect(b.className, b.textContent ?? '').toMatch(/(^|\s)(h-11|min-h-11)(\s|$)/);
        r.unmount();
      }
    });

    it('compact tiles keeps the same controls', () => {
      stubTunerMedia({ wide: false });
      render(<Harness initial={{ theme: 'tiles', mode: 'full', instrument: 'guitar' }} />);
      expect(root().className).toMatch(/tuner-compact/);
      expect([...document.querySelectorAll('.tuner-string-btn')].map((b) => b.textContent)).toEqual(['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
      fireEvent.click(screen.getByRole('button', { name: 'Raise reference pitch' }));
      expect(text('.tuner-a4-value')).toBe('441');
      expect(text('.tuner-brand-label')).toBe('Guitar · A441');
    });
  });
});
