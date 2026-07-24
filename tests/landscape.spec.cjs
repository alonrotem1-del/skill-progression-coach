// Skill Progression Coach — landscape-first mobile layout. Verifies the PWA
// orientation, the phone-landscape CSS override (gated on
// `orientation:landscape and max-height:620px` so desktop-viewport tests never
// see it), the portrait rotate-device fallback, and that portrait behavior is
// otherwise completely unaffected.
const { test, expect } = require('@playwright/test');

// The three required phone-landscape sizes (wide, short) vs the portrait
// dimensions used throughout the rest of the suite.
const LANDSCAPE_SIZES = [
  { width: 844, height: 390 },
  { width: 915, height: 412 },
  { width: 740, height: 360 },
];
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

async function seedClimbing(page) {
  await seed(page, 'boulder', {});
  await page.evaluate(() => {
    const S = window.CoachStore.makeStore(); const st = S.getState();
    const D = window.CoachData; const b = D.worldsById.boulder;
    st.boulder.nodes.b_v0 = { criteria: {} };
    b.nodes.find(n => n.id === 'b_v0').criteria.forEach(c => (st.boulder.nodes.b_v0.criteria[c.id] = c.target));
    st.boulder.focus = { primary: 'b_v1', supporting: 'b_silentfeet', manual: true };
    S.setState(st);
  });
  await page.reload();
}

async function noHorizontalOverflow(page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // 1px rounding fuzz
}

test.describe('manifest orientation', () => {
  test('orientation is landscape-primary', async ({ request }) => {
    const m = await (await request.get('manifest.webmanifest')).json();
    expect(m.orientation).toBe('landscape-primary');
  });
});

function defineLandscapeTests(viewport) {
  const label = `${viewport.width}x${viewport.height}`;

  test.describe(`phone-landscape layout @ ${label}`, () => {
    test.use({ viewport });

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
      await expect(page.locator('.rotate-hint')).toBeHidden();
      await noHorizontalOverflow(page);
    });

    test('side nav rail replaces the bottom bar and reserves space via padding', async ({ page }) => {
      await page.goto('index.html'); await seed(page);
      const navBox = await page.locator('.nav').boundingBox();
      expect(navBox.width).toBeLessThan(100);        // narrow rail, not a full-width bar
      expect(navBox.height).toBeGreaterThan(300);     // spans the viewport height
      expect(navBox.x).toBeLessThan(10);              // pinned to the left edge
      // .scr reserves left padding for the rail so its actual content
      // (not the full-bleed box itself) starts clear of it.
      const scrPadLeft = await page.locator('.scr').first().evaluate(el => parseFloat(getComputedStyle(el).paddingLeft));
      expect(scrPadLeft).toBeGreaterThanOrEqual(navBox.width - 2);
      const contentBox = await page.locator('.today-grid, .map-head, .settings-list, .progress-grid').first().boundingBox();
      expect(contentBox.x).toBeGreaterThanOrEqual(navBox.x + navBox.width - 2); // content clears the rail
    });

    test('Skill Map keeps the world rail outside the canvas, centers on focus without clipping it, and keeps the center control visible', async ({ page }) => {
      await page.goto('index.html'); await seed(page);
      await page.locator('.nav [data-s="map"]').click();
      await expect(page.locator('#rail')).toBeVisible();
      expect(await page.locator('.canvas-wrap #rail').count()).toBe(0); // rail is outside the blue canvas
      await expect(page.locator('[data-center]')).toBeVisible();        // center-on-focus control visible
      const frameBox = await page.locator('.map-frame').boundingBox();
      const railBox = await page.locator('#rail').boundingBox();
      // The tree gets most of the width — canvas area is much wider than the rail.
      expect(frameBox.width - railBox.width).toBeGreaterThan(railBox.width * 3);
      // The current-focus node is fully scrolled into view, not clipped at an edge.
      const sc = page.locator('#cscroll');
      const scBox = await sc.boundingBox();
      const curBox = await page.locator('.node.current').boundingBox();
      expect(curBox.x).toBeGreaterThanOrEqual(scBox.x - 2);
      expect(curBox.x + curBox.width).toBeLessThanOrEqual(scBox.x + scBox.width + 2);
      expect(curBox.y).toBeGreaterThanOrEqual(scBox.y - 2);
      expect(curBox.y + curBox.height).toBeLessThanOrEqual(scBox.y + scBox.height + 2);
      await noHorizontalOverflow(page); // the canvas pans within its own container only
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

    test('Active workout keeps the current target on the left and the timer/overview on the right, both visible without scrolling', async ({ page }) => {
      await page.goto('index.html'); await seed(page);
      await page.locator('[data-start]').first().click();
      await expect(page.locator('.wk-runner-body')).toBeVisible();
      const curBox = await page.locator('.cur-card').first().boundingBox();
      const overviewBox = await page.locator('.round-overview').first().boundingBox();
      expect(curBox.x).toBeLessThan(overviewBox.x); // current action left, overview right
      // Log a set/step so the rest timer starts, then confirm the new
      // current target and the running timer are both visible together
      // (scrolled to the top, the natural resting position after a step).
      await page.locator('.cur-card [data-done]').first().click();
      await expect(page.locator('#rest .timer')).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      const vp = page.viewportSize();
      const newCurBox = await page.locator('.cur-card').first().boundingBox();
      const restBox = await page.locator('#rest').boundingBox();
      expect(newCurBox.y + newCurBox.height).toBeLessThanOrEqual(vp.height + 2);
      expect(restBox.y + restBox.height).toBeLessThanOrEqual(vp.height + 2);
      expect(newCurBox.x).toBeLessThan(restBox.x); // target stays left, timer stays right
      await noHorizontalOverflow(page);
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
    });

    test('Climbing session keeps the objective and current-problem controls on the left, and the log/rest timer/checks on the right', async ({ page }) => {
      await page.goto('index.html'); await seedClimbing(page);
      await page.locator('[data-start]').first().click();
      await expect(page.locator('.climb-grid')).toBeVisible();
      const leftBox = await page.locator('.climb-left').boundingBox();
      const rightBox = await page.locator('.climb-right').boundingBox();
      expect(leftBox.x).toBeLessThan(rightBox.x);
      await expect(page.locator('.climb-left [data-grades]')).toBeVisible();
      // #rest lives in the right column structurally (it renders once a rest
      // timer is running; the climbing flow doesn't start one automatically,
      // so we only assert its position in the DOM here).
      expect(await page.locator('.climb-right #rest').count()).toBe(1);
      // Log an attempt quickly and confirm it lands in the right-column log.
      await page.locator('[data-g="V1"]').click();
      await page.locator('[data-s="vertical"]').click();
      await page.locator('[data-r="send"]').click();
      await page.locator('[data-add]').click();
      await expect(page.locator('.climb-right .prob').first()).toBeVisible();
      await expect(page.locator('.climb-right [data-seg="finger"]').first()).toBeVisible();
      await noHorizontalOverflow(page);
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
      await noHorizontalOverflow(page);
    });
  });
}

LANDSCAPE_SIZES.forEach(defineLandscapeTests);

test.describe('portrait fallback (rotate-device suggestion)', () => {
  test.use({ viewport: PORTRAIT });

  test('shows a concise, non-blocking rotate suggestion and preserves the main flow', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    const hint = page.locator('.rotate-hint');
    await expect(hint).toBeVisible();
    const text = (await hint.innerText()).trim();
    expect(text.length).toBeLessThan(80); // concise, not a wall of text
    // Non-blocking: it sits in normal flow (not covering the app), and the
    // main flow (start the recommended workout) stays fully reachable.
    const hintBox = await hint.boundingBox();
    const startBox = await page.locator('[data-start]').first().boundingBox();
    expect(startBox.y).toBeGreaterThanOrEqual(hintBox.y + hintBox.height - 2);
    await page.locator('[data-start]').first().click();
    await expect(page.locator('.wk-block-wrap').first()).toBeVisible();
  });

  test('rotate suggestion can be dismissed', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await expect(page.locator('.rotate-hint')).toBeVisible();
    await page.locator('#rotateHintClose').click();
    await expect(page.locator('.rotate-hint')).toBeHidden();
  });

  test('does not appear on a tablet/desktop-sized portrait window', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 1366 });
    await page.goto('index.html'); await seed(page);
    await expect(page.locator('.rotate-hint')).toBeHidden();
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

  test('climbing session still stacks the logging form above the log', async ({ page }) => {
    await page.goto('index.html'); await seedClimbing(page);
    await page.locator('[data-start]').first().click();
    const leftBox = await page.locator('.climb-left').boundingBox();
    const rightBox = await page.locator('.climb-right').boundingBox();
    expect(rightBox.y).toBeGreaterThanOrEqual(leftBox.y + leftBox.height - 5); // stacked, right below left
  });
});
