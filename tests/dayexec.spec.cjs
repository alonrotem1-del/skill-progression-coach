// Skill Progression Coach — the execution gap in the Weekly Plan editor.
// A weekday is never a mutually-exclusive execution mode (strength vs
// climbing vs group vs rest). Every day resolves into ONE Daily Workout Queue
// containing its base session (climbing/group), if any, plus every exercise
// the user has assigned to it — each independently executable, regardless of
// the day's original recommended type.
const { test, expect } = require('@playwright/test');

const Week = require('../week.js');
const Daily = require('../daily.js');

// ── pure-module: the unified queue model ────────────────────────────────────
test.describe('unified daily queue (module)', () => {
  function planWithT2bOnSunday() {
    const plan = Week.seedPlan();
    plan.requirements.t2b.days = [0, 2, 5];
    plan.requirements.t2b.target = 3;
    return plan;
  }

  test('01/02/03 — Toes-to-Bar assigned to Sunday appears in Sunday\'s queue and is executable', () => {
    const plan = planWithT2bOnSunday();
    const res = Week.resolveDay(plan, 0, { loads: {} });
    const daily = Daily.makeDaily(res, {});
    const t2b = Daily.findEx(daily, 't2b');
    expect(t2b).toBeTruthy();
    expect(t2b.runner).toBe('sets');
    expect(t2b.included).toBe(true);
    // and Bouldering coexists as the day's base session, not a dead row
    const base = daily.exercises.find(e => e.kind === 'base');
    expect(base.exId).toBe('bouldering');
    expect(base.runner).toBe('climbing');
    expect(daily.exercises.length).toBe(2); // base + t2b, no duplicate bouldering row
  });

  test('04 — Completing Bouldering does not complete Toes-to-Bar, and vice versa', () => {
    const plan = planWithT2bOnSunday();
    const res = Week.resolveDay(plan, 0, { loads: {} });
    const daily = Daily.makeDaily(res, {});
    Daily.findEx(daily, 'bouldering').state = 'completed';
    expect(Daily.findEx(daily, 't2b').state).toBe('not_started');
    const daily2 = Daily.makeDaily(Week.resolveDay(plan, 0, { loads: {} }), {});
    Daily.findEx(daily2, 't2b').state = 'completed';
    expect(Daily.findEx(daily2, 'bouldering').state).toBe('not_started');
  });

  test('06/07 — Pistol Squat assigned to a Group Workout day coexists with the group log', () => {
    const plan = Week.seedPlan();
    plan.requirements.pistol.days = [3];
    plan.requirements.pistol.target = 2;
    const res = Week.resolveDay(plan, 3, { loads: {} });
    const daily = Daily.makeDaily(res, {});
    const base = daily.exercises.find(e => e.kind === 'base');
    expect(base.baseType).toBe('group');
    const pistol = Daily.findEx(daily, 'pistol');
    expect(pistol.runner).toBe('unilateral');
    expect(pistol.included).toBe(true);
    // pre-existing group-day "flexible" targets remain executable too
    expect(Daily.findEx(daily, 'bulgarian_split').runner).toBe('sets');
  });

  test('08/09 — Pull-Up Ladder assigned to a Rest day is executable with a non-blocking warning', () => {
    const plan = Week.seedPlan();
    plan.requirements.pullup_ladder.days = [5, 6];
    plan.requirements.pullup_ladder.target = 2;
    const res = Week.resolveDay(plan, 6, { loads: {} });
    const daily = Daily.makeDaily(res, {});
    const ladder = Daily.findEx(daily, 'pullup_ladder');
    expect(ladder.runner).toBe('ladder');
    expect(ladder.included).toBe(true);
    expect(daily.exercises.find(e => e.kind === 'base')).toBeFalsy(); // no base action on rest
    expect(daily.restWarning).toMatch(/recommended as a rest day/i);
  });

  test('10 — Continue Daily Workout reaches the base session first, then assigned exercises', () => {
    const plan = planWithT2bOnSunday();
    const res = Week.resolveDay(plan, 0, { loads: {} });
    const daily = Daily.makeDaily(res, {});
    expect(Daily.firstUnfinishedRequired(daily)).toBe('bouldering');
    Daily.findEx(daily, 'bouldering').state = 'completed';
    expect(Daily.nextUnfinished(daily, 'bouldering')).toBe('t2b');
  });

  test('13 — Weekly Progress counts a plan-assigned exercise against the EDITED target', () => {
    const plan = planWithT2bOnSunday();
    const res = Week.resolveDay(plan, 0, { loads: {} });
    const daily = Daily.makeDaily(res, { dateKey: '2026-01-01' });
    Daily.findEx(daily, 't2b').state = 'completed';
    Daily.findEx(daily, 't2b').result = { type: 't2b', name: 'Toes-to-Bar', actualReps: 20, actualText: '20 total reps' };
    const exs = daily.exercises.filter(e => e.state === 'completed').map(e => { const r = e.result || {}; r.exId = e.exId; r.name = e.name; r.state = 'completed'; return r; });
    const session = { id: daily.id, kind: 'daily', date: new Date().toISOString(), weekday: daily.weekday, dayKey: daily.dayKey, session: daily.session, status: 'completed', exercises: exs, adaptations: daily.adaptations };
    const sum = Daily.weeklySummary([session], plan, Date.now());
    const t2bLine = sum.lines.find(l => l.key === 't2b');
    expect(t2bLine.done).toBe(1);
    expect(t2bLine.target).toBe(3); // the edited weekly target, not the recommended 2
  });

  test('14 — an exercise completed off its recommended day contributes extra accumulated load', () => {
    const plan = planWithT2bOnSunday();
    const now = Date.now();
    const ws = Daily.weekStart(now);
    const inWeek = k => new Date(ws + k * 864e5 + 12 * 3600e3).toISOString();
    const onSunday = { id: 'a', kind: 'daily', status: 'completed', date: inWeek(0), weekday: 0, session: 'Climbing',
      exercises: [{ exId: 't2b', type: 't2b', name: 'Toes-to-Bar', actualReps: 20, state: 'completed' }] };
    const onFriday = { id: 'b', kind: 'daily', status: 'completed', date: inWeek(5), weekday: 5, session: 'Home Pull Session',
      exercises: [{ exId: 't2b', type: 't2b', name: 'Toes-to-Bar', actualReps: 20, state: 'completed' }] };
    expect(Daily.planExtraLoad([onSunday], plan, now).grip).toBeGreaterThan(0);  // off-recommendation day → extra
    expect(Daily.planExtraLoad([onFriday], plan, now).grip).toBe(0);              // on-recommendation day → not extra
  });
});

// ── E2E ─────────────────────────────────────────────────────────────────────
async function seed(page, dayId) {
  await page.addInitScript((d) => { window.__spcTodayId = d; }, dayId);
  await page.goto('index.html');
  await page.evaluate(() => {
    const S = window.CoachStore.makeStore(), D = window.CoachData, E = window.CoachEngine;
    const bench = { pullup_max: 9, dips_max: 6 }; const state = {};
    D.worlds.forEach(w => { const nodes = window.CoachStore.seedStates(w, bench); const f = E.autoFocus(w, nodes); state[w.id] = { nodes, focus: { primary: f.primary, supporting: f.supporting, manual: false } }; });
    S.setBench(bench); S.setState(state);
    S.setProfile({ onboarded: true, activeWorld: 'muscleup', days: [0, 2, 4], duration: 'normal' });
    ['spc_c_day', 'spc_c_sessions', 'spc_c_workout', 'spc_c_adhoc', 'spc_c_plan', 'spc_c_templates'].forEach(k => localStorage.removeItem(k));
  });
  await page.reload();
}
async function assignT2bToSunday(page) {
  await page.evaluate(() => {
    const S = window.CoachStore.makeStore(); const p = S.getPlan();
    p.requirements.t2b.days = [0, 2, 5]; p.requirements.t2b.target = 3; S.setPlan(p);
  });
  await page.reload();
}
async function assignPistolToWednesday(page) {
  await page.evaluate(() => {
    const S = window.CoachStore.makeStore(); const p = S.getPlan();
    p.requirements.pistol.days = [3]; p.requirements.pistol.target = 2; S.setPlan(p);
  });
  await page.reload();
}
async function assignLadderToSaturday(page) {
  await page.evaluate(() => {
    const S = window.CoachStore.makeStore(); const p = S.getPlan();
    p.requirements.pullup_ladder.days = [5, 6]; p.requirements.pullup_ladder.target = 2; S.setPlan(p);
  });
  await page.reload();
}
async function runToFinishPanel(page) {
  for (let i = 0; i < 120; i++) {
    if (await page.locator('[data-finish],[data-finishex]').count()) return;
    if (await page.locator('[data-diff="appropriate"]').count()) { await page.locator('[data-diff="appropriate"]').first().click(); continue; }
    if (await page.locator('[data-pyrdiff="appropriate"]').count()) { await page.locator('[data-pyrdiff="appropriate"]').first().click(); continue; }
    if (await page.locator('[data-tskip]').count()) { await page.locator('[data-tskip]').first().click(); continue; }
    if (await page.locator('.cur-card [data-done]').count()) { await page.locator('.cur-card [data-done]').first().click(); continue; }
    await page.waitForTimeout(40);
  }
  throw new Error('runner never reached a finish panel');
}

test.describe('Sunday (climbing) queue', () => {
  test('02 — Toes-to-Bar assigned to Sunday is executable via Start This Exercise', async ({ page }) => {
    await seed(page, 0); await assignT2bToSunday(page);
    await page.locator('.q-ex', { hasText: 'Toes-to-Bar' }).locator('[data-exstart]').click();
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Toes-to-Bar');
  });
  test('03 — Bouldering and Toes-to-Bar coexist in the same Sunday queue', async ({ page }) => {
    await seed(page, 0); await assignT2bToSunday(page);
    await expect(page.locator('.q-ex.q-base')).toContainText('Climbing');
    await expect(page.locator('.q-ex', { hasText: 'Toes-to-Bar' })).toBeVisible();
    expect(await page.locator('.queue .q-ex').count()).toBe(2);
  });
  test('04 — completing Toes-to-Bar does not complete Bouldering', async ({ page }) => {
    await seed(page, 0); await assignT2bToSunday(page);
    await page.locator('.q-ex', { hasText: 'Toes-to-Bar' }).locator('[data-exstart]').click();
    await runToFinishPanel(page);
    await page.locator('[data-finish],[data-finishex]').first().click();
    await page.locator('[data-finishnow]').click();
    await expect(page.locator('.q-ex', { hasText: 'Toes-to-Bar' })).toContainText('Completed');
    await expect(page.locator('.q-ex.q-base')).not.toContainText('Completed');
  });
  test('05 — completing Bouldering does not complete Toes-to-Bar, and marks the base item done', async ({ page }) => {
    await seed(page, 0); await assignT2bToSunday(page);
    await page.locator('[data-startday]').first().click(); // base session comes first
    await expect(page.locator('.climb-grid')).toBeVisible();
    await page.locator('[data-grades] .pill', { hasText: 'V1' }).click();
    await page.locator('[data-styles] .pill').first().click();
    await page.locator('[data-results] .pill', { hasText: 'Send' }).click();
    await page.locator('[data-add]').click();
    await page.locator('[data-finish]').click();
    await page.goto('index.html');
    await expect(page.locator('.q-ex.q-base')).toContainText('Completed');
    await expect(page.locator('.q-ex', { hasText: 'Toes-to-Bar' })).not.toContainText('Completed');
  });
  test('10 — Continue Daily Workout reaches Toes-to-Bar after the climbing base session', async ({ page }) => {
    await seed(page, 0); await assignT2bToSunday(page);
    await page.locator('[data-startday]').first().click();
    await expect(page.locator('.climb-grid')).toBeVisible();
    await page.locator('[data-grades] .pill', { hasText: 'V1' }).click();
    await page.locator('[data-styles] .pill').first().click();
    await page.locator('[data-results] .pill', { hasText: 'Send' }).click();
    await page.locator('[data-add]').click();
    await page.locator('[data-finish]').click();
    await page.goto('index.html');
    await page.locator('[data-startday]').first().click(); // now reaches Toes-to-Bar
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Toes-to-Bar');
  });
  test('16 — the ad-hoc "Start This Exercise" library still works alongside the plan-assigned queue', async ({ page }) => {
    await seed(page, 0); await assignT2bToSunday(page);
    await page.locator('[data-startone]').click();
    await expect(page.getByText('Start One Exercise')).toBeVisible();
  });
});

test.describe('Wednesday (group) queue', () => {
  test('06 — Pistol Squat assigned to a Group Workout day is executable', async ({ page }) => {
    await seed(page, 3); await assignPistolToWednesday(page);
    await page.locator('.q-ex', { hasText: 'Pistol Squat' }).locator('[data-exstart]').click();
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Pistol Squat');
  });
  test('07 — Group Workout Log and assigned exercises coexist in one queue, performed in any order', async ({ page }) => {
    await seed(page, 3); await assignPistolToWednesday(page);
    await expect(page.locator('.q-ex.q-base')).toContainText('Group Workout Log');
    await expect(page.locator('.q-ex', { hasText: 'Pistol Squat' })).toBeVisible();
    // start Pistol first, out of order, without touching the group log
    await page.locator('.q-ex', { hasText: 'Pistol Squat' }).locator('[data-exstart]').click();
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Pistol Squat');
  });
  test('log the group workout without completing Pistol Squat', async ({ page }) => {
    await seed(page, 3); await assignPistolToWednesday(page);
    await page.locator('.q-ex.q-base').locator('[data-exstart]').click();
    await page.locator('[data-gmove="pullups"]').click();
    await page.locator('[data-savegroup]').click();
    await expect(page.locator('.q-ex.q-base')).toContainText('Completed');
    await expect(page.locator('.q-ex', { hasText: 'Pistol Squat' })).not.toContainText('Completed');
  });
});

test.describe('Saturday (rest) queue', () => {
  test('08 — Pull-Up Ladder assigned to a Rest day is executable', async ({ page }) => {
    await seed(page, 6); await assignLadderToSaturday(page);
    await page.locator('.q-ex', { hasText: 'Pull-Up Ladder' }).locator('[data-exstart]').click();
    await expect(page.locator('.cur-card')).toBeVisible();
  });
  test('09 — the rest-day warning is visible but non-blocking', async ({ page }) => {
    await seed(page, 6); await assignLadderToSaturday(page);
    await expect(page.locator('.caution')).toContainText(/recommended as a rest day/i);
    await expect(page.locator('[data-startday]')).toBeVisible();
    await page.locator('[data-startday]').first().click();
    await expect(page.locator('.cur-card')).toBeVisible(); // never blocked
  });
});

test.describe('every day type', () => {
  test('11 — Start This Exercise works on every day type (Monday, strength)', async ({ page }) => {
    await seed(page, 1);
    await page.locator('.q-ex').first().locator('[data-exstart]').click();
    await expect(page.locator('.wk-block-wrap, .cur-card').first()).toBeVisible();
  });
  test('12 — an assigned exercise is saved correctly in History once the day is finished', async ({ page }) => {
    await seed(page, 0); await assignT2bToSunday(page);
    await page.locator('.q-ex', { hasText: 'Toes-to-Bar' }).locator('[data-exstart]').click();
    await runToFinishPanel(page);
    await page.locator('[data-finish],[data-finishex]').first().click();
    await expect(page.locator('[data-finishnow]')).toBeVisible(); // Bouldering not done yet → "Finish for Now"
    // The exercise's own completion is tracked in the daily queue immediately…
    const dailyHasT2b = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('spc_c_day')); return d.exercises.some(e => e.exId === 't2b' && e.state === 'completed'); });
    expect(dailyHasT2b).toBe(true);
    await page.locator('[data-finishnow]').click();
    // …and lands in History once the whole day is explicitly finished & saved.
    await page.locator('.q-ex.q-base').locator('[data-exstart]').click();
    await expect(page.locator('.climb-grid')).toBeVisible();
    await page.locator('[data-grades] .pill', { hasText: 'V1' }).click();
    await page.locator('[data-styles] .pill').first().click();
    await page.locator('[data-results] .pill', { hasText: 'Send' }).click();
    await page.locator('[data-add]').click();
    await page.locator('[data-finish]').click();
    await page.goto('index.html');
    await page.locator('[data-startday]').first().click(); // all required done → daily summary
    await expect(page.getByText('All Required Done')).toBeVisible();
    await page.locator('[data-finishday]').click();
    const found = await page.evaluate(() => window.CoachStore.makeStore().getSessions().some(s => (s.exercises || []).some(e => e.exId === 't2b')));
    expect(found).toBe(true);
  });
  test('15a — existing Friday (strength) daily workout still works unmodified', async ({ page }) => {
    await seed(page, 5);
    await expect(page.locator('.q-ex', { hasText: 'Pistol Squat' })).toBeVisible();
    await page.locator('[data-startday]').first().click();
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Pistol Squat');
  });
  test('15b — a plain climbing day with no extra assignment still starts climbing directly', async ({ page }) => {
    await seed(page, 0);
    await page.locator('[data-startday]').first().click();
    await expect(page.locator('.climb-grid')).toBeVisible();
  });
  test('15c — a plain group day with no extra assignment still logs via the group form', async ({ page }) => {
    await seed(page, 3);
    await page.locator('[data-groupday]').click();
    await expect(page.locator('[data-savegroup]')).toBeVisible();
  });
});
