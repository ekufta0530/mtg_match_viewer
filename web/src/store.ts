import { create } from 'zustand';
import type { CardView, ReplayDTO, Snapshot } from '@mmv/shared';

export type Granularity = 'meaningful' | 'all' | 'phase';
export type Tab = 'log' | 'draws' | 'yards';

interface State {
  replay?: ReplayDTO;
  cur: number;
  gran: Granularity;
  tab: Tab;
  hover?: { grp: number; view?: CardView };
  drawer?: { seat: number; zone: 'graveyard' | 'exile' };
  load: (r: ReplayDTO) => void;
  goTo: (i: number) => void;
  step: (dir: 1 | -1) => void;
  turn: (dir: 1 | -1) => void;
  setGran: (g: Granularity) => void;
  setTab: (t: Tab) => void;
  setHover: (h?: State['hover']) => void;
  setDrawer: (d?: State['drawer']) => void;
}

const stops = (snaps: Snapshot[], g: Granularity) => (i: number) => {
  const s = snaps[i];
  if (i === 0 || i === snaps.length - 1) return true;
  if (g === 'all') return true;
  if (g === 'phase') return s.phaseStart;
  return s.events.length > 0 || s.turnStart;
};

export const useReplay = create<State>((set, get) => ({
  cur: 0,
  gran: 'meaningful',
  tab: 'log',
  load: (r) => set({ replay: r, cur: 0, hover: undefined, drawer: undefined }),
  goTo: (i) => {
    const r = get().replay;
    if (!r) return;
    set({ cur: Math.max(0, Math.min(r.snapshots.length - 1, i)) });
  },
  step: (dir) => {
    const { replay: r, cur, gran } = get();
    if (!r) return;
    const ok = stops(r.snapshots, gran);
    for (let i = cur + dir; i >= 0 && i < r.snapshots.length; i += dir) {
      if (ok(i)) return set({ cur: i });
    }
  },
  turn: (dir) => {
    const { replay: r, cur } = get();
    if (!r) return;
    const snaps = r.snapshots;
    if (dir === 1) {
      for (let i = cur + 1; i < snaps.length; i++) if (snaps[i].turnStart) return set({ cur: i });
      return set({ cur: snaps.length - 1 });
    }
    let start = cur;
    while (start > 0 && !snaps[start].turnStart) start--;
    if (start !== cur) return set({ cur: start });
    for (let i = cur - 1; i >= 0; i--) if (snaps[i].turnStart) return set({ cur: i });
    set({ cur: 0 });
  },
  setGran: (gran) => set({ gran }),
  setTab: (tab) => set({ tab }),
  setHover: (hover) => set({ hover }),
  setDrawer: (drawer) => set({ drawer }),
}));

export const useSnap = () => useReplay((s) => s.replay?.snapshots[s.cur]);
