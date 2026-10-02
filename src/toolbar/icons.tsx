/**
 * The two toolbar icons: 24×24 line icons drawn with `currentColor`, so they
 * take the colour of whatever they sit in.
 */
export interface ToolIconProps {
  /** Width and height in px. Default 20. */
  size?: number;
  className?: string;
}

function icon(name: string, { size = 20, className = '' }: ToolIconProps, paths: string[]) {
  return (
    <svg
      className={`crfmt-icon crfmt-icon-${name}${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** A tuning fork: the tuner. */
export function TuningForkIcon(props: ToolIconProps) {
  return icon('tuning-fork', props, ['M8 2v7a4 4 0 0 0 8 0V2', 'M12 13v9']);
}

/** A pyramid metronome: the metronome. */
export function MetronomeIcon(props: ToolIconProps) {
  return icon('metronome', props, ['M9 3h6l4 18H5z', 'M12 16l5-10', 'M7 16h10']);
}
