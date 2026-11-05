import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CACHE_DIR = path.join(root, 'cache');
export const IMG_DIR = path.join(CACHE_DIR, 'images');
fs.mkdirSync(IMG_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(CACHE_DIR, 'cache.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, ts INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS logs (path TEXT PRIMARY KEY, data BLOB NOT NULL, ts INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS cards (grp_id INTEGER PRIMARY KEY, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS abilities (id INTEGER PRIMARY KEY, text TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, date TEXT NOT NULL, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS games (history_path TEXT PRIMARY KEY, game_time TEXT NOT NULL, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS scry (grp_id INTEGER PRIMARY KEY, json TEXT NOT NULL);
`);

export function kvGet<T>(key: string, maxAgeMs = Infinity): T | undefined {
  const row = db.prepare('SELECT value, ts FROM kv WHERE key = ?').get(key) as { value: string; ts: number } | undefined;
  if (!row) return undefined;
  if (Date.now() - row.ts > maxAgeMs) return undefined;
  return JSON.parse(row.value) as T;
}

export function kvSet(key: string, value: unknown) {
  db.prepare('INSERT OR REPLACE INTO kv (key, value, ts) VALUES (?, ?, ?)').run(key, JSON.stringify(value), Date.now());
}

export function logGet(p: string): unknown | undefined {
  const row = db.prepare('SELECT data FROM logs WHERE path = ?').get(p) as { data: Uint8Array } | undefined;
  if (!row) return undefined;
  return JSON.parse(zlib.gunzipSync(row.data).toString('utf8'));
}

export function logSet(p: string, json: unknown) {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(json)));
  db.prepare('INSERT OR REPLACE INTO logs (path, data, ts) VALUES (?, ?, ?)').run(p, gz, Date.now());
}

export function logHas(p: string): boolean {
  return !!db.prepare('SELECT 1 FROM logs WHERE path = ?').get(p);
}
