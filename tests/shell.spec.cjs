// The new shell (APP-BLUEPRINT, implementation slice 1): Today | Plan | Goals,
// the gear, the athlete's week plan, and the existing engine underneath —
// runner, records, Foundation, History, backup, offline. Needs the locally
// built program package (private/, git-ignored course content); skips
// without it. The date is fixed, so the week is the same on every run.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PKG_FILE = path.join(__dirname, '..', 'private', 'beginner-program.json');
const HAVE = fs.existsSync(PKG_FILE);
const pkg = HAVE ? JSON.parse(fs.readFileSync(PKG_FILE, 'utf8')) : null;
test.skip(!HAVE, 'program package not built on this machine');

// Sunday 8 November 2026, 10:00 local time; the athlete trains Sun, Tue, Thu, Sat.
const SUNDAY = new Date(2026, 10, 8, 10, 0, 0);
const day = (n, hh) => new Date(2026, 10, 8 + n, hh || 10, 0, 0);
const DAYS = [0, 2, 4, 6];

async function athlete(page, opts) {
  opts = opts || {};
  await page.clock.setFixedTime(opts.at || SUNDAY);
  await page.goto('index.html');
  await page.evaluate((days) => {
    localStorage.clear();
    localStorage.setItem('spc_c_profile', JSON.stringify({ onboarded: true, activeWorld: 'muscleup', days, duration: 'normal' }));
  }, opts.days || DAYS);
  await page.reload();
  await expect(page.locator('[data-tab="today"] .t-name')).toBeVisible({ timeout: 15000 });
}
async function at(page, when) { await page.clock.setFixedTime(when); await page.reload(); await expect(page.locator('.qp-screen, .fp-runcard').first()).toBeVisible({ timeout: 15000 }); }
async function tab(page, name) { await page.locator('.nav [data-s="' + name + '"]').click(); await expect(page.locator('[data-tab="' + name + '"]')).toBeVisible(); }
const store = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
const rowText = (page, date) => page.locator('.pl-day[data-day="' + date + '"], .pl-day[data-dayact="' + date + '"]').innerText();

test.describe('the shell', () => {
  test('01 Today on a training day: the date, "Today", the session, one action, one link — nothing else', async ({ page }) => {
    await athlete(page);
    const scr = page.locator('[data-tab="today"]');
    await expect(scr.locator('.qp-date')).toHaveText('Sunday, 8 Nov');
    await expect(scr.locator('.t-today')).toHaveText('Today');
    await expect(scr.locator('[data-today="session"] .t-name')).toHaveText('Push & Pull');
    await expect(scr.locator('.qp-primary')).toHaveCount(1);
    await expect(scr.locator('.qp-primary')).toHaveText('Start workout');
    await expect(scr.locator('[data-viewpw]')).toHaveText('View workout');
    const text = await scr.innerText();
    for (const absent of ['Phase', 'Week 4', 'of 4', 'Ring Muscle-Up', 'Foundation', 'Readiness', 'sets', 'reps']) expect(text, absent).not.toContain(absent);
    expect(await scr.locator('.fp-chip, .badge, .vw-block, .fp-li, img, svg:not(.gear svg)').count()).toBe(0);
    expect(await page.locator('.nav button').allTextContents()).toEqual(['Today', 'Plan', 'Goals']);
    // the earlier vocabulary is gone from the athlete's view
    for (const t of ['today', 'plan', 'goals']) { await tab(page, t); expect(await page.locator('#app').innerText()).not.toMatch(/Academy|the Path|Foundation Exit/); }
  });

  test('02 View workout is a light sheet of the real prescription; START WORKOUT opens the existing runner on it', async ({ page }) => {
    await athlete(page);
    await page.locator('[data-viewpw]').click();
    const sheet = page.locator('.sheet');
    await expect(sheet.locator('.sh-title')).toHaveText('Push & Pull');
    await expect(sheet.locator('.vw-block')).toHaveCount(pkg.workouts['P4W4-1'].blocks.length);
    await expect(sheet).toContainText('From the program');
    await sheet.locator('[data-close]').click();
    await page.locator('[data-startpw]').click();
    await expect(page.locator('.fp-runcard')).toBeVisible();
    const b = pkg.workouts['P4W4-1'].blocks[0];
    await expect(page.locator('.fp-runcard h2')).toHaveText(b.kind === 'emom' && b.style === 'single' ? b.exercise : b.easy);
    expect((await store(page, 'spc_c_programrun')).workoutId).toBe('P4W4-1');
    await expect(page.locator('.nav')).toHaveCount(0);                     // the runner is a mode: no tab bar
  });

  test('03 a workout in progress stays resumable: Today says so, every other tab shows the bar, a reload goes straight back', async ({ page }) => {
    await athlete(page);
    await page.locator('[data-startpw]').click();
    await page.locator('[data-inc="s0"]').click();
    await page.locator('[data-setdone="0"]').click();
    await page.locator('[data-exitrun]').click();
    await expect(page.locator('[data-today="progress"] .t-name')).toHaveText('Push & Pull');
    await expect(page.locator('[data-today="progress"]')).toContainText('In progress');
    await expect(page.locator('.qp-primary')).toHaveText('Resume');
    await expect(page.locator('.qp-rbar')).toHaveCount(0);                 // Today already says it
    for (const t of ['plan', 'goals']) { await tab(page, t); await expect(page.locator('.qp-rbar')).toContainText('Workout in progress · Push & Pull'); }
    await page.locator('.qp-rbar').click();
    await expect(page.locator('.fp-set').first()).toContainText('in range');
    await page.reload();
    await expect(page.locator('.fp-runcard')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.fp-set.done')).toHaveCount(1);
  });

  test('04 after the workout, Today says it is done, what is next, and where the results are; the record is the usual one', async ({ page }) => {
    await athlete(page);
    page.on('dialog', (d) => d.accept());
    await page.locator('[data-startpw]').click();
    await page.locator('[data-inc="s0"]').click();
    await page.locator('[data-setdone="0"]').click();
    for (let i = 1; i < pkg.workouts['P4W4-1'].blocks.length; i++) await page.locator('[data-next]').click();
    await page.locator('[data-finishrun]').click();
    await expect(page.locator('.scr')).toContainText('Workout saved');
    await expect(page.locator('.scr')).toContainText('Next: Tuesday · Push');
    await page.locator('[data-backpath]').click();
    const t = page.locator('[data-today="done"]');
    await expect(t.locator('.t-name')).toHaveText('✓ Push & Pull — done');
    await expect(t).toContainText('Next: Tuesday · Push');
    await expect(t.locator('.qp-primary')).toHaveCount(0);
    await t.locator('[data-results]').click();
    await expect(page.locator('.sheet')).toContainText('Push & Pull');
    await expect(page.locator('.sheet [data-histdel]')).toHaveCount(1);
    // the completion record, exactly as before the new shell
    const evs = (await store(page, 'spc_c_program')).events.filter((e) => e.type === 'workout_completed' && e.source === 'app');
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ workoutId: 'P4W4-1', prescription: { phase: 4, week: 4, title: pkg.workouts['P4W4-1'].title } });
    expect(evs[0].result).toHaveLength(pkg.workouts['P4W4-1'].blocks.length);
    expect(evs[0].summary.blocks).toHaveLength(pkg.workouts['P4W4-1'].blocks.length);
    expect(await store(page, 'spc_c_programrun')).toBe(null);
    // and the week plan holds only plan events — never a copy of the record
    const plan = await store(page, 'spc_c_weekplan');
    expect(plan === null || plan.events.every((e) => /^(week_|placement_|day_)/.test(e.type))).toBe(true);
    await page.locator('.sheet [data-close]').click();
    await tab(page, 'plan');
    expect(await rowText(page, '2026-11-08')).toContain('✓');
  });

  test('05 Plan shows the week Sunday to Saturday: placed sessions, today, Not placed, the position, what comes next', async ({ page }) => {
    await athlete(page);
    await tab(page, 'plan');
    await expect(page.locator('.pl-pos')).toHaveText('Phase 4 · Week 4 · 0 of 4 done');
    await expect(page.locator('.pl-kicker')).toHaveText('Proposed week');
    const days = page.locator('.pl-day');
    await expect(days).toHaveCount(7);
    expect(await days.evaluateAll((els) => els.map((e) => e.querySelector('.pl-dw').textContent + ' ' + e.querySelector('.pl-dn').textContent)))
      .toEqual(['Sun 8', 'Mon 9', 'Tue 10', 'Wed 11', 'Thu 12', 'Fri 13', 'Sat 14']);
    await expect(page.locator('.pl-day.is-today')).toHaveAttribute('data-day', '2026-11-08');
    expect(await rowText(page, '2026-11-08')).toMatch(/Push & Pull\s*today/);
    expect(await rowText(page, '2026-11-10')).toContain('Push');
    expect(await rowText(page, '2026-11-12')).toContain('Pull');
    expect(await rowText(page, '2026-11-14')).toContain('Core & Stability');
    expect(await rowText(page, '2026-11-09')).toContain('—');
    expect(await page.locator('.pl-trow .pl-tname').allTextContents()).toEqual(['Legs · optional']);
    expect(await page.locator('.pl-nrow').allInnerTexts()).toEqual(['Max Test\nafter this week’s 4 workouts', 'Phase 5\nstarts with a recovery week']);
    await expect(page.locator('.pl-week .vw-block, .pl-week .fp-li')).toHaveCount(0);     // no exercise lists in the week
    await page.locator('[data-program]').click();
    await expect(page.locator('[data-node="P4W4"]')).toContainText('you are here');
    await page.locator('[data-backplan]').click();
    await expect(page.locator('[data-tab="plan"]')).toBeVisible();
  });

  test('06 an accepted week is stored as shown and holds across a reload', async ({ page }) => {
    await athlete(page);
    await tab(page, 'plan');
    const before = await page.locator('.pl-week').innerText();
    await page.locator('[data-acceptweek]').click();
    await expect(page.locator('[data-acceptweek]')).toHaveCount(0);
    await expect(page.locator('.pl-kicker')).toHaveCount(0);
    const plan = await store(page, 'spc_c_weekplan');
    expect(plan.events.map((e) => e.type)).toEqual(['week_proposed', 'week_accepted']);
    expect(plan.events[0].placements).toEqual([
      { date: '2026-11-08', item: 'P4W4-1' }, { date: '2026-11-10', item: 'P4W4-2' },
      { date: '2026-11-12', item: 'P4W4-3' }, { date: '2026-11-14', item: 'P4W4-4' }]);
    await page.reload();
    await tab(page, 'plan');
    await expect(page.locator('[data-acceptweek]')).toHaveCount(0);
    expect(await page.locator('.pl-week').innerText()).toBe(before);
  });

  test('07 changing a day is explicit: Edit, the day, Move; the row says where it came from; onto a busy day it offers a swap', async ({ page }) => {
    await athlete(page);
    await tab(page, 'plan');
    await page.locator('[data-acceptweek]').click();
    await page.locator('[data-planedit]').first().click();
    await page.locator('[data-dayact="2026-11-12"]').click();               // Thursday · Pull
    await expect(page.locator('.sheet .sh-title')).toHaveText('Thursday 12 · Pull');
    await page.locator('.sheet [data-act="move"]').click();
    await page.locator('.sheet [data-pickday]', { hasText: 'Friday 13' }).click();
    expect(await rowText(page, '2026-11-12')).not.toContain('Pull');
    expect(await rowText(page, '2026-11-13')).toContain('moved from Thu');
    let plan = await store(page, 'spc_c_weekplan');
    expect(plan.events.pop()).toMatchObject({ type: 'placement_changed', weekStart: '2026-11-08', item: 'P4W4-3', from: '2026-11-12', to: '2026-11-13', reason: 'athlete' });
    // onto a day that already has a session: a swap, never two sessions stacked
    await page.locator('[data-dayact="2026-11-10"]').click();               // Tuesday · Push
    await page.locator('.sheet [data-act="move"]').click();
    await page.locator('.sheet [data-pickday]', { hasText: 'Saturday 14' }).click();
    await expect(page.locator('.sheet .sh-title')).toHaveText('Saturday has Core & Stability');
    await page.locator('.sheet [data-swapok]').click();
    expect(await rowText(page, '2026-11-10')).toContain('Core & Stability');
    expect(await rowText(page, '2026-11-14')).toContain('Push');
    plan = await store(page, 'spc_c_weekplan');
    expect(plan.events.slice(-2).map((e) => e.item + ':' + e.from + '>' + e.to)).toEqual(['P4W4-2:2026-11-10>2026-11-14', 'P4W4-4:2026-11-14>2026-11-10']);
    await page.locator('[data-planedit]').first().click();                  // Done
    await expect(page.locator('[data-planedit]').first()).toHaveText('Edit');
  });

  test('08 nothing moves by itself: new training days leave the accepted week alone, and a missed day stays missed', async ({ page }) => {
    await athlete(page);
    await tab(page, 'plan');
    await page.locator('[data-acceptweek]').click();
    const planBefore = JSON.stringify(await store(page, 'spc_c_weekplan'));
    const weekBefore = await page.locator('.pl-week').innerText();
    // the usual training days change
    await page.locator('[data-tab="plan"] [data-settings]').click();
    await page.locator('[data-sview="days"]').click();
    await page.locator('[data-tday="1"]').click();
    await page.locator('[data-tday="0"]').click();
    await expect(page.locator('[data-tday="1"]')).toHaveAttribute('aria-pressed', 'true');
    await tab(page, 'plan');
    expect(await page.locator('.pl-week').innerText()).toBe(weekBefore);
    // Wednesday: Sunday's and Tuesday's sessions were not done
    await at(page, day(3));
    await expect(page.locator('[data-today="missed"] .t-name')).toHaveText('Open day');
    await expect(page.locator('[data-today="missed"]')).toContainText('Push & Pull wasn’t done on Sunday.');
    await expect(page.locator('.qp-primary')).toHaveText('Do Push & Pull now');
    await tab(page, 'plan');
    expect(await rowText(page, '2026-11-08')).toMatch(/Push & Pull\s*not done/);
    expect(await rowText(page, '2026-11-10')).toMatch(/Push\s*not done/);
    expect(JSON.stringify(await store(page, 'spc_c_weekplan'))).toBe(planBefore);   // no event without the athlete
    // doing it now is the athlete's move: Sunday's session comes to Wednesday
    await tab(page, 'today');
    await page.locator('[data-donow]').click();
    await expect(page.locator('.fp-runcard')).toBeVisible();
    const last = (await store(page, 'spc_c_weekplan')).events.pop();
    expect(last).toMatchObject({ type: 'placement_changed', item: 'P4W4-1', from: '2026-11-08', to: '2026-11-11', reason: 'athlete' });
  });

  test('09 the program does not advance because days pass', async ({ page }) => {
    await athlete(page);
    const before = JSON.stringify(await store(page, 'spc_c_program'));
    await at(page, day(16));                                               // Tuesday, two weeks later
    await tab(page, 'plan');
    await expect(page.locator('.pl-pos')).toHaveText('Phase 4 · Week 4 · 0 of 4 done');
    expect(JSON.stringify(await store(page, 'spc_c_program'))).toBe(before);
    expect(await rowText(page, '2026-11-24')).toContain('Push & Pull');    // the same open work, proposed again
  });

  test('10 Goals is reachable and shows what is in the way, without the old vocabulary', async ({ page }) => {
    await athlete(page);
    await tab(page, 'goals');
    await expect(page.locator('[data-goal="ring_muscle_up"]')).toContainText('In the way: Foundation');
    await expect(page.locator('[data-goal="pistol_squat"]')).toContainText('In the way: Foundation');
    await expect(page.locator('.gl-row[data-foundation]')).toContainText('of 6 confirmed');
    await page.locator('.gl-row[data-foundation]').click();
    await expect(page.locator('.scr')).toContainText('Both goals open when all six are confirmed');
    await page.locator('[data-backpath]').click();
    await expect(page.locator('[data-tab="goals"]')).toBeVisible();
    await page.locator('[data-goal="ring_muscle_up"]').click();
    await expect(page.locator('.sheet')).toContainText('Opens when the Foundation is complete');
    expect(await page.locator('body').innerText()).not.toContain('Academy');
  });

  test('11 the gear sits in the same place on Today, Plan and Goals, opens Settings, and Done returns to the tab', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });                  // measure the settled layout, not the fade-in
    await athlete(page);
    const boxes = [];
    for (const t of ['today', 'plan', 'goals']) {
      await tab(page, t);
      const g = page.locator('[data-tab="' + t + '"] [data-settings]');
      const b = await g.boundingBox();
      boxes.push([Math.round(b.x), Math.round(b.y)]);
      await g.click();
      await expect(page.locator('.qp-title')).toHaveText('Settings');
      for (const row of ['days', 'program', 'sheet', 'timer', 'data']) await expect(page.locator('[data-sview="' + row + '"]')).toBeVisible();
      await expect(page.locator('[data-sgo="history"]')).toBeVisible();
      await expect(page.locator('.qp-build')).toContainText('Build ');
      await page.locator('[data-sclose]').click();
      await expect(page.locator('[data-tab="' + t + '"]')).toBeVisible();
    }
    expect(boxes[1]).toEqual(boxes[0]);
    expect(boxes[2]).toEqual(boxes[0]);
  });

  test('12 History is reachable behind the gear, and a session opens with its results', async ({ page }) => {
    await athlete(page);
    await page.evaluate(() => {
      let s = JSON.parse(localStorage.getItem('spc_c_program'));
      s = window.CoachProgram.addEvent(s, { id: 'h-1', type: 'workout_completed', workoutId: 'P4W4-2', source: 'app', finishedAt: '2026-11-05T18:00:00.000Z',
        result: [{ variant: 'easy', sets: [{ value: 9, done: true }] }] });
      localStorage.setItem('spc_c_program', JSON.stringify(s));
    });
    await page.reload();
    await page.locator('[data-tab="today"] [data-settings]').click();
    await page.locator('[data-sgo="history"]').click();
    await page.locator('[data-histev="h-1"]').click();
    await expect(page.locator('.sheet')).toContainText('9 reps');
    await page.locator('.sheet [data-close]').click();
    await page.locator('[data-tosettings]').click();
    await expect(page.locator('.qp-title')).toHaveText('Settings');
  });

  test('13 Data & backup is reachable; a backup carries the training record and the week plan, and restores them', async ({ page }) => {
    await athlete(page);
    await tab(page, 'plan');
    await page.locator('[data-acceptweek]').click();
    const planSaved = JSON.stringify(await store(page, 'spc_c_weekplan'));
    const progSaved = JSON.stringify(await store(page, 'spc_c_program'));
    await page.locator('[data-tab="plan"] [data-settings]').click();
    await page.locator('[data-sview="data"]').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-backup-export]').click()]);
    const text = fs.readFileSync(await download.path(), 'utf8');
    const env = JSON.parse(text);
    expect(env.keys.spc_c_weekplan).toEqual({ present: true, value: planSaved });
    expect(env.keys.spc_c_program.present).toBe(true);
    // the plan changes after the backup …
    await page.evaluate(() => localStorage.removeItem('spc_c_weekplan'));
    // … and the backup brings it back
    const file = path.join(os.tmpdir(), 'spc-shell-backup-' + Date.now() + '.json');
    fs.writeFileSync(file, text);
    page.once('dialog', (d) => d.accept());
    await page.locator('[data-backup-file]').setInputFiles(file);
    await expect(page.locator('[data-tab="today"], .qp-screen').first()).toBeVisible({ timeout: 15000 });
    await expect.poll(() => page.evaluate(() => localStorage.getItem('spc_c_weekplan'))).toBe(planSaved);
    expect(JSON.stringify(await store(page, 'spc_c_program'))).toBe(progSaved);
    await tab(page, 'plan');
    await expect(page.locator('[data-acceptweek]')).toHaveCount(0);       // accepted, as backed up
  });

  test('14 an open day: Train anyway moves a session of this week to today; a repeat moves nothing', async ({ page }) => {
    await athlete(page, { at: day(1) });                                   // Monday
    const t = page.locator('[data-today="open"]');
    await expect(t.locator('.t-name')).toHaveText('Open day');
    await expect(t).toContainText('Nothing planned today.');
    await t.locator('[data-train]').click();
    const sheet = page.locator('.sheet');
    await expect(sheet.locator('[data-pick][data-item="P4W4-2"]')).toContainText('planned Thu');   // Sunday has passed: Mon's proposal starts Tue
    await expect(sheet.locator('[data-pick][data-item="P4W4-L"]')).toBeVisible();
    await sheet.locator('[data-repeat]').click();
    await expect(page.locator('.sheet [data-again="P4W3-4"]')).toBeVisible();
    await page.locator('.sheet [data-close]').click();
    await page.locator('[data-train]').click();
    await page.locator('.sheet [data-pick][data-item="P4W4-2"]').click();
    await expect(page.locator('.fp-runcard')).toBeVisible();
    await page.locator('[data-exitrun]').click();
    await tab(page, 'plan');
    expect(await rowText(page, '2026-11-09')).toMatch(/Push\s*today\s*moved from Thu/);
    expect(await rowText(page, '2026-11-12')).not.toContain('Push');
  });

  test('15 the app opens offline from the device, on Today', async ({ page, context }) => {
    await athlete(page);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForTimeout(800);                                        // let the shell finish caching
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('[data-tab="today"] .t-name')).toHaveText('Push & Pull', { timeout: 15000 });
    await tab(page, 'plan');
    await expect(page.locator('.pl-pos')).toHaveText('Phase 4 · Week 4 · 0 of 4 done');
    await context.setOffline(false);
  });
});

test.describe('the shell on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 } });
  test('16 no sideways scrolling, and nothing hides behind the tab bar or the workout bar', async ({ page }) => {
    await athlete(page);
    await page.locator('[data-startpw]').click();
    await page.locator('[data-exitrun]').click();
    for (const t of ['today', 'plan', 'goals']) {
      await tab(page, t);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), t).toBeLessThanOrEqual(0);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const r = await page.evaluate(() => {
        const nav = document.querySelector('.nav').getBoundingClientRect(), bar = document.querySelector('.qp-rbar');
        const covered = bar ? bar.getBoundingClientRect().top : nav.top;
        const last = [...document.querySelectorAll('.scr button, .scr p, .scr .pl-day')].filter((e) => e.offsetParent).pop().getBoundingClientRect();
        return { lastBottom: last.bottom, covered, navBottom: nav.bottom, vh: window.innerHeight };
      });
      expect(r.lastBottom, t).toBeLessThanOrEqual(r.covered + 0.5);
      expect(Math.round(r.navBottom), t).toBe(r.vh);
    }
    // Today's action sits in the lower half of the screen, in reach of a thumb
    await tab(page, 'today');
    const b = await page.locator('.qp-primary').boundingBox();
    expect(b.y).toBeGreaterThan(740 / 2);
    expect(b.height).toBeGreaterThanOrEqual(52);
  });
});
