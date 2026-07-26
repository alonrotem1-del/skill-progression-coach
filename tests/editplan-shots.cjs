// Weekly Plan editor screenshot capture. Run via a temporary *.spec.cjs copy.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'screenshots', 'editplan');
fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });
test.use({ viewport: { width: 900, height: 412 } });

async function seed(page, dayId = 5) {
  await page.addInitScript((d) => { window.__spcTodayId = d; }, dayId);
  await page.goto('index.html');
  await page.evaluate(() => {
    const S = window.CoachStore.makeStore(), D = window.CoachData, E = window.CoachEngine;
    const bench = { pullup_max: 9, dips_max: 6 }; const state = {};
    D.worlds.forEach(w => { const nodes = window.CoachStore.seedStates(w, bench); const f = E.autoFocus(w, nodes); state[w.id] = { nodes, focus: { primary: f.primary, supporting: f.supporting, manual: false } }; });
    S.setBench(bench); S.setState(state);
    S.setProfile({ onboarded: true, activeWorld: 'muscleup', days: [0, 2, 4], duration: 'normal' });
    ['spc_c_day', 'spc_c_sessions', 'spc_c_workout', 'spc_c_adhoc', 'spc_c_plan'].forEach(k => localStorage.removeItem(k));
  });
  await page.reload();
}
const row = (page, name) => page.locator('.ep-row', { hasText: name });
async function openEditor(page) { await page.locator('.nav [data-s="week"]').click(); await page.locator('[data-editplan]').click(); }
async function setTarget(page, name, to) {
  const cur = parseInt((await row(page, name).locator('.ep-target span').textContent()).trim(), 10);
  const btn = to > cur ? '[data-eptarget="1"]' : '[data-eptarget="-1"]';
  for (let i = 0; i < Math.abs(to - cur); i++) await row(page, name).locator(btn).click();
}
async function assignExactly(page, name, days) {
  for (let d = 0; d < 7; d++) {
    const chip = row(page, name).locator('[data-epday="' + d + '"]');
    const on = await chip.evaluate(el => el.classList.contains('on'));
    if (on !== (days.indexOf(d) >= 0)) await chip.click();
  }
}

test('capture edit-plan screenshots', async ({ page }) => {
  await seed(page); await openEditor(page);
  // 01 — Toes-to-Bar default recommendation
  await row(page, 'Toes-to-Bar').scrollIntoViewIfNeeded();
  await shot(page, '01-t2b-default-recommendation');

  // 02 — frequency changed to seven
  await setTarget(page, 'Toes-to-Bar', 7);
  await shot(page, '02-frequency-seven');

  // 03 — all weekdays selected
  await assignExactly(page, 'Toes-to-Bar', [0, 1, 2, 3, 4, 5, 6]);
  await shot(page, '03-all-weekdays');

  // 04 — non-blocking warning
  await expect(row(page, 'Toes-to-Bar').locator('.ep-warns')).toBeVisible();
  await shot(page, '04-nonblocking-warning');

  // 10 — reset controls (Reset This Exercise + Reset to Approved), confirm-gated
  await shot(page, '10-reset-controls');

  await page.locator('[data-epkeep]').first().click();
  await page.locator('[data-epsave]').click();

  // 05 — saved Week view
  await page.locator('.nav [data-s="week"]').click();
  await shot(page, '05-week-after-save');

  // 06 — Today after editing (Friday queue still includes T2B)
  await page.locator('.nav [data-s="today"]').click();
  await page.locator('.q-ex', { hasText: 'Toes-to-Bar' }).first().scrollIntoViewIfNeeded();
  await shot(page, '06-today-after-edit');

  // 07 — Map "in your weekly plan" after editing (all 7 days)
  await page.locator('.q-ex .q-name', { hasText: 'Toes-to-Bar' }).click();
  await page.locator('.sheet').waitFor();
  await shot(page, '07-map-weekly-connection');
  await page.locator('.sheet [data-close], .sheet').first().press('Escape').catch(() => {});
  await page.mouse.click(5, 200); // dismiss sheet

  // 08 — Progress denominator of seven
  await page.locator('.nav [data-s="progress"]').click();
  await page.locator('.sum-row', { hasText: 'Toes-to-Bar' }).scrollIntoViewIfNeeded();
  await shot(page, '08-progress-denominator-seven');

  // 09 — High Pull moved away from Monday (Thursday), showing the rationale
  await seed(page); await openEditor(page);
  await assignExactly(page, 'High Pull', [4]);
  await row(page, 'High Pull').scrollIntoViewIfNeeded();
  await shot(page, '09-highpull-moved');
});
