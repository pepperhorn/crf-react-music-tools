import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOOKAHEAD_S,
  MASTER_GAIN,
  MetronomeEngine,
  START_DELAY_S,
  TICK_MS,
  createTickTimer,
  type MetronomeTimer,
} from './engine';
import {
  DEFAULT_METRONOME_SETTINGS,
  SOUNDS,
  parsePatterns,
  withSignature,
  type MetronomeSettings,
  type SoundId,
} from './model';
import type { Voice } from './voices';

interface Hit {
  sound: SoundId;
  time: number;
  gain: number;
  tier: number;
  dest: unknown;
}

function fakeContext() {
  const gains: Array<{ gain: { value: number }; connected: unknown[]; disconnected: boolean }> = [];
  const stateListeners = new Set<() => void>();
  const ctx = {
    currentTime: 0,
    state: 'suspended' as string,
    destination: { kind: 'destination' },
    resume: vi.fn((): Promise<void> => Promise.resolve()),
    suspend: vi.fn((): Promise<void> => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    addEventListener: vi.fn((type: string, fn: () => void) => {
      if (type === 'statechange') stateListeners.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: () => void) => {
      if (type === 'statechange') stateListeners.delete(fn);
    }),
    stateListeners,
    /** Move to `state` and fire `statechange`, as the browser would. */
    setState(state: string) {
      ctx.state = state;
      for (const fn of [...stateListeners]) fn();
    },
    createGain: vi.fn(() => {
      const g = {
        gain: { value: 1 },
        connected: [] as unknown[],
        disconnected: false,
        connect(target: unknown) {
          g.connected.push(target);
          return target;
        },
        disconnect() {
          g.disconnected = true;
        },
      };
      gains.push(g);
      return g;
    }),
  };
  return { ctx, gains };
}

function manualTimer() {
  let cb: (() => void) | null = null;
  const timer = {
    startedWith: [] as number[],
    stops: 0,
    start(fn: () => void, ms: number) {
      cb = fn;
      timer.startedWith.push(ms);
    },
    stop() {
      cb = null;
      timer.stops++;
    },
    get active() {
      return cb !== null;
    },
    fire() {
      cb?.();
    },
  };
  return timer;
}

function setup(opts: { patterns?: ReturnType<typeof parsePatterns> } = {}) {
  const { ctx, gains } = fakeContext();
  const timer = manualTimer();
  const hits: Hit[] = [];
  const voices = Object.fromEntries(
    SOUNDS.map(({ id }) => [
      id,
      ((_c, dest, time, gain, tier) => hits.push({ sound: id, time, gain, tier, dest })) as Voice,
    ]),
  ) as Record<SoundId, Voice>;
  const createContext = vi.fn(() => ctx as unknown as AudioContext);
  const engine = new MetronomeEngine({ createContext, voices, timer, ...opts });
  /** Run the clock forward to `to`, ticking every 25 ms like the real timer. */
  const advance = (to: number) => {
    const steps = Math.round((to - ctx.currentTime) / 0.025);
    for (let i = 0; i < steps; i++) {
      ctx.currentTime += 0.025;
      timer.fire();
    }
  };
  return { engine, ctx, gains, timer, hits, createContext, advance };
}

/** Let pending promise reactions run. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const base: MetronomeSettings = DEFAULT_METRONOME_SETTINGS; // 4/4, 120, quarter, wood
const times = (hits: Hit[]) => hits.map((h) => h.time);
function expectTimes(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((t, i) => expect(t).toBeCloseTo(expected[i], 9));
}

describe('constants', () => {
  it('ticks every 25 ms with a 120 ms lookahead', () => {
    expect(TICK_MS).toBe(25);
    expect(LOOKAHEAD_S).toBe(0.12);
    expect(START_DELAY_S).toBe(0.08);
  });
});

describe('start / stop', () => {
  it('creates and resumes the context before start returns', () => {
    const { engine, ctx, createContext, timer, gains } = setup();
    expect(createContext).not.toHaveBeenCalled();
    expect(engine.isRunning).toBe(false);

    engine.start(base);

    expect(createContext).toHaveBeenCalledTimes(1);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(engine.isRunning).toBe(true);
    expect(timer.startedWith).toEqual([25]);
    // master gain sits between the voices and the speakers
    expect(gains).toHaveLength(1);
    expect(gains[0].connected).toEqual([ctx.destination]);
    // with headroom for tails that overlap at fast subdivisions
    expect(MASTER_GAIN).toBe(0.8);
    expect(gains[0].gain.value).toBe(MASTER_GAIN);
  });

  it('schedules the first click synchronously, through the master gain', () => {
    const { engine, hits, gains } = setup();
    engine.start(base);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sound: 'wood', time: 0.08, gain: 1, tier: 2 });
    expect(hits[0].dest).toBe(gains[0]);
  });

  it('a rejected resume() stops the engine instead of leaving it running silently', async () => {
    const { engine, ctx, timer } = setup();
    const seen: Array<[boolean, boolean]> = [];
    engine.subscribe((running, interrupted) => seen.push([running, interrupted]));
    ctx.resume.mockImplementation(() => Promise.reject(new Error('NotAllowedError')));
    expect(() => engine.start(base)).not.toThrow();
    // An unhandled rejection here would fail the run.
    await flush();
    expect(engine.isRunning).toBe(false);
    expect(timer.active).toBe(false);
    expect(seen).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it('a resume() rejection from an earlier run does not stop a later one', async () => {
    const { engine, ctx } = setup();
    let reject!: (e: Error) => void;
    ctx.resume.mockImplementationOnce(() => new Promise<void>((_, rej) => (reject = rej)));
    engine.start(base);
    engine.stop();
    engine.start(base);
    reject(new Error('late'));
    await flush();
    expect(engine.isRunning).toBe(true);
  });

  it('survives a context whose resume() throws or is missing', () => {
    const { engine, ctx } = setup();
    ctx.resume.mockImplementation(() => {
      throw new Error('old Safari');
    });
    expect(() => engine.start(base)).not.toThrow();
    expect(engine.isRunning).toBe(true);
  });

  it('stop cancels the timer, silences the tail and schedules nothing more', () => {
    const { engine, ctx, timer, hits, gains, advance } = setup();
    engine.start(base);
    advance(1);
    const before = hits.length;

    engine.stop();
    expect(engine.isRunning).toBe(false);
    expect(timer.active).toBe(false);
    expect(gains[0].disconnected).toBe(true); // clicks already queued never reach the speakers
    expect(engine.getBeatState()).toBeNull();

    ctx.currentTime = 5;
    timer.fire();
    expect(hits).toHaveLength(before);
    expect(ctx.close).not.toHaveBeenCalled();
  });

  it('restarts from beat 1 on the same context with a fresh master gain', () => {
    const { engine, ctx, hits, gains, createContext, advance } = setup();
    engine.start(base);
    advance(0.7);
    engine.stop();
    hits.length = 0;

    engine.start(base);
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    expect(gains).toHaveLength(2);
    expect(hits[0]).toMatchObject({ gain: 1, tier: 2, dest: gains[1] });
    expect(hits[0].time).toBeCloseTo(ctx.currentTime + 0.08, 9);
  });

  it('start while running applies the settings and resumes the context again', () => {
    const { engine, ctx, timer, hits, createContext } = setup();
    engine.start(base);
    engine.start({ ...base, sound: 'bell' });
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(timer.startedWith).toEqual([25]);
    expect(hits).toHaveLength(1);
    // A context that was suspended behind our back gets another chance, inside this gesture.
    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it('stays stopped if the context cannot be created', () => {
    const timer = manualTimer();
    const engine = new MetronomeEngine({
      createContext: () => {
        throw new Error('no audio');
      },
      timer,
    });
    expect(() => engine.start(base)).toThrow('no audio');
    expect(engine.isRunning).toBe(false);
    expect(timer.active).toBe(false);
  });

  it('a first tick that throws leaves the engine stopped, with the timer cancelled, before the error propagates', () => {
    const { ctx, gains } = fakeContext();
    const timer = manualTimer();
    let broken = true;
    const hits: number[] = [];
    const voice: Voice = (_c, _d, time) => {
      if (broken) throw new Error('voice blew up');
      hits.push(time);
    };
    const voices = Object.fromEntries(SOUNDS.map(({ id }) => [id, voice])) as Record<SoundId, Voice>;
    const engine = new MetronomeEngine({ createContext: () => ctx as unknown as AudioContext, voices, timer });
    const seen: boolean[] = [];
    engine.subscribe((running) => seen.push(running));

    expect(() => engine.start(base)).toThrow('voice blew up');

    expect(engine.isRunning).toBe(false);
    expect(timer.active).toBe(false);
    expect(gains[0].disconnected).toBe(true);
    expect(engine.getBeatState()).toBeNull();
    expect(engine.pendingBeats).toBe(0);
    // Subscribers never heard "running", so there is nothing to take back.
    expect(seen).toEqual([]);
    ctx.currentTime = 2;
    timer.fire();
    expect(hits).toEqual([]);

    // And it is not wedged: once the voice works, Start works.
    broken = false;
    engine.start(base);
    expect(engine.isRunning).toBe(true);
    expect(timer.active).toBe(true);
    expect(seen).toEqual([true]);
    expect(hits).toHaveLength(1);
  });

  it('dispose stops and closes the context; a later start makes a new one', () => {
    const { engine, ctx, timer, createContext } = setup();
    engine.start(base);
    engine.dispose();
    expect(engine.isRunning).toBe(false);
    expect(timer.active).toBe(false);
    expect(ctx.close).toHaveBeenCalledTimes(1);

    engine.dispose(); // idempotent
    expect(ctx.close).toHaveBeenCalledTimes(1);

    engine.start(base);
    expect(createContext).toHaveBeenCalledTimes(2);
  });

  it('stop and dispose are safe before start', () => {
    const { engine } = setup();
    expect(() => {
      engine.stop();
      engine.dispose();
      engine.setSettings(base);
    }).not.toThrow();
    expect(engine.getBeatState()).toBeNull();
  });
});

describe('releasing the audio session while idle', () => {
  it('stop suspends the context; the next start resumes it', () => {
    const { engine, ctx } = setup();
    engine.start(base);
    expect(ctx.suspend).not.toHaveBeenCalled();
    engine.stop();
    expect(ctx.suspend).toHaveBeenCalledTimes(1);
    engine.stop(); // already stopped: nothing more to release
    expect(ctx.suspend).toHaveBeenCalledTimes(1);
    engine.start(base);
    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it('a suspend() that rejects, throws or is missing is ignored', async () => {
    const a = setup();
    a.ctx.suspend.mockImplementation(() => Promise.reject(new Error('InvalidStateError')));
    a.engine.start(base);
    expect(() => a.engine.stop()).not.toThrow();
    await flush(); // an unhandled rejection here would fail the run

    const b = setup();
    b.ctx.suspend.mockImplementation(() => {
      throw new Error('nope');
    });
    b.engine.start(base);
    expect(() => b.engine.stop()).not.toThrow();
    expect(b.engine.isRunning).toBe(false);

    const c = setup();
    (c.ctx as { suspend?: unknown }).suspend = undefined;
    c.engine.start(base);
    expect(() => c.engine.stop()).not.toThrow();
    expect(c.engine.isRunning).toBe(false);
  });

  it('its own suspend is not mistaken for an interruption, even when Start follows at once', async () => {
    const { engine, ctx } = setup();
    const seen: Array<[boolean, boolean]> = [];
    engine.subscribe((running, interrupted) => seen.push([running, interrupted]));
    engine.start(base);
    await flush();
    ctx.setState('running');

    // Stop then Start before the suspend has landed: its statechange arrives mid-run.
    let landSuspend!: () => void;
    ctx.suspend.mockImplementation(() => new Promise<void>((res) => (landSuspend = res)));
    let landResume!: () => void;
    ctx.resume.mockImplementation(() => new Promise<void>((res) => (landResume = res)));
    engine.stop();
    engine.start(base);
    landSuspend();
    await flush();
    ctx.setState('suspended');
    expect(engine.isRunning).toBe(true);
    landResume();
    await flush();
    ctx.setState('running');
    expect(engine.isRunning).toBe(true);

    // And with no restart, the suspend landing while stopped reports nothing.
    engine.stop();
    landSuspend();
    await flush();
    ctx.setState('suspended');
    expect(seen.some(([, interrupted]) => interrupted)).toBe(false);
  });

  it('does not suspend a context that was interrupted (it is already silent)', async () => {
    const { engine, ctx } = setup();
    engine.start(base);
    await flush();
    ctx.setState('interrupted');
    expect(engine.isRunning).toBe(false);
    expect(ctx.suspend).not.toHaveBeenCalled();
  });
});

describe('interruption', () => {
  /** Start and let the resume() promise settle, as it has by the time anything can interrupt. */
  async function started() {
    const s = setup();
    const seen: Array<[boolean, boolean]> = [];
    s.engine.subscribe((running, interrupted) => seen.push([running, interrupted]));
    s.engine.start(base);
    await flush();
    s.ctx.setState('running');
    return { ...s, seen };
  }

  it('listens for statechange on the context it creates', () => {
    const { engine, ctx } = setup();
    engine.start(base);
    expect(ctx.addEventListener).toHaveBeenCalledWith('statechange', expect.any(Function));
    expect(ctx.stateListeners.size).toBe(1);
    engine.stop();
    engine.start(base);
    expect(ctx.stateListeners.size).toBe(1); // one per context, not one per run
  });

  for (const state of ['suspended', 'interrupted', 'closed']) {
    it(`stops and tells subscribers when the context goes ${state} while playing`, async () => {
      const { engine, ctx, timer, hits, seen } = await started();
      expect(engine.isRunning).toBe(true);

      ctx.setState(state);

      expect(engine.isRunning).toBe(false);
      expect(timer.active).toBe(false);
      expect(engine.getBeatState()).toBeNull();
      expect(seen).toEqual([
        [true, false],
        [false, true],
      ]);
      const before = hits.length;
      ctx.currentTime = 5;
      timer.fire();
      expect(hits).toHaveLength(before);
    });
  }

  it('a statechange to running, or any statechange while stopped, changes nothing', async () => {
    const { engine, ctx, seen } = await started();
    ctx.setState('running');
    expect(engine.isRunning).toBe(true);
    engine.stop();
    ctx.setState('suspended');
    ctx.setState('interrupted');
    expect(seen).toEqual([
      [true, false],
      [false, false],
    ]);
  });

  it('ignores a suspended statechange while its own resume() is still pending', async () => {
    const { engine, ctx } = setup();
    let resolve!: () => void;
    ctx.resume.mockImplementation(() => new Promise<void>((res) => (resolve = res)));
    engine.start(base);
    // e.g. the tail of an earlier suspend() landing just after Start was pressed again
    ctx.setState('suspended');
    expect(engine.isRunning).toBe(true);

    resolve();
    await flush();
    ctx.setState('running');
    expect(engine.isRunning).toBe(true);
    ctx.setState('interrupted');
    expect(engine.isRunning).toBe(false);
  });

  it('can be started again after an interruption', async () => {
    const { engine, ctx, seen, hits } = await started();
    ctx.setState('interrupted');
    hits.length = 0;
    engine.start(base);
    expect(engine.isRunning).toBe(true);
    expect(hits).toHaveLength(1);
    expect(seen.at(-1)).toEqual([true, false]);
  });

  it('dispose removes the statechange listener', async () => {
    const { engine, ctx } = await started();
    engine.dispose();
    expect(ctx.removeEventListener).toHaveBeenCalledWith('statechange', expect.any(Function));
    expect(ctx.stateListeners.size).toBe(0);
  });
});

describe('scheduling', () => {
  it('4/4 at 120: exact times and accents over two bars', () => {
    const { engine, hits, advance } = setup();
    engine.start(base);
    advance(3.5); // lookahead reaches 3.62, covering the 8th click at 3.58
    expectTimes(times(hits), [0.08, 0.58, 1.08, 1.58, 2.08, 2.58, 3.08, 3.58]);
    expect(hits.map((h) => h.gain)).toEqual([1, 0.6, 0.6, 0.6, 1, 0.6, 0.6, 0.6]);
    expect(hits.map((h) => h.tier)).toEqual([2, 1, 1, 1, 2, 1, 1, 1]);
    expect(new Set(hits.map((h) => h.sound))).toEqual(new Set(['wood']));
  });

  it('never schedules beyond the lookahead window', () => {
    const { engine, ctx, hits, advance } = setup();
    engine.start({ ...base, subdivision: 'sixteenth' });
    for (let t = 0.025; t < 2; t += 0.025) {
      advance(t);
      for (const h of hits) expect(h.time).toBeLessThan(ctx.currentTime + 0.12);
    }
  });

  it('triplets: three evenly spaced clicks per beat, the first carrying the accent', () => {
    const { engine, hits, advance } = setup();
    engine.start({ ...base, subdivision: 'triplet' });
    advance(0.95);
    const d = 0.5 / 3;
    expectTimes(times(hits), [0, 1, 2, 3, 4, 5].map((i) => 0.08 + i * d));
    expect(hits.map((h) => [h.gain, h.tier])).toEqual([
      [1, 2], [0.22, 0], [0.22, 0],
      [0.6, 1], [0.22, 0], [0.22, 0],
    ]);
  });

  it('swing: hits at 0 and 2/3 of the beat, nothing at 1/3', () => {
    const { engine, hits, advance } = setup();
    engine.start({ ...base, subdivision: 'swing' });
    advance(0.95);
    expectTimes(times(hits), [0.08, 0.08 + 1 / 3, 0.58, 0.58 + 1 / 3]);
    expect(hits.map((h) => h.gain)).toEqual([1, 0.22, 0.6, 0.22]);
  });

  it('maps soft / normal / accent to gain and tier', () => {
    const { engine, hits, advance } = setup();
    engine.start({ ...base, accents: [1, 2, 3, 2] });
    advance(1.5);
    expect(hits.map((h) => [h.gain, h.tier])).toEqual([
      [0.3, 0], [0.6, 1], [1, 2], [0.6, 1],
    ]);
  });

  it('a muted beat schedules nothing, subdivisions included, and time still advances', () => {
    const { engine, hits, advance } = setup();
    engine.start({ ...base, subdivision: 'eighth', accents: [3, 0, 2, 2] });
    advance(1.25);
    expectTimes(times(hits), [0.08, 0.33, 1.08, 1.33]);
  });

  it('uses the selected sound, switching live', () => {
    const { engine, hits, advance } = setup();
    engine.start({ ...base, sound: 'tom' });
    advance(0.3);
    engine.setSettings({ ...base, sound: 'clap' });
    advance(1);
    expect(hits.map((h) => h.sound)).toEqual(['tom', 'clap', 'clap']);
  });

  it('a tempo change rescales the wait for the next click, then runs at the new interval', () => {
    const { engine, hits, advance } = setup();
    engine.start(base);
    advance(0.7); // 0.08 and 0.58 are out; the next click is pencilled in for 1.08, 0.38 s away
    engine.setSettings({ ...base, bpm: 240 });
    advance(1.6);
    // twice the tempo: 0.19 s away instead of 0.38, then every 0.25 s
    expectTimes(times(hits), [0.08, 0.58, 0.89, 1.14, 1.39, 1.64]);
    // and the bar carries on: no restart on a tempo change
    expect(hits.map((h) => h.tier)).toEqual([2, 1, 1, 1, 2, 1]);
  });

  it('speeding up from a slow tempo is heard at once, not after the old beat runs out', () => {
    const { engine, ctx, hits, advance } = setup();
    ctx.currentTime = 100;
    engine.start({ ...base, bpm: 40 });
    advance(100.2); // 100.08 is out; at 40 bpm the next click would be 101.58
    engine.setSettings({ ...base, bpm: 240 });
    advance(101);
    expectTimes(times(hits), [100.08, 100.43, 100.68, 100.93]);
  });

  it('slowing down stretches the wait by the same ratio', () => {
    const { engine, hits, advance } = setup();
    engine.start(base);
    advance(0.7);
    engine.setSettings({ ...base, bpm: 60 });
    advance(2.4);
    expectTimes(times(hits), [0.08, 0.58, 1.46, 2.46]);
  });

  it('a tempo change never schedules ahead of a click already committed', () => {
    const fine = parsePatterns({
      version: 1,
      patterns: [{ id: 'fine', label: 'Fine', division: 12, slots: ['beat', ...Array(11).fill('sub')] }],
    });
    const { engine, hits, advance } = setup({ patterns: fine });
    engine.start({ ...base, bpm: 40, subdivision: 'fine' }); // 0.08 committed, 0.205 next
    engine.setSettings({ ...base, bpm: 240, subdivision: 'fine' });
    advance(0.2);
    const t = times(hits);
    expect(t[0]).toBeCloseTo(0.08, 9);
    expect(t[1]).toBeCloseTo(0.08 + 0.125 / 6, 9); // rescaled from the committed click, not from "now"
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
  });

  it('the beat phase stays sensible across a tempo change: it runs to 1 as the next beat lands', () => {
    const { engine, ctx, advance } = setup();
    ctx.currentTime = 100;
    engine.start({ ...base, bpm: 40 });
    advance(100.2);
    expect(engine.getBeatState()!.phase).toBeCloseTo(0.12 / 1.5, 6);
    engine.setSettings({ ...base, bpm: 240 });
    // the beat that began at 100.08 now ends at 100.43
    expect(engine.getBeatState()).toMatchObject({ beat: 0 });
    expect(engine.getBeatState()!.phase).toBeCloseTo(0.12 / 0.35, 6);
    advance(100.425);
    const late = engine.getBeatState()!;
    expect(late.beat).toBe(0);
    expect(late.phase).toBeGreaterThan(0.95);
    expect(late.phase).toBeLessThan(1); // not parked at 1 waiting for the old beat to end
    advance(100.45);
    expect(engine.getBeatState()!.beat).toBe(1);
    expect(engine.getBeatState()!.phase).toBeCloseTo(0.02 / 0.25, 6);
  });

  it('a tempo change while stopped has nothing to rescale', () => {
    const { engine, hits, advance } = setup();
    engine.start(base);
    advance(0.3);
    engine.stop();
    hits.length = 0;
    expect(() => engine.setSettings({ ...base, bpm: 200 })).not.toThrow();
    engine.start({ ...base, bpm: 200 });
    expect(hits[0].time).toBeCloseTo(0.3 + 0.08, 9);
  });

  it('a signature change restarts the bar at beat 1 on the existing grid', () => {
    const { engine, hits, advance } = setup();
    engine.start(base);
    advance(0.7);
    engine.setSettings(withSignature(base, '3/4'));
    advance(2.5);
    expectTimes(times(hits), [0.08, 0.58, 1.08, 1.58, 2.08, 2.58]);
    expect(hits.map((h) => h.tier)).toEqual([2, 1, /* restart */ 2, 1, 1, 2]);
  });

  it('a subdivision change restarts the bar too', () => {
    const { engine, hits, advance } = setup();
    engine.start(base);
    advance(0.7);
    engine.setSettings({ ...base, subdivision: 'eighth' });
    advance(1.5);
    expectTimes(times(hits), [0.08, 0.58, 1.08, 1.33, 1.58]);
    expect(hits.map((h) => h.gain)).toEqual([1, 0.6, 1, 0.22, 0.6]);
  });

  it('a change made mid-beat restarts at the next beat boundary, with no extra accent before it', () => {
    const { engine, hits, advance } = setup();
    const slow = { ...base, bpm: 60 };
    engine.start({ ...slow, subdivision: 'sixteenth' });
    advance(0.2); // 0.08 is out; the next sixteenth is pencilled in for 0.33
    engine.setSettings({ ...slow, subdivision: 'quarter' });
    advance(2.1);
    // Not 0.33: nothing sounds until the grid's next beat, which is the new beat 1.
    expectTimes(times(hits), [0.08, 1.08, 2.08]);
    expect(hits.map((h) => h.tier)).toEqual([2, 2, 1]);
  });

  it('a mid-beat signature change waits for the beat too, and the ball stays on the grid', () => {
    const { engine, hits, advance } = setup();
    engine.start({ ...base, bpm: 60, subdivision: 'triplet' });
    advance(0.5); // 0.08 and 0.4133 are out; the third triplet (0.7467) is next
    engine.setSettings({ ...withSignature(base, '3/4'), bpm: 60, subdivision: 'triplet' });
    advance(0.9);
    expect(engine.getBeatState()!.beat).toBe(0); // still the old beat, no early restart
    advance(1.5);
    const third = 1 / 3;
    expectTimes(times(hits), [0.08, 0.08 + third, 1.08, 1.08 + third]);
    expect(hits.map((h) => h.gain)).toEqual([1, 0.22, 1, 0.22]);
    expect(engine.getBeatState()).toMatchObject({ beat: 0 });
    expect(engine.getBeatState()!.phase).toBeCloseTo(0.42, 6);
  });

  it('setPatterns mid-beat restarts at the next beat boundary as well', () => {
    const eighths = parsePatterns({
      version: 1,
      patterns: [{ id: 'x', label: 'X', division: 2, slots: ['beat', 'sub'] }],
    });
    const quarters = parsePatterns({
      version: 1,
      patterns: [{ id: 'x', label: 'X', division: 1, slots: ['beat'] }],
    });
    const { engine, hits, advance } = setup({ patterns: eighths });
    engine.start({ ...base, bpm: 60, subdivision: 'x' });
    advance(0.2); // the "and" at 0.58 is next
    engine.setPatterns(quarters);
    advance(1.2);
    expectTimes(times(hits), [0.08, 1.08]);
    expect(hits.map((h) => h.tier)).toEqual([2, 2]);
  });

  it('changing only accents, sound or mode does not restart the bar', () => {
    const { engine, hits, advance } = setup();
    engine.start(base);
    advance(0.7);
    engine.setSettings({ ...base, mode: 'full', accents: [3, 2, 1, 2] });
    advance(1.5);
    expect(hits.map((h) => h.gain)).toEqual([1, 0.6, 0.3, 0.6]);
  });

  it('skips clicks it is badly late for instead of firing a burst, keeping the grid', () => {
    const { engine, ctx, timer, hits } = setup();
    engine.start(base);
    hits.length = 0;
    ctx.currentTime = 10; // e.g. a throttled background tab: no ticks for 10 s
    timer.fire();
    expect(hits).toHaveLength(1);
    expect(hits[0].time).toBeCloseTo(10.08, 9); // still on 0.08 + n × 0.5
    expect(hits[0].tier).toBe(2); // step 20 = beat 1 of bar 6
  });
});

describe('patterns', () => {
  const custom = parsePatterns({
    version: 1,
    patterns: [
      { id: 'two', label: 'Two', division: 2, beats: 2, slots: ['beat', 'rest', 'sub', 'sub'] },
      { id: 'eighth', label: '8ths', division: 2, slots: ['beat', 'sub'] },
    ],
  });

  it('a 2-beat pattern in 3/4 restarts at the bar line', () => {
    const { engine, hits, advance } = setup({ patterns: custom });
    engine.start({ ...withSignature(base, '3/4'), subdivision: 'two' });
    advance(2.9);
    // per bar (slots of 0.25 s): beat . sub sub beat . | repeat
    const bar = [0, 0.5, 0.75, 1];
    expectTimes(times(hits), [...bar, ...bar.map((t) => t + 1.5)].map((t) => t + 0.08));
    expect(hits.map((h) => h.gain)).toEqual([1, 0.22, 0.22, 0.6, 1, 0.22, 0.22, 0.6]);
  });

  it('an unknown pattern id plays as the first pattern', () => {
    const { engine, hits, advance } = setup({ patterns: custom });
    engine.start({ ...base, subdivision: 'missing' });
    advance(1);
    expectTimes(times(hits), [0.08, 0.58, 0.83, 1.08]);
  });

  it('defaults to the built-in patterns', () => {
    const { engine, hits, advance } = setup();
    engine.start({ ...base, subdivision: 'two' }); // not built in → quarter
    advance(1);
    expectTimes(times(hits), [0.08, 0.58, 1.08]);
  });

  it('setPatterns restarts the bar when the playing pattern changes', () => {
    const { engine, hits, advance } = setup();
    engine.start({ ...base, subdivision: 'two' }); // falls back to quarter
    advance(0.7);
    engine.setPatterns(custom); // now resolves to the real pattern
    advance(2);
    expectTimes(times(hits), [0.08, 0.58, 1.08, 1.58, 1.83, 2.08]);
    expect(hits.map((h) => h.gain)).toEqual([1, 0.6, /* restart */ 1, 0.22, 0.22, 0.6]);
  });

  it('setPatterns leaves the bar alone when the playing pattern is unaffected', () => {
    const { engine, hits, advance } = setup({ patterns: custom });
    engine.start({ ...base, subdivision: 'eighth' });
    advance(0.7);
    engine.setPatterns([...custom].reverse());
    advance(1.2);
    expect(hits.map((h) => h.gain)).toEqual([1, 0.22, 0.6, 0.22, 0.6]);
  });
});

describe('getBeatState', () => {
  it('is null before the first beat sounds, then tracks beat and phase', () => {
    const { engine, ctx } = setup();
    engine.start(base);
    expect(engine.getBeatState()).toBeNull(); // first beat is at 0.08

    const at = (t: number) => {
      ctx.currentTime = t;
      return engine.getBeatState();
    };
    expect(at(0.079)).toBeNull();
    expect(at(0.08)).toEqual({ beat: 0, phase: 0 });
    expect(at(0.33)!.beat).toBe(0);
    expect(at(0.33)!.phase).toBeCloseTo(0.5, 9);
  });

  it('advances through the bar and wraps', () => {
    const { engine, advance } = setup();
    engine.start(base);
    const seen: Array<[number, number]> = [];
    for (const t of [0.2, 0.7, 1.2, 1.7, 2.2]) {
      advance(t);
      const s = engine.getBeatState()!;
      seen.push([s.beat, s.phase]);
    }
    expect(seen.map(([b]) => b)).toEqual([0, 1, 2, 3, 0]);
    for (const [, phase] of seen) expect(phase).toBeCloseTo(0.24, 6);
  });

  it('counts beats, not subdivision slots, and still runs through muted beats and rests', () => {
    const patterns = parsePatterns({
      version: 1,
      patterns: [{ id: 'off', label: 'Off', division: 2, slots: ['rest', 'beat'] }],
    });
    const { engine, advance } = setup({ patterns });
    engine.start({ ...base, subdivision: 'off', accents: [3, 0, 2, 2] });
    advance(0.45);
    expect(engine.getBeatState()!.beat).toBe(0);
    expect(engine.getBeatState()!.phase).toBeCloseTo(0.74, 6);
    advance(0.7);
    expect(engine.getBeatState()!.beat).toBe(1);
  });

  it('caps phase at 1 if the scheduler stalls', () => {
    const { engine, ctx } = setup();
    engine.start(base);
    ctx.currentTime = 3;
    expect(engine.getBeatState()).toEqual({ beat: 0, phase: 1 });
  });

  it('does not let the queue grow when nobody is reading it', () => {
    const { engine, advance } = setup();
    engine.start({ ...base, bpm: 240 });
    advance(30);
    expect(engine.pendingBeats).toBeLessThanOrEqual(3);
  });
});

describe('subscribe', () => {
  it('notifies on running changes only, and can unsubscribe', () => {
    const { engine } = setup();
    const seen: boolean[] = [];
    const off = engine.subscribe((running) => seen.push(running));
    engine.start(base);
    engine.start(base);
    engine.setSettings({ ...base, bpm: 90 });
    engine.stop();
    engine.stop();
    engine.start(base);
    engine.dispose();
    expect(seen).toEqual([true, false, true, false]);

    off();
    engine.start(base);
    expect(seen).toHaveLength(4);
  });
});

describe('createTickTimer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    posted: unknown[] = [];
    terminated = false;
    constructor(public url: string) {
      FakeWorker.instances.push(this);
    }
    postMessage(m: unknown) {
      this.posted.push(m);
    }
    terminate() {
      this.terminated = true;
    }
  }

  function stubUrl() {
    const revoked: string[] = [];
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:fake',
      revokeObjectURL: (u: string) => revoked.push(u),
    });
    return revoked;
  }

  it('ticks from a blob Worker when available, and cleans up on stop', () => {
    vi.useFakeTimers();
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    const revoked = stubUrl();
    const cb = vi.fn();
    const timer: MetronomeTimer = createTickTimer();

    timer.start(cb, 25);
    const w = FakeWorker.instances[0];
    expect(w.url).toBe('blob:fake');
    expect(w.posted).toEqual([25]);
    w.onmessage!({ data: 0 });
    w.onmessage!({ data: 0 });
    expect(cb).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(200); // no main-thread interval alongside the worker
    expect(cb).toHaveBeenCalledTimes(2);

    timer.stop();
    expect(w.terminated).toBe(true);
    expect(revoked).toEqual(['blob:fake']);
    w.onmessage?.({ data: 0 }); // a tick already in flight is ignored
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('the worker script is valid and posts a tick per interval', async () => {
    vi.useFakeTimers();
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    let blob: Blob | null = null;
    vi.stubGlobal('URL', {
      createObjectURL: (b: Blob) => {
        blob = b;
        return 'blob:fake';
      },
      revokeObjectURL: () => {},
    });
    const timer = createTickTimer();
    timer.start(() => {}, 25);
    const source = await blob!.text();
    timer.stop();

    // Run the script the way a worker would, with its globals supplied.
    const posted: unknown[] = [];
    const onmessage = new Function('postMessage', `var onmessage;${source};return onmessage;`)((m: unknown) =>
      posted.push(m),
    ) as (e: { data: number }) => void;
    onmessage({ data: 25 });
    vi.advanceTimersByTime(100);
    expect(posted).toHaveLength(4);
    onmessage({ data: 0 }); // stop
    vi.advanceTimersByTime(100);
    expect(posted).toHaveLength(4);
  });

  it('falls back to setInterval when Worker is unavailable', () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', undefined);
    const cb = vi.fn();
    const timer = createTickTimer();
    timer.start(cb, 25);
    vi.advanceTimersByTime(100);
    expect(cb).toHaveBeenCalledTimes(4);
    timer.stop();
    vi.advanceTimersByTime(100);
    expect(cb).toHaveBeenCalledTimes(4);
  });

  it('falls back when constructing the Worker throws (e.g. CSP)', () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('SecurityError');
        }
      },
    );
    const revoked = stubUrl();
    const cb = vi.fn();
    const timer = createTickTimer();
    expect(() => timer.start(cb, 25)).not.toThrow();
    vi.advanceTimersByTime(50);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(revoked).toEqual(['blob:fake']);
    timer.stop();
  });

  it('falls back when URL.createObjectURL is missing', () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('URL', {});
    const cb = vi.fn();
    const timer = createTickTimer();
    timer.start(cb, 25);
    vi.advanceTimersByTime(50);
    expect(cb).toHaveBeenCalledTimes(2);
    timer.stop();
  });

  it('falls back when the Worker reports an error after construction', () => {
    vi.useFakeTimers();
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    stubUrl();
    const cb = vi.fn();
    const timer = createTickTimer();
    timer.start(cb, 25);
    const w = FakeWorker.instances[0];
    w.onerror!({ preventDefault() {} });
    expect(w.terminated).toBe(true);
    vi.advanceTimersByTime(50);
    expect(cb).toHaveBeenCalledTimes(2);
    timer.stop();
    vi.advanceTimersByTime(50);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('restarting replaces the previous run', () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', undefined);
    const a = vi.fn();
    const b = vi.fn();
    const timer = createTickTimer();
    timer.start(a, 25);
    timer.start(b, 25);
    vi.advanceTimersByTime(25);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    timer.stop();
  });
});
