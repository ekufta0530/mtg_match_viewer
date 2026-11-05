import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deckLandCount, drawTable, hypergeomPmf, landDrops, parseHistory, seenStats } from '../src';

const fixture = path.resolve(__dirname, '../../fixtures/sealed_20261029.json');
const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
const r = parseHistory(raw, '20261029/56c30b28b49946e09ba76dac42a97c54');
const me = r.meta.mySeat;

describe('2026-10-29 Arena Direct Sealed game', () => {
  it('reads match metadata', () => {
    expect(me).toBe(2);
    expect(r.meta.onPlay).toBe(true);
    expect(r.meta.won).toBe(false);
    expect(r.meta.resultReason).toBe('Concede');
    expect(r.meta.mulligans[me]).toBe(0);
    expect(r.meta.libraryStart[me]).toBe(40);
  });

  it('never shows the same card twice in one snapshot', () => {
    for (const s of r.snapshots) {
      const ids: number[] = [
        ...s.battlefield,
        ...s.stack,
        ...Object.values(s.players).flatMap((p) => [...p.hand, ...p.graveyard, ...p.exile]),
      ].map((vi) => r.views[vi].id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('opening hand is 7 known cards', () => {
    const open = r.events.filter((e) => e.kind === 'OpeningHand' && e.seat === me);
    expect(open).toHaveLength(7);
    expect(open.every((e) => e.grp > 0)).toBe(true);
  });

  it('draws, extra draws and mills (draw table)', () => {
    const rows = drawTable(r);
    expect(rows.filter((x) => x.kind === 'Opening')).toHaveLength(7);
    expect(rows.filter((x) => x.kind === 'Draw')).toHaveLength(12); // on the play: no T1 draw
    expect(rows.filter((x) => x.kind === 'Extra')).toHaveLength(3);
    expect(rows.filter((x) => x.kind === 'Mill')).toHaveLength(6);
    expect(rows.filter((x) => x.land)).toHaveLength(14);
  });

  it('flags the T4 land-less turn', () => {
    const drops = landDrops(r);
    expect(drops).toHaveLength(13);
    expect(drops[3]).toMatchObject({ ptn: 4, played: false, noLand: true, missed: false });
    expect(drops[10]).toMatchObject({ ptn: 11, played: false, missed: true });
    expect(drops.filter((d) => d.played)).toHaveLength(9);
  });

  it('computes land stats', () => {
    const dl = deckLandCount(r);
    const s = seenStats(r, 40, 17);
    expect(dl.size).toBe(40);
    expect(s.seen).toBe(28);
    expect(s.lands).toBe(14);
    expect(s.expected).toBeCloseTo(11.9);
    expect(s.pAtLeast).toBeGreaterThan(0.05);
  });

  it('labels turns per player', () => {
    const t1 = r.snapshots.find((s) => s.turn === 1)!;
    expect(t1.activeSeat).toBe(me);
    expect(t1.ptn).toBe(1);
    const t2 = r.snapshots.find((s) => s.turn === 2)!;
    expect(t2.activeSeat).toBe(r.meta.oppSeat);
    expect(t2.ptn).toBe(1);
    expect(r.snapshots.find((s) => s.turn === 26)!.ptn).toBe(13);
  });

  it('tracks identity across zone changes (hand -> limbo -> battlefield)', () => {
    const play = r.events.find((e) => e.kind === 'PlayLand' && e.seat === me)!;
    const snap = r.snapshots[play.snap];
    const onBf = snap.battlefield.map((i) => r.views[i]).find((v) => v.id === play.cardId);
    expect(onBf?.grpId).toBe(play.grp);
    const before = r.snapshots[play.snap - 1];
    const inHand = before.players[me].hand.map((i) => r.views[i].id);
    expect(inHand).toContain(play.cardId);
  });

  it('hides opponent hand cards', () => {
    const s = r.snapshots.find((x) => x.turn === 14)!;
    const opp = s.players[r.meta.oppSeat].hand.map((i) => r.views[i]);
    expect(opp.length).toBeGreaterThan(0);
    expect(opp.every((v) => v.grpId === 0)).toBe(true);
  });
});

describe('hypergeometric', () => {
  it('sums to 1', () => {
    let t = 0;
    for (let k = 0; k <= 17; k++) t += hypergeomPmf(40, 17, 28, k);
    expect(t).toBeCloseTo(1, 6);
  });
});
