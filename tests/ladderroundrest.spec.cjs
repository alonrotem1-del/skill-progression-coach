// Skill Progression Coach — Add Full Round must rest before the added round.
// Previously, pressing "Add Full Round" on the Ladder completion screen
// appended the round and jumped straight into its first step, skipping the
// prescribed inter-round rest entirely. This suite covers the fix: the added
// round is gated behind a persisted, timestamp-based pending rest (mirroring
// the Timed Hold runner's w.hold pattern) that reuses the existing rest-timer
// UI unchanged, and only reveals the round once that rest ends or is skipped.
const { test, expect } = require('@playwright/test');

async function seed(page) {
  await page.addInitScript(() => { window.__spcTodayId = 5; }); // Friday -> Pull-Up Ladder day
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

// Edit the Pull-Up Ladder default: rounds, inter-round rest, and (optionally)
// the step pattern — the exact controls a real user would use.
async function configureLadder(page, { rounds, restRound, steps } = {}) {
  await page.locator('.nav [data-s="profile"]').click();
  await page.locator('[data-sview="workoutDefaults"]').click();
  await page.locator('[data-editdef="mu_strength"]').click();
  if (rounds != null) {
    const el = page.locator('.ed-in[data-ed="rounds"][data-bi="0"]');
    await el.fill(String(rounds)); await el.dispatchEvent('change');
  }
  if (restRound != null) {
    const el = page.locator('.ed-in[data-ed="restRound"][data-bi="0"]');
    await el.fill(restRound); await el.dispatchEvent('change');
  }
  if (steps != null) {
    const el = page.locator('.ed-in[data-ed="steps"][data-bi="0"]');
    await el.fill(steps); await el.dispatchEvent('change');
  }
  await page.locator('[data-edsavedefault]').click();
}

// "Add Full Round" (finishPanelHtml's single-block ladder branch) only shows
// for a workout built from exactly ONE ladder block — the standalone Pull-Up
// Ladder exercise (single block), not the two-block mu_strength template
// (ladder + Scapular Pull-Ups) used from the Skill Map. Its prescription
// (rounds / rests / steps) is still resolved from the mu_strength ladder
// block (see exercisePrescription in app.js), so configureLadder above still
// applies here — this is the same "Start One Exercise" entry point real
// users reach it from.
async function startLadder(page) {
  await page.locator('.nav [data-s="today"]').click();
  await page.locator('[data-startone]').click();
  await page.locator('[data-pick="pullup_ladder"]').click();
  if (await page.locator('text=How should this workout count?').count()) {
    await page.locator('[data-cl="extra"]').click();
  }
  await expect(page.locator('.cur-card')).toBeVisible();
}

async function completeRound(page) {
  const stepCount = await page.evaluate(() => {
    const w = window.CoachApp._UI.workout, bl = w.blocks[0];
    const cur = bl.rounds.find(rd => rd.steps.some(s => !s.doneFlag));
    return cur.steps.length;
  });
  for (let i = 0; i < stepCount; i++) {
    await page.locator('.cur-card [data-done]').click();
    if (await page.locator('.adapt-card [data-diff]').count()) await page.locator('[data-diff="appropriate"]').click();
    if (await page.locator('[data-tskip]').count()) await page.locator('[data-tskip]').click();
  }
}

function workout(page) { return page.evaluate(() => window.CoachApp._UI.workout); }

test.describe('Add Full Round — pre-round rest', () => {
  test('01 — completing the planned rounds shows Add Full Round', async ({ page }) => {
    await seed(page);
    await configureLadder(page, { rounds: 4, restRound: '2:30' });
    await startLadder(page);
    for (let i = 0; i < 4; i++) await completeRound(page);
    await expect(page.locator('[data-addround]')).toBeVisible();
  });

  test('02/03/04 — Add Full Round appends one round, starts the rest, and does not open its step 1 immediately', async ({ page }) => {
    await seed(page);
    await configureLadder(page, { rounds: 4, restRound: '2:30' });
    await startLadder(page);
    for (let i = 0; i < 4; i++) await completeRound(page);
    await page.locator('[data-addround]').click();
    const w = await workout(page);
    expect(w.blocks[0].rounds.length).toBe(5); // exactly one complete round appended
    expect(w.blocks[0].rounds[4].steps.length).toBe(3); // a full 1-2-3 copy, not partial
    expect(w.blocks[0].rounds[4].steps.every(s => !s.doneFlag)).toBe(true);
    await expect(page.locator('#rest .timer')).toBeVisible();
    await expect(page.locator('.ladder-rest-pending')).toBeVisible();
    await expect(page.locator('.cur-card [data-done]')).toHaveCount(0); // step 1 not open
  });

  test('05/06 — the rest uses the configured duration (150s displays as 2:30)', async ({ page }) => {
    await seed(page);
    await configureLadder(page, { rounds: 4, restRound: '2:30' });
    await startLadder(page);
    for (let i = 0; i < 4; i++) await completeRound(page);
    await page.locator('[data-addround]').click();
    await expect(page.locator('#rest .t')).toHaveText('2:30');
  });

  test('a differently-configured rest (120s) is honored, not a hardcoded 150', async ({ page }) => {
    await seed(page);
    await configureLadder(page, { rounds: 4, restRound: '2:00' });
    await startLadder(page);
    for (let i = 0; i < 4; i++) await completeRound(page);
    await page.locator('[data-addround]').click();
    await expect(page.locator('#rest .t')).toHaveText('2:00');
  });

  test('07 — the rest identifies the upcoming round number', async ({ page }) => {
    await seed(page);
    await configureLadder(page, { rounds: 4, restRound: '2:30' });
    await startLadder(page);
    for (let i = 0; i < 4; i++) await completeRound(page);
    await page.locator('[data-addround]').click();
    await expect(page.locator('#rest')).toContainText('Rest before Round 5');
  });

  test('08 — rest completion opens Round 5 Step 1', async ({ page }) => {
    await page.clock.install();
    await seed(page);
    await configureLadder(page, { rounds: 4, restRound: '2:30' });
    await startLadder(page);
    for (let i = 0; i < 4; i++) await completeRound(page);
    await page.locator('[data-addround]').click();
    await page.clock.runFor(151000);
    await expect(page.locator('.cur-meta').first()).toContainText('Round 5 of 5');
    await expect(page.locator('.cur-card [data-done]')).toBeVisible();
  });

  test('09 — Skip Rest opens Round 5 Step 1 immediately', async ({ page }) => {
    await seed(page);
    await configureLadder(page, { rounds: 4, restRound: '2:30' });
    await startLadder(page);
    for (let i = 0; i < 4; i++) await completeRound(page);
    await page.locator('[data-addround]').click();
    await page.locator('[data-tskip]').click();
    await expect(page.locator('.cur-meta').first()).toContainText('Round 5 of 5');
    await expect(page.locator('.cur-card [data-done]')).toBeVisible();
  });

  test('10/11 — Pause prevents rest-time accumulation; Resume continues accurately', async ({ page }) => {
    await page.clock.install();
    await seed(page);
    await configureLadder(page, { rounds: 4, restRound: '2:30' });
    await startLadder(page);
    for (let i = 0; i < 4; i++) await completeRound(page);
    await page.locator('[data-addround]').click();
    await page.clock.runFor(30000);
    await page.locator('[data-tpause]').click();
    let lr = await page.evaluate(() => window.CoachApp._UI.workout.ladderRest);
    expect(lr.paused).toBe(true);
    const atPause = lr.elapsedMs;
    await page.clock.runFor(20000); // time passes while paused
    lr = await page.evaluate(() => window.CoachApp._UI.workout.ladderRest);
    expect(lr.elapsedMs).toBe(atPause); // unchanged — no accumulation while paused
    await page.locator('[data-tpause]').click(); // resume
    lr = await page.evaluate(() => window.CoachApp._UI.workout.ladderRest);
    expect(lr.paused).toBe(false);
    await page.clock.runFor(10000);
    lr = await page.evaluate(() => window.CoachApp._UI.workout.ladderRest);
    const liveElapsed = lr.elapsedMs + (lr.paused ? 0 : 10000);
    expect(liveElapsed).toBeGreaterThanOrEqual(atPause + 9000);
    expect(liveElapsed).toBeLessThanOrEqual(atPause + 11000);
  });

  test('12 — Add 30 Seconds extends the timer', async ({ page }) => {
    await seed(page);
    await configureLadder(page, { rounds: 4, restRound: '2:30' });
    await startLadder(page);
    for (let i = 0; i < 4; i++) await completeRound(page);
    await page.locator('[data-addround]').click();
    const before = await page.evaluate(() => window.CoachApp._UI.timerLeft);
    await page.locator('[data-t30]').click();
    const after = await page.evaluate(() => window.CoachApp._UI.timerLeft);
    expect(after).toBe(before + 30);
    const lr = await page.evaluate(() => window.CoachApp._UI.workout.ladderRest);
    expect(lr.restSecs).toBe(180);
  });

  test('13/14 — refresh during the rest restores remaining time and does not duplicate the round', async ({ page }) => {
    await page.clock.install();
    await seed(page);
    await configureLadder(page, { rounds: 4, restRound: '2:30' });
    await startLadder(page);
    for (let i = 0; i < 4; i++) await completeRound(page);
    await page.locator('[data-addround]').click();
    await page.clock.runFor(60000); // 60s into 150s
    await page.reload();
    await expect(page.locator('#rest .timer')).toBeVisible();
    await expect(page.locator('#rest .t')).toHaveText('1:30');
    await expect(page.locator('.cur-card [data-done]')).toHaveCount(0); // still gated
    const w = await workout(page);
    expect(w.blocks[0].rounds.length).toBe(5); // not duplicated
  });

  // A ladder started via "Start One Exercise" carries a dailyExId, so
  // finishing it routes through finishDailyExercise -> exerciseResult, and
  // its planned/actual result is stashed on the ad-hoc daily's exercise
  // entry (spc_c_adhoc) — that, not a bare Store.getSessions() session, is
  // where "History" actually reads planned-vs-actual from for this flow.
  function adhocLadderResult(page) {
    return page.evaluate(() => {
      const d = window.CoachStore.makeStore().getAdhoc();
      const e = d && d.exercises.find(x => x.exId === 'pullup_ladder');
      return e && e.result;
    });
  }

  test('15/16/17 — completing the added round updates the round count, total reps, and History stores one workout', async ({ page }) => {
    await seed(page);
    await configureLadder(page, { rounds: 4, restRound: '2:30' });
    await startLadder(page);
    for (let i = 0; i < 4; i++) await completeRound(page);
    await page.locator('[data-addround]').click();
    await page.locator('[data-tskip]').click();
    await completeRound(page); // round 5
    await expect(page.locator('.ladder-done')).toContainText('5 of 4 planned');
    const totalBefore = await page.evaluate(() => {
      const bl = window.CoachApp._UI.workout.blocks[0];
      let n = 0; bl.rounds.forEach(rd => rd.steps.forEach(s => { n += s.actual; }));
      return n;
    });
    expect(totalBefore).toBe(6 * 5); // 1+2+3 per round x 5 rounds
    await page.locator('[data-finishex]').click(); // finishDailyExercise
    const result = await adhocLadderResult(page);
    expect(result.actualRounds).toBe(5);
    expect(result.actualReps).toBe(30); // includes the added round's reps
    expect(result.extraRounds).toBe(1);
    // one workout, not a duplicate: exactly one exercise entry for pullup_ladder
    const count = await page.evaluate(() => {
      const d = window.CoachStore.makeStore().getAdhoc();
      return d.exercises.filter(x => x.exId === 'pullup_ladder').length;
    });
    expect(count).toBe(1);
  });

  test('18 — ending the workout during the rest does not count the added round as completed', async ({ page }) => {
    await seed(page);
    await configureLadder(page, { rounds: 4, restRound: '2:30' });
    await startLadder(page);
    for (let i = 0; i < 4; i++) await completeRound(page);
    await page.locator('[data-addround]').click();
    page.once('dialog', d => d.accept());
    await page.locator('[data-endladderrest]').click();
    const result = await adhocLadderResult(page);
    // 4 completed rounds = 1+2+3 x4 = 24 total reps; the unstarted 5th round
    // must not contribute its target reps.
    expect(result.actualRounds).toBe(4);
    expect(result.actualReps).toBe(24);
  });

  test('19 — adding a second additional round triggers another rest', async ({ page }) => {
    await seed(page);
    await configureLadder(page, { rounds: 4, restRound: '2:30' });
    await startLadder(page);
    for (let i = 0; i < 4; i++) await completeRound(page);
    await page.locator('[data-addround]').click();
    await page.locator('[data-tskip]').click();
    await completeRound(page); // round 5
    await expect(page.locator('[data-addround]')).toBeVisible();
    await page.locator('[data-addround]').click();
    await expect(page.locator('#rest')).toContainText('Rest before Round 6');
    await expect(page.locator('.cur-card [data-done]')).toHaveCount(0);
    const w = await workout(page);
    expect(w.blocks[0].rounds.length).toBe(6);
  });

  test('20 — a non-1-2-3 ladder pattern behaves correctly', async ({ page }) => {
    await seed(page);
    await configureLadder(page, { rounds: 2, restRound: '1:00', steps: '1-2-3-4' });
    await startLadder(page);
    await completeRound(page); // round 1 (4 steps) — completeRound already skips the inter-round rest itself
    await completeRound(page); // round 2 (4 steps)
    await page.locator('[data-addround]').click();
    const w = await workout(page);
    expect(w.blocks[0].rounds[2].steps.map(s => s.target)).toEqual([1, 2, 3, 4]);
    await expect(page.locator('#rest')).toContainText('Rest before Round 3');
    await expect(page.locator('.cur-card [data-done]')).toHaveCount(0);
  });
});
