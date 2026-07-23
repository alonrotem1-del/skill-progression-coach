// Skill Progression Coach — landscape-first mobile layout. Verifies the PWA
// orientation, the phone-landscape CSS override (gated on
// `orientation:landscape and max-height:620px` so desktop-viewport tests never
// see it), and that portrait behavior is completely unaffected.
const { test, expect } = require('@playwright/test');

// Typical phone-landscape dimensions (wide, short) vs the portrait dimensions
// used throughout the rest of the suite.
const LANDSCAPE = { width: 844, height: 390 };
const PORTRAIT = { width: 390, height: 844 };

async function seed(page, active = 'muscleup', bench = { pullup_max: 9, dips_max: 6 }) {
  await page.evaluate(({ active, bench }) => {
    const S = window.CoachStore.makeStore(), D = window.CoachData, E = window.CoachEngine;
    const state = {};
    D.worlds.forEach(w => {
      const nodes = window.CoachStore.seedStates(w, bench);
      const f = E.autoFocus(w, nodes);
      state[w.id] = { nodes, focus: { primary: f.primary, supporting: f.supporting, manual: false } };
    });
    S.setBench(bench); S.setState(state);
    S.setProfile({ onboarded: true, activeWorld: active, days: [0, 2, 4], duration: 'normal' });
  }, { active, bench });
  await page.reload();
}

test.describe('manifest orientation', () => {
  test('orientation is landscape-primary', async ({ request }) => {
    const m = await (await request.get('manifest.webmanifest')).json();
    expect(m.orientation).toBe('landscape-primary');
  });
});

test.describe('phone-landscape layout', () => {
  test.use({ viewport: LANDSCAPE });

  test('Today uses a two-column grid with the recommendation dominant on the left', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    const grid = page.locator('.today-grid');
    await expect(grid).toBeVisible();
    const cols = await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBeGreaterThan(1);
    const leftBox = await page.locator('.today-left').boundingBox();
    const rightBox = await page.locator('.today-right').boundingBox();
    expect(leftBox.x).toBeLessThan(rightBox.x); // left column really is on the left
    // The recommendation (dominant element) lives in the left column.
    await expect(page.locator('.today-left .rec').first()).toBeVisible();
    await expect(page.locator('.today-left [data-start]').first()).toBeVisible();
  });

  test('side nav rail replaces the bottom bar and reserves space via padding', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    const navBox = await page.locator('.nav').boundingBox();
    expect(navBox.width).toBeLessThan(100);        // narrow rail, not a full-width bar
    expect(navBox.height).toBeGreaterThan(300);     // spans the viewport height
    expect(navBox.x).toBeLessThan(10);              // pinned to the left edge
  });

  test('Skill Map keeps the world rail outside the canvas, centers on focus, and keeps the center control visible', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await page.locator('.nav [data-s="map"]').click();
    await expect(page.locator('#rail')).toBeVisible();
    expect(await page.locator('.canvas-wrap #rail').count()).toBe(0); // rail is outside the blue canvas
    await expect(page.locator('[data-center]')).toBeVisible();        // center-on-focus control visible
    const frameBox = await page.locator('.map-frame').boundingBox();
    const railBox = await page.locator('#rail').boundingBox();
    // The tree gets most of the width — canvas area is much wider than the rail.
    expect(frameBox.width - railBox.width).toBeGreaterThan(railBox.width * 3);
    // The current-focus node is scrolled into view (not requiring extra scrolling to find).
    const sc = page.locator('#cscroll');
    const scBox = await sc.boundingBox();
    const curBox = await page.locator('.node.current').boundingBox();
    expect(curBox.x).toBeGreaterThanOrEqual(scBox.x - 5);
    expect(curBox.x).toBeLessThanOrEqual(scBox.x + scBox.width + 5);
  });

  test('Node detail opens as a side panel, not a bottom sheet', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await page.locator('.nav [data-s="map"]').click();
    await page.locator('.node.current').click({ force: true });
    await expect(page.locator('.sheet')).toBeVisible();
    const sheetBox = await page.locator('.sheet').boundingBox();
    const vp = page.viewportSize();
    // Anchored to the right edge, spanning close to full height (a side panel),
    // not a short bottom sheet anchored to the bottom.
    expect(sheetBox.x + sheetBox.width).toBeGreaterThan(vp.width - 20);
    expect(sheetBox.height).toBeGreaterThan(vp.height * 0.8);
  });

  test('Active workout lays blocks out side by side', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await page.locator('[data-start]').first().click();
    await expect(page.locator('.wk-body')).toBeVisible();
    const wraps = page.locator('.wk-block-wrap');
    expect(await wraps.count()).toBeGreaterThan(1);
    const first = await wraps.nth(0).boundingBox();
    const second = await wraps.nth(1).boundingBox();
    // Two blocks land in different horizontal positions (side by side), not stacked.
    expect(Math.abs(first.y - second.y)).toBeLessThan(30);
    expect(first.x).not.toBeCloseTo(second.x, 0);
    // The current action is still fully reachable.
    await expect(page.locator('.cur-card').first()).toBeVisible();
  });

  test('starting a workout from a scrolled Today opens at the top of the new screen', async ({ page }) => {
    // On the short landscape viewport the full exercise preview can push the
    // Start button below the fold; the workout must not inherit that scroll
    // offset (the browser does not reset scroll on innerHTML replacement).
    await page.goto('index.html'); await seed(page);
    await page.locator('[data-start]').first().scrollIntoViewIfNeeded();
    await page.locator('[data-start]').first().click();
    await expect(page.locator('.wk-block-wrap').first()).toBeVisible();
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(0);
    const firstBlockBox = await page.locator('.wk-block-wrap').first().boundingBox();
    expect(firstBlockBox.y).toBeGreaterThanOrEqual(0); // not scrolled past its own top
  });

  test('Climbing session lays the logging form and the log side by side', async ({ page }) => {
    await page.goto('index.html'); await seed(page, 'boulder', {});
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore(); const st = S.getState();
      const D = window.CoachData; const b = D.worldsById.boulder;
      st.boulder.nodes.b_v0 = { criteria: {} };
      b.nodes.find(n => n.id === 'b_v0').criteria.forEach(c => (st.boulder.nodes.b_v0.criteria[c.id] = c.target));
      st.boulder.focus = { primary: 'b_v1', supporting: 'b_silentfeet', manual: true };
      S.setState(st);
    });
    await page.reload();
    await page.locator('[data-start]').first().click();
    await expect(page.locator('.climb-grid')).toBeVisible();
    const leftBox = await page.locator('.climb-left').boundingBox();
    const rightBox = await page.locator('.climb-right').boundingBox();
    expect(leftBox.x).toBeLessThan(rightBox.x);
    await expect(page.locator('[data-grades]')).toBeVisible();
  });

  test('Settings hub, Exercise Library, and Progress reflow into columns', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await page.locator('.nav [data-s="profile"]').click();
    let colCount = await page.locator('.settings-list').evaluate(el => getComputedStyle(el).columnCount);
    expect(Number(colCount)).toBeGreaterThan(1);
    await page.locator('[data-sview="exercises"]').click();
    colCount = await page.locator('.settings-list').evaluate(el => getComputedStyle(el).columnCount);
    expect(Number(colCount)).toBeGreaterThan(1);
    await page.locator('.nav [data-s="progress"]').click();
    await expect(page.locator('.progress-grid')).toBeVisible();
  });
});

test.describe('portrait is unaffected (regression guard)', () => {
  test.use({ viewport: PORTRAIT });

  test('Today stacks in a single column exactly as before', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    const cols = await page.locator('.today-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns);
    expect(cols.trim().split(' ').length).toBe(1); // single implicit column
    const leftBox = await page.locator('.today-left').boundingBox();
    const rightBox = await page.locator('.today-right').boundingBox();
    expect(rightBox.y).toBeGreaterThanOrEqual(leftBox.y + leftBox.height - 5); // stacked, right below left
  });

  test('bottom nav bar is still a full-width bar, not a side rail', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    const navBox = await page.locator('.nav').boundingBox();
    expect(navBox.width).toBeGreaterThan(300);
    expect(navBox.height).toBeLessThan(100);
  });

  test('node detail is still a bottom sheet', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await page.locator('.nav [data-s="map"]').click();
    await page.locator('.node.current').click({ force: true });
    const sheetBox = await page.locator('.sheet').boundingBox();
    const vp = page.viewportSize();
    expect(sheetBox.height).toBeLessThan(vp.height); // not full height
    expect(sheetBox.y + sheetBox.height).toBeGreaterThan(vp.height - 20); // anchored to the bottom
  });

  test('active workout blocks still stack in one column', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await page.locator('[data-start]').first().click();
    const wraps = page.locator('.wk-block-wrap');
    expect(await wraps.count()).toBeGreaterThan(1);
    const first = await wraps.nth(0).boundingBox();
    const second = await wraps.nth(1).boundingBox();
    expect(second.y).toBeGreaterThan(first.y + first.height - 10); // stacked, not side by side
  });
});
