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
//
// SINCE THE RENOVATION, climbing is archived out of the product: the data, the
// templates and the logger all still exist, but no screen renders climbing and
// Edit Plan offers no row for it. That changes what these tests can observe,
// not what they are for. The climbing cases now assert the stronger form of the
// same invariant — no surface may name a day by a static template when the plan
// is the authority, so a stored-but-hidden assignment must appear on no screen
// while remaining perfectly intact in storage. The general form of the bug is
// still exercised end to end, with visible exercises, by 03-05 and 08.
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
  await page.locator('.nav [data-s="plan"]').click();
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
  await page.locator('.nav [data-s="plan"]').click();
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
  await page.locator('.nav [data-s="plan"]').click();
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

// Climbing is archived out of the product (see week.js CLIMBING_IN_PRODUCT), so
// it no longer has an Edit Plan row to click. Its assignment is still the same
// single authoritative value, so these tests write exactly the field the editor
// used to write and reload — same key, same shape, same read path.
async function setPlanDays(page, exId, days) {
  await page.evaluate(({ id, d }) => {
    const p = JSON.parse(localStorage.getItem('spc_c_plan') || '{}');
    p.requirements = p.requirements || {};
    p.requirements[id] = Object.assign({}, p.requirements[id], { days: d });
    localStorage.setItem('spc_c_plan', JSON.stringify(p));
  }, { id: exId, d: days });
  await page.reload();
}

// Every day card's text, so "does any surface mention climbing" can be asked of
// the whole week rather than one day at a time.
function allCardText(cards) { return cards.map(c => c.text).join(' | '); }

// ── the reported bug, after climbing was archived ─────────────────────────
//
// The bug above is fixed AND the vehicle that exposed it is now hidden: the
// product no longer shows climbing anywhere (the renovation archived it rather
// than deleting it). So the assertion changes shape without weakening — it is
// no longer "Sunday stops advertising climbing once you move it", it is the
// stronger "no day advertises climbing at all, while the athlete's stored
// assignment is still there, intact, for whenever it comes back".
test.describe('Week ↔ Edit Plan — the archived Climbing/Bouldering case', () => {
  test('01 — the climbing assignment survives as data while no surface advertises it', async ({ page }) => {
    await seed(page, 2);

    // The stored value is untouched by the renovation: still Sunday.
    expect(await persistedDays(page, 'bouldering')).toEqual([0]);
    // And the resolution layer still reports it as a plan fact.
    expect(await page.evaluate(() => {
      const plan = JSON.parse(localStorage.getItem('spc_c_plan'));
      return { assigned: window.CoachWeek.assignmentsForDay(plan, 0), climbs: window.CoachWeek.climbsOn(plan, 0) };
    })).toEqual({ assigned: ['bouldering'], climbs: true });

    // Yet nothing on Week names it, on Sunday or anywhere else.
    let cards = await weekCards(page);
    expect(allCardText(cards)).not.toMatch(/Bouldering|Climbing/);
    // Sunday does not advertise a session it does not show.
    expect(cardFor(cards, 0).session).not.toMatch(/Climbing/);
    expect(cardFor(cards, 0).session).toMatch(/Open day/);

    // A full reload — the real close/reopen the athlete did — changes neither.
    await page.reload();
    cards = await weekCards(page);
    expect(allCardText(cards)).not.toMatch(/Bouldering|Climbing/);
    expect(await persistedDays(page, 'bouldering')).toEqual([0]);

    // The editor is why it cannot be moved: it offers no climbing row, rather
    // than offering one that silently does nothing.
    await openEditPlan(page);
    expect(await page.locator('[data-ex="bouldering"][data-epday]').count()).toBe(0);
    // The rest of the plan is still fully editable.
    expect(await page.locator('[data-ex="pullup_pyramid"][data-epday]').count()).toBeGreaterThan(0);
  });

  test('02 — a climbing assignment on several days is equally preserved and equally invisible', async ({ page }) => {
    await seed(page, 2);
    await setPlanDays(page, 'bouldering', [0, 1, 2, 3]);

    // Stored on four days.
    expect(await persistedDays(page, 'bouldering')).toEqual([0, 1, 2, 3]);
    expect(await page.evaluate(() => {
      const plan = JSON.parse(localStorage.getItem('spc_c_plan'));
      const out = {};
      for (let d = 0; d < 7; d++) out[d] = window.CoachWeek.climbsOn(plan, d);
      return out;
    })).toEqual({ 0: true, 1: true, 2: true, 3: true, 4: false, 5: false, 6: false });

    // Visible on none of them, and the days that hold other work still show it.
    const cards = await weekCards(page);
    expect(allCardText(cards)).not.toMatch(/Bouldering|Climbing/);
    expect(cardFor(cards, 1).text).toContain('High Pull');
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
//
// All four are still the surfaces worth checking. Since climbing was archived
// they must now show NO climbing on ANY day, assigned or not — which is the
// same question ("does this surface follow the plan, or a static template?")
// with the plan now answering "not in the product".
test.describe('Week ↔ Edit Plan — no surface resurrects the archived climbing day', () => {
  async function weekStrip(page) {
    await page.locator('.nav [data-s="today"]').click();
    await expect(page.locator('.wk-strip')).toBeVisible();
    return await page.evaluate(() => Array.from(document.querySelectorAll('.wk-day-chip')).map(c => ({
      day: (c.querySelector('.wdc-d') || {}).textContent,
      label: (c.querySelector('.wdc-s') || {}).textContent
    })));
  }

  test('09 — the Today "This Week" strip labels no day Climb, including the assigned one', async ({ page }) => {
    await seed(page, 2);
    // The default plan still assigns climbing to Sunday.
    expect(await persistedDays(page, 'bouldering')).toEqual([0]);

    let strip = await weekStrip(page);
    expect(strip.map(s => s.label)).not.toContain('Climb');
    expect(strip[0].day).toBe('Sun');
    expect(strip[6].label).toBe('Rest');        // Saturday untouched

    // Moving the stored assignment cannot make it reappear elsewhere either.
    await setPlanDays(page, 'bouldering', [1, 2, 3]);
    strip = await weekStrip(page);
    expect(strip.map(s => s.label)).not.toContain('Climb');
    expect(strip[6].label).toBe('Rest');
  });

  test('10 — the climbing emphasis picker is gone from every day, and every day still opens', async ({ page }) => {
    await seed(page, 2);
    // Sunday holds the assignment and still offers no picker.
    for (const d of [0, 1, 2, 3, 4, 5, 6]) {
      await openDayDetail(page, d);
      expect(await page.locator('.sheet-back [data-emph]').count(), 'day ' + d).toBe(0);
      await closeDayDetail(page);
    }

    // And the day whose detail sheet used to crash when the emphasis options
    // lived on the Sunday row alone still opens cleanly after a reload.
    await setPlanDays(page, 'bouldering', [1]);
    await openDayDetail(page, 1);
    expect(await page.locator('.sheet-back [data-emph]').count()).toBe(0);
    await expect(page.locator('.sheet-back .sheet')).toBeVisible();
  });

  test('11 — Today offers no climbing session on any day, assigned or not', async ({ page }) => {
    await seed(page, 2);
    const offersClimbing = () => page.evaluate(() => !!Array.from(document.querySelectorAll('button'))
      .find(b => /climbing session/i.test(b.textContent)));

    // Sunday is today, and climbing IS assigned to it by the default plan.
    await page.addInitScript(() => { window.__spcTodayId = 0; });
    await page.evaluate(() => localStorage.removeItem('spc_c_day'));
    await page.reload();
    await page.locator('.nav [data-s="today"]').click();
    await page.waitForTimeout(250);
    expect(await offersClimbing()).toBe(false);

    // Monday, which is not assigned it, likewise.
    await page.addInitScript(() => { window.__spcTodayId = 1; });
    await page.evaluate(() => localStorage.removeItem('spc_c_day'));
    await page.reload();
    await page.locator('.nav [data-s="today"]').click();
    await page.waitForTimeout(250);
    expect(await offersClimbing()).toBe(false);
  });

  test('12 — the daily queue fabricates nothing, on the assigned day least of all', async ({ page }) => {
    await seed(page, 2);
    const sunday = await page.evaluate(() => {
      const plan = JSON.parse(localStorage.getItem('spc_c_plan'));
      const res = window.CoachWeek.resolveDay(plan, 0, { todayId: 0, readiness: {} });
      const d = window.CoachDaily.makeDaily(res, { dateKey: '2026-09-20' });
      return {
        queue: d.exercises.map(e => e.exId),
        // The plan fact is unchanged underneath the empty queue.
        stillAssigned: window.CoachWeek.assignmentsForDay(plan, 0),
        resolvedClimbing: res.climbing,
        climbTemplateId: res.climbTemplateId
      };
    });
    // Sunday is the stored climbing day, and the queue invents nothing for it.
    expect(sunday.stillAssigned).toEqual(['bouldering']);
    expect(sunday.queue).toEqual([]);
    expect(sunday.resolvedClimbing).toBe(false);
    expect(sunday.climbTemplateId).toBe(null);

    // Moving it does not conjure a row on the new day either.
    await setPlanDays(page, 'bouldering', [1, 2, 3]);
    const after = await page.evaluate(() => {
      const plan = JSON.parse(localStorage.getItem('spc_c_plan'));
      const mon = window.CoachWeek.resolveDay(plan, 1, { todayId: 1, readiness: {} });
      return window.CoachDaily.makeDaily(mon, { dateKey: '2026-09-21' }).exercises.map(e => e.exId);
    });
    expect(after).not.toContain('bouldering');
    // Monday's real work is still there — the filter removed climbing, not the day.
    expect(after).toContain('highpull');
  });

  test('13 — climbing assigned to two days produces no session on either, and the plan still says so', async ({ page }) => {
    await seed(page, 2);
    await setPlanDays(page, 'bouldering', [2, 5]);
    const r = await page.evaluate(() => {
      const plan = JSON.parse(localStorage.getItem('spc_c_plan'));
      const D = window.CoachDaily, W = window.CoachWeek;
      const sessions = {}, stored = {};
      for (let d = 0; d < 7; d++) {
        const res = W.resolveDay(plan, d, { todayId: d, readiness: {} });
        const q = D.makeDaily(res, { dateKey: '2026-09-2' + d });
        sessions[d] = q.exercises.filter(e => e.kind === 'base' && e.baseType === 'climbing').length;
        stored[d] = W.climbsOn(plan, d);
      }
      return { sessions: sessions, stored: stored };
    });
    // Nothing runnable anywhere…
    expect(r.sessions).toEqual({ 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 });
    // …while the assignment the athlete made is still recorded on exactly those days.
    expect(r.stored).toEqual({ 0: false, 1: false, 2: true, 3: false, 4: false, 5: true, 6: false });
  });

  test('14 — a recorded day is named by what it holds, not by the template session', async ({ page }) => {
    await seed(page, 2);
    // Sunday still HOLDS the climbing assignment, and must still not be named
    // by it, because the product does not show it — the template string is a
    // second source either way.
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
    // Vehicle: a visible exercise, since the three surfaces can only be
    // compared on something all three still show.
    await openEditPlan(page);
    await setDays(page, 'pullup_pyramid', [1, 2, 3]);
    await savePlan(page);
    await page.reload();

    // Week card.
    const cards = await weekCards(page);
    expect(cardFor(cards, 1).text).toContain('Pull-Up Pyramid');

    // Day detail sheet for Monday.
    await page.locator('[data-daydetail="1"]').click();
    await expect(page.locator('.sheet-back .sheet')).toBeVisible();
    expect(await page.evaluate(() => document.body.textContent)).toContain('Pull-Up Pyramid');
    await closeDayDetail(page);

    // Edit Plan, reopened, reads the same value.
    await openEditPlan(page);
    expect(await editorDays(page, 'pullup_pyramid')).toEqual([1, 2, 3]);

    // And the resolution layer itself, for every day, straight from the plan —
    // including for the archived climbing assignment, which is still a plan
    // fact even though no screen renders it.
    const resolved = await page.evaluate(() => {
      const plan = JSON.parse(localStorage.getItem('spc_c_plan'));
      const out = { pyramid: {}, bouldering: {} };
      for (let d = 0; d < 7; d++) {
        const a = window.CoachWeek.assignmentsForDay(plan, d);
        out.pyramid[d] = a.indexOf('pullup_pyramid') >= 0;
        out.bouldering[d] = a.indexOf('bouldering') >= 0;
      }
      return out;
    });
    expect(resolved.pyramid).toEqual({ 0: false, 1: true, 2: true, 3: true, 4: false, 5: false, 6: false });
    expect(resolved.bouldering).toEqual({ 0: true, 1: false, 2: false, 3: false, 4: false, 5: false, 6: false });
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
    // Sunday HOLDS climbing, but the product does not show climbing, so the
    // template's "Climbing / Bouldering" is a second source describing content
    // the athlete cannot see. The label is derived from what is shown.
    expect(labels.intact.derived).toBe(true);
    expect(labels.intact.session).not.toMatch(/Climbing/);
    expect(labels.intact.sub).not.toMatch(/Bouldering/);
    // Emptied of it entirely: still described by the plan, not the template.
    expect(labels.emptied.derived).toBe(true);
    expect(labels.emptied.session).not.toMatch(/Climbing/);
    // Moving it to Monday does not rename Monday either — a hidden item is not
    // content, on any day.
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
