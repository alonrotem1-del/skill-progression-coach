// Skill Progression Coach — the Today card, after the duplication cleanup.
//
// The card used to render each scheduled exercise TWICE: once in the Daily
// Queue, and again under "Adjust today's sets", which existed only to carry the
// ladder editor but listed every exercise with the same prescription on the way
// there. On an open day holding one optional Dead Hang that produced two
// identical prescriptions, two different start buttons, a "Review Today's
// Workout" primary (the day counts as complete when its only item is optional),
// a "Full day details" button beside an "Adjust" list, a title that read
// "Open day · Dead Hang", and a "— High" line inherited from the archived
// climbing Project Session still attached to that weekday.
//
// These tests pin the three questions the card has to answer: what am I doing
// today, what exactly is prescribed, and where do I press to start.
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

// The one authoritative value the editor writes, written directly: these tests
// are about what the card RENDERS for a given plan, not about editing one.
async function assign(page, exId, days) {
  await page.evaluate(({ id, d }) => {
    const p = JSON.parse(localStorage.getItem('spc_c_plan') || '{}');
    p.requirements = p.requirements || {};
    p.requirements[id] = Object.assign({}, p.requirements[id], { days: d });
    localStorage.setItem('spc_c_plan', JSON.stringify(p));
  }, { id: exId, d: days });
  await page.reload();
}

const card = (page) => page.locator('.rec.sched');
// How many QUEUE ROWS name this exercise. That is the duplication claim: the
// card's own title and its primary button may legitimately name the exercise
// too, but it must occupy exactly one row.
const rowsNaming = (page, name) => page.locator('.queue .q-ex', { hasText: name }).count();
async function counts(page) {
  await expect(card(page)).toBeVisible({ timeout: 15000 });
  return await page.evaluate(() => ({
    queueRows: document.querySelectorAll('.queue .q-ex').length,
    execPreview: document.querySelectorAll('.exec-preview').length,
    rowStarts: document.querySelectorAll('.queue [data-exstart]').length,
    primaryStart: document.querySelectorAll('.rec.sched > [data-exstart]').length,
    startDay: document.querySelectorAll('.rec.sched > [data-startday]').length,
    dayDetail: document.querySelectorAll('.rec.sched [data-daydetail]').length,
    editWk: document.querySelectorAll('.rec.sched [data-editwk]').length,
    meta: document.querySelectorAll('.rec.sched .meta').length,
  }));
}

// ── a. open day + one optional exercise (the reported case) ───────────────
test.describe('Today card — open day with one optional exercise', () => {
  test('01 the exercise is named once, with one prescription and one start action', async ({ page }) => {
    await seed(page, 0);
    await assign(page, 'deadhang', [0]);
    const t = await card(page).innerText();

    // One row, not two. It used to have a second row under "Adjust today's
    // sets"; the two remaining mentions are the row and the start button.
    expect(await rowsNaming(page, 'Dead Hang')).toBe(1);
    expect(t.split('Dead Hang').length - 1).toBe(2);
    // Its prescription is given once.
    expect(t.split(/3 × 30\s*s/).length - 1).toBe(1);
    // The optional badge survives.
    expect(t).toContain('OPTIONAL');

    const c = await counts(page);
    expect(c.queueRows).toBe(1);
    expect(c.execPreview).toBe(0);     // the duplicate block is gone entirely
    expect(c.rowStarts).toBe(0);       // the row does not repeat the start button
    expect(c.primaryStart).toBe(1);    // exactly one start action, on the card
  });

  test('02 the primary action starts that exercise by name, with no workout review', async ({ page }) => {
    await seed(page, 0);
    await assign(page, 'deadhang', [0]);
    const t = await card(page).innerText();
    expect(t).toContain('Start Dead Hang');
    expect(t).not.toContain("Review Today's Workout");
    expect(t).not.toContain('Start Daily Workout');
    // And it really runs the exercise.
    await card(page).locator('[data-exstart]').click();
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Dead Hang', { timeout: 15000 });
  });

  test('03 the title keeps the day type and does not contradict it', async ({ page }) => {
    await seed(page, 0);
    await assign(page, 'deadhang', [0]);
    const name = await card(page).locator('.name').innerText();
    expect(name.trim()).toBe('Open day');
    expect(name).not.toContain('Dead Hang');
  });

  test('04 no unexplained template metadata, and no second detail action', async ({ page }) => {
    await seed(page, 0);
    await assign(page, 'deadhang', [0]);
    const t = await card(page).innerText();
    // "High" was the difficulty of the archived climbing Project Session.
    expect(t).not.toContain('High');
    expect(t).not.toMatch(/^—$/m);
    expect((await counts(page)).meta).toBe(0);
    // "Full day details" is gone; adjustment is one small secondary action.
    expect(t).not.toContain('Full day details');
    expect(t).toContain('Adjust');
    expect((await counts(page)).dayDetail).toBe(1);
  });

  test('05 Skip is still available, and alternatives stay secondary', async ({ page }) => {
    await seed(page, 0);
    await assign(page, 'deadhang', [0]);
    expect(await page.locator('.queue [data-exskip]').count()).toBe(1);
    // The alternatives section is preserved, outside the scheduled card.
    const app = await page.locator('#app').innerText();
    expect(app).toContain('Feel like training something else?');
    expect(app).toContain('Start Any Workout');
    expect(app).toContain('Start One Exercise');
    expect(await card(page).innerText()).not.toContain('Start Any Workout');
    // Readiness stays collapsed.
    expect(app).toContain('READINESS CHECK');
    await expect(page.locator('.rd-body')).toBeHidden();
  });
});

// ── b. one normal (required) scheduled exercise ───────────────────────────
test.describe('Today card — a single required exercise', () => {
  test('06 one exercise gets the same single named primary action', async ({ page }) => {
    await seed(page, 2);
    // Tuesday, reduced to the pyramid alone.
    await assign(page, 'tophold', []);
    await assign(page, 't2b', []);
    await assign(page, 'ringsupport', []);
    const t = await card(page).innerText();
    expect(t).toContain('Start Pull-Up Pyramid');
    expect(t).not.toContain('Start Daily Workout');
    expect(t).not.toContain('Start This Exercise');
    // One row; the other mentions are this day's authored subtitle
    // ("Pull-Up Pyramid focus") and the start button.
    expect(await rowsNaming(page, 'Pull-Up Pyramid')).toBe(1);
    const c = await counts(page);
    expect(c.queueRows).toBe(1);
    expect(c.rowStarts).toBe(0);
    expect(c.primaryStart).toBe(1);
    expect(c.execPreview).toBe(0);
    // A required item has no Skip.
    expect(await page.locator('.queue [data-exskip]').count()).toBe(0);
  });

  test('07 an authored day keeps its own session title and duration', async ({ page }) => {
    await seed(page, 2);
    await assign(page, 'tophold', []);
    await assign(page, 't2b', []);
    await assign(page, 'ringsupport', []);
    const name = await card(page).locator('.name').innerText();
    // The template really does describe this day, so its subtitle is not a
    // restatement of the queue and stays.
    expect(name).toContain('Home Skill Session');
    // Its duration and difficulty are about the session being shown.
    expect((await counts(page)).meta).toBe(1);
    expect(await card(page).locator('.meta').innerText()).toMatch(/min/);
  });
});

// ── c. multiple scheduled exercises ───────────────────────────────────────
test.describe('Today card — multiple scheduled exercises', () => {
  test('08 the existing workout flow is preserved unchanged', async ({ page }) => {
    await seed(page, 5);
    const t = await card(page).innerText();
    expect(t).toContain('Start Daily Workout');
    const c = await counts(page);
    expect(c.queueRows).toBe(5);
    expect(c.startDay).toBe(1);
    expect(c.primaryStart).toBe(0);
    // Every row keeps its own start action when there is a choice to make.
    expect(c.rowStarts).toBe(5);
    // Progress still reported.
    expect(t).toMatch(/of 3 required done/);
  });

  test('09 each exercise and prescription still appears exactly once', async ({ page }) => {
    await seed(page, 5);
    const names = ['Pistol Squat', 'Pull-Up Ladder', 'Toes-to-Bar', 'Ring Support Hold', 'Wrist Roller'];
    for (const n of names) expect(await rowsNaming(page, n), n).toBe(1);
    // One prescription each, not two.
    const t = await card(page).innerText();
    ['3 × 5 each side', '1–2–3 × 5 rounds', '3 × 8 reps', '3 × 20s hold', '2 × 10 reps']
      .forEach((p) => expect(t.split(p).length - 1, p).toBe(1));
    expect((await counts(page)).execPreview).toBe(0);
  });

  test('10 a ladder day keeps its editor as the one secondary action', async ({ page }) => {
    await seed(page, 5);
    const t = await card(page).innerText();
    expect(t).toContain('Edit sets');
    expect(t).not.toContain('Full day details');
    expect(t).not.toContain("Adjust today's sets");
    const c = await counts(page);
    expect(c.editWk).toBe(1);
    expect(c.dayDetail).toBe(0);
    // And it still opens the ladder editor that already existed.
    await card(page).locator('[data-editwk]').click();
    await expect(page.locator('[data-edsavetoday]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.ed-body')).toBeVisible();
  });
});

// ── d. no scheduled exercises ─────────────────────────────────────────────
test.describe('Today card — nothing scheduled', () => {
  test('11 an empty open day says so once, with a single action', async ({ page }) => {
    await seed(page, 0);
    const name = await card(page).locator('.name').innerText();
    // With no queue to read instead, naming the emptiness is the information.
    expect(name).toContain('Open day');
    expect(name).toContain('Nothing assigned');
    const c = await counts(page);
    expect(c.queueRows).toBe(0);
    expect(c.execPreview).toBe(0);
    // One day-detail action, not "View Session" AND "Adjust" for the same sheet.
    expect(c.dayDetail).toBe(1);
    expect(await card(page).innerText()).not.toContain('Adjust');
    expect(c.meta).toBe(0);
  });

  test('12 a rest day is unchanged', async ({ page }) => {
    await seed(page, 6);
    const t = await card(page).innerText();
    expect(t).toContain('Rest & Recovery');
    expect(t).not.toContain('Adjust');
    expect(t).not.toContain('Full day details');
    expect((await counts(page)).execPreview).toBe(0);
  });
});
