/**
 * The tuner as a toolbar button: a tuning-fork icon button that opens the
 * tuner in a floating panel.
 *
 *   <TunerToolButton />
 *
 * There is no "Start tuner" step: the AudioContext is created and resumed
 * synchronously inside the button's click (`createTunerAudioContext` — iOS
 * only lets audio start from a gesture) and handed to <Tuner>, which takes
 * ownership. Closing the panel — the button, the X, Escape, another tool
 * opening — or unmounting this component unmounts <Tuner>, which stops the
 * microphone track and closes the context. Each open gets a fresh context.
 *
 * Usually rendered by `MusicToolsBar`; on its own it is its own anchor.
 */
import { useState } from 'react';
import { Tuner } from '../tuner/Tuner';
import { createTunerAudioContext } from '../tuner/useMicPitch';
import { DEFAULT_TUNER_SETTINGS, parseTunerSettings, type TunerSettings } from '../tuner/pitch';
import { TUNER_STORAGE_KEY } from '../tuner/TunerStandalone';
import { usePersistentSettings } from '../shared/usePersistentSettings';
import { ROOT_CLASS } from '../shared/classes';
import { TuningForkIcon } from './icons';
import { DEFAULT_MUSIC_TOOLS_LABELS, type MusicToolsLabels } from './labels';
import type { ToolbarAlign } from './position';
import { toolToggleClass } from './tool-toggle';
import { ToolPanel, useToolPanel } from './useToolPanel';

/** Props shared by both tool buttons. */
export interface ToolButtonProps {
  /** Which edge of the bar the panel lines up with from 640px. Flips when it would leave the viewport. Default 'start'. */
  align?: ToolbarAlign;
  /**
   * How much of the top of the viewport the host's sticky / fixed header
   * covers: px, or any CSS length. The panel starts 8px below it (or below the
   * bar, when that is lower). Default: 8px below the bar.
   */
  topOffset?: number | string;
  /** z-index of the panel. Default 1150 (`--crfmt-toolbar-panel-z`). */
  panelZIndex?: number;
  /** Called when the panel opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /** Added to the wrapper element. */
  className?: string;
  /** Added to the button. */
  buttonClassName?: string;
  /** Added to the floating panel. */
  panelClassName?: string;
}

export interface TunerToolButtonProps extends ToolButtonProps {
  /** localStorage key for the settings. Default 'crf-music-tools-tuner'; `null` keeps them in memory only. */
  storageKey?: string | null;
  /** Settings used until a stored value is found. */
  defaultSettings?: TunerSettings;
  /** Called with every settings change. */
  onSettingsChange?: (next: TunerSettings) => void;
  labels?: Partial<Pick<MusicToolsLabels, 'openTuner' | 'closeTuner' | 'tuner'>>;
}

/** The tuner is at most this wide. */
const TUNER_WIDTH = 760;

export function TunerToolButton({
  storageKey = TUNER_STORAGE_KEY,
  defaultSettings = DEFAULT_TUNER_SETTINGS,
  onSettingsChange,
  labels,
  align,
  topOffset,
  panelZIndex,
  onOpenChange,
  className = '',
  buttonClassName = '',
  panelClassName = '',
}: TunerToolButtonProps) {
  const [settings, setSettings] = usePersistentSettings<TunerSettings>(storageKey, parseTunerSettings, defaultSettings);
  const panel = useToolPanel({ maxWidth: TUNER_WIDTH, align, topOffset, onOpenChange });
  const { open, toggleRef, panelId } = panel;
  // The context made in the opening click; <Tuner> owns (and closes) it.
  const [ctx, setCtx] = useState<AudioContext | null>(null);
  const text = { ...DEFAULT_MUSIC_TOOLS_LABELS, ...labels };

  const change = (next: TunerSettings) => {
    setSettings(next);
    onSettingsChange?.(next);
  };

  const onToggle = () => {
    if (open) {
      panel.hide();
      return;
    }
    // Must stay synchronous in the gesture for iOS.
    setCtx(createTunerAudioContext());
    panel.openPanel();
  };

  const label = open ? text.closeTuner : text.openTuner;
  // Tiles is square-cornered, and its hard shadow needs room inside the scroll box.
  const look = settings.theme === 'tiles' ? 'crfmt-tool-panel-tiles rounded-none pb-[6px] pr-[6px] sm:p-0' : 'rounded-2xl';

  return (
    <div className={`${ROOT_CLASS} crfmt-tool crfmt-tool-tuner inline-flex items-center ${className}`}>
      <button
        ref={toggleRef}
        type="button"
        className={`crfmt-tool-toggle-tuner ${toolToggleClass(open ? 'open' : 'idle')} ${open ? 'crfmt-tool-toggle-open' : ''} ${buttonClassName}`}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={onToggle}
      >
        <TuningForkIcon />
      </button>
      <ToolPanel panel={panel} label={text.tuner} zIndex={panelZIndex} className={`crfmt-tool-panel-tuner ${look} ${panelClassName}`}>
        <Tuner settings={settings} onSettingsChange={change} onClose={panel.close} audioContext={ctx} />
      </ToolPanel>
    </div>
  );
}
