/**
 * Microphone → smoothed pitch, for the tuner.
 *
 * iOS / Safari only lets an AudioContext start (leave `suspended`) from a
 * user gesture. The host therefore calls `createTunerAudioContext()`
 * synchronously inside the click handler that opens the tuner, and passes
 * the result to <Tuner audioContext>. The hook takes OWNERSHIP of that
 * context: it wires the mic into it and closes it on cleanup. Without a
 * handed-in context (or once the hook has released it, e.g. a StrictMode
 * remount) the hook creates its own, which is fine on desktop browsers.
 *
 * getUserMedia is called from the effect (no gesture needed for the prompt).
 * Cleanup stops every track, disconnects the nodes, closes the context and
 * cancels the animation frame — including when the stream arrives after
 * unmount.
 *
 * iOS suspends (or 'interrupted's) the context on calls, Siri, lock screen or
 * backgrounding; the hook resumes it on 'statechange' and when the page
 * becomes visible again, while it is still active.
 *
 * When that fails — resume() rejects, or the context is still suspended or
 * interrupted afterwards — the status becomes 'interrupted'. A muted track
 * (the OS lent the mic to a call) is 'interrupted' too, until it unmutes. A
 * track that ends (unplugged, permission revoked, taken by another app) is
 * 'lost'. Both are recoverable from a tap: call `restart()` from the click
 * handler. It resumes the context inside the gesture, or, when the track is
 * gone, makes a new context in the gesture and re-acquires the mic.
 *
 * getUserMedia needs a secure origin; an insecure one reports 'insecure'.
 *
 * Cost: detection runs on a clock (~30 Hz by default), not every Nth frame, so
 * a 120 Hz display does not double the work. The clock is the timestamp
 * requestAnimationFrame hands the callback, so the cadence does not depend on
 * how promptly the callback ran; `minFreq` bounds YIN's lag
 * search; and the reported frequency is quantised to whole cents so a steady
 * note does not re-render the tuner for sub-cent wobble.
 *
 * `detectIntervalMs` and `smoothing` (the Response setting) are read on every
 * tick, so changing them applies to the running loop: the mic, the context
 * and the smoother's history all carry on.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHROMATIC_MIN_FREQ,
  EMPTY_PITCH_HISTORY,
  RESPONSE_PROFILES,
  detectPitch,
  smoothPitch,
  type PitchHistory,
  type SmoothPitchOptions,
} from './pitch';

export type MicStatus = 'starting' | 'listening' | 'denied' | 'unavailable' | 'insecure' | 'lost' | 'interrupted';

export interface MicPitch {
  status: MicStatus;
  /** Smoothed fundamental in Hz (quantised to whole cents), or null for no (or too-quiet) signal. */
  freq: number | null;
  /**
   * Recover from 'lost' or 'interrupted'. Call it SYNCHRONOUSLY in a click
   * handler: it resumes (or recreates) the AudioContext inside the gesture.
   */
  restart: () => void;
}

export interface MicPitchOptions {
  /** Lowest frequency to search for (Hz). Default 35 (chromatic, bass). */
  minFreq?: number;
  /** Minimum time between detections (ms). Default 30 (the 'medium' response). */
  detectIntervalMs?: number;
  /** Median window and dropout hold. Default: the 'medium' response (5 detections, 600 ms). */
  smoothing?: SmoothPitchOptions;
}

/** 4096 samples reach bass E1 (≈41 Hz) at 44.1/48 kHz. */
export const TUNER_FFT_SIZE = 4096;

/**
 * Default minimum time between detections: ~30 Hz whatever the display's
 * refresh rate (each YIN call is a few million MACs). A little under 33 ms so
 * that vsync jitter on a 60 Hz display still gives every other frame. The
 * other responses follow the same rule (15 → every frame, 60 → every 4th).
 */
const DETECT_INTERVAL_MS = RESPONSE_PROFILES.medium.detectIntervalMs;

/**
 * A frame counts as due this much before the interval has fully elapsed, to
 * absorb rounding and drift in frame timestamps (Safari rounds them to 1 ms).
 * Kept at 1 ms: 2 would make Slow (60 ms) fire on every 7th frame of a 120 Hz
 * display (58.3 ms) instead of every 8th.
 */
const DETECT_TOLERANCE_MS = 1;

/** Snap a frequency to the nearest whole cent (relative to A440), so tiny wobble reads as no change. */
export function quantizeToCent(freq: number): number {
  return 440 * Math.pow(2, Math.round(1200 * Math.log2(freq / 440)) / 1200);
}

type AudioContextCtor = typeof AudioContext;

/**
 * Contexts this hook has closed. `state` only becomes 'closed' when close()
 * resolves, so a synchronous remount (StrictMode) would otherwise reuse a
 * context that is already shutting down and never hear the mic.
 */
const released = new WeakSet<AudioContext>();

function release(ctx: AudioContext): void {
  if (released.has(ctx)) return;
  released.add(ctx);
  if (ctx.state !== 'closed') void ctx.close().catch(() => {});
}

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Create and resume an AudioContext. Call this SYNCHRONOUSLY inside the click
 * handler that opens the tuner, so iOS treats it as user-initiated.
 * Returns null when Web Audio is unavailable.
 */
export function createTunerAudioContext(): AudioContext | null {
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  try {
    const ctx = new Ctor();
    void ctx.resume?.()?.catch?.(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** True when the page is known to be on an insecure (non-https, non-localhost) origin. */
function isInsecureOrigin(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === false;
}

function errorStatus(err: unknown): MicStatus {
  const name = (err as { name?: string } | null)?.name;
  return name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError' ? 'denied' : 'unavailable';
}

/** What `restart()` needs from the live effect. */
interface LiveMic {
  /** True when the track has ended or is muted: resuming will not bring the sound back. */
  needsNewMic(): boolean;
  /** Resume the context (call inside a gesture). */
  resume(): void;
}

export function useMicPitch(audioContext?: AudioContext | null, opts: MicPitchOptions = {}): MicPitch {
  const [status, setStatus] = useState<MicStatus>('starting');
  const [freq, setFreq] = useState<number | null>(null);
  // A context made inside a Restart tap replaces the handed-in one.
  const [restartContext, setRestartContext] = useState<AudioContext | null>(null);
  const activeContext = restartContext ?? audioContext;
  const live = useRef<LiveMic | null>(null);
  const minFreqRef = useRef(opts.minFreq ?? CHROMATIC_MIN_FREQ);
  minFreqRef.current = opts.minFreq ?? CHROMATIC_MIN_FREQ;
  // Read by the running loop on every tick, so a new response applies without restarting the mic.
  const tuning = {
    detectIntervalMs: opts.detectIntervalMs ?? DETECT_INTERVAL_MS,
    windowSize: opts.smoothing?.windowSize ?? RESPONSE_PROFILES.medium.windowSize,
    holdMs: opts.smoothing?.holdMs ?? RESPONSE_PROFILES.medium.holdMs,
  };
  const tuningRef = useRef(tuning);
  tuningRef.current = tuning;

  const restart = useCallback(() => {
    const mic = live.current;
    if (mic && !mic.needsNewMic()) {
      mic.resume();
      return;
    }
    // Synchronous in the gesture (iOS); the effect re-runs with it and asks for the mic again.
    setRestartContext(createTunerAudioContext());
  }, []);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let track: MediaStreamTrack | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    /** The mic is wired up (so 'listening' is the healthy state to return to). */
    let connected = false;
    /** Last frequency handed to React; reset whenever the display is cleared. */
    let lastFreq: number | null = null;
    const clearFreq = () => {
      lastFreq = null;
      setFreq(null);
    };

    const stalled = (c: AudioContext) => {
      const state = c.state as string;
      return state === 'suspended' || state === 'interrupted';
    };

    /** After a resume attempt (or a state change), report whether the sound is flowing. */
    function settle() {
      if (cancelled || !connected || !ctx) return;
      if (track && (track.readyState === 'ended' || track.muted)) return;
      setStatus(stalled(ctx) ? 'interrupted' : 'listening');
    }
    function resumeNow() {
      if (cancelled || !ctx || released.has(ctx)) return;
      const p = ctx.resume?.();
      if (!p || typeof p.then !== 'function') {
        settle();
        return;
      }
      p.then(settle, () => {
        if (!cancelled && connected) setStatus('interrupted');
      });
    }
    // Resume after an iOS interruption / suspension, while this effect is live.
    function resumeIfStalled() {
      if (cancelled || !ctx || released.has(ctx)) return;
      if (stalled(ctx)) resumeNow();
      else settle();
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') resumeIfStalled();
    }
    function onTrackEnded() {
      if (cancelled) return;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      clearFreq();
      setStatus('lost');
    }
    function onTrackMute() {
      if (cancelled || !connected) return;
      clearFreq();
      setStatus('interrupted');
    }
    function onTrackUnmute() {
      settle();
    }

    let ctx: AudioContext | null =
      activeContext && activeContext.state !== 'closed' && !released.has(activeContext) ? activeContext : null;
    if (!ctx) ctx = createTunerAudioContext();

    const stopStream = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop());

    const cleanup = () => {
      cancelled = true;
      live.current = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      track?.removeEventListener?.('ended', onTrackEnded);
      track?.removeEventListener?.('mute', onTrackMute);
      track?.removeEventListener?.('unmute', onTrackUnmute);
      track = null;
      stopStream(stream);
      stream = null;
      try {
        source?.disconnect();
        analyser?.disconnect();
      } catch {
        /* already disconnected */
      }
      ctx?.removeEventListener?.('statechange', resumeIfStalled);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      if (ctx) release(ctx);
    };

    if (isInsecureOrigin()) {
      setStatus('insecure');
      if (ctx) release(ctx);
      return cleanup;
    }

    const mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!ctx || !mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      return cleanup;
    }
    setStatus('starting');
    setFreq(null);

    const audioCtx = ctx;
    live.current = {
      needsNewMic: () => !track || track.readyState === 'ended' || track.muted,
      resume: resumeNow,
    };
    audioCtx.addEventListener?.('statechange', resumeIfStalled);
    document.addEventListener('visibilitychange', onVisibility);
    mediaDevices
      .getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      })
      .then((s) => {
        if (cancelled) {
          stopStream(s);
          return;
        }
        stream = s;
        try {
          source = audioCtx.createMediaStreamSource(s);
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = TUNER_FFT_SIZE;
          source.connect(analyser);
        } catch (err) {
          // Don't leave the mic (and its indicator) live until close.
          stopStream(s);
          stream = null;
          throw err;
        }
        track = s.getAudioTracks?.()[0] ?? s.getTracks()[0] ?? null;
        track?.addEventListener?.('ended', onTrackEnded);
        track?.addEventListener?.('mute', onTrackMute);
        track?.addEventListener?.('unmute', onTrackUnmute);
        connected = true;
        setStatus('listening');
        resumeNow();
        if (track?.readyState === 'ended') {
          onTrackEnded();
          return;
        }

        const buf = new Float32Array(analyser.fftSize);
        let history: PitchHistory = EMPTY_PITCH_HISTORY;
        let lastDetect = -Infinity;
        const tick = (ts: number) => {
          if (cancelled || !analyser) return;
          raf = requestAnimationFrame(tick);
          // The frame's own timestamp, not performance.now(): a callback that starts a
          // few ms late must not push the next frame under the interval and skip it.
          const now = Number.isFinite(ts) ? ts : performance.now();
          const { detectIntervalMs, windowSize, holdMs } = tuningRef.current;
          if (now - lastDetect < detectIntervalMs - DETECT_TOLERANCE_MS) return;
          lastDetect = now;
          analyser.getFloatTimeDomainData(buf);
          const detected = detectPitch(buf, audioCtx.sampleRate, { minFreq: minFreqRef.current });
          const step = smoothPitch(history, detected, now, { windowSize, holdMs });
          history = step.history;
          const smoothed = step.freq;
          const next = smoothed === null ? null : quantizeToCent(smoothed);
          if (next !== lastFreq) {
            lastFreq = next;
            setFreq(next);
          }
        };
        raf = requestAnimationFrame(tick);
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus(errorStatus(err));
        // No mic: release the context now rather than holding it until close.
        release(audioCtx);
      });

    return cleanup;
  }, [activeContext]);

  return { status, freq, restart };
}
