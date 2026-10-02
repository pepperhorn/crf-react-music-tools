/**
 * Metronome playback engine: a lookahead scheduler in the style of Chris
 * Wilson's "A Tale of Two Clocks".
 *
 * Two clocks are involved. A coarse JS timer wakes us every TICK_MS; on each
 * wake we schedule, on the sample-accurate AudioContext clock, every click
 * that falls inside the next LOOKAHEAD_S. Timer jitter therefore never reaches
 * the audio as long as a tick arrives at least once per lookahead window.
 *
 * Everything the engine touches is injectable (context factory, voices,
 * timer), so it runs under test with no real audio and no real time.
 *
 * Self-contained: imports only its sibling model/voices modules.
 */
import {
  BUILTIN_PATTERNS,
  DEFAULT_METRONOME_SETTINGS,
  resolvePattern,
  stepAt,
  stepSound,
  type MetronomeSettings,
  type SoundId,
  type SubdivisionPattern,
} from './model';
import { VOICES, type Voice } from './voices';

/** How often the scheduler wakes, in ms. */
export const TICK_MS = 25;
/** How far ahead of `currentTime` clicks are committed, in seconds. */
export const LOOKAHEAD_S = 0.12;
/** Gap between pressing start and the first click, in seconds. */
export const START_DELAY_S = 0.08;
/**
 * A step this far behind `currentTime` is dropped rather than played late.
 * Without it a stalled timer (throttled background tab, long main-thread
 * block) would fire every missed click at once when it wakes.
 */
export const LATE_TOLERANCE_S = 0.1;
/**
 * Level of the master gain every click passes through. Each voice peaks at
 * about 0.6–0.8 on an accent; at fast subdivisions the tail of one click is
 * still sounding when the next starts, and this keeps their sum off the rail.
 */
export const MASTER_GAIN = 0.8;

// ---------------------------------------------------------------------------
// Tick timer
// ---------------------------------------------------------------------------

/** A repeating timer. `start` replaces any previous run; `stop` is idempotent. */
export interface MetronomeTimer {
  start(cb: () => void, ms: number): void;
  stop(): void;
}

/** Runs inside the worker: post a message every N ms, where N is the message received. */
const WORKER_SOURCE =
  'var id=null;onmessage=function(e){if(id!==null){clearInterval(id);id=null}' +
  'if(e.data>0){id=setInterval(function(){postMessage(0)},e.data)}};';

/**
 * The default timer. Browsers throttle main-thread `setInterval` to about
 * once a second in background tabs, far longer than the lookahead, so the
 * ticks come from a Web Worker (built from a Blob URL so no separate file has
 * to be served). If Worker / Blob / URL.createObjectURL is missing, or the
 * worker cannot be created or errors (e.g. a CSP without `worker-src blob:`),
 * it falls back to `setInterval` on the main thread — fine in the foreground,
 * clicks drop out in a background tab.
 */
export function createTickTimer(): MetronomeTimer {
  let worker: Worker | null = null;
  let url: string | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;

  const dropWorker = () => {
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      try {
        worker.terminate();
      } catch {
        /* already gone */
      }
      worker = null;
    }
    if (url !== null) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* nothing to release */
      }
      url = null;
    }
  };

  const stop = () => {
    dropWorker();
    if (interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  };

  const start = (cb: () => void, ms: number) => {
    stop();
    try {
      if (
        typeof Worker !== 'function' ||
        typeof Blob !== 'function' ||
        typeof URL === 'undefined' ||
        typeof URL.createObjectURL !== 'function'
      ) {
        throw new Error('no worker support');
      }
      url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
      const w = new Worker(url);
      worker = w;
      w.onmessage = () => cb();
      // A blocked or broken worker reports asynchronously, not by throwing.
      w.onerror = (e) => {
        e?.preventDefault?.();
        if (worker !== w) return;
        dropWorker();
        interval = setInterval(cb, ms);
      };
      w.postMessage(ms);
    } catch {
      dropWorker();
      interval = setInterval(cb, ms);
    }
  };

  return { start, stop };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface MetronomeEngineDeps {
  /** Makes the AudioContext on first start. Default: `AudioContext` / `webkitAudioContext`. */
  createContext?: () => AudioContext;
  /** Sound synthesis. Default: `VOICES` from voices.ts. */
  voices?: Record<SoundId, Voice>;
  /** Scheduler wake-ups. Default: `createTickTimer()`. */
  timer?: MetronomeTimer;
  /** Subdivision patterns `settings.subdivision` is resolved against. Default: the built-ins. */
  patterns?: readonly SubdivisionPattern[];
}

/** Where playback is right now, for animating the UI. */
export interface BeatState {
  /** Beat within the bar, 0-based. */
  beat: number;
  /** Progress through that beat, 0 → 1. */
  phase: number;
}

/**
 * Told when playback starts (`running` true) or stops (false). `interrupted`
 * is true when the engine stopped by itself because the AudioContext stopped
 * producing sound (phone call, backgrounded app, refused resume) rather than
 * because `stop()` was called.
 */
export type MetronomeListener = (running: boolean, interrupted: boolean) => void;

interface QueuedBeat {
  time: number;
  beat: number;
  duration: number;
}

function defaultCreateContext(): AudioContext {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio is not supported in this browser');
  return new Ctor();
}

function samePattern(a: SubdivisionPattern, b: SubdivisionPattern): boolean {
  return a.division === b.division && a.beats === b.beats && a.slots.join() === b.slots.join();
}

export class MetronomeEngine {
  private readonly createContext: () => AudioContext;
  private readonly voices: Record<SoundId, Voice>;
  private readonly timer: MetronomeTimer;

  private patterns: readonly SubdivisionPattern[];
  private settings: MetronomeSettings = DEFAULT_METRONOME_SETTINGS;
  private pattern: SubdivisionPattern;

  private ctx: AudioContext | null = null;
  /** One per run, so stop() can cut off clicks already committed to the audio clock. */
  private master: GainNode | null = null;
  private running = false;
  /** Index of the next slot to schedule, counted from the last (re)start of the bar. */
  private step = 0;
  /** Context time of that slot. */
  private nextTime = 0;
  /** Context time of the last slot handed to the audio clock (sounding or not). */
  private lastStepTime = -Infinity;
  /** Beat boundaries already scheduled, oldest first; drives getBeatState(). */
  private beatQueue: QueuedBeat[] = [];
  /** Bumped by every start and stop, so a late promise can tell its run is over. */
  private run = 0;
  /** resume() calls not yet settled. While any is pending a non-running state is not an interruption. */
  private resuming = 0;
  private readonly listeners = new Set<MetronomeListener>();

  constructor(deps: MetronomeEngineDeps = {}) {
    this.createContext = deps.createContext ?? defaultCreateContext;
    this.voices = deps.voices ?? VOICES;
    this.timer = deps.timer ?? createTickTimer();
    this.patterns = deps.patterns ?? BUILTIN_PATTERNS;
    this.pattern = resolvePattern(this.patterns, this.settings.subdivision);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Scheduled beats not yet pruned. Diagnostic; stays small while running. */
  get pendingBeats(): number {
    return this.beatQueue.length;
  }

  /**
   * Start from beat 1. Call this directly inside the click/tap handler: the
   * AudioContext is created and resumed synchronously here, which iOS Safari
   * requires for audio to be allowed at all. Throws if no context can be
   * created (the engine stays stopped). While already running it applies
   * `settings` and resumes the context again, in case it was suspended behind
   * our back.
   */
  start(settings: MetronomeSettings): void {
    if (this.running) {
      this.setSettings(settings);
      if (this.ctx) this.resume(this.ctx);
      return;
    }
    const ctx = this.ctx ?? this.adoptContext(this.createContext());
    this.run += 1;
    this.resume(ctx);

    const master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);
    this.master = master;

    this.applySettings(settings);
    this.step = 0;
    this.nextTime = ctx.currentTime + START_DELAY_S;
    this.lastStepTime = -Infinity;
    this.beatQueue = [];
    this.running = true;

    try {
      this.timer.start(this.tick, TICK_MS);
      this.tick();
    } catch (err) {
      // Nobody has been told we are running yet, so there is nothing to
      // announce: just make sure no timer or half-built run is left behind.
      this.teardown();
      this.release(ctx);
      throw err;
    }
    this.emit(false);
  }

  /**
   * Stop and silence immediately. Keeps the AudioContext for the next start,
   * but suspends it so the audio session (and the hardware) is released while
   * idle; `start()` resumes it.
   */
  stop(): void {
    if (!this.running) return;
    this.halt(false);
    if (this.ctx) this.release(this.ctx);
  }

  /** Stop and close the AudioContext. Call on unmount. The engine may be started again. */
  dispose(): void {
    this.stop();
    this.timer.stop();
    const ctx = this.ctx;
    this.ctx = null;
    this.resuming = 0;
    if (ctx) {
      try {
        ctx.removeEventListener('statechange', this.onStateChange);
      } catch {
        /* nothing to remove */
      }
      try {
        void Promise.resolve(ctx.close()).catch(() => {});
      } catch {
        /* already closed */
      }
    }
  }

  /**
   * Apply new settings. Takes effect on the next step to be scheduled, so
   * clicks already inside the lookahead window (up to LOOKAHEAD_S) still play
   * as they were. Changing signature or subdivision restarts the bar at beat
   * 1 on the next beat boundary of the existing time grid (nothing sounds
   * between the change and that boundary); tempo, sound and accent changes do
   * not restart it. A tempo change also rescales the wait for the next step,
   * so it is heard straight away rather than after the old beat has run out.
   */
  setSettings(settings: MetronomeSettings): void {
    const prev = this.settings;
    const prevPattern = this.pattern;
    this.applySettings(settings);
    if (
      settings.signature !== prev.signature ||
      settings.subdivision !== prev.subdivision ||
      !samePattern(prevPattern, this.pattern)
    ) {
      this.restartBar(prev, prevPattern);
    }
    if (settings.bpm !== prev.bpm && prev.bpm > 0 && settings.bpm > 0) this.retime(prev.bpm / settings.bpm);
  }

  /**
   * Replace the pattern list (e.g. once presets have loaded). The bar restarts
   * only if the pattern actually playing changed shape.
   */
  setPatterns(patterns: readonly SubdivisionPattern[]): void {
    const prevPattern = this.pattern;
    this.patterns = patterns;
    this.pattern = resolvePattern(patterns, this.settings.subdivision);
    if (!samePattern(prevPattern, this.pattern)) this.restartBar(this.settings, prevPattern);
  }

  /**
   * The beat sounding now and how far through it we are, read off the audio
   * clock — call it from requestAnimationFrame. Null when stopped or before
   * the first beat has sounded. `beat` follows the beat grid even when that
   * beat is muted or its first slot is a rest.
   */
  getBeatState(): BeatState | null {
    if (!this.running || !this.ctx) return null;
    const now = this.ctx.currentTime;
    this.pruneBeats(now);
    const head = this.beatQueue[0];
    if (!head || head.time > now) return null;
    return { beat: head.beat, phase: Math.min(1, (now - head.time) / head.duration) };
  }

  /** Be told when playback starts or stops (see `MetronomeListener`). Returns an unsubscribe function. */
  subscribe(listener: MetronomeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private applySettings(settings: MetronomeSettings): void {
    this.settings = settings;
    this.pattern = resolvePattern(this.patterns, settings.subdivision);
  }

  /**
   * Begin the bar again at beat 1. If the next slot to schedule is part-way
   * through a beat of the outgoing pattern, skip its remaining slots so the
   * new bar starts on that beat's end — restarting on the slot grid would put
   * a second accent a fraction of a beat after the last one.
   */
  private restartBar(prev: MetronomeSettings, prevPattern: SubdivisionPattern): void {
    const sub = this.step % prevPattern.division;
    if (this.running && sub !== 0) {
      this.nextTime += (prevPattern.division - sub) * (60 / prev.bpm / prevPattern.division);
    }
    this.step = 0;
  }

  /**
   * The tempo changed by `1 / ratio`: scale the time still to run before the
   * next step by `ratio`. Measured from now, or from the last committed click
   * if that is still in the future, so the next step never lands before
   * either. The beat in progress is stretched the same way, which keeps
   * getBeatState()'s phase reaching 1 exactly as the next beat arrives.
   */
  private retime(ratio: number): void {
    if (!this.running || !this.ctx) return;
    const base = Math.max(this.ctx.currentTime, this.lastStepTime);
    if (this.nextTime <= base) return;
    const beat = this.beatQueue[this.beatQueue.length - 1];
    if (beat && beat.time <= base) {
      const end = beat.time + beat.duration;
      if (end > base) beat.duration = base - beat.time + (end - base) * ratio;
    }
    this.nextTime = base + (this.nextTime - base) * ratio;
  }

  private emit(interrupted: boolean): void {
    for (const l of [...this.listeners]) l(this.running, interrupted);
  }

  private adoptContext(ctx: AudioContext): AudioContext {
    this.ctx = ctx;
    this.resuming = 0;
    try {
      ctx.addEventListener('statechange', this.onStateChange);
    } catch {
      /* no events on this context: interruptions go unnoticed */
    }
    return ctx;
  }

  /**
   * Ask the context to run. A no-op on a running context. If the browser
   * refuses (autoplay policy, audio session taken) the run it was for is
   * stopped rather than left "playing" in silence.
   */
  private resume(ctx: AudioContext): void {
    const run = this.run;
    const settle = (ok: boolean) => {
      if (this.ctx !== ctx) return;
      this.resuming = Math.max(0, this.resuming - 1);
      if (!ok && this.running && this.run === run) this.halt(true);
    };
    try {
      const pending = Promise.resolve(ctx.resume());
      this.resuming += 1;
      pending.then(
        () => settle(true),
        () => settle(false),
      );
    } catch {
      /* older Safari: resume may be missing or throw */
    }
  }

  /**
   * The context left `running` while we were playing: an iOS phone call, a
   * backgrounded PWA, the tab's audio being suspended. Nothing is audible, so
   * stop and say so instead of animating in silence. A non-running state while
   * one of our own resume() calls is still pending is just the start-up (or
   * the tail of an earlier suspend) and is left alone.
   */
  private readonly onStateChange = (): void => {
    const ctx = this.ctx;
    if (!ctx || !this.running || this.resuming > 0) return;
    if (ctx.state !== 'running') this.halt(true);
  };

  /**
   * Suspend the context, best effort. The statechange this causes arrives
   * while we are stopped, or, if Start is pressed again first, while that
   * start's resume() is pending — neither is taken for an interruption.
   */
  private release(ctx: AudioContext): void {
    try {
      void Promise.resolve(ctx.suspend()).catch(() => {});
    } catch {
      /* suspend may be missing or refuse: the context just stays live */
    }
  }

  /** Back to the stopped state, silently. */
  private teardown(): void {
    this.running = false;
    this.run += 1;
    this.timer.stop();
    try {
      this.master?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.master = null;
    this.beatQueue = [];
  }

  private halt(interrupted: boolean): void {
    if (!this.running) return;
    this.teardown();
    this.emit(interrupted);
  }

  /** Drop beats that have been superseded by a later one that has already sounded. */
  private pruneBeats(now: number): void {
    const q = this.beatQueue;
    while (q.length > 1 && q[1].time <= now) q.shift();
  }

  /** Commit every step that falls inside the lookahead window to the audio clock. */
  private readonly tick = (): void => {
    const { ctx, master } = this;
    if (!this.running || !ctx || !master) return;
    const now = ctx.currentTime;
    const horizon = now + LOOKAHEAD_S;

    while (this.nextTime < horizon) {
      // Read live each step so a settings change lands on the very next one.
      const { settings, pattern } = this;
      const step = stepAt(settings, pattern, this.step);
      const time = this.nextTime;

      if (time >= now - LATE_TOLERANCE_S) {
        const sound = stepSound(settings, step);
        if (sound) this.voices[settings.sound](ctx, master, time, sound.gain, sound.tier);
      }
      if (step.isBeat) {
        this.beatQueue.push({ time, beat: step.beat, duration: step.duration * pattern.division });
      }

      this.lastStepTime = time;
      this.nextTime = time + step.duration;
      this.step += 1;
    }
    this.pruneBeats(now);
  };
}
