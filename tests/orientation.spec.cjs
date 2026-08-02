// Skill Progression Coach — portrait is the primary, intended orientation.
// Verifies the manifest requests portrait-primary, that no code attempts a
// landscape lock (auto or user-initiated — that promotional feature was
// removed), and that a physical landscape viewport still degrades gracefully
// via the (unpromoted, secondary) responsive CSS fallback in landscape.spec.cjs.
const { test, expect } = require('@playwright/test');

const LANDSCAPE = { width: 844, height: 390 };
const PORTRAIT = { width: 390, height: 844 };

// Install a stub Screen Orientation API before any page script runs, and
// record every lock() call so we can assert the app never makes one.
function stubOrientation(page, { standalone = false } = {}) {
  return page.addInitScript(({ standalone }) => {
    window.__lockCalls = [];
    const orient = {
      type: 'portrait-primary',
      lock(o) { window.__lockCalls.push(o); return Promise.resolve(); },
      unlock() {}
    };
    try { Object.defineProperty(window.screen, 'orientation', { configurable: true, get: () => orient }); }
    catch (e) { window.screen.orientation = orient; }
    if (standalone) {
      try { Object.defineProperty(window.navigator, 'standalone', { configurable: true, get: () => true }); }
      catch (e) { /* ignore */ }
    }
  }, { standalone });
}

async function seed(page, active = 'muscleup') {
  await page.addInitScript((d) => { window.__spcTodayId = d; }, active === 'boulder' ? 0 : 5);
  await page.evaluate(({ active }) => {
    const S = window.CoachStore.makeStore(), D = window.CoachData, E = window.CoachEngine;
    const state = {};
    D.worlds.forEach(w => {
      const nodes = window.CoachStore.seedStates(w, { pullup_max: 9, dips_max: 6 });
      const f = E.autoFocus(w, nodes);
      state[w.id] = { nodes, focus: { primary: f.primary, supporting: f.supporting, manual: false } };
    });
    S.setBench({ pullup_max: 9, dips_max: 6 }); S.setState(state);
    S.setProfile({ onboarded: true, activeWorld: active, days: [0, 2, 4], duration: 'normal' });
  }, { active });
  await page.reload();
}

test('1 — manifest requests portrait-primary', async ({ request }) => {
  const m = await (await request.get('manifest.webmanifest')).json();
  expect(m.orientation).toBe('portrait-primary');
});

test('2 — no code attempts a landscape lock, even on an installed/standalone launch', async ({ page }) => {
  await stubOrientation(page, { standalone: true });
  await page.goto('index.html'); await seed(page);
  const calls = await page.evaluate(() => window.__lockCalls);
  expect(calls.length).toBe(0);
  expect(await page.evaluate(() => typeof window.SPC_landscape)).toBe('undefined');
});

test('3 — Settings has no "Enter Landscape" action', async ({ page }) => {
  await stubOrientation(page);
  await page.goto('index.html'); await seed(page);
  await page.locator('.nav [data-s="profile"]').click();
  expect(await page.locator('[data-enter-landscape]').count()).toBe(0);
  expect(await page.locator('#landscapeCard').count()).toBe(0);
});

test.describe('4 — portrait is fully usable without any rotation prompt', () => {
  test.use({ viewport: PORTRAIT });

  test('Today renders immediately, no rotate hint, bottom nav is a full bar', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await expect(page.locator('.hero h1').first()).toBeVisible();
    expect(await page.locator('.rotate-hint, #rotateHint').count()).toBe(0);
    const nav = await page.locator('.nav').boundingBox();
    expect(nav.width).toBeGreaterThan(300);
    expect(nav.height).toBeLessThan(120);
  });
});

test.describe('5/6 — a physical landscape viewport remains usable (secondary, unpromoted)', () => {
  test.use({ viewport: LANDSCAPE });

  test('nav becomes a side rail and Today is two-column — but this is never suggested to the user', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    const nav = await page.locator('.nav').boundingBox();
    expect(nav.width).toBeLessThan(100);   // compact rail
    expect(nav.height).toBeGreaterThan(300);
    const cols = await page.locator('.today-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBeGreaterThan(1);
    expect(await page.locator('[data-enter-landscape], .rotate-hint').count()).toBe(0);
  });

  test('Week uses the width (multi-column) and Map/workout still render', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await page.locator('.nav [data-s="week"]').click();
    const wkCols = await page.locator('.week-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(wkCols).toBeGreaterThan(1);
    await page.locator('.nav [data-s="map"]').click();
    await expect(page.locator('.map-frame')).toBeVisible();
    await page.locator('.nav [data-s="today"]').click();
    await page.locator('.rec.sched [data-startday]').first().click();
    await expect(page.locator('.wk-runner-body')).toBeVisible();
  });
});
