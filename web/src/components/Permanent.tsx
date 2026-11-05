import type { CardView } from '@mmv/shared';
import { counterName } from '../lib';
import { useReplay } from '../store';

const FRAME: Record<string, string> = {
  W: '#e6dcb8',
  U: '#3f8fd6',
  B: '#7a6a8c',
  R: '#d4553a',
  G: '#43a55f',
  M: '#d6b24c', // multicolor
  C: '#9aa4b0',
};

const BASIC_LAND_COLOR: Record<string, string> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };

function frameColor(v: CardView, name?: string): string {
  if (v.colors?.length === 1) return FRAME[v.colors[0]];
  if (v.colors && v.colors.length > 1) return FRAME.M;
  const basic = name && BASIC_LAND_COLOR[name.replace(/^Snow-Covered /, '')];
  return FRAME[basic || 'C'];
}

export const PERM_W = 144;
export const LAND_W = 105;
// geometry of the art crop inside a standard card image (fractions of the card)
const ART = { x: 0.075, y: 0.115, w: 0.85, aspect: 1.35 };
const bannerH = (width: number) => Math.round(width * 0.15);

export function permHeight(width: number) {
  const border = Math.round(width * 0.03);
  const artW = width - border * 2;
  return Math.round(border * 2 + bannerH(width) + artW / ART.aspect);
}

interface Props {
  v: CardView;
  width?: number;
  /** identical permanents collapsed into this one (fan stack) */
  count?: number;
  flash?: boolean;
  /** stable ids of every card this frame represents (for combat lines) */
  ids?: number[];
}

export function Permanent({ v, width = PERM_W, count = 1, flash, ids }: Props) {
  const mySeat = useReplay((s) => s.replay?.meta.mySeat);
  const mine = v.controller === mySeat;
  const info = useReplay((s) => s.replay?.cards[v.grpId || v.srcGrp || 0]);
  const setHover = useReplay((s) => s.setHover);
  const H = permHeight(width);
  const BORDER = Math.round(width * 0.03);
  const BANNER = bannerH(width);
  const fs = Math.max(9, Math.round(width * 0.092)); // banner text
  const ptFs = Math.round(width * 0.125);
  const tapped = !!v.tapped;
  const isToken = v.kind === 'token';
  const isCreature = !!v.types?.includes('Creature');
  const isWalker = !!v.types?.includes('Planeswalker');
  const color = frameColor(v, info?.name);
  const layers = Math.min(count, 4);
  const offset = 8;

  const artW = width - BORDER * 2;
  const bgW = artW / ART.w;
  const bgH = bgW * 1.4;
  const artH = Math.round(artW / ART.aspect);
  const img = info?.img;

  const wrapW = (tapped ? H : width) + (layers - 1) * offset;
  const wrapH = tapped ? width : H;

  const glow = v.attacking
    ? '0 0 14px 2px rgba(255,120,40,.8), 0 0 0 2px rgba(255,150,60,.95)'
    : v.blocking
      ? '0 0 16px 3px rgba(56,189,248,.9), 0 0 0 2px rgba(125,211,252,.95)'
      : undefined;
  // attackers step forward (towards the defender): up for you, down for the opponent
  const shift = v.attacking ? (mine ? -22 : 22) : 0;

  return (
    <div
      className="relative shrink-0"
      data-cids={(ids ?? [v.id]).join(',')}
      style={{ width: wrapW, height: wrapH, transform: shift ? `translateY(${shift}px)` : undefined, transition: 'transform .25s ease-out' }}
      onMouseEnter={() => setHover({ grp: v.grpId || v.srcGrp || 0, view: v })}
      onMouseLeave={() => setHover(undefined)}
    >
      {Array.from({ length: layers }).map((_, i) => {
        const top = i === layers - 1;
        const x = i * offset;
        return (
          <div
            key={i}
            className={`absolute ${top ? 'card-enter' : ''}`}
            style={{
              width,
              height: H,
              left: tapped ? x + (H - width) / 2 : x,
              top: tapped ? (width - H) / 2 : 0,
              transform: tapped ? 'rotate(90deg)' : undefined,
              transition: 'transform .2s, filter .2s',
              filter: tapped ? 'brightness(.62) saturate(.8)' : undefined,
              zIndex: i,
            }}
          >
            <div
              className={`relative h-full w-full overflow-hidden ${top && flash ? 'card-flash' : ''}`}
              style={{
                background: color,
                borderRadius: isToken ? '46% 46% 8px 8px / 30% 30% 8px 8px' : 7,
                boxShadow: top ? (glow ?? '0 3px 6px rgba(0,0,0,.55)') : '0 2px 4px rgba(0,0,0,.5)',
                padding: BORDER,
              }}
            >
              {/* name banner */}
              <div
                className="flex items-center px-1.5 font-semibold leading-none text-slate-900"
                style={{ height: BANNER, fontSize: fs, background: 'rgba(255,255,255,.55)', borderRadius: isToken ? '999px 999px 0 0' : '3px 3px 0 0', justifyContent: isToken ? 'center' : 'flex-start' }}
              >
                <span className="truncate">{info?.name ?? (v.kind === 'token' ? 'Token' : '')}</span>
              </div>
              {/* art crop */}
              <div
                style={{
                  height: artH,
                  background: img && !isWalker ? `#0b0f17 url(${img}) ${-ART.x * bgW}px ${-ART.y * bgH}px / ${bgW}px auto no-repeat` : '#1e293b',
                  borderRadius: isToken ? '0 0 6px 6px' : '0 0 3px 3px',
                }}
              >
                {isWalker && img && <img src={img} alt="" className="h-full w-full object-cover object-top" draggable={false} />}
              </div>
            </div>
          </div>
        );
      })}

      {v.attacking && <AttackChevron down={!mine} />}
      {v.blocking && <BlockShield />}

      {count > 1 && (
        <span
          className="absolute z-20 rounded bg-black/85 px-1.5 font-bold text-white ring-1 ring-slate-500"
          style={{ left: -4, top: -14, fontSize: Math.max(12, ptFs - 1) }}
        >
          x{count}
        </span>
      )}

      {/* bottom-center P/T plate (like Arena) */}
      {isCreature && v.p !== undefined && v.t !== undefined && (
        <span
          className={`absolute z-20 rounded-md border px-2 font-extrabold shadow ${
            v.damage ? 'border-red-400 bg-red-950/90 text-red-300' : 'border-slate-500 bg-slate-950/90 text-white'
          }`}
          style={{ fontSize: ptFs, lineHeight: `${ptFs + 5}px`, left: '50%', bottom: tapped ? undefined : -8, top: tapped ? wrapH - 16 : undefined, transform: 'translateX(-50%)', marginLeft: ((layers - 1) * offset) / 2 + (tapped ? (H - width) / 2 : 0) }}
        >
          {v.p}/{v.t - (v.damage ?? 0)}
        </span>
      )}

      {/* bottom-left badges: loyalty, counters */}
      <div className="absolute z-20 flex gap-0.5" style={{ left: 2, bottom: -8, fontSize: Math.max(10, ptFs - 2) }}>
        {v.loyalty !== undefined && (
          <span className="rounded-md border border-amber-400 bg-slate-950/90 px-1.5 font-extrabold text-amber-300">◆{v.loyalty}</span>
        )}
        {v.counters &&
          Object.entries(v.counters).map(([t, n]) => (
            <span
              key={t}
              title={`${n} × ${counterName(t)}`}
              className="flex min-w-[1.4em] items-center justify-center rounded-full border border-emerald-300 bg-emerald-800 px-1 font-bold text-white"
            >
              {n}
            </span>
          ))}
      </div>
    </div>
  );
}

/** Flame-shaped chevron over an attacker, pointing at the defending player (like Arena). */
function AttackChevron({ down }: { down: boolean }) {
  return (
    <svg
      viewBox="0 0 100 34"
      preserveAspectRatio="none"
      className="flame pointer-events-none absolute left-0 z-10 w-full"
      style={{ height: 44, [down ? 'bottom' : 'top']: -38, filter: 'drop-shadow(0 0 8px rgba(255,110,30,.9))', transform: down ? 'scaleY(-1)' : undefined }}
    >
      <defs>
        <linearGradient id="flameGrad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ff4d12" stopOpacity="0.95" />
          <stop offset="0.55" stopColor="#ff9a3c" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffe29a" stopOpacity="0" />
        </linearGradient>
        <filter id="flameBlur" x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      <path d="M-4 34 L50 0 L104 34 L74 34 L50 18 L26 34 Z" fill="#ff5a14" opacity="0.95" filter="url(#flameBlur)" />
      <path d="M2 34 L50 4 L98 34 L78 34 L50 17 L22 34 Z" fill="url(#flameGrad)" />
    </svg>
  );
}

/** Small shield on a blocker. */
function BlockShield() {
  return (
    <span
      className="pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 rounded-full border border-sky-200 bg-sky-600 px-1.5 text-[11px] font-bold leading-4 text-white shadow"
      style={{ top: -9 }}
    >
      🛡
    </span>
  );
}
