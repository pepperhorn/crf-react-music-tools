import { FONT_MONO } from '../shared/classes';
import { blockMeterModel, BLOCK_ROWS, tint, TILES_INK, TILES_YELLOW } from './blocks';

/**
 * The "tiles" theme's 8-bit cents meter: 21 columns of square blocks for
 * −50..+50 cents. Driven straight from the live cents value — the only
 * "animation" is the lit state changing. See `blockMeterModel` for the rules.
 */

const MONO = FONT_MONO;
const UNLIT_BORDER = tint(TILES_INK, 0.18);

/** Pixel-art down arrow: a 7×5 grid, yellow inside an ink outline. */
const MARKER_ROWS = ['IIIIIII', 'IYYYYYI', '.IYYYI.', '..IYI..', '...I...'];

export function PixelMarker({ px }: { px: number }) {
  return (
    <svg
      className="tuner-marker block shrink-0"
      width={7 * px}
      height={5 * px}
      viewBox="0 0 7 5"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {MARKER_ROWS.flatMap((row, y) =>
        [...row].map((ch, x) =>
          ch === '.' ? null : (
            <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={ch === 'Y' ? TILES_YELLOW : TILES_INK} />
          ),
        ),
      )}
    </svg>
  );
}

export interface BlockMeterProps {
  cents: number | null;
  compact?: boolean;
  className?: string;
}

export function BlockMeter({ cents, compact = false, className = '' }: BlockMeterProps) {
  const model = blockMeterModel(cents);
  const px = compact ? 2 : 3;
  // Columns sit at the mockup's block size and only shrink when the panel is narrower than the design.
  const colSize = compact ? 'basis-[11px]' : 'basis-[14px]';
  const blockSize = compact ? 'max-w-[11px]' : 'max-w-[14px]';
  const rows = Array.from({ length: BLOCK_ROWS }, (_, r) => BLOCK_ROWS - 1 - r); // top → bottom

  return (
    <div
      className={`tuner-meter tuner-block-meter flex flex-col gap-[5px] ${className}`}
      role="img"
      aria-label={cents === null ? 'Tuning meter, no signal' : `Tuning meter, ${Math.round(cents)} cents`}
    >
      <div className="tuner-blocks flex items-end justify-between">
        {model.columns.map((col) => (
          <div
            key={col.index}
            className={`tuner-block-col ${col.active ? 'tuner-block-col-active' : ''} flex min-w-0 shrink grow-0 flex-col items-center gap-[3px] ${colSize}`}
            data-cents={col.cents}
            data-lit={col.lit}
          >
            {col.active ? (
              <PixelMarker px={px} />
            ) : (
              <div className="tuner-marker-space shrink-0" style={{ height: 5 * px }} aria-hidden="true" />
            )}
            {rows.map((r) => {
              const lit = r < col.lit;
              return (
                <div
                  key={r}
                  className={`tuner-block ${lit ? 'tuner-block-lit border-2' : 'border-[1.5px]'} box-border aspect-square w-full shrink-0 ${blockSize} ${
                    lit && col.active ? 'shadow-[0_0_8px_2px_rgba(255,245,109,0.9)]' : ''
                  }`}
                  style={{ background: lit ? col.color : col.tint, borderColor: lit ? TILES_INK : UNLIT_BORDER }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div
        className={`tuner-scale flex justify-between ${MONO} font-bold leading-none tracking-[0.04em] ${compact ? 'text-[9px]' : 'text-[10px]'}`}
        aria-hidden="true"
      >
        <span>−50</span>
        <span>−25</span>
        <span className="tuner-scale-zero text-[#2f7a5a]">0</span>
        <span>+25</span>
        <span>+50</span>
      </div>
    </div>
  );
}
