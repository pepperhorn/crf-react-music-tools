/**
 * Per-device settings in `localStorage`, safe for server rendering.
 *
 * The server render and the first client render both return the defaults, so
 * hydration always matches; the stored value is read in an effect straight
 * after mount. Storage is best-effort: when it is missing, blocked or full
 * (private windows, sandboxed iframes) the value simply lives in memory for
 * the lifetime of the component.
 *
 * `parse` validates whatever comes out of storage (or is handed to the
 * setter) and returns a clean value, e.g. `parseMetronomeSettings`.
 *
 * No cross-tab or cross-component sync: two components on the same key each
 * hold their own copy and the last one to write wins on the next load.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : (window.localStorage ?? null);
  } catch {
    return null;
  }
}

/** The stored value for `key`, or `undefined` when nothing usable is stored. */
function readStored<T>(key: string, parse: (raw: unknown) => T): T | undefined {
  try {
    const raw = storage()?.getItem(key);
    return raw == null ? undefined : parse(JSON.parse(raw));
  } catch {
    return undefined; // corrupt or unreadable: keep what we have
  }
}

/**
 * @param key      localStorage key, or `null` to keep the value in memory only.
 * @param parse    Validates and normalises a raw value.
 * @param defaults Used until (and unless) a stored value is found.
 * @returns `[settings, setSettings]`; `setSettings` has a stable identity per key.
 */
export function usePersistentSettings<T>(
  key: string | null,
  parse: (raw: unknown) => T,
  defaults: T,
): [T, (next: T) => void] {
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  const [value, setValue] = useState<T>(() => parse(defaults));
  const loadedKey = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const first = loadedKey.current === undefined;
    loadedKey.current = key;
    const stored = key === null ? undefined : readStored(key, (raw) => parseRef.current(raw));
    if (stored !== undefined) setValue(stored);
    // A different key: forget the previous key's value.
    else if (!first) setValue(parseRef.current(defaultsRef.current));
  }, [key]);

  const set = useCallback(
    (next: T) => {
      const clean = parseRef.current(next);
      setValue(clean);
      if (key === null) return;
      try {
        storage()?.setItem(key, JSON.stringify(clean));
      } catch {
        /* memory only on this device */
      }
    },
    [key],
  );

  return [value, set];
}
