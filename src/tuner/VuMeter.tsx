import { useEffect, useRef } from 'react';

/**
 * Cream analogue cents meter. Geometry (SVG user units): pivot (160,196),
 * arc radius 156, ±50 cents = ±45°. The needle is moved by a critically
 * damped spring in requestAnimationFrame that writes the transform straight
 * to the DOM (no React re-render per frame); prefers-reduced-motion snaps.
 * The spring is stepped in closed form (`stepNeedle`), so slow frames cannot
 * make it ring or run away.
 * `omega` (the Response setting) is read every frame, so it can change while
 * the needle is moving.
 */

const CX = 160;
const CY = 196;
const R = 156;
const DEG_PER_CENT = 0.9;
/** Default spring stiffness (rad/s). Critically damped: settles in ~0.35 s (about 5/ω). */
export const NEEDLE_OMEGA = 14;

const INK = '#2b2418';
const RED = '#8a1c1c';
const GREEN = '#2f8a3a';

function polar(cents: number, r: number): [number, number] {
  const a = (cents * DEG_PER_CENT * Math.PI) / 180;
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
}

function arc(fromCents: number, toCents: number): string {
  const [x1, y1] = polar(fromCents, R);
  const [x2, y2] = polar(toCents, R);
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

const TICKS = Array.from({ length: 21 }, (_, i) => -50 + i * 5);

export function needleAngle(cents: number | null): number {
  if (cents === null || !Number.isFinite(cents)) return 0;
  return Math.max(-50, Math.min(50, cents)) * DEG_PER_CENT;
}

/**
 * One step of the critically damped spring, in closed form. `x` is the
 * needle's offset from its target (degrees), `v` its velocity (degrees/s).
 *
 * This is the exact solution of x'' = -2ωx' - ω²x over `dt`, so it is stable
 * and overshoot-free for any ω·dt. (Explicit or semi-implicit Euler diverges
 * once ω·dt passes about 0.83: at ω = 22 that is any frame longer than 38 ms.)
 */
export function stepNeedle(x: number, v: number, omega: number, dt: number): { x: number; v: number } {
  const decay = Math.exp(-omega * dt);
  const k = v + omega * x;
  return { x: (x + k * dt) * decay, v: (v - omega * k * dt) * decay };
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export interface VuMeterProps {
  cents: number | null;
  compact?: boolean;
  /** Needle spring stiffness (rad/s): lower is calmer, higher is snappier. Default 14. */
  omega?: number;
  className?: string;
}

export function VuMeter({ cents, compact = false, omega = NEEDLE_OMEGA, className = '' }: VuMeterProps) {
  const needleRef = useRef<SVGGElement>(null);
  const anim = useRef({ angle: 0, vel: 0, target: 0, raf: 0, last: 0, omega });
  const target = needleAngle(cents);

  // Before the spring effect, so a loop started in the same commit already has it.
  useEffect(() => {
    anim.current.omega = omega > 0 && Number.isFinite(omega) ? omega : NEEDLE_OMEGA;
  }, [omega]);

  useEffect(() => {
    const s = anim.current;
    s.target = target;
    const apply = () => needleRef.current?.setAttribute('transform', `rotate(${s.angle.toFixed(3)} ${CX} ${CY})`);

    if (prefersReducedMotion()) {
      if (s.raf) cancelAnimationFrame(s.raf);
      s.raf = 0;
      s.angle = target;
      s.vel = 0;
      apply();
      return;
    }
    if (s.raf) return; // the running loop reads s.target

    s.last = 0;
    const step = (t: number) => {
      const dt = s.last ? Math.min(Math.max((t - s.last) / 1000, 0), 0.05) : 1 / 60;
      s.last = t;
      const next = stepNeedle(s.angle - s.target, s.vel, s.omega, dt);
      s.angle = s.target + next.x;
      s.vel = next.v;
      if (Math.abs(s.angle - s.target) < 0.02 && Math.abs(s.vel) < 0.2) {
        s.angle = s.target;
        s.vel = 0;
        s.raf = 0;
        apply();
        return;
      }
      apply();
      s.raf = requestAnimationFrame(step);
    };
    s.raf = requestAnimationFrame(step);
  }, [target]);

  useEffect(() => {
    const s = anim.current;
    return () => {
      if (s.raf) cancelAnimationFrame(s.raf);
      s.raf = 0;
    };
  }, []);

  const arcW = compact ? 2 : 1.5;
  const zoneW = compact ? 7 : 5;
  const ticks = compact ? TICKS.filter((c) => c % 10 === 0) : TICKS;

  return (
    <svg
      className={`tuner-meter-svg block h-auto w-full ${className}`}
      viewBox={compact ? '30 20 260 186' : '0 20 320 186'}
      role="img"
      aria-label={cents === null ? 'Tuning meter, no signal' : `Tuning meter, ${Math.round(cents)} cents`}
    >
      <path className="tuner-meter-arc" d={arc(-50, 50)} fill="none" stroke={INK} strokeWidth={arcW} />
      <path className="tuner-meter-zone-flat" d={arc(-50, -30)} fill="none" stroke={RED} strokeWidth={zoneW} />
      <path className="tuner-meter-zone-sharp" d={arc(30, 50)} fill="none" stroke={RED} strokeWidth={zoneW} />
      <path className="tuner-meter-zone-in-tune" d={arc(-5, 5)} fill="none" stroke={GREEN} strokeWidth={zoneW} />
      <g className="tuner-meter-ticks">
        {ticks.map((c) => {
          const major = c % 10 === 0;
          const [x1, y1] = polar(c, 150);
          const [x2, y2] = polar(c, major ? 136 : 142);
          return (
            <line
              key={c}
              x1={x1.toFixed(1)}
              y1={y1.toFixed(1)}
              x2={x2.toFixed(1)}
              y2={y2.toFixed(1)}
              stroke={Math.abs(c) >= 30 ? RED : INK}
              strokeWidth={compact ? 3 : major ? 2.2 : 1.2}
              strokeLinecap="round"
            />
          );
        })}
      </g>
      {!compact && (
        <g className="tuner-meter-labels" fontFamily="Poppins, sans-serif" fontSize="11" fontWeight="600" textAnchor="middle">
          <text x="73.7" y="113" fill={RED}>-50</text>
          <text x="140.9" y="79" fill={INK}>-10</text>
          <text x="160" y="78" fill={GREEN} fontWeight="700">0</text>
          <text x="179.1" y="79" fill={INK}>+10</text>
          <text x="246.3" y="113" fill={RED}>+50</text>
        </g>
      )}
      <g className="tuner-meter-accidentals" fontFamily="Poppins, sans-serif" fontSize={compact ? 34 : 26} fill={INK} textAnchor="middle">
        <text x={compact ? 56 : 48} y={compact ? 170 : 165}>♭</text>
        <text x={compact ? 264 : 272} y={compact ? 170 : 165}>♯</text>
      </g>
      <g ref={needleRef} className="tuner-needle" transform={`rotate(0 ${CX} ${CY})`}>
        <line x1={CX} y1={CY} x2={CX} y2={50} stroke="#141210" strokeWidth={compact ? 4 : 2.6} strokeLinecap="round" />
      </g>
      <circle className="tuner-needle-hub" cx={CX} cy={CY} r={compact ? 13 : 10} fill={INK} />
      <circle className="tuner-needle-cap" cx={CX} cy={CY} r={compact ? 5 : 3.5} fill="#8c7a5b" />
    </svg>
  );
}
