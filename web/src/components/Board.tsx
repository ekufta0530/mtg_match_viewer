import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CardView, Snapshot } from '@mmv/shared';
import { BoardCard, CardImg } from './Card';
import { LAND_W, PERM_W, Permanent } from './Permanent';
import { fmtText } from '../lib';
import { useReplay } from '../store';

type Kind = 'land' | 'creature' | 'walker' | 'other';

/** Where a permanent lives on the board. Planeswalker wins over Creature (animated walkers stay put). */
function kindOf(v: CardView): Kind {
  const t = v.types ?? [];
  if (t.includes('Planeswalker')) return 'walker';
  if (t.includes('Creature')) return 'creature';
  if (t.includes('Land')) return 'land';
  return 'other'; // artifacts, enchantments, battles, tokens without a type...
}

interface Group {
  v: CardView;
  count: number;
  ids: number[];
}

/** Collapse identical permanents (same card, same visible state) into fan stacks, like Arena does. */
function group(views: CardView[]): Group[] {
  const map = new Map<string, Group>();
  const out: Group[] = [];
  for (const v of views) {
    const key = [v.grpId, v.kind, v.p, v.t, v.tapped ? 1 : 0, v.attacking ? 1 : 0, v.blocking ? 1 : 0, v.damage ?? 0, JSON.stringify(v.counters ?? {}), v.loyalty ?? '', JSON.stringify(v.blocks ?? []), v.attackTarget ?? ''].join('|');
    const g = map.get(key);
    if (g) {
      g.count++;
      g.ids.push(v.id);
    } else {
      const ng = { v, count: 1, ids: [v.id] };
      map.set(key, ng);
      out.push(ng);
    }
  }
  return out;
}

function Row({ groups, width, flashIds, justify, padRight = 0 }: { groups: Group[]; width: number; flashIds: Set<number>; justify: string; padRight?: number }) {
  return (
    <div className={`flex flex-wrap items-end gap-x-3 gap-y-5 px-2 pb-3 pt-3 ${justify}`} style={{ minHeight: Math.round(width * 0.72), paddingRight: padRight || undefined }}>
      {groups.map((g) => (
        <Permanent key={g.v.id} ids={g.ids} v={g.v} width={width} count={g.count} flash={g.ids.some((id) => flashIds.has(id))} />
      ))}
    </div>
  );
}

/** Lands on the left, artifacts/enchantments/etc. on the right, on the same level. */
function LandRow({ lands, other, flashIds }: { lands: Group[]; other: Group[]; flashIds: Set<number> }) {
  return (
    <div className="flex items-end justify-between gap-6" style={{ minHeight: Math.round(LAND_W * 0.72) }}>
      <div className="flex min-w-0 flex-1 flex-wrap items-end gap-x-3 gap-y-5 px-2 pb-3 pt-3">
        {lands.map((g) => (
          <Permanent key={g.v.id} ids={g.ids} v={g.v} width={LAND_W} count={g.count} flash={g.ids.some((id) => flashIds.has(id))} />
        ))}
      </div>
      <div className="flex min-w-0 flex-wrap items-end justify-end gap-x-3 gap-y-5 px-2 pb-3 pt-3">
        {other.map((g) => (
          <Permanent key={g.v.id} ids={g.ids} v={g.v} width={LAND_W + 12} count={g.count} flash={g.ids.some((id) => flashIds.has(id))} />
        ))}
      </div>
    </div>
  );
}

const WALKER_DROP = 40; // how far planeswalkers sit off the creature level

/**
 * Creature row (centered) with planeswalkers pinned to the right, a step below the creatures
 * (towards the player's own lands; mirrored for the opponent). The creature row reserves the
 * walkers' width so the two never collide.
 */
function CreatureBand({ creatures, walkers, flashIds, mine }: { creatures: Group[]; walkers: Group[]; flashIds: Set<number>; mine: boolean }) {
  const walkerW = walkers.length * (PERM_W + 16) + 8;
  return (
    <div className="relative" style={mine ? { marginBottom: walkers.length ? WALKER_DROP : 0 } : { marginTop: walkers.length ? WALKER_DROP : 0 }}>
      <Row groups={creatures} width={PERM_W} flashIds={flashIds} justify="justify-center" padRight={walkerW * (walkers.length ? 1 : 0)} />
      {walkers.length > 0 && (
        <div className="absolute right-2 flex gap-4" style={{ top: mine ? WALKER_DROP : -WALKER_DROP }}>
          {walkers.map((g) => (
            <Permanent key={g.v.id} ids={g.ids} v={g.v} width={PERM_W} count={g.count} flash={g.ids.some((id) => flashIds.has(id))} />
          ))}
        </div>
      )}
    </div>
  );
}

function Pile({ label, views, back, onClick }: { label: string; views: CardView[]; back?: boolean; onClick?: () => void }) {
  const setHover = useReplay((s) => s.setHover);
  const top = views[views.length - 1];
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      title={label}
      className="relative w-[46px] shrink-0 text-left"
      onMouseEnter={() => top && !back && setHover({ grp: top.grpId, view: top })}
      onMouseLeave={() => setHover(undefined)}
    >
      {views.length > 1 && <div className="absolute left-[3px] top-[3px] h-full w-full rounded-[5%] bg-slate-800 ring-1 ring-black/60" />}
      {top || back ? <CardImg grp={top?.grpId ?? 0} back={back || !top?.grpId} className="relative ring-1 ring-black/70" /> : <div className="aspect-[5/7] w-full rounded-[5%] border border-dashed border-slate-600/70" />}
      <span className="absolute -bottom-1 -right-1 rounded-full bg-black/85 px-1.5 text-[11px] font-bold ring-1 ring-slate-500">{views.length}</span>
      <span className="pointer-events-none absolute -top-3.5 left-0 text-[9px] font-semibold uppercase tracking-wider text-slate-300/80">{label}</span>
    </button>
  );
}

function Avatar({ life, me, active }: { life: number | undefined; me: boolean; active: boolean }) {
  const ring = me ? '#38bdf8' : '#fb7185';
  return (
    <div
      className="relative flex h-[68px] w-[68px] items-center justify-center rounded-full"
      style={{
        background: 'radial-gradient(circle at 50% 35%, #374151, #111827 70%)',
        border: `3px solid ${active ? '#fbbf24' : '#64748b'}`,
        boxShadow: active ? `0 0 22px 4px rgba(251,191,36,.55), 0 0 0 3px ${ring}55` : `0 0 0 3px ${ring}44`,
      }}
    >
      <span className="text-[28px] font-extrabold leading-none text-white drop-shadow">{life ?? '–'}</span>
      <span className="absolute -bottom-2 rounded-full px-2 text-[9px] font-bold uppercase tracking-wider text-slate-900" style={{ background: ring }}>
        {me ? 'You' : 'Opp'}
      </span>
    </div>
  );
}

function PlayerStrip({ seat, snap, me }: { seat: number; snap: Snapshot; me: boolean }) {
  const replay = useReplay((s) => s.replay)!;
  const setDrawer = useReplay((s) => s.setDrawer);
  const z = snap.players[seat];
  const gy = z.graveyard.map((i) => replay.views[i]);
  const ex = z.exile.map((i) => replay.views[i]);
  const lib = Array.from({ length: Math.min(z.libraryCount, 1) }, () => ({}) as CardView);
  const piles = (
    <div className="flex items-end gap-4 px-2 pt-4">
      <Pile label="Lib" views={Array.from({ length: Math.min(z.libraryCount, 3) }, () => lib[0])} back />
      <Pile label="GY" views={gy} onClick={() => setDrawer({ seat, zone: 'graveyard' })} />
      <Pile label="Exile" views={ex} onClick={() => setDrawer({ seat, zone: 'exile' })} />
    </div>
  );
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center px-3">
      {me ? piles : <div className="text-xs text-slate-300/80">Hand <b>{z.hand.length}</b> · Library <b>{z.libraryCount}</b></div>}
      <Avatar life={snap.life[seat]} me={me} active={snap.activeSeat === seat} />
      <div className={me ? 'text-right text-xs text-slate-300/80' : 'flex justify-end'}>
        {me ? (
          <>
            Library <b>{z.libraryCount}</b> · GY <b>{z.graveyard.length}</b>
          </>
        ) : (
          piles
        )}
      </div>
    </div>
  );
}

interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: 'block' | 'target';
}

/**
 * Arena-style combat lines: a glowing curve from each blocker to the attacker it blocks, and from an
 * attacker to the planeswalker it targets. Endpoints are read from the rendered cards (data-cids),
 * so it keeps working through the auto-fit scaling.
 */
function CombatLines({ root, views, tick }: { root: React.RefObject<HTMLDivElement | null>; views: CardView[]; tick: number }) {
  const [lines, setLines] = useState<Line[]>([]);
  const key = views.map((v) => `${v.id}:${(v.blocks ?? []).join('.')}:${v.attackTarget ?? ''}`).join('|');

  const measure = useCallback(() => {
    const r = root.current;
    if (!r) return;
    const box = r.getBoundingClientRect();
    const rects = new Map<number, DOMRect>();
    r.querySelectorAll<HTMLElement>('[data-cids]').forEach((el) => {
      const rc = el.getBoundingClientRect();
      for (const id of (el.dataset.cids ?? '').split(',')) rects.set(Number(id), rc);
    });
    const out: Line[] = [];
    const link = (fromId: number, toId: number, kind: Line['kind']) => {
      const a = rects.get(fromId);
      const b = rects.get(toId);
      if (!a || !b || a === b) return;
      const ax = a.left + a.width / 2 - box.left;
      const bx = b.left + b.width / 2 - box.left;
      const aBelow = a.top + a.height / 2 > b.top + b.height / 2;
      out.push({
        x1: ax,
        y1: (aBelow ? a.top : a.bottom) - box.top,
        x2: bx,
        y2: (aBelow ? b.bottom : b.top) - box.top,
        kind,
      });
    };
    for (const v of views) {
      for (const atk of v.blocks ?? []) link(v.id, atk, 'block');
      if (v.attackTarget) link(v.id, v.attackTarget, 'target');
    }
    setLines((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
  }, [root, views]);

  useLayoutEffect(() => {
    measure();
    const t = setTimeout(measure, 380); // after cards finish their enter animation / fit scaling settles
    return () => clearTimeout(t);
  }, [measure, key, tick]);

  if (!lines.length) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 z-30 h-full w-full overflow-visible">
      <defs>
        {(['block', 'target'] as const).map((k) => (
          <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 Z" fill={k === 'block' ? '#7dd3fc' : '#fdba74'} />
          </marker>
        ))}
      </defs>
      {lines.map((l, i) => {
        const my = (l.y1 + l.y2) / 2;
        const d = `M ${l.x1} ${l.y1} C ${l.x1} ${my}, ${l.x2} ${my}, ${l.x2} ${l.y2}`;
        const color = l.kind === 'block' ? '#38bdf8' : '#fb923c';
        return (
          <g key={i}>
            <path d={d} fill="none" stroke={color} strokeWidth={9} opacity={0.22} strokeLinecap="round" />
            <path d={d} className="combat-line" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" markerEnd={`url(#arrow-${l.kind})`} />
          </g>
        );
      })}
    </svg>
  );
}

const FIT_SCALES = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.45, 0.38, 0.32];

/**
 * Lays its children out at full size, and if they don't fit the available box, scales them down
 * (like Arena does when a board gets huge). Children are laid out at width W/scale so wrapping
 * still happens in the visible width.
 */
function FitBox({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const fit = useCallback(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const W = o.clientWidth;
    const H = o.clientHeight;
    if (!W || !H) return;
    let chosen = FIT_SCALES[FIT_SCALES.length - 1];
    for (const sc of FIT_SCALES) {
      i.style.width = `${W / sc}px`;
      i.style.height = 'auto';
      i.style.transform = `scale(${sc})`;
      if (i.scrollHeight * sc <= H + 1) {
        chosen = sc;
        break;
      }
    }
    i.style.width = `${W / chosen}px`;
    i.style.height = `${H / chosen}px`;
    i.style.transform = `scale(${chosen})`;
  }, []);
  useLayoutEffect(fit); // re-fit after every render (cards come and go)
  useEffect(() => {
    const ro = new ResizeObserver(fit);
    if (outer.current) ro.observe(outer.current);
    return () => ro.disconnect();
  }, [fit]);
  return (
    <div ref={outer} className="relative min-h-0 flex-1">
      <div ref={inner} className="absolute left-0 top-0 flex flex-col justify-between" style={{ transformOrigin: '0 0' }}>
        {children}
      </div>
    </div>
  );
}

export function Board() {
  const replay = useReplay((s) => s.replay)!;
  const cur = useReplay((s) => s.cur);
  const snap = replay.snapshots[cur];
  const { mySeat, oppSeat } = replay.meta;

  const flashIds = useMemo(() => {
    const ids = new Set<number>();
    for (const ei of snap.events) {
      const e = replay.events[ei];
      if (e.cardId !== undefined && e.kind !== 'Life') ids.add(e.cardId);
    }
    return ids;
  }, [snap, replay]);

  const { mine, opp } = useMemo(() => {
    const bf = snap.battlefield.map((i) => replay.views[i]);
    const split = (seat: number) => {
      const owned = bf.filter((v) => v.controller === seat);
      const of = (k: Kind) => group(owned.filter((v) => kindOf(v) === k));
      return { lands: of('land'), creatures: of('creature'), walkers: of('walker'), other: of('other') };
    };
    return { mine: split(mySeat), opp: split(oppSeat) };
  }, [snap, replay, mySeat, oppSeat]);

  const root = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(() => setTick((t) => t + 1));
    if (root.current) ro.observe(root.current);
    return () => ro.disconnect();
  }, []);
  const combatViews = useMemo(() => snap.battlefield.map((i) => replay.views[i]).filter((v) => v.blocks?.length || v.attackTarget), [snap, replay]);

  const myHand = snap.players[mySeat].hand.map((i) => replay.views[i]);
  const oppHandCount = snap.players[oppSeat].hand.length;
  const stack = snap.stack.map((i) => replay.views[i]);

  return (
    <div
      ref={root}
      className="relative flex h-full min-h-0 flex-col overflow-hidden"
      style={{ background: 'linear-gradient(rgba(6,9,15,.30), rgba(6,9,15,.45)), url(/board.jpg) center / cover no-repeat' }}
    >
      {/* opponent hand (card backs, tucked into the top edge) */}
      <div className="flex h-7 shrink-0 justify-center overflow-hidden">
        {Array.from({ length: oppHandCount }).map((_, i) => {
          const mid = (oppHandCount - 1) / 2;
          return (
            <div key={i} className="w-9 shrink-0" style={{ marginLeft: i ? -10 : 0, transform: `translateY(-8px) rotate(${(i - mid) * -2}deg)` }}>
              <CardImg grp={0} />
            </div>
          );
        })}
      </div>

      <PlayerStrip seat={oppSeat} snap={snap} me={false} />

      <div className="relative flex min-h-0 flex-1 flex-col px-2 py-2">
        {/* opponent: lands on the outer edge, creatures toward the middle */}
        <FitBox>
          <LandRow lands={opp.lands} other={opp.other} flashIds={flashIds} />
          <CreatureBand creatures={opp.creatures} walkers={opp.walkers} flashIds={flashIds} mine={false} />
        </FitBox>

        {stack.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-30 flex -translate-y-1/2 justify-center">
            <div className="pointer-events-auto flex w-fit max-w-full items-center gap-3 rounded-xl border border-amber-500/60 bg-slate-950/95 px-4 py-2 shadow-2xl">
              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Stack</span>
              {stack.map((v) => (
                <StackItem key={v.id} v={v} />
              ))}
            </div>
          </div>
        )}

        <div className="h-2 shrink-0" />
        <FitBox>
          <CreatureBand creatures={mine.creatures} walkers={mine.walkers} flashIds={flashIds} mine />
          <LandRow lands={mine.lands} other={mine.other} flashIds={flashIds} />
        </FitBox>
      </div>

      <CombatLines root={root} views={combatViews} tick={tick} />

      <PlayerStrip seat={mySeat} snap={snap} me />

      <Hand cards={myHand} flashIds={flashIds} />
    </div>
  );
}

const HAND_W = 150; // card width in the hand
const HAND_H = Math.round((HAND_W * 7) / 5);
const HAND_VISIBLE = 172; // how much of each card shows above the bottom edge (card is ~210 tall)
const HOVER_SCALE = 2.1;

/** Hand tucked into the bottom edge like Arena; hovering lifts a card and blows it up so its text is readable. */
function Hand({ cards, flashIds }: { cards: CardView[]; flashIds: Set<number> }) {
  const [hot, setHot] = useState<number | null>(null);
  const n = cards.length;
  const overlap = n > 9 ? -58 : n > 7 ? -40 : n > 5 ? -22 : -8;
  const mid = (n - 1) / 2;
  return (
    <div className="relative z-40 flex shrink-0 items-start justify-center" style={{ height: HAND_VISIBLE }} onMouseLeave={() => setHot(null)}>
      {cards.map((v, i) => {
        const off = i - mid;
        const isHot = hot === i;
        // keep the zoomed card on screen: bias the origin towards the centre for the outer cards
        const originX = n < 3 ? 50 : Math.round(50 + (off / Math.max(1, mid)) * -35);
        return (
          <div
            key={v.id}
            className={`card-enter relative shrink-0 ${flashIds.has(v.id) && !isHot ? 'card-flash rounded-md' : ''}`}
            style={{
              width: HAND_W,
              height: HAND_H,
              marginLeft: i === 0 ? 0 : overlap,
              zIndex: isHot ? 60 : i,
              transformOrigin: `${isHot ? originX : 50}% ${isHot ? 100 : 120}%`,
              transform: isHot
                ? `translateY(${-(HAND_H - HAND_VISIBLE)}px) scale(${HOVER_SCALE})`
                : `translateY(${Math.abs(off) ** 2 * 1.4}px) rotate(${off * 2}deg)`,
              transition: 'transform .14s ease-out',
              filter: isHot ? 'drop-shadow(0 10px 24px rgba(0,0,0,.8))' : undefined,
            }}
            onMouseEnter={() => setHot(i)}
          >
            <CardImg grp={v.grpId} className="ring-1 ring-black/60" />
            {!isHot && v.types?.includes('Land') && <span className="absolute left-1 top-8 rounded bg-emerald-800/90 px-1 text-[9px] font-bold">LAND</span>}
          </div>
        );
      })}
    </div>
  );
}

function StackItem({ v }: { v: CardView }) {
  const replay = useReplay((s) => s.replay)!;
  const setHover = useReplay((s) => s.setHover);
  if (v.kind === 'ability') {
    const src = replay.cards[v.srcGrp ?? 0];
    const text = replay.abilities[v.grpId];
    return (
      <div
        className="max-w-[220px] rounded-lg border border-amber-600/60 bg-amber-950/60 p-2 text-xs"
        onMouseEnter={() => setHover({ grp: v.srcGrp ?? 0, view: v })}
        onMouseLeave={() => setHover(undefined)}
      >
        <div className="font-semibold text-amber-300">⚡ {src?.name ?? 'Ability'}</div>
        <div className="mt-0.5 text-slate-300">{text ? fmtText(text, src?.name) : '(ability)'}</div>
      </div>
    );
  }
  return <BoardCard v={v} width={96} />;
}
