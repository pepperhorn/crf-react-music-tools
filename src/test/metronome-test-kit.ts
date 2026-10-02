/**
 * Test doubles for the metronome UI: a manually-driven requestAnimationFrame,
 * a matchMedia stub, and a real MetronomeEngine wired to a fake audio clock,
 * silent voices and a manual tick timer. Test-only.
 */
import { vi } from 'vitest';
import { MetronomeEngine, type MetronomeTimer } from '../metronome/engine';
import { SOUNDS, type SoundId } from '../metronome/model';
import type { Voice } from '../metronome/voices';

/** matchMedia stub: `wide` controls (min-width: 640px), `reduced` the motion query. */
export function stubMetronomeMedia({ wide = true, reduced = false } = {}): void {
  const mm = (q: string) => ({
    matches: /min-width:\s*640px/.test(q) ? wide : /prefers-reduced-motion/.test(q) ? reduced : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  vi.stubGlobal('matchMedia', mm);
  window.matchMedia = mm as unknown as typeof window.matchMedia;
}

export interface RafMock {
  /** Run `n` animation frames. */
  frames(n?: number): void;
  pending(): number;
}

export function stubRaf(): RafMock {
  let id = 0;
  let queue = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    id += 1;
    queue.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    queue.delete(handle);
  });
  return {
    frames(n = 1) {
      for (let i = 0; i < n; i++) {
        const run = queue;
        queue = new Map();
        run.forEach((cb) => cb(0));
      }
    },
    pending: () => queue.size,
  };
}

export interface FakeEngineKit {
  /** Pass as `createEngine`; counts how many engines were made. */
  createEngine: () => MetronomeEngine;
  engines: MetronomeEngine[];
  ctx: {
    currentTime: number;
    state: string;
    resume: ReturnType<typeof vi.fn>;
    suspend: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  /** Every click handed to a voice. */
  hits: Array<{ sound: SoundId; time: number }>;
  /** Move the audio clock forward and run one scheduler tick. */
  advance(seconds: number): void;
  /** Make the next context creation throw (no Web Audio). */
  failContext: boolean;
  /** Put the context in `state` and fire `statechange`, as the browser does (e.g. 'interrupted' for an iOS call). */
  setContextState(state: string): void;
}

export function fakeEngineKit(): FakeEngineKit {
  const hits: FakeEngineKit['hits'] = [];
  const stateListeners = new Set<() => void>();
  const ctx = {
    currentTime: 0,
    state: 'running',
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    suspend: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    addEventListener(type: string, fn: () => void) {
      if (type === 'statechange') stateListeners.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      if (type === 'statechange') stateListeners.delete(fn);
    },
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
  };
  let tick: (() => void) | null = null;
  const timer: MetronomeTimer = {
    start(cb) {
      tick = cb;
    },
    stop() {
      tick = null;
    },
  };
  const voices = Object.fromEntries(
    SOUNDS.map((s) => [s.id, ((_c, _d, time) => void hits.push({ sound: s.id, time })) as Voice]),
  ) as Record<SoundId, Voice>;

  const kit: FakeEngineKit = {
    engines: [],
    ctx,
    hits,
    failContext: false,
    createEngine: () => {
      const engine = new MetronomeEngine({
        createContext: () => {
          if (kit.failContext) throw new Error('Web Audio is not supported in this browser');
          return ctx as unknown as AudioContext;
        },
        voices,
        timer,
      });
      kit.engines.push(engine);
      return engine;
    },
    setContextState(state) {
      ctx.state = state;
      for (const fn of [...stateListeners]) fn();
    },
    advance(seconds) {
      ctx.currentTime += seconds;
      tick?.();
    },
  };
  return kit;
}
