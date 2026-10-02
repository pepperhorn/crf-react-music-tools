import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { usePersistentSettings } from './usePersistentSettings';
import { renderOnServer, serverRenderThenHydrate } from '../test/hydration';

interface Prefs {
  size: number;
}
const DEFAULTS: Prefs = { size: 1 };
const parse = (raw: unknown): Prefs => {
  const size = (raw as Partial<Prefs> | null)?.size;
  return { size: typeof size === 'number' && Number.isFinite(size) ? Math.max(0, Math.min(9, size)) : DEFAULTS.size };
};

function Probe({ storageKey = 'test-prefs' as string | null }) {
  const [prefs, setPrefs] = usePersistentSettings(storageKey, parse, DEFAULTS);
  return (
    <button type="button" className="probe" onClick={() => setPrefs({ size: prefs.size + 1 })}>
      size {prefs.size}
    </button>
  );
}

describe('usePersistentSettings', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders the defaults on the server, without any browser globals', () => {
    localStorage.setItem('test-prefs', JSON.stringify({ size: 5 }));
    expect(renderOnServer(<Probe />)).toContain('size <!-- -->1');
  });

  it('hydrates with the defaults, then loads the stored value', async () => {
    const r = await serverRenderThenHydrate(<Probe />, {
      beforeHydrate: () => localStorage.setItem('test-prefs', JSON.stringify({ size: 5 })),
    });
    expect(r.html).toContain('size <!-- -->1');
    expect(r.recoverableErrors).toEqual([]);
    expect(r.hydrationWarnings).toEqual([]);
    expect(r.container.textContent).toBe('size 5');
    r.unmount();
  });

  it('writes every change, cleaned by parse', () => {
    render(<Probe />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').textContent).toBe('size 2');
    expect(JSON.parse(localStorage.getItem('test-prefs')!)).toEqual({ size: 2 });
  });

  it('parses what it reads: out-of-range and corrupt values never reach the component', () => {
    localStorage.setItem('test-prefs', JSON.stringify({ size: 500 }));
    const first = render(<Probe />);
    expect(screen.getByRole('button').textContent).toBe('size 9');
    first.unmount();
    localStorage.setItem('test-prefs', '{not json');
    render(<Probe />);
    expect(screen.getByRole('button').textContent).toBe('size 1');
  });

  it('keeps working in memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    render(<Probe />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').textContent).toBe('size 3');
  });

  it('keeps working when localStorage itself is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    try {
      render(<Probe />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByRole('button').textContent).toBe('size 2');
    } finally {
      Object.defineProperty(window, 'localStorage', original);
    }
  });

  it('a null key never touches storage', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem');
    const set = vi.spyOn(Storage.prototype, 'setItem');
    render(<Probe storageKey={null} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').textContent).toBe('size 2');
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('switching key loads that key, or falls back to the defaults', () => {
    localStorage.setItem('b', JSON.stringify({ size: 7 }));
    const { rerender } = render(<Probe storageKey="a" />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button').textContent).toBe('size 2');
    rerender(<Probe storageKey="b" />);
    expect(screen.getByRole('button').textContent).toBe('size 7');
    act(() => rerender(<Probe storageKey="c" />));
    expect(screen.getByRole('button').textContent).toBe('size 1');
    expect(JSON.parse(localStorage.getItem('a')!)).toEqual({ size: 2 });
  });
});
