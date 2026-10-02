/**
 * Class fragments shared by both tools.
 *
 * `ROOT_CLASS` goes on every root element the library renders (each chassis,
 * the presets overlay, the standalone wrappers). The precompiled stylesheet
 * (`crf-react-music-tools/styles.css`) only matches elements at or under that
 * class, so none of its rules can restyle the host page.
 *
 * Fonts are literal stacks wrapped in a CSS variable, so a host can swap a
 * face (`--crfmt-font-ui`, `-display`, `-mono`, `-lcd`) and the components
 * still fall back to system fonts when the web fonts are not loaded.
 */
export const ROOT_CLASS = 'crf-music-tools';

/** Buttons, numerals, body text. */
export const FONT_UI = '[font-family:var(--crfmt-font-ui,Poppins,ui-sans-serif,system-ui,sans-serif)]';
/**
 * Brand marks and big numbers. Archivo Black has a single (400) face; asking
 * for weight 900 with synthesis off still selects it, and makes the system
 * fallback genuinely heavy when the font is absent.
 */
export const FONT_DISPLAY =
  "[font-family:var(--crfmt-font-display,'Archivo_Black','Arial_Black',Poppins,ui-sans-serif,system-ui,sans-serif)] font-black [font-synthesis:none]";
/** Labels and chips. */
export const FONT_MONO = "[font-family:var(--crfmt-font-mono,'Space_Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace)]";
/** The vintage tuner's LCD. */
export const FONT_LCD = "[font-family:var(--crfmt-font-lcd,VT323,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace)]";
