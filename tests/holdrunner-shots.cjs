// Manual validation scenario for the Timed Hold runner, captured as screenshots.
// Run via a temporary *.spec.cjs copy; saves PNGs into screenshots/holdrunner/.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'screenshots', 'holdrunner');
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

  // 1: open Dead Hang via Start One Exercise.
  await page.locator('[data-startone]').click();
  await page.locator('[data-pick="deadhang"]').click();
  if (await page.locator('text=How should this workout count?').count()) await page.locator('[data-cl="extra"]').click();
  await expect(page.locator('.hold-card')).toBeVisible();
  await shot(page, '01-idle-hold-card');

  // 2: configure 3 holds / 30 sec each / 60 sec rest.
  await page.locator('[data-holdedit]').click();
  await shot(page, '02-edit-prescription-sheet');
  // rest defaults to 120s for this template type — bump down to 60s.
  for (let i = 0; i < 12; i++) await page.locator('[data-dec="rest"]').click();
  await page.locator('[data-done]').click();
  const bl0 = await page.evaluate(() => window.CoachApp._UI.workout.blocks[0]);
  expect(bl0.sets.length).toBe(3);
  expect(bl0.sets[0].target).toBe(30);
  expect(bl0.restSecs).toBe(60);
  await shot(page, '03-configured-3x30-rest60');

  // 3: start the first hold, confirm the 3-sec prep countdown.
  await page.locator('[data-holdstart]').click();
  await expect(page.locator('.hold-card.hold-prep')).toBeVisible();
  await shot(page, '04-prep-countdown');

  // 4: confirm the timer counts 30 -> 0.
  await page.clock.runFor(3200);
  await expect(page.locator('.hold-big')).toHaveText('30');
  await shot(page, '05-running-30');
  await page.clock.runFor(15000);
  await shot(page, '06-running-mid');
  await page.clock.runFor(15200);
  await expect(page.locator('.hold-result')).toBeVisible();
  await shot(page, '07-hold1-complete-sound-vibrate');
  const vib1 = await page.evaluate(() => window.__vibrate.length);
  expect(vib1).toBeGreaterThan(0);

  // 5: confirm result, rate difficulty, land in rest with hold 2 upcoming.
  await page.locator('[data-holdconfirm]').click();
  if (await page.locator('[data-diff="appropriate"]').count()) await page.locator('[data-diff="appropriate"]').click();
  await shot(page, '08-rest-between-holds');

  // 6: start hold 2, stop after ~20 sec (of the 30 sec target).
  await page.locator('[data-tskip]').click();
  await page.locator('[data-holdstart]').click();
  await page.clock.runFor(3200);
  await page.clock.runFor(20000);
  await page.locator('[data-holdstop]').click();
  await shot(page, '09-hold2-stop-early');
  const hd2 = await page.evaluate(() => window.CoachApp._UI.workout.hold);
  expect(hd2.resultSec).not.toBe(30); // actual ~20s, not the 30s target
  await page.locator('[data-holdconfirm]').click();
  if (await page.locator('[data-diff="appropriate"]').count()) await page.locator('[data-diff="appropriate"]').click();

  // 7: complete hold 3.
  await page.locator('[data-tskip]').click();
  await page.locator('[data-holdstart]').click();
  await page.clock.runFor(3200);
  await page.clock.runFor(30200);
  await page.locator('[data-holdconfirm]').click();
  if (await page.locator('[data-diff="appropriate"]').count()) await page.locator('[data-diff="appropriate"]').click();

  // 8: exercise summary — planned vs actual durations.
  await page.locator('[data-finish], [data-finishex]').click();
  await expect(page.getByText('Dead Hang completed')).toBeVisible();
  await shot(page, '10-exercise-summary-planned-vs-actual');

  // 9: History shows all three actual durations.
  await page.locator('[data-finishnow], [data-finishday]').first().click();
  if (await page.locator('[data-save]').count()) await page.locator('[data-save]').click();
  await page.locator('button[data-s="progress"]').click();
  await shot(page, '11-progress-history');

  // 10: refresh during an active hold restores the correct remaining time.
  await page.locator('button[data-s="today"]').click();
  await page.locator('[data-startone]').click();
  await page.locator('[data-pick="deadhang"]').click();
  if (await page.locator('text=How should this workout count?').count()) await page.locator('[data-cl="extra"]').click();
  await page.locator('[data-holdstart]').click();
  await page.clock.runFor(3200);
  await page.clock.runFor(12000); // 12s into a 30s hold
  await page.reload();
  await expect(page.locator('.hold-card')).toBeVisible();
  await shot(page, '12-refresh-restores-active-hold');
});
