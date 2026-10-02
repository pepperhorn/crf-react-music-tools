/**
 * Test doubles for the tuner's audio path: getUserMedia, AudioContext,
 * AnalyserNode and a manually-driven requestAnimationFrame. Test-only.
 *
 * `frames(n)` runs n animation frames; the analyser fills its buffer with a
 * sine at `setFreq(hz)` (null = silence) so the real YIN detector runs.
 */
import { vi } from 'vitest';

export class FakeAudioTrack {
  readyState: 'live' | 'ended' = 'live';
  muted = false;
  kind = 'audio';
  listeners = new Map<string, Set<EventListener>>();
  addEventListener = vi.fn((type: string, cb: EventListener) => {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  });
  removeEventListener = vi.fn((type: string, cb: EventListener) => {
    this.listeners.get(type)?.delete(cb);
  });
  listenerCount(): number {
    let n = 0;
    this.listeners.forEach((set) => (n += set.size));
    return n;
  }
  private fire(type: string): void {
    this.listeners.get(type)?.forEach((cb) => cb(new Event(type)));
  }
  /** Like the real API, stop() ends the track WITHOUT firing 'ended'. */
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
  /** Simulate the browser taking the mic away (unplugged, revoked, OS grabbed it): fires 'ended'. */
  end(): void {
    this.readyState = 'ended';
    this.fire('ended');
  }
  mute(): void {
    this.muted = true;
    this.fire('mute');
  }
  unmute(): void {
    this.muted = false;
    this.fire('unmute');
  }
}

export class FakeAudioStream {
  constructor(public tracks: FakeAudioTrack[]) {}
  getTracks() {
    return this.tracks;
  }
}

export type GumMode = 'ok' | 'denied' | 'notfound' | 'missing' | 'pending';

export interface AudioMocks {
  contexts: FakeAudioContext[];
  tracks: FakeAudioTrack[];
  getUserMedia: ReturnType<typeof vi.fn>;
  setFreq(hz: number | null): void;
  /** Run `n` animation frames, each advancing the clock by `ms` (default ~16.7 ms, a 60 Hz display). */
  frames(n: number, ms?: number): void;
  /**
   * Make callbacks start late: during frame `i` (counted from this call),
   * performance.now() reads `lag(i)` ms after the timestamp the frame's
   * callbacks were given. Real callbacks never start exactly on the frame time.
   */
  setCallbackLag(lag: ((frame: number) => number) | null): void;
  /** Resolve a getUserMedia held with mode 'pending'. */
  resolvePending(): void;
  pendingRafCount(): number;
}

let freq: number | null = null;

export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: 'suspended' | 'running' | 'closed' | 'interrupted' = 'suspended';
  sampleRate = 48000;
  listeners = new Map<string, Set<EventListener>>();
  addEventListener = vi.fn((type: string, cb: EventListener) => {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  });
  removeEventListener = vi.fn((type: string, cb: EventListener) => {
    this.listeners.get(type)?.delete(cb);
  });
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
  /** Simulate the browser moving the context to `state` (e.g. an iOS interruption) and fire 'statechange'. */
  setState(state: FakeAudioContext['state']): void {
    this.state = state;
    this.listeners.get('statechange')?.forEach((cb) => cb(new Event('statechange')));
  }
  resume = vi.fn(async () => {
    if (this.state !== 'closed') this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  /** Set to make the next createMediaStreamSource throw. */
  failSource = false;
  sources: Array<{ connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  analysers: Array<{ disconnect: ReturnType<typeof vi.fn>; getFloatTimeDomainData: (buf: Float32Array) => void }> = [];
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createMediaStreamSource = vi.fn(() => {
    if (this.failSource) throw new Error('createMediaStreamSource failed');
    const s = { connect: vi.fn(), disconnect: vi.fn() };
    this.sources.push(s);
    return s;
  });
  createAnalyser = vi.fn(() => {
    const sr = this.sampleRate;
    const a = {
      fftSize: 2048,
      disconnect: vi.fn(),
      getFloatTimeDomainData: (buf: Float32Array) => {
        for (let i = 0; i < buf.length; i++) buf[i] = freq === null ? 0 : 0.5 * Math.sin((2 * Math.PI * freq * i) / sr);
      },
    };
    this.analysers.push(a);
    return a;
  });
}

export function installAudioMocks(mode: GumMode = 'ok'): AudioMocks {
  freq = null;
  FakeAudioContext.instances = [];
  const tracks: FakeAudioTrack[] = [];
  let pendingResolve: (() => void) | null = null;

  const makeStream = () => {
    const t = new FakeAudioTrack();
    tracks.push(t);
    return new FakeAudioStream([t]);
  };

  const getUserMedia = vi.fn((_c: MediaStreamConstraints) => {
    if (mode === 'denied') return Promise.reject(new DOMException('denied', 'NotAllowedError'));
    if (mode === 'notfound') return Promise.reject(new DOMException('none', 'NotFoundError'));
    if (mode === 'pending')
      return new Promise((resolve) => {
        pendingResolve = () => resolve(makeStream());
      });
    return Promise.resolve(makeStream());
  });

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: mode === 'missing' ? undefined : { getUserMedia },
  });
  vi.stubGlobal('AudioContext', FakeAudioContext);

  let rafId = 0;
  let queue = new Map<number, FrameRequestCallback>();
  let clock = 1000;
  let lagFor: ((frame: number) => number) | null = null;
  let lagFrame = 0;
  let lag = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafId += 1;
    queue.set(rafId, cb);
    return rafId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    queue.delete(id);
  });
  vi.spyOn(performance, 'now').mockImplementation(() => clock + lag);

  return {
    contexts: FakeAudioContext.instances,
    tracks,
    getUserMedia,
    setFreq(hz) {
      freq = hz;
    },
    frames(n, ms = 1000 / 60) {
      for (let i = 0; i < n; i++) {
        clock += ms;
        lag = lagFor ? lagFor(lagFrame++) : 0;
        const run = queue;
        queue = new Map();
        run.forEach((cb) => cb(clock));
      }
    },
    setCallbackLag(fn) {
      lagFor = fn;
      lagFrame = 0;
      lag = 0;
    },
    resolvePending() {
      pendingResolve?.();
    },
    pendingRafCount() {
      return queue.size;
    },
  };
}

export function uninstallAudioMocks(): void {
  delete (navigator as unknown as Record<string, unknown>).mediaDevices;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

/** matchMedia stub: `wide` controls (min-width: 640px), `reduced` the motion query. */
export function stubTunerMedia({ wide = true, reduced = false } = {}): void {
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
