import fs from 'node:fs';
import path from 'node:path';
import { db, IMG_DIR } from './db';
import { fetchAbilities, fetchCards, fetchJson } from './seventeenlands';
import type { CardInfo } from '@mmv/shared';

type Stored = Omit<CardInfo, 'img' | 'backImg'> & { imageUrl?: string; backImageUrl?: string };

function readCard(grp: number): Stored | undefined {
  const row = db.prepare('SELECT json FROM cards WHERE grp_id = ?').get(grp) as { json: string } | undefined;
  return row ? (JSON.parse(row.json) as Stored) : undefined;
}

function writeCard(c: Stored) {
  db.prepare('INSERT OR REPLACE INTO cards (grp_id, json) VALUES (?, ?)').run(c.grpId, JSON.stringify(c));
}

function toInfo(s: Stored): CardInfo {
  const { imageUrl: _a, backImageUrl, ...rest } = s;
  return { ...rest, img: `/img/${s.grpId}`, backImg: backImageUrl ? `/img/${s.grpId}?face=back` : undefined };
}

/** Learn mana cost / cmc from a deck listing (cards are fetched first so their abilities are cached). */
export async function ingestDeck(raw: Record<string, any>) {
  await getCards(Object.keys(raw).map(Number));
  for (const [k, v] of Object.entries(raw)) {
    const cur = readCard(Number(k));
    if (cur && (cur.manaCost === undefined || cur.cmc === undefined)) {
      writeCard({ ...cur, manaCost: v.mana_cost, cmc: v.cmc, imageUrl: cur.imageUrl || v.image_url });
    }
  }
}

export async function getCards(ids: number[]): Promise<Record<number, CardInfo>> {
  const out: Record<number, CardInfo> = {};
  const missing: number[] = [];
  for (const id of ids) {
    const c = readCard(id);
    if (c) out[id] = toInfo(c);
    else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += 80) {
    const chunk = missing.slice(i, i + 80);
    const fetched = await fetchCards(chunk);
    for (const c of fetched) {
      const s: Stored = {
        grpId: c.id,
        name: c.name,
        types: c.types ?? [],
        rarity: c.rarity ?? '',
        layout: c.layout ?? 'standard',
        abilities: c.abilities ?? {},
        isLand: (c.types ?? []).some((t: string) => /Land/.test(t)),
        imageUrl: c.image_url || undefined,
        backImageUrl: c.back_image_url || undefined,
      };
      writeCard(s);
      out[s.grpId] = toInfo(s);
    }
  }
  return out;
}

export async function getAbilities(ids: number[]): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  const missing: number[] = [];
  for (const id of ids) {
    const row = db.prepare('SELECT text FROM abilities WHERE id = ?').get(id) as { text: string } | undefined;
    if (row) out[id] = row.text;
    else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += 100) {
    for (const a of await fetchAbilities(missing.slice(i, i + 100))) {
      db.prepare('INSERT OR REPLACE INTO abilities (id, text) VALUES (?, ?)').run(a.id, a.text);
      out[a.id] = a.text;
    }
  }
  return out;
}

// ---- images ----

let scryChain: Promise<unknown> = Promise.resolve();
/** Scryfall asks for <= 10 req/s; serialize with 120ms spacing. */
function scryFetch<T>(url: string): Promise<T | null> {
  const run = scryChain.then(async () => {
    await new Promise((r) => setTimeout(r, 120));
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'mtg-match-viewer/0.1', Accept: 'application/json' } });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  });
  scryChain = run.catch(() => undefined);
  return run as Promise<T | null>;
}

async function download(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'mtg-match-viewer/0.1' } });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500) return false;
    fs.writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  }
}

const inflight = new Map<string, Promise<string | null>>();

/**
 * Resolve an image file for a card. Chain:
 *  17Lands image_url (it ships with every card, and works for brand-new sets) →
 *  Scryfall by Arena id → Scryfall by exact name.
 * (Scryfall has no arena_id for many fresh cards, so it is the slow path.)
 */
export function imageFor(grp: number, face: 'front' | 'back'): Promise<string | null> {
  const key = `${grp}:${face}`;
  let p = inflight.get(key);
  if (!p) {
    p = resolveImage(grp, face).finally(() => setTimeout(() => inflight.delete(key), 1000));
    inflight.set(key, p);
  }
  return p;
}

async function resolveImage(grp: number, face: 'front' | 'back'): Promise<string | null> {
  const dest = path.join(IMG_DIR, `${grp}${face === 'back' ? '_back' : ''}.img`);
  if (fs.existsSync(dest)) return dest;
  let card = readCard(grp);
  if (!card) {
    await getCards([grp]);
    card = readCard(grp);
  }
  const direct = face === 'back' ? card?.backImageUrl : card?.imageUrl;
  if (direct && (await download(direct, dest))) return dest;

  const cachedScry = db.prepare('SELECT json FROM scry WHERE grp_id = ?').get(grp) as { json: string } | undefined;
  let sc: any = cachedScry ? JSON.parse(cachedScry.json) : undefined;
  if (sc === undefined) {
    sc = await scryFetch<any>(`https://api.scryfall.com/cards/arena/${grp}`);
    if (!sc && card?.name) sc = await scryFetch<any>(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(card.name)}`);
    db.prepare('INSERT OR REPLACE INTO scry (grp_id, json) VALUES (?, ?)').run(grp, JSON.stringify(sc ?? null));
  }
  if (!sc) return null;
  const faces: any[] = sc.card_faces ?? [];
  const uris = face === 'back' ? faces[1]?.image_uris : (sc.image_uris ?? faces[0]?.image_uris);
  const url = uris?.normal ?? uris?.large ?? uris?.small;
  if (url && (await download(url, dest))) return dest;
  return null;
}

export { fetchJson };
