import { imageFor } from './cards';
import { logHas } from './db';
import { buildReplay } from './replay';
import { listGames, syncLists } from './seventeenlands';

export interface SyncStatus {
  running: boolean;
  phase: string;
  done: number;
  total: number;
  error?: string;
  lastFinished?: string;
}

export const status: SyncStatus = { running: false, phase: 'idle', done: 0, total: 0 };

/** Pull the event/game lists, then archive anything not yet stored: log, deck, card data and art. */
export async function runSync(): Promise<void> {
  if (status.running) return;
  Object.assign(status, { running: true, phase: 'lists', done: 0, total: 0, error: undefined });
  try {
    await syncLists();
    const todo = listGames().filter((g) => !logHas(g.historyPath));
    Object.assign(status, { phase: 'games', total: todo.length });
    for (const g of todo) {
      try {
        const r = await buildReplay(g.historyPath);
        const grps = Object.keys(r.cards).map(Number);
        for (let i = 0; i < grps.length; i += 6) {
          await Promise.all(grps.slice(i, i + 6).map((id) => imageFor(id, 'front').catch(() => null)));
        }
      } catch (e) {
        status.error = (e as Error).message;
        if (/403/.test(status.error)) break; // blocked: stop instead of extending it
      }
      status.done++;
    }
    status.lastFinished = new Date().toISOString();
  } catch (e) {
    status.error = (e as Error).message;
  } finally {
    status.running = false;
    status.phase = 'idle';
  }
}
