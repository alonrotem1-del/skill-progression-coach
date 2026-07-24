// Round 4 screenshot capture — daily-workout execution + Progress/History.
// Run with: npx playwright test tests/round4-shots.cjs
// Saves PNGs into screenshots/round4/.
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'screenshots', 'round4');
fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });

test.use({ viewport: { width: 880, height: 412 } });   // phone landscape

async function seed(page, dayId = 5, ladderRounds = null) {
  await page.addInitScript((d) => { window.__spcTodayId = d; }, dayId);
  await page.goto('index.html');
  await page.evaluate(({ ladderRounds }) => {
    const S = window.CoachStore.makeStore(), D = window.CoachData, E = window.CoachEngine;
    const bench = { pullup_max: 9, dips_max: 6 }; const state = {};
    D.worlds.forEach(w => { const nodes = window.CoachStore.seedStates(w, bench); const f = E.autoFocus(w, nodes); state[w.id] = { nodes, focus: { primary: f.primary, supporting: f.supporting, manual: false } }; });
    S.setBench(bench); S.setState(state);
    S.setProfile({ onboarded: true, activeWorld: 'muscleup', days: [0, 2, 4], duration: 'normal' });
    if (ladderRounds != null) {
      const s = window.CoachSettings.migrate(S.getSettings());
      const def = window.CoachSettings.defaultsForTemplate(D.templates.mu_strength);
      def.blocks[0].rounds = ladderRounds; s.workoutDefaults = s.workoutDefaults || {};
      s.workoutDefaults.mu_strength = def; S.setSettings(s);
    }
    localStorage.removeItem('spc_c_day'); localStorage.removeItem('spc_c_sessions'); localStorage.removeItem('spc_c_workout');
  }, { ladderRounds });
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

test('capture round 4 screenshots', async ({ page }) => {
  // 01 — Friday Today: the exercise queue
  await seed(page);
  await page.locator('.queue').waitFor();
  await shot(page, '01-today-queue');

  // 02 — the per-exercise runner (Pistol Squat), mid-exercise
  await page.locator('[data-startday]').first().click();
  await page.locator('.cur-card').waitFor();
  await shot(page, '02-exercise-runner');

  // 03 — exercise completion screen (planned vs actual, X of N, next)
  await runToFinishPanel(page);
  await page.locator('[data-finish],[data-finishex]').first().click();
  await page.getByText('Exercise Complete').waitFor();
  await shot(page, '03-exercise-complete');

  // 04 — a completed exercise shows View + Redo in the queue
  await page.locator('[data-today]').click();
  await page.locator('.q-ex.q-done').first().waitFor();
  await shot(page, '04-queue-completed-view-redo');

  // 05 — flexible ladder: finish panel with Add One Full Round
  await seed(page, 5, 1);
  await page.locator('.q-ex', { hasText: 'Pull-Up Ladder' }).locator('[data-exstart]').click();
  await runToFinishPanel(page);
  await page.locator('.ladder-done').waitFor();
  await shot(page, '05-ladder-add-round');

  // 06 — flexible ladder: fatigue caution after >2 extra rounds
  for (let i = 0; i < 3; i++) { await page.locator('[data-addround]').click(); await runToFinishPanel(page); }
  await page.locator('.ladder-done .caution').waitFor();
  await shot(page, '06-ladder-fatigue-caution');

  // 07 — ladder completion reports planned vs actual rounds (no auto max test)
  await page.locator('[data-finishex]').click();
  await page.getByText('Exercise Complete').waitFor();
  await shot(page, '07-ladder-complete-no-maxtest');

  // 08 — flexible pyramid: Add One Set (Tuesday)
  await seed(page, 2);
  await page.locator('.q-ex', { hasText: 'Pull-Up Pyramid' }).locator('[data-exstart]').click();
  await runToFinishPanel(page);
  await page.locator('.ladder-done').waitFor();
  await shot(page, '08-pyramid-add-set');

  // 09 — daily summary once every required exercise is done
  await seed(page);
  for (const name of ['Pistol Squat', 'Pull-Up Ladder', 'Toes-to-Bar']) {
    await page.locator('.q-ex', { hasText: name }).locator('[data-exstart]').click();
    await runToFinishPanel(page);
    await page.locator('[data-finish],[data-finishex]').first().click();
    await page.locator('[data-today]').click();
  }
  await page.locator('[data-startday]').first().click();
  await page.getByText('All Required Done').waitFor();
  await shot(page, '09-daily-summary');
  await page.locator('[data-finishday]').click();

  // Seed a richer history for the Progress screenshots.
  await seed(page);
  await page.evaluate(() => {
    const S = window.CoachStore.makeStore(); const now = Date.now();
    S.setSessions([
      { id: 'dwA', kind: 'daily', status: 'completed', date: new Date(now - 864e5).toISOString(), weekday: 5, session: 'Home Pull Session',
        exercises: [
          { exId: 'pullup_ladder', type: 'ladder', name: 'Pull-Up Ladder', actualReps: 36, actualRounds: 6, extraRounds: 1, bestReps: 3, plannedText: '1–2–3 × 5 rounds', actualText: '1–2–3 × 6 rounds', difficulty: 'hard', state: 'completed' },
          { exId: 'pistol', type: 'pistol', name: 'Pistol Squat', actualReps: 15, actualText: '15 total reps', state: 'completed' },
          { exId: 't2b', type: 't2b', name: 'Toes-to-Bar', actualReps: 24, actualText: '24 total reps', state: 'completed' } ] },
      { id: 'dwB', kind: 'daily', status: 'completed', date: new Date(now - 3 * 864e5).toISOString(), weekday: 2, session: 'Home Skill Session',
        exercises: [ { exId: 'pullup_pyramid', type: 'pyramid', name: 'Pull-Up Pyramid', actualReps: 18, actualText: 'Pyramid × 5', bestReps: 5, state: 'completed' } ] },
      { id: 'legacyC', kind: 'strength', templateId: 'mu_strength', date: new Date(now - 9 * 864e5).toISOString(), exResults: { pullup: { bestReps: 8 } } }
    ]);
  });
  await page.locator('.nav [data-s="progress"]').click();

  // 10 — Progress: weekly completion summary
  await page.locator('.progress-left').waitFor();
  await shot(page, '10-progress-weekly-summary');

  // 11 — Progress: workout history, one entry expanded with actions
  const item = page.locator('.hist-item', { hasText: 'Home Pull Session' });
  await item.locator('.hist-h').click();
  await item.locator('.hist-body').waitFor();
  await shot(page, '11-progress-history-expanded');

  // 12 — Progress: history filters + a legacy "Standalone workout" entry
  await page.locator('.hist-item', { hasText: 'Standalone workout' }).waitFor();
  await page.locator('.hist-filters').scrollIntoViewIfNeeded();
  await shot(page, '12-progress-history-filters-standalone');
});
