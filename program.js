/*
 * Skill Progression Coach — the Foundation Path (Beginner Program) domain.
 *
 * Pure functions over two inputs:
 *   - the PROGRAM PACKAGE: the authored prescription, built from the source by
 *     tools/build-program.cjs. Never written to by anything here.
 *   - the ATHLETE STATE: an append-only list of events — what the athlete
 *     actually did (enrolment, completed workouts with their real results,
 *     Max Tests, Foundation Exit tests). Never rewrites the prescription.
 *
 * Everything the app shows about "where am I" is DERIVED from these two, so a
 * prescription and a performance can never be confused, and nothing is stored
 * twice.
 *
 * Three kinds of rule live here, and every one is labelled:
 *   SOURCE  — the Beginner Program as Calixpert wrote it (sequence, deloads,
 *             Max Test points, no performance gates between weeks/phases).
 *   SPC     — approved Skill Progression Coach methodology: the Foundation
 *             Exit profile (Stage 5A Calibration v1) and Academy entry
 *             (Stage 4 decision ledger).
 *   SPC-v1  — the product rules for this first usable build (range completion,
 *             what finishing a workout means), as stated in the build brief.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CoachProgram = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATE_VERSION = 1;
  var DAY = 24 * 3600 * 1000;

  // ---- SPC: Foundation Exit — Stage 5A Calibration v1 (approved 19 Oct 2026) --
  // Each domain names ONE exact test. Assisted, knee, chair, ring or
  // straight-bar versions are different tests and never stand in for these.
  var TESTS = {
    pullup: { label: 'Pull-ups', unit: 'reps',
      test: 'Overhand standard pull-up on a stable straight bar, unassisted',
      validity: ['Start each rep from straight elbows in a controlled hang', 'Chin clearly above the bar at the top', 'Back to straight elbows every rep', 'No swing, kick, kipping or band; no hanging rest over 3 s between reps'] },
    pushup: { label: 'Push-ups', unit: 'reps',
      test: 'Standard floor push-up on the toes (no knees, no incline)',
      validity: ['Head, trunk and pelvis move together', 'Elbows finish extended', 'Chest to the same fist-height depth every rep, without resting on the floor', 'No sag, piking, bouncing or snaking up'] },
    pbdip: { label: 'Parallel-bar dips', unit: 'reps',
      test: 'Unassisted dips on stable parallel dip bars, bodyweight',
      validity: ['Start and finish with straight elbows in the top support', 'Controlled descent to about 90° elbow bend', 'Shoulders under control', 'No foot contact, hopping or momentum (not chairs, rings or a straight bar)'] },
    deadhang: { label: 'Dead hang', unit: 'sec',
      test: 'Two-hand overhand (pronated) normal hang from a fixed pull-up bar',
      validity: ['Full bodyweight, feet clear of the floor', 'Full, secure grip; no regrip', 'No band or foot support', 'Shoulders controlled without painful collapse; normal breathing'] },
    forearmplank: { label: 'Forearm plank', unit: 'sec',
      test: 'Forearm plank on the toes, on the floor',
      validity: ['Elbows under the shoulders', 'Steady shoulder–hip–ankle line', 'No repeated hip drop or pike; no breath holding', 'Stop the timer when the position is lost'] },
    legs: { label: 'Squats + reverse lunges', unit: 'reps',
      test: '(A) bodyweight squats on a flat floor; (B) bodyweight reverse lunges from standing, each leg',
      validity: ['Squat: thighs about parallel or slightly below, heels down, controlled down and up', 'Lunge: step back, front foot stays planted, rear knee near the floor', 'Lunge: return to standing without bouncing, support or a push from the rear leg', 'Right and left recorded separately'] }
  };
  var F7 = 'A rep or second counts only with the defined range, control without material compensation, and the defined start and finish. Invalid reps simply do not count. Pain or unsafe execution stops the test.';
  var FOUNDATION = [
    { id: 'F1', label: 'Pull', test: 'pullup', need: { value: 5 }, pass: '5 clean consecutive pull-ups' },
    { id: 'F2', label: 'Push', test: 'pushup', need: { value: 15 }, pass: '15 clean consecutive push-ups' },
    { id: 'F3', label: 'Dip / Support', test: 'pbdip', need: { value: 5 }, pass: '5 clean consecutive parallel-bar dips' },
    { id: 'F4', label: 'Hang / Grip', test: 'deadhang', need: { value: 30 }, pass: '30-second controlled dead hang' },
    { id: 'F5', label: 'Core', test: 'forearmplank', need: { value: 60 }, pass: '60-second forearm plank' },
    { id: 'F6', label: 'Lower body', test: 'legs', need: { squats: 12, lungeR: 8, lungeL: 8 }, pass: '12 controlled squats + 8 controlled reverse lunges per leg' }
  ];
  var EXIT_EVIDENCE_DAYS = 45; // SPC v1 pilot rule, for the INITIAL Exit approval only

  // ---- SPC: Academy (Stage 4 decision ledger + Stage 5A §2.2) -----------------
  // Only Ring Muscle-Up and Pistol Squat are part of this build. Their in-goal
  // progression (Stage 5B) is NOT approved and is deliberately absent.
  var ACADEMY_GOALS = [
    { id: 'ring_muscle_up', label: 'Ring Muscle-Up', entry: [{ test: 'pullup', value: 6 }, { test: 'pbdip', value: 6 }],
      entryText: '6 clean overhand pull-ups and 6 clean parallel-bar dips' },
    { id: 'pistol_squat', label: 'Pistol Squat', entry: [], entryText: 'No extra entry test: open once the Foundation is passed' }
  ];
  var ACADEMY_LATER = ['Bar Muscle-Up', 'Handstand', 'L-Sit', 'V-Sit'];

  // ---- state ---------------------------------------------------------------------
  function emptyState() { return { version: STATE_VERSION, events: [] }; }
  function events(state) { return (state && state.events) || []; }
  var _n = 0;
  function newId(prefix) { _n++; return (prefix || 'e') + '_' + Date.now().toString(36) + '_' + _n.toString(36) + '_' + Math.floor(Math.random() * 1e8).toString(36); }
  function addEvent(state, ev) {
    var s = state && state.events ? state : emptyState();
    var e = Object.assign({ id: newId(ev.type), at: new Date().toISOString() }, ev);
    return { version: STATE_VERSION, events: events(s).concat([e]) };
  }
  function ofType(state, type) { return events(state).filter(function (e) { return e.type === type; }); }

  // ---- package -------------------------------------------------------------------
  function validatePackage(pkg) {
    var errors = [];
    if (!pkg || pkg.programId !== 'calixpert-beginner') errors.push('not a Beginner Program package');
    else {
      if (!Array.isArray(pkg.sequence) || !pkg.sequence.length) errors.push('no sequence');
      if (!pkg.workouts || !Object.keys(pkg.workouts).length) errors.push('no workouts');
      if (!pkg.maxTest || !pkg.maxTest.families) errors.push('no Max Test');
      if (!pkg.source || !pkg.source.md5) errors.push('no source fingerprint');
    }
    return { ok: !errors.length, errors: errors };
  }
  // The path is the source sequence, followed by the SPC Foundation Exit.
  function pathNodes(pkg) { return pkg.sequence.concat([{ type: 'exit', id: 'FE', label: 'Foundation Exit' }]); }
  function weekOf(pkg, id) { return pkg.weeks[id]; }
  function requiredOf(pkg, weekId) { return weekOf(pkg, weekId).workouts.filter(function (id) { return !pkg.workouts[id].optional; }); }
  function optionalOf(pkg, weekId) { return weekOf(pkg, weekId).workouts.filter(function (id) { return pkg.workouts[id].optional; }); }

  // ---- position (SOURCE: time/sequence-based, no performance gate) ----------------
  function startNode(state) {
    var starts = events(state).filter(function (e) { return e.type === 'enrolled' || e.type === 'repositioned'; });
    return starts.length ? starts[starts.length - 1].start : null;
  }
  function completions(state, workoutId) {
    return ofType(state, 'workout_completed').filter(function (e) { return e.workoutId === workoutId; });
  }
  function nodeComplete(pkg, state, node) {
    if (node.type === 'week') return requiredOf(pkg, node.id).every(function (id) { return completions(state, id).length > 0; });
    if (node.type === 'deload') return ofType(state, 'deload_completed').some(function (e) { return e.nodeId === node.id; });
    if (node.type === 'maxtest') return ofType(state, 'maxtest_recorded').some(function (e) { return e.nodeId === node.id; });
    if (node.type === 'exit') return ofType(state, 'foundation_exit_passed').length > 0;
    return false;
  }
  // Status of every node: 'placed' (before the athlete's starting point and not
  // done here — NOT the same as done), 'done', 'current', 'upcoming'.
  function pathView(pkg, state) {
    var nodes = pathNodes(pkg), start = startNode(state);
    if (!start) return { enrolled: false, nodes: nodes.map(function (n) { return Object.assign({}, n, { status: 'upcoming' }); }), current: null };
    var startIdx = Math.max(0, nodes.findIndex(function (n) { return n.id === start; }));
    var currentIdx = -1;
    var out = nodes.map(function (n, i) {
      var done = nodeComplete(pkg, state, n);
      var status;
      if (done) status = 'done';
      else if (i < startIdx) status = 'placed';
      else if (currentIdx < 0) { status = 'current'; currentIdx = i; }
      else status = 'upcoming';
      return Object.assign({}, n, { status: status, index: i });
    });
    return { enrolled: true, start: start, startIndex: startIdx, nodes: out, current: currentIdx >= 0 ? out[currentIdx] : null, currentIndex: currentIdx };
  }
  // A workout can be started when its week is the current node (any order inside
  // the week — the source states no order rule). Earlier weeks stay viewable.
  function workoutStatus(pkg, state, workoutId) {
    var w = pkg.workouts[workoutId]; if (!w) return null;
    var view = pathView(pkg, state);
    var node = view.nodes.find(function (n) { return n.id === 'P' + w.phase + 'W' + w.week; });
    var done = completions(state, workoutId).length > 0;
    var reported = done && completions(state, workoutId).every(function (e) { return e.source === 'reported'; });
    var status = done ? 'completed' : node.status === 'current' ? 'available' : node.status === 'placed' ? 'placed' : node.status === 'done' ? 'missed' : 'upcoming';
    return { id: workoutId, status: status, optional: !!w.optional, reported: reported, runs: completions(state, workoutId).length, weekStatus: node.status };
  }
  function weekProgress(pkg, state, weekId) {
    var req = requiredOf(pkg, weekId).map(function (id) { return workoutStatus(pkg, state, id); });
    return { required: req, done: req.filter(function (r) { return r.status === 'completed'; }).length, total: req.length,
      optional: optionalOf(pkg, weekId).map(function (id) { return workoutStatus(pkg, state, id); }) };
  }

  // ---- execution outcomes (SPC-v1: a valid value anywhere in the range counts) ----
  // 'met' = at or above the lower bound; the upper bound is never required.
  // 'below' = logged but under the lower bound; 'not-done' = nothing logged;
  // 'done' = logged where the source gives no numeric target (AMRAP, pyramid).
  function valueOutcome(dose, value) {
    if (value == null || value === '') return 'not-done';
    if (!dose || dose.min == null) return 'done';
    return +value >= dose.min ? 'met' : 'below';
  }
  function bilateral(dose) { return !!(dose && (dose.per === 'leg' || dose.per === 'arm')); }
  function setOutcome(dose, set) {
    if (!set) return 'not-done';
    if (bilateral(dose)) {
      if ((set.left == null || set.left === '') && (set.right == null || set.right === '')) return 'not-done';
      var l = valueOutcome(dose, set.left), r = valueOutcome(dose, set.right);
      return (l === 'met' && r === 'met') ? 'met' : 'below';
    }
    return valueOutcome(dose, set.value);
  }
  function blockOutcome(block, result) {
    result = result || {};
    if (block.kind === 'exercise') {
      var sets = result.sets || [];
      var outs = [];
      for (var i = 0; i < (block.sets || sets.length || 1); i++) outs.push(setOutcome(block.dose, sets[i]));
      if (outs.every(function (o) { return o === 'not-done'; })) return 'not-done';
      if (outs.every(function (o) { return o === 'met' || o === 'done'; })) return block.dose.min == null ? 'done' : 'met';
      return 'below';
    }
    if (block.kind === 'emom') {
      var mins = (result.minutes || []).filter(function (v) { return v != null && v !== ''; });
      if (!mins.length) return 'not-done';
      if (block.style === 'pyramid' || !block.perMinute || block.perMinute.min == null) return 'done';
      var enough = !block.minutes || block.minutes.min == null || mins.length >= block.minutes.min;
      return enough && mins.every(function (v) { return +v >= block.perMinute.min; }) ? 'met' : 'below';
    }
    if (block.kind === 'amrap') return result.rounds != null && result.rounds !== '' ? 'done' : 'not-done';
    if (block.kind === 'circuit') {
      var rounds = result.rounds;
      var items = result.items || [];
      var logged = (rounds != null && rounds !== '') || items.some(function (v) { return v != null && v !== ''; });
      if (!logged) return 'not-done';
      var roundsOk = block.rounds == null || (+rounds >= block.rounds);
      var itemsOk = block.items.every(function (it, k) { return valueOutcome(it.dose, items[k]) === 'met' || valueOutcome(it.dose, items[k]) === 'done'; });
      return roundsOk && itemsOk ? 'met' : 'below';
    }
    return 'not-done';
  }
  function runSummary(workout, run) {
    var s = { met: 0, below: 0, done: 0, notDone: 0, blocks: [] };
    workout.blocks.forEach(function (b, i) {
      var r = (run.blocks || [])[i] || {};
      var o = r.skipped ? 'not-done' : blockOutcome(b, r);
      s.blocks.push({ order: b.order, outcome: o, skipped: !!r.skipped });
      if (o === 'met') s.met++; else if (o === 'below') s.below++; else if (o === 'done') s.done++; else s.notDone++;
    });
    return s;
  }
  // A finished run becomes an immutable completion record. The prescription is
  // referenced (package fingerprint + workout id), and its raw text is copied by
  // value so history stays readable even if the package is rebuilt.
  function completionEvent(pkg, workoutId, run, finishedAt) {
    var w = pkg.workouts[workoutId];
    return {
      type: 'workout_completed', workoutId: workoutId, source: 'app',
      startedAt: run.startedAt || null, finishedAt: finishedAt || new Date().toISOString(),
      prescription: { packageMd5: pkg.source.md5, title: w.title, phase: w.phase, week: w.week,
        blocks: w.blocks.map(function (b) { return { order: b.order, kind: b.kind, easy: b.easy || null, hard: b.hard || null, raw: b.raw || null,
          items: b.items ? b.items.map(function (it) { return { easy: it.easy, dose: it.dose.raw }; }) : null }; }) },
      result: JSON.parse(JSON.stringify(run.blocks || [])),
      summary: runSummary(w, run)
    };
  }

  // ---- Max Test (SOURCE: a benchmark, never a pass/fail gate) ---------------------
  // A recorded result maps onto an SPC test ONLY when it is the very same test
  // (same exercise, grip/apparatus, no assistance) and its validity was confirmed.
  function maxTestToTest(r) {
    if (!r || r.notTested || r.value == null || r.value === '' || !r.valid) return null;
    if (r.family === 'pull' && r.variant === 'Pull Ups' && r.grip === 'overhand' && !r.assisted) return 'pullup';
    if (r.family === 'push' && r.variant === 'Push Ups') return 'pushup';
    if (r.family === 'dip' && r.variant === 'Dips' && r.apparatus === 'parallel-bars') return 'pbdip';
    if (r.family === 'hang' && r.variant === 'Hang On The Bar' && r.grip === 'overhand') return 'deadhang';
    if (r.family === 'plank' && r.variant === 'Plank Hold' && r.plankForm === 'forearm') return 'forearmplank';
    return null;
  }
  function maxTestHistory(state) {
    return ofType(state, 'maxtest_recorded').slice().sort(function (a, b) { return (a.date || a.at) < (b.date || b.at) ? -1 : 1; });
  }

  // ---- evidence for the SPC tests ------------------------------------------------
  function evidence(state) {
    var out = [];
    ofType(state, 'exit_test_recorded').forEach(function (e) {
      out.push({ test: e.test, values: e.values || {}, valid: !!e.valid, date: e.date || e.at, source: 'exit-test', eventId: e.id, assessor: e.assessor || 'self' });
    });
    maxTestHistory(state).forEach(function (e) {
      (e.results || []).forEach(function (r) {
        var t = maxTestToTest(r);
        if (t) out.push({ test: t, values: { value: +r.value }, valid: true, date: e.date || e.at, source: 'max-test', eventId: e.id, assessor: 'self' });
      });
    });
    return out;
  }
  function meets(need, values) {
    return Object.keys(need).every(function (k) { return values[k] != null && values[k] !== '' && +values[k] >= need[k]; });
  }
  function ageDays(date, now) { return Math.floor(((now ? new Date(now) : new Date()) - new Date(date)) / DAY); }

  // ---- SPC: Foundation Exit -------------------------------------------------------
  // All six domains must pass, each with valid (F7) evidence recorded within the
  // last 45 days. Once passed, the milestone stands: it is not revoked by time or
  // by a tired day (Stage 5A §3.1).
  function foundationStatus(state, now) {
    var passedEv = ofType(state, 'foundation_exit_passed')[0] || null;
    var ev = evidence(state);
    var domains = FOUNDATION.map(function (d) {
      var recs = ev.filter(function (r) { return r.test === d.test; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      var qualifying = recs.filter(function (r) { return r.valid && meets(d.need, r.values); });
      var fresh = qualifying.filter(function (r) { return ageDays(r.date, now) <= EXIT_EVIDENCE_DAYS; });
      var state_;
      if (fresh.length) state_ = 'pass';
      else if (qualifying.length) state_ = 'stale';
      else if (recs.length) state_ = 'not-yet';
      else state_ = 'no-evidence';
      return { id: d.id, label: d.label, test: d.test, pass: d.pass, need: d.need, status: state_,
        evidence: fresh[0] || qualifying[0] || recs[0] || null, records: recs.length };
    });
    return { passed: !!passedEv, passedAt: passedEv ? passedEv.at : null,
      allPass: domains.every(function (d) { return d.status === 'pass'; }), domains: domains };
  }

  // ---- SPC: Academy ---------------------------------------------------------------
  function academyStatus(state) {
    var open = ofType(state, 'foundation_exit_passed').length > 0;
    var ev = evidence(state);
    function best(test) {
      var vals = ev.filter(function (r) { return r.test === test && r.valid; }).map(function (r) { return +r.values.value; });
      return vals.length ? Math.max.apply(null, vals) : null;
    }
    var goals = ACADEMY_GOALS.map(function (g) {
      var needs = g.entry.map(function (n) { var have = best(n.test); return { test: n.test, label: TESTS[n.test].label, need: n.value, have: have, ok: have != null && have >= n.value }; });
      var status = !open ? 'locked-foundation' : needs.every(function (n) { return n.ok; }) ? 'open' : 'locked-entry';
      return { id: g.id, label: g.label, entryText: g.entryText, status: status, needs: needs };
    });
    return { open: open, goals: goals, later: ACADEMY_LATER.slice() };
  }

  // ---- migration of the existing athlete ------------------------------------------
  // The athlete who used the earlier app is mid-program: Beginner Program,
  // Phase 4, Week 3, with that week's Push workout done (as reported). Earlier
  // content becomes "placed past", never fabricated completions.
  function migrationEvents() {
    return [
      { type: 'enrolled', programId: 'calixpert-beginner', start: 'P4W3', basis: 'migration',
        note: 'Existing athlete: Beginner Program, Phase 4, Week 3 (reported).' },
      { type: 'workout_completed', workoutId: 'P4W3-2', source: 'reported',
        note: 'Reported by the athlete as done before this build. No set data.' }
    ];
  }

  return {
    STATE_VERSION: STATE_VERSION, TESTS: TESTS, F7: F7, FOUNDATION: FOUNDATION, EXIT_EVIDENCE_DAYS: EXIT_EVIDENCE_DAYS,
    ACADEMY_GOALS: ACADEMY_GOALS, ACADEMY_LATER: ACADEMY_LATER,
    emptyState: emptyState, addEvent: addEvent, ofType: ofType, newId: newId,
    validatePackage: validatePackage, pathNodes: pathNodes, requiredOf: requiredOf, optionalOf: optionalOf,
    startNode: startNode, nodeComplete: nodeComplete, pathView: pathView, workoutStatus: workoutStatus, weekProgress: weekProgress,
    valueOutcome: valueOutcome, setOutcome: setOutcome, blockOutcome: blockOutcome, runSummary: runSummary, bilateral: bilateral,
    completionEvent: completionEvent, completions: completions,
    maxTestToTest: maxTestToTest, maxTestHistory: maxTestHistory, evidence: evidence,
    foundationStatus: foundationStatus, academyStatus: academyStatus, migrationEvents: migrationEvents
  };
});
