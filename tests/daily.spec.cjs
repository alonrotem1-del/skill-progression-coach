// Skill Progression Coach — Round 4: daily-workout execution + Progress/History.
// Covers the exercise QUEUE, per-exercise runners, the completion screen, the
// flexible ladder/pyramid (add round/set in the same session, never an auto max
// test), resume/persistence, and the Progress weekly summary + history with
// delete / exclude / mark-as-test. Pure-module tests exercise daily.js directly;
// the E2E tests drive the live app. All English.
const { test, expect } = require('@playwright/test');

// ── pure daily.js module (no browser) ──────────────────────────────────────
const Week = require('../week.js');
const Daily = require('../daily.js');

function friday() {
  const plan = Week.seedPlan();
  const res = Week.resolveDay(plan, 5, { loads: {}, today: new Date() });
  return { plan, res, daily: Daily.makeDaily(res, {}) };
}

test.describe('daily.js — queue model', () => {
  test('01 — runnerType: pull-up ladder resolves to the ladder runner', () => {
    expect(Daily.runnerType('pullup_ladder')).toBe('ladder');
  });
  test('02 — runnerType: pull-up pyramid resolves to the pyramid runner', () => {
    expect(Daily.runnerType('pullup_pyramid')).toBe('pyramid');
  });
  test('03 — runnerType: pistol squat is unilateral', () => {
    expect(Daily.runnerType('pistol')).toBe('unilateral');
  });
  test('04 — runnerType: ring support is a hold', () => {
    expect(Daily.runnerType('ringsupport')).toBe('hold');
  });
  test('05 — runnerType: toes-to-bar is a sets runner', () => {
    expect(Daily.runnerType('t2b')).toBe('sets');
  });

  test('06 — makeDaily builds the full Friday queue, all not-started', () => {
    const { daily } = friday();
    const ids = daily.exercises.map(e => e.exId);
    expect(ids).toEqual(['pistol', 'pullup_ladder', 't2b', 'ringsupport', 'wristroller']);
    expect(daily.exercises.every(e => e.state === 'not_started')).toBe(true);
    expect(daily.exercises.every(e => e.result === null)).toBe(true);
  });

  test('07 — makeDaily flags required vs optional vs conditional', () => {
    const { daily } = friday();
    const by = {}; daily.exercises.forEach(e => (by[e.exId] = e));
    expect(by.pistol.required).toBe(true);
    expect(by.pullup_ladder.required).toBe(true);
    expect(by.t2b.required).toBe(true);
    expect(by.ringsupport.optional).toBe(true);
    expect(by.wristroller.conditional).toBe(true);
    expect(by.ringsupport.required).toBe(false);
  });

  test('08 — firstUnfinishedRequired is the first required exercise (Pistol)', () => {
    const { daily } = friday();
    expect(Daily.firstUnfinishedRequired(daily)).toBe('pistol');
  });

  test('09 — nextUnfinished skips a completed exercise', () => {
    const { daily } = friday();
    daily.exercises[0].state = 'completed';        // pistol done
    expect(Daily.firstUnfinishedRequired(daily)).toBe('pullup_ladder');
    expect(Daily.nextUnfinished(daily, 'pistol')).toBe('pullup_ladder');
  });

  test('10 — progress counts required and total', () => {
    const { daily } = friday();
    let p = Daily.progress(daily);
    expect(p.requiredTotal).toBe(3);
    expect(p.total).toBe(5);
    daily.exercises[0].state = 'completed';
    p = Daily.progress(daily);
    expect(p.requiredDone).toBe(1);
    expect(p.done).toBe(1);
  });

  test('11 — isDayComplete is true only when every required exercise is done or skipped', () => {
    const { daily } = friday();
    expect(Daily.isDayComplete(daily)).toBe(false);
    daily.exercises.forEach(e => { if (e.required) e.state = 'completed'; });
    expect(Daily.isDayComplete(daily)).toBe(true);           // optionals may remain
    // skipping a required one also counts as resolved
    const { daily: d2 } = friday();
    d2.exercises.forEach(e => { if (e.required) e.state = 'skipped'; });
    expect(Daily.isDayComplete(d2)).toBe(true);
  });

  test('12 — typeOf maps exercise ids to history type tags', () => {
    expect(Daily.typeOf('pullup_ladder')).toBe('ladder');
    expect(Daily.typeOf('pullup_pyramid')).toBe('pyramid');
    expect(Daily.typeOf('pistol')).toBe('pistol');
    expect(Daily.typeOf('bouldering')).toBe('climbing');
  });
});

test.describe('daily.js — aggregation', () => {
  const now = Date.now();
  // Anchor sessions inside THIS week (from Sunday 00:00) so the aggregation is
  // deterministic regardless of which weekday the suite runs on.
  const ws = Daily.weekStart(now);
  const inWeek = k => new Date(ws + k * 864e5 + 12 * 3600e3).toISOString();
  const sessions = () => ([
    { id: 'dw1', kind: 'daily', status: 'completed', date: inWeek(1), weekday: 5, session: 'Home Pull Session',
      exercises: [
        { exId: 'pullup_ladder', type: 'ladder', name: 'Pull-Up Ladder', actualReps: 30, actualRounds: 5, bestReps: 3, actualText: '1–2–3 × 5 rounds', state: 'completed' },
        { exId: 'pistol', type: 'pistol', name: 'Pistol Squat', actualReps: 15, state: 'completed' } ] },
    { id: 'old1', kind: 'strength', templateId: 'mu_strength', date: inWeek(2), exResults: { pullup: { bestReps: 8 } } },
    { id: 'clm', kind: 'climbing', date: inWeek(0), problems: [{ grade: 'V2', result: 'send' }] }
  ]);

  test('13 — weeklySummary counts sessions by exercise type', () => {
    const s = Daily.weeklySummary(sessions(), Week.seedPlan(), now);
    expect(s.counts.ladder).toBeGreaterThanOrEqual(1);
    expect(s.counts.pistol).toBe(1);
    const ladderLine = s.lines.find(l => l.key === 'ladder');
    expect(ladderLine.target).toBeGreaterThan(0);
  });

  test('14 — weeklySummary totals pull reps, ladder rounds and daily sessions', () => {
    const s = Daily.weeklySummary(sessions(), Week.seedPlan(), now);
    expect(s.pullReps).toBe(38);        // 30 (daily ladder) + 8 (legacy)
    expect(s.ladderRounds).toBe(5);
    expect(s.dailySessions).toBe(1);
  });

  test('15 — weeklySummary ignores excluded sessions', () => {
    const ss = sessions(); ss[0].excluded = true;
    const s = Daily.weeklySummary(ss, Week.seedPlan(), now);
    expect(s.dailySessions).toBe(0);
    expect(s.ladderRounds).toBe(0);
  });

  test('16 — historyEntries are newest-first and label legacy sessions "Standalone workout"', () => {
    const h = Daily.historyEntries(sessions());
    expect(new Date(h[0].date) >= new Date(h[1].date)).toBe(true);
    const legacy = h.find(e => e.id === 'old1');
    expect(legacy.standalone).toBe(true);
    expect(legacy.name).toBe('Standalone workout');
    const daily = h.find(e => e.id === 'dw1');
    expect(daily.standalone).toBe(false);
    expect(daily.name).toBe('Home Pull Session');
  });

  test('17 — sessionExercises normalises a legacy flat session', () => {
    const ex = Daily.sessionExercises(sessions()[1]);
    expect(ex).toHaveLength(1);
    expect(ex[0].type).toBe('ladder');
    expect(ex[0].bestReps).toBe(8);
    expect(ex[0].standalone).toBe(true);
  });

  test('18 — recomputeBench takes the best surviving pull set; excluding drops it', () => {
    const ss = sessions();
    expect(Daily.recomputeBench(ss).pullup_max).toBe(8);
    ss[1].excluded = true;                            // drop the 8-rep legacy PR
    expect(Daily.recomputeBench(ss).pullup_max).toBe(3);
  });
});

// ── E2E: live app ───────────────────────────────────────────────────────────
async function seed(page, dayId = 5, ladderRounds = null) {
  await page.addInitScript((d) => { window.__spcTodayId = d; }, dayId);
  await page.goto('index.html');
  await page.evaluate(({ ladderRounds }) => {
    const S = window.CoachStore.makeStore(), D = window.CoachData, E = window.CoachEngine;
    const bench = { pullup_max: 9, dips_max: 6 };
    const state = {};
    D.worlds.forEach(w => {
      const nodes = window.CoachStore.seedStates(w, bench);
      const f = E.autoFocus(w, nodes);
      state[w.id] = { nodes, focus: { primary: f.primary, supporting: f.supporting, manual: false } };
    });
    S.setBench(bench); S.setState(state);
    S.setProfile({ onboarded: true, activeWorld: 'muscleup', days: [0, 2, 4], duration: 'normal' });
    if (ladderRounds != null) {
      const s = window.CoachSettings.migrate(S.getSettings());
      const def = window.CoachSettings.defaultsForTemplate(D.templates.mu_strength);
      def.blocks[0].rounds = ladderRounds; s.workoutDefaults = s.workoutDefaults || {};
      s.workoutDefaults.mu_strength = def; S.setSettings(s);
    }
    // clear any prior daily/session state
    localStorage.removeItem('spc_c_day'); localStorage.removeItem('spc_c_sessions'); localStorage.removeItem('spc_c_workout');
  }, { ladderRounds });
  await page.reload();
}

// Drive whatever single-exercise runner is on screen until its finish panel.
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

test.describe('daily workout — Today queue', () => {
  test('19 — Friday shows the exercise queue with all five planned exercises', async ({ page }) => {
    await seed(page);
    await expect(page.locator('.queue')).toBeVisible();
    const names = await page.locator('.q-ex .q-name').allTextContents();
    expect(names).toEqual(['Pistol Squat', 'Pull-Up Ladder', 'Toes-to-Bar', 'Ring Support Hold', 'Wrist Roller']);
  });

  test('20 — the queue shows status chips and per-exercise Start actions', async ({ page }) => {
    await seed(page);
    // three required + optional/conditional all visible with a Start-This-Exercise
    expect(await page.locator('.q-ex [data-exstart]').count()).toBeGreaterThanOrEqual(3);
    await expect(page.locator('.q-ex', { hasText: 'Ring Support' })).toContainText(/Optional/i);
    await expect(page.locator('.q-ex', { hasText: 'Wrist Roller' })).toContainText(/Conditional/i);
  });

  test('21 — Start Daily Workout begins the first required exercise (Pistol Squat)', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startday]').first().click();
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Pistol Squat');
    await expect(page.locator('.cur-card')).toBeVisible();
  });

  test('22 — completing an exercise shows the completion screen with planned vs actual and X of N', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startday]').first().click();
    await runToFinishPanel(page);
    await page.locator('[data-finish],[data-finishex]').first().click();
    await expect(page.getByText('Exercise Complete')).toBeVisible();
    await expect(page.locator('.scr')).toContainText('Planned');
    await expect(page.locator('.scr')).toContainText('Actual');
    await expect(page.locator('.scr')).toContainText(/1 of 5 exercises/);
  });

  test('23 — the completion screen names the next exercise and Continue advances to it', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startday]').first().click();
    await runToFinishPanel(page);
    await page.locator('[data-finish],[data-finishex]').first().click();
    await expect(page.locator('.scr')).toContainText('Next:');
    await page.locator('[data-continue]').click();
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Pull-Up Ladder');
  });

  test('24 — a completed exercise is not restarted; the queue offers View + Redo', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startday]').first().click();
    await runToFinishPanel(page);
    await page.locator('[data-finish],[data-finishex]').first().click();
    await page.locator('[data-today]').click();
    const pistolRow = page.locator('.q-ex', { hasText: 'Pistol Squat' });
    await expect(pistolRow).toContainText(/Completed/);
    await expect(pistolRow.locator('[data-exview]')).toBeVisible();
    await expect(pistolRow.locator('[data-exredo]')).toBeVisible();
    // Start Daily Workout now skips the completed Pistol and starts the Ladder.
    await page.locator('[data-startday]').first().click();
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Pull-Up Ladder');
  });

  test('25 — Start This Exercise runs an individual exercise out of order', async ({ page }) => {
    await seed(page);
    await page.locator('.q-ex', { hasText: 'Toes-to-Bar' }).locator('[data-exstart]').click();
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Toes-to-Bar');
  });

  test('26 — skipping an optional exercise marks it Skipped in the queue', async ({ page }) => {
    await seed(page);
    await page.locator('.q-ex', { hasText: 'Ring Support' }).locator('[data-exskip]').click();
    await expect(page.locator('.q-ex', { hasText: 'Ring Support' })).toContainText(/Skipped/);
  });
});

test.describe('flexible ladder — extend in the same session, never an auto max test', () => {
  test('27 — Add One Full Round extends the ladder in the same session', async ({ page }) => {
    await seed(page, 5, 1);                       // 1-round ladder for speed
    await page.locator('.q-ex', { hasText: 'Pull-Up Ladder' }).locator('[data-exstart]').click();
    await runToFinishPanel(page);
    await expect(page.locator('.ladder-done')).toContainText('1 of 1 planned');
    await page.locator('[data-addround]').click();
    await expect(page.locator('.cur-card')).toBeVisible();   // back into the runner
    await runToFinishPanel(page);
    await expect(page.locator('.ladder-done')).toContainText('2 of 1 planned');
    await expect(page.locator('.ladder-done')).toContainText('+1 extra');
  });

  test('28 — a fatigue caution appears after more than two extra rounds', async ({ page }) => {
    await seed(page, 5, 1);
    await page.locator('.q-ex', { hasText: 'Pull-Up Ladder' }).locator('[data-exstart]').click();
    await runToFinishPanel(page);
    for (let i = 0; i < 3; i++) {                 // add rounds 2, 3, 4 (extra = 3)
      await page.locator('[data-addround]').click();
      await runToFinishPanel(page);
    }
    await expect(page.locator('.ladder-done .caution')).toBeVisible();
    await expect(page.locator('.ladder-done .caution')).toContainText(/extra rounds/i);
  });

  test('29 — finishing the ladder never launches a max test (no three-attempt prompt)', async ({ page }) => {
    await seed(page, 5, 1);
    await page.locator('.q-ex', { hasText: 'Pull-Up Ladder' }).locator('[data-exstart]').click();
    await runToFinishPanel(page);
    await page.locator('[data-finishex]').click();
    await expect(page.getByText('Exercise Complete')).toBeVisible();
    const body = (await page.locator('.scr').textContent()) || '';
    expect(body).not.toMatch(/maximum|three attempts|max test|max-rep/i);
  });

  test('30 — the completion screen reports planned vs actual rounds', async ({ page }) => {
    await seed(page, 5, 1);
    await page.locator('.q-ex', { hasText: 'Pull-Up Ladder' }).locator('[data-exstart]').click();
    await runToFinishPanel(page);
    await page.locator('[data-addround]').click();
    await runToFinishPanel(page);
    await page.locator('[data-finishex]').click();
    await expect(page.locator('.scr')).toContainText('1–2–3 × 1 rounds');   // planned
    await expect(page.locator('.scr')).toContainText('1–2–3 × 2 rounds');   // actual
    await expect(page.locator('.scr')).toContainText('Extra rounds');
  });

  test('31 — Save-as-default writes the new ladder default only on confirm', async ({ page }) => {
    await seed(page, 5, 1);
    await page.locator('.q-ex', { hasText: 'Pull-Up Ladder' }).locator('[data-exstart]').click();
    await runToFinishPanel(page);
    await page.locator('[data-addround]').click();
    await runToFinishPanel(page);                 // now 2 rounds done
    page.once('dialog', d => d.accept());
    await page.locator('[data-savedefault]').click();
    const rounds = await page.evaluate(() => window.CoachStore.makeStore().getSettings().workoutDefaults.mu_strength.blocks[0].rounds);
    expect(rounds).toBe(2);
  });
});

test.describe('flexible pyramid', () => {
  test('32 — Add Back-Off Set and Add Another Pyramid extend the pyramid in the same session', async ({ page }) => {
    await seed(page, 2);                          // Tuesday: Home Skill Session (pyramid)
    await page.locator('.q-ex', { hasText: 'Pull-Up Pyramid' }).locator('[data-exstart]').click();
    await runToFinishPanel(page);
    const plannedCount = await page.evaluate(() => window.CoachApp._UI.workout.blocks[0].plannedSetCount);
    await expect(page.locator('[data-addbackoff]')).toBeVisible();
    await page.locator('[data-addbackoff]').click();
    await expect(page.locator('.cur-card')).toBeVisible();
    await runToFinishPanel(page);
    let bl = await page.evaluate(() => window.CoachApp._UI.workout.blocks[0]);
    expect(bl.sets.length).toBe(plannedCount + 1);
    expect(bl.extraBackoff).toBe(1);
    await page.locator('[data-addpyramid]').click();
    if (await page.locator('[data-tskip]').count()) await page.locator('[data-tskip]').click(); // pre-pyramid rest
    await runToFinishPanel(page);
    bl = await page.evaluate(() => window.CoachApp._UI.workout.blocks[0]);
    expect(bl.sets.length).toBe(plannedCount + 1 + plannedCount);
    expect(bl.extraPyramids).toBe(1);
  });
});

test.describe('resume + persistence', () => {
  test('33 — an in-progress exercise resumes into its runner after a reload', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startday]').first().click();
    await page.locator('.cur-card [data-done]').first().click();   // one set in
    await page.reload();
    // The app resumes straight into the active exercise, and the daily queue
    // records it as in-progress in storage (survives the reload).
    await expect(page.locator('.wk-runner')).toBeVisible();
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Pistol Squat');
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_day')));
    expect(st.activeExId).toBe('pistol');
    expect(st.exercises.find(e => e.exId === 'pistol').state).toBe('in_progress');
  });

  test('34 — a completed exercise survives a reload (queue state persists)', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startday]').first().click();
    await runToFinishPanel(page);
    await page.locator('[data-finish],[data-finishex]').first().click();
    await page.locator('[data-today]').click();
    await page.reload();
    await expect(page.locator('.q-ex', { hasText: 'Pistol Squat' })).toContainText(/Completed/);
  });

  test('35 — finishing the day saves ONE session to history', async ({ page }) => {
    await seed(page);
    // complete the three required exercises
    for (const name of ['Pistol Squat', 'Pull-Up Ladder', 'Toes-to-Bar']) {
      await page.locator('.q-ex', { hasText: name }).locator('[data-exstart]').click();
      await runToFinishPanel(page);
      await page.locator('[data-finish],[data-finishex]').first().click();
      await page.locator('[data-today]').click();
    }
    // all required done → Start becomes Review; finishing saves the day
    await page.locator('[data-startday]').first().click();
    await page.locator('[data-finishday]').click();
    const count = await page.evaluate(() => window.CoachStore.makeStore().getSessions().filter(s => s.kind === 'daily').length);
    expect(count).toBe(1);
  });
});

test.describe('Progress + History', () => {
  // Seed a completed daily session directly for the aggregation UI.
  async function seedHistory(page) {
    await seed(page);
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore();
      const now = Date.now();
      S.setSessions([
        { id: 'dwA', kind: 'daily', status: 'completed', date: new Date(now - 864e5).toISOString(), weekday: 5, session: 'Home Pull Session',
          exercises: [
            { exId: 'pullup_ladder', type: 'ladder', name: 'Pull-Up Ladder', actualReps: 30, actualRounds: 5, bestReps: 3, actualText: '1–2–3 × 5 rounds', state: 'completed' },
            { exId: 'pistol', type: 'pistol', name: 'Pistol Squat', actualReps: 15, actualText: '15 total reps', state: 'completed' } ] },
        { id: 'legacyB', kind: 'strength', templateId: 'mu_strength', date: new Date(now - 3 * 864e5).toISOString(), exResults: { pullup: { bestReps: 8 } } }
      ]);
    });
    await page.locator('.nav [data-s="progress"]').click();
  }

  test('36 — the weekly summary card shows completion by exercise type', async ({ page }) => {
    await seedHistory(page);
    await expect(page.locator('.progress-left')).toContainText('This Week');
    await expect(page.locator('.sum-row', { hasText: 'Pull-Up Ladder' }).first()).toBeVisible();
    await expect(page.locator('.progress-left')).toContainText('workout');
  });

  test('37 — the history lists the finished workout and expands on tap', async ({ page }) => {
    await seedHistory(page);
    await expect(page.getByText('Workout History')).toBeVisible();
    const item = page.locator('.hist-item', { hasText: 'Home Pull Session' });
    await expect(item).toBeVisible();
    await item.locator('.hist-h').click();
    await expect(item.locator('.hist-body')).toContainText('Pull-Up Ladder');
    await expect(item.locator('.hist-body')).toContainText('Pistol Squat');
  });

  test('38 — a legacy session is labelled "Standalone workout"', async ({ page }) => {
    await seedHistory(page);
    await expect(page.locator('.hist-item', { hasText: 'Standalone workout' })).toBeVisible();
  });

  test('39 — a history filter chip narrows the list', async ({ page }) => {
    await seedHistory(page);
    await page.locator('.hist-fchip', { hasText: 'Pistol' }).click();
    await expect(page.locator('.hist-item', { hasText: 'Home Pull Session' })).toBeVisible();
    await expect(page.locator('.hist-item', { hasText: 'Standalone workout' })).toHaveCount(0);
  });

  test('40 — deleting a session removes it from history', async ({ page }) => {
    await seedHistory(page);
    const item = page.locator('.hist-item', { hasText: 'Home Pull Session' });
    await item.locator('.hist-h').click();
    page.once('dialog', d => d.accept());
    await item.locator('[data-hdelete]').click();
    await expect(page.locator('.hist-item', { hasText: 'Home Pull Session' })).toHaveCount(0);
    const remaining = await page.evaluate(() => window.CoachStore.makeStore().getSessions().some(s => s.id === 'dwA'));
    expect(remaining).toBe(false);
  });

  test('41 — exclude and mark-as-test toggle a session and recompute the benchmark', async ({ page }) => {
    await seedHistory(page);
    const legacy = page.locator('.hist-item', { hasText: 'Standalone workout' });
    await legacy.locator('.hist-h').click();
    // exclude the 8-rep legacy PR → benchmark recomputes to the daily best (3)
    await legacy.locator('[data-hexclude]').click();
    await expect(page.locator('.hist-item', { hasText: 'Standalone workout' })).toHaveClass(/excluded/);
    const bench = await page.evaluate(() => window.CoachStore.makeStore().getBench().pullup_max);
    expect(bench).toBe(3);
    // excluded sessions read as the "Test / Excluded" category
    await expect(legacy).toContainText('Test');
    // …and re-including restores the benchmark to 8
    await legacy.locator('[data-hexclude]').click();
    const bench2 = await page.evaluate(() => window.CoachStore.makeStore().getBench().pullup_max);
    expect(bench2).toBe(8);
  });
});
