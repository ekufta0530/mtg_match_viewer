import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import { getCards, imageFor, ingestDeck } from './cards';
import { buildReplay, importRaw } from './replay';
import { fetchDeck, gamesForEvent, listEvents, listGames } from './seventeenlands';
import { runSync, status as syncStatus } from './sync';
import type { EventDetailDTO } from '@mmv/shared';

const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 64 * 1024 * 1024 });
await app.register(multipart, { limits: { fileSize: 64 * 1024 * 1024 } });

app.setErrorHandler((err: Error, _req, reply) => {
  app.log.error(err);
  reply.code(500).send({ error: err.message });
});

app.get('/api/health', async () => ({ ok: true }));

app.get('/api/sync', async () => syncStatus);
app.post('/api/sync', async () => {
  void runSync();
  return syncStatus;
});

app.get('/api/events', async () => {
  const events = listEvents();
  const games = listGames();
  return events.map((e) => ({ ...e, gameCount: gamesForEvent(e as any, games).length }));
});

app.get('/api/events/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const events = listEvents();
  const ev = events.find((e) => e.id === id);
  if (!ev) return reply.code(404).send({ error: 'event not found' });
  const games = gamesForEvent(ev as any, listGames());
  let deck;
  try {
    const d = await fetchDeck(id);
    if (d) {
      await ingestDeck(d.rawCards);
      deck = d.deck;
    }
  } catch (e) {
    app.log.warn(`deck fetch failed: ${(e as Error).message}`);
  }
  const cards = deck ? await getCards([...deck.main, ...deck.side].map((c) => c.grpId)) : {};
  return { event: ev, games, deck, cards } satisfies EventDetailDTO & { cards: unknown };
});

app.get('/api/replay/:date/:hash', async (req) => {
  const { date, hash } = req.params as { date: string; hash: string };
  const { event } = req.query as { event?: string };
  return buildReplay(`${date}/${hash}`, event);
});

app.post('/api/import', async (req, reply) => {
  let json: unknown;
  if (req.isMultipart()) {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'no file' });
    json = JSON.parse((await file.toBuffer()).toString('utf8'));
  } else json = req.body;
  if (!json || typeof json !== 'object' || !Array.isArray((json as any).events)) {
    return reply.code(400).send({ error: 'expected a 17Lands history JSON ({seat_id, events[]})' });
  }
  return { historyPath: importRaw(json) };
});

app.get('/api/cards/:grpId', async (req) => {
  const id = Number((req.params as any).grpId);
  return (await getCards([id]))[id] ?? null;
});

app.get('/img/:grpId', async (req, reply) => {
  const id = Number((req.params as any).grpId);
  const face = (req.query as any).face === 'back' ? 'back' : 'front';
  const file = await imageFor(id, face);
  if (!file) return reply.code(404).send();
  reply.header('Cache-Control', 'public, max-age=31536000, immutable').type('image/webp');
  return reply.send(fs.createReadStream(file));
});

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '127.0.0.1' });
void runSync(); // archive anything new in the background; the UI reads from SQLite either way
console.log(`API listening on http://127.0.0.1:${port}`);
