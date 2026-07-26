/*
 * Skill Progression Coach — Daily Workout + Progress/History aggregation (UMD).
 *
 * A DAILY WORKOUT is the real unit of execution: an ordered queue of the day's
 * planned exercises, each with its own status and per-exercise result. The app
 * runs ONE exercise at a time and resumes the next unfinished one — a completed
 * exercise is never silently restarted, and finishing a volume workout never
 * turns into a max test.
 *
 * This module is pure/testable: it builds the daily entity from a resolved day,
 * maps each exercise to a runner type, answers resume questions, and aggregates
 * completed sessions into the weekly summary + history (with delete/exclude
 * recomputation). Rendering + the live runner live in app.js.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(function () { return require('./week.js'); });
  else root.CoachDaily = factory(function () { return root.CoachWeek; });
})(typeof self !== 'undefined' ? self : this, function (getWeek) {
  'use strict';
  function Week() { return getWeek(); }

  var DAILY_VERSION = 1;

  // exId → history "type" tag (drives the weekly summary + filters).
  var TYPE_OF = {
    pullup_ladder: 'ladder', pullup_pyramid: 'pyramid', pistol: 'pistol',
    t2b: 't2b', deadhang: 'hold', ringsupport: 'ring', tophold: 'hold',
    highpull: 'pull', transition_drill: 'skill', pbdips: 'push', bouldering: 'climbing',
    wristroller: 'grip', hip_abduction: 'legs', bulgarian_split: 'legs',
    hip_thrust: 'legs', deadlift_rdl: 'legs', incline_press: 'push',
    chest_fly: 'push', biceps: 'arms', triceps: 'arms', light_pullups: 'ladder'
  };
  function typeOf(exId) { return TYPE_OF[exId] || 'other'; }

  // Which runner drives an exercise (from its block scheme + metadata).
  function runnerType(exId) {
    var W = Week(), m = W && W.EX[exId], b = m && m.block;
    if (!b) return 'none';
    if (b.scheme === 'ladder') return 'ladder';
    if (b.scheme === 'pyramid') return 'pyramid';
    if (b.scheme === 'hold') return 'hold';
    if (b.scheme === 'amrap') return 'assessment';
    if (m.unilateral) return 'unilateral';
    return 'sets';
  }

  // A weekday's BASE session — the climbing session or the group-workout log —
  // modelled as its own queue item (kind:'base') so it coexists with whatever
  // exercises the user has assigned to that day, instead of the day's type
  // (climbing/group/rest) gating whether assigned exercises are executable at
  // all. Strength days and rest days with no base action return null; the
  // exercise queue alone is the day's content.
  function dayBaseItem(res) {
    var day = res.day;
    var doneAlready = res.status === 'completed';
    if (day.type === 'climbing' && res.templateId) {
      return {
        exId: 'bouldering', kind: 'base', baseType: 'climbing',
        name: day.session + (day.sub ? ' · ' + day.sub : ''), templateId: res.templateId,
        priority: 'A', role: 'Main Session', runner: 'climbing', statusLabel: 'Required',
        reason: '', note: '', included: true, replaced: false, removed: false,
        required: true, optional: false, conditional: false, order: 0,
        state: doneAlready ? 'completed' : 'not_started', result: null
      };
    }
    if (day.type === 'group') {
      return {
        exId: '_group', kind: 'base', baseType: 'group', name: 'Group Workout Log',
        priority: 'A', role: 'Main Session', runner: 'group', statusLabel: 'Required',
        reason: '', note: '', included: true, replaced: false, removed: false,
        required: true, optional: false, conditional: false, order: 0,
        state: doneAlready ? 'completed' : 'not_started', result: null
      };
    }
    return null;
  }
  // Build the daily-workout entity from a resolved day (Week.resolveDay result).
  // Every planned exercise is kept VISIBLE; `included` marks the ones that run.
  // The day's base session (if any) is item 0; every exercise the user has
  // assigned to this weekday — regardless of the day's climbing/group/rest
  // type — follows as its own independently executable queue item (Part:
  // "do not model weekdays as mutually exclusive execution modes").
  function makeDaily(res, ctx) {
    ctx = ctx || {};
    var W = Week();
    var base = dayBaseItem(res);
    // 'bouldering' is the climbing day's requirement PLACEHOLDER (used only for
    // Progress/Week display); the base item above represents its real
    // execution, so it is not duplicated as a dead, non-runnable exercise row.
    var skipExId = (res.day.type === 'climbing') ? 'bouldering' : null;
    var exItems = res.items.filter(function (it) { return it.exId !== skipExId; }).map(function (it) {
      var meta = it.ex || {};
      var runnable = it.included && meta.block;
      return {
        exId: it.exId, name: meta.name || it.exId, priority: it.priority,
        role: meta.role || '', runner: runnable ? runnerType(it.exId) : 'none',
        statusLabel: it.statusLabel, reason: it.reason || '', note: it.note || '',
        included: !!it.included, replaced: !!it.replaced, removed: !!it.removed,
        required: it.status === 'required' && it.included && !it.removed && !it.replaced,
        optional: it.status === 'optional', conditional: it.status === 'conditional',
        order: 0, state: 'not_started', result: null
      };
    });
    var exercises = base ? [base].concat(exItems) : exItems;
    exercises.forEach(function (e, i) { e.order = i; });
    // A non-blocking note (never a restriction) when a day originally
    // recommended as rest now carries executable, user-assigned work.
    var restWarning = (res.day.type === 'rest' && exItems.some(function (e) { return e.included && e.runner !== 'none'; }))
      ? 'This day was originally recommended as a rest day.' : '';
    return {
      version: DAILY_VERSION, id: 'dw_' + (ctx.dateKey || dateKey(new Date())),
      date: (ctx.date || new Date().toISOString()), weekday: res.day.id, dayKey: res.day.key,
      session: res.day.session, sub: res.day.sub || '', goal: res.day.goal || null,
      planVersion: (W && W.PLAN_VERSION) || 0,
      adaptations: (res.adaptations || []).map(function (a) { return a.cause; }),
      restWarning: restWarning,
      exercises: exercises, activeExId: null, status: 'not_started'
    };
  }
  function dateKey(d) { return d.toISOString().slice(0, 10); }

  // Build an AD-HOC daily-workout entity from a chosen list of exercises. Same
  // shape as a scheduled daily so it flows through the identical runner, resume
  // and completion code — never a weaker "quick log". `items` is an ordered list
  // of { exId, block? } where an optional block overrides the exercise's default
  // prescription (used by the custom builder + the Max Test amrap).
  function makeAdhocDaily(items, ctx) {
    ctx = ctx || {};
    var W = Week();
    var exercises = (items || []).map(function (it, i) {
      var meta = (W && W.EX[it.exId]) || {};
      var runner = it.block ? schemeRunner(it.block, meta) : runnerType(it.exId);
      return {
        exId: it.exId, name: it.name || meta.name || it.exId, priority: meta.priority || 'C',
        role: meta.role || '', runner: runner, statusLabel: 'Required', reason: '', note: it.note || '',
        included: true, replaced: false, removed: false,
        required: true, optional: false, conditional: false,
        order: i, state: 'not_started', result: null, block: it.block || null
      };
    });
    return {
      version: DAILY_VERSION, id: ctx.id || ('adhoc_' + Date.now()), adhoc: true,
      date: (ctx.date || new Date().toISOString()), weekday: ctx.weekday != null ? ctx.weekday : new Date().getDay(),
      dayKey: 'adhoc', session: ctx.session || 'Custom Workout', sub: ctx.sub || '', goal: null,
      planVersion: (W && W.PLAN_VERSION) || 0, adaptations: [],
      classification: ctx.classification || 'extra', appliedDay: (ctx.appliedDay != null ? ctx.appliedDay : null),
      templateName: ctx.templateName || '', exercises: exercises, activeExId: null, status: 'not_started'
    };
  }
  function schemeRunner(b, m) {
    if (!b) return 'none';
    if (b.scheme === 'ladder') return 'ladder';
    if (b.scheme === 'pyramid') return 'pyramid';
    if (b.scheme === 'hold') return 'hold';
    if (b.scheme === 'amrap') return 'assessment';
    if (m && m.unilateral) return 'unilateral';
    return 'sets';
  }

  function findEx(daily, exId) { for (var i = 0; i < daily.exercises.length; i++) if (daily.exercises[i].exId === exId) return daily.exercises[i]; return null; }
  function runnable(ex) { return ex.included && ex.runner !== 'none' && !ex.removed && !ex.replaced; }

  // The first REQUIRED exercise that is not yet completed/skipped, in order.
  function firstUnfinishedRequired(daily) {
    for (var i = 0; i < daily.exercises.length; i++) {
      var e = daily.exercises[i];
      if (e.required && e.state !== 'completed' && e.state !== 'skipped') return e.exId;
    }
    return null;
  }
  // The next runnable, unfinished exercise after `fromExId` (required first,
  // then optional/conditional) — used by "Continue".
  function nextUnfinished(daily, fromExId) {
    var start = 0;
    if (fromExId) { var f = findEx(daily, fromExId); if (f) start = f.order + 1; }
    // pass 1: required after the current position
    for (var i = start; i < daily.exercises.length; i++) {
      var e = daily.exercises[i];
      if (runnable(e) && e.required && e.state !== 'completed' && e.state !== 'skipped') return e.exId;
    }
    // pass 2: any unfinished required anywhere
    var fr = firstUnfinishedRequired(daily); if (fr) return fr;
    // pass 3: optional/conditional after position
    for (var j = start; j < daily.exercises.length; j++) {
      var o = daily.exercises[j];
      if (runnable(o) && e_state_open(o)) return o.exId;
    }
    return null;
  }
  function e_state_open(e) { return e.state !== 'completed' && e.state !== 'skipped'; }

  function progress(daily) {
    var reqTotal = 0, reqDone = 0, total = 0, done = 0;
    daily.exercises.forEach(function (e) {
      if (e.required) { reqTotal++; if (e.state === 'completed' || e.state === 'skipped') reqDone++; }
      if (runnable(e)) { total++; if (e.state === 'completed') done++; }
    });
    return { requiredTotal: reqTotal, requiredDone: reqDone, total: total, done: done };
  }
  // The day is complete when every required exercise is completed or skipped.
  // Optional/conditional exercises may remain incomplete.
  function isDayComplete(daily) {
    return daily.exercises.every(function (e) { return !e.required || e.state === 'completed' || e.state === 'skipped'; });
  }

  // ── weekly summary + history aggregation ────────────────────────────────
  function weekStart(now) { var d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d.getTime(); }
  function inThisWeek(iso, now) { var t = new Date(iso).getTime(); return t >= weekStart(now) && t < weekStart(now) + 7 * 864e5; }

  // Normalise any stored session (new daily, old flat strength, climbing) into a
  // common shape for aggregation.
  function sessionExercises(s) {
    if (s.exercises) return s.exercises; // new daily workout
    // old flat strength session → derive from templateId + exResults
    var out = [];
    var tmpl = s.templateId || '';
    if (s.kind === 'climbing') return [{ exId: 'bouldering', type: 'climbing', reps: 0 }];
    var reps = (s.exResults && s.exResults.pullup && s.exResults.pullup.bestReps) || 0;
    var type = /volume|pyramid/.test(tmpl) ? 'pyramid' : (/strength|ladder/.test(tmpl) ? 'ladder' : 'other');
    out.push({ exId: type === 'pyramid' ? 'pullup_pyramid' : 'pullup_ladder', type: type, reps: reps, actualReps: reps, bestReps: reps, standalone: true });
    return out;
  }
  function exReps(e) { return e.actualReps != null ? e.actualReps : (e.reps || 0); }

  function weeklySummary(sessions, plan, now) {
    now = now || Date.now();
    var live = (sessions || []).filter(function (s) { return !s.excluded; });
    var wk = live.filter(function (s) { return inThisWeek(s.date, now); });
    var counts = {}, pullReps = 0, ladderRounds = 0, dailyDone = 0;
    function bump(t) { counts[t] = (counts[t] || 0) + 1; }
    wk.forEach(function (s) {
      if (s.kind === 'daily' && s.status === 'completed') dailyDone++;
      if (s.kind === 'climbing') bump('climbing');
      if (s.kind === 'group') bump('group');
      if (s.assessment) bump('assessment');
      sessionExercises(s).forEach(function (e) {
        if (e.state && e.state !== 'completed') return;
        var t = e.type || typeOf(e.exId);
        bump(t);
        if (t === 'ladder' || t === 'pyramid') pullReps += exReps(e);
        if (t === 'ladder') ladderRounds += (e.actualRounds || 0);
      });
    });
    // requirement denominators (per exercise type, from the plan)
    var req = (plan && plan.requirements) || {};
    function target(exId) { return (req[exId] && req[exId].target) || 0; }
    var lines = [
      { key: 'climbing', label: 'Climbing', done: counts.climbing || 0, target: target('bouldering') },
      { key: 'ladder', label: 'Pull-Up Ladder', done: counts.ladder || 0, target: target('pullup_ladder') },
      { key: 'pyramid', label: 'Pull-Up Pyramid', done: counts.pyramid || 0, target: target('pullup_pyramid') },
      { key: 'pistol', label: 'Pistol Squat', done: counts.pistol || 0, target: target('pistol') },
      { key: 't2b', label: 'Toes-to-Bar', done: counts.t2b || 0, target: target('t2b') },
      { key: 'ring', label: 'Ring Support Hold', done: counts.ring || 0, target: target('ringsupport'), optional: true }
    ];
    return {
      lines: lines, counts: counts, pullReps: pullReps, ladderRounds: ladderRounds,
      dailySessions: dailyDone, assessments: counts.assessment || 0, groups: counts.group || 0
    };
  }

  // Chronological history entries (newest first).
  // A session predates the daily-workout system when it is not one of the new
  // structured kinds — those legacy entries are labelled "Standalone workout".
  function isStandalone(s) { return !!s.standalone || (s.kind !== 'daily' && s.kind !== 'climbing' && s.kind !== 'group' && !s.classification); }

  // Canonical history classification (Part 9). A single, explicit label per
  // session drives both the history badge and the load/progress accounting.
  var CLASS_LABEL = {
    scheduled: 'Scheduled Workout', adapted: 'Adapted Scheduled Workout', extra: 'Extra Workout',
    standalone: 'Standalone Exercise', assessment: 'Assessment', test: 'Test / Excluded'
  };
  function classify(s) {
    if (s.excluded) return 'test';
    if (s.classification && CLASS_LABEL[s.classification]) return s.classification;
    if (s.assessment) return 'assessment';
    if (s.kind === 'daily') return (s.adaptations && s.adaptations.length) ? 'adapted' : 'scheduled';
    if (s.kind === 'climbing' || s.kind === 'group') return 'scheduled';
    return 'standalone';
  }
  function classLabel(c) { return CLASS_LABEL[c] || 'Workout'; }

  function historyEntries(sessions) {
    return (sessions || []).slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); })
      .map(function (s) {
        var exs = sessionExercises(s);
        var standalone = isStandalone(s);
        var cls = classify(s);
        return {
          id: s.id, date: s.date, weekday: s.weekday != null ? s.weekday : new Date(s.date).getDay(),
          name: s.session || (s.kind === 'climbing' ? 'Climbing Session' : (cls === 'extra' ? 'Extra Workout' : (standalone ? 'Standalone workout' : 'Workout'))),
          kind: s.kind, exercises: exs, excluded: !!s.excluded, standalone: standalone,
          assessment: !!s.assessment, status: s.status || 'completed',
          classification: cls, classLabel: classLabel(cls), reason: s.classReason || '',
          appliedExIds: s.appliedExIds || [], origin: s.origin || (standalone ? 'adhoc' : 'plan'),
          types: uniq(exs.map(function (e) { return e.type || typeOf(e.exId); }).concat(s.kind === 'climbing' ? ['climbing'] : []))
        };
      });
  }
  function uniq(a) { var o = {}, r = []; a.forEach(function (x) { if (!o[x]) { o[x] = 1; r.push(x); } }); return r; }

  // Pulling/grip load contributed by this week's EXTRA (ad-hoc, non-test)
  // sessions, so the Weekly Coach sees real unscheduled volume (Part 5). Test /
  // excluded sessions never contribute.
  // A dedicated extra pull session (ladder/pyramid) is elevated load on its own
  // (score 3 crosses the weeklyLoad 'elevated' threshold); lighter pulling is 2.
  var PULL_SCORE = { ladder: 3, pyramid: 3, pull: 2, push: 0 };
  var GRIP_SCORE = { ladder: 1, pyramid: 1, hold: 1, grip: 1, t2b: 1 };
  function extraLoad(sessions, now) {
    now = now || Date.now();
    var pull = 0, grip = 0;
    (sessions || []).forEach(function (s) {
      if (s.excluded) return;
      if (classify(s) !== 'extra') return;
      if (!inThisWeek(s.date, now)) return;
      sessionExercises(s).forEach(function (e) {
        if (e.state && e.state !== 'completed') return;
        var t = e.type || typeOf(e.exId);
        pull += (PULL_SCORE[t] || 0);
        grip += (GRIP_SCORE[t] || 0);
      });
    });
    return { pull: pull, grip: grip };
  }

  // Load contributed by PLAN-ASSIGNED exercises completed on a day OUTSIDE
  // their recommended day(s) — e.g. Toes-to-Bar assigned (via Edit Plan) to
  // Sunday and completed there. That is genuinely additional volume the base
  // approved plan never assumed, so the Weekly Coach treats it the same as an
  // ad-hoc extra session (same PULL_SCORE/GRIP_SCORE table). Exercises
  // completed on their recommended day contribute nothing extra here — that
  // load is already what the approved plan expects.
  function planExtraLoad(sessions, plan, now) {
    now = now || Date.now();
    var req = (plan && plan.requirements) || {};
    var pull = 0, grip = 0;
    (sessions || []).forEach(function (s) {
      if (s.excluded) return;
      var cls = classify(s);
      if (cls !== 'scheduled' && cls !== 'adapted') return;
      if (!inThisWeek(s.date, now)) return;
      var weekday = s.weekday;
      sessionExercises(s).forEach(function (e) {
        if (e.state && e.state !== 'completed') return;
        if (e.exId === 'bouldering' || e.exId === '_group') return; // base session, not "extra"
        var r = req[e.exId]; if (!r) return;
        var recDays = r.recDays || [];
        if (recDays.length && recDays.indexOf(weekday) >= 0) return; // on its recommended day
        var t = e.type || typeOf(e.exId);
        pull += (PULL_SCORE[t] || 0);
        grip += (GRIP_SCORE[t] || 0);
      });
    });
    return { pull: pull, grip: grip };
  }

  // Recompute the pull-up-max benchmark from the surviving (non-excluded)
  // sessions — used after a delete/exclude so a removed PR no longer counts.
  function recomputeBench(sessions) {
    var maxPull = 0;
    (sessions || []).forEach(function (s) {
      if (s.excluded) return;
      sessionExercises(s).forEach(function (e) {
        var t = e.type || typeOf(e.exId);
        if (t === 'ladder' || t === 'pyramid' || e.exId === 'pullup') {
          maxPull = Math.max(maxPull, e.bestReps || 0);
        }
        if (s.assessment && e.exId === 'pullup') maxPull = Math.max(maxPull, exReps(e));
      });
    });
    return { pullup_max: maxPull };
  }

  return {
    DAILY_VERSION: DAILY_VERSION, typeOf: typeOf, runnerType: runnerType,
    makeDaily: makeDaily, makeAdhocDaily: makeAdhocDaily, findEx: findEx, firstUnfinishedRequired: firstUnfinishedRequired,
    nextUnfinished: nextUnfinished, progress: progress, isDayComplete: isDayComplete,
    weeklySummary: weeklySummary, historyEntries: historyEntries, sessionExercises: sessionExercises,
    recomputeBench: recomputeBench, classify: classify, classLabel: classLabel, CLASS_LABEL: CLASS_LABEL,
    extraLoad: extraLoad, planExtraLoad: planExtraLoad, inThisWeek: inThisWeek, weekStart: weekStart, dateKey: dateKey
  };
});
