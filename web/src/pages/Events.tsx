import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type EventRow, type SyncStatus } from '../api';
import { ManaPips } from '../components/ManaPips';

export default function EventsPage() {
  const [events, setEvents] = useState<EventRow[]>();
  const [error, setError] = useState<string>();
  const [f, setF] = useState({ set: '', format: '', account: '', since: '' });
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [sync, setSync] = useState<SyncStatus>();
  const load = () => api.events().then(setEvents).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  // poll the background sync; reload the list whenever it finishes
  useEffect(() => {
    let live = true;
    let was = '';
    const tick = async () => {
      const st = await api.syncStatus().catch(() => undefined);
      if (!live || !st) return;
      setSync(st);
      const key = st.running ? st.phase : 'idle';
      if (was && key !== was) load();
      was = key;
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const opts = useMemo(() => {
    const uniq = (k: 'expansion' | 'format' | 'account') => [...new Set((events ?? []).map((e) => e[k]))].sort();
    return { set: uniq('expansion'), format: uniq('format'), account: uniq('account') };
  }, [events]);

  const rows = (events ?? []).filter(
    (e) =>
      (!f.set || e.expansion === f.set) &&
      (!f.format || e.format === f.format) &&
      (!f.account || e.account === f.account) &&
      (!f.since || e.date >= f.since),
  );

  const sel = 'rounded-md bg-slate-800 px-2 py-1 text-sm';
  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold">Arena Replay Viewer</h1>
        <span className="text-sm text-slate-500">Events</span>
        <div className="ml-auto flex gap-2">
          <button
            className={`${sel} hover:bg-slate-700 disabled:opacity-50`}
            disabled={sync?.running}
            onClick={() => api.sync().then(setSync)}
            title="Pull new events/games from 17Lands and archive them locally"
          >
            {sync?.running ? `Syncing ${sync.phase}… ${sync.total ? `${sync.done}/${sync.total}` : ''}` : '↻ Sync from 17Lands'}
          </button>
          <button className={`${sel} hover:bg-slate-700`} onClick={() => fileRef.current?.click()}>
            Import log JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                nav(`/replay/${await api.importLog(file)}`);
              } catch (err) {
                alert((err as Error).message);
              }
            }}
          />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <select className={sel} value={f.set} onChange={(e) => setF({ ...f, set: e.target.value })}>
          <option value="">All sets</option>
          {opts.set.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <select className={sel} value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}>
          <option value="">All formats</option>
          {opts.format.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <select className={sel} value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })}>
          <option value="">All accounts</option>
          {opts.account.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <input type="date" className={sel} value={f.since} onChange={(e) => setF({ ...f, since: e.target.value })} title="Since" />
      </div>

      {sync?.error && <div className="mb-2 text-xs text-amber-300">Last sync: {sync.error}</div>}
      {error && <div className="text-red-400">{error}</div>}
      {!events && !error && <div className="text-slate-400">Loading…</div>}
      {events && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="py-2">Date</th>
              <th>Event</th>
              <th>Set</th>
              <th>Colors</th>
              <th>Record</th>
              <th>Games</th>
              <th>Account</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-t border-slate-800 hover:bg-slate-900">
                <td className="py-2 text-slate-400">{e.date.slice(0, 10)}</td>
                <td>
                  <Link className="font-medium text-sky-300 hover:underline" to={`/event/${e.id}`}>
                    {e.name}
                  </Link>
                </td>
                <td>{e.expansion}</td>
                <td>
                  <ManaPips colors={e.colors} />
                </td>
                <td>
                  <span className="text-emerald-400">{e.wins}</span>–<span className="text-red-400">{e.losses}</span>
                </td>
                <td className="text-slate-400">{e.gameCount || ''}</td>
                <td className="text-slate-500">{e.account}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
