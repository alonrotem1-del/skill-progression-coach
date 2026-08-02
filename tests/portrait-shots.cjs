// Portrait-restoration manual validation screenshots (Section 15). Saves PNGs
// into screenshots/portrait/. Run via a temporary *.spec.cjs copy.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'screenshots', 'portrait');
fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });

async function seed(page, dayId = 5) {
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

test.describe('portrait screenshots @ 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('1 — Today', async ({ page }) => {
    await seed(page);
    await shot(page, '01-today');
  });

  test('2 — Week', async ({ page }) => {
    await seed(page);
    await page.locator('.nav [data-s="week"]').click();
    await shot(page, '02-week');
  });

  test('3/14 — Edit Plan (with a warning)', async ({ page }) => {
    await seed(page);
    await page.locator('.nav [data-s="week"]').click();
    await page.locator('[data-editplan]').click();
    await page.locator('[data-eptarget="1"][data-ex="t2b"]').click({ clickCount: 5 }); // push above recommended -> warning
    await shot(page, '03-14-edit-plan-warning');
  });

  test('4/5 — Skill Map overview + node detail', async ({ page }) => {
    await seed(page);
    await page.locator('.nav [data-s="map"]').click();
    await shot(page, '04-map-overview');
    await page.locator('.node.current').click({ force: true });
    await shot(page, '05-node-detail');
  });

  test('6/7 — Progress + History', async ({ page }) => {
    await seed(page);
    await page.locator('.nav [data-s="progress"]').click();
    await shot(page, '06-progress');
    await page.mouse.wheel(0, 900);
    await shot(page, '07-history');
  });

  test('8/9 — Ladder active round + rest before an added round', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startone]').click();
    await page.locator('[data-pick="pullup_ladder"]').click();
    if (await page.locator('text=How should this workout count?').count()) await page.locator('[data-cl="extra"]').click();
    await expect(page.locator('.cur-card')).toBeVisible();
    await shot(page, '08-ladder-active-round');
    for (let i = 0; i < 5; i++) await completeRound(page);
    await page.locator('[data-addround]').click();
    await shot(page, '09-rest-before-added-round');
  });

  test('10/11 — Timed Hold prep + active countdown', async ({ page }) => {
    await page.clock.install();
    await seed(page);
    await page.locator('[data-startone]').click();
    await page.locator('[data-pick="deadhang"]').click();
    if (await page.locator('text=How should this workout count?').count()) await page.locator('[data-cl="extra"]').click();
    await page.locator('[data-holdstart]').click();
    await shot(page, '10-hold-prep-countdown');
    await page.clock.runFor(5200);
    await shot(page, '11-hold-active-countdown');
  });

  test('12 — Daily Workout Queue with climbing and an assigned exercise', async ({ page }) => {
    await seed(page, 0); // Sunday = climbing day
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore(); const p = S.getPlan();
      p.requirements.t2b.days = [0, 2, 5]; p.requirements.t2b.target = 3; S.setPlan(p);
    });
    await page.reload();
    await shot(page, '12-daily-queue-climbing-plus-exercise');
  });

  test('13 — Group Workout day with an assigned exercise', async ({ page }) => {
    await seed(page, 3); // Wednesday = group day
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore(); const p = S.getPlan();
      p.requirements.pistol.days = [3]; p.requirements.pistol.target = 2; S.setPlan(p);
    });
    await page.reload();
    await shot(page, '13-group-day-plus-exercise');
  });

  test('15 — exercise-completion summary', async ({ page }) => {
    await page.clock.install();
    await seed(page);
    await page.locator('[data-startone]').click();
    await page.locator('[data-pick="deadhang"]').click();
    if (await page.locator('text=How should this workout count?').count()) await page.locator('[data-cl="extra"]').click();
    for (let i = 0; i < 3; i++) {
      await page.locator('[data-holdstart]').click();
      await page.clock.runFor(5200); await page.clock.runFor(30200);
      await page.locator('[data-holdconfirm]').click();
      if (await page.locator('[data-diff="appropriate"]').count()) await page.locator('[data-diff="appropriate"]').click();
      if (await page.locator('[data-tskip]').count()) await page.locator('[data-tskip]').click();
    }
    await page.locator('[data-finish], [data-finishex]').click();
    await expect(page.getByText('Dead Hang completed')).toBeVisible();
    await shot(page, '15-exercise-completion-summary');
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('centered constrained app', async ({ page }) => {
    await seed(page);
    await shot(page, '16-desktop-centered');
  });
});
