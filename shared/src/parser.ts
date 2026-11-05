// Turns a raw 17Lands /data/history payload (Arena GRE messages) into a ReplayDTO.
//
// Notes on what the log actually contains (17Lands strips ZoneTransfer annotations):
//  - Full state arrives once; everything else is a diff.
//  - Zone changes are inferred by diffing zone membership per *stable* card id.
//  - Every zone change may give a card a new instanceId; ObjectIdChanged annotations let us alias them.

import type {
  CardView,
  EventKind,
  GameEvent,
  PlayerZones,
  ReplayDTO,
  Snapshot,
  ZoneKey,
} from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any;

export interface RawHistory {
  seat_id: number;
  opponent_seat_id: number;
  events: Raw[];
}

interface ZoneState {
  id: number;
  key: ZoneKey;
  seat?: number;
  ids: number[];
}

interface Loc {
  zone: ZoneKey;
  seat: number; // owner seat of the zone (battlefield/stack: controller)
}

const ZONE_MAP: Record<string, ZoneKey> = {
  ZoneType_Hand: 'hand',
  ZoneType_Library: 'library',
  ZoneType_Graveyard: 'graveyard',
  ZoneType_Exile: 'exile',
  ZoneType_Battlefield: 'battlefield',
  ZoneType_Stack: 'stack',
  ZoneType_Limbo: 'limbo',
};

const ATTACKING = new Set(['AttackState_Declared', 'AttackState_Attacking']);
const BLOCKING = new Set(['BlockState_Declared', 'BlockState_Blocking']);

const COLOR_LETTER: Record<string, string> = {
  CardColor_White: 'W',
  CardColor_Blue: 'U',
  CardColor_Black: 'B',
  CardColor_Red: 'R',
  CardColor_Green: 'G',
};

const strip = (s: string | undefined, prefix: string) => (s ? s.replace(prefix, '') : s);

function detail(a: Raw, key: string): number | undefined {
  const d = (a.details ?? []).find((x: Raw) => x.key === key);
  return d?.valueInt32?.[0];
}

export function parseHistory(raw: RawHistory, historyPath = ''): ReplayDTO {
  const mySeat = raw.seat_id;
  const oppSeat = raw.opponent_seat_id;
  const seats = [mySeat, oppSeat];

  const zones = new Map<number, ZoneState>();
  const objs = new Map<number, Raw>();
  const stableOf = new Map<number, number>(); // inst -> stable id
  const superseded = new Set<number>();
  const persist = new Map<number, Raw>();
  const lastLoc = new Map<number, Loc>(); // stable -> last non-limbo location
  const prevCombat = new Map<number, string>(); // stable -> "a"|"b"|""
  const everSeen = new Set<number>(); // stable ids seen in any zone
  const life: Record<number, number> = {};
  let turnInfo: Raw = {};
  let prevTurnKey = '';
  let prevPhaseKey = '';
  let matchId: string | undefined;
  let result: Raw | undefined;
  const mulligans: Record<number, number> = { [mySeat]: 0, [oppSeat]: 0 };
  const libraryStart: Record<number, number> = {};
  const dealt = new Set<number>(); // seats that already received an opening hand

  const views: CardView[] = [];
  const viewIdx = new Map<string, number>();
  const snapshots: Snapshot[] = [];
  const events: GameEvent[] = [];
  let prevSig = '';
  let drawnThisTurn: Record<string, number> = {};

  const stable = (inst: number) => stableOf.get(inst) ?? inst;

  function pushView(v: CardView): number {
    const key = JSON.stringify(v);
    let i = viewIdx.get(key);
    if (i === undefined) {
      i = views.length;
      views.push(v);
      viewIdx.set(key, i);
    }
    return i;
  }

  function countersFor(inst: number): Record<string, number> | undefined {
    let out: Record<string, number> | undefined;
    for (const a of persist.values()) {
      if (a.type?.[0] !== 'AnnotationType_Counter') continue;
      if (!(a.affectedIds ?? []).includes(inst)) continue;
      const count = detail(a, 'count') ?? 0;
      const ct = detail(a, 'counter_type') ?? 0;
      if (count > 0) (out ??= {})[String(ct)] = count;
    }
    return out;
  }

  function viewFor(inst: number, fallbackSeat: number): number {
    const o = objs.get(inst);
    const id = stable(inst);
    if (!o) {
      return pushView({ id, grpId: 0, kind: 'card', owner: fallbackSeat, controller: fallbackSeat });
    }
    const kind: CardView['kind'] =
      o.type === 'GameObjectType_Ability' ? 'ability' : o.type === 'GameObjectType_Token' ? 'token' : 'card';
    const v: CardView = {
      id,
      grpId: o.grpId ?? 0,
      kind,
      owner: o.ownerSeatId ?? fallbackSeat,
      controller: o.controllerSeatId ?? o.ownerSeatId ?? fallbackSeat,
    };
    if (o.isTapped) v.tapped = true;
    if (o.power?.value !== undefined) v.p = o.power.value;
    if (o.toughness?.value !== undefined) v.t = o.toughness.value;
    if (o.loyalty?.value !== undefined) v.loyalty = o.loyalty.value;
    if (o.damage) v.damage = o.damage;
    if (ATTACKING.has(o.attackState)) v.attacking = true;
    if (BLOCKING.has(o.blockState)) v.blocking = true;
    if (o.blockInfo?.attackerIds?.length) v.blocks = o.blockInfo.attackerIds.map((i: number) => stable(i));
    // attack targets are seat numbers for players, instance ids for planeswalkers/battles
    if (v.attacking && o.attackInfo?.targetId > 10) v.attackTarget = stable(o.attackInfo.targetId);
    if (o.hasSummoningSickness) v.sick = true;
    if (o.color?.length) v.colors = o.color.map((c: string) => COLOR_LETTER[c]).filter(Boolean);
    if (o.cardTypes?.length) v.types = o.cardTypes.map((t: string) => t.replace('CardType_', ''));
    const c = countersFor(inst);
    if (c) v.counters = c;
    if (kind === 'ability') {
      if (o.objectSourceGrpId) v.srcGrp = o.objectSourceGrpId;
      if (o.parentId) v.parent = stable(o.parentId);
    } else if (o.objectSourceGrpId) {
      v.srcGrp = o.objectSourceGrpId;
    }
    return pushView(v);
  }

  /** Current location of every live stable id. */
  function locate(): Map<number, Loc & { inst: number }> {
    const out = new Map<number, Loc & { inst: number }>();
    for (const z of zones.values()) {
      for (const inst of z.ids) {
        if (superseded.has(inst)) continue;
        const o = objs.get(inst);
        let seat = z.seat ?? o?.controllerSeatId ?? o?.ownerSeatId ?? 0;
        if (z.key === 'battlefield' || z.key === 'stack') seat = o?.controllerSeatId ?? seat;
        out.set(stable(inst), { zone: z.key, seat, inst });
      }
    }
    return out;
  }

  function currentStackSources(): number[] {
    const out: number[] = [];
    for (const z of zones.values()) {
      if (z.key !== 'stack') continue;
      for (const inst of z.ids) {
        const o = objs.get(inst);
        if (!o) continue;
        out.push(o.type === 'GameObjectType_Ability' ? (o.objectSourceGrpId ?? 0) : (o.grpId ?? 0));
      }
    }
    return out.filter(Boolean);
  }

  const turnNumber = () => turnInfo.turnNumber ?? 0;
  const phaseName = () => strip(turnInfo.phase, 'Phase_');
  const stepName = () => strip(turnInfo.step, 'Step_');

  function mkEvent(partial: Partial<GameEvent> & { kind: EventKind; seat: number }): GameEvent {
    const t = turnNumber();
    const e: GameEvent = {
      idx: events.length,
      snap: snapshots.length, // the snapshot about to be emitted
      turn: t,
      ptn: Math.ceil(t / 2),
      activeSeat: turnInfo.activePlayer ?? 0,
      phase: phaseName(),
      step: stepName(),
      grp: 0,
      ...partial,
    };
    events.push(e);
    return e;
  }

  const msgs: { msg: Raw; i: number }[] = [];
  raw.events.forEach((e: Raw, i: number) => {
    if (e.gameStateMessage) msgs.push({ msg: e.gameStateMessage, i });
  });

  let emittedAny = false;

  for (const { msg, i: rawIdx } of msgs) {
    const stackBefore = currentStackSources();
    const turnBefore = turnNumber();

    if (msg.gameInfo) {
      matchId = msg.gameInfo.matchID ?? matchId;
      const r = (msg.gameInfo.results ?? []).filter((x: Raw) => x.scope === 'MatchScope_Game');
      if (r.length) result = r[r.length - 1];
    }
    if (msg.turnInfo && Object.keys(msg.turnInfo).length) {
      turnInfo = { ...msg.turnInfo, turnNumber: msg.turnInfo.turnNumber ?? turnInfo.turnNumber };
    } else if (msg.turnInfo) {
      turnInfo = { ...turnInfo };
    }

    const lifeEvents: { seat: number; delta: number; value: number }[] = [];
    for (const p of msg.players ?? []) {
      const seat = p.systemSeatNumber;
      if (p.lifeTotal === undefined) continue;
      if (life[seat] !== undefined && life[seat] !== p.lifeTotal) {
        lifeEvents.push({ seat, delta: p.lifeTotal - life[seat], value: p.lifeTotal });
      }
      life[seat] = p.lifeTotal;
    }

    // identity aliasing first, so the zone/object updates below resolve to stable ids
    const counterEvents: { inst: number; type: number; n: number }[] = [];
    for (const a of msg.annotations ?? []) {
      const t = a.type?.[0];
      if (t === 'AnnotationType_ObjectIdChanged') {
        const o = detail(a, 'orig_id');
        const n = detail(a, 'new_id');
        if (o !== undefined && n !== undefined) {
          stableOf.set(n, stable(o));
          superseded.add(o);
        }
      } else if (t === 'AnnotationType_CounterAdded') {
        for (const id of a.affectedIds ?? []) {
          counterEvents.push({ inst: id, type: detail(a, 'counter_type') ?? 0, n: detail(a, 'transaction_amount') ?? 1 });
        }
      }
    }

    for (const z of msg.zones ?? []) {
      const key = ZONE_MAP[z.type] ?? 'other';
      zones.set(z.zoneId, { id: z.zoneId, key, seat: z.ownerSeatId, ids: z.objectInstanceIds ?? [] });
    }
    for (const o of msg.gameObjects ?? []) objs.set(o.instanceId, o);
    for (const id of msg.diffDeletedInstanceIds ?? []) objs.delete(id);
    for (const a of msg.persistentAnnotations ?? []) persist.set(a.id, a);
    for (const id of msg.diffDeletedPersistentAnnotationIds ?? []) persist.delete(id);

    // ---- zone-move detection ----
    const loc = locate();
    const moves: { id: number; from?: Loc; to: Loc; inst: number }[] = [];
    for (const [id, l] of loc) {
      if (l.zone === 'limbo') continue;
      const prev = lastLoc.get(id);
      if (!prev) {
        everSeen.add(id);
        lastLoc.set(id, { zone: l.zone, seat: l.seat });
        moves.push({ id, to: l, inst: l.inst });
        continue;
      }
      if (prev.zone !== l.zone || (l.zone !== 'battlefield' && l.zone !== 'stack' && prev.seat !== l.seat)) {
        moves.push({ id, from: prev, to: l, inst: l.inst });
        lastLoc.set(id, { zone: l.zone, seat: l.seat });
      } else {
        lastLoc.set(id, { zone: l.zone, seat: l.seat });
      }
    }

    const t = turnNumber();
    if (t !== turnBefore) drawnThisTurn = {};
    const pregame = t === 0;
    const stackAfter = currentStackSources();
    const sourceGuess = stackBefore[stackBefore.length - 1] ?? stackAfter[stackAfter.length - 1];
    const newEvents: GameEvent[] = [];
    const grpOf = (inst: number) => objs.get(inst)?.grpId ?? 0;
    const isLand = (inst: number) => (objs.get(inst)?.cardTypes ?? []).includes('CardType_Land');
    const isSpell = (inst: number) => {
      const ct: string[] = objs.get(inst)?.cardTypes ?? [];
      return ct.includes('CardType_Instant') || ct.includes('CardType_Sorcery');
    };
    const kindOf = (inst: number) => objs.get(inst)?.type;

    // mulligan: a seat gets a fresh deal (all-new instance ids) after already holding an opening hand
    if (pregame) {
      const dealtNow = new Set<number>();
      for (const m of moves) if (m.to.zone === 'hand' && (!m.from || m.from.zone === 'library')) dealtNow.add(objs.get(m.inst)?.ownerSeatId ?? m.to.seat);
      for (const seat of dealtNow) {
        if (dealt.has(seat)) {
          mulligans[seat] = (mulligans[seat] ?? 0) + 1;
          newEvents.push(mkEvent({ kind: 'Mulligan', seat, n: mulligans[seat] }));
        }
        dealt.add(seat);
      }
    }
    // pregame hand->library moves are London-mulligan bottoms
    const pregameToLib: Record<number, typeof moves> = {};

    for (const m of moves) {
      const inst = m.inst;
      const to = m.to.zone;
      const from = m.from?.zone;
      const seat = m.to.seat || m.from?.seat || 0;
      const ownerSeat = objs.get(inst)?.ownerSeatId ?? seat;
      const base = { grp: grpOf(inst), cardId: m.id, from, to, land: isLand(inst) } as const;
      const push = (kind: EventKind, extra: Partial<GameEvent> = {}, s = seat) =>
        newEvents.push(mkEvent({ kind, seat: s, ...base, ...extra }));

      if (!from) {
        // first appearance
        if (kindOf(inst) === 'GameObjectType_Token' && to === 'battlefield') push('Token');
        else if (kindOf(inst) === 'GameObjectType_Ability' && to === 'stack') {
          const o = objs.get(inst);
          push('Ability', { grp: o?.objectSourceGrpId ?? 0, src: o?.grpId });
        } else if (to === 'hand' && pregame) {
          push('OpeningHand', { seat: ownerSeat }, ownerSeat);
        }
        continue;
      }

      const handOwner = ownerSeat;
      switch (`${from}>${to}`) {
        case 'library>hand': {
          if (pregame) {
            push('OpeningHand', {}, handOwner);
            break;
          }
          const key = `${t}:${handOwner}`;
          const isDrawStep = stepName() === 'Draw' && turnInfo.activePlayer === handOwner && !(drawnThisTurn[key] > 0);
          if (isDrawStep) {
            drawnThisTurn[key] = (drawnThisTurn[key] ?? 0) + 1;
            push('Draw', {}, handOwner);
          } else push('DrawExtra', { src: sourceGuess }, handOwner);
          break;
        }
        case 'hand>library':
          if (pregame) (pregameToLib[ownerSeat] ??= []).push(m);
          else push('ToLibrary', {}, handOwner);
          break;
        case 'library>graveyard':
          push('Mill', { src: sourceGuess }, ownerSeat);
          break;
        case 'library>exile':
          push('Exile', { src: sourceGuess }, ownerSeat);
          break;
        case 'library>battlefield':
          push('EnterBattlefield', { src: sourceGuess });
          break;
        case 'library>stack':
        case 'hand>stack':
        case 'graveyard>stack':
        case 'exile>stack':
        case 'battlefield>stack':
          if (kindOf(inst) === 'GameObjectType_Ability') push('Ability', { grp: objs.get(inst)?.objectSourceGrpId ?? 0, src: objs.get(inst)?.grpId });
          else push('Cast');
          break;
        case 'hand>battlefield':
          push(isLand(inst) ? 'PlayLand' : 'EnterBattlefield');
          break;
        case 'hand>graveyard':
          push('Discard', {}, ownerSeat);
          break;
        case 'hand>exile':
          push('Exile', {}, ownerSeat);
          break;
        case 'stack>battlefield':
          push('Resolve');
          break;
        case 'stack>graveyard':
          push(isSpell(inst) ? 'Resolve' : 'Counter', {}, ownerSeat);
          break;
        case 'stack>exile':
          push('Exile', {}, ownerSeat);
          break;
        case 'stack>hand':
          push('ReturnToHand', {}, ownerSeat);
          break;
        case 'stack>library':
          push('ToLibrary', {}, ownerSeat);
          break;
        case 'battlefield>graveyard': {
          const ct: string[] = objs.get(inst)?.cardTypes ?? [];
          push(ct.includes('CardType_Creature') ? 'Dies' : 'Destroyed', {}, ownerSeat);
          break;
        }
        case 'battlefield>hand':
          push('ReturnToHand', {}, ownerSeat);
          break;
        case 'battlefield>exile':
          push('Exile', {}, ownerSeat);
          break;
        case 'battlefield>library':
          push('ToLibrary', {}, ownerSeat);
          break;
        case 'graveyard>hand':
          push('ReturnToHand', {}, ownerSeat);
          break;
        case 'graveyard>battlefield':
          push('Reanimate');
          break;
        case 'graveyard>exile':
        case 'hand>other':
          push('Exile', {}, ownerSeat);
          break;
        case 'exile>hand':
          push('ReturnToHand', {}, ownerSeat);
          break;
        case 'exile>battlefield':
          push('EnterBattlefield');
          break;
        case 'exile>graveyard':
          push('Destroyed', {}, ownerSeat);
          break;
        default:
          break;
      }
    }

    for (const sStr of Object.keys(pregameToLib)) {
      const seat = Number(sStr);
      for (const m of pregameToLib[seat]) {
        newEvents.push(mkEvent({ kind: 'Bottom', seat, grp: grpOf(m.inst), cardId: m.id, from: 'hand', to: 'library' }));
      }
    }

    // combat
    for (const [inst, o] of objs) {
      if (superseded.has(inst)) continue;
      const id = stable(inst);
      const a = ATTACKING.has(o.attackState) ? 'a' : '';
      const b = BLOCKING.has(o.blockState) ? 'b' : '';
      const cur = a + b;
      const prev = prevCombat.get(id) ?? '';
      if (cur !== prev) {
        prevCombat.set(id, cur);
        if (a && !prev.includes('a')) {
          newEvents.push(mkEvent({ kind: 'Attack', seat: o.controllerSeatId ?? 0, grp: o.grpId ?? 0, cardId: id }));
        }
        if (b && !prev.includes('b')) {
          newEvents.push(mkEvent({ kind: 'Block', seat: o.controllerSeatId ?? 0, grp: o.grpId ?? 0, cardId: id }));
        }
      }
    }

    for (const le of lifeEvents) newEvents.push(mkEvent({ kind: 'Life', seat: le.seat, n: le.delta, value: le.value }));
    for (const ce of counterEvents) {
      const o = objs.get(ce.inst);
      if (!o) continue;
      newEvents.push(
        mkEvent({ kind: 'Counters', seat: o.controllerSeatId ?? 0, grp: o.grpId ?? 0, cardId: stable(ce.inst), n: ce.n, counterType: ce.type }),
      );
    }

    // ---- snapshot ----
    const zoneList = [...zones.values()];
    const players: Record<number, PlayerZones> = {};
    for (const s of seats) {
      const pick = (key: ZoneKey) =>
        zoneList
          .filter((z) => z.key === key && z.seat === s)
          .flatMap((z) => z.ids)
          .filter((id) => !superseded.has(id));
      const lib = pick('library');
      if (libraryStart[s] === undefined && lib.length) libraryStart[s] = lib.length + pick('hand').length;
      players[s] = {
        hand: pick('hand').map((id) => viewFor(id, s)),
        graveyard: pick('graveyard').map((id) => viewFor(id, s)),
        exile: pick('exile').map((id) => viewFor(id, s)),
        libraryCount: lib.length,
      };
    }
    const bf = zoneList
      .filter((z) => z.key === 'battlefield')
      .flatMap((z) => z.ids)
      .filter((id) => !superseded.has(id))
      .map((id) => viewFor(id, 0));
    const stack = zoneList
      .filter((z) => z.key === 'stack')
      .flatMap((z) => z.ids)
      .filter((id) => !superseded.has(id))
      .map((id) => viewFor(id, 0));

    const snap: Snapshot = {
      idx: snapshots.length,
      msg: rawIdx,
      gameStateId: msg.gameStateId,
      turn: t,
      ptn: Math.ceil(t / 2),
      activeSeat: turnInfo.activePlayer ?? 0,
      phase: phaseName(),
      step: stepName(),
      life: { ...life },
      players,
      battlefield: bf,
      stack,
      events: newEvents.map((e) => e.idx),
      turnStart: false,
      phaseStart: false,
    };
    const { idx: _i, msg: _m, gameStateId: _g, events: _e, turnStart: _ts, phaseStart: _ps, ...sigBody } = snap;
    const sig = JSON.stringify(sigBody);
    if (sig === prevSig && newEvents.length === 0 && emittedAny) continue;
    prevSig = sig;
    emittedAny = true;
    const turnKey = t === 0 ? '0' : `${t}:${snap.activeSeat}`;
    const phaseKey = `${turnKey}:${snap.phase}`;
    snap.turnStart = turnKey !== prevTurnKey;
    snap.phaseStart = phaseKey !== prevPhaseKey;
    prevTurnKey = turnKey;
    prevPhaseKey = phaseKey;
    snapshots.push(snap);
  }

  // events were stamped with snap=snapshots.length at creation; fix up in case a message was dropped (it never is when events exist)
  for (const s of snapshots) for (const ei of s.events) events[ei].snap = s.idx;

  const winnerSeat: number | undefined = result?.winningTeamId;
  const lastTurn = snapshots.length ? snapshots[snapshots.length - 1].turn : 0;
  const firstActive = snapshots.find((s) => s.turn >= 1)?.activeSeat;

  return {
    meta: {
      historyPath,
      matchId,
      mySeat,
      oppSeat,
      onPlay: firstActive === mySeat,
      winnerSeat,
      resultReason: strip(result?.reason, 'ResultReason_'),
      won: winnerSeat === undefined ? undefined : winnerSeat === mySeat,
      mulligans,
      totalTurns: lastTurn,
      libraryStart,
    },
    views,
    snapshots,
    events,
    cards: {},
    abilities: {},
  };
}

/** All grpIds (cards + abilities) referenced by a replay. */
export function collectGrpIds(r: ReplayDTO): { cards: number[]; abilities: number[] } {
  const cards = new Set<number>();
  const abilities = new Set<number>();
  for (const v of r.views) {
    if (v.kind === 'ability') {
      if (v.grpId) abilities.add(v.grpId);
      if (v.srcGrp) cards.add(v.srcGrp);
    } else if (v.grpId) cards.add(v.grpId);
  }
  for (const e of r.events) {
    if (e.grp) cards.add(e.grp);
    if (e.src && e.kind !== 'Ability') cards.add(e.src);
  }
  return { cards: [...cards], abilities: [...abilities] };
}
