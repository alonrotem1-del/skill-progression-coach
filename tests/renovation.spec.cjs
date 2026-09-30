// Skill Progression Coach — the product renovation.
//
// The four questions the product exists to answer are the whole spec:
//
//     What is my Goal?   Where am I?   What is missing?   What do I do today?
//
// These tests assert the ANSWERS are reachable and the noise is gone. They are
// deliberately about what the athlete sees, not about how it is computed: the
// engine has its own suites, and a renovation that passed only by keeping the
// old structure would have proved nothing.
const { test, expect } = require('@playwright/test');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const Goals = require(path.join(REPO, 'goals.js'));
const Evaluator = require(path.join(REPO, 'evaluator.js'));
const Week = require(path.join(REPO, 'week.js'));
const BUNDLE = require(path.join(REPO, 'content', 'bundle-1.json'));
const SEMANTICS = require(path.join(REPO, 'content', 'semantics-1.json'));

const PKG = {
  contextId: 'ctx_1',
  manifest: { id: 'ctx_1', contentBundleVersion: 1, evaluationSemanticsVersion: 1 },
  contentBundle: BUNDLE,
  evaluationSemantics: SEMANTICS
};
const view = (ledger, bench) =>
  Goals.view({ evaluator: Evaluator, pkg: PKG, ledger: ledger || [], bench: bench || {} });
const byId = (v, id) => v.filter((g) => g.goalId === id)[0];
const area = (g, name) => g.areas.filter((a) => a.name === name)[0];

function obs(exerciseId, attributes, opts) {
  opts = opts || {};
  return {
    seq: opts.seq, occurredAt: '2026-09-28T10:00:00.000Z', recordedAt: '2026-09-28T10:05:00.000Z',
    exerciseId, side: opts.side || null, attributes,
    provenance: 'demonstrated', provenanceSource: 'in_session',
    sourceWorkoutItem: null, sequenceInItem: 1,
    context: { readiness: {}, accommodationInForce: null, unmetDependencies: [], prescribedDose: null, contextId: 'ctx_1' }
  };
}

// ── the Goal view model ───────────────────────────────────────────────────
test.describe('renovation — the Goal view answers the four questions', () => {
  test('01 exactly two Goals, named the way the athlete names them', () => {
    const v = view();
    expect(v.length).toBe(2);
    expect(v.map((g) => g.name)).toEqual(['Ring Muscle-Up', 'Pistol Squat']);
    expect(Goals.GOAL_IDS).toEqual(['ring_muscle_up', 'pistol_squat']);
  });

  test('02 each Goal says where the athlete is and what is missing', () => {
    const v = view();
    v.forEach((g) => {
      expect(typeof g.areasDone).toBe('number');
      expect(g.areasTotal).toBeGreaterThan(0);
      expect(g.limiter, g.name).toBeTruthy();        // WHAT IS MISSING
      expect(typeof g.next, g.name).toBe('string');  // WHAT IS NEXT, in one line
      expect(g.next.length).toBeGreaterThan(3);
    });
  });

  test('03 no engine vocabulary reaches the athlete', () => {
    // Criterion ids, Stage ids, Dependency ids, policy names, node and world
    // words — none of them belong in a sentence the athlete reads.
    const text = JSON.stringify(view([], { pullup_max: 9, dips_max: 6, ring_support_secs: 14 }));
    ['criterion', 'Criterion', 'dependency', 'Dependency', 'holder', 'progressionId',
      'stageId', 'goalTerminal', 'rmu_', 'pistol_str', 'fg_hang', 'sup_rto',
      'unmetDependencies', 'provenance', 'supersession', 'World', 'node']
      .forEach((w) => expect(text, w).not.toContain(w));
  });

  test('04 an area with no evidence says so, and never shows a fabricated zero', () => {
    const fg = area(byId(view(), 'ring_muscle_up'), 'False Grip');
    expect(fg.state).toBe('not_started');
    expect(fg.current).toBeNull();          // not "0 s"
    expect(fg.currentValue).toBeNull();
    expect(fg.target).toBe('30 s');
  });

  test('05 real evidence is what the athlete sees, and completes an area', () => {
    const v = view([obs('fg_hang', { seconds: 35 }, { seq: 1 })]);
    const fg = area(byId(v, 'ring_muscle_up'), 'False Grip');
    expect(fg.state).toBe('done');
    expect(fg.fromHistory).toBe(false);
    expect(byId(v, 'ring_muscle_up').areasDone).toBe(1);
  });

  test('06 a legacy benchmark carries over, is labelled, and never marks an area done', () => {
    // An athlete who has trained for months is not told they have done nothing.
    const v = view([], { ring_support_secs: 14 });
    const rs = area(byId(v, 'ring_muscle_up'), 'Ring Support');
    expect(rs.current).toBe('14 s');
    expect(rs.target).toBe('20 s');
    expect(rs.fromHistory).toBe(true);
    expect(rs.state).toBe('working');
    expect(byId(v, 'ring_muscle_up').areasDone).toBe(0);   // carried over, not credited
  });

  test('07 a carried-over value places the athlete on the step they are actually on', () => {
    // 9 strict pull-ups should not read "Step 1 of 3 — target 1 rep".
    const rs = area(byId(view([], { pullup_max: 9 }), 'ring_muscle_up'), 'Pull Strength');
    expect(rs.step).toBe('Step 3 of 3');
    expect(rs.current).toBe('9 reps');
    expect(rs.target).toBe('10 reps');
  });

  test('08 only genuinely equivalent legacy measures carry over', () => {
    // A bar dead hang is not a false-grip hang, so it must not become one.
    const fg = area(byId(view([], { deadhang_secs: 120 }), 'ring_muscle_up'), 'False Grip');
    expect(fg.current).toBeNull();
    expect(Object.keys(Goals.BENCH_EQUIVALENTS).sort())
      .toEqual(['dips_max', 'pullup_max', 'ring_support_secs']);
  });

  test('09 an area needing a judgement the runner cannot record says so', () => {
    const ps = area(byId(view(), 'ring_muscle_up'), 'Pull Strength');
    expect(ps.needsJudgement).toBe(true);     // kip is not observed
    const rs = area(byId(view(), 'ring_muscle_up'), 'Ring Support');
    expect(rs.needsJudgement).toBe(false);    // seconds are
  });

  test('10 units read as a coach would say them', () => {
    const v = view([], { pullup_max: 1 });
    const t = JSON.stringify(v);
    expect(t).not.toContain('1 reps');
    expect(area(byId(view(), 'ring_muscle_up'), 'Ring Support').target).toBe('20 s');
  });
});

// ── the Pistol Squat, where sides matter ─────────────────────────────────
test.describe('renovation — Pistol Squat sides', () => {
  test('11 sides are shown where content scopes them, and only there', () => {
    const g = byId(view(), 'pistol_squat');
    expect(area(g, 'Single-Leg Strength').perSide).toBe(true);
    // Squat depth is one measurement even inside a per-side Goal.
    expect(area(g, 'Squat Depth').perSide).toBe(false);
  });

  test('12 left and right are tracked independently', () => {
    // Clearing the first step on the left only must move the left side on and
    // leave the right side where it was — the whole point of per-side content.
    const v = view([
      obs('box_pistol', { reps: 6, depth: 'below_parallel' }, { seq: 1, side: 'left' })
    ]);
    const a = area(byId(v, 'pistol_squat'), 'Single-Leg Strength');
    expect(a.left.step).toBe('Step 2 of 2');
    expect(a.right.step).toBe('Step 1 of 2');
    expect(a.right.currentValue).toBeNull();
    // The side that is behind is the one named as next.
    expect(byId(v, 'pistol_squat').next).toContain('right');
    // And an untouched ledger leaves both sides on step 1.
    const none = area(byId(view(), 'pistol_squat'), 'Single-Leg Strength');
    expect(none.left.step).toBe('Step 1 of 2');
    expect(none.right.step).toBe('Step 1 of 2');
  });

  test('13 no laterality machinery is exposed', () => {
    const t = JSON.stringify(view());
    ['sideScope', 'sideRule', 'mirror', 'combined', 'wrong_side']
      .forEach((w) => expect(t, w).not.toContain(w));
  });

  test('14 Ankle Mobility is not a Goal, and appears only when it is the thing in the way', () => {
    expect(Goals.GOAL_IDS).not.toContain('pistol_ankle_mobility');
    // Single-Leg Strength is unfinished, so mobility stays out of the way.
    const g = byId(view(), 'pistol_squat');
    expect(area(g, 'Ankle Mobility')).toBeUndefined();
    // A hidden area leaves the count too, so the fraction always describes the
    // rows on screen — "0 of 3" above two rows is its own confusing question.
    expect(g.areasTotal).toBe(2);
    expect(g.areas.length).toBe(g.areasTotal);
    // And hiding it can never read as finished while it is not.
    expect(g.areasDone).toBeLessThan(g.areasTotal);
    expect(g.complete).toBe(false);
    // Finish the other two and mobility becomes the named limiter.
    const done = view([
      obs('pistol_heel', { reps: 3, depth: 'below_parallel', execution: 'controlled' }, { seq: 1, side: 'left' }),
      obs('pistol_heel', { reps: 3, depth: 'below_parallel', execution: 'controlled' }, { seq: 2, side: 'right' }),
      obs('box_pistol', { reps: 5, depth: 'below_parallel' }, { seq: 3, side: 'left' }),
      obs('box_pistol', { reps: 5, depth: 'below_parallel' }, { seq: 4, side: 'right' }),
      obs('deep_squat_hold', { seconds: 35, depth: 'below_parallel' }, { seq: 5 })
    ]);
    const g2 = byId(done, 'pistol_squat');
    expect(area(g2, 'Squat Depth').state).toBe('done');
    expect(area(g2, 'Ankle Mobility')).toBeTruthy();
    expect(g2.next).toContain('Ankle Mobility');
    // Now that it is shown, it is counted again — and the goal is not complete
    // while it is the thing in the way.
    expect(g2.areasTotal).toBe(3);
    expect(g2.areas.length).toBe(3);
    expect(g2.complete).toBe(false);
  });
});

// ── climbing is no longer a product domain ──────────────────────────────
test.describe('renovation — climbing is not a first-class domain', () => {
  test('15 climbing is hidden from the product, and the plan fact is preserved', () => {
    expect(Week.climbingInProduct()).toBe(false);
    const plan = Week.seedPlan();
    // The plan still says what it always said — nothing was deleted.
    expect(Week.climbsOn(plan, 0)).toBe(true);
    // The product simply stops acting on it.
    expect(Week.climbsVisibly(plan, 0)).toBe(false);
    const res = Week.resolveDay(plan, 0, { todayId: 0, loads: {}, dayLog: {} });
    expect(res.climbing).toBe(false);
    expect(res.climbTemplateId).toBeNull();
  });

  test('16 neither Goal is climbing, and no area is', () => {
    const t = JSON.stringify(view());
    ['bouldering', 'Bouldering', 'Climb', 'climbing', 'V5', 'boulder']
      .forEach((w) => expect(t, w).not.toContain(w));
  });

  test('17 climbing data is not destroyed', () => {
    const fs = require('fs');
    // The world, the logger and the templates all still exist: this is a
    // presentation decision, reversible by one flag, not a data migration.
    const Data = require(path.join(REPO, 'data.js'));
    expect(Data.worldsById.boulder).toBeTruthy();
    const app = fs.readFileSync(path.join(REPO, 'app.js'), 'utf8');
    expect(app).toContain('function startClimbing');
    expect(app).toContain('function finishClimbing');
    // And History still labels past climbing sessions.
    expect(app).toContain("climbing:'Climb'");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// the shell, in a real browser
// ══════════════════════════════════════════════════════════════════════════
async function seed(page, dayId) {
  await page.addInitScript((d) => { window.__spcTodayId = d; }, dayId === undefined ? 2 : dayId);
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
// The Goals view loads asynchronously (a durable package plus the ledger), so a
// test waits for the thing it is about to act on rather than for a fixed delay.
const goGoals = async (page) => {
  await page.locator('.nav button[data-s="goals"]').click();
  await expect(page.locator('.goal-card').first()).toBeVisible({ timeout: 15000 });
};
const openGoal = async (page, goalId) => {
  await goGoals(page);
  const btn = page.locator('[data-goalopen="' + goalId + '"]');
  await expect(btn).toBeVisible({ timeout: 15000 });
  await btn.click();
  await expect(page.locator('.ga').first()).toBeVisible({ timeout: 15000 });
};

test.describe('renovation — the shell', () => {
  test('18 four destinations, and Map and Progress are not among them', async ({ page }) => {
    await seed(page);
    expect(await page.locator('.nav button').allTextContents()).toEqual(['Today', 'Plan', 'Goals', 'Profile']);
    expect(await page.locator('.nav button[data-s="map"]').count()).toBe(0);
    expect(await page.locator('.nav button[data-s="progress"]').count()).toBe(0);
    // "Week" is now "Plan" — the athlete plans, they do not browse a week.
    expect(await page.locator('.nav button[data-s="week"]').count()).toBe(0);
  });

  test('19 no route into the Skill Map from anywhere the athlete looks', async ({ page }) => {
    await seed(page);
    for (const screen of ['today', 'plan', 'goals', 'profile']) {
      await page.locator('.nav button[data-s="' + screen + '"]').click();
      await page.waitForTimeout(250);
      const text = (await page.locator('#app').innerText()).toLowerCase();
      expect(text, screen).not.toContain('skill map');
      expect(text, screen).not.toContain('view map');
    }
  });

  test('20 Today no longer offers a climbing session on the climbing day', async ({ page }) => {
    await seed(page, 0);                        // Sunday, the plan's climbing day
    const text = await page.locator('#app').innerText();
    expect(text).not.toContain('Climbing');
    expect(await page.locator('.q-ex.q-base').count()).toBe(0);
  });

  test('21 Goals shows both Goals with a next target, and opens the detail', async ({ page }) => {
    await seed(page);
    await goGoals(page);
    const text = await page.locator('#app').innerText();
    expect(text).toContain('Ring Muscle-Up');
    expect(text).toContain('Pistol Squat');
    expect(text).toContain('NEXT UP');
    await openGoal(page, 'ring_muscle_up');
    const detail = await page.locator('#app').innerText();
    ['False Grip', 'Pull Strength', 'High Pull', 'Ring Support', 'Transition', 'Dip Strength']
      .forEach((n) => expect(detail, n).toContain(n));
  });

  test('22 the Pistol Squat page shows sides without exposing the machinery', async ({ page }) => {
    await seed(page);
    await openGoal(page, 'pistol_squat');
    const t = await page.locator('#app').innerText();
    expect(t).toContain('Single-Leg Strength');
    expect(t).toContain('Squat Depth');
    expect(t.toLowerCase()).not.toContain('sidescope');
    expect(t.toLowerCase()).not.toContain('mirror');
  });

  test('23 rationale is behind a disclosure, not in the main path', async ({ page }) => {
    await seed(page);
    await openGoal(page, 'ring_muscle_up');
    await expect(page.locator('[data-why]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.why-body')).toBeHidden();
    await page.locator('[data-why]').click();
    await expect(page.locator('.why-body')).toBeVisible();
  });

  test('24 History lives inside Goals rather than as its own destination', async ({ page }) => {
    await seed(page);
    await goGoals(page);
    expect(await page.locator('#app').innerText()).toContain('WORKOUT HISTORY');
  });

  test('25 Today is simpler: no node vocabulary, no priority letters, reason one tap away', async ({ page }) => {
    await seed(page);
    const t = await page.locator('#app').innerText();
    expect(t).not.toContain('Primary contribution');
    expect(t).not.toContain('As planned');
    expect(t).not.toContain('REQUIRED');
    expect(await page.locator('.prio').count()).toBe(0);
    // The reason is still reachable.
    await expect(page.locator('[data-whytoday]')).toBeVisible();
    await expect(page.locator('.why-body')).toBeHidden();
    await page.locator('[data-whytoday]').click();
    await expect(page.locator('.why-body')).toBeVisible();
  });

  test('26 the runners still run, unchanged, from the simplified Today', async ({ page }) => {
    await seed(page);
    await page.locator('.q-ex').first().locator('[data-exstart]').click();
    await expect(page.locator('.wk-block-wrap').first()).toBeVisible();
    // and the in-flight workout still persists across a reload
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_workout')).data.workoutId);
    await page.reload();
    await expect(page.locator('.wk-block-wrap').first()).toBeVisible();
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_workout')).data.workoutId);
    expect(after).toBe(before);
  });

  test('27 Plan still shows the week and still edits', async ({ page }) => {
    await seed(page);
    await page.locator('.nav button[data-s="plan"]').click();
    await page.waitForTimeout(300);
    expect(await page.locator('#app').innerText()).toContain('Sunday');
    await page.locator('[data-editplan]').first().click();
    await expect(page.locator('[data-epsave]')).toBeVisible({ timeout: 8000 });
    // climbing is not one of the rows the athlete plans any more
    expect(await page.locator('#app').innerText()).not.toContain('Bouldering');
  });

  test('28 Profile still reaches Data, Backup and the diagnostics', async ({ page }) => {
    await seed(page);
    await page.locator('.nav button[data-s="profile"]').click();
    await page.locator('[data-sview="data"]').click();
    await expect(page.locator('[data-idb-status]')).toContainText(/schema v2/, { timeout: 8000 });
    await expect(page.locator('[data-backup-export]')).toBeVisible();
  });

  test('29 goals.js ships with the shell and is cached for offline', async ({ page }) => {
    await page.goto('index.html');
    expect(await page.evaluate(() => !!window.CoachGoals)).toBe(true);
    await page.evaluate(() => navigator.serviceWorker.ready);
    let urls = [];
    for (let i = 0; i < 40; i++) {
      urls = await page.evaluate(async () => {
        const names = (await caches.keys()).filter((n) => n.indexOf('skill-progression-coach-') === 0);
        if (!names.length) return [];
        return (await (await caches.open(names[0])).keys()).map((r) => r.url);
      });
      if (urls.some((u) => u.indexOf('goals.js') >= 0)) break;
      await page.waitForTimeout(100);
    }
    expect(urls.some((u) => u.indexOf('goals.js') >= 0)).toBe(true);
  });

  test('30 the Goal view is descriptive only: no product decision path reads it', async ({ page }) => {
    const fs = require('fs');
    // goals.js must not write, and the modules that decide what the athlete
    // does must not be able to reach it.
    const src = fs.readFileSync(path.join(REPO, 'goals.js'), 'utf8');
    ['localStorage', 'spc_c_', 'indexedDB', 'fetch(', 'setItem', 'CoachStore']
      .forEach((n) => expect(src, n).not.toContain(n));
    ['week.js', 'engine.js', 'progress.js', 'daily.js', 'settings.js', 'adapt.js', 'duration.js']
      .forEach((f) => {
        const s = fs.readFileSync(path.join(REPO, f), 'utf8');
        expect(s, f).not.toContain('CoachGoals');
      });
  });
});

// ── the Goal view follows the evidence ───────────────────────────────────
test.describe('renovation — Goals reflect real training', () => {
  test('31 evidence recorded by a workout shows up on the Goal page', async ({ page }) => {
    await seed(page);
    await goGoals(page);
    const before = await page.locator('#app').innerText();
    expect(before).toContain('Ring Muscle-Up');
    // A false-grip hang is exactly what the False Grip area is measured by.
    await page.evaluate(async () => {
      await window.CoachIDB.init(); await window.CoachContext.init();
      await window.CoachApp._evidence.tapWorkout({
        workoutId: 'w_reno_fg',
        blocks: [{ kind: 'straight', scheme: 'hold', exId: 'fg_hang', label: 'False Grip Hang',
          restSecs: 90, sets: [{ target: 30, actual: 35, unit: 'sec', doneFlag: true }] }]
      });
    });
    // Leave and come back: the cache must not outlive the evidence.
    await page.locator('.nav button[data-s="today"]').click();
    await goGoals(page);
    const after = await page.locator('#app').innerText();
    expect(after).not.toBe(before);
    expect(after).toContain('1 of 6 areas');
    // and the limiter moves on to the next thing
    expect(after).not.toContain('False Grip — 30 s');
  });
});

// ── a device that was not ready yet is not a permanent verdict ────────────
//
// The Goal view needs a durable context package and the ledger, both of which
// can be a moment late on a cold start. The first version cached whatever came
// back, so a single unlucky load left Goals reading "still being set up" until
// something else happened to invalidate it — the athlete's goals, permanently
// unavailable because of one slow read. Only a real view is cached now.
test.describe('renovation — Goals recover from a device that was not ready', () => {
  test('32 a goals view that could not be built is not cached, so reopening retries', async ({ page }) => {
    await seed(page);

    // Make the context unavailable for exactly one attempt.
    await page.evaluate(() => {
      const C = window.CoachContext, real = C.getCurrentContextPackage;
      let failed = false;
      C.getCurrentContextPackage = function () {
        if (!failed) { failed = true; return Promise.resolve(null); }
        return real.apply(C, arguments);
      };
    });

    // First visit lands on the honest "not ready" message, with no goal cards.
    await page.locator('.nav button[data-s="goals"]').click();
    await expect(page.locator('.goal-empty')).toBeVisible({ timeout: 15000 });
    expect(await page.locator('.goal-card').count()).toBe(0);
    expect(await page.locator('#app').innerText()).toContain('being set up');

    // Leaving and coming back retries rather than replaying the failure.
    await page.locator('.nav button[data-s="today"]').click();
    await goGoals(page);
    const t = await page.locator('#app').innerText();
    expect(t).toContain('Ring Muscle-Up');
    expect(t).toContain('Pistol Squat');
    expect(t).not.toContain('being set up');
  });
});

// ── a cold start is not a verdict either ─────────────────────────────────
//
// The companion defect to 32: the Goal view read the interpretation context
// without waiting for the boot-time adoption that creates it, so opening Goals
// as the first action after a launch raced it and lost — "your goals are still
// being set up" on a device where they were already set up. The evidence tap
// had waited on exactly this gate since P3; the Goal view now does too.
test.describe('renovation — Goals survive being opened during a cold start', () => {
  test('33 Goals opened as the very first action after a launch shows the goals', async ({ page }) => {
    await seed(page);
    // A genuine cold start, then straight to Goals with nothing in between —
    // no settling delay, no prior screen, no warm cache.
    await page.reload();
    await page.locator('.nav button[data-s="goals"]').click();

    // It must arrive at the goals, not at an apology.
    await expect(page.locator('.goal-card').first()).toBeVisible({ timeout: 15000 });
    const t = await page.locator('#app').innerText();
    expect(t).toContain('Ring Muscle-Up');
    expect(t).toContain('Pistol Squat');
    expect(t).not.toContain('being set up');
    // The loading placeholder is the only thing allowed to precede them, and it
    // must not still be there once the cards are.
    expect(t).not.toContain('Loading');
  });
});
