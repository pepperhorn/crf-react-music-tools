/**
 * Builds dist/styles.css — a self-contained stylesheet a host can use without
 * running Tailwind — plus dist/fonts.css and dist/patterns.schema.json.
 *
 * 1. Tailwind compiles the utilities the library's sources use (utilities
 *    only, theme values inlined; see src/styles/tailwind.css).
 * 2. The output is made host-independent:
 *    - every rule is scoped to `.crf-music-tools` and its descendants, so a
 *      host element that happens to carry a class such as `flex` or `grid`
 *      is never touched. `:where()` keeps the specificity unchanged;
 *    - Tailwind's internal `--tw-*` custom properties (and their global
 *      `@property` registrations) are renamed `--crfmt-tw-*`, so they cannot
 *      collide with a host's own Tailwind, v3 or v4;
 *    - `rem` becomes `px` (1rem = 16px), so the components keep their size on
 *      pages that change the root font size.
 * 3. The scoped base rules (src/styles/base.css) go first.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const require = createRequire(import.meta.url);

export const SCOPE = '.crf-music-tools';
const SCOPE_PSEUDO = `:where(${SCOPE}, ${SCOPE} *)`;
const VAR_PREFIX = '--crfmt-tw-';
const LAYER = 'crfmt-properties';

function compileTailwind() {
  const tmp = mkdtempSync(join(tmpdir(), 'crfmt-css-'));
  const out = join(tmp, 'utilities.css');
  try {
    const cliPkg = require.resolve('@tailwindcss/cli/package.json');
    const cli = join(dirname(cliPkg), require(cliPkg).bin.tailwindcss);
    execFileSync(process.execPath, [cli, '-i', join(root, 'src/styles/tailwind.css'), '-o', out], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    return readFileSync(out, 'utf8');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** `.flex` → `.flex:where(.crf-music-tools, .crf-music-tools *)` (after the first class of each selector). */
const scopeSelector = selectorParser((selectors) => {
  selectors.each((selector) => {
    const first = selector.nodes.find((n) => n.type === 'class');
    if (!first) throw new Error(`Cannot scope selector without a class: ${selector.toString()}`);
    selector.insertAfter(first, selectorParser.pseudo({ value: SCOPE_PSEUDO }));
  });
});

const remToPx = (value) =>
  value.replace(/(-?\d*\.?\d+)rem\b/g, (_, n) => `${+(parseFloat(n) * 16).toFixed(4)}px`);

/** PostCSS plugin: scope, rename internals, rem → px. */
const hostIndependent = () => ({
  postcssPlugin: 'crfmt-host-independent',
  Once(css) {
    css.walkAtRules((at) => {
      if (at.name === 'property') at.params = at.params.replace(/^--tw-/, VAR_PREFIX);
      else if (at.name === 'layer') at.params = at.params.replace(/\bproperties\b/, LAYER);
      else if (at.name === 'media') at.params = remToPx(at.params);
    });
    css.walkRules((rule) => {
      const parent = rule.parent;
      if (parent?.type === 'atrule' && /keyframes$/.test(parent.name)) return;
      // Tailwind's fallback for browsers without @property: `*, ::before, …` setting only internal variables.
      const internalsOnly = rule.nodes.every((n) => n.type !== 'decl' || n.prop.startsWith('--tw-'));
      if (/^\*/.test(rule.selector) && internalsOnly) return;
      rule.selector = scopeSelector.processSync(rule.selector);
    });
    css.walkDecls((decl) => {
      if (decl.prop.startsWith('--tw-')) decl.prop = VAR_PREFIX + decl.prop.slice(5);
      decl.value = remToPx(decl.value.replace(/--tw-/g, VAR_PREFIX));
    });
  },
});

export async function buildStyles() {
  const utilities = await postcss([hostIndependent()]).process(compileTailwind(), { from: undefined });
  if (/--tw-|\brem\b|\d+rem/.test(utilities.css)) throw new Error('styles.css still contains --tw- or rem');
  const base = readFileSync(join(root, 'src/styles/base.css'), 'utf8');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const banner = `/*! ${pkg.name} v${pkg.version} — precompiled styles. Utilities generated with Tailwind CSS (MIT License, https://tailwindcss.com), scoped to ${SCOPE}. */\n`;
  return banner + base + '\n' + utilities.css.replace(/^\/\*![^]*?\*\/\n?/, '');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(dist, { recursive: true });
  const css = await buildStyles();
  writeFileSync(join(dist, 'styles.css'), css);
  copyFileSync(join(root, 'src/styles/fonts.css'), join(dist, 'fonts.css'));
  copyFileSync(join(root, 'src/metronome/patterns.schema.json'), join(dist, 'patterns.schema.json'));
  console.log(`dist/styles.css  ${(Buffer.byteLength(css) / 1024).toFixed(1)} kB`);
}
