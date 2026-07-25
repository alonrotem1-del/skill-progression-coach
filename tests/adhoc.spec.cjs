// Skill Progression Coach — Round 5: ad-hoc workout flow.
// Start Any Workout / Start One Exercise / custom builder / classification
// (Extra / Apply-to-plan / Test), extra-load feeding the Weekly Coach, saved
// templates, resume, and history classification. Reuses the same daily runner.
const { test, expect } = require('@playwright/test');

const Week = require('../week.js');
const Daily = require('../daily.js');

// ── pure-module: load + classification (Parts 5, 9, 13) ─────────────────────
test.describe('ad-hoc load + classification (module)', () => {
  test('12 — an extra pull workout raises the Weekly Coach load (Friday ladder reduced)', () => {
    const plan = Week.seedPlan();
    const base = Week.resolveDay(plan, 5, { loads: {} });
    const withExtra = Week.resolveDay(plan, 5, { extraPullScore: 3 });
    expect(base.adapted).toBe(false);
    expect(withExtra.adapted).toBe(true);
    expect(withExtra.ladderRounds).toBe(4);
  });

  test('13a — extraLoad counts extra sessions but never test/excluded ones', () => {
    const now = Date.now();
    const extra = [{ id: 'e', kind: 'daily', classification: 'extra', status: 'completed', date: new Date().toISOString(),
      exercises: [{ exId: 'pullup_pyramid', type: 'pyramid', state: 'completed' }] }];
    expect(Daily.extraLoad(extra, now).pull).toBe(3);
    const testOnly = [{ id: 't', kind: 'daily', classification: 'test', excluded: true, status: 'completed', date: new Date().toISOString(),
      exercises: [{ exId: 'pullup_pyramid', type: 'pyramid', state: 'completed' }] }];
    expect(Daily.extraLoad(testOnly, now).pull).toBe(0);
  });

  test('13b — a test session is excluded from the weekly summary', () => {
    const now = Date.now();
    const s = [{ id: 't', kind: 'daily', classification: 'test', excluded: true, status: 'completed', date: new Date().toISOString(),
      exercises: [{ exId: 'pullup_pyramid', type: 'pyramid', state: 'completed' }] }];
    const sum = Daily.weeklySummary(s, Week.seedPlan(), now);
    expect(sum.counts.pyramid || 0).toBe(0);
    expect(sum.dailySessions).toBe(0);
  });

  test('18 — classify + label cover every history category', () => {
    expect(Daily.classify({ kind: 'daily', classification: 'extra' })).toBe('extra');
    expect(Daily.classLabel('extra')).toBe('Extra Workout');
    expect(Daily.classify({ kind: 'daily', adaptations: [{ cause: 'x' }] })).toBe('adapted');
    expect(Daily.classify({ kind: 'daily' })).toBe('scheduled');
    expect(Daily.classify({ kind: 'strength' })).toBe('standalone');
    expect(Daily.classify({ excluded: true })).toBe('test');
  });
});

// ── E2E helpers ─────────────────────────────────────────────────────────────
async function seed(page, dayId = 5, extraSessions = null) {
  await page.addInitScript((d) => { window.__spcTodayId = d; }, dayId);
  await page.goto('index.html');
  await page.evaluate((extra) => {
    const S = window.CoachStore.makeStore(), D = window.CoachData, E = window.CoachEngine;
    const bench = { pullup_max: 9, dips_max: 6 }; const state = {};
    D.worlds.forEach(w => { const nodes = window.CoachStore.seedStates(w, bench); const f = E.autoFocus(w, nodes); state[w.id] = { nodes, focus: { primary: f.primary, supporting: f.supporting, manual: false } }; });
    S.setBench(bench); S.setState(state);
    S.setProfile({ onboarded: true, activeWorld: 'muscleup', days: [0, 2, 4], duration: 'normal' });
    ['spc_c_day', 'spc_c_workout', 'spc_c_adhoc', 'spc_c_templates'].forEach(k => localStorage.removeItem(k));
    S.setSessions(extra || []);
  }, extraSessions);
  await page.reload();
}
async function runToFinishPanel(page) {
  for (let i = 0; i < 120; i++) {
    if (await page.locator('[data-finish],[data-finishex]').count()) return;
    if (await page.locator('[data-diff="appropriate"]').count()) { await page.locator('[data-diff="appropriate"]').first().click(); continue; }
    if (await page.locator('[data-tskip]').count()) { await page.locator('[data-tskip]').first().click(); continue; }
    if (await page.locator('.cur-card [data-done]').count()) { await page.locator('.cur-card [data-done]').first().click(); continue; }
    await page.waitForTimeout(40);
  }
  throw new Error('runner never reached a finish panel');
}
// Run one ad-hoc exercise to the completion screen, then to the ad-hoc summary.
async function finishAdhocExercise(page) {
  await runToFinishPanel(page);
  await page.locator('[data-finish],[data-finishex]').first().click();
  await expect(page.getByText('Exercise Complete')).toBeVisible();
  await page.locator('[data-finishday]').click();          // → ad-hoc completion
  await expect(page.getByText('Workout Complete')).toBeVisible();
}

test.describe('Today actions + hierarchy', () => {
  test('01 — Today shows Start Any Workout', async ({ page }) => {
    await seed(page);
    await expect(page.locator('[data-startany]')).toBeVisible();
  });
  test('02 — Today shows Start One Exercise', async ({ page }) => {
    await seed(page);
    await expect(page.locator('[data-startone]')).toBeVisible();
  });
  test('03 — the scheduled workout stays dominant above the ad-hoc actions', async ({ page }) => {
    await seed(page);
    // The scheduled card's primary Start button precedes the ad-hoc actions in the DOM.
    const startdayBox = await page.locator('[data-startday]').boundingBox();
    const anyBox = await page.locator('[data-startany]').boundingBox();
    expect(startdayBox.y).toBeLessThan(anyBox.y);
    // Scheduled start is a primary button; the ad-hoc ones are ghost/secondary.
    await expect(page.locator('[data-startday]')).toHaveClass(/primary/);
    await expect(page.locator('[data-startany]')).toHaveClass(/ghost/);
  });
});

test.describe('Start Any Workout + builder + single exercise', () => {
  test('04 — Start Any Workout opens the available templates', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startany]').click();
    await expect(page.getByText('Saved & Familiar Workouts')).toBeVisible();
    expect(await page.locator('[data-fam]').count()).toBeGreaterThanOrEqual(9);
    await expect(page.locator('[data-fam]', { hasText: 'Pull-Up Ladder' }).first()).toBeVisible();
  });
  test('05 — the user can build a multi-exercise custom queue and start it', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startany]').click();
    await page.locator('[data-build]').click();
    await page.locator('.chip-add', { hasText: 'Toes-to-Bar' }).click();
    await page.locator('.chip-add', { hasText: 'Dead Hang' }).click();
    expect(await page.locator('.bld-row').count()).toBe(2);
    // reorder: move the 2nd up
    await page.locator('[data-up="1"]').click();
    await page.locator('[data-start]').click();
    // No overlap with Friday for Dead Hang; T2B overlaps → classification asked.
    await expect(page.getByText('How should this workout count?')).toBeVisible();
  });
  test('06 — the user can start a single exercise', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startone]').click();
    await expect(page.getByText('Start One Exercise')).toBeVisible();
    await page.locator('[data-pick="deadhang"]').click();   // no overlap → straight into runner
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Dead Hang');
  });
});

test.describe('relationship to the plan', () => {
  test('07 — an unrelated workout is saved as an Extra Workout', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startany]').click();
    await page.locator('[data-fam]', { hasText: 'Pull-Up Pyramid' }).click();
    // Pyramid is not in Friday's plan → no dialog, straight into the runner.
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Pull-Up Pyramid');
    await finishAdhocExercise(page);
    await page.locator('[data-save]').click();
    await page.locator('.nav [data-s="progress"]').click();
    await expect(page.locator('.hist-item', { hasText: 'Extra Workout' })).toBeVisible();
  });
  test('08 — an overlapping exercise asks how it should count', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startany]').click();
    await page.locator('[data-fam]', { hasText: 'Pull-Up Ladder' }).first().click();
    await expect(page.getByText('How should this workout count?')).toBeVisible();
    await expect(page.locator('[data-cl="apply"]')).toBeVisible();
    await expect(page.locator('[data-cl="extra"]')).toBeVisible();
    await expect(page.locator('[data-cl="test"]')).toBeVisible();
  });
  test('09 — applying an exercise completes ONLY the matching planned exercise', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startone]').click();
    await page.locator('[data-pick="pistol"]').click();
    await page.locator('[data-cl="apply"]').click();          // apply to plan
    await finishAdhocExercise(page);
    await page.locator('[data-save]').click();
    // Friday's queue: Pistol complete, Ladder + T2B still not started.
    await expect(page.locator('.q-ex', { hasText: 'Pistol Squat' })).toContainText(/Completed/);
    await expect(page.locator('.q-ex', { hasText: 'Pull-Up Ladder' })).not.toContainText(/Completed/);
    await expect(page.locator('.q-ex', { hasText: 'Toes-to-Bar' })).not.toContainText(/Completed/);
  });
  test('10 — recording as extra does NOT complete the planned exercise', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startone]').click();
    await page.locator('[data-pick="pistol"]').click();
    await page.locator('[data-cl="extra"]').click();
    await finishAdhocExercise(page);
    await page.locator('[data-save]').click();
    await expect(page.locator('.q-ex', { hasText: 'Pistol Squat' })).not.toContainText(/Completed/);
  });
  test('11 — applying to the plan creates no duplicate history entry', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startone]').click();
    await page.locator('[data-pick="pistol"]').click();
    await page.locator('[data-cl="apply"]').click();
    await finishAdhocExercise(page);
    await page.locator('[data-save]').click();
    const n = await page.evaluate(() => window.CoachStore.makeStore().getSessions().length);
    expect(n).toBe(0);   // applied into the plan's daily; no separate ad-hoc session
  });
  test('19 — an applied session is not double counted in weekly totals', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startone]').click();
    await page.locator('[data-pick="pistol"]').click();
    await page.locator('[data-cl="apply"]').click();
    await finishAdhocExercise(page);
    await page.locator('[data-save]').click();
    const pistolSessions = await page.evaluate(() => window.CoachStore.makeStore().getSessions()
      .filter(s => (s.exercises || []).some(e => e.exId === 'pistol')).length);
    expect(pistolSessions).toBe(0);   // lives only in the plan daily, counted once
  });
});

test.describe('extra load, test exclusion, templates, resume', () => {
  test('12b — a logged extra pull workout adapts Friday in the live app', async ({ page }) => {
    const now = Date.now();
    await seed(page, 5, [{ id: 'ex1', kind: 'daily', classification: 'extra', origin: 'adhoc', status: 'completed',
      date: new Date(now - 3600e3).toISOString(), weekday: 4, session: 'Extra Workout',
      exercises: [{ exId: 'pullup_pyramid', type: 'pyramid', name: 'Pull-Up Pyramid', actualReps: 18, bestReps: 5, state: 'completed' }] }]);
    // Friday's card reflects the extra pulling load with an adaptation.
    await expect(page.locator('.adapt-cause')).toContainText(/reduced to 4 rounds/i);
  });
  test('13c — a test workout is excluded from Progress in the live app', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startany]').click();
    await page.locator('[data-fam]', { hasText: 'Pull-Up Max Test' }).click();
    await finishAdhocExercise(page);
    await page.locator('[data-save]').click();
    await page.locator('.nav [data-s="progress"]').click();
    await expect(page.locator('.hist-item').first()).toContainText(/Test/);
    // the test does not add pull reps to the weekly summary
    await expect(page.locator('.progress-left')).toContainText('0 pull-up reps');
  });
  test('14 — a custom workout template can be saved and reused', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startany]').click();
    await page.locator('[data-build]').click();
    await page.locator('.chip-add', { hasText: 'Pistol Squat' }).click();
    page.once('dialog', d => d.accept('Pistol + Core'));
    await page.locator('[data-savetmpl]').click();
    // it now appears under the chooser's saved workouts
    await page.locator('[data-back]').click();
    await expect(page.locator('[data-tmpl]', { hasText: 'Pistol + Core' })).toBeVisible();
  });
  test('15 — saving a template does not modify the weekly plan', async ({ page }) => {
    await seed(page);
    const before = await page.evaluate(() => JSON.stringify(window.CoachStore.makeStore().getPlan().requirements));
    await page.locator('[data-startany]').click();
    await page.locator('[data-build]').click();
    await page.locator('.chip-add', { hasText: 'Dead Hang' }).click();
    page.once('dialog', d => d.accept('Light Recovery'));
    await page.locator('[data-savetmpl]').click();
    const after = await page.evaluate(() => JSON.stringify(window.CoachStore.makeStore().getPlan().requirements));
    expect(after).toBe(before);
  });
  test('16 — an ad-hoc workout survives a refresh', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startany]').click();
    await page.locator('[data-fam]', { hasText: 'Pull-Up Pyramid' }).click();
    await page.locator('.cur-card [data-done]').first().click();   // one set in
    await page.reload();
    await expect(page.locator('.wk-runner')).toBeVisible();
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Pull-Up Pyramid');
    const a = await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_adhoc')));
    expect(a.status).toBe('in_progress');
    expect(a.classification).toBe('extra');
  });
  test('17 — flexible ladder still works inside an ad-hoc workout', async ({ page }) => {
    await seed(page, 2);   // Tuesday: pull-up ladder is not planned → extra
    await page.locator('[data-startany]').click();
    await page.locator('[data-fam]', { hasText: 'Pull-Up Ladder' }).first().click();
    await runToFinishPanel(page);
    await expect(page.locator('[data-addround]')).toBeVisible();
    await page.locator('[data-addround]').click();
    await expect(page.locator('.cur-card')).toBeVisible();
  });
  test('20 — the planned daily workout still starts from Today', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startday]').click();
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Pistol Squat');
  });
});
