import { useEffect, useMemo, useRef } from 'react';
import { deckLandCount, drawTable, landDrops, seenStats, type GameEvent, type ReplayDTO } from '@mmv/shared';
import { CardImg } from './Card';
import { cardName, describe, NOISY, whereLabel } from '../lib';
import { useReplay, type Tab } from '../store';

export function Sidebar() {
  const tab = useReplay((s) => s.tab);
  const setTab = useReplay((s) => s.setTab);
  const tabs: [Tab, string][] = [
    ['log', 'Event log'],
    ['draws', 'Draws & lands'],
    ['yards', 'Graveyards'],
  ];
  return (
    <aside className="flex h-full min-h-0 w-[380px] shrink-0 flex-col border-l border-slate-800 bg-slate-950">
      <div className="flex border-b border-slate-800">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 px-2 py-2 text-sm font-semibold ${tab === k ? 'border-b-2 border-amber-400 text-amber-300' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {tab === 'log' && <EventLog />}
        {tab === 'draws' && <DrawsAndLands />}
        {tab === 'yards' && <Graveyards />}
      </div>
    </aside>
  );
}

function EventLog() {
  const replay = useReplay((s) => s.replay)!;
  const cur = useReplay((s) => s.cur);
  const goTo = useReplay((s) => s.goTo);
  const showNoise = useRef(false);
  const activeRef = useRef<HTMLButtonElement>(null);

  const turns = useMemo(() => {
    const groups: { turn: number; ptn: number; seat: number; events: GameEvent[] }[] = [];
    for (const e of replay.events) {
      if (NOISY.has(e.kind) && !(e.kind === 'Ability' && e.seat === replay.meta.mySeat)) {
        if (e.kind !== 'OpeningHand' || e.seat !== replay.meta.mySeat) continue;
      }
      if (e.kind === 'Counters') continue;
      let g = groups[groups.length - 1];
      if (!g || g.turn !== e.turn) {
        g = { turn: e.turn, ptn: e.ptn, seat: e.activeSeat, events: [] };
        groups.push(g);
      }
      g.events.push(e);
    }
    return groups;
  }, [replay]);
  void showNoise;

  // event which is the latest at or before the cursor
  const activeEvent = useMemo(() => {
    let a = -1;
    for (const g of turns) for (const e of g.events) if (e.snap <= cur) a = e.idx;
    return a;
  }, [turns, cur]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeEvent]);

  return (
    <div className="p-2 text-sm">
      {turns.map((g, gi) => {
        const mine = g.seat === replay.meta.mySeat;
        return (
          <div key={gi} className="mb-2">
            <div className={`sticky top-0 z-10 bg-slate-950 py-1 text-xs font-bold uppercase tracking-wider ${mine ? 'text-sky-400' : 'text-rose-400'}`}>
              {g.turn === 0 ? 'Pre-game' : `Turn ${g.ptn} · ${mine ? 'You' : 'Opponent'}`}
            </div>
            {g.events.map((e) => {
              const isActive = e.idx === activeEvent;
              const faded = e.snap > cur;
              return (
                <button
                  key={e.idx}
                  ref={isActive ? activeRef : undefined}
                  onClick={() => goTo(e.snap)}
                  className={`flex w-full gap-2 rounded px-1.5 py-0.5 text-left hover:bg-slate-800 ${isActive ? 'bg-amber-400/15 ring-1 ring-amber-400/50' : ''} ${faded ? 'opacity-50' : ''}`}
                >
                  <span className="w-20 shrink-0 text-[10px] leading-5 text-slate-500">{whereLabel(e.phase, e.step)}</span>
                  <span className={e.seat === replay.meta.mySeat ? 'text-sky-100' : 'text-rose-100'}>{describe(e, replay)}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

const KIND_COLOR: Record<string, string> = {
  Opening: 'bg-slate-700',
  Draw: 'bg-sky-800',
  Extra: 'bg-violet-800',
  Mill: 'bg-rose-900',
};

function Pct({ v }: { v: number }) {
  return <>{(v * 100).toFixed(v < 0.1 ? 1 : 0)}%</>;
}

function DrawsAndLands() {
  const replay = useReplay((s) => s.replay)!;
  const cur = useReplay((s) => s.cur);
  const goTo = useReplay((s) => s.goTo);
  const rows = useMemo(() => drawTable(replay), [replay]);
  const drops = useMemo(() => landDrops(replay), [replay]);
  const dl = useMemo(() => deckLandCount(replay), [replay]);
  const stats = useMemo(() => seenStats(replay, dl.size, dl.lands), [replay, dl]);
  const mulls = replay.meta.mulligans[replay.meta.mySeat] ?? 0;

  const verdict =
    stats.pAtLeast < 0.1 ? 'flooded' : stats.pAtMost < 0.1 ? 'screwed' : 'about normal';

  // where notable cards are right now
  const snap = replay.snapshots[cur];
  const me = replay.meta.mySeat;
  const notable = useMemo(() => {
    if (!replay.deck) return [];
    return replay.deck.main.filter((c) => ['rare', 'mythic'].includes(replay.cards[c.grpId]?.rarity ?? ''));
  }, [replay]);
  const where = (grp: number): string[] => {
    const z = snap.players[me];
    const v = (arr: number[]) => arr.filter((i) => replay.views[i].grpId === grp).length;
    const bf = snap.battlefield.filter((i) => replay.views[i].grpId === grp && replay.views[i].controller === me).length;
    const out: string[] = [];
    if (v(z.hand)) out.push(`hand ×${v(z.hand)}`);
    if (bf) out.push(`battlefield ×${bf}`);
    if (v(z.graveyard)) out.push(`graveyard ×${v(z.graveyard)}`);
    if (v(z.exile)) out.push(`exile ×${v(z.exile)}`);
    return out;
  };

  return (
    <div className="space-y-4 p-3 text-sm">
      <section className="rounded-lg bg-slate-900 p-3">
        <div className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Lands seen</div>
        <div className="text-2xl font-extrabold">
          {stats.lands} <span className="text-base font-medium text-slate-400">lands in {stats.seen} cards seen</span>
        </div>
        <div className="mt-1 text-slate-300">
          Expected {stats.expected.toFixed(1)} ({stats.deckLands} lands in {stats.deckSize}
          {stats.assumed ? ', assumed' : ''}). P(≥ {stats.lands}) = <Pct v={stats.pAtLeast} />, P(≤ {stats.lands}) = <Pct v={stats.pAtMost} />{' '}
          — <b className={verdict === 'about normal' ? 'text-slate-300' : 'text-amber-300'}>{verdict}</b>.
        </div>
        <div className="mt-1 text-xs text-slate-500">
          {mulls ? `${mulls} mulligan${mulls > 1 ? 's' : ''}. ` : 'No mulligan. '}
          {replay.meta.onPlay ? 'On the play.' : 'On the draw.'}
        </div>
      </section>

      <section>
        <div className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Land drops</div>
        <div className="flex flex-wrap gap-1">
          {drops.map((d) => (
            <span
              key={d.ptn}
              title={d.played ? `Played ${cardName(replay, d.grp ?? 0)}` : d.missed ? 'Had a land in hand but did not play it' : 'No land to play'}
              className={`flex h-9 w-9 flex-col items-center justify-center rounded text-[10px] font-bold ${
                d.played ? 'bg-emerald-800' : d.missed ? 'bg-red-700' : 'bg-amber-700'
              }`}
            >
              <span className="opacity-70">T{d.ptn}</span>
              <span>{d.played ? '✓' : d.missed ? 'miss' : 'none'}</span>
            </span>
          ))}
        </div>
        <div className="mt-1 text-xs text-slate-500">
          <span className="text-emerald-400">✓</span> played · <span className="text-red-400">miss</span> land in hand unplayed ·{' '}
          <span className="text-amber-400">none</span> no land available
        </div>
      </section>

      <section>
        <div className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Draw order ({rows.length})</div>
        <table className="w-full text-xs">
          <tbody>
            {rows.map((r) => {
              const e = replay.events.find((x) => x.cardId === r.cardId && x.seat === me);
              return (
                <tr key={r.order} className="cursor-pointer hover:bg-slate-800" onClick={() => e && goTo(e.snap)}>
                  <td className="w-6 py-0.5 text-slate-500">{r.order}</td>
                  <td className="w-10">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${KIND_COLOR[r.kind]}`}>{r.kind === 'Opening' ? 'open' : `T${r.ptn}`}</span>
                  </td>
                  <td className={r.land ? 'text-emerald-300' : ''}>
                    {cardName(replay, r.grp)}
                    {r.bottomed ? ' ↓' : ''}
                    {r.kind === 'Extra' || r.kind === 'Mill' ? (
                      <span className="text-slate-500">
                        {' '}
                        — {r.kind === 'Mill' ? 'milled' : 'drawn'}
                        {r.src ? ` by ${cardName(replay, r.src)}` : ''}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {notable.length > 0 && (
        <section>
          <div className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">Rares & mythics (at this step)</div>
          <ul className="space-y-0.5 text-xs">
            {notable.map((c) => {
              const w = where(c.grpId);
              return (
                <li key={c.grpId} className="flex justify-between gap-2">
                  <span>
                    {c.count > 1 ? `${c.count}× ` : ''}
                    {c.name}
                  </span>
                  <span className={w.length ? 'text-emerald-300' : 'text-slate-500'}>{w.length ? w.join(', ') : 'library / not seen'}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function arrivalTurn(replay: ReplayDTO, cardId: number, zone: string, cur: number): string {
  let found: GameEvent | undefined;
  for (const e of replay.events) if (e.cardId === cardId && e.to === zone && e.snap <= cur) found = e;
  return found ? (found.turn === 0 ? 'pre' : `T${found.ptn}`) : '';
}

export function ZoneList({ seat, zone }: { seat: number; zone: 'graveyard' | 'exile' }) {
  const replay = useReplay((s) => s.replay)!;
  const cur = useReplay((s) => s.cur);
  const setHover = useReplay((s) => s.setHover);
  const snap = replay.snapshots[cur];
  const cards = snap.players[seat][zone].map((i) => replay.views[i]);
  if (!cards.length) return <div className="text-xs text-slate-500">empty</div>;
  return (
    <div className="grid grid-cols-4 gap-2">
      {cards.map((v) => (
        <div
          key={v.id}
          className="relative"
          onMouseEnter={() => setHover({ grp: v.grpId, view: v })}
          onMouseLeave={() => setHover(undefined)}
        >
          <CardImg grp={v.grpId} />
          <span className="absolute bottom-0.5 right-0.5 rounded bg-black/80 px-1 text-[10px] text-slate-200">
            {arrivalTurn(replay, v.id, zone, cur)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Graveyards() {
  const replay = useReplay((s) => s.replay)!;
  const { mySeat, oppSeat } = replay.meta;
  return (
    <div className="space-y-4 p-3">
      {[
        [mySeat, 'Your graveyard', 'text-sky-400'],
        [oppSeat, "Opponent's graveyard", 'text-rose-400'],
      ].map(([seat, label, cls]) => (
        <section key={seat as number}>
          <div className={`mb-1 text-xs font-bold uppercase tracking-wider ${cls}`}>{label}</div>
          <ZoneList seat={seat as number} zone="graveyard" />
        </section>
      ))}
      <div className="text-[11px] text-slate-500">Ordered oldest → newest; badge = turn it arrived.</div>
    </div>
  );
}
