import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { seenStats, deckLandCount, type CardInfo, type DeckCard, type ReplayDTO } from '@mmv/shared';
import { api, type EventDetail } from '../api';
import { ManaPips } from '../components/ManaPips';

const TYPE_ORDER = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Battle', 'Land'];

function primaryType(c: DeckCard, info?: CardInfo): string {
  const t = c.types ?? info?.types?.[0] ?? '';
  return TYPE_ORDER.find((x) => t.includes(x)) ?? 'Other';
}

function DeckImg({ grp }: { grp: number }) {
  const [bad, setBad] = useState(false);
  return bad ? (
    <div className="aspect-[5/7] w-full rounded bg-slate-800" />
  ) : (
    <img src={`/img/${grp}`} loading="lazy" onError={() => setBad(true)} className="aspect-[5/7] w-full rounded-[5%] object-cover" />
  );
}

function DeckPanel({ d }: { d: EventDetail }) {
  const deck = d.deck!;
  const groups = useMemo(() => {
    const g = new Map<string, DeckCard[]>();
    for (const c of deck.main) {
      const k = primaryType(c, d.cards[c.grpId]);
      g.set(k, [...(g.get(k) ?? []), c]);
    }
    for (const list of g.values()) list.sort((a, b) => (a.cmc ?? 0) - (b.cmc ?? 0) || a.name.localeCompare(b.name));
    return [...g].sort((a, b) => TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0]) || 0);
  }, [deck, d.cards]);

  const lands = deck.main.filter((c) => primaryType(c, d.cards[c.grpId]) === 'Land');
  const landCount = lands.reduce((n, c) => n + c.count, 0);
  const sources: Record<string, number> = {};
  for (const c of lands) {
    const info = d.cards[c.grpId];
    const colors = new Set<string>();
    for (const txt of Object.values(info?.abilities ?? {})) {
      if (!/add/i.test(txt)) continue;
      for (const m of txt.matchAll(/\{o?([WUBRG])\}/g)) colors.add(m[1]);
    }
    for (const col of colors) sources[col] = (sources[col] ?? 0) + c.count;
  }
  const total = deck.main.reduce((n, c) => n + c.count, 0);

  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center gap-4">
        <h2 className="text-lg font-bold">Deck</h2>
        <span className="text-sm text-slate-400">
          {total} cards · {landCount} lands
        </span>
        <span className="flex items-center gap-1 text-xs text-slate-400">
          sources:{' '}
          {Object.entries(sources).map(([c, n]) => (
            <span key={c} className="inline-flex items-center gap-0.5">
              <ManaPips colors={c} />
              {n}
            </span>
          ))}
        </span>
        <span className="ml-auto text-xs text-slate-500">deck #{deck.deckIndex + 1}</span>
      </div>
      <div className="space-y-3">
        {groups.map(([type, cards]) => (
          <div key={type}>
            <div className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">
              {type} ({cards.reduce((n, c) => n + c.count, 0)})
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
              {cards.map((c) => (
                <div key={c.grpId} className="relative" title={c.name}>
                  <DeckImg grp={c.grpId} />
                  {c.count > 1 && <span className="absolute -right-1 -top-1 rounded-full bg-slate-900 px-1.5 text-xs font-bold ring-1 ring-slate-500">×{c.count}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-slate-400">Sideboard ({deck.side.reduce((n, c) => n + c.count, 0)})</summary>
        <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-2">
          {deck.side.map((c) => (
            <div key={c.grpId} className="relative" title={c.name}>
              <DeckImg grp={c.grpId} />
              {c.count > 1 && <span className="absolute -right-1 -top-1 rounded-full bg-slate-900 px-1.5 text-xs font-bold ring-1 ring-slate-500">×{c.count}</span>}
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

export default function EventDetailPage() {
  const { id } = useParams();
  const [d, setD] = useState<EventDetail>();
  const [error, setError] = useState<string>();
  const [replays, setReplays] = useState<Record<string, ReplayDTO>>({});

  useEffect(() => {
    setD(undefined);
    api.event(id!).then(setD).catch((e) => setError(e.message));
  }, [id]);

  // lazily pull stats for each game (sequential, small)
  useEffect(() => {
    if (!d) return;
    let live = true;
    (async () => {
      for (const g of d.games.slice(0, 20)) {
        if (!live) return;
        try {
          const r = await api.replay(g.historyPath, d.event.id);
          if (live) setReplays((x) => ({ ...x, [g.historyPath]: r }));
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [d]);

  if (error) return <div className="p-8 text-red-400">{error}</div>;
  if (!d) return <div className="p-8 text-slate-400">Loading…</div>;
  const e = d.event;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <Link to="/" className="text-sm text-slate-400 hover:text-slate-200">
        ← Events
      </Link>
      <div className="mb-6 mt-2 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-extrabold">{e.name}</h1>
        <ManaPips colors={e.colors} />
        <span className="text-lg">
          <span className="text-emerald-400">{e.wins}</span>–<span className="text-red-400">{e.losses}</span>
        </span>
        <span className="text-sm text-slate-500">{e.account}</span>
      </div>

      {d.deck ? <DeckPanel d={d} /> : <div className="mb-6 text-sm text-slate-500">No deck listing available for this event.</div>}

      <h2 className="mb-2 text-lg font-bold">Games</h2>
      {d.games.length === 0 && <div className="text-sm text-slate-500">No games found in the 17Lands game list for this event (the list only holds the most recent 100 games).</div>}
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th className="py-2">Date</th>
            <th>Play/Draw</th>
            <th>Turns</th>
            <th>Result</th>
            <th>Lands seen</th>
            <th>Mulligans</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {d.games.map((g) => {
            const r = replays[g.historyPath];
            let lands = '…';
            if (r) {
              const dl = deckLandCount(r);
              const s = seenStats(r, dl.size, dl.lands);
              lands = `${s.lands}/${s.seen} (${Math.round((100 * s.lands) / Math.max(1, s.seen))}%)`;
            }
            return (
              <tr key={g.historyPath} className="border-t border-slate-800 hover:bg-slate-900">
                <td className="py-2 text-slate-400">{g.gameTime}</td>
                <td>{g.onPlay ? 'Play' : 'Draw'}</td>
                <td>{g.turns}</td>
                <td className={g.won ? 'font-semibold text-emerald-400' : 'font-semibold text-red-400'}>{g.won ? 'Win' : 'Loss'}</td>
                <td className="text-slate-300">{lands}</td>
                <td className="text-slate-300">{r ? (r.meta.mulligans[r.meta.mySeat] ?? 0) : '…'}</td>
                <td className="text-right">
                  <Link className="rounded bg-sky-700 px-3 py-1 text-xs font-semibold hover:bg-sky-600" to={`/replay/${g.historyPath}?event=${e.id}`}>
                    Replay ▶
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
