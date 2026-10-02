/**
 * Guards the promise the precompiled stylesheet makes to a host page: every
 * rule only matches inside `.crf-music-tools`, and nothing depends on (or
 * collides with) the host's Tailwind theme, root font size or CSS variables.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import postcss, { type Root, type Rule } from 'postcss';
import { buildStyles, SCOPE } from '../../scripts/build-css.mjs';

let css = '';
let root: Root;
const rules: Rule[] = [];

beforeAll(async () => {
  css = await buildStyles();
  root = postcss.parse(css);
  root.walkRules((rule) => {
    const parent = rule.parent;
    if (parent?.type === 'atrule' && /keyframes$/.test((parent as postcss.AtRule).name)) return;
    rules.push(rule);
  });
}, 60_000);

describe('styles.css', () => {
  it('has the utilities the components use', () => {
    expect(rules.length).toBeGreaterThan(300);
    expect(css).toContain('.border-\\[1\\.5px\\]');
    expect(css).toContain('.min-h-11');
    expect(css).toContain('.sm\\:max-h-\\[80dvh\\]');
  });

  it('has the toolbar utilities, with their custom properties and literal fallbacks', () => {
    for (const fragment of [
      'var(--crfmt-toolbar-size,40px)',
      'var(--crfmt-toolbar-radius,10px)',
      'var(--crfmt-toolbar-gap,8px)',
      'var(--crfmt-toolbar-button-bg,#fff)',
      'var(--crfmt-toolbar-button-border,#d6d3cd)',
      'var(--crfmt-toolbar-button-color,#141210)',
      'var(--crfmt-toolbar-open-bg,#fff56d)',
      'var(--crfmt-toolbar-running-bg,#6bc6a0)',
      'var(--crfmt-toolbar-panel-z,1150)',
      'var(--crfmt-panel-left)',
      'var(--crfmt-panel-width)',
    ])
      expect(css).toContain(fragment);
    // The enlarged hit area and the capped height survive as valid calc().
    expect(css).toMatch(/inset: min\(-3px, calc\(\(var\(--crfmt-toolbar-size,40px\) - 44px\) \/ 2\)\)/);
    expect(css).toMatch(/max-height: calc\(100dvh - var\(--crfmt-panel-top\) - 16px\)/);
    expect(css).toMatch(/max-height: calc\(100dvh - var\(--crfmt-panel-top-compact,var\(--crfmt-panel-top\)\) - 16px\)/);
    expect(css).toMatch(/top: var\(--crfmt-panel-top-compact,var\(--crfmt-panel-top\)\)/);
    // The styling hooks keep the values they replaced as fallbacks, on the right properties.
    expect(css).toMatch(/border-width: var\(--crfmt-toolbar-border-width,1px\)/);
    expect(css).toMatch(/border-width: var\(--crfmt-toolbar-dot-border-width,1px\)/);
    expect(css).toMatch(/cursor: var\(--crfmt-toolbar-cursor,pointer\)/);
    expect(css).toMatch(/height: var\(--crfmt-toolbar-dot-size,10px\)/);
    expect(css).toMatch(/width: var\(--crfmt-toolbar-dot-size,10px\)/);
    expect(css).toMatch(
      /transition: var\(--crfmt-toolbar-transition,color 150ms cubic-bezier\(0\.4,0,0\.2,1\),background-color 150ms cubic-bezier\(0\.4,0,0\.2,1\),border-color 150ms cubic-bezier\(0\.4,0,0\.2,1\)\)/,
    );
    expect(css).toMatch(/animation: crfmt-toolbar-pulse var\(--crfmt-toolbar-dot-pulse-duration,1\.6s\) ease-in-out infinite/);
    // The running dot only pulses for people who have not asked for reduced motion.
    const pulse = rules.filter((r) => r.nodes.some((n) => n.type === 'decl' && /crfmt-toolbar-pulse/.test(n.value)));
    expect(pulse.length).toBeGreaterThan(0);
    for (const rule of pulse) {
      const media = rule.parent?.type === 'atrule' ? (rule.parent as postcss.AtRule).params : '';
      expect(media).toMatch(/prefers-reduced-motion: no-preference/);
    }
  });

  it('scopes every selector to the library root', () => {
    const unscoped = rules
      .flatMap((r) => r.selectors)
      .filter((sel) => !sel.includes(SCOPE))
      // Tailwind's fallback for browsers without @property: it only sets the library's own variables.
      .filter((sel) => !['*', '::before', '::after', '::backdrop'].includes(sel.trim()));
    expect(unscoped).toEqual([]);
  });

  it('the one universal rule only declares library-prefixed custom properties', () => {
    const universal = rules.filter((r) => r.selectors.some((s) => s.trim() === '*'));
    expect(universal).toHaveLength(1);
    universal[0].walkDecls((d) => expect(d.prop).toMatch(/^--crfmt-tw-/));
  });

  it('has no global resets: no element, :root, html or body selectors', () => {
    const global = rules.flatMap((r) => r.selectors).filter((sel) => /^(html|body|:root|:host|button|svg|h[1-6]|p|a|img)\b/.test(sel.trim()));
    expect(global).toEqual([]);
  });

  it('does not use or define Tailwind internals, theme variables or rem', () => {
    expect(css).not.toMatch(/--tw-/);
    expect(css).not.toMatch(/--(spacing|color|font|text|radius|shadow|default)-[a-z]/);
    expect(css).not.toMatch(/\d(rem)\b/);
    const registered: string[] = [];
    root.walkAtRules('property', (at) => void registered.push(at.params));
    expect(registered.length).toBeGreaterThan(0);
    expect(registered.every((name) => name.startsWith('--crfmt-tw-'))).toBe(true);
  });

  it('does not bundle fonts', () => {
    expect(css).not.toMatch(/@font-face|@import/);
  });

  it('keeps utility specificity at one class, so the base rules never outrank them', () => {
    const base = rules.filter((r) => r.selectors.some((s) => s.startsWith(`${SCOPE} :where(`) || s.trim() === SCOPE));
    expect(base.length).toBeGreaterThan(2);
    const firstUtility = rules.findIndex((r) => r.selector.includes(`:where(${SCOPE},`));
    const lastBase = rules.reduce((last, r, i) => (base.includes(r) ? i : last), -1);
    expect(lastBase).toBeLessThan(firstUtility);
  });
});
