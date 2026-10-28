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
  // referenced (package fingerprint + workout id), and copied by value — its raw
  // text and which exercise every set or EMOM minute was — so history, and any
  // evidence read from it, stays exact even if the package is rebuilt.
  function snapshotUnit(b) {
    if (b.kind === 'exercise') return b.dose.unit;
    if (b.kind === 'emom') return b.perMinute ? b.perMinute.unit : b.style === 'pyramid' ? 'reps' : null; // the source defines pyramid steps in reps
    return null;
  }
  function completionEvent(pkg, workoutId, run, finishedAt) {
    var w = pkg.workouts[workoutId];
    return {
      type: 'workout_completed', workoutId: workoutId, source: 'app',
      startedAt: run.startedAt || null, finishedAt: finishedAt || new Date().toISOString(),
      prescription: JSON.parse(JSON.stringify({ packageMd5: pkg.source.md5, title: w.title, phase: w.phase, week: w.week,
        blocks: w.blocks.map(function (b) { return { order: b.order, kind: b.kind, easy: b.easy || null, hard: b.hard || null, raw: b.raw || null,
          unit: snapshotUnit(b), per: (b.dose && b.dose.per) || null,
          style: b.style || null, exercise: b.exercise || null, hardExercise: b.hardExercise || null, options: b.options || null, parts: b.parts || null,
          items: b.items ? b.items.map(function (it) { return { easy: it.easy, dose: it.dose.raw }; }) : null }; }) })),
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

  // ---- SPC: a normal workout set as evidence (Stage 5A §3.1, §3.3) ----------------
  // A set from a normal workout counts for an SPC test only when it IS that test.
  // Each condition is checked here, never assumed:
  //   - the workout record names exactly the test's exercise — no assisted,
  //     negative, knee, incline, chin-up or other variant (exact name only);
  //   - one logged value is one set: a set of a sets-and-reps exercise, or one
  //     EMOM minute (the source defines every EMOM minute as one set). AMRAP
  //     totals and circuit values are not single sets and never count;
  //   - the athlete confirmed, for that set, what the record cannot show: the
  //     grip / apparatus / no assistance, and every validity condition (F7).
  // The value and the date are always read from the workout record; the
  // confirmation never copies them, so a performance has exactly one truth.
  var TRAINING_EQUIV = { pullups: 'pullup', pushups: 'pushup', dips: 'pbdip' };
  var CONFIRM_NEEDS = {
    pullup: { grip: 'overhand', assistance: 'none' },
    pushup: { form: 'toes' },
    pbdip: { apparatus: 'parallel-bars', assistance: 'none' }
  };
  function trainingTest(name) { return TRAINING_EQUIV[String(name || '').toLowerCase().replace(/[^a-z]/g, '')] || null; }
  function minuteExercise(pb, variant, k) {
    if (pb.style === 'single') return pb.options && pb.options.length === 1 ? pb.options[0] : null; // a choice of options: which one was done is not recorded
    if (pb.style === 'alternating') { var half = k % 2 === 0 ? 'odd' : 'even'; var p = (pb.parts || []).filter(function (x) { return x.minutes === half; })[0]; return p ? p.exercise : null; }
    if (pb.style === 'cycle') { var n = (pb.parts || []).length; var q = (pb.parts || []).filter(function (x) { return x.minute === (k % n) + 1; })[0]; return q ? q.exercise : null; }
    if (pb.style === 'pyramid') return variant === 'hard' && pb.hardExercise ? pb.hardExercise : pb.exercise;
    return null;
  }
  // Every single set a workout record holds, with the exercise it was.
  function performedSets(ev) {
    var out = [];
    if (!ev || ev.type !== 'workout_completed' || ev.source !== 'app' || !ev.prescription) return out;
    (ev.prescription.blocks || []).forEach(function (pb, bi) {
      var r = (ev.result || [])[bi] || {};
      if (r.skipped) return;
      if (pb.kind === 'exercise' && !pb.per) {
        var name = r.variant === 'hard' && pb.hard ? pb.hard : pb.easy;
        (r.sets || []).forEach(function (s, k) {
          if (s && s.done && s.value != null && s.value !== '') out.push({ block: bi, index: k, exercise: name, unit: pb.unit, value: +s.value });
        });
      } else if (pb.kind === 'emom' && pb.style) {
        (r.minutes || []).forEach(function (v, k) {
          var nm = minuteExercise(pb, r.variant, k);
          if (nm && v != null && v !== '') out.push({ block: bi, index: k, exercise: nm, unit: pb.unit, value: +v, minute: k + 1 });
        });
      }
    });
    return out;
  }
  function threshold(test) { var d = FOUNDATION.filter(function (x) { return x.test === test; })[0]; return d ? d.need.value : Infinity; }
  function trainingEvidence(state) {
    var workouts = {}, latest = {};
    ofType(state, 'workout_completed').forEach(function (e) { workouts[e.id] = e; });
    ofType(state, 'evidence_confirmed').forEach(function (c) { latest[c.workoutEventId + '|' + c.block + '|' + c.index] = c; }); // a later answer for the same set replaces an earlier one
    var out = [];
    Object.keys(latest).forEach(function (key) {
      var c = latest[key], w = workouts[c.workoutEventId]; if (!w) return;
      var set = performedSets(w).filter(function (s) { return s.block === c.block && s.index === c.index; })[0];
      var needs = CONFIRM_NEEDS[c.test];
      if (!set || !needs || trainingTest(set.exercise) !== c.test || set.unit !== TESTS[c.test].unit) return;
      if (!Object.keys(needs).every(function (k) { return c[k] === needs[k]; })) return; // another test (e.g. dips on chairs): no evidence for this one
      out.push({ test: c.test, values: { value: set.value }, valid: !!c.valid, date: w.finishedAt || w.at, source: 'workout', eventId: c.id,
        workoutEventId: w.id, workoutId: w.workoutId, exercise: set.exercise, block: set.block, index: set.index, minute: set.minute || null, assessor: c.assessor || 'self' });
    });
    return out;
  }
  // Sets that could count for an SPC test and have not been answered yet: the
  // exact exercise, at least the Foundation threshold. The best set of each
  // exercise in a workout is offered once.
  function trainingCandidates(state, opts) {
    opts = opts || {};
    var answered = {};
    ofType(state, 'evidence_confirmed').forEach(function (c) { answered[c.workoutEventId + '|' + c.block + '|' + c.test] = true; });
    var out = [];
    ofType(state, 'workout_completed').forEach(function (w) {
      if (opts.workoutEventId && w.id !== opts.workoutEventId) return;
      if (opts.maxAgeDays != null && ageDays(w.finishedAt || w.at, opts.now) > opts.maxAgeDays) return;
      var best = {};
      performedSets(w).forEach(function (s) {
        var t = trainingTest(s.exercise), key = w.id + '|' + s.block + '|' + t;
        if (!t || s.unit !== TESTS[t].unit || answered[key] || s.value < threshold(t)) return;
        if (opts.tests && opts.tests.indexOf(t) < 0) return;
        if (!best[key] || s.value > best[key].value) best[key] = Object.assign({ test: t, workoutEventId: w.id, workoutId: w.workoutId, date: w.finishedAt || w.at }, s);
      });
      Object.keys(best).forEach(function (k) { out.push(best[k]); });
    });
    return out;
  }
  // The tests new evidence can still matter for: all three before the Exit;
  // afterwards only those an Academy entry still needs.
  function evidenceWanted(state) {
    if (!ofType(state, 'foundation_exit_passed').length) return Object.keys(CONFIRM_NEEDS);
    var t = [];
    academyStatus(state).goals.forEach(function (g) { g.needs.forEach(function (n) { if (!n.ok && CONFIRM_NEEDS[n.test] && t.indexOf(n.test) < 0) t.push(n.test); }); });
    return t;
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
    return out.concat(trainingEvidence(state));
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
  // Local entry uses the same exact-test evidence, but NOT the Foundation's 45-day
  // window: that window is for the initial Exit only, and no freshness rule is
  // approved for specialist entry. Shown capability is not expired by time.
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

  // ---- history from the athlete's own log --------------------------------------------
  // A history file carries workouts and Max Tests the athlete logged elsewhere
  // (e.g. a spreadsheet). Importing only ADDS events; an entry whose id is already
  // in the state is skipped, so importing the same file twice changes nothing.
  // Imported workouts keep the prescription snapshot like any other record, are
  // marked source 'imported', and never count as Foundation evidence (that needs
  // a set confirmed in the app).
  var HISTORY_KIND = 'spc-history';
  function importHistory(pkg, state, file) {
    var out = { state: state && state.events ? state : emptyState(), added: { workouts: 0, maxTests: 0 }, skipped: 0, errors: [] };
    if (!file || file.kind !== HISTORY_KIND || !Array.isArray(file.events)) { out.errors.push('not a history file'); return out; }
    var have = {}; events(out.state).forEach(function (e) { have[e.id] = true; });
    file.events.forEach(function (x, i) {
      var where = 'entry ' + (i + 1);
      if (!x || !x.id) { out.errors.push(where + ': no id'); return; }
      if (have[x.id]) { out.skipped++; return; }
      var ev;
      if (x.type === 'workout_completed') {
        var w = pkg.workouts[x.workoutId];
        if (!w) { out.errors.push(where + ': unknown workout ' + x.workoutId); return; }
        var blocks = w.blocks.map(function (b, k) { return (x.result || [])[k] || { variant: 'easy', skipped: true }; });
        ev = completionEvent(pkg, x.workoutId, { startedAt: null, blocks: blocks }, x.date || 'unknown');
        ev.source = 'imported'; ev.finishedAt = x.date || null; ev.dateUnknown = !x.date; ev.note = x.note || null;
        out.added.workouts++;
      } else if (x.type === 'maxtest_recorded') {
        if (!pkg.sequence.some(function (n) { return n.id === x.nodeId && n.type === 'maxtest'; })) { out.errors.push(where + ': unknown Max Test ' + x.nodeId); return; }
        ev = { type: 'maxtest_recorded', nodeId: x.nodeId, date: x.date || null, results: JSON.parse(JSON.stringify(x.results || [])), source: 'imported', note: x.note || null };
        out.added.maxTests++;
      } else { out.errors.push(where + ': not a workout or a Max Test'); return; }
      ev.id = x.id; ev.importedFrom = file.source || null;
      out.state = addEvent(out.state, ev);
      have[x.id] = true;
    });
    return out;
  }

  // ---- migration of the existing athlete ------------------------------------------
  // The athlete who used the earlier app is mid-program: Beginner Program,
  // Phase 4, with the four required workouts of Week 3 done (as reported), so
  // the path opens at Week 4. Only what was reported is recorded: no set data,
  // and not the optional Legs session. Earlier content becomes "placed past",
  // never fabricated completions.
  function migrationEvents() {
    return [{ type: 'enrolled', programId: 'calixpert-beginner', start: 'P4W3', basis: 'migration',
      note: 'Existing athlete: Beginner Program, Phase 4; the required workouts of Week 3 done (reported).' }]
      .concat(['P4W3-1', 'P4W3-2', 'P4W3-3', 'P4W3-4'].map(function (id) {
        return { type: 'workout_completed', workoutId: id, source: 'reported',
          note: 'Reported by the athlete as done before this build. No set data.' };
      }));
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
    CONFIRM_NEEDS: CONFIRM_NEEDS, trainingTest: trainingTest, performedSets: performedSets, trainingEvidence: trainingEvidence,
    trainingCandidates: trainingCandidates, evidenceWanted: evidenceWanted,
    HISTORY_KIND: HISTORY_KIND, importHistory: importHistory,
    foundationStatus: foundationStatus, academyStatus: academyStatus, migrationEvents: migrationEvents
  };
});
