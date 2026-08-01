// Manual validation scenario for the Add Full Round rest-timer fix, captured
// as screenshots. Run via a temporary *.spec.cjs copy; saves PNGs into
// screenshots/ladderroundrest/.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'screenshots', 'ladderroundrest');
fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });
test.use({ viewport: { width: 390, height: 780 } });

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

async function configureLadder(page, { rounds, restRound }) {
  await page.locator('.nav [data-s="profile"]').click();
  await page.locator('[data-sview="workoutDefaults"]').click();
  await page.locator('[data-editdef="mu_strength"]').click();
  const roundsEl = page.locator('.ed-in[data-ed="rounds"][data-bi="0"]');
  await roundsEl.fill(String(rounds)); await roundsEl.dispatchEvent('change');
  const restEl = page.locator('.ed-in[data-ed="restRound"][data-bi="0"]');
  await restEl.fill(restRound); await restEl.dispatchEvent('change');
  await page.locator('[data-edsavedefault]').click();
}

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

test('capture manual-validation screenshots', async ({ page }) => {
  await page.clock.install();
  await seed(page);

  // 1: start a Ladder workout with pattern 1-2-3, 4 planned rounds, 150s rest.
  await configureLadder(page, { rounds: 4, restRound: '2:30' });
  await startLadder(page);
  await shot(page, '01-ladder-started-4-rounds-planned');

  // 2: complete all four rounds.
  for (let i = 0; i < 4; i++) await completeRound(page);
  await shot(page, '02-all-4-rounds-complete');

  // 3: press Add Full Round.
  await page.locator('[data-addround]').click();
  await shot(page, '03-add-full-round-pressed');

  // 4: confirm Round 5 does not begin immediately.
  await expect(page.locator('.cur-card [data-done]')).toHaveCount(0);
  await expect(page.locator('.ladder-rest-pending')).toBeVisible();
  await shot(page, '04-round-5-not-started-yet');

  // 5/6: confirm the 2:30 rest timer opens and states "Rest before Round 5".
  await expect(page.locator('#rest .t')).toHaveText('2:30');
  await expect(page.locator('#rest')).toContainText('Rest before Round 5');
  await shot(page, '05-06-rest-timer-2-30-before-round-5');

  // 7: allow the timer to finish.
  await page.clock.runFor(151000);
  await shot(page, '07-rest-complete');

  // 8: confirm Round 5 begins at step 1.
  await expect(page.locator('.cur-meta').first()).toContainText('Round 5 of 5');
  await expect(page.locator('.cur-card [data-done]')).toBeVisible();
  await shot(page, '08-round-5-step-1-open');

  // 9: complete Round 5.
  await completeRound(page);
  await shot(page, '09-round-5-complete');

  // 10: confirm the summary shows five completed rounds + correct total reps.
  await expect(page.locator('.ladder-done')).toContainText('5 of 4 planned');
  await shot(page, '10-summary-5-rounds-total-reps');
  await page.locator('[data-finishex]').click();
  await expect(page.getByText('Pull-Up Ladder completed')).toBeVisible();

  // 11: open History and confirm it is stored as one workout.
  await page.locator('[data-finishnow], [data-finishday]').first().click();
  if (await page.locator('[data-save]').count()) await page.locator('[data-save]').click();
  await page.locator('button[data-s="progress"]').click();
  await shot(page, '11-history-one-workout');

  // 12/13: repeat the flow and refresh during the rest; confirm restoration.
  await page.locator('button[data-s="today"]').click();
  await startLadder(page);
  for (let i = 0; i < 4; i++) await completeRound(page);
  await page.locator('[data-addround]').click();
  await page.clock.runFor(45000); // partway into the 150s rest
  await page.reload();
  await shot(page, '12-13-refresh-during-rest-restored');
  await expect(page.locator('.cur-card [data-done]')).toHaveCount(0);
  const w = await page.evaluate(() => window.CoachApp._UI.workout);
  expect(w.blocks[0].rounds.length).toBe(5); // not duplicated

  // 14: repeat once more using Skip Rest; confirm Round 5 begins immediately.
  await page.locator('[data-tskip]').click();
  await expect(page.locator('.cur-meta').first()).toContainText('Round 5 of 5');
  await expect(page.locator('.cur-card [data-done]')).toBeVisible();
  await shot(page, '14-skip-rest-opens-round-5-immediately');
});
