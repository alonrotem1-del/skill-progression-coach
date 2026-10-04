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
    // Climbing is no longer a domain this product coaches, so Sunday offers no
    // climbing base session — just the work the athlete assigned to the day.
    // The base-session mechanism itself is still covered by the group-workout
    // day, which uses exactly the same path (06/07 and 15c below).
    expect(daily.exercises.find(e => e.kind === 'base')).toBeUndefined();
    expect(daily.exercises.length).toBe(1);
  });

  test('04 — climbing is absent from the queue, while the plan still records it', () => {
    const plan = planWithT2bOnSunday();
    const daily = Daily.makeDaily(Week.resolveDay(plan, 0, { loads: {} }), {});
    expect(Daily.findEx(daily, 'bouldering')).toBeFalsy();
    // Nothing was deleted: the assignment is still in the plan, so climbing can
    // return as a recovery input without recovering any data.
    expect(Week.climbsOn(plan, 0)).toBe(true);
    expect(Week.climbsVisibly(plan, 0)).toBe(false);
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

  test('10 — Continue Daily Workout reaches the first assigned exercise', () => {
    const plan = planWithT2bOnSunday();
    const res = Week.resolveDay(plan, 0, { loads: {} });
    const daily = Daily.makeDaily(res, {});
    // With no base session on the day, the first assigned exercise leads.
    expect(Daily.firstUnfinishedRequired(daily)).toBe('t2b');
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
// On a day holding ONE exercise the card's primary button starts that exercise
// by name, and the queue row no longer repeats a start button of its own — two
// buttons for the single thing on the screen was the duplication the Today
// cleanup removed. The row still carries Skip and its prescription.
async function startTheOnlyExercise(page, name) {
  const primary = page.locator('.rec.sched > [data-exstart]');
  await expect(primary).toHaveText(new RegExp('Start ' + name));
  expect(await page.locator('.queue [data-exstart]').count()).toBe(0);
  await primary.click();
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
  test('02 — Toes-to-Bar assigned to Sunday is executable from the card\'s primary action', async ({ page }) => {
    await seed(page, 0); await assignT2bToSunday(page);
    // It is the day's only exercise, so the primary action names it.
    await startTheOnlyExercise(page, 'Toes-to-Bar');
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Toes-to-Bar');
  });
  test('03 — Sunday shows only the work the athlete assigned, with no climbing row', async ({ page }) => {
    await seed(page, 0); await assignT2bToSunday(page);
    await expect(page.locator('.q-ex', { hasText: 'Toes-to-Bar' })).toBeVisible();
    expect(await page.locator('.q-ex.q-base').count()).toBe(0);
    expect(await page.locator('.queue .q-ex').count()).toBe(1);
  });
  test('04 — completing the assigned exercise completes the day\'s only item', async ({ page }) => {
    await seed(page, 0); await assignT2bToSunday(page);
    await startTheOnlyExercise(page, 'Toes-to-Bar');
    await runToFinishPanel(page);
    await page.locator('[data-finish],[data-finishex]').first().click();
    const done = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('spc_c_day'));
      return d.exercises.some((e) => e.exId === 't2b' && e.state === 'completed');
    });
    expect(done).toBe(true);
  });
  test('05/10 — a day whose only plan entry was climbing offers nothing to run', async ({ page }) => {
    // Sunday's single assignment in the seeded plan is climbing, which this
    // product does not coach. The honest result is an open day, not a climbing
    // session the athlete never asked for.
    await seed(page, 0);
    expect(await page.locator('.q-ex.q-base').count()).toBe(0);
    const text = await page.locator('#app').innerText();
    expect(text).not.toContain('Climbing');
    expect(text).toContain('Open day');
  });

  test('12 — an assigned exercise is saved correctly in History once the day is finished', async ({ page }) => {
    await seed(page, 0); await assignT2bToSunday(page);
    await startTheOnlyExercise(page, 'Toes-to-Bar');
    await runToFinishPanel(page);
    await page.locator('[data-finish],[data-finishex]').first().click();
    // The exercise's own completion is tracked in the daily queue immediately…
    const dailyHasT2b = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('spc_c_day')); return d.exercises.some(e => e.exId === 't2b' && e.state === 'completed'); });
    expect(dailyHasT2b).toBe(true);
    // …and lands in History once the whole day is explicitly finished & saved.
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
  test('15b — the climbing logger is archived: no athlete route, code intact', async ({ page }) => {
    await seed(page, 0);
    // No way in from the product: no climbing row, and an open day offers no
    // "start the day" button at all because there is nothing in it to start.
    expect(await page.locator('.q-ex.q-base').count()).toBe(0);
    expect(await page.locator('[data-startday]').count()).toBe(0);
    expect(await page.locator('.climb-grid').count()).toBe(0);
    // …and the logger still works when driven directly, so nothing was lost.
    await page.evaluate(() => window.CoachApp._startClimbing());
    await expect(page.locator('.climb-grid')).toBeVisible();
    const id = await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_workout')).data.workoutId);
    expect(id.indexOf('c_')).toBe(0);
  });
  test('15c — a plain group day with no extra assignment still logs via the group form', async ({ page }) => {
    await seed(page, 3);
    await page.locator('[data-groupday]').click();
    await expect(page.locator('[data-savegroup]')).toBeVisible();
  });
});
