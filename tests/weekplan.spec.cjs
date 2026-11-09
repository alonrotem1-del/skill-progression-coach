// The athlete's week plan (weekplan.js): which program item is on which day.
// Pure Node tests over the real program package (private/, git-ignored course
// content); they skip without it. The invariants under test:
//   - the calendar week runs Sunday to Saturday, and the program supplies the
//     content in program order;
//   - an unaccepted week is a proposal, computed and never stored; an accepted
//     one never moves without an event the athlete caused;
//   - a date passing moves nothing, and never moves the program position;
//   - the week plan never writes to, or depends for its truth on, anything but
//     its own events — the training record stays where it was.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const P = require('../program.js');
const W = require('../weekplan.js');

const PKG_FILE = path.join(__dirname, '..', 'private', 'beginner-program.json');
const HAVE = fs.existsSync(PKG_FILE);
const pkg = HAVE ? JSON.parse(fs.readFileSync(PKG_FILE, 'utf8')) : null;
test.skip(!HAVE, 'program package not built on this machine');

// 8 Nov 2026 is a Sunday.
const SUN = '2026-11-08', MON = '2026-11-09', TUE = '2026-11-10', WED = '2026-11-11', THU = '2026-11-12', FRI = '2026-11-13', SAT = '2026-11-14';
const DAYS4 = [0, 2, 4, 6];                                  // Sun, Tue, Thu, Sat
function migrated() { let s = P.emptyState(); P.migrationEvents().forEach((e) => { s = P.addEvent(s, e); }); return s; }
function done(s, id, when) { return P.addEvent(s, { type: 'workout_completed', workoutId: id, source: 'app', result: [], finishedAt: when }); }
const at = (day, hh) => new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8), hh || 18).toISOString();
const opts = (today, extra) => Object.assign({ today, trainingDays: DAYS4, includeOptional: false }, extra || {});
const placed = (view) => view.placements.map((p) => p.date + ' ' + p.item);
const entry = (view, day) => view.days.find((d) => d.date === day).entries;

test.describe('week plan — dates', () => {
  test('01 the week starts on Sunday, in local calendar days', () => {
    expect(W.weekStartOf(SAT)).toBe(SUN);
    expect(W.weekStartOf(SUN)).toBe(SUN);
    expect(W.weekStartOf('2026-11-15')).toBe('2026-11-15');
    expect(W.weekDates(SUN)).toEqual([SUN, MON, TUE, WED, THU, FRI, SAT]);
    expect(W.addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(W.DAY_NAMES[W.dow(THU)]).toBe('Thursday');
  });
});

test.describe('week plan — the proposal', () => {
  test('02 the open required workouts go on the training days in program order; Legs waits under Not placed', () => {
    const v = W.weekView(pkg, migrated(), W.emptyPlan(), opts(SUN));
    expect(v.stored).toBe(false);
    expect(v.accepted).toBe(false);
    expect(placed(v)).toEqual([SUN + ' P4W4-1', TUE + ' P4W4-2', THU + ' P4W4-3', SAT + ' P4W4-4']);
    expect(v.tray).toEqual(['P4W4-L']);                       // D4: optional stays unplaced
    expect(v.position).toMatchObject({ id: 'P4W4', type: 'week', phase: 4, week: 4, done: 0, total: 4 });
    expect(v.next.map((n) => n.id)).toEqual(['MT4', 'P5D']);
  });

  test('03 with fewer training days, what does not fit is Not placed, never dropped; optional sessions only when asked for', () => {
    const v = W.weekView(pkg, migrated(), W.emptyPlan(), opts(SUN, { trainingDays: [0, 2, 4] }));
    expect(placed(v)).toEqual([SUN + ' P4W4-1', TUE + ' P4W4-2', THU + ' P4W4-3']);
    expect(v.tray).toEqual(['P4W4-4', 'P4W4-L']);
    const all = W.weekView(pkg, migrated(), W.emptyPlan(), opts(SUN, { trainingDays: [0, 1, 2, 3, 4, 5], includeOptional: true }));
    expect(placed(all)).toEqual([SUN + ' P4W4-1', MON + ' P4W4-2', TUE + ' P4W4-3', WED + ' P4W4-4', THU + ' P4W4-L', FRI + ' MT4']);
    expect(all.tray).toEqual([]);
  });

  test('04 the Max Test follows the week in the same calendar week; a recovery week or the next week is never pulled in', () => {
    let s = migrated();
    s = done(s, 'P4W4-1', at('2026-11-02')); s = done(s, 'P4W4-2', at('2026-11-03'));
    const v = W.weekView(pkg, s, W.emptyPlan(), opts(SUN));
    expect(placed(v)).toEqual([SUN + ' P4W4-3', TUE + ' P4W4-4', THU + ' MT4']);   // Sat stays empty: P5D is a whole week
    expect(entry(v, THU)[0]).toMatchObject({ item: 'MT4', maxtest: true, ready: false });  // not reached yet
  });

  test('05 a proposal starts today: past days are not filled, and a day with work done on it is not given more', () => {
    let s = migrated();
    s = done(s, 'P4W4-1', at(TUE, 9));
    const v = W.weekView(pkg, s, W.emptyPlan(), opts(TUE));
    expect(placed(v)).toEqual([THU + ' P4W4-2', SAT + ' P4W4-3']);
    expect(entry(v, TUE)).toEqual([expect.objectContaining({ item: 'P4W4-1', kind: 'extra', state: 'done' })]);
    expect(v.tray).toEqual(['P4W4-4', 'P4W4-L']);
  });

  test('06 a recovery week is the whole week: no day placements, nothing Not placed', () => {
    let s = migrated();
    ['P4W4-1', 'P4W4-2', 'P4W4-3', 'P4W4-4'].forEach((id) => { s = done(s, id, at('2026-11-02')); });
    s = P.addEvent(s, { type: 'maxtest_recorded', nodeId: 'MT4', date: at('2026-11-05'), results: [] });
    const v = W.weekView(pkg, s, W.emptyPlan(), opts(MON));
    expect(v.recovery).toBe(true);
    expect(v.placements).toEqual([]);
    expect(v.tray).toEqual([]);
    expect(W.todayView(pkg, s, W.emptyPlan(), opts(MON)).kind).toBe('recovery');
  });
});

test.describe('week plan — acceptance and the athlete\'s changes', () => {
  test('07 accepting stores exactly the proposal shown, and the week then holds still when the program, the days or the settings change', () => {
    const s = migrated();
    let plan = W.emptyPlan();
    const v0 = W.weekView(pkg, s, plan, opts(SUN));
    plan = W.addEvents(plan, W.acceptEvents(v0));
    expect(plan.events.map((e) => e.type)).toEqual(['week_proposed', 'week_accepted']);
    expect(plan.events[0]).toMatchObject({ weekStart: SUN, placements: v0.placements.map((p) => ({ date: p.date, item: p.item })) });
    // different training days, optional sessions on: an accepted week does not move
    const v1 = W.weekView(pkg, s, plan, opts(SUN, { trainingDays: [1, 3, 5], includeOptional: true }));
    expect(v1.accepted).toBe(true);
    expect(placed(v1)).toEqual(placed(v0));
    // accepting twice adds nothing
    expect(W.acceptEvents(v1)).toEqual([]);
  });

  test('08 a day that passes undone stays where it was, marked not done; Today offers it, and nothing moves by itself', () => {
    const s = migrated();
    let plan = W.addEvents(W.emptyPlan(), W.acceptEvents(W.weekView(pkg, s, W.emptyPlan(), opts(SUN))));
    const wed = W.weekView(pkg, s, plan, opts(WED));
    expect(entry(wed, SUN)[0]).toMatchObject({ item: 'P4W4-1', state: 'missed' });
    expect(entry(wed, TUE)[0]).toMatchObject({ item: 'P4W4-2', state: 'missed' });
    expect(placed(wed)).toEqual([SUN + ' P4W4-1', TUE + ' P4W4-2', THU + ' P4W4-3', SAT + ' P4W4-4']);
    const t = W.todayView(pkg, s, plan, opts(WED));
    expect(t.kind).toBe('open');
    expect(t.missed).toMatchObject({ item: 'P4W4-1', date: SUN });
    expect(t.next).toMatchObject({ item: 'P4W4-3', date: THU });
  });

  test('09 the program position never moves because days pass', () => {
    const s = migrated();
    const before = W.weekView(pkg, s, W.emptyPlan(), opts(SUN)).position;
    const later = W.weekView(pkg, s, W.emptyPlan(), opts('2026-12-24')).position;
    expect(later).toEqual(before);
    expect(P.pathView(pkg, s).current.id).toBe('P4W4');
    // and a new week proposes the same open work again
    expect(W.weekView(pkg, s, W.emptyPlan(), opts('2026-12-20')).placements.map((p) => p.item)).toEqual(['P4W4-1', 'P4W4-2', 'P4W4-3', 'P4W4-4']);
  });

  test('10 a move is one explicit event; the row says where it came from; a swap trades days', () => {
    const s = migrated();
    let plan = W.addEvents(W.emptyPlan(), W.acceptEvents(W.weekView(pkg, s, W.emptyPlan(), opts(SUN))));
    let v = W.weekView(pkg, s, plan, opts(SUN));
    const mv = W.changeEvents(v, [{ item: 'P4W4-3', from: THU, to: FRI }]);
    expect(mv).toEqual([{ type: 'placement_changed', weekStart: SUN, item: 'P4W4-3', from: THU, to: FRI, reason: 'athlete' }]);
    plan = W.addEvents(plan, mv);
    v = W.weekView(pkg, s, plan, opts(SUN));
    expect(entry(v, THU)).toEqual([]);
    expect(entry(v, FRI)[0]).toMatchObject({ item: 'P4W4-3', movedFrom: THU, state: 'planned' });
    plan = W.addEvents(plan, W.changeEvents(v, [{ item: 'P4W4-2', from: TUE, to: SAT }, { item: 'P4W4-4', from: SAT, to: TUE }]));
    v = W.weekView(pkg, s, plan, opts(SUN));
    expect(entry(v, TUE)[0]).toMatchObject({ item: 'P4W4-4', movedFrom: SAT });
    expect(entry(v, SAT)[0]).toMatchObject({ item: 'P4W4-2', movedFrom: TUE });
    expect(v.accepted).toBe(true);
  });

  test('11 a change to a proposal stores the proposal first, exactly as shown, and leaves it a proposal', () => {
    const s = migrated();
    const v = W.weekView(pkg, s, W.emptyPlan(), opts(MON));
    const evs = W.changeEvents(v, [{ item: 'P4W4-3', from: SAT, to: MON }]);
    expect(evs.map((e) => e.type)).toEqual(['week_proposed', 'placement_changed']);
    const plan = W.addEvents(W.emptyPlan(), evs);
    const after = W.weekView(pkg, s, plan, opts(MON));
    expect(after.stored).toBe(true);
    expect(after.accepted).toBe(false);
    expect(entry(after, MON)[0]).toMatchObject({ item: 'P4W4-3', state: 'today', movedFrom: SAT });
    expect(W.todayView(pkg, s, plan, opts(MON))).toMatchObject({ kind: 'session', entry: expect.objectContaining({ item: 'P4W4-3' }) });
  });

  test('12 remove, replace and place go through Not placed; an unavailable day keeps its date and frees its session', () => {
    const s = migrated();
    let plan = W.addEvents(W.emptyPlan(), W.acceptEvents(W.weekView(pkg, s, W.emptyPlan(), opts(SUN))));
    let v = W.weekView(pkg, s, plan, opts(SUN));
    plan = W.addEvents(plan, W.changeEvents(v, [{ item: 'P4W4-2', from: TUE, to: null }]));                 // remove
    v = W.weekView(pkg, s, plan, opts(SUN));
    expect(v.tray).toEqual(['P4W4-2', 'P4W4-L']);
    plan = W.addEvents(plan, W.changeEvents(v, [{ item: 'P4W4-3', from: THU, to: null }, { item: 'P4W4-L', from: null, to: THU }]));  // replace with Legs
    v = W.weekView(pkg, s, plan, opts(SUN));
    expect(entry(v, THU)[0].item).toBe('P4W4-L');
    expect(v.tray).toEqual(['P4W4-2', 'P4W4-3']);
    plan = W.addEvents(plan, [{ type: 'day_unavailable', date: SAT }].concat(W.changeEvents(v, [{ item: 'P4W4-4', from: SAT, to: null }])));
    v = W.weekView(pkg, s, plan, opts(SUN));
    expect(v.days.find((d) => d.date === SAT)).toMatchObject({ unavailable: true, entries: [] });
    expect(W.nextFreeDay(v, SAT, DAYS4)).toBe(null);        // no training day after Saturday this week
    expect(W.nextFreeDay(v, SUN, DAYS4)).toBe(TUE);         // Tuesday is free again
    plan = W.addEvents(plan, [{ type: 'day_available', date: SAT }]);
    expect(W.weekView(pkg, s, plan, opts(SUN)).days.find((d) => d.date === SAT).unavailable).toBe(false);
  });
});

test.describe('week plan — what was done', () => {
  test('13 a workout done on another day fulfils its placement there; a repeat is its own row; undated records belong to no day', () => {
    let s = migrated();                                        // the P4W3 marks are reported, without a date
    let plan = W.addEvents(W.emptyPlan(), W.acceptEvents(W.weekView(pkg, s, W.emptyPlan(), opts(SUN))));
    s = done(s, 'P4W4-2', at(MON));                           // Tuesday's workout, done on Monday
    s = done(s, 'P4W3-1', at(MON, 20));                       // a repeat of last week's
    const v = W.weekView(pkg, s, plan, opts(WED));
    expect(entry(v, TUE)[0]).toMatchObject({ item: 'P4W4-2', state: 'done', doneOn: MON });
    expect(entry(v, MON)).toEqual([expect.objectContaining({ item: 'P4W3-1', kind: 'extra', state: 'done' })]);
    expect(v.days.flatMap((d) => d.entries).filter((e) => e.item === 'P4W4-2')).toHaveLength(1);   // never twice
    const imported = P.addEvent(s, { type: 'workout_completed', workoutId: 'P4W4-4', source: 'imported', finishedAt: null, dateUnknown: true, result: [] });
    expect(W.weekView(pkg, imported, plan, opts(WED)).days.flatMap((d) => d.entries).filter((e) => e.kind === 'extra')).toHaveLength(1);
  });

  test('14 Today: today\'s session; then done with what comes next; an open day; a Max Test the program has not reached says what comes first', () => {
    let s = migrated();
    let plan = W.addEvents(W.emptyPlan(), W.acceptEvents(W.weekView(pkg, s, W.emptyPlan(), opts(SUN))));
    expect(W.todayView(pkg, s, plan, opts(SUN))).toMatchObject({ kind: 'session', entry: expect.objectContaining({ item: 'P4W4-1', ready: true }) });
    s = done(s, 'P4W4-1', at(SUN));
    const t = W.todayView(pkg, s, plan, opts(SUN));
    expect(t.kind).toBe('done');
    expect(t.doneToday.map((e) => e.item)).toEqual(['P4W4-1']);
    expect(t.next).toMatchObject({ item: 'P4W4-2', date: TUE });
    expect(W.todayView(pkg, s, plan, opts(MON))).toMatchObject({ kind: 'open', missed: null });
    // the Max Test planned on Thursday while Tuesday's Push is still open
    let s2 = migrated();
    s2 = done(s2, 'P4W4-1', at('2026-11-02')); s2 = done(s2, 'P4W4-2', at('2026-11-02'));
    const plan2 = W.addEvents(W.emptyPlan(), W.acceptEvents(W.weekView(pkg, s2, W.emptyPlan(), opts(SUN))));
    const thu = W.todayView(pkg, s2, plan2, opts(THU));
    expect(thu.kind).toBe('maxtest');
    expect(thu.entry.ready).toBe(false);
    expect(thu.blockedBy).toEqual({ item: 'P4W4-3', date: SUN });
  });

  test('15 when the planned work is done early, the rest of the week can be planned with what comes next — as a suggestion', () => {
    let s = migrated();
    let plan = W.addEvents(W.emptyPlan(), W.acceptEvents(W.weekView(pkg, s, W.emptyPlan(), opts(SUN))));   // Sun, Tue, Thu, Sat
    let v = W.weekView(pkg, s, plan, opts(WED));
    plan = W.addEvents(plan, W.changeEvents(v, [{ item: 'P4W4-3', from: THU, to: WED }]));     // trained on Wednesday instead
    v = W.weekView(pkg, s, plan, opts(THU));
    plan = W.addEvents(plan, W.changeEvents(v, [{ item: 'P4W4-4', from: SAT, to: THU }]));     // and Saturday's on Thursday
    [['P4W4-1', SUN], ['P4W4-2', TUE], ['P4W4-3', WED], ['P4W4-4', THU]].forEach(([id, d]) => { s = done(s, id, at(d)); });
    v = W.weekView(pkg, s, plan, opts(THU));
    expect(v.suggestion).toEqual({ placements: [{ date: SAT, item: 'MT4' }], finished: 'Week 4' });
    expect(entry(v, SAT)).toEqual([]);                                                         // nothing added by itself
    plan = W.addEvents(plan, W.changeEvents(v, v.suggestion.placements.map((p) => ({ item: p.item, from: null, to: p.date, reason: 'suggestion' }))));
    const after = W.weekView(pkg, s, plan, opts(THU));
    expect(entry(after, SAT)[0]).toMatchObject({ item: 'MT4', ready: true, state: 'planned' });
    expect(after.suggestion).toBe(null);
    expect(plan.events.filter((e) => e.type === 'placement_changed').pop().reason).toBe('suggestion');
    // Friday is no training day, and Thursday already has its work: the Max Test waits for Saturday
    expect(W.todayView(pkg, s, plan, opts(FRI))).toMatchObject({ kind: 'open', weekDone: true, next: expect.objectContaining({ item: 'MT4', date: SAT }) });
  });

  test('16 the week plan never touches the training record', () => {
    const s = migrated(), frozen = JSON.stringify(s);
    let plan = W.addEvents(W.emptyPlan(), W.acceptEvents(W.weekView(pkg, s, W.emptyPlan(), opts(SUN))));
    const v = W.weekView(pkg, s, plan, opts(SUN));
    plan = W.addEvents(plan, W.changeEvents(v, [{ item: 'P4W4-1', from: SUN, to: MON }]));
    W.todayView(pkg, s, plan, opts(MON));
    expect(JSON.stringify(s)).toBe(frozen);
    expect(plan.events.every((e) => ['week_proposed', 'week_accepted', 'placement_changed', 'day_unavailable', 'day_available'].includes(e.type))).toBe(true);
    expect(W.recentWorkouts(pkg, s, 3)).toEqual(['P4W3-4', 'P4W3-3', 'P4W3-2']);
  });
});
