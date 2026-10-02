/**
 * A ready-made header toolbar: the tuner and the metronome as two icon
 * buttons, each opening its tool in a floating panel.
 *
 *   import { MusicToolsBar } from '@pepperhorn/react-music-tools/toolbar';
 *   import '@pepperhorn/react-music-tools/styles.css';
 *
 *   <MusicToolsBar />
 *
 * One panel is open at a time. The tuner releases the microphone when its
 * panel closes; the metronome keeps playing with its panel closed, for as
 * long as the bar stays mounted. See TunerToolButton.tsx, MetronomeToolButton.tsx
 * and useToolPanel.tsx for the details, and the README for styling.
 */
import { useCallback, useRef } from 'react';
import type { MetronomeSettings } from '../metronome/model';
import type { UseMetronomeOptions } from '../metronome/useMetronome';
import type { TunerSettings } from '../tuner/pitch';
import { ROOT_CLASS } from '../shared/classes';
import type { MusicToolsLabels } from './labels';
import { MetronomeToolButton } from './MetronomeToolButton';
import { TunerToolButton, type ToolButtonProps } from './TunerToolButton';
import { TOOLBAR_CLASS } from './useToolPanel';

export type MusicTool = 'tuner' | 'metronome';

const DEFAULT_TOOLS: readonly MusicTool[] = ['tuner', 'metronome'];

export interface MusicToolsBarProps
  extends Pick<ToolButtonProps, 'align' | 'topOffset' | 'panelZIndex' | 'buttonClassName' | 'panelClassName'>,
    Pick<UseMetronomeOptions, 'patterns' | 'createEngine' | 'messages'> {
  /** Which tools to show, in order. Default `['tuner', 'metronome']`. */
  tools?: readonly MusicTool[];
  /** localStorage keys for each tool's settings; `null` keeps that tool's settings in memory only. */
  storageKeys?: { tuner?: string | null; metronome?: string | null };
  /** Settings used until stored values are found. */
  defaultSettings?: { tuner?: TunerSettings; metronome?: MetronomeSettings };
  /** Small line under the metronome's brand mark on the card layouts. */
  subtitle?: string;
  /** Accessible names / tooltips, for translation. */
  labels?: Partial<MusicToolsLabels>;
  /** Called with the tool whose panel is now open, or `null` when none is. */
  onOpenChange?: (open: MusicTool | null) => void;
  /** Added to the bar. */
  className?: string;
}

export function MusicToolsBar({
  tools = DEFAULT_TOOLS,
  storageKeys,
  defaultSettings,
  patterns,
  subtitle,
  createEngine,
  messages,
  labels,
  onOpenChange,
  className = '',
  ...shared
}: MusicToolsBarProps) {
  const openTool = useRef<MusicTool | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  // The opening tool reports before the one it replaces closes, so no `null` in between.
  const report = useCallback((tool: MusicTool, open: boolean) => {
    if (open) openTool.current = tool;
    else if (openTool.current === tool) openTool.current = null;
    else return;
    onOpenChangeRef.current?.(openTool.current);
  }, []);
  const onTuner = useCallback((open: boolean) => report('tuner', open), [report]);
  const onMetronome = useCallback((open: boolean) => report('metronome', open), [report]);

  const shown = tools.filter((tool, i) => DEFAULT_TOOLS.includes(tool) && tools.indexOf(tool) === i);

  return (
    <div className={`${ROOT_CLASS} ${TOOLBAR_CLASS} inline-flex items-center gap-[var(--crfmt-toolbar-gap,8px)] ${className}`}>
      {shown.map((tool) =>
        tool === 'tuner' ? (
          <TunerToolButton
            key={tool}
            {...shared}
            storageKey={storageKeys?.tuner}
            defaultSettings={defaultSettings?.tuner}
            labels={labels}
            onOpenChange={onTuner}
          />
        ) : (
          <MetronomeToolButton
            key={tool}
            {...shared}
            storageKey={storageKeys?.metronome}
            defaultSettings={defaultSettings?.metronome}
            patterns={patterns}
            subtitle={subtitle}
            createEngine={createEngine}
            messages={messages}
            labels={labels}
            onOpenChange={onMetronome}
          />
        ),
      )}
    </div>
  );
}
