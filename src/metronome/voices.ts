/**
 * The metronome's click sounds, synthesised with plain Web Audio nodes.
 *
 * This is the ONLY file that knows how a sound is made. The engine just calls
 * `VOICES[sound](ctx, dest, time, gain, tier)`, so the whole synth can be
 * swapped (e.g. for Tone.js or samples) by replacing this module or passing a
 * different `voices` map to the engine — nothing else depends on its
 * internals.
 *
 * Self-contained: no imports beyond the model's types.
 */
import type { SoundId, Tier } from './model';

/**
 * Schedule one click.
 *
 * @param ctx  the audio context to build nodes in
 * @param dest node to connect the output to (the engine's master gain)
 * @param time context time, in seconds, at which the click starts
 * @param gain linear loudness, 0–1
 * @param tier pitch tier: 0 low (soft / subdivision), 1 mid (normal), 2 high (accent)
 */
export type Voice = (ctx: BaseAudioContext, dest: AudioNode, time: number, gain: number, tier: Tier) => void;

/*
 * Levels: each patch's output level is set so an accent (gain 1) peaks at
 * roughly 0.6–0.8 of full scale when rendered, leaving headroom for
 * overlapping tails. The multipliers below are not comparable between patches
 * (a filtered square pair overshoots, band-passed noise barely gets there);
 * voices.test.ts holds the measured factors.
 */

/** Exponential ramps cannot reach or start from zero; this is "silent enough". */
const FLOOR = 0.0001;

/** A gain node that starts at `vol` at time `t` and decays to silence over `decay` seconds. */
function env(ctx: BaseAudioContext, dest: AudioNode, t: number, vol: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(Math.max(vol, FLOOR * 2), t);
  g.gain.exponentialRampToValueAtTime(FLOOR, t + decay);
  g.connect(dest);
  return g;
}

/** An oscillator running from `t` for `dur` seconds (plus a short tail) into `dest`. */
function osc(
  ctx: BaseAudioContext,
  type: OscillatorType,
  freq: number,
  t: number,
  dur: number,
  dest: AudioNode,
): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.connect(dest);
  o.start(t);
  o.stop(t + dur + 0.02);
  return o;
}

function bandpass(ctx: BaseAudioContext, freq: number, q: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** 0.3 s of white noise, generated once per context and reused by every clap. */
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.3), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

/** Short sine beep. */
const tone: Voice = (ctx, dest, t, vol, tier) => {
  osc(ctx, 'sine', [784, 1047, 1568][tier], t, 0.07, env(ctx, dest, t, vol * 0.8, 0.07));
};

/** Woodblock: band-passed triangle body plus a brief inharmonic sine knock. */
const wood: Voice = (ctx, dest, t, vol, tier) => {
  const f = [740, 920, 1240][tier];
  const bp = bandpass(ctx, f, 5);
  bp.connect(env(ctx, dest, t, vol * 1.6, 0.05));
  osc(ctx, 'triangle', f, t, 0.05, bp);
  osc(ctx, 'sine', f * 1.51, t, 0.03, env(ctx, dest, t, vol * 0.4, 0.025));
};

/** 808-style tom: sine with a fast downward pitch sweep. */
const tom: Voice = (ctx, dest, t, vol, tier) => {
  const f = [95, 135, 190][tier];
  const o = osc(ctx, 'sine', f * 1.9, t, 0.3, env(ctx, dest, t, vol * 0.72, 0.3));
  o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
};

/** Clap: band-passed noise with three quick retriggers before the tail. */
const clap: Voice = (ctx, dest, t, vol, tier) => {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const bp = bandpass(ctx, [950, 1150, 1500][tier], 1.3);
  const peak = Math.max(vol * 1.4, FLOOR * 2);
  const dip = Math.max(vol * 0.25, FLOOR);
  const g = ctx.createGain();
  g.gain.setValueAtTime(FLOOR, t);
  for (const d of [0, 0.011, 0.022]) {
    g.gain.setValueAtTime(peak, t + d);
    g.gain.exponentialRampToValueAtTime(dip, t + d + 0.009);
  }
  g.gain.setValueAtTime(peak, t + 0.033);
  g.gain.exponentialRampToValueAtTime(FLOOR, t + 0.19);
  src.connect(bp);
  bp.connect(g);
  g.connect(dest);
  src.start(t);
  src.stop(t + 0.22);
};

/** Rim click: high-passed square over a fixed triangle thunk. */
const rim: Voice = (ctx, dest, t, vol, tier) => {
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 800;
  hp.connect(env(ctx, dest, t, vol * 0.52, 0.03));
  osc(ctx, 'square', [1500, 1750, 2100][tier], t, 0.03, hp);
  osc(ctx, 'triangle', 480, t, 0.03, hp);
};

/** Cowbell: two detuned squares (the classic 540/800 Hz pair) through a bandpass. */
const bell: Voice = (ctx, dest, t, vol, tier) => {
  const k = [0.84, 1, 1.26][tier];
  const bp = bandpass(ctx, 800 * k, 2.5);
  bp.connect(env(ctx, dest, t, vol * 0.62, 0.16));
  osc(ctx, 'square', 540 * k, t, 0.16, bp);
  osc(ctx, 'square', 800 * k, t, 0.16, bp);
};

export const VOICES: Record<SoundId, Voice> = { tone, wood, tom, clap, rim, bell };
