import { describe, expect, it } from 'vitest';
import { SOUNDS, type Tier } from './model';
import { VOICES } from './voices';

/**
 * Recording stub of the slice of Web Audio the voices use. Every AudioParam
 * call and every source start/stop is logged so the tests can assert on
 * timing and on values fed to exponential ramps (which must be > 0).
 */
function stubContext() {
  const log = {
    nodes: [] as string[],
    starts: [] as number[],
    stops: [] as number[],
    expTargets: [] as number[],
    paramTimes: [] as number[],
    /** Every value set on a GainNode's gain (the envelopes). */
    gainValues: [] as number[],
    buffers: 0,
    connectedToDest: 0,
    connectedToCtxDestination: 0,
  };
  const destination = { kind: 'ctx-destination' };
  const dest = { kind: 'dest' };

  const param = (isGain = false) => ({
    value: 0,
    setValueAtTime(v: number, t: number) {
      log.paramTimes.push(t);
      if (isGain) log.gainValues.push(v);
    },
    exponentialRampToValueAtTime(v: number, t: number) {
      log.expTargets.push(v);
      log.paramTimes.push(t);
    },
    linearRampToValueAtTime(_v: number, t: number) {
      log.paramTimes.push(t);
    },
  });
  const node = (kind: string, extra: object = {}) => {
    log.nodes.push(kind);
    return {
      ...extra,
      connect(target: unknown) {
        if (target === dest) log.connectedToDest++;
        if (target === destination) log.connectedToCtxDestination++;
        return target;
      },
    };
  };
  const source = (kind: string, extra: object = {}) =>
    node(kind, {
      ...extra,
      start(t: number) {
        log.starts.push(t);
      },
      stop(t: number) {
        log.stops.push(t);
      },
    });

  const ctx = {
    sampleRate: 48000,
    currentTime: 0,
    destination,
    createGain: () => node('gain', { gain: param(true) }),
    createOscillator: () => source('osc', { type: 'sine', frequency: param() }),
    createBiquadFilter: () => node('filter', { type: 'lowpass', frequency: param(), Q: param() }),
    createBufferSource: () => source('noise', { buffer: null }),
    createBuffer: (_ch: number, length: number) => {
      log.buffers++;
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
  };
  return { ctx: ctx as unknown as BaseAudioContext, dest: dest as unknown as AudioNode, log };
}

const TIME = 3.5;

describe('VOICES', () => {
  it('has a voice for every sound id', () => {
    expect(Object.keys(VOICES).sort()).toEqual(SOUNDS.map((s) => s.id).sort());
  });

  for (const { id } of SOUNDS) {
    describe(id, () => {
      for (const tier of [0, 1, 2] as Tier[]) {
        for (const gain of [1, 0.22, 0]) {
          it(`tier ${tier}, gain ${gain}: schedules a bounded sound at the given time`, () => {
            const { ctx, dest, log } = stubContext();
            expect(() => VOICES[id](ctx, dest, TIME, gain, tier)).not.toThrow();

            expect(log.nodes.length).toBeGreaterThan(0);
            // every source starts exactly on time and is stopped shortly after
            expect(log.starts.length).toBeGreaterThan(0);
            expect(log.stops).toHaveLength(log.starts.length);
            for (const t of log.starts) expect(t).toBe(TIME);
            for (const t of log.stops) {
              expect(t).toBeGreaterThan(TIME);
              expect(t).toBeLessThan(TIME + 0.5);
            }
            // nothing is automated before the click's own time
            for (const t of log.paramTimes) expect(t).toBeGreaterThanOrEqual(TIME);
            // exponential ramps cannot target zero or below
            expect(log.expTargets.length).toBeGreaterThan(0);
            for (const v of log.expTargets) expect(v).toBeGreaterThan(0);
            // output goes to the node it was given, never straight to the speakers
            expect(log.connectedToDest).toBeGreaterThan(0);
            expect(log.connectedToCtxDestination).toBe(0);
          });
        }
      }
    });
  }

  /**
   * Level balance. Node has no OfflineAudioContext, so this cannot render the
   * sound; it checks the loudest envelope value each voice schedules for an
   * accent (gain 1, tier 2) and multiplies it by that patch's measured
   * "amplitude per unit of envelope" — the peak of the real render divided by
   * the envelope peak, which depends only on the oscillators and filters and
   * not on the level. Those factors were measured by rendering every voice
   * through a real OfflineAudioContext in headless Chromium (48 kHz, mono):
   *
   *   tone 0.93   sine straight through the envelope
   *   wood 0.40   band-passed triangle (main envelope) plus the knock
   *   tom  0.98   swept sine
   *   clap 0.50   band-passed white noise; random, this is the largest of 8 renders
   *   rim  1.37   square + triangle summed, high-passed (overshoots)
   *   bell 1.19   two squares summed through a band-pass
   *
   * If a patch's oscillators or filters change, re-measure its factor. What
   * this does catch is someone turning a level up until the voice clips.
   */
  const AMPLITUDE_PER_ENVELOPE: Record<string, number> = {
    tone: 0.93,
    wood: 0.404,
    tom: 0.983,
    clap: 0.504,
    rim: 1.366,
    bell: 1.186,
  };

  for (const { id } of SOUNDS) {
    it(`${id}: an accent peaks between 0.6 and 0.8 of full scale`, () => {
      const { ctx, dest, log } = stubContext();
      VOICES[id](ctx, dest, TIME, 1, 2);
      const estimatedPeak = Math.max(...log.gainValues) * AMPLITUDE_PER_ENVELOPE[id];
      expect(estimatedPeak).toBeGreaterThanOrEqual(0.6);
      expect(estimatedPeak).toBeLessThanOrEqual(0.8);
    });
  }

  it('level scales linearly with the gain argument', () => {
    for (const { id } of SOUNDS) {
      const loud = stubContext();
      VOICES[id](loud.ctx, loud.dest, TIME, 1, 2);
      const quiet = stubContext();
      VOICES[id](quiet.ctx, quiet.dest, TIME, 0.5, 2);
      expect(Math.max(...quiet.log.gainValues)).toBeCloseTo(Math.max(...loud.log.gainValues) / 2, 9);
    }
  });

  it('builds the noise buffer once per context', () => {
    const a = stubContext();
    VOICES.clap(a.ctx, a.dest, 1, 1, 0);
    VOICES.clap(a.ctx, a.dest, 2, 1, 2);
    expect(a.log.buffers).toBe(1);

    const b = stubContext();
    VOICES.clap(b.ctx, b.dest, 1, 1, 0);
    expect(b.log.buffers).toBe(1);
  });
});
