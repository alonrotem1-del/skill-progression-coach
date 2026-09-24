/*
 * The Ring Support / Top Support identity split.
 *
 * Before this correction, Week.EX.tophold and Week.EX.ringsupport both resolved
 * to block.exId 'support', so a logged bar top hold and a logged ring support
 * were the same observation and nothing downstream could tell them apart. The
 * Ring Support progression in content bundle 1 could therefore not be assessed
 * from ring evidence, and the natural Ring Dip -> Ring Support dependency could
 * not be stated honestly.
 *
 * These tests pin the split and, just as importantly, pin what did NOT change:
 * the legacy benchmark still moves for both slots, exactly as before.
 */
const { test, expect } = require('@playwright/test');
const Week = require('../week.js');
const Data = require('../data.js');
const Progress = require('../progress.js');
const bundle = require('../content/bundle-1.json');

const mu = Data.worldsById.muscleup;
const seedStates = () => { const st = {}; mu.nodes.forEach(n => (st[n.id] = { criteria: {}, status: 'available' })); return st; };
const linksTo = (holderPred) => bundle.exerciseLinks.filter(l => holderPred(l.target));

test.describe('ring support identity — the two slots are distinct observations', () => {
  test('01 — the Top Hold slot logs bar support, the Ring Support slot logs ring support', () => {
    expect(Week.EX.tophold.block.exId).toBe('support');
    expect(Week.EX.ringsupport.block.exId).toBe('ring_support');
    expect(Week.EX.tophold.block.exId).not.toBe(Week.EX.ringsupport.block.exId);
  });

  test('02 — both ids exist in the app catalog, and neither name claims the other apparatus', () => {
    expect(Data.exercises.support).toBeTruthy();
    expect(Data.exercises.ring_support).toBeTruthy();
    expect(Data.exercises.support.name).not.toMatch(/Ring/);
    expect(Data.exercises.ring_support.name).toMatch(/Ring/);
    expect(Data.exercises.ring_support.equipment).toBe('Rings');
    expect(Data.exercises.ring_support.measure).toBe('sec');
  });

  test('03 — the runner is unchanged: both slots are still one hold block', () => {
    expect(Week.EX.ringsupport.block.scheme).toBe('hold');
    expect(Week.EX.tophold.block.scheme).toBe('hold');
    expect(Week.EX.ringsupport.block.seconds).toBe(20);
    expect(Week.EX.tophold.block.seconds).toBe(15);
    expect(Week.EX.ringsupport.block.label).toBe('Ring Support Hold');
  });

  test('04 — the legacy benchmark still moves for a ring support, as it did before the split', () => {
    const res = Progress.applyStrength(mu, seedStates(),
      { templateId: 'mu_dip', exResults: { ring_support: { bestSeconds: 24 } } }, Data.exercises);
    expect(res.bench.ring_support_secs).toBe(24);
  });

  test('05 — and still moves for a bar top hold, so no existing behaviour was taken away', () => {
    const res = Progress.applyStrength(mu, seedStates(),
      { templateId: 'mu_dip', exResults: { support: { bestSeconds: 18 } } }, Data.exercises);
    expect(res.bench.ring_support_secs).toBe(18);
  });

  test('06 — bundle 1 assesses the Ring Support progression from ring evidence only', () => {
    const inRingSupport = linksTo(t => t.kind === 'stage' && t.progressionId === 'rmu_ring_support');
    expect(inRingSupport.length).toBeGreaterThan(0);
    inRingSupport.forEach((l) => {
      expect(['ring_support', 'rto_support'], JSON.stringify(l)).toContain(l.exerciseId);
    });
    // The bar top hold is defined for id continuity but claims nothing about rings.
    expect(bundle.exercises.some(e => e.id === 'support')).toBe(true);
    expect(bundle.exerciseLinks.some(l => l.exerciseId === 'support')).toBe(false);
  });

  test('07 — no observation of the bar top hold can reach a ring criterion', () => {
    // A holder's criteria are reachable by any linked exercise that produces
    // their attributes, so apparatus separation has to hold at the link level.
    const holderKey = (t) => t.kind === 'stage' ? 'stage:' + t.stageId
      : t.kind === 'progression' ? 'progression:' + t.progressionId : 'goalTerminal:' + t.goalId;
    const ringHolders = new Set(
      bundle.exerciseLinks.filter(l => l.exerciseId === 'ring_support' || l.exerciseId === 'rto_support')
        .map(l => holderKey(l.target)));
    bundle.exerciseLinks.filter(l => l.exerciseId === 'support')
      .forEach(l => expect(ringHolders.has(holderKey(l.target))).toBe(false));
  });
});
