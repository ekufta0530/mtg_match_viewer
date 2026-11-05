import crypto from 'node:crypto';
import { collectGrpIds, parseHistory, type RawHistory, type ReplayDTO } from '@mmv/shared';
import { getAbilities, getCards, ingestDeck } from './cards';
import { logGet, logSet } from './db';
import { fetchDeck, fetchHistory, gamesForEvent, listEvents, listGames } from './seventeenlands';

const memo = new Map<string, ReplayDTO>();

export async function loadRaw(historyPath: string): Promise<RawHistory> {
  const cached = logGet(historyPath) as RawHistory | undefined;
  if (cached) return cached;
  const raw = (await fetchHistory(historyPath)) as RawHistory;
  if (!raw?.events) throw new Error(`No events in history for ${historyPath}`);
  logSet(historyPath, raw);
  return raw;
}

export function importRaw(json: unknown): string {
  const h = crypto.createHash('sha1').update(JSON.stringify(json)).digest('hex').slice(0, 16);
  const p = `import/${h}`;
  logSet(p, json);
  memo.delete(p);
  return p;
}

export async function buildReplay(historyPath: string, eventId?: string): Promise<ReplayDTO> {
  const key = `${historyPath}|${eventId ?? ''}`;
  const hit = memo.get(key);
  if (hit) return hit;

  const raw = await loadRaw(historyPath);
  const replay = parseHistory(raw, historyPath);

  const ids = collectGrpIds(replay);
  // attach the game's event/deck when we can find it
  try {
    const games = listGames();
    const game = games.find((g) => g.historyPath === historyPath);
    if (game) {
      replay.meta.eventName = game.eventName;
      replay.meta.gameTime = game.gameTime;
      if (game.won !== undefined && replay.meta.won === undefined) replay.meta.won = game.won;
    }
    const events = listEvents();
    const ev =
      (eventId && events.find((e) => e.id === eventId)) ||
      (game &&
        events.find((e) => gamesForEvent(e, [game]).length > 0));
    if (ev) {
      const d = await fetchDeck(ev.id);
      if (d) {
        await ingestDeck(d.rawCards);
        replay.deck = d.deck;
        for (const c of [...d.deck.main, ...d.deck.side]) ids.cards.push(c.grpId);
      }
    }
  } catch (e) {
    console.warn('deck/event lookup failed:', (e as Error).message);
  }

  let complete = true;
  try {
    replay.cards = await getCards([...new Set(ids.cards)]);
    replay.abilities = await getAbilities([...new Set(ids.abilities)]);
  } catch (e) {
    // still return the board; cards without metadata render as text placeholders
    complete = false;
    replay.warning = (e as Error).message;
  }
  if (complete) memo.set(key, replay);
  return replay;
}
