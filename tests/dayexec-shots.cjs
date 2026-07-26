// Manual validation scenario for the day-execution fix, captured as screenshots.
// Run via a temporary *.spec.cjs copy; saves PNGs into screenshots/dayexec/.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'screenshots', 'dayexec');
fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });
test.use({ viewport: { width: 880, height: 412 } });

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

test('capture manual-validation screenshots', async ({ page }) => {
  // 1-3: assign Toes-to-Bar to Sunday, open Sunday Today, confirm both visible.
  await seed(page, 0);
  await page.evaluate(() => {
    const S = window.CoachStore.makeStore(); const p = S.getPlan();
    p.requirements.t2b.days = [0, 2, 5]; p.requirements.t2b.target = 3; S.setPlan(p);
  });
  await page.reload();
  await shot(page, '01-sunday-bouldering-and-t2b');

  // 4-5: start Toes-to-Bar directly, complete it.
  await page.locator('.q-ex', { hasText: 'Toes-to-Bar' }).locator('[data-exstart]').click();
  for (let i = 0; i < 40 && !(await page.locator('[data-finish],[data-finishex]').count()); i++) {
    if (await page.locator('[data-diff="appropriate"]').count()) { await page.locator('[data-diff="appropriate"]').first().click(); continue; }
    if (await page.locator('.cur-card [data-done]').count()) { await page.locator('.cur-card [data-done]').first().click(); continue; }
    await page.waitForTimeout(40);
  }
  await page.locator('[data-finish],[data-finishex]').first().click();
  await page.locator('[data-finishnow]').click();

  // 6: confirm Bouldering remains unfinished, Toes-to-Bar completed.
  await shot(page, '02-t2b-completed-bouldering-unfinished');

  // 7-9 (Wednesday): assign Pistol Squat, confirm executable next to the group log.
  await seed(page, 3);
  await page.evaluate(() => {
    const S = window.CoachStore.makeStore(); const p = S.getPlan();
    p.requirements.pistol.days = [3]; p.requirements.pistol.target = 2; S.setPlan(p);
  });
  await page.reload();
  await shot(page, '03-wednesday-grouplog-and-pistol');

  // 9-10 (Saturday): assign Pull-Up Ladder, confirm the rest warning + executable.
  await seed(page, 6);
  await page.evaluate(() => {
    const S = window.CoachStore.makeStore(); const p = S.getPlan();
    p.requirements.pullup_ladder.days = [5, 6]; p.requirements.pullup_ladder.target = 2; S.setPlan(p);
  });
  await page.reload();
  await shot(page, '04-saturday-rest-warning-ladder-executable');
  await page.locator('.q-ex', { hasText: 'Pull-Up Ladder' }).locator('[data-exstart]').click();
  await shot(page, '05-saturday-ladder-runner');

  // 11: refresh and verify persistence (back on Sunday).
  await seed(page, 0);
  await page.evaluate(() => {
    const S = window.CoachStore.makeStore(); const p = S.getPlan();
    p.requirements.t2b.days = [0, 2, 5]; p.requirements.t2b.target = 3; S.setPlan(p);
  });
  await page.reload();
  await page.locator('.q-ex', { hasText: 'Toes-to-Bar' }).locator('[data-exstart]').click();
  await page.locator('.cur-card [data-done]').first().click();
  await page.reload();
  await shot(page, '06-refresh-persists-in-progress');
});
