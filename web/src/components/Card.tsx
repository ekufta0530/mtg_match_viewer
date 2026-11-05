import { useState } from 'react';
import type { CardView } from '@mmv/shared';
import { counterName, fmtText, infoLines } from '../lib';
import { useReplay } from '../store';

/** Card face image with text fallback; grp 0 or `back` renders a card back. */
export function CardImg({ grp, back, className = '' }: { grp: number; back?: boolean; className?: string }) {
  const info = useReplay((s) => s.replay?.cards[grp]);
  const [failed, setFailed] = useState(false);
  const base = `block aspect-[5/7] w-full rounded-[5%] ${className}`;
  if (back || !grp) return <div className={`${base} card-back`} />;
  if (failed || !info) {
    return (
      <div className={`${base} flex flex-col gap-1 border border-slate-600 bg-slate-800 p-1 text-[10px] leading-tight text-slate-200`}>
        <b>{info?.name ?? `#${grp}`}</b>
        <span className="text-slate-400">{info?.types?.[0]}</span>
      </div>
    );
  }
  return <img src={info.img} alt={info.name} loading="lazy" draggable={false} onError={() => setFailed(true)} className={`${base} object-cover shadow-md`} />;
}

export const CARD_W = 72; // board card width in px
export const CARD_H = Math.round((CARD_W * 7) / 5);

interface BoardCardProps {
  v: CardView;
  /** number of identical cards represented (land stacks) */
  count?: number;
  tappedCount?: number;
  flash?: boolean;
  width?: number;
  onClick?: () => void;
}

export function BoardCard({ v, count, tappedCount, flash, width = CARD_W, onClick }: BoardCardProps) {
  const setHover = useReplay((s) => s.setHover);
  const h = Math.round((width * 7) / 5);
  const tapped = count ? false : v.tapped;
  const extra = tapped ? (h - width) / 2 : 0;
  const layers = Math.min(count ?? 1, 3);
  const stackOffset = 5;
  return (
    <div
      className="relative shrink-0"
      style={{
        width: width + (layers - 1) * stackOffset,
        height: h,
        marginLeft: extra,
        marginRight: extra,
      }}
      onMouseEnter={() => setHover({ grp: v.kind === 'ability' ? v.srcGrp ?? 0 : v.grpId, view: v })}
      onMouseLeave={() => setHover(undefined)}
      onClick={onClick}
    >
      {Array.from({ length: layers }).map((_, i) => (
        <div
          key={i}
          className={`absolute top-0 ${i === layers - 1 ? 'card-enter' : ''} ${flash && i === layers - 1 ? 'card-flash' : ''} rounded-[5%]`}
          style={{
            left: i * stackOffset,
            width,
            transform: tapped ? 'rotate(90deg)' : undefined,
            transformOrigin: 'center',
            transition: 'transform .2s',
            opacity: v.sick && v.kind === 'card' && v.types?.includes('Creature') ? 0.92 : 1,
          }}
        >
          <CardImg grp={v.grpId || v.srcGrp || 0} />
        </div>
      ))}
      {v.attacking && <div className="pointer-events-none absolute -inset-0.5 rounded-md ring-2 ring-red-500" />}
      {v.blocking && <div className="pointer-events-none absolute -inset-0.5 rounded-md ring-2 ring-sky-400" />}
      {count && count > 1 && (
        <span className="absolute -top-1.5 -right-1.5 rounded-full bg-slate-900 px-1.5 text-xs font-bold ring-1 ring-slate-500">
          ×{count}
          {tappedCount ? <span className="ml-1 text-amber-400">{tappedCount}⟳</span> : null}
        </span>
      )}
      {!count && v.p !== undefined && v.t !== undefined && v.types?.includes('Creature') && (
        <span
          className={`absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[11px] font-bold ${v.damage ? 'text-red-400' : 'text-white'}`}
          style={tapped ? { transform: 'translate(-8px,8px)' } : undefined}
        >
          {v.p}/{v.t - (v.damage ?? 0)}
        </span>
      )}
      {v.loyalty !== undefined && (
        <span className="absolute bottom-1 left-1 rounded bg-black/80 px-1 text-[11px] font-bold text-amber-300">◆{v.loyalty}</span>
      )}
      {v.counters && (
        <span className="absolute left-0.5 top-0.5 flex flex-col gap-0.5">
          {Object.entries(v.counters).map(([t, n]) => (
            <span key={t} className="rounded bg-emerald-700/90 px-1 text-[10px] font-semibold text-white" title={counterName(t)}>
              {n}× {counterName(t)}
            </span>
          ))}
        </span>
      )}
      {v.kind === 'token' && <span className="absolute left-0.5 bottom-0.5 rounded bg-black/70 px-1 text-[9px] uppercase text-slate-300">token</span>}
    </div>
  );
}

/** Large hover preview with oracle-ish text. */
export function Preview() {
  const hover = useReplay((s) => s.hover);
  const replay = useReplay((s) => s.replay);
  if (!hover || !hover.grp || !replay) return null;
  const info = replay.cards[hover.grp];
  const v = hover.view;
  const abilityText = v?.kind === 'ability' && v.grpId ? replay.abilities[v.grpId] : undefined;
  return (
    <div className="pointer-events-none fixed left-4 top-14 z-40 w-[23rem] rounded-xl border border-slate-600 bg-slate-900/95 p-2 shadow-2xl">
      <CardImg grp={hover.grp} />
      <div className="mt-2 space-y-1 px-1 text-sm">
        <div className="text-sm font-semibold">{info?.name}</div>
        <div className="text-slate-400">{info?.types?.join(' / ')}</div>
        {abilityText && <div className="rounded bg-amber-500/10 p-1.5 text-amber-200">Ability: {fmtText(abilityText, info?.name)}</div>}
        {infoLines(info).map((t, i) => (
          <div key={i} className="text-slate-300">
            {t}
          </div>
        ))}
        {v?.p !== undefined && (
          <div className="text-slate-400">
            Now: {v.p}/{v.t}
            {v.damage ? ` (${v.damage} damage)` : ''}
          </div>
        )}
      </div>
    </div>
  );
}
