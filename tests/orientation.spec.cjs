// Skill Progression Coach — REAL landscape support (Part 1 / Part 15 tests 1–8).
// Verifies the Screen Orientation API flow (standalone auto-lock + a user-safe
// "Enter Landscape" action), honest success/failure reporting, that a failed
// lock never breaks the app, and that the actual responsive layout switches on
// a physical landscape viewport while portrait stays usable.
const { test, expect } = require('@playwright/test');

const LANDSCAPE = { width: 844, height: 390 };
const PORTRAIT = { width: 390, height: 844 };

// Install a stub Screen Orientation API before any page script runs. `mode`
// controls whether lock() resolves or rejects; calls are recorded on window.
function stubOrientation(page, { resolve = true, standalone = false } = {}) {
  return page.addInitScript(({ resolve, standalone }) => {
    window.__lockCalls = [];
    const orient = {
      type: 'portrait-primary',
      lock(o) { window.__lockCalls.push(o); return resolve ? Promise.resolve() : Promise.reject(new Error('not allowed in this context')); },
      unlock() {}
    };
    try { Object.defineProperty(window.screen, 'orientation', { configurable: true, get: () => orient }); }
    catch (e) { window.screen.orientation = orient; }
    if (standalone) {
      try { Object.defineProperty(window.navigator, 'standalone', { configurable: true, get: () => true }); }
      catch (e) { /* ignore */ }
    }
    // Neutralise fullscreen so the flow doesn't actually go fullscreen in CI.
    document.documentElement.requestFullscreen = () => Promise.resolve();
  }, { resolve, standalone });
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

test('1 — manifest requests landscape-primary', async ({ request }) => {
  const m = await (await request.get('manifest.webmanifest')).json();
  expect(m.orientation).toBe('landscape-primary');
});

test('2 — installed/standalone launch attempts a landscape lock via a safe flow', async ({ page }) => {
  await stubOrientation(page, { resolve: true, standalone: true });
  await page.goto('index.html');
  const attempted = await page.evaluate(() => window.SPC_landscape.attemptedStandaloneLock);
  const calls = await page.evaluate(() => window.__lockCalls);
  expect(attempted).toBe(true);
  expect(calls).toContain('landscape-primary');
});

test('3 — a rejected orientation lock does not break the app', async ({ page }) => {
  await stubOrientation(page, { resolve: false, standalone: true });
  await page.goto('index.html'); await seed(page);
  // App still boots and Today renders despite the standalone lock rejection.
  await expect(page.locator('.rec.sched .name').first()).toBeVisible();
  const calls = await page.evaluate(() => window.__lockCalls);
  expect(calls.length).toBeGreaterThan(0); // it did try
});

test.describe('4 — Enter Landscape reports success or failure honestly', () => {
  test.use({ viewport: PORTRAIT });

  test('success path confirms landscape is active', async ({ page }) => {
    await stubOrientation(page, { resolve: true });
    await page.goto('index.html'); await seed(page);
    await page.locator('.nav [data-s="profile"]').click();
    await page.locator('[data-enter-landscape]').click();
    await expect(page.locator('#landscapeNote')).toContainText(/locked/i);
  });

  test('failure path does not pretend the device rotated', async ({ page }) => {
    await stubOrientation(page, { resolve: false });
    await page.goto('index.html'); await seed(page);
    await page.locator('.nav [data-s="profile"]').click();
    await page.locator('[data-enter-landscape]').click();
    const note = await page.locator('#landscapeNote').textContent();
    expect(note).toMatch(/wouldn.t lock|turn your phone/i);
    expect(note).not.toMatch(/locked\./i);
  });
});

test.describe('5/6 — physical landscape viewport activates the real layout', () => {
  test.use({ viewport: LANDSCAPE });

  test('nav becomes a side rail and Today is two-column', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    const nav = await page.locator('.nav').boundingBox();
    expect(nav.width).toBeLessThan(100);   // compact rail
    expect(nav.height).toBeGreaterThan(300);
    const cols = await page.locator('.today-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBeGreaterThan(1);
  });

  test('Week uses the width (multi-column) and Map/workout render in landscape', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await page.locator('.nav [data-s="week"]').click();
    const wkCols = await page.locator('.week-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(wkCols).toBeGreaterThan(1);
    // Map
    await page.locator('.nav [data-s="map"]').click();
    await expect(page.locator('.map-frame')).toBeVisible();
    // Active workout keeps target + timer side by side (two runner columns).
    await page.locator('.nav [data-s="today"]').click();
    await page.locator('.rec.sched [data-start]').first().click();
    await expect(page.locator('.wk-runner-body')).toBeVisible();
    const runnerCols = await page.locator('.wk-runner-body').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(runnerCols).toBe(2);
  });
});

test.describe('7/8 — portrait stays usable and the rotation hint is dismissible', () => {
  test.use({ viewport: PORTRAIT });

  test('portrait renders Today with a bottom nav bar (not a rail)', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await expect(page.locator('.rec.sched .name').first()).toBeVisible();
    const nav = await page.locator('.nav').boundingBox();
    expect(nav.width).toBeGreaterThan(300); // full-width bottom bar
    expect(nav.height).toBeLessThan(120);
  });

  test('the rotation hint can be dismissed and stays dismissed', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    const hint = page.locator('#rotateHint');
    await expect(hint).toBeVisible();
    await page.locator('#rotateHintClose').click();
    await expect(hint).toBeHidden();
    // Navigating around does not bring it back within the session.
    await page.locator('.nav [data-s="week"]').click();
    await expect(hint).toBeHidden();
  });
});
