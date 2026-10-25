// The Foundation Path domain (program.js) and the program package.
// Pure Node tests: no page. They need the locally built package
// (private/beginner-program.json, git-ignored course content) and skip when it
// is absent, so the public repository never has to carry the course.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const P = require('../program.js');

const PKG_FILE = path.join(__dirname, '..', 'private', 'beginner-program.json');
const SRC_FILE = path.join(__dirname, '..', 'private', 'source.json');
const HAVE = fs.existsSync(PKG_FILE);
const pkg = HAVE ? JSON.parse(fs.readFileSync(PKG_FILE, 'utf8')) : null;

function migrated() { let s = P.emptyState(); P.migrationEvents().forEach((e) => { s = P.addEvent(s, e); }); return s; }
function completeWeek(s, weekId, except) {
  P.requiredOf(pkg, weekId).filter((id) => id !== except).forEach((id) => {
    if (!P.completions(s, id).length) s = P.addEvent(s, { type: 'workout_completed', workoutId: id, source: 'app', result: [] });
  });
  return s;
}
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();

test.describe('program package', () => {
  test.skip(!HAVE, 'program package not built on this machine');

  test('01 it is verified against its source, value by value', () => {
    test.skip(!fs.existsSync(SRC_FILE), 'source location unknown');
    const src = JSON.parse(fs.readFileSync(SRC_FILE, 'utf8'));
    test.skip(!fs.existsSync(src.master), 'source file not on this machine');
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'verify-program.cjs'), src.master, PKG_FILE], { encoding: 'utf8' });
    expect(r.stdout).toContain('every value matches the at-a-glance tables');
    expect(r.status, r.stdout).toBe(0);
  });

  test('02 shape: 6 phases, 24 weeks, 96 required + 24 optional, 7 Max Tests, 3 deloads', () => {
    expect(P.validatePackage(pkg).ok).toBe(true);
    const w = Object.values(pkg.workouts);
    expect(new Set(w.map((x) => x.phase)).size).toBe(6);
    expect(Object.keys(pkg.weeks).length).toBe(24);
    expect(w.filter((x) => !x.optional).length).toBe(96);
    expect(w.filter((x) => x.optional).length).toBe(24);
    expect(pkg.sequence.filter((s) => s.type === 'maxtest').map((s) => s.id)).toEqual(['MT0', 'MT1', 'MT2', 'MT3', 'MT4', 'MT5', 'MT6']);
    expect(pkg.sequence.filter((s) => s.type === 'deload').map((s) => s.id)).toEqual(['P4D', 'P5D', 'P6D']);
  });

  test('03 every row keeps its raw source text, its line and its Easy/Hard pair', () => {
    Object.values(pkg.workouts).forEach((w) => {
      expect(w.url).toMatch(/skool\.com/);
      w.blocks.forEach((b) => {
        expect(b.line).toBeGreaterThan(0);
        if (b.kind === 'exercise') { expect(b.raw.reps).toBeTruthy(); expect(b.hard === null || typeof b.hard === 'string').toBe(true); }
      });
    });
    const pairs = Object.values(pkg.workouts).reduce((a, w) => a + w.blocks.filter((b) => b.hard).length, 0);
    expect(pairs).toBeGreaterThan(100);
  });

  test('04 documented source ambiguities stay attached to their items', () => {
    const w = pkg.workouts['P4W3-3'];
    const b = w.blocks.find((x) => x.easy === 'Assisted 90 Degree Chin Ups');
    expect(b.qa).toContain('BP-7');
    expect(pkg.workouts['P6W3-2'].blocks.find((x) => x.style === 'pyramid').qa).toEqual(expect.arrayContaining(['BP-8', 'MU-7']));
    expect(pkg.workouts['P5W1-3'].blocks.find((x) => x.style === 'alternating').qa).toContain('BP-6');
  });
});

test.describe('position (source: sequence-based, no performance gates)', () => {
  test.skip(!HAVE, 'program package not built on this machine');

  test('05 the existing athlete starts at Phase 4 Week 3 with Push done', () => {
    const s = migrated();
    const v = P.pathView(pkg, s);
    expect(v.current.id).toBe('P4W3');
    expect(P.workoutStatus(pkg, s, 'P4W3-2').status).toBe('completed');
    expect(P.workoutStatus(pkg, s, 'P4W3-2').reported).toBe(true);
    ['P4W3-1', 'P4W3-3', 'P4W3-4'].forEach((id) => expect(P.workoutStatus(pkg, s, id).status).toBe('available'));
    expect(P.workoutStatus(pkg, s, 'P4W3-L').optional).toBe(true);
  });

  test('06 earlier content is placed past, never fabricated as done', () => {
    const v = P.pathView(pkg, migrated());
    const placed = v.nodes.filter((n) => n.status === 'placed').map((n) => n.id);
    expect(placed).toEqual(['MT0', 'P1W1', 'P1W2', 'P1W3', 'P1W4', 'MT1', 'P2W1', 'P2W2', 'P2W3', 'P2W4', 'MT2', 'P3W1', 'P3W2', 'P3W3', 'P3W4', 'MT3', 'P4D', 'P4W1', 'P4W2']);
    expect(v.nodes.filter((n) => n.status === 'done')).toEqual([]);
    expect(P.ofType(migrated(), 'workout_completed').length).toBe(1);
  });

  test('07 finishing the remaining required workouts moves to Week 4; legs stay optional', () => {
    const s = completeWeek(migrated(), 'P4W3');
    expect(P.pathView(pkg, s).current.id).toBe('P4W4');
    expect(P.completions(s, 'P4W3-L').length).toBe(0);
  });

  test('08 the Max Test sits after Week 4, records anything, and passes nothing', () => {
    let s = completeWeek(completeWeek(migrated(), 'P4W3'), 'P4W4');
    expect(P.pathView(pkg, s).current.id).toBe('MT4');
    s = P.addEvent(s, { type: 'maxtest_recorded', nodeId: 'MT4', date: new Date().toISOString(),
      results: [{ family: 'pull', variant: 'Rows', value: 1, unit: 'reps', valid: false }] });
    expect(P.pathView(pkg, s).current.id).toBe('P5D');
    expect(P.maxTestHistory(s).length).toBe(1);
    expect(P.foundationStatus(s).allPass).toBe(false);
  });

  test('09 deload, then Phase 5; Phase 6 ends at the Foundation Exit', () => {
    let s = completeWeek(completeWeek(migrated(), 'P4W3'), 'P4W4');
    s = P.addEvent(s, { type: 'maxtest_recorded', nodeId: 'MT4', results: [] });
    s = P.addEvent(s, { type: 'deload_completed', nodeId: 'P5D' });
    expect(P.pathView(pkg, s).current.id).toBe('P5W1');
    for (const p of [5, 6]) {
      if (p === 6) s = P.addEvent(s, { type: 'deload_completed', nodeId: 'P6D' });
      for (let w = 1; w <= 4; w++) s = completeWeek(s, 'P' + p + 'W' + w);
      s = P.addEvent(s, { type: 'maxtest_recorded', nodeId: 'MT' + p, results: [] });
    }
    const v = P.pathView(pkg, s);
    expect(v.current.id).toBe('FE');
    expect(P.academyStatus(s).open).toBe(false);
  });
});

test.describe('execution (SPC-v1: a valid value anywhere in the range counts)', () => {
  test.skip(!HAVE, 'program package not built on this machine');
  const range = { min: 6, max: 10, unit: 'reps' };

  test('10 inside the range is success; the top is never required', () => {
    expect(P.valueOutcome(range, 8)).toBe('met');
    expect(P.valueOutcome(range, 6)).toBe('met');
    expect(P.valueOutcome(range, 12)).toBe('met');
    expect(P.valueOutcome({ min: 10, max: 20, unit: 'sec' }, 10)).toBe('met');
  });

  test('11 below the range is kept as below, nothing logged is not-done', () => {
    expect(P.valueOutcome(range, 5)).toBe('below');
    expect(P.valueOutcome(range, 0)).toBe('below');
    expect(P.valueOutcome(range, null)).toBe('not-done');
    expect(P.setOutcome({ min: 6, max: 8, unit: 'reps', per: 'leg' }, { left: 7, right: 5 })).toBe('below');
  });

  test('12 a completion record never touches the prescription and keeps actual results', () => {
    const before = JSON.stringify(pkg.workouts['P4W3-3']);
    const run = { startedAt: new Date().toISOString(), blocks: pkg.workouts['P4W3-3'].blocks.map(() => ({})) };
    run.blocks[0] = { variant: 'hard', sets: [{ value: 4, done: true }, { value: 6, done: true }, { value: null, done: false }] };
    const ev = P.completionEvent(pkg, 'P4W3-3', run);
    expect(JSON.stringify(pkg.workouts['P4W3-3'])).toBe(before);
    expect(ev.result[0].sets.map((x) => x.value)).toEqual([4, 6, null]);
    expect(ev.summary.blocks[0].outcome).toBe('below');
    expect(ev.prescription.blocks[0].raw).toEqual(pkg.workouts['P4W3-3'].blocks[0].raw);
  });
});

test.describe('SPC Foundation Exit — Stage 5A Calibration v1', () => {
  const pass = (s, test, values, ago) => P.addEvent(s, { type: 'exit_test_recorded', test, values, valid: true, date: daysAgo(ago || 1) });
  function allSix(s, skip) {
    if (skip !== 'pullup') s = pass(s, 'pullup', { value: 5 });
    if (skip !== 'pushup') s = pass(s, 'pushup', { value: 15 });
    if (skip !== 'pbdip') s = pass(s, 'pbdip', { value: 5 });
    if (skip !== 'deadhang') s = pass(s, 'deadhang', { value: 30 });
    if (skip !== 'forearmplank') s = pass(s, 'forearmplank', { value: 60 });
    if (skip !== 'legs') s = pass(s, 'legs', { squats: 12, lungeR: 8, lungeL: 8 });
    return s;
  }

  test('13 the six thresholds are exactly the approved profile', () => {
    expect(P.FOUNDATION.map((d) => [d.id, d.test, d.need])).toEqual([
      ['F1', 'pullup', { value: 5 }], ['F2', 'pushup', { value: 15 }], ['F3', 'pbdip', { value: 5 }],
      ['F4', 'deadhang', { value: 30 }], ['F5', 'forearmplank', { value: 60 }], ['F6', 'legs', { squats: 12, lungeR: 8, lungeL: 8 }]]);
    expect(P.EXIT_EVIDENCE_DAYS).toBe(45);
  });

  test('14 all six pass → allPass; any one missing → not', () => {
    expect(P.foundationStatus(allSix(P.emptyState())).allPass).toBe(true);
    ['pullup', 'pushup', 'pbdip', 'deadhang', 'forearmplank', 'legs'].forEach((t) => {
      expect(P.foundationStatus(allSix(P.emptyState(), t)).allPass, t).toBe(false);
    });
  });

  test('15 one short, invalid (F7 not confirmed), one weak leg, or older than 45 days does not count', () => {
    expect(P.foundationStatus(pass(P.emptyState(), 'pullup', { value: 4 })).domains[0].status).toBe('not-yet');
    const inval = P.addEvent(P.emptyState(), { type: 'exit_test_recorded', test: 'pullup', values: { value: 9 }, valid: false, date: daysAgo(1) });
    expect(P.foundationStatus(inval).domains[0].status).toBe('not-yet');
    expect(P.foundationStatus(pass(P.emptyState(), 'legs', { squats: 12, lungeR: 8, lungeL: 7 })).domains[5].status).toBe('not-yet');
    expect(P.foundationStatus(pass(P.emptyState(), 'pullup', { value: 8 }, 46)).domains[0].status).toBe('stale');
  });

  test('16 a Max Test counts only when it is the very same test', () => {
    const mt = (r) => P.addEvent(P.emptyState(), { type: 'maxtest_recorded', nodeId: 'MT4', date: daysAgo(1), results: [Object.assign({ valid: true }, r)] });
    expect(P.foundationStatus(mt({ family: 'pull', variant: 'Pull Ups', grip: 'overhand', value: 9 })).domains[0].status).toBe('pass');
    expect(P.foundationStatus(mt({ family: 'pull', variant: 'Assisted Pull Ups', grip: 'overhand', value: 9 })).domains[0].status).toBe('no-evidence');
    expect(P.foundationStatus(mt({ family: 'pull', variant: 'Pull Ups', grip: 'overhand', assisted: true, value: 9 })).domains[0].status).toBe('no-evidence');
    expect(P.foundationStatus(mt({ family: 'dip', variant: 'Chair Dips', value: 15 })).domains[2].status).toBe('no-evidence');
    expect(P.foundationStatus(mt({ family: 'dip', variant: 'Dips', apparatus: 'two-chairs', value: 15 })).domains[2].status).toBe('no-evidence');
    expect(P.foundationStatus(mt({ family: 'dip', variant: 'Dips', apparatus: 'parallel-bars', value: 8 })).domains[2].status).toBe('pass');
    expect(P.foundationStatus(mt({ family: 'plank', variant: 'Plank Hold', plankForm: 'straight-arm', value: 200 })).domains[4].status).toBe('no-evidence');
  });
});

test.describe('SPC Academy (minimum: Ring Muscle-Up + Pistol Squat)', () => {
  const passed = (s) => P.addEvent(s, { type: 'foundation_exit_passed' });
  const rec = (s, test, v) => P.addEvent(s, { type: 'exit_test_recorded', test, values: { value: v }, valid: true, date: new Date().toISOString() });

  test('17 globally locked until the Foundation Exit is passed', () => {
    const a = P.academyStatus(rec(rec(P.emptyState(), 'pullup', 9), 'pbdip', 9));
    expect(a.open).toBe(false);
    expect(a.goals.every((g) => g.status === 'locked-foundation')).toBe(true);
  });

  test('18 Ring Muscle-Up needs 6 + 6 of the same tests; 5 + 5 is not enough; Foundation evidence is reused', () => {
    let s = passed(rec(rec(P.emptyState(), 'pullup', 5), 'pbdip', 5));
    expect(P.academyStatus(s).goals.find((g) => g.id === 'ring_muscle_up').status).toBe('locked-entry');
    s = rec(rec(s, 'pullup', 7), 'pbdip', 8);
    expect(P.academyStatus(s).goals.find((g) => g.id === 'ring_muscle_up').status).toBe('open');
  });

  test('19 Pistol Squat opens with the Foundation; nothing else is offered as a goal yet', () => {
    const a = P.academyStatus(passed(P.emptyState()));
    expect(a.goals.find((g) => g.id === 'pistol_squat').status).toBe('open');
    expect(a.goals.map((g) => g.id)).toEqual(['ring_muscle_up', 'pistol_squat']);
    // No in-goal stages (Stage 5B) are part of this build.
    a.goals.forEach((g) => expect(Object.keys(g).sort()).toEqual(['entryText', 'id', 'label', 'needs', 'status']));
  });
});
