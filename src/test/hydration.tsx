/**
 * SSR → hydrate harness for the `dom` vitest project.
 *
 * Mirrors what an SSR framework does: the server renders the
 * component to HTML with no browser globals, the browser parses that HTML
 * (applying HTML5 parser fix-ups such as foster-parenting), and React then
 * hydrates it with whatever browser state the device really has
 * (localStorage, navigator, matchMedia, …).
 *
 * A production "Minified React error #418" is exactly a recoverable
 * hydration error here, so tests assert `recoverableErrors` is empty.
 */
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { act } from '@testing-library/react';

const BROWSER_GLOBALS = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'matchMedia', 'indexedDB'] as const;

/** Render `ui` to a string with browser globals hidden, like a real server. */
export function renderOnServer(ui: React.ReactElement): string {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const key of BROWSER_GLOBALS) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: undefined, configurable: true, writable: true });
  }
  try {
    return renderToString(ui);
  } finally {
    for (const key of BROWSER_GLOBALS) {
      const d = saved.get(key);
      if (d) Object.defineProperty(globalThis, key, d);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
}

export type HydrationResult = {
  html: string;
  container: HTMLElement;
  root: Root;
  /** onRecoverableError payloads — a #418 in production lands here. */
  recoverableErrors: unknown[];
  /** Hydration-related console.error output (dev-only attribute/nesting warnings). */
  hydrationWarnings: string[];
  unmount: () => void;
};

export type HydrateOptions = {
  /** Runs after the server render and before hydration: set up client-only state. */
  beforeHydrate?: () => void;
};

export async function serverRenderThenHydrate(
  ui: React.ReactElement,
  { beforeHydrate }: HydrateOptions = {},
): Promise<HydrationResult> {
  const html = renderOnServer(ui);
  const container = document.createElement('div');
  container.className = 'ssr-island-test';
  // innerHTML goes through the real HTML parser, so invalid nesting in the
  // server markup is "repaired" exactly like a browser would.
  container.innerHTML = html;
  document.body.appendChild(container);

  beforeHydrate?.();

  const recoverableErrors: unknown[] = [];
  const hydrationWarnings: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
    if (/hydrat|cannot be a (child|descendant)|did not match/i.test(text)) hydrationWarnings.push(text);
    else origError(...args);
  };

  let root!: Root;
  try {
    await act(async () => {
      root = hydrateRoot(container, ui, {
        onRecoverableError: (error) => {
          recoverableErrors.push(error);
        },
      });
    });
  } finally {
    console.error = origError;
  }

  return {
    html,
    container,
    root,
    recoverableErrors,
    hydrationWarnings,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}
