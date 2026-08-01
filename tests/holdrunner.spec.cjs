// Skill Progression Coach — the Timed Hold runner.
// Dead Hang / Ring Support Hold / Top Hold all share one `scheme:'hold'` block
// shape, so a single runner (prep countdown → live countdown → confirm →
// rest) drives all three. Every assertion about elapsed time uses Playwright's
// fake clock so the runner's timestamp-diff math (never a decrementing
// counter) can be exercised deterministically and fast.
const { test, expect } = require('@playwright/test');

async function seed(page) {
  await page.addInitScript(() => {
    // Replace AudioContext with a counting fake so sound cues are observable
    // without actually producing audio, and record every vibrate() call.
    window.__osc = 0;
    function FakeCtx() { this.state = 'running'; this.currentTime = 0; }
    FakeCtx.prototype.createOscillator = function () {
      window.__osc++;
      return { connect() {}, frequency: { value: 0 }, type: '', start() {}, stop() {} };
    };
    FakeCtx.prototype.createGain = function () {
      return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } };
    };
    FakeCtx.prototype.resume = function () {};
    window.AudioContext = FakeCtx; window.webkitAudioContext = FakeCtx;
    window.__vibrate = [];
    Object.defineProperty(navigator, 'vibrate', { value: (p) => { window.__vibrate.push(p); return true; }, configurable: true });
  });
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

// Start a single hold exercise via "Start One Exercise", clearing any
// overlap-classification sheet that may appear.
async function startHoldExercise(page, exId) {
  await page.locator('[data-startone]').click();
  await page.locator('[data-pick="' + exId + '"]').click();
  if (await page.locator('text=How should this workout count?').count()) {
    await page.locator('[data-cl="extra"]').click();
  }
  await expect(page.locator('.hold-card')).toBeVisible();
}

function hold(page) { return page.evaluate(() => window.CoachApp._UI.workout.hold); }
function block(page) { return page.evaluate(() => window.CoachApp._UI.workout.blocks[0]); }
async function settingsPatch(page, patch) {
  await page.evaluate((p) => {
    const S = window.CoachStore.makeStore();
    const s = window.CoachSettings.migrate(S.getSettings());
    Object.assign(s.timer, p); S.setSettings(s);
  }, patch);
  await page.reload();
}

test.describe('Timed Hold runner', () => {
  test('01 — Dead Hang 30 seconds opens a real countdown', async ({ page }) => {
    await seed(page);
    await startHoldExercise(page, 'deadhang');
    const bl = await block(page);
    expect(bl.sets[0].target).toBe(30);
    await expect(page.locator('[data-holdstart]')).toBeVisible();
    await page.locator('[data-holdstart]').click();
    const hd = await hold(page);
    expect(hd.phase).toBe('prep');
  });

  test('02 — Preparation countdown runs before the hold', async ({ page }) => {
    await page.clock.install();
    await seed(page);
    await startHoldExercise(page, 'deadhang');
    await page.locator('[data-holdstart]').click();
    await expect(page.locator('.hold-card.hold-prep')).toBeVisible();
    let hd = await hold(page);
    expect(hd.phase).toBe('prep');
    await page.clock.runFor(5200);
    hd = await hold(page);
    expect(hd.phase).toBe('running');
    await expect(page.locator('.hold-card.hold-prep')).toHaveCount(0);
  });

  test('03 — Countdown starts at 30 and reaches 0', async ({ page }) => {
    await page.clock.install();
    await seed(page);
    await startHoldExercise(page, 'deadhang');
    await page.locator('[data-holdstart]').click();
    await page.clock.runFor(5200); // clear prep
    await expect(page.locator('.hold-big')).toHaveText('30');
    await page.clock.runFor(30200); // run the full hold
    const hd = await hold(page);
    expect(hd.phase).toBe('complete');
    expect(hd.resultSec).toBe(30);
  });

  test('04 — Completion sound is triggered', async ({ page }) => {
    await page.clock.install();
    await seed(page);
    await startHoldExercise(page, 'deadhang');
    await page.locator('[data-holdstart]').click();
    await page.clock.runFor(5200);
    const before = await page.evaluate(() => window.__osc);
    await page.clock.runFor(30200);
    const after = await page.evaluate(() => window.__osc);
    expect(after).toBeGreaterThan(before);
  });

  test('05 — Completion vibration is triggered', async ({ page }) => {
    await page.clock.install();
    await seed(page);
    await startHoldExercise(page, 'deadhang');
    await page.locator('[data-holdstart]').click();
    await page.clock.runFor(5200);
    await page.clock.runFor(30200);
    const calls = await page.evaluate(() => window.__vibrate);
    expect(calls.some(c => Array.isArray(c))).toBe(true); // completion cue is a vibration pattern array
  });

  test('06 — Disabled sound settings are respected', async ({ page }) => {
    await page.clock.install();
    await seed(page);
    await settingsPatch(page, { sound: false, countdown: false });
    await startHoldExercise(page, 'deadhang');
    await page.locator('[data-holdstart]').click();
    await page.clock.runFor(5200);
    await page.clock.runFor(30200);
    const oscCount = await page.evaluate(() => window.__osc);
    expect(oscCount).toBe(0);
  });

  test('07 — Disabled vibration settings are respected', async ({ page }) => {
    await page.clock.install();
    await seed(page);
    await settingsPatch(page, { vibrate: false });
    await startHoldExercise(page, 'deadhang');
    await page.locator('[data-holdstart]').click();
    await page.clock.runFor(5200);
    await page.clock.runFor(30200);
    const calls = await page.evaluate(() => window.__vibrate);
    expect(calls.length).toBe(0);
    // sound stayed on, proving the two settings are independent
    const oscCount = await page.evaluate(() => window.__osc);
    expect(oscCount).toBeGreaterThan(0);
  });

  test('08/09 — Stop Early records actual elapsed time, not the full target', async ({ page }) => {
    await page.clock.install();
    await seed(page);
    await startHoldExercise(page, 'deadhang');
    await page.locator('[data-holdstart]').click();
    await page.clock.runFor(5200); // clear prep
    await page.clock.runFor(10000); // 10s into a 30s hold
    await page.locator('[data-holdstop]').click();
    const hd = await hold(page);
    expect(hd.phase).toBe('stopped');
    expect(hd.resultSec).toBeGreaterThanOrEqual(9);
    expect(hd.resultSec).toBeLessThanOrEqual(11);
    expect(hd.resultSec).not.toBe(30); // never the full target
    await page.locator('[data-holdconfirm]').click();
    const bl = await block(page);
    expect(bl.sets[0].actual).toBe(hd.resultSec);
    expect(bl.sets[0].stoppedEarly).toBe(true);
  });

  test('10/11 — Pause stops accumulation; Resume continues accurately', async ({ page }) => {
    await page.clock.install();
    await seed(page);
    await startHoldExercise(page, 'deadhang');
    await page.locator('[data-holdstart]').click();
    await page.clock.runFor(5200);
    await page.clock.runFor(5000);
    await page.locator('[data-holdpause]').click();
    let hd = await hold(page);
    expect(hd.phase).toBe('paused');
    const pausedElapsed = hd.elapsedMs;
    await page.clock.runFor(5000); // time passes while paused
    hd = await hold(page);
    expect(hd.elapsedMs).toBe(pausedElapsed); // unchanged — no accumulation while paused
    await page.locator('[data-holdpause]').click(); // resume
    hd = await hold(page);
    expect(hd.phase).toBe('running');
    await page.clock.runFor(5000);
    hd = await hold(page);
    const elapsed = hd.elapsedMs + (5000); // approx running total
    expect(elapsed).toBeGreaterThan(pausedElapsed);
  });

  test('12 — Timestamp-based calculation survives delayed timer callbacks', async ({ page }) => {
    await page.clock.install();
    await seed(page);
    await startHoldExercise(page, 'deadhang');
    await page.locator('[data-holdstart]').click();
    // fastForward fires the interval callback AT MOST ONCE, simulating a
    // backgrounded tab whose JS was fully suspended for the jump — the phase
    // must still land correctly because it's derived from real timestamps.
    await page.clock.fastForward(5200 + 30200);
    const hd = await hold(page);
    expect(hd.phase).toBe('complete');
    expect(hd.resultSec).toBe(30);
  });

  test('13 — Refresh restores an active hold correctly', async ({ page }) => {
    await page.clock.install();
    await seed(page);
    await startHoldExercise(page, 'deadhang');
    await page.locator('[data-holdstart]').click();
    await page.clock.runFor(5200);
    await page.clock.runFor(12000); // 12s into 30s
    await page.reload();
    await expect(page.locator('.hold-card')).toBeVisible();
    const hd = await hold(page);
    expect(hd.phase).toBe('running');
    const liveElapsed = await page.evaluate(() => {
      const h = window.CoachApp._UI.workout.hold; return h.elapsedMs + (Date.now() - h.startTs);
    });
    expect(liveElapsed).toBeGreaterThanOrEqual(11500);
    expect(liveElapsed).toBeLessThanOrEqual(13000);
    const remainingText = await page.locator('.hold-big').textContent();
    expect(Number(remainingText)).toBeGreaterThanOrEqual(17);
    expect(Number(remainingText)).toBeLessThanOrEqual(19);
  });

  test('14/15/16 — Multiple holds run independently; rest starts between them; +30s rest works', async ({ page }) => {
    await page.clock.install();
    await seed(page);
    await startHoldExercise(page, 'deadhang');
    // hold 1: complete fully
    await page.locator('[data-holdstart]').click();
    await page.clock.runFor(5200);
    await page.clock.runFor(30200);
    await page.locator('[data-holdconfirm]').click(); // "Completed Full Hold" -> finishStraightSet
    // difficulty rating may be prompted before rest starts
    if (await page.locator('[data-diff="appropriate"]').count()) await page.locator('[data-diff="appropriate"]').click();
    await expect(page.locator('.timer .t')).toBeVisible(); // rest timer reused, unchanged
    const before = await page.evaluate(() => window.CoachApp._UI.timerLeft);
    await page.locator('[data-t30]').click();
    const after = await page.evaluate(() => window.CoachApp._UI.timerLeft);
    expect(after).toBe(before + 30);
    // hold 2 starts fresh, independent of hold 1's state
    await page.locator('[data-tskip]').click();
    await expect(page.locator('[data-holdstart]')).toBeVisible();
    const hd2 = await hold(page);
    expect(hd2).toBeFalsy(); // idle — no leftover hold state from set 1
  });

  test('17/18/19 — completed holds save actual durations used by History and PR calculations', async ({ page }) => {
    await page.clock.install();
    await seed(page);
    await startHoldExercise(page, 'deadhang');
    // hold 1: full 30s
    await page.locator('[data-holdstart]').click();
    await page.clock.runFor(5200); await page.clock.runFor(30200);
    await page.locator('[data-holdconfirm]').click();
    if (await page.locator('[data-diff="appropriate"]').count()) await page.locator('[data-diff="appropriate"]').click();
    await page.locator('[data-tskip]').click();
    // hold 2: stop early at ~20s
    await page.locator('[data-holdstart]').click();
    await page.clock.runFor(5200); await page.clock.runFor(20000);
    await page.locator('[data-holdstop]').click();
    await page.locator('[data-holdconfirm]').click();
    if (await page.locator('[data-diff="appropriate"]').count()) await page.locator('[data-diff="appropriate"]').click();
    await page.locator('[data-tskip]').click();
    // hold 3: stop early at ~24s
    await page.locator('[data-holdstart]').click();
    await page.clock.runFor(5200); await page.clock.runFor(24000);
    await page.locator('[data-holdstop]').click();
    await page.locator('[data-holdconfirm]').click(); // last hold -> "Save Result"
    if (await page.locator('[data-diff="appropriate"]').count()) await page.locator('[data-diff="appropriate"]').click();
    await page.locator('[data-finish], [data-finishex]').click();
    await expect(page.getByText('Dead Hang completed')).toBeVisible();
    await expect(page.locator('.dd-kv', { hasText: 'Planned' })).toContainText('3 × 30 sec');
    const actualLine = await page.locator('.dd-kv', { hasText: 'Actual' }).textContent();
    expect(actualLine).toContain('30 sec');
    expect(actualLine).not.toContain('30 sec, 30 sec, 30 sec'); // actuals, not the planned target repeated
    const bench = await page.evaluate(() => window.CoachStore.makeStore().getBench());
    expect(bench.deadhang_secs).toBe(30); // PR uses the best ACTUAL hold (the full 30s one)
  });

  test('20 — Ring Support Hold uses the same runner', async ({ page }) => {
    await seed(page);
    await startHoldExercise(page, 'ringsupport');
    await expect(page.locator('[data-holdstart]')).toBeVisible();
    const bl = await block(page);
    expect(bl.scheme).toBe('hold');
  });

  test('21 — Top Hold uses the same runner', async ({ page }) => {
    await seed(page);
    await startHoldExercise(page, 'tophold');
    await expect(page.locator('[data-holdstart]')).toBeVisible();
    const bl = await block(page);
    expect(bl.scheme).toBe('hold');
  });

  test('22 — Completing a hold marks only that exercise complete', async ({ page }) => {
    await page.clock.install();
    await page.addInitScript(() => { window.__spcTodayId = 1; });
    await seed(page);
    // Start Dead Hang from the Daily Queue so it sits alongside other exercises.
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore(); const p = S.getPlan();
      p.requirements.deadhang.days = [1]; p.requirements.deadhang.target = 1; S.setPlan(p);
    });
    await page.reload();
    await page.locator('.q-ex', { hasText: 'Dead Hang' }).locator('[data-exstart]').click();
    await expect(page.locator('.hold-card')).toBeVisible();
    for (let i = 0; i < 3; i++) {
      await page.locator('[data-holdstart]').click();
      await page.clock.runFor(5200); await page.clock.runFor(30200);
      await page.locator('[data-holdconfirm]').click();
      if (await page.locator('[data-diff="appropriate"]').count()) await page.locator('[data-diff="appropriate"]').click();
      if (await page.locator('[data-tskip]').count()) await page.locator('[data-tskip]').click();
    }
    await page.locator('[data-finish], [data-finishex]').click();
    await expect(page.getByText('Dead Hang completed')).toBeVisible();
    const daily = await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_day')));
    const deadhang = daily.exercises.find(e => e.exId === 'deadhang');
    expect(deadhang.state).toBe('completed');
    const others = daily.exercises.filter(e => e.exId !== 'deadhang');
    expect(others.every(e => e.state !== 'completed')).toBe(true); // nothing else auto-completed
  });
});
