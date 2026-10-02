import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import {
  Metronome,
  ballPosition,
  BPM_ANNOUNCE_DELAY_MS,
  HOLD_DELAY_MS,
  HOLD_REPEAT_MS,
  type MetronomeLayout,
} from './Metronome';
import type { BeatState } from './engine';
import {
  BUILTIN_PATTERNS,
  DEFAULT_METRONOME_SETTINGS,
  parsePatterns,
  type MetronomeSettings,
  type SubdivisionPattern,
} from './model';
import { renderOnServer, serverRenderThenHydrate } from '../test/hydration';
import { stubMetronomeMedia, stubRaf, type RafMock } from '../test/metronome-test-kit';

let raf: RafMock;

interface HarnessProps {
  initial?: Partial<MetronomeSettings>;
  running?: boolean;
  onStart?: () => void;
  onStop?: () => void;
  onClose?: () => void;
  getBeatState?: () => BeatState | null;
  patterns?: readonly SubdivisionPattern[];
  layout?: MetronomeLayout;
  message?: string | null;
  spy?: (s: MetronomeSettings) => void;
}

function Harness({
  initial = {},
  running = false,
  onStart = () => {},
  onStop = () => {},
  onClose = () => {},
  getBeatState = () => null,
  patterns,
  layout,
  message,
  spy,
}: HarnessProps) {
  const [settings, setSettings] = useState<MetronomeSettings>({ ...DEFAULT_METRONOME_SETTINGS, ...initial });
  return (
    <Metronome
      settings={settings}
      onSettingsChange={(s) => {
        spy?.(s);
        setSettings(s);
      }}
      running={running}
      onStart={onStart}
      onStop={onStop}
      onClose={onClose}
      getBeatState={getBeatState}
      patterns={patterns}
      layout={layout}
      message={message}
    />
  );
}

const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string) => q(sel)?.textContent ?? null;
const btn = (name: string | RegExp) => screen.getByRole('button', { name });
const ballF = () => Number(q('.metronome-ball')!.style.getPropertyValue('--metronome-ball-f'));
const ballTop = () => parseFloat(q('.metronome-ball')!.style.getPropertyValue('--metronome-ball-top'));
const activeTiles = () => all('.metronome-beat-tile').map((t) => t.getAttribute('data-active') === 'true');

describe('Metronome', () => {
  beforeEach(() => {
    stubMetronomeMedia({ wide: true });
    raf = stubRaf();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders Simple by default: tempo, signature, five subdivisions, no signature or sound pickers', () => {
    render(<Harness />);
    expect(q('.metronome-chassis')?.className).toMatch(/metronome-simple/);
    expect(text('.metronome-bpm-value')).toBe('120');
    expect(text('.metronome-signature-chip')).toBe('4/4');
    expect(text('.metronome-tempo-name')).toBe('Allegro');
    expect(all('.metronome-sub-btn').map((b) => b.textContent)).toEqual(['Beat', '8ths', 'Triplet', '16ths', 'Swing']);
    expect(screen.queryByRole('group', { name: 'Time signature' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Sound' })).toBeNull();
    expect(all('.metronome-beat-tile')).toHaveLength(4);
  });

  it('MORE switches to Full and LESS back to Simple, through onSettingsChange', () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    fireEvent.click(btn('Switch to full mode'));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'full' }));
    expect(q('.metronome-chassis')?.className).toMatch(/metronome-full/);
    expect(screen.getByRole('group', { name: 'Time signature' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Sound' })).toBeTruthy();
    fireEvent.click(btn('Switch to simple mode'));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'simple' }));
    expect(screen.queryByRole('group', { name: 'Sound' })).toBeNull();
  });

  it('Start calls onStart; while running the button reads Stop and calls onStop', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const r = render(<Harness onStart={onStart} onStop={onStop} />);
    fireEvent.click(btn('Start'));
    expect(onStart).toHaveBeenCalledOnce();
    expect(onStop).not.toHaveBeenCalled();
    r.unmount();

    render(<Harness running onStart={onStart} onStop={onStop} />);
    expect(q('.metronome-btn-start')?.className).toMatch(/metronome-btn-running/);
    fireEvent.click(btn('Stop'));
    expect(onStop).toHaveBeenCalledOnce();
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('close button calls onClose', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(btn('Close metronome'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('− / + step by 1 on click (keyboard) and clamp to 40–240', () => {
    render(<Harness initial={{ bpm: 239 }} />);
    fireEvent.click(btn('Faster'));
    expect(text('.metronome-bpm-value')).toBe('240');
    fireEvent.click(btn('Faster'));
    expect(text('.metronome-bpm-value')).toBe('240');
    fireEvent.click(btn('Slower'));
    fireEvent.click(btn('Slower'));
    expect(text('.metronome-bpm-value')).toBe('238');
  });

  it('holding − / + steps at once, then auto-repeats until released, without a double step from the click', () => {
    vi.useFakeTimers();
    render(<Harness />);
    const faster = btn('Faster');

    fireEvent.pointerDown(faster);
    expect(text('.metronome-bpm-value')).toBe('121');
    act(() => void vi.advanceTimersByTime(HOLD_DELAY_MS - 1));
    expect(text('.metronome-bpm-value')).toBe('121');
    for (let i = 0; i < 5; i++) act(() => void vi.advanceTimersByTime(i === 0 ? HOLD_REPEAT_MS + 1 : HOLD_REPEAT_MS));
    expect(text('.metronome-bpm-value')).toBe('126');

    fireEvent.pointerUp(faster);
    fireEvent.click(faster, { detail: 1 }); // the click that follows a real press
    expect(text('.metronome-bpm-value')).toBe('126');
    act(() => void vi.advanceTimersByTime(2000));
    expect(text('.metronome-bpm-value')).toBe('126');

    // A plain tap is one step, not two.
    const slower = btn('Slower');
    fireEvent.pointerDown(slower);
    fireEvent.pointerUp(slower);
    fireEvent.click(slower, { detail: 1 });
    expect(text('.metronome-bpm-value')).toBe('125');

    // Leaving or cancelling the press stops the repeat.
    for (const end of [fireEvent.pointerLeave, fireEvent.pointerCancel]) {
      fireEvent.pointerDown(slower);
      const after = text('.metronome-bpm-value');
      end(slower);
      act(() => void vi.advanceTimersByTime(2000));
      expect(text('.metronome-bpm-value')).toBe(after);
    }
    expect(text('.metronome-bpm-value')).toBe('123');

    // Keyboard activation still works after pointer use.
    fireEvent.keyDown(slower, { key: 'Enter' });
    fireEvent.click(slower);
    expect(text('.metronome-bpm-value')).toBe('122');
  });

  it('a touch tap on − / + is exactly one step (pointerleave arrives before the click)', () => {
    render(<Harness />);
    const faster = btn('Faster');
    // The order a touch screen really sends.
    const touch = { pointerType: 'touch' };
    fireEvent.pointerDown(faster, touch);
    fireEvent.pointerUp(faster, touch);
    fireEvent.pointerOut(faster, touch);
    fireEvent.pointerLeave(faster, touch);
    fireEvent.click(faster, { detail: 1 });
    expect(text('.metronome-bpm-value')).toBe('121');

    // And again: no state is left over from the first tap.
    fireEvent.pointerDown(faster, touch);
    fireEvent.pointerUp(faster, touch);
    fireEvent.pointerOut(faster, touch);
    fireEvent.pointerLeave(faster, touch);
    fireEvent.click(faster, { detail: 1 });
    expect(text('.metronome-bpm-value')).toBe('122');
  });

  it('mouse press, leave, re-enter, release is one step, and the repeat stays stopped', () => {
    vi.useFakeTimers();
    render(<Harness />);
    const faster = btn('Faster');
    const mouse = { pointerType: 'mouse', button: 0 };
    fireEvent.pointerDown(faster, mouse);
    fireEvent.pointerLeave(faster, mouse);
    fireEvent.pointerEnter(faster, mouse);
    fireEvent.pointerUp(faster, mouse);
    fireEvent.click(faster, { detail: 1 });
    expect(text('.metronome-bpm-value')).toBe('121');
    act(() => void vi.advanceTimersByTime(2000));
    expect(text('.metronome-bpm-value')).toBe('121');
  });

  it('a keyboard click (detail 0) steps once even after a press that never produced a click', () => {
    render(<Harness />);
    const faster = btn('Faster');
    fireEvent.pointerDown(faster, { pointerType: 'touch' });
    fireEvent.pointerCancel(faster, { pointerType: 'touch' }); // e.g. the page scrolled: no click follows
    expect(text('.metronome-bpm-value')).toBe('121');
    fireEvent.click(faster, { detail: 0 }); // Enter / Space / assistive tech
    expect(text('.metronome-bpm-value')).toBe('122');
    fireEvent.click(faster, { detail: 0 });
    expect(text('.metronome-bpm-value')).toBe('123');
  });

  it('a held button stops repeating when the metronome unmounts', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const r = render(<Harness spy={spy} />);
    fireEvent.pointerDown(btn('Faster'));
    r.unmount();
    spy.mockClear();
    vi.advanceTimersByTime(3000);
    expect(spy).not.toHaveBeenCalled();
  });

  it('TAP sets the tempo from the tap interval', () => {
    let now = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    const tap = btn('Tap tempo');
    fireEvent.click(tap);
    expect(spy).not.toHaveBeenCalled();
    now += 750;
    fireEvent.click(tap);
    expect(text('.metronome-bpm-value')).toBe('80');
    now += 750;
    fireEvent.click(tap);
    expect(text('.metronome-bpm-value')).toBe('80');
    expect(text('.metronome-tempo-name')).toBe('Andante');
  });

  it('changing the time signature resets the accents to that signature', () => {
    const spy = vi.fn();
    render(<Harness initial={{ mode: 'full', accents: [0, 0, 0, 0] }} spy={spy} />);
    const group = screen.getByRole('group', { name: 'Time signature' });
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '12/8']);
    expect(btn('4/4').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(btn('6/8'));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ signature: '6/8', accents: [3, 1, 1, 2, 1, 1] }));
    expect(btn('6/8').getAttribute('aria-pressed')).toBe('true');
    expect(btn('4/4').getAttribute('aria-pressed')).toBe('false');
    expect(all('.metronome-beat-tile')).toHaveLength(6);
    expect(text('.metronome-signature-chip')).toBe('6/8');
  });

  it('subdivision and sound are selected with aria-pressed toggles', () => {
    const spy = vi.fn();
    render(<Harness initial={{ mode: 'full' }} spy={spy} />);
    expect(btn('Beat').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(btn('Swing'));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ subdivision: 'swing' }));
    expect(btn('Swing').getAttribute('aria-pressed')).toBe('true');
    expect(btn('Beat').getAttribute('aria-pressed')).toBe('false');

    const sounds = screen.getByRole('group', { name: 'Sound' });
    expect([...sounds.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Tone', 'Woodblock', '808 Tom', 'Clap', 'Rim click', 'Cowbell']);
    expect(btn('Woodblock').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(btn('Cowbell'));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ sound: 'bell' }));
    expect(btn('Cowbell').getAttribute('aria-pressed')).toBe('true');
  });

  it('Simple mode can pick a subdivision too', () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    fireEvent.click(btn('16ths'));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ subdivision: 'sixteenth' }));
    expect(btn('16ths').getAttribute('aria-pressed')).toBe('true');
  });

  it('an unknown saved subdivision shows the first pattern as selected', () => {
    render(<Harness initial={{ subdivision: 'missing-preset' }} />);
    expect(btn('Beat').getAttribute('aria-pressed')).toBe('true');
  });

  it('Full: tapping a beat cycles accent → normal → soft → off → accent, with labels', () => {
    const spy = vi.fn();
    render(<Harness initial={{ mode: 'full' }} spy={spy} />);
    expect(btn('Beat 1, accent. Tap to change')).toBeTruthy();
    expect(btn('Beat 2, normal. Tap to change')).toBeTruthy();
    const tile = () => all('.metronome-beat-tile')[0];
    const first = () => all('button.metronome-beat')[0];
    const seen = [tile().getAttribute('data-level')];
    for (let i = 0; i < 4; i++) {
      fireEvent.click(first());
      seen.push(tile().getAttribute('data-level'));
    }
    expect(seen).toEqual(['3', '2', '1', '0', '3']);
    expect(spy).toHaveBeenCalledTimes(4);
    fireEvent.click(first());
    fireEvent.click(first());
    expect(btn('Beat 1, soft. Tap to change')).toBeTruthy();
    fireEvent.click(first());
    expect(btn('Beat 1, off. Tap to change')).toBeTruthy();
    expect(tile().className).toMatch(/border-dashed/);
  });

  it('Simple: beat tiles show the saved signature and accents but are not buttons', () => {
    const spy = vi.fn();
    render(<Harness initial={{ signature: '3/4', accents: [3, 0, 1] }} spy={spy} />);
    expect(all('.metronome-beat-tile').map((t) => t.getAttribute('data-level'))).toEqual(['3', '0', '1']);
    expect(all('button.metronome-beat')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Tap to change/ })).toBeNull();
    fireEvent.click(all('.metronome-beat-tile')[0]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('Simple: the tiles are a list whose items say each beat’s emphasis', () => {
    render(<Harness initial={{ signature: '3/4', accents: [3, 0, 1] }} />);
    const list = screen.getByRole('list', { name: 'Beats' });
    expect(list.className).toMatch(/metronome-beats/);
    const items = within(list).getAllByRole('listitem');
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual(['Beat 1, accent', 'Beat 2, off', 'Beat 3, soft']);
    expect(items.every((i) => i.classList.contains('metronome-beat-tile'))).toBe(true);
    // the decorative ball is not part of the list
    expect(q('.metronome-ball')!.getAttribute('aria-hidden')).toBe('true');

    // Full: the tiles are buttons that already say it, in a group.
    fireEvent.click(btn('Switch to full mode'));
    expect(screen.queryByRole('list', { name: 'Beats' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Beats' })).toBeTruthy();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(btn('Beat 2, off. Tap to change')).toBeTruthy();
  });

  it('announces a tempo change politely, once it has settled', () => {
    vi.useFakeTimers();
    for (const [layout, mode] of [['wide', 'simple'], ['wide', 'full'], ['compact', 'simple']] as const) {
      const r = render(<Harness layout={layout} initial={{ mode }} />);
      const live = q('.metronome-bpm-live')!;
      expect(live.getAttribute('role')).toBe('status');
      expect(live.getAttribute('aria-live')).toBe('polite');
      expect(live.className).toMatch(/sr-only/);
      // nothing to say until something changes
      act(() => void vi.advanceTimersByTime(5000));
      expect(live.textContent).toBe('');

      fireEvent.click(btn('Faster'));
      expect(live.textContent).toBe('');
      act(() => void vi.advanceTimersByTime(BPM_ANNOUNCE_DELAY_MS));
      expect(live.textContent).toBe('121 beats per minute');
      r.unmount();
    }
  });

  it('does not announce every step of a hold-repeat, only where it ends up', () => {
    vi.useFakeTimers();
    render(<Harness />);
    const live = q('.metronome-bpm-live')!;
    const faster = btn('Faster');
    fireEvent.pointerDown(faster);
    act(() => void vi.advanceTimersByTime(HOLD_DELAY_MS + 1));
    // one repeat at a time, well past the announce delay in total: still silent
    expect(HOLD_REPEAT_MS * 20).toBeGreaterThan(BPM_ANNOUNCE_DELAY_MS);
    for (let i = 0; i < 20; i++) {
      act(() => void vi.advanceTimersByTime(HOLD_REPEAT_MS));
      expect(live.textContent).toBe('');
    }
    fireEvent.pointerUp(faster);
    expect(text('.metronome-bpm-value')).toBe('141');
    act(() => void vi.advanceTimersByTime(BPM_ANNOUNCE_DELAY_MS));
    expect(live.textContent).toBe('141 beats per minute');
  });

  it('both modes show only the first five patterns as quick toggles, plus a Presets button', () => {
    expect(BUILTIN_PATTERNS.length).toBeGreaterThan(5);
    render(<Harness />);
    const five = ['Beat', '8ths', 'Triplet', '16ths', 'Swing'];
    expect(all('.metronome-sub-btn').map((b) => b.textContent)).toEqual(five);
    // Simple: a sixth cell of the toggle row, icon only.
    const simpleBtn = btn('Presets');
    expect(simpleBtn.className).toMatch(/metronome-btn-presets/);
    expect(simpleBtn.parentElement).toBe(q('.metronome-subdivisions'));
    expect(simpleBtn.querySelector('svg')).toBeTruthy();
    expect(simpleBtn.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(btn('Switch to full mode'));
    expect(all('.metronome-sub-btn').map((b) => b.textContent)).toEqual(five);
    expect(q('.metronome-subdivisions')?.className).toMatch(/grid-cols-5/);
    // Full: a labelled button on the Subdivision label row.
    const fullBtn = btn('Presets');
    expect(fullBtn.textContent).toBe('Presets');
    expect(fullBtn.parentElement?.querySelector('.metronome-section-label')?.textContent).toBe('Subdivision');
    expect(fullBtn.className).toMatch(/metronome-btn-shadow/);
    expect(fullBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('a short pattern list pads the toggle row so the grid stays a rectangle', () => {
    render(<Harness patterns={BUILTIN_PATTERNS.slice(0, 3)} initial={{ mode: 'full' }} />);
    expect(all('.metronome-sub-btn')).toHaveLength(3);
    expect(all('.metronome-sub-filler')).toHaveLength(2);
  });

  it('a selected preset outside the quick five fills the Presets button yellow, pressed, labelled in Full', () => {
    const r = render(<Harness initial={{ mode: 'full', subdivision: 'reverse-gallop' }} />);
    const fullBtn = q('.metronome-btn-presets')!;
    expect(fullBtn.textContent).toBe('Rev gallop');
    // Its visible text is the preset's name, so the accessible name has to keep saying what it is.
    expect(fullBtn.getAttribute('aria-label')).toBe('Presets: Rev gallop');
    expect(btn('Presets: Rev gallop')).toBe(fullBtn);
    expect(fullBtn.getAttribute('aria-pressed')).toBe('true');
    expect(fullBtn.className).toMatch(/bg-\[#fff56d\]/);
    expect(all('.metronome-sub-btn').map((b) => b.getAttribute('aria-pressed'))).toEqual(Array(5).fill('false'));
    r.unmount();

    render(<Harness initial={{ subdivision: 'tresillo' }} />);
    const simpleBtn = btn('Presets: Tresillo');
    expect(simpleBtn.getAttribute('aria-pressed')).toBe('true');
    expect(simpleBtn.className).toMatch(/bg-\[#fff56d\]/);
    expect(all('.metronome-sub-btn').map((b) => b.getAttribute('aria-pressed'))).toEqual(Array(5).fill('false'));
  });

  it('layout follows (min-width: 640px) and can be forced with the layout prop', () => {
    const r = render(<Harness />);
    expect(q('.metronome-chassis')?.className).toMatch(/metronome-wide/);
    r.unmount();

    stubMetronomeMedia({ wide: false });
    const c = render(<Harness />);
    expect(q('.metronome-chassis')?.className).toMatch(/metronome-compact/);
    expect(q('.metronome-chassis')?.className).toMatch(/w-full/);
    // The stacked phone card keeps every Simple control.
    for (const name of ['Slower', 'Faster', 'Tap tempo', 'Start', 'Switch to full mode', 'Close metronome', 'Beat']) {
      expect(btn(name), name).toBeTruthy();
    }
    expect(text('.metronome-signature-chip')).toBe('4/4');
    expect(all('.metronome-beat-tile')).toHaveLength(4);
    c.unmount();

    render(<Harness layout="wide" initial={{ mode: 'full' }} />);
    expect(q('.metronome-chassis')?.className).toMatch(/metronome-wide/);
    expect(q('.metronome-chassis')?.className).toMatch(/max-w-\[414px\]/);
  });

  it('wide Simple is the 760px rectangle', () => {
    render(<Harness layout="wide" />);
    expect(q('.metronome-chassis')?.className).toMatch(/max-w-\[760px\]/);
  });

  it('ballPosition: rests on tile 1, lands on each tile on the beat, arcs between, higher on the wrap', () => {
    const geom = { zone: 130, heights: [44, 44, 62, 84] as const, ball: 18 };
    const acc = [3, 2, 2, 2] as const;
    // Stopped: on tile 1, nothing active.
    expect(ballPosition(acc, geom, null)).toEqual({ f: 0.125, top: 130 - 84 - 20, active: -1 });
    // On the beat: sitting on that beat's own tile height.
    expect(ballPosition(acc, geom, { beat: 1, phase: 0 })).toEqual({ f: 0.375, top: 130 - 62 - 20, active: 1 });
    // Half-way to the next tile: a 24px arc above the straight line.
    const mid = ballPosition(acc, geom, { beat: 1, phase: 0.5 });
    expect(mid.f).toBeCloseTo(0.5, 6);
    expect(mid.top).toBeCloseTo(130 - 62 - 24 - 20, 6);
    // Wrap back to beat 1: higher arc (34px), flying back to the left.
    const wrap = ballPosition(acc, geom, { beat: 3, phase: 0.5 });
    expect(wrap.f).toBeCloseTo(0.5, 6);
    expect(wrap.top).toBeCloseTo(130 - (62 + 84) / 2 - 34 - 20, 6);
    expect(wrap.active).toBe(3);
    // Two-beat bars use the normal arc on the wrap.
    expect(ballPosition([3, 2], geom, { beat: 1, phase: 0.5 }).top).toBeCloseTo(130 - 73 - 24 - 20, 6);
    // A stale beat index (signature just shrank) is clamped.
    expect(ballPosition([3, 2], geom, { beat: 5, phase: 0 }).active).toBe(1);
  });

  it('stopped: the ball rests on tile 1, no tile is lit and no frame loop runs', () => {
    render(<Harness layout="wide" getBeatState={() => ({ beat: 2, phase: 0.5 })} />);
    expect(ballF()).toBeCloseTo(0.125, 4);
    expect(ballTop()).toBeCloseTo(130 - 84 - 20, 1);
    expect(activeTiles()).toEqual([false, false, false, false]);
    expect(raf.pending()).toBe(0);
  });

  it('running: one rAF loop moves the ball and lights the sounding tile straight on the DOM', () => {
    let state: BeatState | null = null;
    const getBeatState = vi.fn(() => state);
    let renders = 0;
    function Counted() {
      renders += 1;
      return <Harness layout="wide" running getBeatState={getBeatState} />;
    }
    const r = render(<Counted />);
    expect(raf.pending()).toBe(1);
    const rendersAfterMount = renders;

    // Before the first beat sounds: still resting.
    raf.frames(1);
    expect(activeTiles()).toEqual([false, false, false, false]);
    expect(ballF()).toBeCloseTo(0.125, 4);

    state = { beat: 1, phase: 0 };
    raf.frames(1);
    expect(activeTiles()).toEqual([false, true, false, false]);
    expect(ballF()).toBeCloseTo(0.375, 4);
    expect(ballTop()).toBeCloseTo(130 - 62 - 20, 1);

    state = { beat: 1, phase: 0.5 };
    raf.frames(1);
    expect(ballF()).toBeCloseTo(0.5, 4);
    expect(ballTop()).toBeCloseTo(130 - 62 - 24 - 20, 1);

    state = { beat: 3, phase: 0.5 };
    raf.frames(1);
    expect(activeTiles()).toEqual([false, false, false, true]);
    expect(ballTop()).toBeCloseTo(130 - 73 - 34 - 20, 1);

    expect(getBeatState).toHaveBeenCalledTimes(4);
    expect(raf.pending()).toBe(1);
    expect(renders).toBe(rendersAfterMount); // no React state per frame

    r.unmount();
    expect(raf.pending()).toBe(0);
  });

  it('stopping resets the ball to tile 1 and clears the highlight', () => {
    const getBeatState = () => ({ beat: 2, phase: 0.25 });
    const r = render(<Harness layout="wide" running getBeatState={getBeatState} />);
    raf.frames(1);
    expect(activeTiles()).toEqual([false, false, true, false]);
    r.rerender(<Harness layout="wide" running={false} getBeatState={getBeatState} />);
    expect(activeTiles()).toEqual([false, false, false, false]);
    expect(ballF()).toBeCloseTo(0.125, 4);
    expect(raf.pending()).toBe(0);
  });

  it('the ball uses the Full/compact tile heights in those layouts', () => {
    render(<Harness layout="wide" initial={{ mode: 'full' }} running getBeatState={() => ({ beat: 0, phase: 0 })} />);
    raf.frames(1);
    expect(ballTop()).toBeCloseTo(116 - 72 - 18, 1);
    expect(all('.metronome-beat-tile')[0].style.height).toBe('72px');
    expect(all('.metronome-beat-tile')[1].style.height).toBe('56px');
  });

  it('prefers-reduced-motion: no arc, the ball just sits on the current beat', () => {
    stubMetronomeMedia({ wide: true, reduced: true });
    let state: BeatState = { beat: 1, phase: 0.5 };
    render(<Harness layout="wide" running getBeatState={() => state} />);
    raf.frames(1);
    expect(ballF()).toBeCloseTo(0.375, 4);
    expect(ballTop()).toBeCloseTo(130 - 62 - 20, 1);
    expect(activeTiles()).toEqual([false, true, false, false]);
    state = { beat: 3, phase: 0.9 };
    raf.frames(1);
    expect(ballF()).toBeCloseTo(0.875, 4);
    expect(ballTop()).toBeCloseTo(130 - 62 - 20, 1);
  });

  it('shows a message when one is passed', () => {
    render(<Harness message="No sound available on this device." />);
    expect(screen.getByRole('alert').textContent).toBe('No sound available on this device.');
    expect(q('.metronome-message')).toBeTruthy();
  });

  it.each([
    ['wide', 'simple'],
    ['wide', 'full'],
    ['compact', 'simple'],
    ['compact', 'full'],
  ] as const)('%s %s: every button is a ≥44px touch target with a focus ring; semantic class names present', (layout, mode) => {
    render(<Harness layout={layout} initial={{ mode }} />);
    for (const sel of [
      '.metronome-chassis',
      '.metronome-brand',
      '.metronome-bpm-box',
      '.metronome-bpm-value',
      '.metronome-signature-chip',
      '.metronome-btn-slower',
      '.metronome-btn-faster',
      '.metronome-btn-tap',
      '.metronome-btn-start',
      '.metronome-btn-close',
      '.metronome-btn-mode',
      '.metronome-beats',
      '.metronome-beat-tile',
      '.metronome-beat-num',
      '.metronome-ball',
      '.metronome-subdivisions',
      '.metronome-sub-btn',
      '.metronome-btn-presets',
      '.metronome-stripe',
    ]) {
      expect(q(sel), sel).toBeTruthy();
    }
    const buttons = all('button');
    expect(buttons.length).toBeGreaterThanOrEqual(10);
    for (const b of buttons) {
      expect(b.className, b.textContent ?? '').toMatch(/(^|\s)(h-11|min-h-11)(\s|$)/);
      expect(b.className, b.textContent ?? '').toMatch(/focus-visible:ring-2/);
      expect(b.getAttribute('type')).toBe('button');
    }
    for (const b of all('.metronome-btn-shadow')) expect(b.className).toMatch(/active:translate-x-\[2px\] active:translate-y-\[2px\]/);
    expect(all('.metronome-btn-shadow').length).toBeGreaterThanOrEqual(6);
  });

  it('beat numerals are white Poppins 600 with an ink outline painted under the fill', () => {
    render(<Harness />);
    const num = q('.metronome-beat-num')!;
    expect(num.className).toMatch(/text-white/);
    expect(num.className).toMatch(/font-semibold/);
    expect(num.className).toMatch(/font-family:var\(--crfmt-font-ui,Poppins/);
    expect(num.className).toMatch(/\[-webkit-text-stroke:3px_#141210\]/);
    expect(num.className).toMatch(/\[paint-order:stroke\]/);
  });

  it('server render touches no browser globals and hydrates without mismatch, even on a wide screen', async () => {
    const ui = (
      <Metronome
        settings={{ ...DEFAULT_METRONOME_SETTINGS, mode: 'full', signature: '6/8', accents: [3, 1, 1, 2, 1, 1] }}
        onSettingsChange={() => {}}
        running={false}
        onStart={() => {}}
        onStop={() => {}}
        onClose={() => {}}
        getBeatState={() => null}
      />
    );
    expect(renderOnServer(ui)).toContain('metronome-compact');
    const r = await serverRenderThenHydrate(ui);
    expect(r.recoverableErrors).toEqual([]);
    expect(r.hydrationWarnings).toEqual([]);
    expect(r.container.querySelector('.metronome-chassis')?.className).toMatch(/metronome-wide/);
    r.unmount();
  });

  describe('presets overlay', () => {
    const overlay = () => screen.queryByRole('dialog', { name: 'Rhythm presets' });
    const rows = () => all('.metronome-preset-row');
    const titles = () => all('.metronome-preset-title').map((t) => t.textContent);
    const chip = (name: string) => within(q('.metronome-preset-tags-filter')!).getByRole('button', { name });
    const openPresets = () => fireEvent.click(btn('Presets'));
    const ALL_TITLES = BUILTIN_PATTERNS.map((p) => p.title);

    it('is closed until Presets is pressed, then opens as a modal dialog in document.body', () => {
      const r = render(<Harness />);
      expect(overlay()).toBeNull();
      openPresets();
      const o = overlay()!;
      expect(o.className).toMatch(/metronome-presets-overlay/);
      expect(o.getAttribute('aria-modal')).toBe('true');
      // Portalled out of the chassis so the 204px Simple rectangle cannot clip it.
      expect(r.container.contains(o)).toBe(false);
      expect(q('.metronome-chassis')!.contains(o)).toBe(false);
      expect(document.body.contains(o)).toBe(true);
      expect(text('.metronome-presets-title')).toBe('Presets');
      expect(titles()).toEqual(ALL_TITLES);
      expect(o.className).toMatch(/motion-safe:animate-/);
    });

    it('lists title, description, tags and a decorative slot preview for each pattern', () => {
      render(<Harness initial={{ subdivision: 'swing' }} />);
      openPresets();
      const swing = rows()[4];
      expect(swing.querySelector('.metronome-preset-title')?.textContent).toBe('Swing eighths');
      expect(swing.querySelector('.metronome-preset-description')?.textContent).toBe('Long–short eighths on a triplet grid.');
      expect([...swing.querySelectorAll('.metronome-preset-tag')].map((t) => t.textContent)).toEqual(['basic', 'swing', 'triplet']);
      const strip = swing.querySelector('.metronome-preset-slots')!;
      expect(strip.getAttribute('aria-hidden')).toBe('true');
      expect([...strip.querySelectorAll('.metronome-preset-slot')].map((s) => s.getAttribute('data-slot'))).toEqual(['beat', 'rest', 'sub']);
      // The selected pattern's row is the pressed, yellow one.
      expect(rows().map((r) => r.getAttribute('aria-pressed'))).toEqual(BUILTIN_PATTERNS.map((p) => String(p.id === 'swing')));
      expect(swing.className).toMatch(/bg-\[#fff56d\]/);
      // Multi-beat patterns are grouped per beat.
      const tresillo = rows()[9].querySelectorAll('.metronome-preset-beat-group');
      expect(tresillo).toHaveLength(2);
      expect(tresillo[0].querySelectorAll('.metronome-preset-slot')).toHaveLength(4);
    });

    it('moves focus into the overlay, keeps Tab inside, and returns focus to Presets on close', () => {
      render(<Harness />);
      const presets = btn('Presets');
      presets.focus();
      openPresets();
      const o = overlay()!;
      expect(o.contains(document.activeElement)).toBe(true);

      const focusable = [...o.querySelectorAll<HTMLElement>('button')];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      last.focus();
      fireEvent.keyDown(last, { key: 'Tab' });
      expect(document.activeElement).toBe(first);
      fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(last);
      // Focus that has strayed outside is pulled back in.
      presets.focus();
      fireEvent.keyDown(presets, { key: 'Tab' });
      expect(o.contains(document.activeElement)).toBe(true);

      fireEvent.click(within(o).getByRole('button', { name: 'Close presets' }));
      expect(overlay()).toBeNull();
      expect(document.activeElement).toBe(btn('Presets'));
    });

    it('Escape closes the overlay only, and is not seen by listeners further out', () => {
      const onClose = vi.fn();
      const outer = vi.fn((e: KeyboardEvent) => e.defaultPrevented);
      document.addEventListener('keydown', outer);
      try {
        render(<Harness onClose={onClose} />);
        openPresets();
        fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
        expect(overlay()).toBeNull();
        expect(outer).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(btn('Presets'));

        // Even dispatched on document itself, a host listener sees it as already handled.
        openPresets();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(overlay()).toBeNull();
        expect(outer.mock.results.every((r) => r.value === true)).toBe(true);
        expect(onClose).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener('keydown', outer);
      }
    });

    it('closes when the host page is about to swap its body (Astro view transition)', () => {
      render(<Harness />);
      openPresets();
      expect(overlay()).toBeTruthy();
      act(() => {
        document.dispatchEvent(new Event('astro:before-swap'));
      });
      expect(overlay()).toBeNull();
      // and the listener is gone with the overlay
      openPresets();
      fireEvent.click(within(overlay()!).getByRole('button', { name: 'Close presets' }));
      expect(() => document.dispatchEvent(new Event('astro:before-swap'))).not.toThrow();
      expect(overlay()).toBeNull();
    });

    it('an overlay orphaned by a body swap stops trapping keys page-wide', () => {
      render(<Harness />);
      openPresets();
      const dialog = overlay()!;
      // What a swap we were not told about does: a new <body>, the portal left in the old one.
      const oldBody = document.body;
      const newBody = document.createElement('body');
      const field = document.createElement('input');
      newBody.appendChild(field);
      const outer = vi.fn((e: KeyboardEvent) => e.defaultPrevented);
      document.addEventListener('keydown', outer);
      try {
        document.documentElement.replaceChild(newBody, oldBody);
        expect(dialog.isConnected).toBe(false);
        field.focus();

        // fireEvent returns false when something called preventDefault().
        expect(fireEvent.keyDown(field, { key: 'Tab' })).toBe(true);
        expect(document.activeElement).toBe(field);
        expect(fireEvent.keyDown(field, { key: 'Tab', shiftKey: true })).toBe(true);
        // Escape is no longer swallowed either: listeners further out see it, unhandled.
        expect(fireEvent.keyDown(field, { key: 'Escape' })).toBe(true);
        expect(outer).toHaveBeenCalledTimes(3);
        expect(outer.mock.results.every((r) => r.value === false)).toBe(true);
      } finally {
        document.removeEventListener('keydown', outer);
        document.documentElement.replaceChild(oldBody, newBody);
      }
      // Reconnected, it traps again.
      expect(fireEvent.keyDown(document, { key: 'Tab' })).toBe(false);
    });

    it('clicking the backdrop closes; clicking inside the overlay does not', () => {
      render(<Harness />);
      openPresets();
      fireEvent.click(q('.metronome-presets-title')!);
      expect(overlay()).toBeTruthy();
      fireEvent.click(q('.metronome-presets-backdrop')!);
      expect(overlay()).toBeNull();
    });

    it('tag chips filter with AND semantics; All clears; an empty result says so', () => {
      render(<Harness />);
      openPresets();
      const chips = [...q('.metronome-preset-tags-filter')!.querySelectorAll('button')].map((b) => b.textContent);
      expect(chips).toEqual(['All', 'basic', 'latin', 'sixteenths', 'swing', 'syncopated', 'triplet']);
      expect(chip('All').getAttribute('aria-pressed')).toBe('true');

      fireEvent.click(chip('triplet'));
      expect(chip('triplet').getAttribute('aria-pressed')).toBe('true');
      expect(chip('All').getAttribute('aria-pressed')).toBe('false');
      expect(titles()).toEqual(['Triplets', 'Swing eighths']);

      fireEvent.click(chip('swing'));
      expect(titles()).toEqual(['Swing eighths']);

      fireEvent.click(chip('latin'));
      expect(rows()).toHaveLength(0);
      expect(text('.metronome-presets-empty')).toBe('No presets match these tags.');

      // Tapping a pressed chip releases it.
      fireEvent.click(chip('latin'));
      fireEvent.click(chip('swing'));
      expect(chip('swing').getAttribute('aria-pressed')).toBe('false');
      expect(titles()).toEqual(['Triplets', 'Swing eighths']);

      fireEvent.click(chip('All'));
      expect(chip('All').getAttribute('aria-pressed')).toBe('true');
      expect(chip('triplet').getAttribute('aria-pressed')).toBe('false');
      expect(titles()).toEqual(ALL_TITLES);
    });

    it('choosing a preset sets the subdivision, closes the overlay and returns focus', () => {
      const spy = vi.fn();
      render(<Harness initial={{ mode: 'full' }} spy={spy} />);
      openPresets();
      fireEvent.click(rows()[9]);
      expect(spy).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ subdivision: 'tresillo', mode: 'full' }));
      expect(overlay()).toBeNull();
      const presets = q('.metronome-btn-presets')!;
      expect(presets.textContent).toBe('Tresillo');
      expect(presets.getAttribute('aria-pressed')).toBe('true');
      expect(document.activeElement).toBe(presets);

      // Picking a core pattern from the list lights its quick toggle instead.
      fireEvent.click(presets);
      fireEvent.click(rows()[1]);
      expect(btn('8ths').getAttribute('aria-pressed')).toBe('true');
      expect(btn('Presets').getAttribute('aria-pressed')).toBe('false');
    });

    it('lists the patterns it was given', () => {
      const custom = parsePatterns({
        version: 1,
        patterns: [
          { id: 'a', label: 'A', division: 1, slots: ['beat'] },
          { id: 'b', label: 'B', title: 'Bee', tags: ['odd'], division: 2, slots: ['beat', 'sub'] },
        ],
      });
      render(<Harness patterns={custom} />);
      openPresets();
      expect(titles()).toEqual(['A', 'Bee']);
      expect([...q('.metronome-preset-tags-filter')!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['All', 'odd']);
    });

    it('every overlay button is a ≥44px target with a focus ring', () => {
      render(<Harness />);
      openPresets();
      const buttons = [...overlay()!.querySelectorAll('button')];
      expect(buttons.length).toBeGreaterThan(10);
      for (const b of buttons) {
        expect(b.className, b.textContent ?? '').toMatch(/(^|\s)(h-11|min-h-11)(\s|$)/);
        expect(b.className, b.textContent ?? '').toMatch(/focus-visible:ring-2/);
        expect(b.getAttribute('type')).toBe('button');
      }
      for (const sel of ['.metronome-presets-backdrop', '.metronome-presets-header', '.metronome-presets-list', '.metronome-preset-chip', '.metronome-btn-presets-close']) {
        expect(q(sel), sel).toBeTruthy();
      }
    });
  });
});
