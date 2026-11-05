import { describe, expect, it } from 'vitest';
import { drawTable, parseHistory } from '../src';

const card = (instanceId: number, grpId: number, seat: number, zoneId: number) => ({
  instanceId,
  grpId,
  type: 'GameObjectType_Card',
  zoneId,
  visibility: 'Visibility_Private',
  ownerSeatId: seat,
  controllerSeatId: seat,
  cardTypes: grpId === 1 ? ['CardType_Land'] : ['CardType_Creature'],
});

const gs = (gameStateId: number, body: object) => ({ type: 'GREMessageType_GameStateMessage', gameStateMessage: { type: gameStateId === 1 ? 'GameStateType_Full' : 'GameStateType_Diff', gameStateId, ...body } });

describe('mulligan detection', () => {
  const raw = {
    seat_id: 2,
    opponent_seat_id: 1,
    events: [
      gs(1, {
        zones: [
          { zoneId: 1, type: 'ZoneType_Hand', ownerSeatId: 1 },
          { zoneId: 2, type: 'ZoneType_Library', ownerSeatId: 1, objectInstanceIds: [1] },
          { zoneId: 3, type: 'ZoneType_Hand', ownerSeatId: 2 },
          { zoneId: 4, type: 'ZoneType_Library', ownerSeatId: 2, objectInstanceIds: [11, 12, 13, 14] },
          { zoneId: 5, type: 'ZoneType_Battlefield' },
        ],
        players: [{ systemSeatNumber: 1, lifeTotal: 20 }, { systemSeatNumber: 2, lifeTotal: 20 }],
      }),
      // first deal: cards 11,12
      gs(2, {
        zones: [
          { zoneId: 3, type: 'ZoneType_Hand', ownerSeatId: 2, objectInstanceIds: [11, 12] },
          { zoneId: 4, type: 'ZoneType_Library', ownerSeatId: 2, objectInstanceIds: [13, 14] },
        ],
        gameObjects: [card(11, 1, 2, 3), card(12, 1, 2, 3)],
      }),
      // mulligan: everything deleted and re-created with new ids
      gs(3, {
        diffDeletedInstanceIds: [11, 12, 13, 14],
        zones: [
          { zoneId: 3, type: 'ZoneType_Hand', ownerSeatId: 2, objectInstanceIds: [21, 22] },
          { zoneId: 4, type: 'ZoneType_Library', ownerSeatId: 2, objectInstanceIds: [23, 24] },
        ],
        gameObjects: [card(21, 1, 2, 3), card(22, 7, 2, 3)],
      }),
    ],
  };
  const r = parseHistory(raw);

  it('counts one mulligan for the redealt seat only', () => {
    expect(r.meta.mulligans[2]).toBe(1);
    expect(r.meta.mulligans[1]).toBe(0);
    expect(r.events.filter((e) => e.kind === 'Mulligan')).toHaveLength(1);
  });

  it('only the kept hand counts as seen', () => {
    const rows = drawTable(r);
    expect(rows).toHaveLength(2);
    expect(rows.map((x) => x.grp).sort()).toEqual([1, 7]);
    expect(rows.filter((x) => x.land)).toHaveLength(1);
  });

  it('final snapshot shows the new hand', () => {
    const last = r.snapshots[r.snapshots.length - 1];
    expect(last.players[2].hand.map((i) => r.views[i].grpId).sort()).toEqual([1, 7]);
  });
});
