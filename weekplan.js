/*
 * Skill Progression Coach — the athlete's week plan (Today and Plan).
 *
 * The program has no days. The week plan puts program items on dates. It is
 * additive and athlete-owned: an append-only list of events, kept apart from
 * the training record, so removing it loses no training data. Nothing here
 * moves the program position: that stays derived from completions only
 * (program.js), and a date passing changes nothing either.
 *
 * Events (APP-BLUEPRINT §12):
 *   week_proposed     { weekStart, placements: [{ date, item }] }
 *   week_accepted     { weekStart }
 *   placement_changed { weekStart, item, from, to, reason }
 *       from / to are dates, or null for "Not placed"; a move is one event.
 *       reason: 'athlete' (an edit) or 'suggestion' (a coach suggestion the
 *       athlete accepted).
 *   day_unavailable   { date }, and its undo day_available { date }
 *
 * An item is a program workout id (P4W4-3; P4W4-L is an optional session) or
 * a Max Test node id (MT4). A recovery week is not placed on a day: it is the
 * whole week, read from the program position.
 *
 * Until a week is stored, its proposal is computed and never written: it
 * follows the program and the training days, from today on. A week is stored
 * when the athlete accepts it or changes it; from then on only the athlete's
 * own events change it.
 *
 * Dates are local calendar days, 'YYYY-MM-DD'. The week starts on Sunday (D13).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./program.js'));
  else root.CoachWeekPlan = factory(root.CoachProgram);
})(typeof self !== 'undefined' ? self : this, function (Program) {
  'use strict';

  var VERSION = 1;
  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // ---- dates -------------------------------------------------------------------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  // A Date, or a timestamp, to its local calendar day.
  function dateKey(d) { d = d == null ? new Date() : new Date(d); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseKey(k) { var p = String(k).split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); } // noon: safe across a clock change
  function addDays(k, n) { var d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); }
  function dow(k) { return parseKey(k).getDay(); }
  function weekStartOf(k) { return addDays(k, -dow(k)); }
  function weekDates(ws) { var out = []; for (var i = 0; i < 7; i++) out.push(addDays(ws, i)); return out; }

  // ---- state -------------------------------------------------------------------
  function emptyPlan() { return { version: VERSION, events: [] }; }
  function events(plan) { return (plan && plan.events) || []; }
  function addEvent(plan, ev) {
    var p = plan && plan.events ? plan : emptyPlan();
    var e = Object.assign({ id: Program.newId(ev.type), at: new Date().toISOString() }, ev);
    return { version: VERSION, events: events(p).concat([e]) };
  }
  function addEvents(plan, list) { (list || []).forEach(function (e) { plan = addEvent(plan, e); }); return plan; }

  // ---- items -------------------------------------------------------------------
  function isMaxTest(pkg, item) { return pkg.sequence.some(function (n) { return n.id === item && n.type === 'maxtest'; }); }
  function itemLabel(pkg, item) {
    var w = pkg.workouts[item];
    if (w) return w.optional ? 'Legs' : w.title.replace(/^Workout \d+ - /, '');
    if (isMaxTest(pkg, item)) return 'Max Test';
    return String(item);
  }
  function weekIdOf(pkg, item) { var w = pkg.workouts[item]; return w ? 'P' + w.phase + 'W' + w.week : null; }

  // The work the program has open now: the current week's workouts not done yet
  // (required, and optional), or the Max Test when that is where the athlete is.
  // A recovery week has no day items.
  function openItems(pkg, st) {
    var v = Program.pathView(pkg, st), cur = v.current;
    var out = { node: cur, view: v, required: [], optional: [] };
    if (!cur) return out;
    var undone = function (id) { return !Program.completions(st, id).length; };
    if (cur.type === 'week') {
      out.required = Program.requiredOf(pkg, cur.id).filter(undone);
      out.optional = Program.optionalOf(pkg, cur.id).filter(undone);
    } else if (cur.type === 'maxtest') out.required = [cur.id];
    return out;
  }
  // What a proposal places, in program order: the open work, then the Max Test
  // that follows the current week. A recovery week, or the next training week,
  // is never pulled into the same calendar week.
  function itemsAhead(pkg, st, includeOptional) {
    var o = openItems(pkg, st), list = o.required.slice();
    if (includeOptional) list = list.concat(o.optional);
    if (o.node && o.node.type === 'week') {
      var next = o.view.nodes[o.node.index + 1];
      if (next && next.type === 'maxtest' && next.status !== 'done') list.push(next.id);
    }
    return list;
  }
  // Can this item be started now? A workout of the current week, a workout done
  // before (a repeat), or the Max Test the program has reached.
  function ready(pkg, st, item) {
    var cur = Program.pathView(pkg, st).current, w = pkg.workouts[item];
    if (w) return Program.completions(st, item).length > 0 || (!!cur && cur.type === 'week' && cur.id === weekIdOf(pkg, item));
    return !!cur && cur.id === item;
  }

  // What was done on each day, by the local date it was finished. A record
  // without a real date (a reported mark, an undated import) belongs to no day.
  function doneByDate(pkg, st) {
    var out = {};
    function put(when, rec) { var k = dateKey(when); (out[k] = out[k] || []).push(rec); }
    Program.ofType(st, 'workout_completed').forEach(function (e) {
      if (e.source === 'reported' || e.dateUnknown || !pkg.workouts[e.workoutId]) return;
      var when = e.finishedAt || (e.source === 'imported' ? null : e.at);
      if (when && !isNaN(new Date(when))) put(when, { item: e.workoutId, eventId: e.id, kind: 'workout' });
    });
    Program.ofType(st, 'maxtest_recorded').forEach(function (e) {
      var when = e.date || (e.source === 'imported' ? null : e.at);
      if (when && !isNaN(new Date(when))) put(when, { item: e.nodeId, eventId: e.id, kind: 'maxtest' });
    });
    return out;
  }

  // ---- the stored week ---------------------------------------------------------
  // The latest proposal stored for the week, with every change made after it.
  function storedWeek(plan, ws) {
    var evs = events(plan), base = -1;
    evs.forEach(function (e, i) { if (e.type === 'week_proposed' && e.weekStart === ws) base = i; });
    if (base < 0) return null;
    var placements = (evs[base].placements || []).map(function (p) { return { date: p.date, item: p.item, movedFrom: null }; });
    var accepted = false;
    for (var i = base + 1; i < evs.length; i++) {
      var e = evs[i];
      if (e.weekStart !== ws) continue;
      if (e.type === 'week_accepted') accepted = true;
      else if (e.type === 'placement_changed') {
        var k = -1;
        placements.forEach(function (p, j) { if (k < 0 && p.item === e.item && p.date === e.from) k = j; });
        var was = k >= 0 ? placements.splice(k, 1)[0] : null;
        if (e.to) {
          var origin = e.from ? ((was && was.movedFrom) || e.from) : null;
          placements.push({ date: e.to, item: e.item, movedFrom: origin && origin !== e.to ? origin : null });
        }
      }
    }
    return { placements: placements, accepted: accepted };
  }
  function unavailableDates(plan) {
    var m = {};
    events(plan).forEach(function (e) {
      if (e.type === 'day_unavailable') m[e.date] = true;
      else if (e.type === 'day_available') delete m[e.date];
    });
    return m;
  }

  // The coach's proposal: the items, in order, one per training day from `from`
  // on. A day that already holds something (a placement, or work done that
  // day) and an unavailable day are skipped.
  function propose(o) {
    var out = [], k = 0, items = o.items || [];
    weekDates(o.weekStart).forEach(function (d) {
      if (k >= items.length || d < o.from) return;
      if ((o.trainingDays || []).indexOf(dow(d)) < 0) return;
      if ((o.unavailable && o.unavailable[d]) || (o.busy && o.busy[d])) return;
      out.push({ date: d, item: items[k++] });
    });
    return out;
  }

  // ---- the week as the athlete sees it -----------------------------------------
  // o: { today, trainingDays: [0..6], includeOptional }
  function weekView(pkg, st, plan, o) {
    var today = o.today, ws = weekStartOf(today), dates = weekDates(ws);
    var unav = unavailableDates(plan), done = doneByDate(pkg, st);
    var open = openItems(pkg, st), cur = open.node;
    var recovery = !!cur && cur.type === 'deload';
    var s = storedWeek(plan, ws), placements;
    if (s) placements = s.placements;
    else {
      var busy = {}; dates.forEach(function (d) { if (done[d]) busy[d] = true; });
      placements = recovery ? [] : propose({ weekStart: ws, from: today, trainingDays: o.trainingDays, unavailable: unav, busy: busy,
        items: itemsAhead(pkg, st, o.includeOptional) });
    }
    // What was done this week fulfils the placement of the same item; anything
    // else done this week shows on its own day.
    var weekDone = [];
    dates.forEach(function (d) { (done[d] || []).forEach(function (r) { weekDone.push(Object.assign({ date: d }, r)); }); });
    var used = {};
    var entries = placements.map(function (p) {
      var mine = weekDone.filter(function (r) { return r.item === p.item && !used[r.eventId]; });
      var r = mine.filter(function (x) { return x.date === p.date; })[0] || mine[0];
      if (r) used[r.eventId] = true;
      var state = r ? 'done' : p.date < today ? 'missed' : p.date === today ? 'today' : 'planned';
      return { date: p.date, item: p.item, kind: 'placed', state: state, movedFrom: p.movedFrom || null,
        doneOn: r && r.date !== p.date ? r.date : null, eventId: r ? r.eventId : null,
        maxtest: isMaxTest(pkg, p.item), ready: state === 'done' || ready(pkg, st, p.item) };
    });
    weekDone.forEach(function (r) {
      if (!used[r.eventId]) entries.push({ date: r.date, item: r.item, kind: 'extra', state: 'done', eventId: r.eventId, maxtest: r.kind === 'maxtest', ready: true });
    });
    var days = dates.map(function (d) {
      return { date: d, dow: dow(d), isToday: d === today, past: d < today, unavailable: !!unav[d],
        training: (o.trainingDays || []).indexOf(dow(d)) >= 0,
        entries: entries.filter(function (e) { return e.date === d; }) };
    });
    var placed = {}; placements.forEach(function (p) { placed[p.item] = true; });
    var tray = recovery ? [] : open.required.concat(open.optional).filter(function (i) { return !placed[i]; });

    var position = null;
    if (cur) {
      position = { id: cur.id, type: cur.type, phase: cur.phase || cur.afterPhase || null, week: cur.week || null };
      if (cur.type === 'week') { var wp = Program.weekProgress(pkg, st, cur.id); position.done = wp.done; position.total = wp.total; }
    }
    var next = cur ? open.view.nodes.slice(cur.index + 1).filter(function (n) { return n.status !== 'done'; }).slice(0, 2) : [];

    // When everything placed this week is done and the program has more to
    // give, the rest of the week can be planned with it — as a suggestion the
    // athlete accepts, never as a silent change.
    var suggestion = null;
    if (s && !recovery && !entries.some(function (e) { return e.kind === 'placed' && e.state !== 'done'; })) {
      var ahead = itemsAhead(pkg, st, o.includeOptional).filter(function (i) { return !placed[i]; });
      var taken = {}; entries.forEach(function (e) { taken[e.date] = true; });
      dates.forEach(function (d) { if (done[d]) taken[d] = true; });
      var sp = ahead.length ? propose({ weekStart: ws, from: today, trainingDays: o.trainingDays, unavailable: unav, busy: taken, items: ahead }) : [];
      if (sp.length) {
        // "Week 4 is done." — said only when the week planned here is complete.
        var weeks = {}; placements.forEach(function (p) { var wk = weekIdOf(pkg, p.item); if (wk) weeks[wk] = true; });
        var wk = Object.keys(weeks), finished = null;
        if (wk.length === 1 && Program.nodeComplete(pkg, st, { type: 'week', id: wk[0] })) finished = 'Week ' + pkg.weeks[wk[0]].week;
        suggestion = { placements: sp, finished: finished };
      }
    }

    return { weekStart: ws, today: today, dates: dates, days: days, entries: entries, placements: placements,
      stored: !!s, accepted: !!(s && s.accepted), recovery: recovery, tray: tray, position: position, next: next,
      suggestion: suggestion, trainingDaysSet: (o.trainingDays || []).length > 0 };
  }

  // ---- Today -------------------------------------------------------------------
  // In order: today's first planned item not done yet; else what was done today;
  // else the recovery week; else an open day. (A workout in progress comes
  // before all of these; the app knows about it, this module does not.)
  function todayView(pkg, st, plan, o) {
    var wv = weekView(pkg, st, plan, o), today = o.today;
    var day = wv.days.filter(function (d) { return d.isToday; })[0];
    var all = []; wv.days.forEach(function (d) { d.entries.forEach(function (e) { all.push(e); }); });
    var r = { week: wv, doneToday: day.entries.filter(function (e) { return e.state === 'done'; }),
      next: all.filter(function (e) { return e.kind === 'placed' && e.state === 'planned' && e.date > today; })[0] || null,
      missed: all.filter(function (e) { return e.kind === 'placed' && e.state === 'missed' && e.ready; })[0] || null };
    var undone = day.entries.filter(function (e) { return e.kind === 'placed' && e.state === 'today'; });
    if (undone.length) {
      r.entry = undone[0];
      r.kind = r.entry.maxtest ? 'maxtest' : 'session';
      // A planned item the program has not reached yet: what comes first, and
      // where it is planned, if it is.
      if (!r.entry.ready) {
        var first = openItems(pkg, st).required[0] || null;
        var at = first ? all.filter(function (e) { return e.item === first && e.kind === 'placed' && e.state !== 'done'; })[0] : null;
        r.blockedBy = first ? { item: first, date: at ? at.date : null } : null;
      }
      return r;
    }
    if (r.doneToday.length) { r.kind = 'done'; return r; }
    if (wv.recovery) { r.kind = 'recovery'; return r; }
    r.kind = 'open';
    // "This week's training is done": workouts were planned or done this week,
    // every one of them is done, and the program's next item is the Max Test.
    // A week with no workouts in it (a new athlete before the first Max Test)
    // is never called done.
    var workouts = all.filter(function (e) { return !e.maxtest; });
    r.weekDone = !r.missed && !!wv.position && wv.position.type === 'maxtest' && workouts.length > 0 &&
      workouts.every(function (e) { return e.state === 'done'; });
    return r;
  }

  // ---- changes the athlete makes -------------------------------------------------
  // Every change applies to the week the athlete can see: an unstored proposal
  // is stored first, exactly as it was shown.
  function storeEvents(view) {
    if (view.stored) return [];
    return [{ type: 'week_proposed', weekStart: view.weekStart, placements: view.placements.map(function (p) { return { date: p.date, item: p.item }; }) }];
  }
  function acceptEvents(view) { return storeEvents(view).concat(view.accepted ? [] : [{ type: 'week_accepted', weekStart: view.weekStart }]); }
  // changes: [{ item, from, to, reason }]
  function changeEvents(view, changes) {
    return storeEvents(view).concat((changes || []).map(function (c) {
      return { type: 'placement_changed', weekStart: view.weekStart, item: c.item, from: c.from || null, to: c.to || null, reason: c.reason || 'athlete' };
    }));
  }
  // The next training day after `after` that is free: not past, not
  // unavailable, holding nothing that is still to do.
  function nextFreeDay(view, after, trainingDays) {
    var d = view.days.filter(function (x) {
      return x.date > after && x.date >= view.today && !x.unavailable && (trainingDays || []).indexOf(x.dow) >= 0 &&
        !x.entries.some(function (e) { return e.state !== 'done'; });
    })[0];
    return d ? d.date : null;
  }
  // Workouts done before, newest first, each once: what "Repeat a recent
  // workout" offers.
  function recentWorkouts(pkg, st, limit) {
    var seen = {}, out = [];
    Program.ofType(st, 'workout_completed').slice().reverse().forEach(function (e) {
      if (seen[e.workoutId] || !pkg.workouts[e.workoutId]) return;
      seen[e.workoutId] = true; out.push(e.workoutId);
    });
    return out.slice(0, limit || 5);
  }

  return {
    VERSION: VERSION, DAY_NAMES: DAY_NAMES, DAY_SHORT: DAY_SHORT,
    dateKey: dateKey, parseKey: parseKey, addDays: addDays, dow: dow, weekStartOf: weekStartOf, weekDates: weekDates,
    emptyPlan: emptyPlan, addEvent: addEvent, addEvents: addEvents,
    isMaxTest: isMaxTest, itemLabel: itemLabel, openItems: openItems, itemsAhead: itemsAhead, ready: ready,
    doneByDate: doneByDate, storedWeek: storedWeek, unavailableDates: unavailableDates, propose: propose,
    weekView: weekView, todayView: todayView,
    storeEvents: storeEvents, acceptEvents: acceptEvents, changeEvents: changeEvents, nextFreeDay: nextFreeDay,
    recentWorkouts: recentWorkouts
  };
});
