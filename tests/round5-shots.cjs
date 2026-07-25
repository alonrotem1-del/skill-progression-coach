// Round 5 screenshot capture — ad-hoc workout flow.
// Run via a temporary *.spec.cjs copy; saves PNGs into screenshots/round5/.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'screenshots', 'round5');
fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });
test.use({ viewport: { width: 880, height: 412 } });

async function seed(page, dayId = 5) {
  await page.addInitScript((d) => { window.__spcTodayId = d; }, dayId);
  await page.goto('index.html');
  await page.evaluate(() => {
    const S = window.CoachStore.makeStore(), D = window.CoachData, E = window.CoachEngine;
    const bench = { pullup_max: 9, dips_max: 6 }; const state = {};
    D.worlds.forEach(w => { const nodes = window.CoachStore.seedStates(w, bench); const f = E.autoFocus(w, nodes); state[w.id] = { nodes, focus: { primary: f.primary, supporting: f.supporting, manual: false } }; });
    S.setBench(bench); S.setState(state);
    S.setProfile({ onboarded: true, activeWorld: 'muscleup', days: [0, 2, 4], duration: 'normal' });
    ['spc_c_day', 'spc_c_workout', 'spc_c_adhoc', 'spc_c_templates'].forEach(k => localStorage.removeItem(k));
    S.setSessions([]);
  });
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
}

test('capture round 5 screenshots', async ({ page }) => {
  // 01 — Today with the three workout actions
  await seed(page);
  await page.locator('.adhoc-actions').scrollIntoViewIfNeeded();
  await shot(page, '01-today-three-actions');

  // 02 — the workout template chooser
  await page.locator('[data-startany]').click();
  await page.locator('.chooser-list').first().waitFor();
  await shot(page, '02-workout-chooser');

  // 03 — the custom workout builder with a queue
  await page.locator('[data-build]').click();
  await page.locator('.chip-add', { hasText: 'Pistol Squat' }).click();
  await page.locator('.chip-add', { hasText: 'Toes-to-Bar' }).click();
  await page.locator('.chip-add', { hasText: 'Dead Hang' }).click();
  await shot(page, '03-custom-builder');

  // 04 — the single-exercise chooser
  await seed(page);
  await page.locator('[data-startone]').click();
  await page.locator('.chooser-list').first().waitFor();
  await shot(page, '04-single-exercise-chooser');

  // 05 — the overlap classification dialog
  await page.locator('[data-pick="pistol"]').click();     // Pistol overlaps Friday
  await page.getByText('How should this workout count?').waitFor();
  await shot(page, '05-overlap-dialog');

  // 06 — extra-workout completion (classification actions)
  await seed(page);
  await page.locator('[data-startany]').click();
  await page.locator('[data-fam]', { hasText: 'Pull-Up Pyramid' }).click();
  await runToFinishPanel(page);
  await page.locator('[data-finish],[data-finishex]').first().click();
  await page.getByText('Exercise Complete').waitFor();
  await page.locator('[data-finishday]').click();
  await page.getByText('Workout Complete').waitFor();
  await shot(page, '06-extra-workout-completion');
  await page.locator('[data-save]').click();

  // 07 — History classifications (extra + scheduled/standalone)
  await page.evaluate(() => {
    const S = window.CoachStore.makeStore(); const now = Date.now();
    const cur = S.getSessions();
    cur.push({ id: 'test1', kind: 'daily', classification: 'test', excluded: true, status: 'completed', date: new Date(now - 864e5).toISOString(), weekday: 4, session: 'Max Test', exercises: [{ exId: 'pullup_ladder', type: 'ladder', name: 'Pull-Up Max Test', actualText: '11 reps', bestReps: 11, state: 'completed' }] });
    cur.push({ id: 'sched1', kind: 'daily', status: 'completed', date: new Date(now - 2 * 864e5).toISOString(), weekday: 5, session: 'Home Pull Session', exercises: [{ exId: 'pistol', type: 'pistol', name: 'Pistol Squat', actualText: '15 reps', state: 'completed' }] });
    S.setSessions(cur);
  });
  await page.locator('.nav [data-s="progress"]').click();
  await page.locator('.hist-item').first().waitFor();
  await shot(page, '07-history-classifications');

  // 08 — Friday queue after completing Pistol individually (apply to plan)
  await seed(page);
  await page.locator('[data-startone]').click();
  await page.locator('[data-pick="pistol"]').click();
  await page.locator('[data-cl="apply"]').click();
  await runToFinishPanel(page);
  await page.locator('[data-finish],[data-finishex]').first().click();
  await page.locator('[data-finishday]').click();
  await page.locator('[data-save]').click();
  await expect(page.locator('.q-ex', { hasText: 'Pistol Squat' })).toContainText(/Completed/);
  await shot(page, '08-friday-queue-pistol-applied');
});
