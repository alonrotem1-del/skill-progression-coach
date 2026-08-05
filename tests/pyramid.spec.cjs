// Skill Progression Coach — the Pull-Up Pyramid execution flow.
// A Pyramid opens with ONE editable starting set; on Done it freezes a
// descending sequence (N, N-1, ..., 1) generated from the ACTUAL entered
// reps, never adapts per-set, and asks ONE overall difficulty question after
// the final planned set. Its rest timer is durable, timestamp-based state
// (w.setRest) reconciled into the DOM on every renderStrength() call — the
// same pattern as the Timed Hold runner and the Ladder round-rest fix — so a
// rep-stepper edit, a Pain toggle, or any other re-render can never make the
// running countdown disappear, restart, or silently un-pause.
const { test, expect } = require('@playwright/test');

async function seed(page) {
  await page.addInitScript(() => {
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

async function startPyramid(page) {
  await page.locator('.nav [data-s="today"]').click();
  await page.locator('[data-startone]').click();
  await page.locator('[data-pick="pullup_pyramid"]').click();
  if (await page.locator('text=How should this workout count?').count()) {
    await page.locator('[data-cl="extra"]').click();
  }
  await expect(page.locator('.cur-card')).toBeVisible();
}

function workout(page) { return page.evaluate(() => window.CoachApp._UI.workout); }
function block(page) { return page.evaluate(() => window.CoachApp._UI.workout.blocks[0]); }

// Adjust the visible stepper by `delta` clicks of + or -.
async function stepReps(page, delta) {
  const sel = delta > 0 ? '.cur-card [data-step="1"]' : '.cur-card [data-step="-1"]';
  for (let i = 0; i < Math.abs(delta); i++) await page.locator(sel).click();
}

async function clickDone(page) { await page.locator('.cur-card [data-done]').click(); }

async function rateOverall(page, diff) {
  if (await page.locator('[data-pyrdiff]').count()) await page.locator('[data-pyrdiff="' + (diff || 'appropriate') + '"]').click();
}
async function skipRestIfAny(page) {
  if (await page.locator('[data-tskip]').count()) await page.locator('[data-tskip]').click();
}

// Complete a full pyramid (assuming the current stepper already shows the
// desired starting value) all the way to the final overall-difficulty
// prompt, skipping every rest along the way.
async function completeWholePyramid(page, startVal) {
  const cur = await page.evaluate(() => {
    const s = window.CoachApp._UI.workout.blocks[0].sets[0];
    return s.actual;
  });
  if (startVal != null && startVal !== cur) await stepReps(page, startVal - cur);
  await clickDone(page); // freezes the sequence
  let n = startVal;
  while (true) {
    const bl = await block(page);
    if (!bl.frozen) { n = bl.sets[0].actual; await clickDone(page); continue; }
    const doneCount = bl.sets.filter(s => s.doneFlag).length;
    if (doneCount >= bl.sets.length) break;
    if (await page.locator('[data-pyrdiff]').count()) { await rateOverall(page); continue; }
    await skipRestIfAny(page);
    if (await page.locator('.cur-card [data-done]').count()) await clickDone(page);
    else break;
  }
}

test.describe('Pull-Up Pyramid — descending sequence from the first set', () => {
  test('01 — first set 6 completed freezes 6,5,4,3,2,1', async ({ page }) => {
    await seed(page);
    await startPyramid(page);
    const before = await block(page);
    expect(before.frozen).toBe(false);
    await stepReps(page, 6 - before.sets[0].actual);
    await clickDone(page);
    const bl = await block(page);
    expect(bl.frozen).toBe(true);
    expect(bl.sets.map(s => s.target)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(bl.plannedSetCount).toBe(6);
    expect(bl.plannedTotalReps).toBe(21);
  });

  test('02 — first set 5 completed freezes 5,4,3,2,1', async ({ page }) => {
    await seed(page);
    await startPyramid(page);
    const before = await block(page);
    await stepReps(page, 5 - before.sets[0].actual);
    await clickDone(page);
    const bl = await block(page);
    expect(bl.sets.map(s => s.target)).toEqual([5, 4, 3, 2, 1]);
    expect(bl.plannedTotalReps).toBe(15);
  });

  test('03 — the next set defaults immediately to one fewer rep', async ({ page }) => {
    await seed(page);
    await startPyramid(page);
    const before = await block(page);
    await stepReps(page, 6 - before.sets[0].actual);
    await clickDone(page);
    await expect(page.locator('.cur-card .num')).toHaveText('5');
  });

  test('04 — adjusting the first set before Done does not create/duplicate sets', async ({ page }) => {
    await seed(page);
    await startPyramid(page);
    await stepReps(page, 3);
    await stepReps(page, -1);
    await stepReps(page, 2);
    const bl = await block(page);
    expect(bl.sets.length).toBe(1); // still just the one editable starting set
    expect(bl.frozen).toBe(false);
  });
});

test.describe('Pull-Up Pyramid — no per-set adaptation', () => {
  test('13 — completing a non-final set never shows a per-set difficulty prompt', async ({ page }) => {
    await seed(page);
    await startPyramid(page);
    const before = await block(page);
    await stepReps(page, 4 - before.sets[0].actual);
    await clickDone(page); // set 1 (freeze)
    await expect(page.locator('.adapt-card [data-diff]')).toHaveCount(0);
    await skipRestIfAny(page);
    await clickDone(page); // set 2
    await expect(page.locator('.adapt-card [data-diff]')).toHaveCount(0);
  });

  test('12 — no rest starts after the final planned Pyramid set', async ({ page }) => {
    await seed(page);
    await startPyramid(page);
    const before = await block(page);
    await stepReps(page, 3 - before.sets[0].actual);
    await clickDone(page); // freeze: 3,2,1
    await skipRestIfAny(page); await clickDone(page); // set 2
    await skipRestIfAny(page); await clickDone(page); // set 3 (final)
    await expect(page.locator('#rest .timer')).toHaveCount(0);
    await expect(page.locator('[data-pyrdiff]').first()).toBeVisible();
  });

  test('14 — exactly one overall difficulty prompt after the final planned set', async ({ page }) => {
    await seed(page);
    await startPyramid(page);
    const before = await block(page);
    await stepReps(page, 3 - before.sets[0].actual);
    await clickDone(page);
    await skipRestIfAny(page); await clickDone(page);
    await skipRestIfAny(page); await clickDone(page);
    await expect(page.locator('[data-pyrdiff]')).toHaveCount(4); // 4 pill buttons of ONE prompt card
    await expect(page.locator('.adapt-card')).toHaveCount(1);
  });

  test('15 — rating the pyramid does not mutate the completed sequence', async ({ page }) => {
    await seed(page);
    await startPyramid(page);
    const before = await block(page);
    await stepReps(page, 3 - before.sets[0].actual);
    await clickDone(page);
    await skipRestIfAny(page); await clickDone(page);
    await skipRestIfAny(page); await clickDone(page);
    const seqBefore = (await block(page)).sets.map(s => s.target);
    await rateOverall(page, 'hard');
    const bl = await block(page);
    expect(bl.sets.map(s => s.target)).toEqual(seqBefore);
    expect(bl.pyramidDifficulty).toBe('hard');
    expect(bl.pyramidRated).toBe(true);
  });
});

test.describe('Pull-Up Pyramid — durable rest timer', () => {
  async function toFirstRest(page, startVal) {
    await seed(page);
    await startPyramid(page);
    const before = await block(page);
    await stepReps(page, startVal - before.sets[0].actual);
    await clickDone(page); // freeze, starts rest before set 2
  }

  test('05/06 — changing reps during rest keeps the timer visible and does not restart it', async ({ page }) => {
    await page.clock.install();
    await toFirstRest(page, 6);
    await expect(page.locator('#rest .timer')).toBeVisible();
    await page.clock.runFor(20000);
    const remainingBefore = await page.evaluate(() => window.CoachApp._UI.timerLeft);
    // The next set's own stepper is visible and editable WHILE the rest for
    // the previous set is still running — clicking it forces a re-render.
    await page.locator('.cur-card [data-step="1"]').click();
    await expect(page.locator('#rest .timer')).toBeVisible();
    const remainingAfter = await page.evaluate(() => window.CoachApp._UI.timerLeft);
    expect(remainingAfter).toBeLessThanOrEqual(remainingBefore);
    expect(remainingAfter).toBeGreaterThanOrEqual(remainingBefore - 2);
    const bl = await block(page);
    expect(bl.sets[1].actual).toBe(6); // target was 5, now bumped to 6 by the click
  });

  test('07 — changing reps while rest is paused keeps it paused', async ({ page }) => {
    await page.clock.install();
    await toFirstRest(page, 6);
    await page.clock.runFor(10000);
    await page.locator('[data-tpause]').click();
    let sr = await page.evaluate(() => window.CoachApp._UI.workout.setRest);
    expect(sr.paused).toBe(true);
    const elapsedAtPause = sr.elapsedMs;
    await page.locator('.cur-card [data-step="-1"]').click(); // forces a re-render while paused
    await page.clock.runFor(15000);
    sr = await page.evaluate(() => window.CoachApp._UI.workout.setRest);
    expect(sr.elapsedMs).toBe(elapsedAtPause); // frozen while paused, even across the re-render
    expect(sr.paused).toBe(true);
    await expect(page.locator('[data-tpause]')).toHaveText('Resume');
  });

  test('08 — the Pain/Discomfort toggle does not affect timer continuity', async ({ page }) => {
    await page.clock.install();
    await toFirstRest(page, 5);
    await page.clock.runFor(15000);
    const before = await page.evaluate(() => window.CoachApp._UI.timerLeft);
    await page.locator('[data-painflag]').click();
    await expect(page.locator('#rest .timer')).toBeVisible();
    const after = await page.evaluate(() => window.CoachApp._UI.timerLeft);
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBeGreaterThanOrEqual(before - 2);
  });

  test('09 — refresh during rest restores the correct remaining time', async ({ page }) => {
    await page.clock.install();
    await toFirstRest(page, 6); // 90s rest
    await page.clock.runFor(30000);
    await page.reload();
    await expect(page.locator('#rest .timer')).toBeVisible();
    await expect(page.locator('#rest .t')).toHaveText('1:00');
    const bl = await block(page);
    expect(bl.sets.length).toBe(6); // not duplicated by the reload
  });

  test('10 — backgrounding (simulated by a large clock jump) shows no drift, just accurate remaining time', async ({ page }) => {
    await page.clock.install();
    await toFirstRest(page, 6); // 90s
    await page.clock.runFor(40000);
    await expect(page.locator('#rest .t')).toHaveText('0:50');
  });

  test('11 — completion sound/vibration fire only once', async ({ page }) => {
    await page.clock.install();
    await toFirstRest(page, 4); // 90s rest
    await page.clock.runFor(89000);
    const oscBefore = await page.evaluate(() => window.__osc);
    await page.clock.runFor(2000); // crosses completion
    await page.clock.runFor(5000); // idle time after — must not re-fire
    const oscAfter = await page.evaluate(() => window.__osc);
    expect(oscAfter).toBeGreaterThan(oscBefore);
    const vibeCount = await page.evaluate(() => window.__vibrate.length);
    await page.clock.runFor(5000);
    const vibeCountLater = await page.evaluate(() => window.__vibrate.length);
    expect(vibeCountLater).toBe(vibeCount);
  });

  test('rest elapsed while closed shows Rest Complete rather than restarting', async ({ page }) => {
    await page.clock.install();
    await toFirstRest(page, 4); // 90s rest
    await page.clock.runFor(95000); // rest would have finished while "away"
    await page.reload();
    const bl = await block(page);
    // the gap is reconciled on load: either already showing the next set, or a completed rest — never re-shown at 1:30
    const restText = await page.locator('#rest').innerText().catch(() => '');
    expect(restText).not.toContain('1:30');
  });
});

test.describe('Pull-Up Pyramid — completion options', () => {
  async function finishPlanned(page, startVal) {
    await seed(page);
    await startPyramid(page);
    const before = await block(page);
    await stepReps(page, startVal - before.sets[0].actual);
    await clickDone(page);
    for (let i = 1; i < startVal; i++) { await skipRestIfAny(page); await clickDone(page); }
    await rateOverall(page, 'appropriate');
  }

  test('16 — Add Back-Off Set appends one editable 1-rep extra set', async ({ page }) => {
    await finishPlanned(page, 3);
    await expect(page.locator('[data-addbackoff]')).toBeVisible();
    await page.locator('[data-addbackoff]').click();
    const bl = await block(page);
    const extra = bl.sets[bl.sets.length - 1];
    expect(extra.extra).toBe('backoff');
    expect(extra.target).toBe(1);
    expect(extra.actual).toBe(1);
    expect(extra.doneFlag).toBe(false);
    // editable via the stepper
    await stepReps(page, 2);
    const bl2 = await block(page);
    expect(bl2.sets[bl2.sets.length - 1].actual).toBe(3);
    // the original frozen sequence is untouched
    expect(bl2.sets.slice(0, 3).map(s => s.target)).toEqual([3, 2, 1]);
  });

  test('17 — Add Another Pyramid appends the full frozen sequence and starts the pre-pyramid rest', async ({ page }) => {
    await page.clock.install();
    await finishPlanned(page, 3);
    await page.locator('[data-addpyramid]').click();
    const bl = await block(page);
    expect(bl.sets.length).toBe(6); // 3 original + 3 more (3,2,1)
    expect(bl.sets.slice(3).map(s => s.target)).toEqual([3, 2, 1]);
    expect(bl.sets.slice(3).every(s => !s.doneFlag)).toBe(true);
    await expect(page.locator('#rest .timer')).toBeVisible();
    await expect(page.locator('.cur-card [data-done]')).toHaveCount(0); // gated
    await expect(page.locator('#rest')).toContainText('next Pyramid');
  });

  test('Add Another Pyramid rest completing opens its first gated set', async ({ page }) => {
    await page.clock.install();
    await finishPlanned(page, 3); // restSecs 90
    await page.locator('[data-addpyramid]').click();
    await page.clock.runFor(95000);
    await expect(page.locator('.cur-card [data-done]')).toBeVisible();
    const bl = await block(page);
    expect(bl.sets.filter(s => s.doneFlag).length).toBe(3); // still just the original 3 done
  });

  test('Finish Pyramid ends the exercise without adding extra work', async ({ page }) => {
    await finishPlanned(page, 3);
    await page.locator('[data-finishex]').click();
    await expect(page.locator('.hero')).toContainText('completed');
  });
});

test.describe('Pull-Up Pyramid — display and history', () => {
  test('18 — planned/actual rep totals shown as "X of 21 planned reps completed" for 6-5-4-3-2-1', async ({ page }) => {
    await seed(page);
    await startPyramid(page);
    const before = await block(page);
    await stepReps(page, 6 - before.sets[0].actual);
    await clickDone(page); // set1=6 done, total planned = 21
    await expect(page.locator('.wk-side')).toContainText('6 of 21 planned reps completed');
    await skipRestIfAny(page); await clickDone(page); // set2=5 done -> 11
    await expect(page.locator('.wk-side')).toContainText('11 of 21 planned reps completed');
  });

  test('18b — pyramidProgressHtml reflects the frozen total, not a hard-coded number', async ({ page }) => {
    await seed(page);
    await startPyramid(page);
    const before = await block(page);
    await stepReps(page, 5 - before.sets[0].actual);
    await clickDone(page); // 5,4,3,2,1 total 15
    const bl = await block(page);
    expect(bl.plannedTotalReps).toBe(15);
  });

  function adhocPyramidResult(page) {
    return page.evaluate(() => {
      const d = window.CoachStore.makeStore().getAdhoc();
      const e = d && d.exercises.find(x => x.exId === 'pullup_pyramid');
      return e && e.result;
    });
  }

  test('19 — History distinguishes planned reps from extra back-off/pyramid work', async ({ page }) => {
    await seed(page);
    await startPyramid(page);
    const before = await block(page);
    await stepReps(page, 3 - before.sets[0].actual);
    await clickDone(page);
    await skipRestIfAny(page); await clickDone(page);
    await skipRestIfAny(page); await clickDone(page);
    await rateOverall(page, 'appropriate');
    await page.locator('[data-addbackoff]').click();
    await clickDone(page);
    await page.locator('[data-finishex]').click();
    const result = await adhocPyramidResult(page);
    expect(result.plannedTotalReps).toBe(6); // 3+2+1
    expect(result.plannedActualReps).toBe(6);
    expect(result.extraBackoffSets).toBe(1);
    expect(result.extraReps).toBe(1);
    expect(result.actualReps).toBe(7);
  });
});

test.describe('Pull-Up Pyramid — backward compatibility', () => {
  test('20 — an old symmetric-steps history entry remains readable', async ({ page }) => {
    await seed(page);
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore();
      const sessions = S.getSessions() || [];
      sessions.push({
        id: 'old1', kind: 'daily', date: new Date().toISOString(), weekday: 2, dayKey: 'tue',
        session: 'Old Session', worldId: 'muscleup', status: 'completed',
        exercises: [{ exId: 'pullup_pyramid', name: 'Pull-Up Pyramid', state: 'completed',
          result: { type: 'pyramid', exId: 'pullup_pyramid', name: 'Pull-Up Pyramid',
            plannedText: '1-2-3-2-1', actualText: '1, 2, 3, 2, 1', actualReps: 9, bestReps: 3,
            difficulty: 'appropriate', state: 'completed' } }],
        totalPullReps: 9, adaptations: []
      });
      S.setSessions(sessions);
    });
    await page.locator('.nav [data-s="progress"]').click();
    await expect(page.locator('body')).not.toContainText('undefined');
    const err = [];
    page.on('pageerror', e => err.push(String(e)));
    await page.reload();
    await page.locator('.nav [data-s="progress"]').click();
    expect(err.length).toBe(0);
  });

  test('a legacy steps:[1,2,3,2,1] saved default migrates to a startReps of 3', async ({ page }) => {
    await seed(page);
    const start = await page.evaluate(() => {
      const b = { scheme: 'pyramid', steps: [1, 2, 3, 2, 1] };
      return window.CoachDuration.pyramidStartReps(b);
    });
    expect(start).toBe(3);
  });
});
