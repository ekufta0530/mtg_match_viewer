import type { GameEvent, ReplayDTO } from './types';

export interface DrawRow {
  order: number;
  /** per-player turn the card was seen (0 = opening hand) */
  ptn: number;
  kind: 'Opening' | 'Draw' | 'Extra' | 'Mill';
  grp: number;
  cardId: number;
  src?: number;
  land: boolean;
  /** this card was bottomed/mulliganed away at the start */
  bottomed?: boolean;
}

export interface LandDropRow {
  ptn: number;
  played: boolean;
  grp?: number;
  /** a land was available in hand at the end of the turn but none was played */
  missed: boolean;
  /** no land available to play */
  noLand: boolean;
}

export interface SeenStats {
  seen: number;
  lands: number;
  deckSize: number;
  deckLands: number;
  /** expected lands among `seen` cards */
  expected: number;
  /** P(X >= observed) */
  pAtLeast: number;
  /** P(X <= observed) */
  pAtMost: number;
  assumed: boolean;
}

export function myEvents(r: ReplayDTO): GameEvent[] {
  return r.events.filter((e) => e.seat === r.meta.mySeat);
}

export function drawTable(r: ReplayDTO): DrawRow[] {
  const rows: DrawRow[] = [];
  const bottomed = new Set(r.events.filter((e) => e.kind === 'Bottom' && e.seat === r.meta.mySeat).map((e) => e.cardId));
  const seenIds = new Set<number>();
  for (const e of myEvents(r)) {
    if (e.kind === 'Mulligan') {
      // the earlier deal was shuffled back; only the kept hand counts as seen
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].kind === 'Opening') rows.splice(i, 1);
      continue;
    }
    let kind: DrawRow['kind'] | undefined;
    if (e.kind === 'OpeningHand') kind = 'Opening';
    else if (e.kind === 'Draw') kind = 'Draw';
    else if (e.kind === 'DrawExtra') kind = 'Extra';
    else if (e.kind === 'Mill') kind = 'Mill';
    if (!kind || e.cardId === undefined) continue;
    if (kind === 'Opening') {
      // a mulligan re-deals; only keep the latest opening hand's row for each card
      if (seenIds.has(e.cardId)) continue;
    }
    seenIds.add(e.cardId);
    const row: DrawRow = {
      order: 0,
      ptn: kind === 'Opening' ? 0 : e.ptn,
      kind,
      grp: e.grp,
      cardId: e.cardId,
      src: e.src,
      land: !!e.land,
      bottomed: bottomed.has(e.cardId) || undefined,
    };
    rows.push(row);
  }
  rows.forEach((x, i) => (x.order = i + 1));
  return rows;
}

/** Per own-turn land drop analysis. */
export function landDrops(r: ReplayDTO): LandDropRow[] {
  const me = r.meta.mySeat;
  const out: LandDropRow[] = [];
  const myTurns = new Map<number, number>(); // global turn -> ptn
  for (const s of r.snapshots) if (s.activeSeat === me && s.turn > 0) myTurns.set(s.turn, s.ptn);
  for (const [gt, ptn] of myTurns) {
    const play = r.events.find((e) => e.kind === 'PlayLand' && e.seat === me && e.turn === gt);
    // last snapshot of that turn
    let last = -1;
    for (let i = 0; i < r.snapshots.length; i++) if (r.snapshots[i].turn === gt) last = i;
    const snap = r.snapshots[last];
    const landInHand = snap
      ? snap.players[me].hand.some((vi) => r.views[vi].types?.includes('Land'))
      : false;
    out.push({
      ptn,
      played: !!play,
      grp: play?.grp,
      missed: !play && landInHand,
      noLand: !play && !landInHand,
    });
  }
  return out;
}

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

export function hypergeomPmf(N: number, K: number, n: number, k: number): number {
  const lp = logChoose(K, k) + logChoose(N - K, n - k) - logChoose(N, n);
  return Number.isFinite(lp) ? Math.exp(lp) : 0;
}

export function seenStats(r: ReplayDTO, deckSize = 40, deckLands = 17): SeenStats {
  const rows = drawTable(r);
  const seen = rows.length;
  const lands = rows.filter((x) => x.land).length;
  let atLeast = 0;
  let atMost = 0;
  for (let k = 0; k <= Math.min(seen, deckLands); k++) {
    const p = hypergeomPmf(deckSize, deckLands, seen, k);
    if (k >= lands) atLeast += p;
    if (k <= lands) atMost += p;
  }
  return {
    seen,
    lands,
    deckSize,
    deckLands,
    expected: (seen * deckLands) / deckSize,
    pAtLeast: Math.min(1, atLeast),
    pAtMost: Math.min(1, atMost),
    assumed: !r.deck,
  };
}

/** Land / size counts of the deck, falling back to 17/40. */
export function deckLandCount(r: ReplayDTO): { size: number; lands: number } {
  if (!r.deck) return { size: r.meta.libraryStart[r.meta.mySeat] ?? 40, lands: 17 };
  let size = 0;
  let lands = 0;
  for (const c of r.deck.main) {
    size += c.count;
    if (r.cards[c.grpId]?.isLand || /land/i.test(c.types ?? '')) lands += c.count;
  }
  return { size, lands };
}
