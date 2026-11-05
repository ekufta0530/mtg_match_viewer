import type { CardInfo, DeckInfo, EventDetailDTO, EventSummary, ReplayDTO } from '@mmv/shared';

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error ?? res.statusText);
  return res.json();
}

export interface SyncStatus {
  running: boolean;
  phase: string;
  done: number;
  total: number;
  error?: string;
  lastFinished?: string;
}

export type EventRow = EventSummary & { gameCount: number };
export type EventDetail = EventDetailDTO & { cards: Record<number, CardInfo>; deck?: DeckInfo };

export const api = {
  events: () => get<EventRow[]>('/api/events'),
  sync: async () => (await fetch('/api/sync', { method: 'POST' })).json() as Promise<SyncStatus>,
  syncStatus: () => get<SyncStatus>('/api/sync'),
  event: (id: string) => get<EventDetail>(`/api/events/${id}`),
  replay: (path: string, event?: string) => get<ReplayDTO>(`/api/replay/${path}${event ? `?event=${event}` : ''}`),
  async importLog(file: File): Promise<string> {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/import', { method: 'POST', body: fd });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error ?? 'import failed');
    return j.historyPath as string;
  },
};
