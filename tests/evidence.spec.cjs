// Skill Progression Coach — P3: the evidence tap.
//
// Three layers, because the risks are in three different places.
//
//   evidence.js alone (node)     — is the row a truthful record of what was
//                                  performed, at the granularity the runner
//                                  actually held?
//   evidence.js + evaluator.js   — does a row mean what the authored content
//                                  says it means, and nothing more?
//   the real page (Chromium)     — execution identity across resume, the
//                                  unique index, the ordering invariant, and
//                                  the promise that nothing the athlete sees
//                                  has changed.
//
// The third layer uses real IndexedDB through page.evaluate rather than a shim:
// duplicate immunity IS a database constraint here, and a fake would prove
// nothing about the thing doing the work.
const { test, expect } = require('@playwright/test');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const EV = require(path.join(REPO, 'evidence.js'));
const Evaluator = require(path.join(REPO, 'evaluator.js'));
const BUNDLE = require(path.join(REPO, 'content', 'bundle-1.json'));
const SEMANTICS = require(path.join(REPO, 'content', 'semantics-1.json'));

const PKG = {
  contextId: 'ctx_1',
  manifest: { id: 'ctx_1', contentBundleVersion: BUNDLE.version, evaluationSemanticsVersion: SEMANTICS.version },
  contentBundle: BUNDLE,
  evaluationSemantics: SEMANTICS
};
const CTX = () => ({ contextId: 'ctx_1', bundle: BUNDLE, unmetDependencies: [], now: '2026-09-27T10:00:00.000Z', workoutId: 'w_test' });

// A live straight block, exactly as buildWorkout leaves it.
function straight(exId, sets, opts) {
  opts = opts || {};
  return {
    kind: 'straight', scheme: opts.scheme || 'sets', label: exId, exId, note: '',
    restSecs: 90, adaptEnabled: true, sets
  };
}
function set(target, actual, done, extra) {
  const s = { target, actual, unit: 'reps', doneFlag: !!done, adapted: '' };
  if (extra) Object.keys(extra).forEach((k) => (s[k] = extra[k]));
  return s;
}
function hold(target, actual, done, extra) {
  const s = { target, actual, unit: 'sec', doneFlag: !!done, adapted: '' };
  if (extra) Object.keys(extra).forEach((k) => (s[k] = extra[k]));
  return s;
}
function ladder(exId, rounds) {
  return {
    kind: 'ladder', label: exId, exId, note: '', restStepSec: 10, restRoundSec: 90,
    adaptEnabled: true, origSteps: [1, 2, 3], rounds
  };
}
function round(steps) { return { steps, rated: true, difficulty: 'appropriate', adaptedNote: '', reduced: false }; }

// ══════════════════════════════════════════════════════════════════════════
// evidence.js — is the row true?
// ══════════════════════════════════════════════════════════════════════════
test.describe('P3 evidence.js — what was performed', () => {
  test('01 plain sets become one observation per performed set, carrying the ACTUAL', () => {
    const w = { workoutId: 'w1', blocks: [straight('dip', [set(6, 6, true), set(6, 4, true), set(6, 5, true)])] };
    const rows = EV.fromWorkout(w, CTX());
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.attributes.reps)).toEqual([6, 4, 5]);
    expect(rows.map((r) => r.sequenceInItem)).toEqual([1, 2, 3]);
    rows.forEach((r) => {
      expect(r.kind).toBe('PerformanceObservation');
      expect(r.exerciseId).toBe('dip');
      expect(r.sourceWorkoutItem).toEqual({ workoutId: 'w1', itemIndex: 0 });
    });
  });

  test('02 a set that was not performed emits nothing at all', () => {
    const w = { workoutId: 'w1', blocks: [straight('dip', [
      set(6, 6, true), set(6, 6, false), set(6, 0, false, { skipped: true })])] };
    const rows = EV.fromWorkout(w, CTX());
    expect(rows.length).toBe(1);
    expect(rows[0].sequenceInItem).toBe(1);
  });

  test('03 the planned value is never recorded as the actual one', () => {
    // The whole point of tapping before exerciseResult: a set that fell short
    // records what happened, not what was asked.
    const w = { workoutId: 'w1', blocks: [straight('dip', [set(10, 3, true)])] };
    const rows = EV.fromWorkout(w, CTX());
    expect(rows[0].attributes.reps).toBe(3);
    // What was asked survives separately, so planned-versus-actual stays a join.
    expect(rows[0].context.prescribedDose.target).toBe(10);
    expect(rows[0].context.prescribedDose.scheme).toBe('sets');
  });

  test('04 a ladder of 1-2-3 x 5 yields fifteen rows with per-step actuals', () => {
    const rounds = [];
    for (let r = 0; r < 5; r++) rounds.push(round([set(1, 1, true), set(2, 2, true), set(3, 3, true)]));
    const w = { workoutId: 'w1', blocks: [ladder('pullup', rounds)] };
    const rows = EV.fromWorkout(w, CTX());
    expect(rows.length).toBe(15);
    expect(rows.map((r) => r.attributes.reps)).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3]);
    // sequenceInItem runs across the block, so the ladder can be redisplayed in
    // order by a reader that has never heard of a ladder.
    expect(rows.map((r) => r.sequenceInItem)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    // And this is exactly what the legacy normaliser destroys: 30 reps, best 3.
    expect(rows.reduce((n, r) => n + r.attributes.reps, 0)).toBe(30);
  });

  test('05 a partial ladder records only the steps that were performed', () => {
    const w = { workoutId: 'w1', blocks: [ladder('pullup', [
      round([set(1, 1, true), set(2, 2, true), set(3, 3, true)]),
      round([set(1, 1, true), set(2, 1, true), set(3, 0, false)])])] };
    const rows = EV.fromWorkout(w, CTX());
    expect(rows.length).toBe(5);
    expect(rows.map((r) => r.attributes.reps)).toEqual([1, 2, 3, 1, 1]);
    expect(rows.map((r) => r.sequenceInItem)).toEqual([1, 2, 3, 4, 5]);
  });

  test('06 a pyramid records its real performed sequence, extra sets included', () => {
    // A pyramid's planned and extra sets share one array; both are performed
    // work, so both are facts. exerciseResult sums the extras away.
    const w = { workoutId: 'w1', blocks: [straight('pullup', [
      set(5, 5, true), set(4, 4, true), set(3, 3, true), set(2, 2, true), set(1, 1, true),
      set(3, 3, true, { extra: 'backoff' })], { scheme: 'pyramid' })] };
    const rows = EV.fromWorkout(w, CTX());
    expect(rows.map((r) => r.attributes.reps)).toEqual([5, 4, 3, 2, 1, 3]);
    expect(rows.every((r) => r.context.prescribedDose.scheme === 'pyramid')).toBe(true);
  });

  test('07 a timed hold records its real elapsed seconds, including one stopped early', () => {
    const w = { workoutId: 'w1', blocks: [straight('ring_support', [
      hold(20, 20, true), hold(20, 12, true, { stoppedEarly: true }), hold(20, 18, true)],
    { scheme: 'hold' })] };
    const rows = EV.fromWorkout(w, CTX());
    expect(rows.map((r) => r.attributes.seconds)).toEqual([20, 12, 18]);
    expect(rows.every((r) => r.attributes.reps === undefined)).toBe(true);
    // The target is nowhere in the measurement — only beside it.
    expect(rows[1].context.prescribedDose.target).toBe(20);
  });

  test('08 provenance stays demonstrated however far short the set fell', () => {
    const w = { workoutId: 'w1', blocks: [straight('dip', [set(20, 1, true)])] };
    const rows = EV.fromWorkout(w, CTX());
    expect(rows[0].provenance).toBe('demonstrated');
    expect(rows[0].provenanceSource).toBe('in_session');
    // Falling short is not a reason to relabel a real performance as a claim
    // (invariant 04). It is simply a small true number.
    expect(rows[0].attributes.reps).toBe(1);
  });

  test('09 an attribute the exercise does not produce is absent, never invented', () => {
    // pullup produces reps and kip; the runner observes only reps. kip is left
    // out rather than assumed false, which is what makes the evaluator able to
    // say missing_attribute instead of guessing.
    const w = { workoutId: 'w1', blocks: [straight('pullup', [set(6, 6, true)])] };
    const rows = EV.fromWorkout(w, CTX());
    expect(Object.keys(rows[0].attributes)).toEqual(['reps']);
    // And an exercise that produces no attribute at all gets none.
    expect(EV.attributesFor(BUNDLE, 'bouldering', 'reps', 4)).toEqual({});
    expect(EV.attributesFor(BUNDLE, 'deadhang', 'reps', 4)).toEqual({});
    expect(EV.attributesFor(BUNDLE, 'deadhang', 'sec', 40)).toEqual({ seconds: 40 });
  });

  test('10 an observation carries no criterion, no verdict and no status', () => {
    const w = { workoutId: 'w1', blocks: [straight('dip', [set(6, 6, true)])] };
    const r = EV.fromWorkout(w, CTX())[0];
    ['criterionId', 'status', 'satisfied', 'progressionId', 'stageId', 'goalId', 'valid', 'nodeId']
      .forEach((k) => expect(Object.keys(r), k).not.toContain(k));
    expect(Object.keys(r).sort()).toEqual(['attributes', 'context', 'dedupeKey', 'exerciseId', 'kind',
      'occurredAt', 'provenance', 'provenanceSource', 'recordedAt', 'sequenceInItem', 'side',
      'sourceWorkoutItem'].sort());
  });

  test('11 the observation context is the point-in-time snapshot, by value', () => {
    const ctx = CTX();
    ctx.unmetDependencies = ['dep_transition_needs_rto', 'dep_rmu_needs_false_grip'];
    const r = EV.fromWorkout({ workoutId: 'w1', blocks: [straight('dip', [set(6, 6, true)])] }, ctx)[0];
    expect(r.context.contextId).toBe('ctx_1');
    expect(r.context.unmetDependencies).toEqual(['dep_transition_needs_rto', 'dep_rmu_needs_false_grip']);
    // A copy, so a later change to the caller's array cannot rewrite history.
    ctx.unmetDependencies.push('dep_pistol_needs_ankle');
    expect(r.context.unmetDependencies.length).toBe(2);
    // Readiness is empty because none was derived: P3 computes no readiness,
    // and UI.readiness is a transient value in a different shape. Empty is the
    // honest record of "none", not a placeholder for one.
    expect(r.context.readiness).toEqual({});
    expect(r.context.accommodationInForce).toBeNull();
  });

  test('12 side is recorded when the caller knows it, and null when it does not', () => {
    const w = { workoutId: 'w1', blocks: [straight('pistol', [set(5, 5, true)])] };
    expect(EV.fromWorkout(w, CTX())[0].side).toBeNull();
    const left = Object.assign(CTX(), { side: 'left' });
    expect(EV.fromWorkout(w, left)[0].side).toBe('left');
    const right = Object.assign(CTX(), { side: 'right' });
    expect(EV.fromWorkout(w, right)[0].side).toBe('right');
  });

  test('13 the runner supplies no side, so nothing in the app can fabricate one', () => {
    const fs = require('fs');
    const app = fs.readFileSync(path.join(REPO, 'app.js'), 'utf8');
    const tap = app.slice(app.indexOf('function tapWorkoutEvidence'), app.indexOf('// ---- workout state persistence'));
    expect(tap).not.toMatch(/side\s*[:=]\s*['"](left|right|both)['"]/);
    // Nor does the runner hold one to pass: no set or step carries a side.
    const built = app.slice(app.indexOf('function buildWorkout'), app.indexOf('function pyramidLastCompletedStart'));
    expect(built).not.toMatch(/side\s*:/);
  });

  test('14 fromClimb emits one ActivityObservation and no PerformanceObservation', () => {
    const session = { problems: [{ grade: 'V4', style: 'overhang', result: 'send' },
      { grade: 'V2', style: 'vertical', result: 'flash' }], rpe: 5, finger: 1, skin: 2, hardPull: true };
    const rows = EV.fromClimb(session, CTX());
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe('ActivityObservation');
    // §6: it has no exercise, no attributes and no side — which is exactly why
    // it is a different row type. A V4 send is load, not criterion evidence.
    expect(rows[0].exerciseId).toBeUndefined();
    expect(rows[0].attributes).toBeUndefined();
    expect(rows[0].side).toBeUndefined();
    expect(rows[0].intensity).toBe('hard');
    expect(rows[0].loadDimensions).toEqual({ pulling: 'high', grip: 'high' });
    expect(rows[0].problems.length).toBe(2);
    expect(rows[0].context.contextId).toBe('ctx_1');
  });

  test('15 the dedupe key is deterministic and built only from execution coordinates', () => {
    expect(EV.setKey('w1', 0, 2)).toBe('w1:0:s:2');
    expect(EV.stepKey('w1', 1, 3, 2)).toBe('w1:1:r:3:2');
    expect(EV.climbKey('c1')).toBe('c1:climb');
    // No timestamp, no counter, no measured value anywhere in it.
    const w = { workoutId: 'w1', blocks: [straight('dip', [set(6, 6, true), set(6, 4, true)])] };
    const first = EV.fromWorkout(w, CTX()).map((r) => r.dedupeKey);
    const later = EV.fromWorkout(w, Object.assign(CTX(), { now: '2027-01-01T00:00:00.000Z' })).map((r) => r.dedupeKey);
    expect(later).toEqual(first);
    expect(first).toEqual(['w1:0:s:0', 'w1:0:s:1']);
    first.forEach((k) => expect(k).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{13}/));
    // Two sets that happened to match still have different keys.
    const same = EV.fromWorkout({ workoutId: 'w1', blocks: [straight('dip', [set(6, 6, true), set(6, 6, true)])] }, CTX());
    expect(same[0].dedupeKey).not.toBe(same[1].dedupeKey);
  });

  test('16 the same performance re-tapped produces the same keys, so a replay is a duplicate', () => {
    const w = { workoutId: 'w1', blocks: [
      ladder('pullup', [round([set(1, 1, true), set(2, 2, true)])]),
      straight('dip', [set(6, 6, true)])] };
    const a = EV.fromWorkout(w, CTX()).map((r) => r.dedupeKey);
    const b = EV.fromWorkout(JSON.parse(JSON.stringify(w)), CTX()).map((r) => r.dedupeKey);
    expect(b).toEqual(a);
    expect(a).toEqual(['w1:0:r:0:0', 'w1:0:r:0:1', 'w1:1:s:0']);
  });

  test('17 building rows mutates nothing it was given', () => {
    const w = { workoutId: 'w1', blocks: [ladder('pullup', [round([set(1, 1, true)])]),
      straight('dip', [set(6, 5, true)])] };
    const before = JSON.parse(JSON.stringify(w));
    const ctx = CTX();
    const ctxBefore = JSON.parse(JSON.stringify(ctx));
    EV.fromWorkout(w, ctx);
    expect(w).toEqual(before);
    expect(ctx).toEqual(ctxBefore);
  });

  test('18 a row cannot be built without an execution identity and a context', () => {
    const w = { blocks: [straight('dip', [set(6, 6, true)])] };
    expect(() => EV.fromWorkout(w, { contextId: 'ctx_1', bundle: BUNDLE, now: 'x' })).toThrow(/execution identity/);
    expect(() => EV.fromWorkout(w, { workoutId: 'w1', bundle: BUNDLE, now: 'x' })).toThrow(/context/);
    expect(() => EV.fromClimb({ problems: [] }, { contextId: 'ctx_1', now: 'x' })).toThrow(/execution identity/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// evidence.js + evaluator.js — does the row mean what content says it means?
// ══════════════════════════════════════════════════════════════════════════
test.describe('P3 evidence meets the evaluator', () => {
  // Rows as the ledger will hold them: seq assigned by the database.
  function ledgerOf(rows) {
    return rows.map((r, i) => Object.assign({}, r, { seq: i + 1 }));
  }

  test('19 an assess-linked movement recorded by the tap is evidence-eligible', () => {
    // ring_support assesses stage rmu_sup_s1, whose criterion asks for 20
    // seconds — and seconds is something the runner genuinely measures.
    const rows = EV.fromWorkout({ workoutId: 'w1', blocks: [
      straight('ring_support', [hold(20, 21, true)], { scheme: 'hold' })] }, CTX());
    const ev = Evaluator.evaluateCriterion('sup_ring_20', 'combined', ledgerOf(rows), PKG);
    expect(ev.status).toBe('satisfied');
    expect(ev.satisfiedBy).toEqual([1]);
    expect(Evaluator.isRequirementSatisfied('stage:rmu_sup_s1', ledgerOf(rows), PKG, null)).toBe(true);
  });

  test('20 a train-linked movement never becomes progression evidence, however good', () => {
    // deadhang trains false grip; fg_hang assesses it. A 300-second deadhang is
    // a true fact and is recorded as one — it is simply not evidence ABOUT the
    // false-grip criterion, because the content does not say it is (P4.1).
    const rows = EV.fromWorkout({ workoutId: 'w1', blocks: [
      straight('deadhang', [hold(30, 300, true)], { scheme: 'hold' })] }, CTX());
    expect(rows[0].attributes.seconds).toBe(300);
    const ev = Evaluator.evaluateCriterion('fg_hang_30', 'combined', ledgerOf(rows), PKG);
    expect(ev.status).toBe('unsatisfied');
    expect(ev.satisfiedBy).toEqual([]);
    // Not excluded either — it is simply not applicable, which is a different
    // and more honest answer than "set aside for a reason".
    expect(ev.excluded).toEqual([]);
    expect(Evaluator.isRequirementSatisfied('progression:rmu_false_grip', ledgerOf(rows), PKG, null)).toBe(false);
  });

  test('21 nor does a maintain-linked movement, and the tap applies no gate of its own', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(REPO, 'evidence.js'), 'utf8');
    // The rule lives in ONE place — the evaluator's link index. The tap must
    // not re-implement it, or the two copies will disagree.
    expect(src).not.toContain('assess');
    expect(src).not.toContain('exerciseLinks');
    // bulgarian_split trains pistol strength S1; box_pistol assesses it.
    const rows = EV.fromWorkout({ workoutId: 'w1', blocks: [
      straight('bulgarian_split', [set(8, 20, true)])] }, CTX());
    const ev = Evaluator.evaluateCriterion('slstr_box_5', 'left', ledgerOf(rows), PKG);
    expect(ev.satisfiedBy).toEqual([]);
    expect(ev.status).toBe('unsatisfied');
  });

  test('22 a bilateral row behaves exactly as the authored side scope says', () => {
    // The runner records no side, so a pistol row is side null. Against a
    // per-side Criterion that is wrong_side — declined, with a reason — and
    // against a combined-scope Criterion it is admitted. Content decides.
    const pistol = ledgerOf(EV.fromWorkout({ workoutId: 'w1', blocks: [
      straight('pistol', [set(5, 5, true)])] }, CTX()));
    const perSide = Evaluator.evaluateCriterion('pistol_terminal', 'left', pistol, PKG);
    expect(perSide.satisfiedBy).toEqual([]);
    expect(perSide.excluded).toEqual([{ seq: 1, reason: 'wrong_side' }]);

    const combined = ledgerOf(EV.fromWorkout({ workoutId: 'w2', blocks: [
      straight('ring_support', [hold(20, 25, true)], { scheme: 'hold' })] }, CTX()));
    expect(Evaluator.evaluateCriterion('sup_ring_20', 'combined', combined, PKG).satisfiedBy).toEqual([1]);
  });

  test('23 a left row stays left-scoped and a right row stays right-scoped', () => {
    const w = { workoutId: 'w1', blocks: [straight('box_pistol', [set(5, 6, true)])] };
    const left = ledgerOf(EV.fromWorkout(w, Object.assign(CTX(), { side: 'left' })));
    const right = ledgerOf(EV.fromWorkout(w, Object.assign(CTX(), { side: 'right' })));
    expect(left[0].side).toBe('left');
    expect(right[0].side).toBe('right');
    // box_pistol needs depth too, which the runner does not observe — so the
    // per-side verdict is missing_attribute, not satisfied. The SIDE is still
    // scoped correctly, which is what this test is about: the left row is
    // considered on the left and declined as wrong_side on the right.
    expect(Evaluator.evaluateCriterion('slstr_box_5', 'left', left, PKG).excluded)
      .toEqual([{ seq: 1, reason: 'missing_attribute(depth)' }]);
    expect(Evaluator.evaluateCriterion('slstr_box_5', 'right', left, PKG).excluded)
      .toEqual([{ seq: 1, reason: 'wrong_side' }]);
    expect(Evaluator.evaluateCriterion('slstr_box_5', 'right', right, PKG).excluded)
      .toEqual([{ seq: 1, reason: 'missing_attribute(depth)' }]);
    expect(Evaluator.evaluateCriterion('slstr_box_5', 'left', right, PKG).excluded)
      .toEqual([{ seq: 1, reason: 'wrong_side' }]);
  });

  test('24 an empty ledger makes every Dependency unmet, and says so truthfully', () => {
    const unmet = Evaluator.unmetDependencies([], PKG);
    const ids = unmet.map((u) => u.dependencyId);
    BUNDLE.dependencies.forEach((d) => expect(ids, d.id).toContain(d.id));
    // "No evidence" rather than a guess: there is nothing in the ledger to go on.
    unmet.forEach((u) => expect(u.reason, u.dependencyId).toBe('no_evidence'));
  });

  test('25 a Dependency the ledger genuinely satisfies is not recorded as unmet', () => {
    // dep_transition_needs_rto requires stage rmu_sup_s2 — rto_support for 20
    // seconds, which the runner can measure.
    const rows = ledgerOf(EV.fromWorkout({ workoutId: 'w1', blocks: [
      straight('rto_support', [hold(20, 25, true)], { scheme: 'hold' })] }, CTX()));
    const ids = Evaluator.unmetDependencies(rows, PKG).map((u) => u.dependencyId);
    expect(ids).not.toContain('dep_transition_needs_rto');
    // The others are untouched by that evidence and remain unmet.
    expect(ids).toContain('dep_rmu_needs_false_grip');
  });

  test('26 what the runner measures decides what can be proved, and the rest says so', () => {
    // A deliberate, documented boundary of P3: the runner measures reps and
    // seconds. It does not observe kip, depth, execution, catch_quality or cm,
    // so a Criterion needing one of those reports missing_attribute rather than
    // being quietly satisfied by a default. Asking the athlete for those is a
    // UI change, and P3 changes no UI.
    const measurable = BUNDLE.criteria.filter((c) =>
      c.conditions.every((x) => x.attribute === 'reps' || x.attribute === 'seconds'));
    expect(measurable.map((c) => c.id).sort()).toEqual(['dip_bar_5', 'dip_ring_5', 'exp_c2b_3',
      'exp_c2r_3', 'exp_highpull_3', 'fg_hang_30', 'sup_ring_20', 'sup_rto_20']);
    // And the honest answer for one that is not measurable.
    const rows = ledgerOf(EV.fromWorkout({ workoutId: 'w1', blocks: [
      straight('pullup', [set(5, 12, true)])] }, CTX()));
    const ev = Evaluator.evaluateCriterion('rmu_pull_10', 'combined', rows, PKG);
    expect(ev.excluded).toEqual([{ seq: 1, reason: 'missing_attribute(kip)' }]);
    expect(ev.status).toBe('unsatisfied');
  });

  test('27 no Group Log evidence path exists anywhere in P3', () => {
    const fs = require('fs');
    ['evidence.js', 'app.js', 'idb.js', 'evaluator.js', 'context.js'].forEach((f) => {
      const src = fs.readFileSync(path.join(REPO, f), 'utf8');
      expect(src, f).not.toContain('fromGroupLog');
    });
    const ev = fs.readFileSync(path.join(REPO, 'evidence.js'), 'utf8');
    ['groupLog', 'GROUP_MOVES', 'dayLog'].forEach((n) => expect(ev, n).not.toContain(n));
    // The tap is called from exactly three places, and saveGroupLog is not one.
    const app = fs.readFileSync(path.join(REPO, 'app.js'), 'utf8');
    const calls = app.match(/tap(Workout|Climb)Evidence\(/g) || [];
    expect(calls.length).toBe(5);        // 2 definitions + 3 call sites
    const groupLog = app.slice(app.indexOf('function saveGroupLog'));
    expect(groupLog.slice(0, groupLog.indexOf('\n  function ', 10))).not.toContain('Evidence');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// the real page — identity, the unique index, the ordering, and no cutover
// ══════════════════════════════════════════════════════════════════════════

async function fresh(page) {
  await page.goto('index.html');
  await page.evaluate(async () => {
    const I = window.CoachIDB;
    try { await I.init(); } catch (e) {}
    try { if (window.CoachContext) await window.CoachContext.init(); } catch (e) {}
    try { const db = await I.open(); db.close(); } catch (e) {}
    I._reset();
    if (window.CoachContext) window.CoachContext._reset();
    await new Promise((res) => {
      const r = indexedDB.deleteDatabase('spc');
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  });
}

async function seed(page, dayId) {
  await page.addInitScript((d) => { window.__spcTodayId = d; }, dayId);
  await page.goto('index.html');
  await page.evaluate(() => {
    const S = window.CoachStore.makeStore(), D = window.CoachData, E = window.CoachEngine;
    const bench = { pullup_max: 9, dips_max: 6 }; const state = {};
    D.worlds.forEach((w) => {
      const nodes = window.CoachStore.seedStates(w, bench);
      const f = E.autoFocus(w, nodes);
      state[w.id] = { nodes, focus: { primary: f.primary, supporting: f.supporting, manual: false } };
    });
    S.setBench(bench); S.setState(state);
    S.setProfile({ onboarded: true, activeWorld: 'muscleup', days: [0, 2, 4], duration: 'normal' });
    ['spc_c_day', 'spc_c_sessions', 'spc_c_workout', 'spc_c_adhoc', 'spc_c_plan', 'spc_c_templates']
      .forEach((k) => localStorage.removeItem(k));
  });
  await page.reload();
}

// Put one planned exercise on today, so it can be started from the queue.
async function assign(page, exKey, dayId, target) {
  await page.evaluate(({ exKey, dayId, target }) => {
    const S = window.CoachStore.makeStore(); const p = S.getPlan();
    p.requirements[exKey].days = [dayId]; p.requirements[exKey].target = target || 1; S.setPlan(p);
  }, { exKey, dayId, target });
  await page.reload();
}

async function runToFinishPanel(page) {
  for (let i = 0; i < 160; i++) {
    if (await page.locator('[data-finish],[data-finishex]').count()) return;
    if (await page.locator('[data-diff="appropriate"]').count()) { await page.locator('[data-diff="appropriate"]').first().click(); continue; }
    if (await page.locator('[data-pyrdiff="appropriate"]').count()) { await page.locator('[data-pyrdiff="appropriate"]').first().click(); continue; }
    if (await page.locator('[data-tskip]').count()) { await page.locator('[data-tskip]').first().click(); continue; }
    if (await page.locator('.cur-card [data-done]').count()) { await page.locator('.cur-card [data-done]').first().click(); continue; }
    await page.waitForTimeout(40);
  }
  throw new Error('runner never reached a finish panel');
}

// The ledger, once the tap has settled. The tap is deliberately fire-and-forget,
// so a test waits for it rather than assuming it already ran.
async function ledgerAfterTap(page, expected) {
  for (let i = 0; i < 80; i++) {
    const rows = await page.evaluate(() => window.CoachIDB.all('ledger'));
    if (rows.length >= (expected || 1)) return rows;
    await page.waitForTimeout(50);
  }
  return page.evaluate(() => window.CoachIDB.all('ledger'));
}

test.describe('P3 execution identity', () => {
  test('28 a workoutId and startedAt are minted once when the workout is built', async ({ page }) => {
    await seed(page, 2); await assign(page, 'pbdips', 2, 1);
    await page.locator('.q-ex', { hasText: 'Parallel Bar Dips' }).locator('[data-exstart]').click();
    const first = await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_workout')).data);
    expect(typeof first.workoutId).toBe('string');
    expect(first.workoutId.length).toBeGreaterThan(8);
    expect(Number.isNaN(Date.parse(first.startedAt))).toBe(false);
    // Two different executions are two different identities.
    const second = await page.evaluate(() => {
      const a = window.CoachApp._evidence.newId('w'), b = window.CoachApp._evidence.newId('w');
      return { a, b };
    });
    expect(second.a).not.toBe(second.b);
  });

  test('29 a resumed workout reuses its identity — a reload does not start a second execution', async ({ page }) => {
    await seed(page, 2); await assign(page, 'pbdips', 2, 1);
    await page.locator('.q-ex', { hasText: 'Parallel Bar Dips' }).locator('[data-exstart]').click();
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_workout')).data);
    await page.reload();
    await expect(page.locator('.wk-block-wrap').first()).toBeVisible();
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_workout')).data);
    expect(after.workoutId).toBe(before.workoutId);
    expect(after.startedAt).toBe(before.startedAt);
    // And again, because a resume must be repeatable.
    await page.reload();
    await expect(page.locator('.wk-block-wrap').first()).toBeVisible();
    const third = await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_workout')).data);
    expect(third.workoutId).toBe(before.workoutId);
    expect(third.startedAt).toBe(before.startedAt);
  });

  test('30 a climbing session has a stable execution identity across resume', async ({ page }) => {
    await seed(page, 0);
    await page.locator('.q-ex.q-base').locator('[data-exstart]').click();
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_workout')).data);
    expect(typeof before.workoutId).toBe('string');
    expect(before.workoutId.indexOf('c_')).toBe(0);
    expect(Number.isNaN(Date.parse(before.startedAt))).toBe(false);
    await page.reload();
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_workout')).data);
    expect(after.workoutId).toBe(before.workoutId);
    expect(after.startedAt).toBe(before.startedAt);
  });
});

test.describe('P3 the unique index', () => {
  test('31 a second row with the same dedupeKey is refused by the database itself', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      const row = { kind: 'PerformanceObservation', exerciseId: 'dip', dedupeKey: 'w1:0:s:0', attributes: { reps: 6 } };
      const first = await I.appendUnique('ledger', row);
      const second = await I.appendUnique('ledger', row);
      // Even a DIFFERENT row under the same key is refused: the key identifies
      // the execution coordinate, not the values.
      const third = await I.appendUnique('ledger', { kind: 'PerformanceObservation', exerciseId: 'dip', dedupeKey: 'w1:0:s:0', attributes: { reps: 99 } });
      return { first, second, third, count: await I.count('ledger'), rows: await I.all('ledger') };
    });
    expect(r.first).toEqual({ appended: true, duplicate: false, seq: 1 });
    expect(r.second).toEqual({ appended: false, duplicate: true, seq: null });
    expect(r.third).toEqual({ appended: false, duplicate: true, seq: null });
    expect(r.count).toBe(1);
    // A duplicate is not turned into an update: the first row is untouched.
    expect(r.rows[0].attributes.reps).toBe(6);
  });

  test('32 a duplicate in the middle of a workout does not cost the rows around it', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      const mk = (k, reps) => ({ kind: 'PerformanceObservation', exerciseId: 'dip', dedupeKey: k, attributes: { reps } });
      await I.appendUnique('ledger', mk('w1:0:s:1', 5));       // already present
      const results = [];
      for (const row of [mk('w1:0:s:0', 6), mk('w1:0:s:1', 5), mk('w1:0:s:2', 4)]) {
        results.push(await I.appendUnique('ledger', row));
      }
      return { results, rows: await I.all('ledger') };
    });
    expect(r.results.map((x) => x.appended)).toEqual([true, false, true]);
    expect(r.results[1].duplicate).toBe(true);
    expect(r.rows.map((x) => x.dedupeKey).sort()).toEqual(['w1:0:s:0', 'w1:0:s:1', 'w1:0:s:2']);
  });

  test('33 rows that carry no dedupeKey are not constrained by the index', async ({ page }) => {
    await fresh(page);
    // A unique index skips records whose key path is absent, which is what lets
    // schema-1 rows and future row types coexist with the constraint.
    const count = await page.evaluate(async () => {
      const I = window.CoachIDB;
      await I.append('ledger', { kind: 'PerformanceObservation', exerciseId: 'dip' });
      await I.append('ledger', { kind: 'PerformanceObservation', exerciseId: 'dip' });
      return I.count('ledger');
    });
    expect(count).toBe(2);
  });

  test('34 a schema-1 database upgrades to 2 with every row intact', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      // Build the P2/P5-era layout by hand at version 1, with real rows in it.
      await new Promise((res, rej) => {
        const req = indexedDB.open('spc', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          const led = db.createObjectStore('ledger', { keyPath: 'seq', autoIncrement: true });
          ['exerciseId', 'occurredAt', 'kind'].forEach((i) => led.createIndex(i, i));
          const ev = db.createObjectStore('events', { keyPath: 'seq', autoIncrement: true });
          ['kind', 'date'].forEach((i) => ev.createIndex(i, i));
          const ar = db.createObjectStore('artifacts', { keyPath: 'id' });
          ['kind', 'date'].forEach((i) => ar.createIndex(i, i));
          db.createObjectStore('commitments', { keyPath: 'id' });
          db.createObjectStore('athlete', { keyPath: 'id' });
          db.createObjectStore('cache', { keyPath: 'cacheKey' });
          db.createObjectStore('contextPackages', { keyPath: 'contextId' });
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['ledger', 'events', 'athlete'], 'readwrite');
          tx.objectStore('ledger').add({ kind: 'PerformanceObservation', exerciseId: 'pullup', attributes: { reps: 8 } });
          tx.objectStore('ledger').add({ kind: 'PerformanceObservation', exerciseId: 'dip', attributes: { reps: 6 } });
          tx.objectStore('events').add({ kind: 'InterpretationAdoption', toContextId: 'ctx_1', trigger: 'initial' });
          tx.objectStore('athlete').add({ id: 'athlete', storageSchemaVersion: 1, displayName: 'Alon' });
          tx.oncomplete = () => { db.close(); res(); };
          tx.onerror = () => rej(tx.error);
        };
        req.onerror = () => rej(req.error);
      });
      I._reset();
      const status = await I.init();
      const db = await I.open();
      const version = db.version;
      const idx = Array.from(db.transaction('ledger', 'readonly').objectStore('ledger').indexNames).sort();
      const ledger = await I.all('ledger');
      const events = await I.all('events');
      const athlete = await I.get('athlete', I.ATHLETE_ID);
      // The upgraded store still works, and continues ABOVE the old maximum.
      const res = await I.appendUnique('ledger', { kind: 'PerformanceObservation', exerciseId: 'dip', dedupeKey: 'post:0:s:0' });
      return { status, version, idx, ledger, events, athlete, res };
    });
    expect(r.status.ok).toBe(true);
    expect(r.version).toBe(2);
    expect(r.idx).toEqual(['dedupeKey', 'exerciseId', 'kind', 'occurredAt']);
    // Nothing was lost, reordered or rewritten.
    expect(r.ledger.map((x) => x.seq)).toEqual([1, 2]);
    expect(r.ledger[0]).toEqual({ seq: 1, kind: 'PerformanceObservation', exerciseId: 'pullup', attributes: { reps: 8 } });
    expect(r.events.length).toBe(1);
    expect(r.athlete.displayName).toBe('Alon');
    expect(r.athlete.storageSchemaVersion).toBe(2);
    expect(r.res.seq).toBe(3);
  });
});

test.describe('P3 the ordering invariant', () => {
  test('35 the context is read, the Dependencies evaluated, and only then is the row appended', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB, C = window.CoachContext;
      await I.init(); await C.init();
      const order = [];
      // Watch the three steps that must happen in this order.
      const realPkg = C.getCurrentContextPackage;
      const realAll = I.all;
      const realUnmet = window.CoachEvaluator.unmetDependencies;
      const realAppend = I.appendUnique;
      C.getCurrentContextPackage = function () { order.push('context'); return realPkg.apply(C, arguments); };
      I.all = function (s) { if (s === 'ledger') order.push('read-ledger'); return realAll.apply(I, arguments); };
      window.CoachEvaluator.unmetDependencies = function (ledger) {
        order.push('evaluate:' + ledger.length);
        return realUnmet.apply(window.CoachEvaluator, arguments);
      };
      I.appendUnique = function () { order.push('append'); return realAppend.apply(I, arguments); };

      const w = { workoutId: 'w_order', blocks: [{ kind: 'straight', scheme: 'sets', exId: 'dip', label: 'Dips',
        restSecs: 90, sets: [{ target: 6, actual: 6, unit: 'reps', doneFlag: true }] }] };
      await window.CoachApp._evidence.tapWorkout(w);

      C.getCurrentContextPackage = realPkg; I.all = realAll;
      window.CoachEvaluator.unmetDependencies = realUnmet; I.appendUnique = realAppend;
      return { order, rows: await I.all('ledger') };
    });
    expect(r.order).toEqual(['context', 'read-ledger', 'evaluate:0', 'append']);
    expect(r.rows.length).toBe(1);
  });

  test('36 the new row cannot participate in the evaluation of its own context', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB, C = window.CoachContext;
      await I.init(); await C.init();
      // rto_support for 25s satisfies stage rmu_sup_s2, which is what
      // dep_transition_needs_rto requires. If the new row were visible to its
      // own evaluation, that dependency would read as MET on the very row that
      // caused it — the circularity this ordering exists to prevent.
      const w = { workoutId: 'w_self', blocks: [{ kind: 'straight', scheme: 'hold', exId: 'rto_support',
        label: 'RTO', restSecs: 90, sets: [{ target: 20, actual: 25, unit: 'sec', doneFlag: true }] }] };
      await window.CoachApp._evidence.tapWorkout(w);
      const first = await I.all('ledger');
      // A SECOND, later workout sees the first one's evidence, as it should.
      const w2 = { workoutId: 'w_next', blocks: [{ kind: 'straight', scheme: 'sets', exId: 'dip',
        label: 'Dips', restSecs: 90, sets: [{ target: 6, actual: 6, unit: 'reps', doneFlag: true }] }] };
      await window.CoachApp._evidence.tapWorkout(w2);
      const all = await I.all('ledger');
      return { first, all };
    });
    // The row that satisfies the dependency still records it as unmet, because
    // it was unmet when the athlete started the set.
    expect(r.first.length).toBe(1);
    expect(r.first[0].context.unmetDependencies).toContain('dep_transition_needs_rto');
    // The next workout, evaluated against a ledger that now holds it, does not.
    const later = r.all.filter((x) => x.sourceWorkoutItem.workoutId === 'w_next');
    expect(later.length).toBe(1);
    expect(later[0].context.unmetDependencies).not.toContain('dep_transition_needs_rto');
    // And the first row was not rewritten when the second was appended.
    expect(r.all[0].context.unmetDependencies).toEqual(r.first[0].context.unmetDependencies);
  });

  test('37 the stored context is the adopted one, by contextId and by package', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB, C = window.CoachContext;
      await I.init(); await C.init();
      const w = { workoutId: 'w_ctx', blocks: [{ kind: 'straight', scheme: 'sets', exId: 'dip', label: 'Dips',
        restSecs: 90, sets: [{ target: 6, actual: 6, unit: 'reps', doneFlag: true }] }] };
      await window.CoachApp._evidence.tapWorkout(w);
      return {
        rows: await I.all('ledger'),
        adopted: await C.currentContext(),
        status: window.CoachApp._evidence.status()
      };
    });
    expect(r.adopted).toBe('ctx_1');
    expect(r.rows[0].context.contextId).toBe('ctx_1');
    expect(r.status.lastContextId).toBe('ctx_1');
    expect(r.status.appended).toBe(1);
    expect(r.status.failed).toBe(0);
  });

  test('38 Dependency state comes from the ledger and the package, never from legacy state', async ({ page }) => {
    await seed(page, 2);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB, C = window.CoachContext;
      await I.init(); await C.init();
      // A fully-progressed legacy world: benches high, node state seeded. If any
      // of it leaked into the new model, these Dependencies would read as met.
      const S = window.CoachStore.makeStore();
      S.setBench({ pullup_max: 30, dips_max: 30, deadhang_secs: 300, ring_support_secs: 300, weighted_pullup_kg: 40 });
      const w = { workoutId: 'w_legacy', blocks: [{ kind: 'straight', scheme: 'sets', exId: 'dip', label: 'Dips',
        restSecs: 90, sets: [{ target: 6, actual: 6, unit: 'reps', doneFlag: true }] }] };
      await window.CoachApp._evidence.tapWorkout(w);
      return { rows: await I.all('ledger'), bench: S.getBench() };
    });
    expect(r.bench.ring_support_secs).toBe(300);      // the legacy value is there
    // …and the new model ignored all of it: an empty ledger means unmet.
    const ids = r.rows[0].context.unmetDependencies;
    ['dep_transition_needs_rto', 'dep_rmu_needs_false_grip', 'dep_ring_dip_needs_ring_support']
      .forEach((d) => expect(ids, d).toContain(d));
  });
});

test.describe('P3 a real workout, end to end', () => {
  test('39 finishing a real Parallel Bar Dips set fills the ledger and satisfies its Stage', async ({ page }) => {
    await seed(page, 2); await assign(page, 'pbdips', 2, 1);
    await page.locator('.q-ex', { hasText: 'Parallel Bar Dips' }).locator('[data-exstart]').click();
    await runToFinishPanel(page);
    await page.locator('[data-finish],[data-finishex]').first().click();
    const rows = await ledgerAfterTap(page, 4);
    expect(rows.length).toBe(4);            // 4 x 6, one row per performed set
    rows.forEach((r) => {
      expect(r.kind).toBe('PerformanceObservation');
      expect(r.exerciseId).toBe('dip');
      expect(r.provenance).toBe('demonstrated');
      expect(r.provenanceSource).toBe('in_session');
      expect(r.context.contextId).toBe('ctx_1');
      expect(typeof r.attributes.reps).toBe('number');
      expect(r.side).toBeNull();
    });
    expect(rows.map((r) => r.sequenceInItem)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => r.dedupeKey).every((k, i, a) => a.indexOf(k) === i)).toBe(true);
    // Real execution, read by the new engine, with no change to what is shown.
    const verdict = await page.evaluate(async () => {
      const pkg = await window.CoachContext.getCurrentContextPackage();
      const ledger = await window.CoachIDB.all('ledger');
      return {
        stage: window.CoachEvaluator.isRequirementSatisfied('stage:rmu_dip_s1', ledger, pkg, null),
        criterion: window.CoachEvaluator.evaluateCriterion('dip_bar_5', 'combined', ledger, pkg).status
      };
    });
    expect(verdict.criterion).toBe('satisfied');
    expect(verdict.stage).toBe(true);
  });

  test('40 finishing the same workout twice appends nothing the second time', async ({ page }) => {
    await seed(page, 2); await assign(page, 'pbdips', 2, 1);
    await page.locator('.q-ex', { hasText: 'Parallel Bar Dips' }).locator('[data-exstart]').click();
    await runToFinishPanel(page);
    const w = await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_workout')).data);
    await page.locator('[data-finish],[data-finishex]').first().click();
    await ledgerAfterTap(page, 4);
    // Replay the very same execution instance — what a double Finish, a
    // re-render or a restored snapshot would do.
    const r = await page.evaluate(async (snapshot) => {
      await window.CoachApp._evidence.tapWorkout(snapshot);
      await window.CoachApp._evidence.tapWorkout(snapshot);
      return { rows: await window.CoachIDB.all('ledger'), status: window.CoachApp._evidence.status() };
    }, w);
    expect(r.rows.length).toBe(4);
    expect(r.status.duplicates).toBe(8);
    expect(r.status.failed).toBe(0);
  });

  test('41 a real climbing session records one ActivityObservation', async ({ page }) => {
    await seed(page, 0);
    await page.locator('.q-ex.q-base').locator('[data-exstart]').click();
    await page.locator('[data-results] .pill').first().click();
    await page.locator('[data-add]').click();
    await page.locator('[data-finish]').click();
    const rows = await ledgerAfterTap(page, 1);
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe('ActivityObservation');
    expect(rows[0].activity).toBe('climbing');
    expect(rows[0].problems.length).toBe(1);
    expect(rows[0].context.contextId).toBe('ctx_1');
    expect(rows[0].exerciseId).toBeUndefined();
  });

  test('42 a failed evidence append leaves the finished workout completely intact', async ({ page }) => {
    await seed(page, 2); await assign(page, 'pbdips', 2, 1);
    await page.evaluate(() => {
      // Break the append, the way a full quota or a closing connection would.
      window.CoachIDB.appendUnique = function () { return Promise.reject(new Error('simulated append failure')); };
    });
    await page.locator('.q-ex', { hasText: 'Parallel Bar Dips' }).locator('[data-exstart]').click();
    await runToFinishPanel(page);
    await page.locator('[data-finish],[data-finishex]').first().click();
    // The completion screen still appears, and the legacy record is written.
    await expect(page.locator('.badge', { hasText: 'Exercise Complete' })).toBeVisible();
    const r = await page.evaluate(async () => {
      for (let i = 0; i < 40; i++) {
        if (window.CoachApp._evidence.status().failed) break;
        await new Promise((res) => setTimeout(res, 50));
      }
      const S = window.CoachStore.makeStore();
      return {
        status: window.CoachApp._evidence.status(),
        bench: S.getBench(),
        day: JSON.parse(localStorage.getItem('spc_c_day') || 'null'),
        ledger: await window.CoachIDB.count('ledger')
      };
    });
    // The failure is counted and its reason kept — not swallowed.
    expect(r.status.failed).toBeGreaterThan(0);
    expect(r.status.lastError).toContain('simulated append failure');
    expect(r.status.appended).toBe(0);
    expect(r.ledger).toBe(0);
    // And the athlete's workout is exactly as complete as it should be. A daily
    // exercise is recorded on the queue and in node state; the rolled-up session
    // row is written later, by Finish Today's Workout.
    const done = r.day.exercises.filter((e) => e.state === 'completed');
    expect(done.length).toBeGreaterThan(0);
    expect(done[0].result).toBeTruthy();
    expect(done[0].result.actualReps).toBeGreaterThan(0);
    expect(r.bench.dips_max).toBeGreaterThan(0);
  });

  test('43 a missing interpretation context is reported, never guessed around', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      await I.init();
      window.CoachContext._reset();
      window.CoachContext.getCurrentContextPackage = function () { return Promise.resolve(null); };
      const w = { workoutId: 'w_nc', blocks: [{ kind: 'straight', scheme: 'sets', exId: 'dip', label: 'Dips',
        restSecs: 90, sets: [{ target: 6, actual: 6, unit: 'reps', doneFlag: true }] }] };
      const status = await window.CoachApp._evidence.tapWorkout(w);
      return { status, count: await I.count('ledger') };
    });
    // No context means no truthful contextId, so nothing is written at all —
    // rather than a row pinned to a context this device cannot evaluate.
    expect(r.count).toBe(0);
    expect(r.status.failed).toBeGreaterThan(0);
    expect(r.status.lastError).toContain('no interpretation context');
  });
});

test.describe('P3 changes nothing the athlete sees', () => {
  test('44 Today, Week, Map and Progress render exactly as before the tap ran', async ({ page }) => {
    await seed(page, 2); await assign(page, 'ringsupport', 2, 1);
    const snap = async () => {
      const out = {};
      for (const screen of ['today', 'week', 'map', 'progress']) {
        await page.locator('.nav button[data-s="' + screen + '"]').click();
        await page.waitForTimeout(120);
        out[screen] = await page.locator('#app').innerHTML();
      }
      return out;
    };
    // A workout whose evidence goes to the ledger and nowhere else.
    await page.evaluate(async () => {
      await window.CoachIDB.init(); await window.CoachContext.init();
      const w = { workoutId: 'w_quiet', blocks: [{ kind: 'straight', scheme: 'sets', exId: 'dip',
        label: 'Parallel Bar Dips', restSecs: 90,
        sets: [{ target: 6, actual: 8, unit: 'reps', doneFlag: true }] }] };
      await window.CoachApp._evidence.tapWorkout(w);
    });
    const before = await snap();
    // Append a great deal more evidence — enough to satisfy a Stage outright.
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) {
        await window.CoachApp._evidence.tapWorkout({ workoutId: 'w_more' + i,
          blocks: [{ kind: 'straight', scheme: 'hold', exId: 'rto_support', label: 'RTO', restSecs: 90,
            sets: [{ target: 20, actual: 40, unit: 'sec', doneFlag: true }] }] });
      }
    });
    const after = await snap();
    for (const screen of ['today', 'week', 'map', 'progress']) {
      expect(after[screen], screen).toBe(before[screen]);
    }
    // The evidence really is there — this is not a vacuous comparison.
    const n = await page.evaluate(() => window.CoachIDB.count('ledger'));
    expect(n).toBe(6);
  });

  test('45 the legacy engine reads no evidence, and the new one writes no legacy state', async ({ page }) => {
    const fs = require('fs');
    // One direction each: progress.js/engine.js/week.js cannot see the ledger,
    // and evidence.js cannot see spc_c_*.
    ['progress.js', 'engine.js', 'week.js', 'daily.js'].forEach((f) => {
      const src = fs.readFileSync(path.join(REPO, f), 'utf8');
      ['CoachIDB', 'CoachEvidence', 'CoachEvaluator', 'CoachContext'].forEach(
        (n) => expect(src, f + ' / ' + n).not.toContain(n));
    });
    const ev = fs.readFileSync(path.join(REPO, 'evidence.js'), 'utf8');
    ['localStorage', 'spc_c_', 'CoachStore', 'Progress.', 'indexedDB', 'fetch(']
      .forEach((n) => expect(ev, n).not.toContain(n));
    expect(true).toBe(true);
  });

  test('46 the legacy writes still happen, exactly as before (the migration exception)', async ({ page }) => {
    await seed(page, 2); await assign(page, 'pbdips', 2, 1);
    // Start from a bench BELOW what the session will do, so the legacy write is
    // observable rather than a no-op that a passing assertion could hide.
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore();
      const b = S.getBench(); b.dips_max = 2; S.setBench(b);
      const st = S.getState();
      st.muscleup.nodes.mu_dip5 = { criteria: { reps: 2 } };
      S.setState(st);
    });
    const before = await page.evaluate(() => {
      const S = window.CoachStore.makeStore();
      return { bench: S.getBench(), state: S.getState(),
        day: localStorage.getItem('spc_c_day') };
    });
    await page.locator('.q-ex', { hasText: 'Parallel Bar Dips' }).locator('[data-exstart]').click();
    await runToFinishPanel(page);
    await page.locator('[data-finish],[data-finishex]').first().click();
    await ledgerAfterTap(page, 4);
    const after = await page.evaluate(() => {
      const S = window.CoachStore.makeStore();
      return { bench: S.getBench(), state: S.getState(),
        day: JSON.parse(localStorage.getItem('spc_c_day') || 'null') };
    });
    // Invariant 07 is deliberately NOT yet enforceable: node state, bench and
    // the queue result are still written by completion, and will be until P8.
    // P3 appends ALONGSIDE them; it does not replace or suppress one of them.
    expect(after.state).not.toEqual(before.state);
    expect(after.state.muscleup.nodes.mu_dip5.criteria.reps).toBeGreaterThan(2);
    expect(after.bench.dips_max).toBeGreaterThan(before.bench.dips_max);
    expect(after.day.exercises.some((e) => e.state === 'completed' && e.result)).toBe(true);
  });

  test('47 the new runtime modules are cached for a first offline boot', async ({ page }) => {
    await page.goto('index.html');
    await page.evaluate(() => navigator.serviceWorker.ready);
    let urls = [];
    for (let i = 0; i < 40; i++) {
      urls = await page.evaluate(async () => {
        const names = await caches.keys();
        const mine = names.filter((n) => n.indexOf('skill-progression-coach-') === 0);
        if (!mine.length) return [];
        const keys = await (await caches.open(mine[0])).keys();
        return keys.map((r) => r.url);
      });
      if (urls.some((u) => u.indexOf('evidence.js') >= 0)) break;
      await page.waitForTimeout(100);
    }
    ['evaluator.js', 'evidence.js', 'idb.js', 'context.js'].forEach(
      (f) => expect(urls.some((u) => u.indexOf(f) >= 0), f).toBe(true));
  });
});
