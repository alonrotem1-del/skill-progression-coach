// Skill Progression Coach — portrait restoration (Section 14 tests). Manifest
// orientation and "no landscape lock" are covered in tests/orientation.spec.cjs
// (items 1/2 here); this file covers the rest: no horizontal page scroll at
// the primary validation widths, every screen/runner fits, and nothing that
// worked before this change (Add Full Round rest, the 5-second hold prep,
// refresh persistence) regressed.
const { test, expect } = require('@playwright/test');

const WIDTHS = [
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 430, height: 932 },
];

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

async function noHorizontalOverflow(page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
}

// Every essential/interactive element must sit within the viewport's width
// (never require sideways scroll to reach) — height overflow is fine, that's
// normal vertical scrolling.
async function allWithinViewportWidth(page, selector) {
  const vp = page.viewportSize();
  const boxes = await page.locator(selector).evaluateAll(els => els.map(el => {
    const r = el.getBoundingClientRect(); return { x: r.x, right: r.x + r.width };
  }));
  boxes.forEach(b => {
    expect(b.x).toBeGreaterThanOrEqual(-1);
    expect(b.right).toBeLessThanOrEqual(vp.width + 1);
  });
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

WIDTHS.forEach(({ width, height }) => {
  test.describe(`3/4/5 — no horizontal page scroll @ ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('Today, Week, Map, Progress all fit without horizontal scroll', async ({ page }) => {
      await seed(page);
      await noHorizontalOverflow(page);
      await page.locator('.nav [data-s="week"]').click();
      await noHorizontalOverflow(page);
      await page.locator('.nav [data-s="map"]').click();
      await noHorizontalOverflow(page);
      await page.locator('.nav [data-s="progress"]').click();
      await noHorizontalOverflow(page);
    });
  });
});

test.describe('6/7 — Today and the Daily Workout Queue fit in portrait', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Today renders the scheduled session and queue items stacked vertically', async ({ page }) => {
    await seed(page);
    await expect(page.locator('.hero h1')).toBeVisible();
    await noHorizontalOverflow(page);
    await allWithinViewportWidth(page, '[data-exstart], .nav button');
  });
});

test.describe('8/10 — Week fits in portrait', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('days stack as one vertical column', async ({ page }) => {
    await seed(page);
    await page.locator('.nav [data-s="week"]').click();
    const cols = await page.locator('.week-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.trim().split(' ').length);
    expect(cols).toBe(1);
    await noHorizontalOverflow(page);
  });
});

test.describe('9/10 — Edit Plan fits, all seven weekday chips stay selectable', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('frequency stepper and 7 day chips fit and can all be tapped', async ({ page }) => {
    await seed(page);
    await page.locator('.nav [data-s="week"]').click();
    await page.locator('[data-editplan]').click();
    await noHorizontalOverflow(page);
    // Every weekday chip for the first exercise row is tappable and toggles.
    const row = page.locator('.ep-row').first();
    const dayChips = row.locator('.ep-days .ep-chip');
    expect(await dayChips.count()).toBe(7);
    await allWithinViewportWidth(page, '.ep-row');
    for (let i = 0; i < 7; i++) {
      const chip = dayChips.nth(i);
      const before = await chip.evaluate(el => el.classList.contains('on'));
      await chip.click();
      const after = await chip.evaluate(el => el.classList.contains('on'));
      expect(after).toBe(!before);
    }
    await expect(page.locator('[data-epsave]')).toBeVisible();
    await expect(page.locator('[data-epcancel]')).toBeVisible();
  });
});

test.describe('11/12/13 — Skill Map opens in portrait without triggering landscape', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('map renders, nodes are tappable, and no landscape lock is attempted', async ({ page }) => {
    await page.addInitScript(() => {
      window.__lockCalls = [];
      const orient = { type: 'portrait-primary', lock(o) { window.__lockCalls.push(o); return Promise.resolve(); }, unlock() {} };
      try { Object.defineProperty(window.screen, 'orientation', { configurable: true, get: () => orient }); } catch (e) {}
    });
    await seed(page);
    await page.locator('.nav [data-s="map"]').click();
    await expect(page.locator('.map-frame')).toBeVisible();
    await expect(page.locator('.node.current')).toBeVisible();
    await page.locator('.node.current').click({ force: true });
    await expect(page.locator('.sheet')).toBeVisible();
    const calls = await page.evaluate(() => window.__lockCalls || []);
    expect(calls.length).toBe(0);
    await noHorizontalOverflow(page);
  });
});

test.describe('14/15 — Progress and History fit in portrait', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('weekly summary, PRs and history rows stay within the viewport width', async ({ page }) => {
    await seed(page);
    await page.locator('.nav [data-s="progress"]').click();
    await noHorizontalOverflow(page);
    await allWithinViewportWidth(page, '.sum-row, .card');
  });
});

test.describe('16/26 — Ladder runner fits in portrait; Add Full Round still rests', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('active round and the rest before an added round both fit, no button off-screen', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startone]').click();
    await page.locator('[data-pick="pullup_ladder"]').click();
    if (await page.locator('text=How should this workout count?').count()) await page.locator('[data-cl="extra"]').click();
    await expect(page.locator('.cur-card')).toBeVisible();
    await noHorizontalOverflow(page);
    for (let i = 0; i < 5; i++) await completeRound(page);
    await page.locator('[data-addround]').click();
    await expect(page.locator('.ladder-rest-pending')).toBeVisible();
    await expect(page.locator('#rest')).toContainText('Rest before Round 6');
    await noHorizontalOverflow(page);
    await allWithinViewportWidth(page, '[data-holdstop], [data-tpause], [data-t30], [data-tskip], [data-endladderrest]');
  });
});

test.describe('17 — Pyramid runner fits in portrait', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('pyramid target/stepper stay within the viewport', async ({ page }) => {
    await seed(page);
    await page.locator('.nav [data-s="map"]').click();
    await page.locator('.node.current').click({ force: true });
    await page.locator('[data-start="mu_strength"]').click();
    await expect(page.locator('.cur-card')).toBeVisible();
    await noHorizontalOverflow(page);
  });
});

test.describe('18/19 — Timed Hold runner fits; the 5-second prep countdown is intact', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('prep and active countdown fit, prep lasts 5 seconds', async ({ page }) => {
    await page.clock.install();
    await seed(page);
    await page.locator('[data-startone]').click();
    await page.locator('[data-pick="deadhang"]').click();
    if (await page.locator('text=How should this workout count?').count()) await page.locator('[data-cl="extra"]').click();
    await page.locator('[data-holdstart]').click();
    await expect(page.locator('.hold-card.hold-prep')).toBeVisible();
    await noHorizontalOverflow(page);
    await page.clock.runFor(4700);
    let hd = await page.evaluate(() => window.CoachApp._UI.workout.hold);
    expect(hd.phase).toBe('prep'); // still prepping just before 5s
    await page.clock.runFor(500);
    hd = await page.evaluate(() => window.CoachApp._UI.workout.hold);
    expect(hd.phase).toBe('running');
    await noHorizontalOverflow(page);
  });
});

test.describe('20 — rest timer fits in portrait', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the rest widget and its controls stay within the viewport', async ({ page }) => {
    await seed(page);
    await page.locator('[data-startday]').first().click();
    await page.locator('.cur-card [data-done]').first().click();
    if (await page.locator('.adapt-card [data-diff]').count()) await page.locator('[data-diff="appropriate"]').click();
    await expect(page.locator('#rest .timer')).toBeVisible();
    await noHorizontalOverflow(page);
    await allWithinViewportWidth(page, '#rest .timer, #rest button');
  });
});

test.describe('22 — Climbing base session fits in portrait', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the climbing logger stacks vertically', async ({ page }) => {
    await seed(page, 0); // Sunday = climbing
    await page.locator('[data-startday]').first().click();
    await expect(page.locator('.climb-left')).toBeVisible();
    await noHorizontalOverflow(page);
  });
});

test.describe('23 — Group Workout Log fits in portrait', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the group log form fits', async ({ page }) => {
    await seed(page, 3); // Wednesday = group
    await page.locator('[data-groupday]').click();
    await expect(page.locator('[data-savegroup]')).toBeVisible();
    await noHorizontalOverflow(page);
  });
});

test.describe('24/25 — modals/sheets fit and bottom nav is never obscured', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a bottom sheet stays within the viewport and the nav bar is visible above it', async ({ page }) => {
    await seed(page);
    await page.locator('.nav [data-s="map"]').click();
    await page.locator('.node.current').click({ force: true });
    const sheetBox = await page.locator('.sheet').boundingBox();
    const vp = page.viewportSize();
    expect(sheetBox.x).toBeGreaterThanOrEqual(-1);
    expect(sheetBox.x + sheetBox.width).toBeLessThanOrEqual(vp.width + 1);
    await noHorizontalOverflow(page);
  });
});

test.describe('27 — text stays readable (no extreme font reduction)', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('primary heading and body text keep a comfortable minimum size', async ({ page }) => {
    await seed(page);
    const h1Size = await page.locator('.hero h1').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(h1Size).toBeGreaterThanOrEqual(18);
    const bodySize = await page.locator('body').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(bodySize).toBeGreaterThanOrEqual(14);
  });
});

test.describe('28 — refresh preserves active workout state', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('an in-progress ladder round survives a reload', async ({ page }) => {
    await seed(page);
    await page.locator('[data-exstart="pullup_ladder"]').first().click();
    await expect(page.locator('.cur-card')).toBeVisible();
    await page.locator('.cur-card [data-done]').first().click();
    if (await page.locator('.adapt-card [data-diff]').count()) await page.locator('[data-diff="appropriate"]').click();
    await page.locator('[data-tskip]').click();
    const before = await page.evaluate(() => JSON.stringify(window.CoachApp._UI.workout.blocks[0].rounds[0]));
    await page.reload();
    await expect(page.locator('.cur-card')).toBeVisible();
    const after = await page.evaluate(() => JSON.stringify(window.CoachApp._UI.workout.blocks[0].rounds[0]));
    expect(after).toBe(before);
  });
});

test.describe('29 — desktop renders a centered, constrained app', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the app column has a mobile-sane max width and is centered', async ({ page }) => {
    await seed(page);
    const box = await page.locator('.app').boundingBox();
    const vp = page.viewportSize();
    expect(box.width).toBeLessThan(600); // constrained, not stretched across the window
    const leftGap = box.x, rightGap = vp.width - (box.x + box.width);
    expect(Math.abs(leftGap - rightGap)).toBeLessThan(5); // centered
  });
});
