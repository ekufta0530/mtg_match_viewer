import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Board } from '../components/Board';
import { Preview } from '../components/Card';
import { Sidebar, ZoneList } from '../components/Sidebar';
import { TurnTracker } from '../components/TurnTracker';
import { useReplay } from '../store';

function Drawer() {
  const drawer = useReplay((s) => s.drawer);
  const setDrawer = useReplay((s) => s.setDrawer);
  const replay = useReplay((s) => s.replay);
  if (!drawer || !replay) return null;
  const mine = drawer.seat === replay.meta.mySeat;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setDrawer(undefined)}>
      <div className="max-h-[80vh] w-[720px] overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 p-4 scroll-thin" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {mine ? 'Your' : "Opponent's"} {drawer.zone}
          </h2>
          <button className="rounded bg-slate-800 px-2 py-1 text-sm" onClick={() => setDrawer(undefined)}>
            ✕
          </button>
        </div>
        <ZoneList seat={drawer.seat} zone={drawer.zone} />
      </div>
    </div>
  );
}

export default function ReplayPage() {
  const { date, hash } = useParams();
  const [sp] = useSearchParams();
  const eventId = sp.get('event') ?? undefined;
  const replay = useReplay((s) => s.replay);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const path = `${date}/${hash}`;

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(undefined);
    api
      .replay(path, eventId)
      .then((r) => live && (useReplay.getState().load(r), setLoading(false)))
      .catch((e) => live && (setError(String(e.message ?? e)), setLoading(false)));
    return () => {
      live = false;
    };
  }, [path, eventId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
      const st = useReplay.getState();
      if (e.key === 'ArrowRight') (e.shiftKey ? st.turn(1) : st.step(1), e.preventDefault());
      else if (e.key === 'ArrowLeft') (e.shiftKey ? st.turn(-1) : st.step(-1), e.preventDefault());
      else if (e.key === 'Home') (st.goTo(0), e.preventDefault());
      else if (e.key === 'End') (st.goTo(Number.MAX_SAFE_INTEGER), e.preventDefault());
      else if (e.key === 'Escape') st.setDrawer(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (loading) return <div className="p-8 text-slate-400">Loading replay… (first load fetches the log and card art)</div>;
  if (error || !replay) return <div className="p-8 text-red-400">Failed to load replay: {error}</div>;

  const m = replay.meta;
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-slate-800 bg-slate-950 px-4 py-2 text-sm">
        <Link to={eventId ? `/event/${eventId}` : '/'} className="text-slate-400 hover:text-slate-200">
          ← Back
        </Link>
        <span className="font-semibold">{m.eventName ?? 'Imported game'}</span>
        <span className="text-slate-400">{m.gameTime}</span>
        <span className="text-slate-400">{m.onPlay ? 'On the play' : 'On the draw'}</span>
        {m.won !== undefined && (
          <span className={`rounded px-2 py-0.5 text-xs font-bold ${m.won ? 'bg-emerald-700' : 'bg-red-800'}`}>
            {m.won ? 'WIN' : 'LOSS'}
            {m.resultReason ? ` · ${m.resultReason}` : ''}
          </span>
        )}
        <span className="ml-auto text-xs text-slate-500">←/→ step · Shift+←/→ turn · Home/End</span>
      </header>
      {replay.warning && <div className="bg-amber-900/40 px-4 py-1 text-xs text-amber-200">Card art unavailable: {replay.warning}</div>}
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1">
          <Board />
        </main>
        <Sidebar />
      </div>
      <TurnTracker />
      <Preview />
      <Drawer />
    </div>
  );
}
