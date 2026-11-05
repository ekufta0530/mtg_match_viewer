import type { CardInfo, GameEvent, ReplayDTO } from '@mmv/shared';

/** Arena ability text uses CARDNAME and {oX} mana tokens. */
export const fmtText = (text: string, name = 'this card') => text.replace(/CARDNAME/g, name).replace(/\{o([A-Z0-9]+)\}/g, '{$1}');

export const cardName = (r: ReplayDTO, grp: number, hidden = 'a card') => (grp ? (r.cards[grp]?.name ?? `#${grp}`) : hidden);

export const PHASE_LABEL: Record<string, string> = {
  Beginning: 'Beginning',
  Main1: 'Main 1',
  Combat: 'Combat',
  Main2: 'Main 2',
  Ending: 'End',
};

export const STEP_LABEL: Record<string, string> = {
  Upkeep: 'Upkeep',
  Draw: 'Draw',
  BeginCombat: 'Begin combat',
  DeclareAttack: 'Declare attackers',
  DeclareBlock: 'Declare blockers',
  CombatDamage: 'Combat damage',
  EndCombat: 'End combat',
  End: 'End step',
  Cleanup: 'Cleanup',
};

export function whereLabel(phase?: string, step?: string): string {
  if (!phase) return 'Pre-game';
  if (phase === 'Combat' && step) return STEP_LABEL[step] ?? 'Combat';
  if (phase === 'Beginning' && step) return STEP_LABEL[step] ?? 'Beginning';
  if (phase === 'Ending' && step) return STEP_LABEL[step] ?? 'End';
  return PHASE_LABEL[phase] ?? phase;
}

export const COUNTER_NAMES: Record<number, string> = { 1: '+1/+1', 2: '-1/-1' };
export const counterName = (t: number | string) => COUNTER_NAMES[Number(t)] ?? `counter ${t}`;

/** Human readable one-liner for an event. `me` is the viewer's seat. */
export function describe(e: GameEvent, r: ReplayDTO): string {
  const me = r.meta.mySeat;
  const who = e.seat === me ? 'You' : 'Opp';
  const hide = e.seat === me ? 'a card' : 'a card';
  const n = cardName(r, e.grp, hide);
  const src = e.src ? cardName(r, e.src) : '';
  switch (e.kind) {
    case 'OpeningHand':
      return `${who} opening hand: ${n}`;
    case 'Mulligan':
      return `${who} mulliganed`;
    case 'Bottom':
      return `${who} put ${n} on the bottom`;
    case 'Draw':
      return `${who} drew ${n}`;
    case 'DrawExtra':
      return `${who} drew ${n}${src ? ` (${src})` : ''}`;
    case 'PlayLand':
      return `${who} played ${n}`;
    case 'Cast':
      return `${who} cast ${n}`;
    case 'Resolve':
      return `${n} resolved`;
    case 'Counter':
      return `${n} was countered`;
    case 'Mill':
      return `${who} milled ${n}${src ? ` (${src})` : ''}`;
    case 'Discard':
      return `${who} discarded ${n}`;
    case 'Dies':
      return `${n} died`;
    case 'Destroyed':
      return `${n} was destroyed`;
    case 'Exile':
      return `${n} was exiled`;
    case 'ReturnToHand':
      return `${n} returned to hand`;
    case 'ToLibrary':
      return `${n} went to library`;
    case 'Reanimate':
      return `${n} returned to the battlefield`;
    case 'EnterBattlefield':
      return `${n} entered the battlefield`;
    case 'Token':
      return `${who} created ${n}`;
    case 'Ability': {
      const raw = e.src ? r.abilities[e.src] : undefined;
      const text = raw ? fmtText(raw, n) : undefined;
      return `${n} ability${text ? `: ${text.length > 90 ? text.slice(0, 88) + '…' : text}` : ''}`;
    }
    case 'Attack':
      return `${n} attacks`;
    case 'Block':
      return `${n} blocks`;
    case 'Life':
      return `${who} ${e.n! > 0 ? 'gained' : 'lost'} ${Math.abs(e.n!)} life → ${e.value}`;
    case 'Counters':
      return `${n} got ${e.n} ${counterName(e.counterType ?? 0)} counter${e.n === 1 ? '' : 's'}`;
  }
}

/** Events worth showing in the log (hides raw triggered abilities & counters by default). */
export const NOISY = new Set(['Ability', 'Counters', 'OpeningHand']);

export function infoLines(c?: CardInfo): string[] {
  if (!c) return [];
  return Object.values(c.abilities ?? {}).map((t) => fmtText(t, c.name));
}

export const SEAT_COLOR = { me: 'text-sky-400', opp: 'text-rose-400' };
