import { useMemo } from 'react';
import { useReplay } from '../store';
import { whereLabel } from '../lib';

const STRIP: { key: string; label: string; match: (phase?: string, step?: string) => boolean }[] = [
  { key: 'untap', label: 'Untap', match: (p, s) => p === 'Beginning' && (!s || s === 'Untap') },
  { key: 'upkeep', label: 'Upkeep', match: (_p, s) => s === 'Upkeep' },
  { key: 'draw', label: 'Draw', match: (_p, s) => s === 'Draw' },
  { key: 'main1', label: 'Main 1', match: (p) => p === 'Main1' },
  { key: 'combat', label: 'Combat', match: (p) => p === 'Combat' },
  { key: 'main2', label: 'Main 2', match: (p) => p === 'Main2' },
  { key: 'end', label: 'End', match: (p) => p === 'Ending' },
];

export function TurnTracker() {
  const replay = useReplay((s) => s.replay)!;
  const cur = useReplay((s) => s.cur);
  const gran = useReplay((s) => s.gran);
  const { goTo, step, turn, setGran } = useReplay.getState();
  const snap = replay.snapshots[cur];
  const mine = snap.activeSeat === replay.meta.mySeat;

  const chips = useMemo(() => {
    const out: { idx: number; turn: number; ptn: number; seat: number }[] = [];
    for (const s of replay.snapshots) if (s.turnStart) out.push({ idx: s.idx, turn: s.turn, ptn: s.ptn, seat: s.activeSeat });
    return out;
  }, [replay]);
  const curChip = [...chips].reverse().find((c) => c.idx <= cur);

  const btn = 'rounded-md bg-slate-800 px-2.5 py-1 text-sm hover:bg-slate-700 active:bg-slate-600';

  return (
    <div className="border-t border-slate-800 bg-slate-950 px-4 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-lg font-extrabold tracking-wide">
          {snap.turn === 0 ? (
            'PRE-GAME'
          ) : (
            <>
              TURN {snap.ptn} · <span className={mine ? 'text-sky-400' : 'text-rose-400'}>{mine ? 'YOU' : 'OPPONENT'}</span> ·{' '}
              <span className="text-amber-300">{whereLabel(snap.phase, snap.step).toUpperCase()}</span>
            </>
          )}
        </div>
        <div className="flex gap-1">
          {STRIP.map((p) => {
            const lit = snap.turn > 0 && p.match(snap.phase, snap.step);
            return (
              <span
                key={p.key}
                className={`rounded px-2 py-0.5 text-[11px] font-semibold ${lit ? 'bg-amber-400 text-slate-900' : 'bg-slate-800 text-slate-500'}`}
              >
                {p.label}
              </span>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button className={btn} onClick={() => turn(-1)} title="Shift+←">
            ◀◀ turn
          </button>
          <button className={btn} onClick={() => step(-1)} title="←">
            ◀ step
          </button>
          <span className="w-16 text-center text-xs text-slate-500">
            {cur + 1}/{replay.snapshots.length}
          </span>
          <button className={btn} onClick={() => step(1)} title="→">
            step ▶
          </button>
          <button className={btn} onClick={() => turn(1)} title="Shift+→">
            turn ▶▶
          </button>
          <select
            value={gran}
            onChange={(e) => setGran(e.target.value as 'meaningful' | 'all' | 'phase')}
            className="ml-2 rounded-md bg-slate-800 px-2 py-1 text-xs"
            title="Step granularity"
          >
            <option value="meaningful">Meaningful events</option>
            <option value="all">Every state change</option>
            <option value="phase">Per phase</option>
          </select>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {chips.map((c) => {
          const m = c.seat === replay.meta.mySeat;
          const active = curChip?.idx === c.idx;
          return (
            <button
              key={c.idx}
              onClick={() => goTo(c.idx)}
              title={`${c.turn === 0 ? 'Pre-game' : `Turn ${c.ptn} (${m ? 'you' : 'opponent'})`}`}
              className={`h-6 min-w-6 rounded px-1.5 text-xs font-bold ${
                m ? 'bg-sky-700 hover:bg-sky-600' : 'bg-rose-800 hover:bg-rose-700'
              } ${active ? 'ring-2 ring-amber-300' : 'opacity-80'}`}
            >
              {c.turn === 0 ? '0' : c.ptn}
            </button>
          );
        })}
      </div>
    </div>
  );
}
