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
