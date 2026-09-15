// Skill Progression Coach — Week ↔ Edit Plan consistency.
//
// Reproduces a bug found on the installed Samsung PWA: moving
// Climbing/Bouldering from Sunday to Monday + Tuesday + Wednesday saved
// correctly and reopened correctly in Edit Plan, but the Week screen went on
// showing Climbing on Sunday, even after fully closing and reopening the app.
//
// Root cause: a day's on-screen description came from `DAYS[].session`/`.sub`
// — the PROGRAM TEMPLATE's static description of the day — while the athlete's
// `plan.requirements[exId].days` is the only authority on what a day contains.
// The template strings are a second representation of the same fact, and they
// never changed when the athlete moved an exercise. Bouldering exposed it most
// sharply because it is the only exercise that is the SOLE declared content of
// its day, so moving it left Sunday advertising a session with nothing in it.
//
// These tests assert the Week screen and Edit Plan can never disagree about
// which days an exercise is assigned to — for climbing and for other items.
const { test, expect } = require('@playwright/test');

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function seed(page, dayId) {
  await page.addInitScript((d) => { window.__spcTodayId = d; }, dayId);
  await page.goto('index.html');
  await page.evaluate(() => {
    const S = window.CoachStore.makeStore(), D = window.CoachData, E = window.CoachEngine;
    const bench = { pullup_max: 9, dips_max: 6 };
    const state = {};
    D.worlds.forEach(w => {
      const nodes = window.CoachStore.seedStates(w, bench);
      const f = E.autoFocus(w, nodes);
      state[w.id] = { nodes, focus: { primary: f.primary, supporting: f.supporting, manual: false } };
    });
    S.setBench(bench); S.setState(state);
    S.setProfile({ onboarded: true, activeWorld: 'muscleup', days: [0, 2, 4], duration: 'normal' });
    ['spc_c_day', 'spc_c_sessions', 'spc_c_workout', 'spc_c_adhoc', 'spc_c_plan', 'spc_c_templates'].forEach(k => localStorage.removeItem(k));
  });
  await page.reload();
}

// One card per weekday, as the Week screen actually renders it: the session
// description line plus the listed items.
async function weekCards(page) {
  await page.locator('.nav [data-s="week"]').click();
  await expect(page.locator('.wd-card').first()).toBeVisible();
  return await page.evaluate(() => Array.from(document.querySelectorAll('.wd-card')).map(c => ({
    day: (c.querySelector('.wd-day') || {}).textContent.replace(' Today', '').trim(),
    session: ((c.querySelector('.wd-session') || {}).textContent || '').trim(),
    text: c.textContent
  })));
}

// Everything the Week screen says about one weekday — header line included,
// because that is where the stale template description showed up.
function cardFor(cards, dayId) {
  const c = cards.find(x => x.day === DOW[dayId]);
  if (!c) throw new Error('no Week card for ' + DOW[dayId]);
  return c;
}

async function openDayDetail(page, dayId) {
  await page.locator('.nav [data-s="week"]').click();
  await page.locator('[data-daydetail="' + dayId + '"]').click();
  await expect(page.locator('.sheet-back .sheet')).toBeVisible();
}
// The sheet overlays the nav, so it must be dismissed before navigating.
async function closeDayDetail(page) {
  const btn = page.locator('.sheet-back [data-close]');
  if (await btn.count()) await btn.first().click();
  await expect(page.locator('.sheet-back')).toHaveCount(0);
}

async function openEditPlan(page) {
  await page.locator('.nav [data-s="week"]').click();
  await page.locator('[data-editplan]').click();
  await expect(page.locator('[data-epsave]')).toBeVisible();
}

// Which day chips are lit for an exercise in Edit Plan — the editor's own view
// of the same persisted value.
async function editorDays(page, exId) {
  return await page.evaluate((id) => Array.from(
    document.querySelectorAll('[data-ex="' + id + '"][data-epday]')
  ).filter(b => b.className.indexOf('on') >= 0).map(b => +b.dataset.epday).sort((a, b) => a - b), exId);
}

async function setDays(page, exId, days) {
  const current = await editorDays(page, exId);
  const target = days.slice().sort((a, b) => a - b);
  for (const d of current) if (target.indexOf(d) < 0) await page.locator('[data-ex="' + exId + '"][data-epday="' + d + '"]').click();
  for (const d of target) if (current.indexOf(d) < 0) await page.locator('[data-ex="' + exId + '"][data-epday="' + d + '"]').click();
  expect(await editorDays(page, exId)).toEqual(target);
}

async function savePlan(page) {
  page.on('dialog', d => d.accept()); // above-recommendation warnings are non-blocking
  await page.locator('[data-epsave]').click();
  await page.waitForTimeout(500);
}

async function persistedDays(page, exId) {
  return await page.evaluate((id) => {
    const p = JSON.parse(localStorage.getItem('spc_c_plan') || '{}');
    return ((p.requirements || {})[id] || {}).days;
  }, exId);
}

// ── the reported bug ──────────────────────────────────────────────────────
test.describe('Week ↔ Edit Plan — the reported Climbing/Bouldering case', () => {
  test('01 — moving Climbing from Sunday to Mon+Tue+Wed is reflected on Week, survives reload, and matches the editor', async ({ page }) => {
    await seed(page, 2);

    // Starting point: Climbing on Sunday, and Week says so.
    expect(await persistedDays(page, 'bouldering')).toEqual([0]);
    let cards = await weekCards(page);
    expect(cardFor(cards, 0).text).toContain('Bouldering');

    await openEditPlan(page);
    await setDays(page, 'bouldering', [1, 2, 3]);
    await savePlan(page);

    // The one authoritative value changed.
    expect(await persistedDays(page, 'bouldering')).toEqual([1, 2, 3]);

    // Week now agrees — on the new days, and nowhere else.
    cards = await weekCards(page);
    for (const d of [1, 2, 3]) expect(cardFor(cards, d).text, DOW[d]).toContain('Bouldering');
    expect(cardFor(cards, 0).text).not.toContain('Bouldering');
    expect(cardFor(cards, 0).text).not.toContain('Climbing');
    // Sunday's header no longer advertises a session it does not hold.
    expect(cardFor(cards, 0).session).not.toMatch(/Climbing/);
    for (const d of [4, 5, 6]) expect(cardFor(cards, d).text, DOW[d]).not.toContain('Bouldering');

    // A full reload — the real close/reopen the athlete did — changes nothing.
    await page.reload();
    cards = await weekCards(page);
    for (const d of [1, 2, 3]) expect(cardFor(cards, d).text, DOW[d]).toContain('Bouldering');
    expect(cardFor(cards, 0).text).not.toContain('Bouldering');
    expect(cardFor(cards, 0).text).not.toContain('Climbing');
    expect(await persistedDays(page, 'bouldering')).toEqual([1, 2, 3]);

    // And the editor shows the same thing Week does.
    await openEditPlan(page);
    expect(await editorDays(page, 'bouldering')).toEqual([1, 2, 3]);
  });

  test('02 — assigning Climbing back to Sunday as well restores it there, without losing the other days', async ({ page }) => {
    await seed(page, 2);
    await openEditPlan(page);
    await setDays(page, 'bouldering', [1, 2, 3]);
    await savePlan(page);
    await openEditPlan(page);
    await setDays(page, 'bouldering', [0, 1, 2, 3]);
    await savePlan(page);

    const cards = await weekCards(page);
    for (const d of [0, 1, 2, 3]) expect(cardFor(cards, d).text, DOW[d]).toContain('Bouldering');
    // Sunday is the climbing day again, so its own description is back.
    expect(cardFor(cards, 0).session).toMatch(/Climbing/);
    expect(await persistedDays(page, 'bouldering')).toEqual([0, 1, 2, 3]);
  });
});

// ── is it climbing-specific, or general? ──────────────────────────────────
test.describe('Week ↔ Edit Plan — the same consistency holds for non-climbing items', () => {
  test('03 — moving Pull-Up Pyramid off Tuesday to Mon+Thu is reflected on Week and survives reload', async ({ page }) => {
    await seed(page, 2);
    expect(await persistedDays(page, 'pullup_pyramid')).toEqual([2]);

    await openEditPlan(page);
    await setDays(page, 'pullup_pyramid', [1, 4]);
    await savePlan(page);

    let cards = await weekCards(page);
    expect(cardFor(cards, 1).text).toContain('Pull-Up Pyramid');
    expect(cardFor(cards, 4).text).toContain('Pull-Up Pyramid');
    expect(cardFor(cards, 2).text).not.toContain('Pull-Up Pyramid');

    await page.reload();
    cards = await weekCards(page);
    expect(cardFor(cards, 1).text).toContain('Pull-Up Pyramid');
    expect(cardFor(cards, 4).text).toContain('Pull-Up Pyramid');
    expect(cardFor(cards, 2).text).not.toContain('Pull-Up Pyramid');

    await openEditPlan(page);
    expect(await editorDays(page, 'pullup_pyramid')).toEqual([1, 4]);
  });

  test('04 — Pistol Squat moved from Friday to Saturday shows on Saturday only', async ({ page }) => {
    await seed(page, 2);
    await openEditPlan(page);
    await setDays(page, 'pistol', [6]);
    await savePlan(page);

    let cards = await weekCards(page);
    expect(cardFor(cards, 6).text).toContain('Pistol Squat');
    expect(cardFor(cards, 5).text).not.toContain('Pistol Squat');

    await page.reload();
    cards = await weekCards(page);
    expect(cardFor(cards, 6).text).toContain('Pistol Squat');
    expect(cardFor(cards, 5).text).not.toContain('Pistol Squat');
  });

  test('05 — emptying a non-climbing day of all its content stops it advertising that session', async ({ page }) => {
    await seed(page, 2);
    // Friday's whole declared content moves to Thursday. This is the same
    // defect as the climbing case, reached with no climbing involved: the day
    // is left holding nothing while its template still names a session.
    await openEditPlan(page);
    for (const ex of ['pistol', 'pullup_ladder', 'wristroller']) await setDays(page, ex, [4]);
    for (const ex of ['t2b', 'ringsupport']) await setDays(page, ex, [2]);
    await savePlan(page);

    let cards = await weekCards(page);
    expect(cardFor(cards, 5).session).not.toMatch(/Pistol|Pull-Up Ladder/);
    expect(cardFor(cards, 5).text).not.toContain('Pistol Squat');
    expect(cardFor(cards, 4).text).toContain('Pistol Squat');

    await page.reload();
    cards = await weekCards(page);
    expect(cardFor(cards, 5).session).not.toMatch(/Pistol|Pull-Up Ladder/);
    expect(cardFor(cards, 4).text).toContain('Pistol Squat');
  });
});

// ── every surface keyed on "is this the climbing day" ─────────────────────
//
// A second round of device testing showed the Week CARDS were fixed but four
// other surfaces still said Climbing on Sunday, because they were keyed on the
// static `DAYS[].type === 'climbing'` rather than on the assignment: the Today
// screen's "This Week" strip, the day-detail emphasis picker, Today's "Start
// Climbing Session" button, and — worst — the daily queue, which fabricated a
// bouldering session for a day it was not assigned to.
test.describe('Week ↔ Edit Plan — the climbing day follows the assignment', () => {
  async function moveClimbing(page, days) {
    await openEditPlan(page);
    await setDays(page, 'bouldering', days);
    await savePlan(page);
    await page.reload();
  }

  async function weekStrip(page) {
    await page.locator('.nav [data-s="today"]').click();
    await expect(page.locator('.wk-strip')).toBeVisible();
    return await page.evaluate(() => Array.from(document.querySelectorAll('.wk-day-chip')).map(c => ({
      day: (c.querySelector('.wdc-d') || {}).textContent,
      label: (c.querySelector('.wdc-s') || {}).textContent
    })));
  }

  test('09 — the Today "This Week" strip labels the assigned days, not the template day', async ({ page }) => {
    await seed(page, 2);
    let strip = await weekStrip(page);
    expect(strip[0]).toEqual({ day: 'Sun', label: 'Climb' }); // default plan

    await moveClimbing(page, [1, 2, 3]);
    strip = await weekStrip(page);
    expect(strip[0].label).not.toBe('Climb');   // Sunday no longer claims it
    expect(strip[1].label).toBe('Climb');
    expect(strip[2].label).toBe('Climb');
    expect(strip[3].label).toBe('Climb');
    expect(strip[6].label).toBe('Rest');        // Saturday untouched
  });

  test('10 — the emptied day drops the climbing emphasis picker, and the new day gains it', async ({ page }) => {
    await seed(page, 2);
    // Default plan: Sunday is the climbing day and offers the emphasis picker.
    await openDayDetail(page, 0);
    expect(await page.locator('[data-emph]').count()).toBeGreaterThan(0);
    await closeDayDetail(page);

    await moveClimbing(page, [1]);

    // Sunday no longer offers it.
    await openDayDetail(page, 0);
    expect(await page.locator('[data-emph]').count()).toBe(0);
    await closeDayDetail(page);

    // Monday does — and opening it does not break, which it did when the
    // emphasis options still lived on the Sunday row alone.
    await openDayDetail(page, 1);
    expect(await page.locator('[data-emph]').count()).toBeGreaterThan(0);
    await closeDayDetail(page);

    await page.reload();
    await openDayDetail(page, 1);
    expect(await page.locator('[data-emph]').count()).toBeGreaterThan(0);
  });

  test('11 — Today on the emptied day offers no climbing session; the new day does', async ({ page }) => {
    await seed(page, 2);
    await moveClimbing(page, [1]);

    // Sunday is today, and climbing is not assigned to it.
    await page.addInitScript(() => { window.__spcTodayId = 0; });
    await page.evaluate(() => localStorage.removeItem('spc_c_day'));
    await page.reload();
    await page.locator('.nav [data-s="today"]').click();
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => !!Array.from(document.querySelectorAll('button'))
      .find(b => /climbing session/i.test(b.textContent)))).toBe(false);

    // Monday is today, and climbing IS assigned to it.
    await page.addInitScript(() => { window.__spcTodayId = 1; });
    await page.evaluate(() => localStorage.removeItem('spc_c_day'));
    await page.reload();
    await page.locator('.nav [data-s="today"]').click();
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => !!Array.from(document.querySelectorAll('button'))
      .find(b => /climbing session/i.test(b.textContent)))).toBe(true);
  });

  test('12 — the daily queue no longer fabricates a climbing session for an unassigned day', async ({ page }) => {
    await seed(page, 2);
    const before = await page.evaluate(() => {
      const plan = JSON.parse(localStorage.getItem('spc_c_plan'));
      const res = window.CoachWeek.resolveDay(plan, 0, { todayId: 0, readiness: {} });
      const d = window.CoachDaily.makeDaily(res, { dateKey: '2026-09-20' });
      return d.exercises.map(e => ({ exId: e.exId, kind: e.kind, runner: e.runner }));
    });
    // Default plan: Sunday genuinely is the climbing day.
    expect(before[0]).toEqual({ exId: 'bouldering', kind: 'base', runner: 'climbing' });

    await moveClimbing(page, [1, 2, 3]);
    const after = await page.evaluate(() => {
      const plan = JSON.parse(localStorage.getItem('spc_c_plan'));
      const sun = window.CoachWeek.resolveDay(plan, 0, { todayId: 0, readiness: {} });
      const mon = window.CoachWeek.resolveDay(plan, 1, { todayId: 1, readiness: {} });
      const D = window.CoachDaily;
      return {
        sunday: D.makeDaily(sun, { dateKey: '2026-09-20' }).exercises.map(e => e.exId),
        monday: D.makeDaily(mon, { dateKey: '2026-09-21' }).exercises
          .map(e => ({ exId: e.exId, kind: e.kind, runner: e.runner }))
      };
    });
    // Sunday invents nothing.
    expect(after.sunday).not.toContain('bouldering');
    expect(after.sunday).toEqual([]);
    // Monday gains a real, runnable climbing session — so the athlete's move
    // actually took effect rather than leaving a dead row.
    expect(after.monday[0]).toEqual({ exId: 'bouldering', kind: 'base', runner: 'climbing' });
    // And it is not duplicated as a second, non-runnable exercise row.
    expect(after.monday.filter(e => e.exId === 'bouldering').length).toBe(1);
  });

  test('13 — climbing assigned to two days gives each of them a runnable session', async ({ page }) => {
    await seed(page, 2);
    await moveClimbing(page, [2, 5]);
    const r = await page.evaluate(() => {
      const plan = JSON.parse(localStorage.getItem('spc_c_plan'));
      const D = window.CoachDaily, W = window.CoachWeek;
      const out = {};
      for (let d = 0; d < 7; d++) {
        const res = W.resolveDay(plan, d, { todayId: d, readiness: {} });
        const q = D.makeDaily(res, { dateKey: '2026-09-2' + d });
        out[d] = q.exercises.filter(e => e.kind === 'base' && e.baseType === 'climbing').length;
      }
      return out;
    });
    expect(r).toEqual({ 0: 0, 1: 0, 2: 1, 3: 0, 4: 0, 5: 1, 6: 0 });
  });

  test('14 — a newly recorded day is named by what it holds, not by the template session', async ({ page }) => {
    await seed(page, 2);
    await moveClimbing(page, [1]);
    const names = await page.evaluate(() => {
      const plan = JSON.parse(localStorage.getItem('spc_c_plan'));
      const D = window.CoachDaily, W = window.CoachWeek;
      const mk = (d) => D.makeDaily(W.resolveDay(plan, d, { todayId: d, readiness: {} }), { dateKey: '2026-09-2' + d });
      return { sunday: mk(0).session, friday: mk(5).session };
    });
    expect(names.sunday).not.toMatch(/Climbing/);
    expect(names.friday).toBe('Home Pull Session'); // untouched day keeps its name
  });
});

// ── one authoritative value ───────────────────────────────────────────────
test.describe('Week ↔ Edit Plan — one authoritative day assignment', () => {
  test('06 — Week, the day detail sheet and Edit Plan all read the same persisted plan', async ({ page }) => {
    await seed(page, 2);
    await openEditPlan(page);
    await setDays(page, 'bouldering', [1, 2, 3]);
    await savePlan(page);
    await page.reload();

    // Week card.
    const cards = await weekCards(page);
    expect(cardFor(cards, 1).text).toContain('Bouldering');

    // Day detail sheet for Monday.
    await page.locator('[data-daydetail="1"]').click();
    await expect(page.locator('.sheet-back .sheet')).toBeVisible();
    // Climbing was moved TO Monday, so Monday's sheet carries the climbing
    // emphasis picker — the same surface Sunday lost.
    expect(await page.locator('.sheet-back [data-emph]').count()).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.body.textContent)).toContain('Bouldering');

    // And the resolution layer itself, for every day, straight from the plan.
    const resolved = await page.evaluate(() => {
      const plan = JSON.parse(localStorage.getItem('spc_c_plan'));
      const out = {};
      for (let d = 0; d < 7; d++) out[d] = window.CoachWeek.assignmentsForDay(plan, d).indexOf('bouldering') >= 0;
      return out;
    });
    expect(resolved).toEqual({ 0: false, 1: true, 2: true, 3: true, 4: false, 5: false, 6: false });
  });

  test('07 — the derived day description is a pure function of the plan, with no second source', async ({ page }) => {
    await seed(page, 2);
    const labels = await page.evaluate(() => {
      const W = window.CoachWeek;
      const plan = JSON.parse(localStorage.getItem('spc_c_plan'));
      const intact = W.dayContentLabel(plan, 0);
      // Move bouldering off Sunday in a plan OBJECT only — nothing persisted,
      // nothing rendered. The label must follow the plan it is handed.
      const moved = JSON.parse(JSON.stringify(plan));
      moved.requirements.bouldering.days = [1];
      return { intact, emptied: W.dayContentLabel(moved, 0), monday: W.dayContentLabel(moved, 1) };
    });
    // Template description is reused verbatim while the day still holds it.
    expect(labels.intact).toEqual({ session: 'Climbing', sub: 'Bouldering', derived: false });
    // Emptied: described by the plan, not by the template.
    expect(labels.emptied.derived).toBe(true);
    expect(labels.emptied.session).not.toMatch(/Climbing/);
    // A day that keeps its own content keeps its own description, so ordinary
    // days are untouched by this fix.
    expect(labels.monday).toEqual({ session: 'Free Gym', sub: 'Push + Explosive Pull', derived: false });
  });

  test('08 — Rest day keeps its description, and gains the assigned item when one is added', async ({ page }) => {
    await seed(page, 2);
    let cards = await weekCards(page);
    expect(cardFor(cards, 6).session).toMatch(/Rest/);

    await openEditPlan(page);
    await setDays(page, 'light_pullups', [6]);
    await savePlan(page);

    cards = await weekCards(page);
    expect(cardFor(cards, 6).text).toContain('Light');
    await page.reload();
    cards = await weekCards(page);
    expect(cardFor(cards, 6).text).toContain('Light');
  });
});
