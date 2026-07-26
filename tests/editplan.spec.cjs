// Skill Progression Coach — Weekly Plan editor (genuine plan ownership).
// Frequency 0–7 and any-weekday assignment are user-owned; recommendations are
// guidance (warnings, reset baseline) — never hard limits. Saved edits flow to
// Week / Today / the executable queue / Map / Progress and survive refresh.
const { test, expect } = require('@playwright/test');

const Week = require('../week.js');

// ── pure-module: defaults + migration (Parts 10, 11) ────────────────────────
test.describe('plan model (module)', () => {
  test('01 — Toes-to-Bar defaults to two times per week', () => {
    expect(Week.seedPlan().requirements.t2b.target).toBe(2);
  });
  test('02 — Toes-to-Bar defaults to Tuesday and Friday', () => {
    expect(Week.seedPlan().requirements.t2b.days).toEqual([2, 5]);
    expect(Week.seedPlan().requirements.t2b.recDays).toEqual([2, 5]);
  });
  test('29 — an existing saved plan migrates without resetting user values', () => {
    const old = { version: 4, requirements: {
      t2b: { target: 5, min: 2, max: 2, status: 'required', days: [0, 1, 2, 3, 4], eligible: [2, 5] },
      pistol: { target: 1, status: 'required', days: [3] } // user moved Pistol to Wednesday
    }, dayLog: {}, overrides: {} };
    const m = Week.migratePlan(old);
    expect(m.requirements.t2b.target).toBe(5);           // user frequency kept
    expect(m.requirements.t2b.days).toEqual([0, 1, 2, 3, 4]); // user days kept
    expect(m.requirements.t2b.recDays).toEqual([2, 5]);  // recommendation added
    expect(m.requirements.pistol.days).toEqual([3]);     // user move kept
    expect(m.requirements.pullup_ladder).toBeTruthy();   // new exercises backfilled
    expect(m.version).toBe(Week.PLAN_VERSION);
  });
  test('28 — a one-day Coach adaptation never mutates the permanent plan', () => {
    const p = Week.seedPlan();
    p.requirements.t2b.days = [0, 1, 2, 3, 4, 5, 6];
    p.dayLog[2] = { completed: true };  // Tuesday done → Friday may skip Ring/Hang
    const before = JSON.stringify(p.requirements.t2b.days);
    Week.resolveDay(p, 5, { readiness: { upperFatigue: 3 } });
    expect(JSON.stringify(p.requirements.t2b.days)).toBe(before); // unchanged
  });
});

// ── E2E ─────────────────────────────────────────────────────────────────────
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
async function openEditor(page) {
  await page.locator('.nav [data-s="week"]').click();
  await page.locator('[data-editplan]').click();
}
const row = (page, name) => page.locator('.ep-row', { hasText: name });
async function setTarget(page, name, to) {
  const cur = parseInt((await row(page, name).locator('.ep-target span').textContent()).trim(), 10);
  const btn = to > cur ? '[data-eptarget="1"]' : '[data-eptarget="-1"]';
  for (let i = 0; i < Math.abs(to - cur); i++) await row(page, name).locator(btn).click();
}
async function assignExactly(page, name, days) {
  for (let d = 0; d < 7; d++) {
    const chip = row(page, name).locator('[data-epday="' + d + '"]');
    const on = await chip.evaluate(el => el.classList.contains('on'));
    const want = days.indexOf(d) >= 0;
    if (on !== want) await chip.click();
  }
}

test.describe('frequency + day editing', () => {
  test('03 — the user can change Toes-to-Bar to seven times per week', async ({ page }) => {
    await seed(page); await openEditor(page);
    await setTarget(page, 'Toes-to-Bar', 7);
    await expect(row(page, 'Toes-to-Bar')).toContainText('Your plan: 7×');
  });
  test('04 — the user can assign Toes-to-Bar to all seven days', async ({ page }) => {
    await seed(page); await openEditor(page);
    await assignExactly(page, 'Toes-to-Bar', [0, 1, 2, 3, 4, 5, 6]);
    await expect(row(page, 'Toes-to-Bar')).toContainText('every day');
  });
  test('05 — a saved seven-day plan survives a refresh', async ({ page }) => {
    await seed(page); await openEditor(page);
    await setTarget(page, 'Toes-to-Bar', 7);
    await assignExactly(page, 'Toes-to-Bar', [0, 1, 2, 3, 4, 5, 6]);
    await page.locator('[data-epsave]').click();
    await page.reload();
    const t = await page.evaluate(() => window.CoachStore.makeStore().getPlan().requirements.t2b);
    expect(t.target).toBe(7);
    expect(t.days).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
  test('06 — the user can assign Toes-to-Bar to different days', async ({ page }) => {
    await seed(page); await openEditor(page);
    await assignExactly(page, 'Toes-to-Bar', [1, 4]); // Monday + Thursday
    await expect(row(page, 'Toes-to-Bar')).toContainText('Mon, Thu');
  });
  test('07 — recommended days stay visible as guidance', async ({ page }) => {
    await seed(page); await openEditor(page);
    await expect(row(page, 'Toes-to-Bar')).toContainText('Recommended: 2× — Tue, Fri');
    expect(await row(page, 'Toes-to-Bar').locator('.ep-chip.rec').count()).toBe(2);
  });
  test('16 — an optional exercise may have a zero weekly target', async ({ page }) => {
    await seed(page); await openEditor(page);
    await setTarget(page, 'Ring Support Hold', 0);
    await expect(row(page, 'Ring Support Hold')).toContainText('Your plan: 0×');
    await page.locator('[data-epsave]').click();
    const rs = await page.evaluate(() => window.CoachStore.makeStore().getPlan().requirements.ringsupport.target);
    expect(rs).toBe(0);
  });
  test('17 — target frequency and assigned-day count are shown separately', async ({ page }) => {
    await seed(page); await openEditor(page);
    await expect(row(page, 'Toes-to-Bar')).toContainText('Your plan: 2×');
    await expect(row(page, 'Toes-to-Bar')).toContainText('2 of 2 assigned');
  });
});

test.describe('warnings are non-blocking', () => {
  test('08 — recommended maximum does not hard-block saving seven per week', async ({ page }) => {
    await seed(page); await openEditor(page);
    await setTarget(page, 'Toes-to-Bar', 7);
    await page.locator('[data-epsave]').click();
    const t = await page.evaluate(() => window.CoachStore.makeStore().getPlan().requirements.t2b.target);
    expect(t).toBe(7); // saved despite exceeding the recommended max
  });
  test('09 — above-recommendation frequency produces a warning', async ({ page }) => {
    await seed(page); await openEditor(page);
    await setTarget(page, 'Toes-to-Bar', 5);
    await expect(row(page, 'Toes-to-Bar').locator('.ep-warns')).toContainText(/above the recommended frequency/i);
  });
  test('10 — the warning lets the user keep the selection', async ({ page }) => {
    await seed(page); await openEditor(page);
    await setTarget(page, 'Toes-to-Bar', 5);
    await row(page, 'Toes-to-Bar').locator('[data-epkeep]').click();
    await expect(row(page, 'Toes-to-Bar').locator('.ep-warns.acked')).toBeVisible();
    await page.locator('[data-epsave]').click();
    const t = await page.evaluate(() => window.CoachStore.makeStore().getPlan().requirements.t2b.target);
    expect(t).toBe(5);
  });
  test('11 — below-recommendation frequency is guidance, not an error', async ({ page }) => {
    await seed(page); await openEditor(page);
    await setTarget(page, 'Toes-to-Bar', 1);
    await expect(row(page, 'Toes-to-Bar').locator('.ep-warns')).toContainText(/below the recommended frequency/i);
    await page.locator('[data-epsave]').click();  // still saveable
    const t = await page.evaluate(() => window.CoachStore.makeStore().getPlan().requirements.t2b.target);
    expect(t).toBe(1);
  });
  test('12 — High Pull can be moved away from Monday, and 13 — the move shows the equipment rationale', async ({ page }) => {
    await seed(page); await openEditor(page);
    await assignExactly(page, 'High Pull', [4]); // Thursday only
    await expect(row(page, 'High Pull').locator('.ep-warns')).toContainText(/gym equipment/i);
    await page.locator('[data-epsave]').click();
    const hp = await page.evaluate(() => window.CoachStore.makeStore().getPlan().requirements.highpull.days);
    expect(hp).toEqual([4]);
  });
  test('14 — Pistol Squat can be assigned to another day', async ({ page }) => {
    await seed(page); await openEditor(page);
    await assignExactly(page, 'Pistol Squat', [1]); // Monday
    await page.locator('[data-epsave]').click();
    const d = await page.evaluate(() => window.CoachStore.makeStore().getPlan().requirements.pistol.days);
    expect(d).toEqual([1]);
  });
  test('15 — Pull-Up Ladder can be assigned to another day', async ({ page }) => {
    await seed(page); await openEditor(page);
    await assignExactly(page, 'Pull-Up Ladder', [3]); // Wednesday
    await page.locator('[data-epsave]').click();
    const d = await page.evaluate(() => window.CoachStore.makeStore().getPlan().requirements.pullup_ladder.days);
    expect(d).toEqual([3]);
  });
  test('18 — under-assignment is shown but does not block saving', async ({ page }) => {
    await seed(page); await openEditor(page);
    await setTarget(page, 'Toes-to-Bar', 7);            // target 7, still 2 days assigned
    await expect(row(page, 'Toes-to-Bar')).toContainText('2 of 7 occurrences assigned');
    await page.locator('[data-epsave]').click();
    expect(await page.evaluate(() => window.CoachStore.makeStore().getPlan().requirements.t2b.target)).toBe(7);
  });
  test('19 — over-assignment is shown but does not block saving', async ({ page }) => {
    await seed(page); await openEditor(page);
    await assignExactly(page, 'Toes-to-Bar', [1, 2, 5]); // 3 days for a target of 2
    await expect(row(page, 'Toes-to-Bar')).toContainText('3 assigned days for a target of 2');
    await page.locator('[data-epsave]').click();
    expect(await page.evaluate(() => window.CoachStore.makeStore().getPlan().requirements.t2b.days.length)).toBe(3);
  });
});

test.describe('save / cancel / reset', () => {
  test('20 — Cancel discards unsaved changes', async ({ page }) => {
    await seed(page); await openEditor(page);
    await setTarget(page, 'Toes-to-Bar', 7);
    await page.locator('[data-epcancel]').click();
    const t = await page.evaluate(() => window.CoachStore.makeStore().getPlan().requirements.t2b.target);
    expect(t).toBe(2); // unchanged
  });
  test('21 — Reset This Exercise restores its recommendation', async ({ page }) => {
    await seed(page); await openEditor(page);
    await setTarget(page, 'Toes-to-Bar', 7);
    await assignExactly(page, 'Toes-to-Bar', [0, 1, 2, 3, 4, 5, 6]);
    page.once('dialog', d => d.accept());
    await row(page, 'Toes-to-Bar').locator('[data-epreset1]').click();
    await expect(row(page, 'Toes-to-Bar')).toContainText('Your plan: 2×');
    await expect(row(page, 'Toes-to-Bar')).toContainText('Tue, Fri');
  });
  test('22 — Reset Entire Plan restores the approved plan (with confirm)', async ({ page }) => {
    await seed(page); await openEditor(page);
    await setTarget(page, 'Toes-to-Bar', 7);
    page.once('dialog', d => d.accept());
    await page.locator('[data-epreset]').click();
    await expect(row(page, 'Toes-to-Bar')).toContainText('Your plan: 2×');
  });
});

test.describe('propagation after saving', () => {
  async function saveT2bAllDays(page) {
    await openEditor(page);
    await setTarget(page, 'Toes-to-Bar', 7);
    await assignExactly(page, 'Toes-to-Bar', [0, 1, 2, 3, 4, 5, 6]);
    await page.locator('[data-epsave]').click();
  }
  test('23 — Week reflects the saved days', async ({ page }) => {
    await seed(page); await saveT2bAllDays(page);
    // Monday's day detail now lists Toes-to-Bar (a newly-assigned day).
    await page.locator('.nav [data-s="week"]').click();
    await page.locator('.wd-card', { hasText: 'Monday' }).click();
    await expect(page.locator('.sheet')).toContainText('Toes-to-Bar');
  });
  test('24 + 25 — Today and the executable queue include the newly-assigned exercise', async ({ page }) => {
    await seed(page, 1);                 // Monday (a strength day)
    await saveT2bAllDays(page);
    await page.locator('.nav [data-s="today"]').click();
    await expect(page.locator('.q-ex', { hasText: 'Toes-to-Bar' })).toBeVisible();
    await expect(page.locator('.q-ex', { hasText: 'Toes-to-Bar' }).locator('[data-exstart]')).toBeVisible();
  });
  test('26 — the Map "in your weekly plan" reflects the saved days', async ({ page }) => {
    await seed(page); await saveT2bAllDays(page);
    await page.locator('.nav [data-s="today"]').click();
    await page.locator('.q-ex .q-name', { hasText: 'Toes-to-Bar' }).click();
    await expect(page.locator('.sheet')).toContainText('In your weekly plan');
    await expect(page.locator('.sheet')).toContainText('Monday'); // a non-default day now present
  });
  test('27 — Progress denominators use the edited weekly target', async ({ page }) => {
    await seed(page); await saveT2bAllDays(page);
    await page.locator('.nav [data-s="progress"]').click();
    await expect(page.locator('.sum-row', { hasText: 'Toes-to-Bar' })).toContainText('/ 7');
  });
});
