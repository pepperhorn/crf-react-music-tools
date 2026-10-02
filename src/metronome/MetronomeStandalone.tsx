/**
 * Drop-in metronome: the view, the audio engine and per-device settings in
 * one component.
 *
 *   import { MetronomeStandalone } from '@pepperhorn/react-music-tools';
 *   import '@pepperhorn/react-music-tools/styles.css';
 *
 *   <MetronomeStandalone />
 *
 * Playback stops when the component unmounts. The close (×) button is only
 * rendered when `onClose` is given; pressing it stops playback first.
 * To keep the click going while the view is hidden, use `useMetronome` in a
 * component that stays mounted and render <Metronome> yourself.
 */
import { Metronome, type MetronomeLayout } from './Metronome';
import { useMetronome, type UseMetronomeOptions } from './useMetronome';

export interface MetronomeStandaloneProps extends Pick<UseMetronomeOptions, 'defaultSettings' | 'patterns' | 'createEngine' | 'messages' | 'onSettingsChange'> {
  /** localStorage key for the settings. Default 'crf-music-tools-metronome'; `null` keeps them in memory only. */
  storageKey?: string | null;
  /** Shows a close button that stops playback and then calls this. */
  onClose?: () => void;
  /** Small line under the brand mark on the card layouts. */
  subtitle?: string;
  /** Force a layout; by default it follows (min-width: 640px). */
  layout?: MetronomeLayout;
  className?: string;
}

export function MetronomeStandalone({ storageKey, onClose, subtitle, layout, className, ...options }: MetronomeStandaloneProps) {
  const metronome = useMetronome({ ...options, ...(storageKey !== undefined ? { storageKey } : {}) });
  const close = onClose
    ? () => {
        metronome.onStop();
        onClose();
      }
    : undefined;
  return <Metronome {...metronome} onClose={close} subtitle={subtitle} layout={layout} className={className} />;
}
