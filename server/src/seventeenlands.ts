import { db, kvGet, kvSet } from './db';
import type { DeckCard, DeckInfo, EventSummary, GameSummary } from '@mmv/shared';

const BASE = 'https://www.17lands.com';
const UA = 'mtg-match-viewer/0.1 (local personal tool)';

export function token(): string {
  const t = process.env.SEVENTEENLANDS_TOKEN;
  if (!t) throw new Error('SEVENTEENLANDS_TOKEN is not set (use the *public share* token from 17lands.com/account)');
  return t;
}

// 17Lands sits behind a WAF that 403s bursts of requests, so every call goes through one slow lane.
const MIN_GAP_MS = 2000;
let lane: Promise<unknown> = Promise.resolve();
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = lane.then(fn);
  lane = run.then(
    () => new Promise((r) => setTimeout(r, MIN_GAP_MS)),
    () => new Promise((r) => setTimeout(r, MIN_GAP_MS)),
  );
  return run;
}

export async function fetchJson<T = any>(url: string, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await throttled(async () => {
        const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
        if (res.status === 403) throw new Blocked();
        if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url.replace(/[0-9a-f]{32}$/, '<token>')}`);
        return (await res.json()) as T;
      });
    } catch (e) {
      lastErr = e;
      if (e instanceof Blocked) break; // retrying a 403 only extends the block
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

class Blocked extends Error {
  constructor() {
    super('17Lands returned 403 (rate-limited by their firewall). Wait a few minutes; cached games still work, or use Import log JSON.');
  }
}

// Events and games are archived in SQLite. Reads never touch the network; syncLists() pulls new rows.
// (17Lands' game list only holds the latest 100 games, so the archive is what keeps older ones.)

export function listEvents(): EventSummary[] {
  const rows = db.prepare('SELECT json FROM events ORDER BY date DESC').all() as { json: string }[];
  return rows.map((r) => JSON.parse(r.json));
}

export function listGames(): GameSummary[] {
  const rows = db.prepare('SELECT json FROM games ORDER BY game_time DESC').all() as { json: string }[];
  return rows.map((r) => JSON.parse(r.json));
}

export async function syncLists(): Promise<{ events: number; games: number }> {
  const d = await fetchJson<{ drafts: any[] }>(`${BASE}/user/data/${token()}`);
  const upEvent = db.prepare('INSERT OR REPLACE INTO events (id, date, json) VALUES (?, ?, ?)');
  for (const x of d.drafts) {
    const date = x.first_pick_time ?? x.first_event_server_time ?? '';
    const ev: EventSummary = {
      id: x.id,
      name: x.dated_event_name,
      format: x.format,
      expansion: x.expansion,
      colors: x.colors ?? '',
      wins: x.wins ?? 0,
      losses: x.losses ?? 0,
      account: x.account ?? '',
      date,
      deckCount: x.deck_count ?? 0,
      hasPicks: !!x.has_picks,
      // used for matching games to events
      ...({ _start: date, _end: x.last_event_server_time } as object),
    };
    upEvent.run(ev.id, date, JSON.stringify(ev));
  }
  const g = await fetchJson<{ games: any[] }>(`${BASE}/data/user_game_list/${token()}`);
  const upGame = db.prepare('INSERT OR REPLACE INTO games (history_path, game_time, json) VALUES (?, ?, ?)');
  for (const x of g.games) {
    const m = /game_replay\/(\d+)\/([0-9a-f]+)\/(\d+)/.exec(x.link) ?? [];
    const game: GameSummary = {
      historyPath: `${m[1]}/${m[2]}`,
      gameIndex: Number(m[3] ?? 0),
      eventName: x.event_name,
      gameTime: x.game_time,
      onPlay: !!x.on_play,
      turns: x.turns,
      won: !!x.won,
      account: x.account_name ?? '',
    };
    upGame.run(game.historyPath, game.gameTime, JSON.stringify(game));
  }
  return { events: d.drafts.length, games: g.games.length };
}

/** Games belonging to an event: same event name, played within the event's time window. */
export function gamesForEvent(ev: EventSummary & { _start?: string; _end?: string }, games: GameSummary[]): GameSummary[] {
  const start = (ev._start ?? ev.date).slice(0, 16);
  const end = (ev._end ?? '9999').slice(0, 16);
  return games
    .filter((g) => g.eventName === ev.name && g.gameTime.slice(0, 16) >= start.slice(0, 16) && g.gameTime.slice(0, 16) <= end)
    .sort((a, b) => a.gameTime.localeCompare(b.gameTime));
}

export async function fetchHistory(historyPath: string): Promise<any> {
  return fetchJson(`${BASE}/data/history?history_path=${encodeURIComponent(historyPath).replace('%2F', '/')}`);
}

export async function fetchCards(ids: number[]): Promise<any[]> {
  if (!ids.length) return [];
  const d = await fetchJson<{ cards: any[] }>(`${BASE}/data/cards?ids=${ids.join(',')}`);
  return d.cards ?? [];
}

export async function fetchAbilities(ids: number[]): Promise<{ id: number; text: string }[]> {
  if (!ids.length) return [];
  const d = await fetchJson<{ abilities: { id: number; text: string }[] }>(`${BASE}/data/abilities?ids=${ids.join(',')}`);
  return d.abilities ?? [];
}

export async function fetchDeck(draftId: string, deckIndex?: number): Promise<{ deck: DeckInfo; rawCards: Record<string, any> } | undefined> {
  const key = `deck:${draftId}:${deckIndex ?? 'latest'}`;
  const cached = kvGet<{ deck: DeckInfo; rawCards: Record<string, any> }>(key);
  if (cached) return cached;
  let idx = deckIndex;
  if (idx === undefined) {
    const first = await fetchJson<any>(`${BASE}/api/deck/draft/?draft_id=${draftId}&deck_index=0`);
    const links: string[] = first.data?.event_info?.deck_links ?? [];
    idx = Math.max(0, links.length - 1);
    if (idx === 0) return store(key, first, 0);
  }
  const d = await fetchJson<any>(`${BASE}/api/deck/draft/?draft_id=${draftId}&deck_index=${idx}`);
  return store(key, d, idx);
}

function store(key: string, d: any, idx: number) {
  const data = d.data;
  if (!data?.groups) return undefined;
  const group = (name: string): DeckCard[] => {
    const g = data.groups.find((x: any) => x.name === name);
    const counts = new Map<number, number>();
    for (const id of g?.cards ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts].map(([grpId, count]) => {
      const c = data.cards[String(grpId)] ?? {};
      return { grpId, count, name: c.name ?? String(grpId), cmc: c.cmc, manaCost: c.mana_cost, types: (c.types ?? []).join(' // ') };
    });
  };
  const out = { deck: { main: group('Maindeck'), side: group('Sideboard'), deckIndex: idx } as DeckInfo, rawCards: data.cards };
  kvSet(key, out);
  return out;
}
