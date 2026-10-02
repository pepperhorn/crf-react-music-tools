import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { VuMeter } from './VuMeter';
import { installAudioMocks, stubTunerMedia, uninstallAudioMocks, type AudioMocks } from '../test/tuner-audio-mock';

let mocks: AudioMocks;

const angle = () =>
  Number(/rotate\((-?[\d.e-]+)/.exec(document.querySelector('.tuner-needle')!.getAttribute('transform') ?? '')?.[1] ?? NaN);

/**
 * Step the needle from rest at 0° to +27° (+30 cents) with `frameMs` between
 * frames. Returns the angle after every frame, until the loop stops.
 */
function stepTo27(omega: number, frameMs: number, maxFrames = 400): { angles: number[]; settled: boolean } {
  const r = render(<VuMeter cents={null} omega={omega} />);
  act(() => mocks.frames(2, frameMs)); // let the idle loop settle at 0°
  expect(mocks.pendingRafCount()).toBe(0);
  r.rerender(<VuMeter cents={30} omega={omega} />);
  const angles: number[] = [];
  while (mocks.pendingRafCount() > 0 && angles.length < maxFrames) {
    act(() => mocks.frames(1, frameMs));
    angles.push(angle());
  }
  const settled = mocks.pendingRafCount() === 0;
  r.unmount();
  return { angles, settled };
}

describe('VuMeter needle spring', () => {
  beforeEach(() => {
    mocks = installAudioMocks('ok');
    stubTunerMedia({ wide: true });
  });
  afterEach(() => {
    uninstallAudioMocks();
  });

  for (const omega of [9, 14, 22]) {
    for (const frameMs of [1000 / 60, 40, 50]) {
      it(`ω = ${omega} at ${Math.round(frameMs)} ms frames: no overshoot, converges, and the loop stops`, () => {
        const { angles, settled } = stepTo27(omega, frameMs);
        expect(Math.max(...angles)).toBeLessThanOrEqual(27.5);
        expect(Math.min(...angles)).toBeGreaterThanOrEqual(0);
        // Monotonic approach: a critically damped step from rest never turns back.
        for (let i = 1; i < angles.length; i++) expect(angles[i]).toBeGreaterThanOrEqual(angles[i - 1]);
        expect(settled).toBe(true);
        expect(angles[angles.length - 1]).toBe(27);
        // About 8/ω seconds to get within the 0.02° settle band; never seconds of ringing.
        expect(angles.length * frameMs).toBeLessThan(1500);
      });
    }
  }

  it('follows the exact critically damped curve whatever the frame rate', () => {
    for (const frameMs of [1000 / 120, 1000 / 60, 40, 50]) {
      const { angles } = stepTo27(14, frameMs);
      // The first frame of a new loop has no previous timestamp and counts as 1/60 s.
      let t = 1 / 60;
      for (let i = 0; i < Math.min(angles.length - 1, 12); i++) {
        const exact = 27 * (1 - (1 + 14 * t) * Math.exp(-14 * t));
        expect(angles[i], `${frameMs.toFixed(1)} ms, frame ${i}`).toBeCloseTo(exact, 2);
        t += frameMs / 1000;
      }
    }
  });

  it('snaps under prefers-reduced-motion at a non-default ω, without starting a loop', () => {
    stubTunerMedia({ reduced: true });
    for (const omega of [9, 22]) {
      const r = render(<VuMeter cents={null} omega={omega} />);
      r.rerender(<VuMeter cents={30} omega={omega} />);
      expect(angle()).toBe(27);
      expect(mocks.pendingRafCount()).toBe(0);
      r.rerender(<VuMeter cents={-20} omega={omega} />);
      expect(angle()).toBe(-18);
      expect(mocks.pendingRafCount()).toBe(0);
      r.unmount();
    }
  });
});
