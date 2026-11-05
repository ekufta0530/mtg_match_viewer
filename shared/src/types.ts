// Shared DTO types between the parser, server and web app.

export type ZoneKey =
  | 'hand'
  | 'library'
  | 'graveyard'
  | 'exile'
  | 'battlefield'
  | 'stack'
  | 'limbo'
  | 'other';

/** Immutable description of one card/token/ability at a point in time. Deduped into ReplayDTO.views. */
export interface CardView {
  /** Stable id: survives zone changes (instanceId aliasing is resolved by the parser). */
  id: number;
  /** 0 when the card is hidden from us (opponent hand/library). */
  grpId: number;
  kind: 'card' | 'token' | 'ability';
  owner: number;
  controller: number;
  tapped?: boolean;
  /** Current power / toughness (already includes modifications). */
  p?: number;
  t?: number;
  loyalty?: number;
  damage?: number;
  counters?: Record<string, number>;
  attacking?: boolean;
  blocking?: boolean;
  /** Stable ids of the attackers this creature is blocking. */
  blocks?: number[];
  /** Stable id of the planeswalker/battle this creature attacks (absent = attacking the player). */
  attackTarget?: number;
  sick?: boolean;
  /** Card colors as W/U/B/R/G letters (empty/absent = colorless). */
  colors?: string[];
  /** Short card types, e.g. ['Creature'], ['Land'] */
  types?: string[];
  /** For abilities/tokens: grpId of the source card. */
  srcGrp?: number;
  /** Stable id of the object an ability came from. */
  parent?: number;
}

export interface PlayerZones {
  hand: number[]; // view indexes
  graveyard: number[];
  exile: number[];
  libraryCount: number;
}

export interface Snapshot {
  idx: number;
  /** Index of the source message in the raw log. */
  msg: number;
  gameStateId: number;
  /** Global turn number (counts both players' turns). 0 = pre-game (mulligans). */
  turn: number;
  /** Per-player turn: ceil(turn/2). */
  ptn: number;
  activeSeat: number;
  phase?: string; // 'Beginning' | 'Main1' | 'Combat' | 'Main2' | 'Ending'
  step?: string; // 'Upkeep' | 'Draw' | 'BeginCombat' | ...
  life: Record<number, number>;
  players: Record<number, PlayerZones>;
  battlefield: number[]; // view indexes, all controllers
  stack: number[];
  /** Indexes into ReplayDTO.events produced by this step. */
  events: number[];
  turnStart: boolean;
  phaseStart: boolean;
}

export type EventKind =
  | 'OpeningHand'
  | 'Mulligan'
  | 'Bottom'
  | 'Draw'
  | 'DrawExtra'
  | 'PlayLand'
  | 'Cast'
  | 'Resolve'
  | 'Counter'
  | 'Mill'
  | 'Discard'
  | 'Dies'
  | 'Destroyed'
  | 'Exile'
  | 'ReturnToHand'
  | 'ToLibrary'
  | 'Reanimate'
  | 'EnterBattlefield'
  | 'Token'
  | 'Ability'
  | 'Attack'
  | 'Block'
  | 'Life'
  | 'Counters';

export interface GameEvent {
  idx: number;
  snap: number;
  turn: number;
  ptn: number;
  activeSeat: number;
  phase?: string;
  step?: string;
  seat: number;
  kind: EventKind;
  /** grpId of the subject card (0 if hidden). */
  grp: number;
  /** stable card id, for jumping/highlighting */
  cardId?: number;
  /** grpId of the card that caused this (e.g. the spell that made us draw). */
  src?: number;
  from?: ZoneKey;
  to?: ZoneKey;
  land?: boolean;
  /** Life delta, counter amount, or number of cards (mulligan). */
  n?: number;
  /** Absolute value after (life total) */
  value?: number;
  counterType?: number;
}

export interface CardInfo {
  grpId: number;
  name: string;
  types: string[]; // e.g. ["Legendary Creature - Human Rogue"]
  rarity: string;
  layout: string;
  abilities: Record<string, string>;
  /** URL served by our own server (/img/:grpId) */
  img: string;
  backImg?: string;
  manaCost?: string;
  cmc?: number;
  oracle?: string;
  isLand: boolean;
}

export interface DeckCard {
  grpId: number;
  name: string;
  count: number;
  cmc?: number;
  manaCost?: string;
  types?: string;
}

export interface DeckInfo {
  main: DeckCard[];
  side: DeckCard[];
  deckIndex: number;
}

export interface ReplayMeta {
  historyPath: string;
  matchId?: string;
  mySeat: number;
  oppSeat: number;
  onPlay: boolean;
  winnerSeat?: number;
  resultReason?: string;
  won?: boolean;
  mulligans: Record<number, number>;
  totalTurns: number; // global
  eventName?: string;
  gameTime?: string;
  libraryStart: Record<number, number>;
}

export interface ReplayDTO {
  meta: ReplayMeta;
  views: CardView[];
  snapshots: Snapshot[];
  events: GameEvent[];
  /** grpId -> info; filled in by the server */
  cards: Record<number, CardInfo>;
  /** ability grpId -> text */
  abilities: Record<number, string>;
  deck?: DeckInfo;
  /** Set when card metadata could not be loaded (e.g. 17Lands unreachable). */
  warning?: string;
}

// ----- Browse DTOs -----

export interface EventSummary {
  id: string;
  name: string; // dated_event_name
  format: string;
  expansion: string;
  colors: string;
  wins: number;
  losses: number;
  account: string;
  date: string;
  deckCount: number;
  hasPicks: boolean;
}

export interface GameSummary {
  historyPath: string; // "20261029/56c3..."
  gameIndex: number;
  eventName: string;
  gameTime: string;
  onPlay: boolean;
  turns: number;
  won: boolean;
  account: string;
}

export interface EventDetailDTO {
  event: EventSummary;
  games: GameSummary[];
  deck?: DeckInfo;
}
