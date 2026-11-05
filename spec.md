# Arena Replay Viewer — Spec

A local web app that ingests 17Lands game logs and replays MTG Arena games as a readable board state: real card images in hand and on the battlefield, a clear turn/phase tracker, and draw/land stats. Built to replace the 17Lands replay view for game review.

Status: draft v0.1 · Owner: Eric · Runs locally (localhost), single user.

---

## 1. Goals

1. **Browse like 17Lands.** Events (drafts/sealed) → games in that event → replay. Same mental model as the 17Lands user page.
2. **See the board.** At any point in a game: my hand as card images, both battlefields (lands separated from nonlands), stack, graveyard, exile, library count, life totals.
3. **Know where I am.** A turn tracker that always says "Turn 6 · You · Main 1", with step forward/back by action, phase, or turn.
4. **Answer review questions fast.** Draw order, land drops, missed land drops, cards milled, lands seen vs expected — the questions that took raw-log parsing to answer for the 2026-10-29 Arena Direct game.

### Non-goals (v1)
- Hosting publicly or multi-user.
- Live in-game tracking (this reads finished games only).
- Full rules engine / perfect reconstruction of every hidden piece of info. Opponent hidden cards stay hidden.
- Draft pick review (already covered by the `mtg-draft-report` skill).

---

## 2. Data sources

### 2.1 17Lands (all requests made by the local backend, never the browser — avoids CORS and keeps the token server-side)

| Purpose | Endpoint | Notes |
|---|---|---|
| List events/drafts | `GET /user/data/{token}` | What the 17lands MCP `list_drafts` wraps. Returns id, format, expansion, colors, W/L, `dated_event_name`. |
| List games | (same source the MCP `list_games` uses) | Fields seen: `event_name`, `game_time`, `on_play`, `turns`, `won`, `history_path` (`{date}/{hash}`), `link`. **Verify exact endpoint in Phase 0.** |
| Game log | `GET /data/history?history_path={date}/{hash}` | Returns `{seat_id, opponent_seat_id, events[]}`. ~1.5 MB for a 13-turn game. |
| Card data | `GET /data/cards?ids=1,2,3` | Batch. Returns `name`, `types`, `abilities` (id→text), `layout`, `rarity`, `image_url` (17landscapes CDN), `back_image_url`. |
| Ability text | `GET /data/abilities?ids=...` | For abilities on the stack. |
| Deck | `GET /api/deck/draft/?draft_id=&deck_index=` | Maindeck/sideboard with counts, cmc, mana cost. Use the highest `deck_index` used in the game (rebuilt decks increment it). |

**Auth:** client token from env var `SEVENTEENLANDS_TOKEN` (`.env`, gitignored). **Open question:** `/data/history` worked from a logged-in browser session; confirm it accepts the token (or what header/cookie it needs) in Phase 0. Fallback: import a JSON file saved manually from the browser.

### 2.2 Scryfall (card images)

- `GET https://api.scryfall.com/cards/arena/{grpId}` → `image_uris.normal` / `small` (or `card_faces[i].image_uris` for DFC/prepare cards).
- Scryfall's `/cards/collection` batch does **not** accept Arena IDs, so lookups are per card. Respect ~10 req/s, send a `User-Agent`, cache forever.
- **Fallback chain:** Scryfall by Arena ID → Scryfall by exact name + set → 17Lands `image_url` → text placeholder card. New sets (e.g. FRA) may not have `arena_id` populated on Scryfall yet; the fallback must be seamless.
- Images cached to disk (`cache/images/{grpId}.webp`); metadata cached in SQLite.

### 2.3 Local cache (SQLite)
Tables: `events`, `games`, `game_logs` (raw JSON, gzip), `cards` (grpId → name, types, mana cost, image paths), `decks`. A game log is fetched once and never again.

---

## 3. Parsing the GRE log

The log is a list of Arena GRE messages. Only `GREMessageType_GameStateMessage` carries state; build snapshots from them.

### 3.1 What the messages look like (observed)
- `gameStateMessage.type`: `GameStateType_Full` (first message, full zone list) or `GameStateType_Diff` (only what changed).
- `zones[]`: `{zoneId, type, ownerSeatId?, objectInstanceIds[]}`. Types: `Hand`, `Library`, `Graveyard`, `Exile`, `Battlefield`, `Stack`, `Limbo`, `Revealed`, `Sideboard`, `Command`, `Pending`, `Suppressed`.
  - **Resolve zone IDs from the Full message by `type` + `ownerSeatId`; don't hardcode.** (In the sample: my hand 35, my library 36, my graveyard 37, battlefield 28, stack 27, exile 29, limbo 30.)
- `gameObjects[]`: `{instanceId, grpId, type (Card/Token/Ability), zoneId, ownerSeatId, controllerSeatId, visibility, cardTypes, subtypes, superTypes, color, power, toughness, isTapped?, ...}`.
- `annotations[]` (per diff):
  - `AnnotationType_ObjectIdChanged` `{orig_id → new_id}` — **every zone change gives the card a new instanceId.** Track identity across zones with a union-find / alias map, or nothing will line up.
  - `AnnotationType_ZoneTransfer` — carries a `category` (Draw, PlayLand, CastSpell, Resolve, Mill, Discard, Destroy, Sacrifice, Exile, Return, etc.). Primary signal for the event log.
  - Others to surface later: `DamageDealt`, `ModifiedLife`, `TappedUntappedPermanent`, `CounterAdded`, `ResolutionStart/Complete`.
- `persistentAnnotations[]` — ongoing state (counters, color production, ability words). `diffDeletedPersistentAnnotationIds` removes them.
- `diffDeletedInstanceIds[]` — objects to drop.
- `turnInfo`: `turnNumber` (**global**, counts both players' turns), `activePlayer`, `phase`, `step`.
- `players[]`: `lifeTotal`, `systemSeatNumber`, `status`.
- Match result: `results[]` with `winningTeamId`, `reason` (e.g. `ResultReason_Concede`).

### 3.2 Snapshot model
Apply messages in order to a mutable `GameState`, emitting an immutable snapshot after each message that changes something visible:

```
Snapshot {
  idx, gameStateId,
  turn: { global, perPlayer, activeSeat, phase, step },
  players: { [seat]: { life, handCount, libraryCount } },
  zones: { [seat]: { hand[], library(count), graveyard[], exile[] }, battlefield[], stack[] },
  objects: { [instanceId]: CardView },   // grpId, tapped, counters, P/T, controller, visibility
  events: Event[]                         // human-readable things that happened in this step
}
```

Display turn as **per-player turn**: `perPlayer = ceil(global / 2)`, labelled with whose turn it is ("Turn 6 · You"). This matches how players think and how 17Lands labels turns.

### 3.3 Event extraction (for the log + stats)
For each diff, emit events like:
- `Draw` (library → hand on draw step), `DrawExtra` (library → hand from an effect; record the source card via `affectorId`)
- `PlayLand`, `Cast`, `Resolve`, `Counter`
- `Mill` (library → graveyard), `Discard`, `Dies`, `Exile`, `ReturnToHand`, `PutOnBottom`
- `Attack` / `Block` (from combat steps), `Damage`, `LifeChange`
- `Mulligan` (hand size drop at turn 0)

Each event: `{turn, seat, kind, cardGrpId, sourceGrpId?, fromZone, toZone}`.

### 3.4 Known gotchas
- Opponent's hand/library cards are `Visibility_Private` with no grpId shown to us until revealed — render card backs.
- "Prepare"-layout cards (e.g. Paradox Shaper ↔ Omit Variables) appear under a different grpId when the other side is cast. Map both sides to one card for display.
- Diff messages repeat the same `actions` list many times; ignore `actions` for state.
- A Bo1 history may list more than one `results` entry; confirm whether multi-game matches put all games in one log or one per `/{n}` suffix on the replay URL.

---

## 4. UI

Single-page app, three views.

### 4.1 Events list (home)
Table like the 17Lands user page: date, event name, set, colors (mana symbols), record (W–L), account. Filters: set, format, account, date. Click → event.

### 4.2 Event detail
- Deck panel: maindeck as card images grouped by type/CMC, land count + color sources; sideboard collapsed.
- Games table: date, play/draw, turns, result, opponent colors (if known), and quick stats (lands seen %, mulligans). Click → replay.

### 4.3 Replay (the main screen)

```
┌──────────────────────────────────────────────────────────────┐
│ Opp ♥ 14   Hand ▢▢▢▢ (4)   Library 19   GY 6   Exile 1         │  ← opponent bar
│ [Opp nonland permanents ............................]         │
│ [Opp lands .........]                                         │
│──────────────────────── STACK (overlay when not empty) ───────│
│ [My lands ..........]                                         │
│ [My nonland permanents .............................]         │
│ Me ♥ 9   Library 15   GY 13   Exile 1                         │  ← my bar
│ [ MY HAND: full card images, fanned ]                          │
├──────────────────────────────────────────────────────────────┤
│ TURN 6 · YOU · MAIN 1      ◀◀ turn  ◀ step  ▶ step  turn ▶▶   │  ← turn tracker
│ [1][2][3][4][5][6●][7][8]...  (per-turn chips, colored by player)│
└──────────────────────────────────────────────────────────────┘
 Right sidebar (tabs): Event log · Draws & lands · Graveyards
```

**Board**
- Cards rendered from cached images. Tapped = rotated 90°. Counters and modified P/T as badges. Tokens as images if available, else a styled box.
- Lands grouped and stacked by name with a count (e.g., Swamp ×4).
- Cards that changed this step get a brief highlight; new arrivals animate in.
- Hover → large card preview with oracle text.
- Graveyard/exile: click to open a drawer of card images in order put there.

**Turn tracker**
- Always-visible header: per-player turn, whose turn, phase/step.
- Phase strip: Untap · Upkeep · Draw · Main 1 · Combat (begin/attack/block/damage/end) · Main 2 · End — current one lit.
- Turn chips across the bottom, colored by active player; click to jump to start of that turn.
- Keyboard: ←/→ step, Shift+←/→ turn, Home/End.
- Step granularity toggle: every state change · meaningful events only (default) · per phase.

**Sidebar tabs**
1. **Event log** — readable lines grouped by turn ("T6 You: drew Mountain · played Mountain · cast Cast Away Doubt → drew Swamp, Paradox Shaper"). Click a line → jump there.
2. **Draws & lands**
   - Draw order table (opening hand + every draw, with source of extra draws).
   - Land drops per turn, missed land drops flagged.
   - Cards seen (drawn + milled + otherwise revealed from my library) vs lands among them; expected count and hypergeometric P(≥ observed) given deck land count.
   - Where my notable cards ended up (rares/mythics or user-starred): hand / battlefield / graveyard / library / exile.
3. **Graveyards** — both players, ordered, with the turn each card arrived.

---

## 5. Architecture

```
browser (Vite + React + TS)  ⇄  local API (FastAPI or Node/Express)  ⇄  17Lands / Scryfall
                                         │
                                   SQLite + image cache
```

- **Backend:** proxy + cache + parsing. Parsing lives server-side (Python or TS, pick one) and returns a compact `ReplayDTO` (snapshots + events + card table) instead of the 1.5 MB raw log.
  - `GET /api/events`
  - `GET /api/events/{id}` (deck + games)
  - `GET /api/games/{history_path}/replay`
  - `GET /api/cards/{grpId}` and `/img/{grpId}` (serves cached image)
  - `POST /api/import` (upload a raw log JSON — fallback path)
- **Frontend:** React + TS, Tailwind, Zustand for replay cursor state. No server-side rendering needed.
- **Run:** `make dev` or `docker compose up` → http://localhost:5173.

Language pick is open: Python makes the stats/hypergeometric easy; TS shares types with the UI. Default suggestion: **TypeScript end-to-end** (one parser, shared `ReplayDTO` types).

---

## 6. Milestones

| Phase | Deliverable | Done when |
|---|---|---|
| 0. Spike | Script: token → list games → fetch one log → dump per-turn draws/plays/mills | Reproduces the 2026-10-29 numbers: 25 cards seen, 14 lands, missed land drop T4 |
| 1. Parser | `GameState` + snapshots + events + unit tests on saved logs | Snapshot at any step matches the 17Lands replay for that step |
| 2. Replay UI | Board, hand images, turn tracker, keyboard nav | Can review a full game without opening 17Lands |
| 3. Browse | Events list, event detail with deck, games table | Navigation matches 17Lands flow |
| 4. Stats | Draws & lands tab, graveyard tab, notable-card tracking | Flood/screw question answered in one glance |
| 5. Polish | Highlights/animations, hover previews, step granularity, opponent card reveals | Feels better than 17Lands |

**Test fixtures:** save raw logs for (a) the 2026-10-29 Arena Direct Sealed game (`20261029/56c30b28b49946e09ba76dac42a97c54`), (b) a game with a mulligan, (c) a game with tokens and counters, (d) a Bo3 match if the format applies.

---

## 7. Open questions
1. Does `/data/history` accept the client token, or does it need the web session cookie?
2. Exact endpoint behind the game list (`list_games`).
3. Bo3: one log per game or one per match?
4. Scryfall `arena_id` coverage for the newest set — how often will we hit the fallback?
5. Python vs TypeScript for the backend.
6. Later: post-game "review notes" saved per game? Export a turn as an image to share?