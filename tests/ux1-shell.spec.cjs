// UX-1 — app shell + visual system.
// Today = Coach, Goals = Progress, Settings = Control. These tests pin the new
// shell, the routes that moved behind the gear, the fixes that came with it,
// and the local-date key.
const { test, expect } = require('@playwright/test');

async function seed(page, dayId) {
  if (dayId !== undefined) await page.addInitScript((d) => { window.__spcTodayId = d; }, dayId);
  await page.goto('index.html');
  await page.evaluate(() => {
    const S = window.CoachStore.makeStore(), D = window.CoachData, E = window.CoachEngine;
    const bench = { pullup_max: 9, dips_max: 6, ring_support_secs: 14 }; const state = {};
    D.worlds.forEach((w) => {
      const nodes = window.CoachStore.seedStates(w, bench);
      const f = E.autoFocus(w, nodes);
      state[w.id] = { nodes, focus: { primary: f.primary, supporting: f.supporting, manual: false } };
    });
    S.setBench(bench); S.setState(state);
    S.setProfile({ onboarded: true, activeWorld: 'muscleup', days: [0, 2, 4], duration: 'normal' });
    ['spc_c_day', 'spc_c_workout', 'spc_c_adhoc', 'spc_c_plan', 'spc_c_templates']
      .forEach((k) => localStorage.removeItem(k));
  });
  await page.reload();
}

test.describe('UX-1 shell', () => {
  test('01 the date and the gear sit on Today and Goals, and only there', async ({ page }) => {
    await seed(page);
    await expect(page.locator('.topbar .tb-date')).toBeVisible();
    await expect(page.locator('.topbar [data-settings]')).toBeVisible();
    await page.locator('.nav [data-s="goals"]').click();
    await expect(page.locator('.topbar [data-settings]')).toBeVisible();
    await page.locator('[data-settings]').click();
    expect(await page.locator('.topbar').count()).toBe(0);
    await page.locator('[data-sgo="plan"]').click();
    expect(await page.locator('.topbar').count()).toBe(0);
  });

  test('02 every screen behind the gear has a way back to Settings', async ({ page }) => {
    await seed(page);
    for (const row of ['[data-sgo="plan"]', '[data-sgo="history"]']) {
      await page.locator('[data-settings]').click();
      await page.locator(row).click();
      await page.locator('[data-tosettings]').click();
      await expect(page.locator('[data-sgo="plan"]')).toBeVisible();
      await page.locator('[data-sclose]').click();
      await expect(page.locator('.topbar')).toBeVisible();
    }
  });

  test('03 the legacy goal-world picker is no longer shown', async ({ page }) => {
    await seed(page);
    await page.locator('[data-settings]').click();
    await page.locator('[data-sview="goals"]').click();
    const t = await page.locator('#app').innerText();
    expect(t).not.toContain('Bar Muscle-Up');
    expect(await page.locator('[data-world]').count()).toBe(0);
    await expect(page.locator('#days .pill').first()).toBeVisible();
  });

  test('04 acting on a day from This Week stays on This Week', async ({ page }) => {
    await seed(page, 2);
    await page.locator('[data-settings]').click();
    await page.locator('[data-sgo="plan"]').click();
    await page.locator('[data-daydetail="2"]').first().click();
    const mark = page.locator('.sheet [data-markdone]');
    if (await mark.count()) {
      await mark.first().click();
      // the old screen check compared against 'week' while the state held
      // 'plan', so this used to jump to Today
      await expect(page.locator('.week-grid')).toBeVisible();
      expect(await page.evaluate(() => window.CoachApp._UI.screen)).toBe('plan');
    }
  });

  test('05 the old names still route: week -> This Week, profile -> Settings', async ({ page }) => {
    await seed(page);
    await page.evaluate(() => window.CoachApp._goto('week'));
    expect(await page.evaluate(() => window.CoachApp._UI.screen)).toBe('plan');
    await page.evaluate(() => window.CoachApp._goto('profile'));
    expect(await page.evaluate(() => window.CoachApp._UI.screen)).toBe('settings');
  });

  test('06 the workout summary no longer offers the archived Map', async ({ page }) => {
    await seed(page);
    const src = await page.evaluate(() => fetch('app.js').then((r) => r.text()));
    expect(src).not.toContain('data-map>View Map');
  });
});

test.describe('UX-1 visual system', () => {
  test('07 Quiet Paper tokens are in force: paper background, ink text, clay primary', async ({ page }) => {
    await seed(page);
    const c = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      const btn = document.querySelector('.btn.primary');
      return { bg: cs.backgroundColor, ink: cs.color, primary: btn ? getComputedStyle(btn).backgroundImage + '|' + getComputedStyle(btn).backgroundColor : null };
    });
    expect(c.bg).toBe('rgb(245, 240, 230)');
    expect(c.ink).toBe('rgb(31, 27, 22)');
    if (c.primary) expect(c.primary).toBe('none|rgb(180, 85, 45)'); // flat clay, no gradient
  });
});

test.describe('UX-1 local date key', () => {
  test('08 the daily key is the LOCAL calendar date, matching the local weekday', async ({ page }) => {
    await page.goto('index.html');
    const r = await page.evaluate(() => {
      const late = new Date(2026, 9, 14, 0, 30);   // 00:30 local on 14 Oct
      const early = new Date(2026, 9, 13, 23, 45); // 23:45 local on 13 Oct
      return [window.CoachDaily.dateKey(late), window.CoachDaily.dateKey(early)];
    });
    expect(r).toEqual(['2026-10-14', '2026-10-13']);
  });
});
