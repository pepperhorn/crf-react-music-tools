/**
 * The metronome as a toolbar button: a metronome icon button that opens the
 * metronome in a floating panel.
 *
 *   <MetronomeToolButton />
 *
 * Unlike the tuner, the engine belongs to this component (through
 * `useMetronome`), not to the panel: closing the panel does NOT stop
 * playback. The button shows that it is running (its own colour, a small
 * pulsing dot, and its accessible name). The engine is made on the first
 * Start, never on the server, and disposed when this component unmounts —
 * so keep it mounted for as long as the click should carry on (in Astro:
 * `transition:persist`).
 *
 * iOS: Start creates and resumes the AudioContext, so <Metronome> calls it
 * synchronously inside the Start press.
 *
 * Usually rendered by `MusicToolsBar`; on its own it is its own anchor.
 */
import { useEffect } from 'react';
import { Metronome } from '../metronome/Metronome';
import { useMetronome, type UseMetronomeOptions } from '../metronome/useMetronome';
import { ROOT_CLASS } from '../shared/classes';
import { MetronomeIcon } from './icons';
import { DEFAULT_MUSIC_TOOLS_LABELS, type MusicToolsLabels } from './labels';
import { toolToggleClass } from './tool-toggle';
import type { ToolButtonProps } from './TunerToolButton';
import { AFTER_BODY_SWAP_EVENT, ToolPanel, useToolPanel } from './useToolPanel';

export interface MetronomeToolButtonProps
  extends ToolButtonProps,
    Pick<UseMetronomeOptions, 'defaultSettings' | 'patterns' | 'createEngine' | 'messages' | 'onSettingsChange'> {
  /** localStorage key for the settings. Default 'crf-music-tools-metronome'; `null` keeps them in memory only. */
  storageKey?: string | null;
  /** Small line under the brand mark on the card layouts. */
  subtitle?: string;
  labels?: Partial<Pick<MusicToolsLabels, 'openMetronome' | 'openMetronomeRunning' | 'closeMetronome' | 'metronome'>>;
}

/** Simple mode is a 760px rectangle, Full a 414px card. */
const SIMPLE_WIDTH = 760;
const FULL_WIDTH = 414;

/** Injected while the dot is shown: the stylesheet is utilities only, and this must also work when the host's Tailwind generates them. */
const PULSE_KEYFRAMES = '@keyframes crfmt-toolbar-pulse{50%{opacity:var(--crfmt-toolbar-dot-pulse-opacity,.35)}}';

export function MetronomeToolButton({
  storageKey,
  subtitle,
  labels,
  align,
  topOffset,
  anchor,
  fit,
  compactTop,
  panelZIndex,
  onOpenChange,
  className = '',
  buttonClassName = '',
  panelClassName = '',
  ...options
}: MetronomeToolButtonProps) {
  const metronome = useMetronome({ ...options, ...(storageKey !== undefined ? { storageKey } : {}) });
  const { running, settings, onStop } = metronome;
  const panel = useToolPanel({ maxWidth: settings.mode === 'full' ? FULL_WIDTH : SIMPLE_WIDTH, align, topOffset, anchor, fit, compactTop, onOpenChange });
  const { open, toggleRef, panelId } = panel;
  const text = { ...DEFAULT_MUSIC_TOOLS_LABELS, ...labels };

  // A host that swaps the body (Astro's view transitions) and did not keep
  // this component's element: no button is left to show, or stop, the click.
  useEffect(() => {
    const onAfterSwap = () => {
      if (toggleRef.current && !toggleRef.current.isConnected) onStop();
    };
    document.addEventListener(AFTER_BODY_SWAP_EVENT, onAfterSwap);
    return () => document.removeEventListener(AFTER_BODY_SWAP_EVENT, onAfterSwap);
  }, [toggleRef, onStop]);

  const onToggle = () => (open ? panel.hide() : panel.openPanel());

  const label = open ? text.closeMetronome : running ? text.openMetronomeRunning : text.openMetronome;
  const markers = `${running ? 'crfmt-tool-toggle-running' : ''} ${open ? 'crfmt-tool-toggle-open' : ''}`;

  return (
    <div className={`${ROOT_CLASS} crfmt-tool crfmt-tool-metronome inline-flex items-center ${className}`}>
      <button
        ref={toggleRef}
        type="button"
        className={`crfmt-tool-toggle-metronome ${toolToggleClass(running ? 'running' : open ? 'open' : 'idle')} ${markers} ${buttonClassName}`}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={onToggle}
      >
        <MetronomeIcon />
        {running && (
          <span
            className="crfmt-tool-toggle-dot pointer-events-none absolute -right-1 -top-1 h-[var(--crfmt-toolbar-dot-size,10px)] w-[var(--crfmt-toolbar-dot-size,10px)] rounded-full border-[length:var(--crfmt-toolbar-dot-border-width,1px)] border-[color:var(--crfmt-toolbar-active-border,#141210)] bg-[var(--crfmt-toolbar-dot-bg,#f86e6e)] motion-safe:animate-[crfmt-toolbar-pulse_var(--crfmt-toolbar-dot-pulse-duration,1.6s)_ease-in-out_infinite]"
            aria-hidden="true"
          />
        )}
      </button>
      {running && <style>{PULSE_KEYFRAMES}</style>}
      <ToolPanel panel={panel} label={text.metronome} zIndex={panelZIndex} className={`crfmt-tool-panel-metronome ${panelClassName}`}>
        <Metronome {...metronome} onClose={panel.close} subtitle={subtitle} layout={panel.layout} />
      </ToolPanel>
    </div>
  );
}
