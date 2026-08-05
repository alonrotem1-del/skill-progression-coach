// Manual validation scenario for the Pull-Up Pyramid runner (Section 9),
// captured as screenshots in a portrait viewport. Run via a temporary
// *.spec.cjs copy; saves PNGs into screenshots/pyramid/.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'screenshots', 'pyramid');
fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });
test.use({ viewport: { width: 390, height: 780 } });

async function seed(page) {
  await page.addInitScript(() => {
    function FakeCtx() { this.state = 'running'; this.currentTime = 0; }
    FakeCtx.prototype.createOscillator = function () { return { connect() {}, frequency: { value: 0 }, type: '', start() {}, stop() {} }; };
    FakeCtx.prototype.createGain = function () { return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; };
    FakeCtx.prototype.resume = function () {};
    window.AudioContext = FakeCtx; window.webkitAudioContext = FakeCtx;
    window.__vibrate = [];
    Object.defineProperty(navigator, 'vibrate', { value: (p) => { window.__vibrate.push(p); return true; }, configurable: true });
  });
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

test('capture manual-validation screenshots', async ({ page }) => {
  await page.clock.install();
  await seed(page);

  // 1: start the Pull-Up Pyramid via Start One Exercise.
  await page.locator('[data-startone]').click();
  await page.locator('[data-pick="pullup_pyramid"]').click();
  if (await page.locator('text=How should this workout count?').count()) await page.locator('[data-cl="extra"]').click();
  await expect(page.locator('.cur-card')).toBeVisible();
  await shot(page, '01-starting-set-open');

  // 2: change the first set to 6 via the stepper.
  const startActual = await page.evaluate(() => window.CoachApp._UI.workout.blocks[0].sets[0].actual);
  for (let i = startActual; i < 6; i++) await page.locator('.cur-card [data-step="1"]').click();
  for (let i = startActual; i > 6; i--) await page.locator('.cur-card [data-step="-1"]').click();
  await expect(page.locator('.cur-card .num')).toHaveText('6');
  await shot(page, '02-first-set-adjusted-to-6');

  // 3: complete the first set -> freezes 6,5,4,3,2,1.
  await page.locator('.cur-card [data-done]').click();
  const bl1 = await page.evaluate(() => window.CoachApp._UI.workout.blocks[0]);
  expect(bl1.frozen).toBe(true);
  expect(bl1.sets.map(s => s.target)).toEqual([6, 5, 4, 3, 2, 1]);
  await shot(page, '03-frozen-6-5-4-3-2-1-rest-running');

  // 4: confirm Set 2 opens at 5, and the rest timer is visible alongside it.
  await expect(page.locator('.cur-card .num')).toHaveText('5');
  await expect(page.locator('#rest .timer')).toBeVisible();
  await shot(page, '04-set2-defaults-to-5-timer-visible');

  // 5: during the rest, change the displayed actual reps for set 2.
  await page.clock.runFor(20000);
  const remainingBefore = await page.evaluate(() => window.CoachApp._UI.timerLeft);
  await page.locator('.cur-card [data-step="1"]').click();
  await shot(page, '05-reps-changed-during-rest');

  // 6: confirm the timer stayed visible and continued (did not restart).
  const remainingAfter = await page.evaluate(() => window.CoachApp._UI.timerLeft);
  expect(remainingAfter).toBeLessThanOrEqual(remainingBefore);
  expect(remainingAfter).toBeGreaterThanOrEqual(remainingBefore - 2);
  await expect(page.locator('#rest .timer')).toBeVisible();
  await shot(page, '06-timer-continued-not-restarted');

  // 7: pause, change reps again, confirm it stays paused.
  await page.locator('[data-tpause]').click();
  await page.locator('.cur-card [data-step="-1"]').click();
  await expect(page.locator('[data-tpause]')).toHaveText('Resume');
  await shot(page, '07-paused-and-reps-changed-still-paused');

  // 8: refresh, confirm the timer restores correctly.
  const leftAtPause = await page.evaluate(() => window.CoachApp._UI.workout.setRest.elapsedMs);
  await page.reload();
  await expect(page.locator('#rest .timer')).toBeVisible();
  await shot(page, '08-refreshed-timer-restored');
  await page.locator('[data-tpause]').click(); // resume after reload

  // 9: complete the rest of the pyramid (5 more sets after set 1).
  for (let i = 0; i < 10; i++) {
    if (await page.locator('[data-pyrdiff]').count()) break;
    if (await page.locator('[data-tskip]').count()) await page.locator('[data-tskip]').click();
    if (await page.locator('.cur-card [data-done]').count()) await page.locator('.cur-card [data-done]').click();
  }
  await shot(page, '09-final-set-done-difficulty-prompt');

  // 10: confirm the overall difficulty prompt appears exactly once.
  await expect(page.locator('.adapt-card')).toHaveCount(1);
  await page.locator('[data-pyrdiff="appropriate"]').click();
  await shot(page, '10-rated-finish-panel');
  await expect(page.locator('[data-addbackoff]')).toBeVisible();
  await expect(page.locator('[data-addpyramid]')).toBeVisible();

  // 11: finish and confirm History records planned vs actual correctly.
  await page.locator('[data-finishex]').click();
  await shot(page, '11-exercise-complete-planned-vs-actual');
  await expect(page.locator('.card').first()).toContainText('21'); // 6+5+4+3+2+1
});
