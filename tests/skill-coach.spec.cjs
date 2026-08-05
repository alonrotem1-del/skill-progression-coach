// Skill Progression Coach — domain engine, migration, storage guard,
// duration calculator, dynamic adaptation, and the end-to-end vertical slice
// (onboarding → map → today → workout → progress). All English.
// Additive: never asserts against puc_* being writable.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const Data = require('../data.js');
const Engine = require('../engine.js');
const Store = require('../store.js');
const Progress = require('../progress.js');
const Duration = require('../duration.js');
const Adapt = require('../adapt.js');
const CoachSettings = require('../settings.js');
const v5Proposal = require('../content/v5-skill-tree-proposal.json');

const mu = Data.worldsById.muscleup;
const boulder = Data.worldsById.boulder;
const cmap = w => { const c = {}; w.nodes.forEach(n => (c[n.id] = n)); return c; };

// Start the pure Pull-Up Ladder workout (mu_strength: ladder + scapular, ladder
// first) via the Skill Map node — a stable entry point for the ladder-runner
// mechanics, independent of the multi-exercise Friday plan.
async function startLadder(page) {
  await page.locator('.nav [data-s="map"]').click();
  await page.locator('.node.current').click({ force: true });
  await page.locator('.sheet [data-start="mu_strength"]').click();
  await expect(page.locator('.cur-card')).toBeVisible();
}

// ─────────────────────────── no Hebrew in coach files ─────────────────────────
test('app *.js files contain no Hebrew characters', () => {
  const coachDir = path.join(__dirname, '..');
  const files = fs.readdirSync(coachDir).filter(f => f.endsWith('.js'));
  const hebrewRe = /[֐-׿]/;
  const violations = [];
  files.forEach(f => {
    const content = fs.readFileSync(path.join(coachDir, f), 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (hebrewRe.test(line)) violations.push(`${f}:${i + 1}: ${line.trim().slice(0, 80)}`);
    });
  });
  expect(violations).toEqual([]);
});

// ─────────────────────────── ladder model ─────────────────────────────────────
// The pull-up ladder is 1-2-3 × 5 COMPLETE rounds: 5 rounds, 15 steps, 30 reps,
// with a short rest between steps and a longer rest between rounds.
test.describe('ladder model', () => {
  const ladderBlock = Data.templates.mu_strength.blocks[0];

  test('1-2-3 × 5 expands to 5 rounds and 15 steps', () => {
    const sets = Duration.genSets(ladderBlock);
    expect(sets.length).toBe(15);
    const rounds = new Set(sets.map(s => s.round));
    expect([...rounds].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    // Each round is the sequence 1-2-3.
    for (let r = 1; r <= 5; r++) {
      expect(sets.filter(s => s.round === r).map(s => s.target)).toEqual([1, 2, 3]);
    }
  });

  test('total reps across the ladder equal 30', () => {
    const sets = Duration.genSets(ladderBlock);
    expect(sets.reduce((a, s) => a + s.target, 0)).toBe(30);
  });

  test('exactly 10 short rests, each 25 seconds', () => {
    const shorts = Duration.restsBetween(Data.templates.mu_strength).filter(r => r.kind === 'short');
    expect(shorts.length).toBe(10);
    shorts.forEach(r => expect(r.sec).toBe(25));
  });

  test('exactly 4 long (inter-round) rests, each 150 seconds', () => {
    const longs = Duration.restsBetween(Data.templates.mu_strength).filter(r => r.kind === 'long');
    expect(longs.length).toBe(4);
    longs.forEach(r => expect(r.sec).toBe(150));
  });

  test('last step of the ladder carries no trailing round rest', () => {
    const sets = Duration.genSets(ladderBlock);
    const last = sets[sets.length - 1];
    expect(last.round).toBe(5);
    expect(last.step).toBe(3);
    expect(last.lastInRound).toBe(true);
    // restsBetween excludes a rest after the final set of the block.
    const longs = Duration.restsBetween(Data.templates.mu_strength).filter(r => r.kind === 'long');
    expect(longs.length).toBe(4); // rounds 1-4, not 5
  });
});

// ─────────────────────────── calcDuration (range, from correct model) ─────────
test.describe('calcDurationRange', () => {
  test('ladder + 3×8 sets: about 21–22 min from the correct structure', () => {
    const r = Duration.calcDurationRange(Data.templates.mu_strength);
    // Ladder: 30 reps × (2–3 s) = 60–90 s exec; rests 10×25 + 4×150 = 850 s → 910–940 s.
    // Transition 60 s. Scapular 3×8 = 24 reps × (2–3 s) = 48–72 s exec; rests 2×120 = 240 s.
    // min = 60+850+60+48+240 = 1258 → 21 min; max = 90+850+60+72+240 = 1312 → 22 min.
    expect(r.minSec).toBe(1258);
    expect(r.maxSec).toBe(1312);
    expect(r.minMin).toBe(21);
    expect(r.maxMin).toBe(22);
  });

  test('pyramid (descending from 6: 6-5-4-3-2-1): about 8 min', () => {
    const r = Duration.calcDurationRange(Data.templates.mu_volume);
    // 21 reps (6+5+4+3+2+1) × (2–3 s) = 42–63 s exec; 5 straight rests × 90 = 450 s.
    expect(r.minSec).toBe(492);
    expect(r.maxSec).toBe(513);
    expect(r.minMin).toBe(8);
    expect(r.maxMin).toBe(9);
  });

  test('hold + reps blocks (support + dips): about 15 min', () => {
    const r = Duration.calcDurationRange(Data.templates.mu_dip);
    // Holds 4×15 = 60 s exec; 3×120 rest. Transition 60. Dips 4×6 = 24 reps × (2–3 s); 3×120 rest.
    // min = 60+360+60+48+360 = 888 → 15; max = 60+360+60+72+360 = 912 → 15.
    expect(r.minMin).toBe(15);
    expect(r.maxMin).toBe(15);
  });

  test('AMRAP single set: about 1 min', () => {
    const r = Duration.calcDurationRange(Data.templates.mu_test);
    expect(r.minSec).toBe(60);
    expect(r.maxMin).toBe(1);
  });

  test('climbing template (no blocks) returns null', () => {
    expect(Duration.calcDurationRange(Data.templates.b_consolidate)).toBeNull();
    expect(Duration.calcDuration(Data.templates.b_consolidate)).toBeNull();
  });

  test('no phantom warm-up is added — only declared blocks count', () => {
    // A single 1×10 block: 10 reps exec only, no rests, no warm-up.
    const t = { type: 'strength', blocks: [{ scheme: 'sets', sets: 1, reps: 10 }] };
    const r = Duration.calcDurationRange(t);
    expect(r.minSec).toBe(20); // 10 × 2
    expect(r.maxSec).toBe(30); // 10 × 3
  });
});

// ─────────────────────────── genSets ──────────────────────────────────────────
test.describe('genSets', () => {
  test('ladder uses explicit steps × rounds and tags round/step metadata', () => {
    const sets = Duration.genSets({ scheme: 'ladder', steps: [1, 2, 3], rounds: 5 });
    expect(sets.length).toBe(15);
    expect(sets[0]).toMatchObject({ round: 1, step: 1, target: 1, firstInRound: true, lastInRound: false });
    expect(sets[2]).toMatchObject({ round: 1, step: 3, target: 3, lastInRound: true });
    expect(sets[3]).toMatchObject({ round: 2, step: 1, target: 1, firstInRound: true });
  });

  test('pyramid descends from startReps to 1', () => {
    const sets = Duration.genSets({ scheme: 'pyramid', startReps: 6 });
    expect(sets.map(s => s.target)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  test('pyramid with no startReps falls back to the default (5-4-3-2-1)', () => {
    const sets = Duration.genSets({ scheme: 'pyramid' });
    expect(sets.map(s => s.target)).toEqual([5, 4, 3, 2, 1]);
  });

  test('a legacy symmetric steps array migrates via its peak value', () => {
    const sets = Duration.genSets({ scheme: 'pyramid', steps: [1, 2, 3, 2, 1] });
    expect(sets.map(s => s.target)).toEqual([3, 2, 1]);
  });

  test('sets scheme produces correct count', () => {
    const sets = Duration.genSets({ scheme: 'sets', sets: 4, reps: 6 });
    expect(sets.length).toBe(4);
    sets.forEach(s => expect(s.target).toBe(6));
  });

  test('hold scheme uses seconds', () => {
    const sets = Duration.genSets({ scheme: 'hold', sets: 3, seconds: 30 });
    expect(sets.length).toBe(3);
    sets.forEach(s => { expect(s.unit).toBe('sec'); expect(s.target).toBe(30); });
  });
});

// ─────────────────────────── dynamic adaptation ───────────────────────────────
test.describe('dynamic adaptation', () => {
  test('easy: +1 rep, −15s rest', () => {
    const r = Adapt.adaptNext('easy', { unit: 'reps', target: 5 });
    expect(r.targetDelta).toBe(1);
    expect(r.restDelta).toBe(-15);
    expect(r.explanation).toContain('added 1 rep');
  });

  test('appropriate: no change', () => {
    const r = Adapt.adaptNext('appropriate', { unit: 'reps', target: 5 });
    expect(r.targetDelta).toBe(0);
    expect(r.restDelta).toBe(0);
  });

  test('hard: +30s rest, same target', () => {
    const r = Adapt.adaptNext('hard', { unit: 'reps', target: 5 });
    expect(r.targetDelta).toBe(0);
    expect(r.restDelta).toBe(30);
    expect(r.explanation).toContain('30 sec rest');
  });

  test('failed: −1 rep, +30s rest', () => {
    const r = Adapt.adaptNext('failed', { unit: 'reps', target: 5 });
    expect(r.targetDelta).toBe(-1);
    expect(r.restDelta).toBe(30);
    expect(r.explanation).toContain('reduced');
  });

  test('hold: easy adds 5 sec, failed removes 5 sec', () => {
    const re = Adapt.adaptNext('easy', { unit: 'sec', target: 30 });
    expect(re.targetDelta).toBe(5);
    const rf = Adapt.adaptNext('failed', { unit: 'sec', target: 30 });
    expect(rf.targetDelta).toBe(-5);
  });

  test('minimum values enforced: 1 rep, 5 sec hold, 15 sec rest', () => {
    expect(Adapt.applyTargetDelta(1, -1, 'reps')).toBe(1);
    expect(Adapt.applyTargetDelta(5, -5, 'sec')).toBe(5);
    expect(Adapt.applyRestDelta(15, -15)).toBe(15);
  });
});

// ─────────────────────────── round-level (ladder) adaptation ──────────────────
test.describe('ladder round adaptation', () => {
  test('right keeps the round 1-2-3 and the inter-round rest', () => {
    const r = Adapt.adaptNextRound('appropriate', [1, 2, 3], null);
    expect(r.steps).toEqual([1, 2, 3]);
    expect(r.roundRestDelta).toBe(0);
    expect(r.reduced).toBe(false);
  });

  test('hard keeps 1-2-3 but increases the inter-round rest', () => {
    const r = Adapt.adaptNextRound('hard', [1, 2, 3], null);
    expect(r.steps).toEqual([1, 2, 3]);
    expect(r.roundRestDelta).toBe(30);
    // 2:30 default + 30 = 3:00, applied via applyRestDelta.
    expect(Adapt.applyRestDelta(150, r.roundRestDelta)).toBe(180);
  });

  test('failed on the final step reduces the next round to 1-2', () => {
    const r = Adapt.adaptNextRound('failed', [1, 2, 3], 3);
    expect(r.steps).toEqual([1, 2]);
    expect(r.reduced).toBe(true);
    expect(r.roundRestDelta).toBe(30);
  });

  test('failed earlier reduces the next round further (no forced maximal)', () => {
    const r = Adapt.adaptNextRound('failed', [1, 2, 3], 2);
    expect(r.steps).toEqual([1]);
    expect(r.reduced).toBe(true);
  });

  test('easy adds a rep to the top of the next round and shortens rest', () => {
    const r = Adapt.adaptNextRound('easy', [1, 2, 3], null);
    expect(r.steps).toEqual([1, 2, 4]);
    expect(r.roundRestDelta).toBe(-15);
  });

  test('a reduced round never drops below one step', () => {
    const r = Adapt.adaptNextRound('failed', [1], 1);
    expect(r.steps).toEqual([1]);
  });
});

// ─────────────────────────── domain / progression ───────────────────────────
test.describe('domain', () => {
  test('two data-driven worlds with resolvable prerequisites and edges', () => {
    expect(Data.worlds.map(w => w.id).sort()).toEqual(['boulder', 'muscleup']);
    Data.worlds.forEach(w => {
      const ids = new Set(w.nodes.map(n => n.id));
      w.nodes.forEach(n => {
        if (!n.prereq) return;
        (n.prereq.all || []).concat(n.prereq.any || []).forEach(id => expect(ids.has(id)).toBe(true));
      });
      (w.supports || []).forEach(e => { expect(ids.has(e[0])).toBe(true); expect(ids.has(e[1])).toBe(true); });
    });
  });

  test('completed criteria drive node completion; benchmarks seed real progress', () => {
    const states = Store.seedStates(mu, { pullup_max: 9, dips_max: 6 });
    const c = cmap(mu);
    expect(Engine.isComplete(c.mu_pull5, states)).toBe(true);    // 9 ≥ 5
    expect(Engine.isComplete(c.mu_pull10, states)).toBe(false);  // 9 < 10
    expect(Engine.isComplete(c.mu_dip5, states)).toBe(true);     // 6 ≥ 5
    expect(Engine.progressText(c.mu_pull10, states)).toContain('/10');
  });

  test('AND/OR prerequisites: first muscle-up stays locked until its chain is met', () => {
    const c = cmap(mu);
    let states = Store.seedStates(mu, { pullup_max: 12, dips_max: 9 });
    expect(Engine.statusOf(c.mu_firstmu, states, c, {})).toBe('locked');
    ['mu_fastpull', 'mu_c2b', 'mu_lowtrans', 'mu_negmu', 'mu_bandmu'].forEach(id => {
      states[id] = { criteria: {} };
      c[id].criteria.forEach(cr => (states[id].criteria[cr.id] = cr.target));
    });
    expect(Engine.prereqMet(c.mu_firstmu, states, c)).toBe(true);
    expect(Engine.statusOf(c.mu_firstmu, states, c, {})).toBe('available');
  });

  test('optional/support nodes do not block a milestone', () => {
    const c = cmap(mu);
    let states = Store.seedStates(mu, { pullup_max: 12 });
    ['mu_fastpull', 'mu_c2b', 'mu_lowtrans', 'mu_negmu', 'mu_dip5', 'mu_bandmu'].forEach(id => {
      states[id] = { criteria: {} }; c[id].criteria.forEach(cr => (states[id].criteria[cr.id] = cr.target));
    });
    expect(Engine.isComplete(c.mu_hollow, states)).toBe(false);
    expect(Engine.prereqMet(c.mu_firstmu, states, c)).toBe(true);
  });

  test('focus is milestone-driven and limited to one primary + one supporting', () => {
    const f = Engine.autoFocus(mu, Store.seedStates(mu, { pullup_max: 9, dips_max: 6 }));
    expect(f.primary).toBe('mu_pull10');
    expect(f.supporting).toBeTruthy();
    expect(f.primary).not.toBe(f.supporting);
    expect(Engine.autoFocus(mu, Store.seedStates(mu, { pullup_max: 2 })).primary).toBe('mu_deadhang');
    let bs = Store.seedStates(boulder, {});
    ['b_v0', 'b_v1'].forEach(id => { bs[id] = { criteria: {} }; cmap(boulder)[id].criteria.forEach(cr => (bs[id].criteria[cr.id] = cr.target)); });
    expect(Engine.autoFocus(boulder, bs).primary).toBe('b_v2');
  });

  test('world state is independent — switching worlds preserves each world', () => {
    const a = Store.seedStates(mu, { pullup_max: 9 });
    const b = Store.seedStates(boulder, {});
    a.mu_pull10 = { criteria: { reps: 10 } };
    expect(b.mu_pull10).toBeUndefined();
    expect(Engine.isComplete(cmap(mu).mu_pull10, a)).toBe(true);
  });

  test('with pullup_max=9, user is at 5PU completed and 10PU is current focus at 9/10', () => {
    const states = Store.seedStates(mu, { pullup_max: 9 });
    const c = cmap(mu);
    expect(Engine.isComplete(c.mu_pull5, states)).toBe(true);
    expect(Engine.isComplete(c.mu_pull10, states)).toBe(false);
    expect(Engine.progressText(c.mu_pull10, states)).toBe('9/10 reps');
    const f = Engine.autoFocus(mu, states);
    expect(f.primary).toBe('mu_pull10');
  });
});

// ─────────────────────────── recommendation engine ──────────────────────────
test.describe('recommendation engine', () => {
  const base = () => ({ world: mu, states: Store.seedStates(mu, { pullup_max: 9, dips_max: 6 }), templates: Data.templates });
  const focus = () => Engine.autoFocus(mu, Store.seedStates(mu, { pullup_max: 9, dips_max: 6 }));

  test('pain avoids an aggravating session and shows a caution', () => {
    const r = Engine.recommend(Object.assign(base(), { focus: focus(), readiness: { pain: true }, recent: [] }));
    expect(r.caution).toBeTruthy();
    expect(Data.templates[r.sessionTemplateId].type).toMatch(/light|technique|movement/);
  });

  test('fatigue produces a lighter recommendation than the hard default', () => {
    const r = Engine.recommend(Object.assign(base(), { focus: focus(), readiness: { energy: 1, upperFatigue: 3, time: 'normal' }, recent: [] }));
    expect(Data.templates[r.sessionTemplateId].type).toMatch(/light|technique|movement|skill/);
    expect(r.why).toBeTruthy();
  });

  test('a recent hard climbing session down-shifts hard pulling (climbing = pulling load)', () => {
    const hard = Engine.recommend(Object.assign(base(), { focus: focus(), readiness: { energy: 3, upperFatigue: 1, time: 'normal' }, recent: [{ kind: 'climbing', hardPull: true }] }));
    expect(Data.templates[hard.sessionTemplateId].type).not.toBe('strength');
    expect(hard.reasons.join(' ')).toContain('climbing');
  });

  test('recommendation targets the current focus and explains itself', () => {
    const f = focus();
    const r = Engine.recommend(Object.assign(base(), { focus: f, readiness: { energy: 2, upperFatigue: 2, time: 'normal' }, recent: [] }));
    expect(r.targetNodeIds).toContain(f.primary);
    expect(r.why.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────── apply session → progress ───────────────────────
test.describe('session application', () => {
  test('strength: 10 clean pull-ups completes the node and unlocks downstream', () => {
    const states = Store.seedStates(mu, { pullup_max: 9 });
    const res = Progress.applyStrength(mu, states, {
      templateId: 'mu_strength', exResults: { pullup: { bestReps: 10 } }, targetNodeIds: ['mu_pull10']
    }, Data.exercises);
    expect(Engine.isComplete(cmap(mu).mu_pull10, res.states)).toBe(true);
    expect(res.unlocked).toContain('mu_pull10');
    expect(res.bench.pullup_max).toBe(10);
  });

  test('strength: benchmarks only move by max (no noise PRs)', () => {
    const states = Store.seedStates(mu, { pullup_max: 12 });
    const res = Progress.applyStrength(mu, states, { templateId: 'mu_volume', exResults: { pullup: { bestReps: 5 } } }, Data.exercises);
    expect(res.states.mu_pull10.criteria.reps).toBe(12);
  });

  test('climbing: a send counts a distinct problem and a distinct style', () => {
    let bs = Store.seedStates(boulder, {});
    bs.b_v0 = { criteria: { sends: 5 } };
    const res = Progress.applyClimbing(boulder, bs, {
      templateId: 'b_consolidate', targetNodeIds: ['b_v1'], techniqueFocus: ['b_silentfeet'],
      problems: [{ grade: 'V1', style: 'slab', result: 'send' }, { grade: 'V1', style: 'overhang', result: 'flash' }]
    });
    expect(res.states.b_v1.criteria.sends).toBe(2);
    expect(res.states.b_v1.criteria.styles).toBe(2);
    expect(res.states.b_silentfeet.criteria.sessions).toBe(1);
  });

  test('climbing: reaching the crux advances a V5-project crux criterion', () => {
    let bs = Store.seedStates(boulder, {});
    const res = Progress.applyClimbing(boulder, bs, {
      templateId: 'b_project', targetNodeIds: ['b_v5proj'], problems: [{ grade: 'V5', style: 'overhang', result: 'crux' }]
    });
    expect(res.states.b_v5proj.criteria.crux).toBe(1);
  });
});

// ─────────────────────────── migration / storage guard ──────────────────────
test.describe('migration + storage guard', () => {
  test('deriveBench reads a legacy snapshot read-only and maps benchmarks', () => {
    const puc = {
      puc_log: [{ date: 'x', sessionType: 'strength', setType: 'work', reps: 11 }],
      puc_secondary: { skills: [{ id: 'dips', name: 'Dips', unit: 'reps', log: [{ value: 7 }] }, { id: 'rs', name: 'Ring Support', unit: 'seconds', log: [{ value: 20 }] }] }
    };
    const snapshot = JSON.stringify(puc);
    const bench = Store.deriveBench(puc);
    expect(bench.pullup_max).toBe(11);
    expect(bench.dips_max).toBe(7);
    expect(bench.ring_support_secs).toBe(20);
    expect(JSON.stringify(puc)).toBe(snapshot);
  });

  test('store refuses to write or delete any non-spc key', () => {
    const s = Store.makeStore(Store._memStore());
    expect(() => s.set('puc_log', [1])).toThrow(/spc_/);
    expect(() => s.del('puc_log')).toThrow(/spc_/);
    s.setProfile({ onboarded: true });
    expect(s.getProfile().onboarded).toBe(true);
  });
});

// ─────────────────────────── browser: UI + full loop ────────────────────────
async function seed(page, active = 'muscleup', bench = { pullup_max: 9, dips_max: 6 }) {
  // Pin "today" deterministically so Today's plan-driven session is stable:
  // Friday (5, Pull-Up Ladder) for the muscle-up world, Sunday (0, Climbing)
  // for the boulder world. addInitScript persists across the reload below.
  await page.addInitScript((dayId) => { window.__spcTodayId = dayId; }, active === 'boulder' ? 0 : 5);
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

test.describe('app UI', () => {
  test('boots into onboarding with English title and LTR, then reaches Today', async ({ page }) => {
    await page.addInitScript(() => { window.__spcTodayId = 5; }); // Friday: a training day
    await page.goto('index.html');
    await expect(page.locator('text=Skill Progression Coach')).toBeVisible();
    expect(await page.locator('html').getAttribute('dir')).toBe('ltr');
    expect(await page.locator('html').getAttribute('lang')).toBe('en');
    await page.locator('[data-world="muscleup"]').click();
    await page.locator('#q_pmax').fill('9');
    await page.locator('[data-next]').click();
    await page.locator('#days .pill').first().click();
    await page.locator('[data-next]').click();
    await expect(page.locator('.rec .name').first()).toBeVisible();
    await expect(page.locator('[data-startday]').first()).toBeVisible();
  });

  test('Today screen shows recommendation first and readiness collapsed', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    // Recommendation card should be visible immediately
    await expect(page.locator('.rec .name').first()).toBeVisible();
    await expect(page.locator('[data-startday]').first()).toBeVisible();
    // Readiness should be collapsed by default (energy/fatigue segments not visible)
    expect(await page.locator('.seg button[data-rk="energy"]').count()).toBe(0);
    // Expanding readiness should show the controls
    await page.locator('[data-toggle-readiness]').click();
    await expect(page.locator('.seg button[data-rk="energy"]').first()).toBeVisible();
  });

  test('Today shows calculated duration (not hardcoded)', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    const meta = await page.locator('.rec .meta').first().textContent();
    expect(meta).toMatch(/\d+ min/);
    expect(meta).not.toContain('—');
  });

  test('Today queue shows the scheduled plan exercises with priorities', async ({ page }) => {
    // Today is now driven by the weekly plan (Friday = Home Pull Session), shown
    // as a per-exercise QUEUE rather than one whole-workout preview.
    await page.goto('index.html'); await seed(page);
    await expect(page.locator('.queue').first()).toBeVisible();
    const queue = await page.locator('.queue').first().textContent();
    expect(queue).toContain('Pistol Squat');   // Priority A main skill
    expect(queue).toContain('Pull-Up Ladder');  // Priority A main skill
    // Priority pills are present on the queue items.
    expect(await page.locator('.queue .prio-A').count()).toBeGreaterThan(0);
    expect(queue).toContain('Toes-to-Bar'); // required, not filtered out
    // "Start Daily Workout" begins the FIRST required exercise (Pistol Squat) —
    // one exercise at a time, never the whole workout as a single block.
    await page.locator('.rec.sched [data-startday]').first().click();
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Pistol Squat');
  });

  test('map: world rail sits OUTSIDE the blue canvas; both worlds switch the tree', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await page.locator('.nav [data-s="map"]').click();
    await expect(page.locator('#rail')).toBeVisible();
    expect(await page.locator('.canvas-wrap #rail').count()).toBe(0);
    await expect(page.locator('#rail .world-ic')).toHaveCount(2);
    await expect(page.locator('#rail .world-ic.active')).toHaveCount(1);
    const title1 = await page.locator('.map-title').textContent();
    await page.locator('#rail .world-ic:not(.active)').click();
    await expect(page.locator('.map-title')).not.toHaveText(title1);
  });

  test('map: node states are distinct (aria + classes) with English labels', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await page.locator('.nav [data-s="map"]').click();
    await expect(page.locator('.node.current')).toHaveCount(1);
    expect(await page.locator('.node.completed').count()).toBeGreaterThan(0);
    expect(await page.locator('.node.locked').count()).toBeGreaterThan(0);
    const locked = page.locator('.node.locked').first();
    const ariaLabel = await locked.getAttribute('aria-label');
    expect(ariaLabel).toContain('Locked');
  });

  test('map: center-on-focus button exists', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await page.locator('.nav [data-s="map"]').click();
    await expect(page.locator('[data-center]')).toBeVisible();
  });

  test('map: path summary shows completed count and focus name', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await page.locator('.nav [data-s="map"]').click();
    const summary = await page.locator('.path-summary').first().textContent();
    expect(summary).toMatch(/\d+\/\d+ skills/);
    expect(summary).toContain('Focus');
  });

  test('node detail sheet: locked nodes explain prerequisites', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await page.locator('.nav [data-s="map"]').click();
    await page.locator('.node.locked').first().click();
    await expect(page.locator('.sheet')).toBeVisible();
    await expect(page.locator('.sheet .needs')).toBeVisible();
    const needs = await page.locator('.sheet .needs').first().textContent();
    expect(needs).toContain('Locked');
    expect(needs).toContain('complete first');
  });

  test('node detail sheet opens and shows mastery criteria', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await page.locator('.nav [data-s="map"]').click();
    await page.locator('.node.current').click();
    await expect(page.locator('.sheet')).toBeVisible();
    await expect(page.locator('.sheet .section', { hasText: 'Mastery Criteria' })).toBeVisible();
  });

  // Drive the current-action-first runner to completion. Optionally bump the
  // very first visible step up to `firstStepReps` (simulating a rep PR on a rung).
  async function completeStrengthRunner(page, firstStepReps) {
    if (firstStepReps) {
      const plus = page.locator('.cur-card [data-step="1"]').first();
      const cur = await page.locator('.cur-card .num').first().textContent();
      for (let j = +cur; j < firstStepReps; j++) await plus.click();
    }
    let guard = 0;
    while ((await page.locator('.cur-card [data-done]').count()) > 0 && guard++ < 120) {
      await page.locator('.cur-card [data-done]').first().click();
      if (await page.locator('.adapt-card [data-diff]').count()) {
        await page.locator('[data-diff="appropriate"]').click();
      }
      const skip = page.locator('[data-tskip]');
      if (await skip.count()) await skip.click();
    }
  }

  test('full loop — strength: finish a workout, unlock a node, persist across reload', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('puc_log', JSON.stringify([{ id: 1, date: 'x', sessionType: 'strength', setType: 'work', reps: 8 }]));
    });
    await page.goto('index.html'); await seed(page);
    await startLadder(page);
    // Log a 10-rep pull-up on the first rung for a PR, then finish everything.
    await completeStrengthRunner(page, 10);
    // All work done — Finish button should appear
    await page.locator('[data-finish]').click();
    await expect(page.locator('text=/Unlocked|Nice Work/')).toBeVisible();
    if (await page.locator('.unlock [data-ok]').count()) await page.locator('.unlock [data-ok]').click();
    await page.locator('[data-map]').click();
    await expect(page.locator('.node.completed', { hasText: '10 Pull-Ups' })).toBeVisible();
    // Persists across reload
    await page.reload();
    await page.locator('.nav [data-s="map"]').click();
    await expect(page.locator('.node.completed', { hasText: '10 Pull-Ups' })).toBeVisible();
    // Legacy data untouched
    const puc = await page.evaluate(() => ({
      log: localStorage.getItem('puc_log'),
      extra: Object.keys(localStorage).filter(k => k.indexOf('puc_') === 0 && k !== 'puc_log')
    }));
    expect(JSON.parse(puc.log)[0].reps).toBe(8);
    expect(puc.extra).toEqual([]);
  });

  test('ladder: difficulty is asked only after the last step of a round', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await startLadder(page);
    await expect(page.locator('.cur-meta').first()).toHaveText(/Round 1 of 5 · Step 1 of 3/);
    // Step 1 done → short rest, NO difficulty prompt.
    await page.locator('.cur-card [data-done]').click();
    expect(await page.locator('.adapt-card [data-diff]').count()).toBe(0);
    await expect(page.locator('#rest .timer')).toBeVisible();
    await page.locator('[data-tskip]').click();
    // Step 2 done → still no prompt.
    await page.locator('.cur-card [data-done]').click();
    expect(await page.locator('.adapt-card [data-diff]').count()).toBe(0);
    await page.locator('[data-tskip]').click();
    // Step 3 (last of round) done → prompt appears, rest NOT started until rated.
    await page.locator('.cur-card [data-done]').click();
    await expect(page.locator('.adapt-card')).toContainText('How did that round feel?');
    expect(await page.locator('#rest .timer').count()).toBe(0);
    // Rating Hard starts the (longer) inter-round rest and advances to round 2.
    await page.locator('[data-diff="hard"]').click();
    await expect(page.locator('#rest .timer')).toBeVisible();
    await expect(page.locator('.cur-meta').first()).toHaveText(/Round 2 of 5 · Step 1 of 3/);
  });

  test('ladder: a failed round reduces the next round, and the user can override', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await startLadder(page);
    // Round 1: do step 1 and 2, then fail the top step by logging fewer reps.
    await page.locator('.cur-card [data-done]').click(); await page.locator('[data-tskip]').click();
    await page.locator('.cur-card [data-done]').click(); await page.locator('[data-tskip]').click();
    // Step 3 target is 3; drop actual to 1 (a failure at the top), mark done, rate Failed.
    await page.locator('.cur-card [data-step="-1"]').click();
    await page.locator('.cur-card [data-step="-1"]').click();
    await page.locator('.cur-card [data-done]').click();
    await page.locator('[data-diff="failed"]').click();
    // Round 2 should now be reduced to 1–2 and an override control is offered.
    const chip = page.locator('.round-chip').nth(1);
    await expect(chip).toContainText('1–2');
    await expect(page.locator('[data-keepfull]')).toBeVisible();
    await page.locator('[data-keepfull]').click();
    // Override restores the full 1–2–3 round.
    await expect(page.locator('.round-chip').nth(1)).toContainText('1–2–3');
  });

  test('full loop — climbing: log problems and finish, updating grade progress', async ({ page }) => {
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
    await expect(page.locator('[data-grades]')).toBeVisible();
    await page.locator('[data-grades] .pill', { hasText: 'V1' }).click();
    await page.locator('[data-styles] .pill').first().click();
    await page.locator('[data-results] .pill', { hasText: 'Send' }).click();
    await page.locator('[data-add]').click();
    await expect(page.locator('.prob')).toHaveCount(1);
    await page.locator('[data-finish]').click();
    await expect(page.locator('text=/Nice Work|Unlocked/')).toBeVisible();
    if (await page.locator('.unlock [data-ok]').count()) await page.locator('.unlock [data-ok]').click();
    await page.locator('[data-today]').click();
    await page.locator('.nav [data-s="progress"]').click();
    await expect(page.getByText('Skills Completed')).toBeVisible();
    await expect(page.locator('.chart .bar')).toHaveCount(1);
  });

  test('refresh preserves the current round, step, and logged reps', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await startLadder(page);
    // Advance into round 2 (complete all three steps of round 1).
    await page.locator('.cur-card [data-done]').click(); await page.locator('[data-tskip]').click();
    await page.locator('.cur-card [data-done]').click(); await page.locator('[data-tskip]').click();
    await page.locator('.cur-card [data-done]').click();
    await page.locator('[data-diff="appropriate"]').click();
    if (await page.locator('[data-tskip]').count()) await page.locator('[data-tskip]').click();
    await expect(page.locator('.cur-meta').first()).toHaveText(/Round 2 of 5 · Step 1 of 3/);
    // Log some reps on the current step, then reload.
    const plus = page.locator('.cur-card [data-step="1"]').first();
    await plus.click(); await plus.click();
    const numBefore = await page.locator('.cur-card .num').first().textContent();
    await page.reload();
    await expect(page.locator('.cur-card')).toBeVisible();
    // Same round/step and same logged reps survive the refresh.
    await expect(page.locator('.cur-meta').first()).toHaveText(/Round 2 of 5 · Step 1 of 3/);
    expect(await page.locator('.cur-card .num').first().textContent()).toBe(numBefore);
  });

  test('Today, Map, and Node Detail consume one canonical state (same focus for pmax=9)', async ({ page }) => {
    await page.goto('index.html'); await seed(page, 'muscleup', { pullup_max: 9, dips_max: 6 });
    // Today
    const today = await page.locator('.path-summary').first().textContent();
    expect(today).toMatch(/\d+\/16 skills/);
    expect(today).toContain('10 Pull-Ups');
    expect(today).toContain('9/10');
    const todayCount = today.match(/(\d+)\/16 skills/)[1];
    // Map — same completed count and same focus node
    await page.locator('.nav [data-s="map"]').click();
    const map = await page.locator('.path-summary').first().textContent();
    expect(map).toContain(`${todayCount}/16 skills`);
    expect(map).toContain('10 Pull-Ups');
    await expect(page.locator('.node.current .nm')).toHaveText('10 Pull-Ups');
    // Node Detail for the current focus — same 9/10 progress
    await page.locator('.node.current').click();
    await expect(page.locator('.sheet h2')).toHaveText('10 Pull-Ups');
    await expect(page.locator('.sheet')).toContainText('9/10');
  });

  test('map reflects stored benchmarks even when node state was never seeded', async ({ page }) => {
    // Only benchmarks + an onboarded profile exist — no spc_c_state written.
    await page.addInitScript(() => { window.__spcTodayId = 5; }); // pin a muscle-up day (not Sunday climbing)
    await page.goto('index.html');
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore();
      S.setBench({ pullup_max: 9, dips_max: 6 });
      S.setProfile({ onboarded: true, activeWorld: 'muscleup', days: [1, 3, 5], duration: 'normal' });
    });
    await page.reload();
    // Today derives progress from the benchmark fixture...
    await expect(page.locator('.path-summary').first()).toContainText('10 Pull-Ups');
    // ...and the Map derives the SAME focus (not a zeroed "Active Dead Hang").
    await page.locator('.nav [data-s="map"]').click();
    await expect(page.locator('.node.current .nm')).toHaveText('10 Pull-Ups');
    await expect(page.locator('.path-summary').first()).not.toContainText('0/16');
  });

  test('canonical view does not overwrite onboarded/migrated progress', async ({ page }) => {
    await page.goto('index.html'); await seed(page, 'muscleup', { pullup_max: 9, dips_max: 6 });
    // Manually complete a node that benchmarks alone can NOT derive (Chest-to-Bar
    // has no seeding benchmark) — as onboarding "Yes, Chest-to-Bar" would.
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore(), st = S.getState(), D = window.CoachData;
      const c2b = D.worldsById.muscleup.nodes.find(n => n.id === 'mu_c2b');
      st.muscleup.nodes.mu_c2b = { criteria: {} };
      c2b.criteria.forEach(cr => (st.muscleup.nodes.mu_c2b.criteria[cr.id] = cr.target));
      S.setState(st);
    });
    await page.reload();
    // Navigate through screens that all call the canonical worldView().
    await page.locator('.nav [data-s="map"]').click();
    await page.locator('.nav [data-s="today"]').click();
    await page.locator('.nav [data-s="map"]').click();
    // The manually-completed node is still completed — not wiped by lazy seeding.
    await expect(page.locator('.node.completed', { hasText: 'Chest-to-Bar' })).toBeVisible();
  });

  test('the app registers its own service worker scoped to /skill-progression-coach/', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    const reg = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return null;
      const r = await navigator.serviceWorker.getRegistration();
      return r ? { scope: r.scope } : null;
    });
    expect(reg).not.toBeNull();
    expect(reg.scope).toMatch(/\/skill-progression-coach\/$/);
  });
});

// ─────────────────────────── settings: resolved prescription ─────────────────
test.describe('settings / resolved prescription', () => {
  const mu_strength = Data.templates.mu_strength;

  test('resolves template defaults when nothing is customised', () => {
    const s = CoachSettings.defaultSettings();
    const rt = CoachSettings.resolvePrescription(mu_strength, s, null);
    expect(rt.blocks[0].rounds).toBe(5);
    expect(rt.blocks[0].restBetweenStepsSec).toBe(25);
    expect(rt.blocks[0].restBetweenRoundsSec).toBe(150);
    expect(rt.blocks[1].restSecs).toBe(120);
  });

  test('user default overrides template; today edit overrides user default without mutating it', () => {
    const s = CoachSettings.defaultSettings();
    const def = CoachSettings.defaultsForTemplate(mu_strength);
    def.blocks[0].rounds = 4;
    s.workoutDefaults.mu_strength = def;
    expect(CoachSettings.resolvePrescription(mu_strength, s, null).blocks[0].rounds).toBe(4);
    const todayEdit = JSON.parse(JSON.stringify(def)); todayEdit.blocks[0].rounds = 5;
    expect(CoachSettings.resolvePrescription(mu_strength, s, todayEdit).blocks[0].rounds).toBe(5);
    // The saved default is untouched by the today edit.
    expect(s.workoutDefaults.mu_strength.blocks[0].rounds).toBe(4);
    expect(CoachSettings.isModifiedForToday(mu_strength, s, todayEdit)).toBe(true);
  });

  test('short (step) and long (round) rests stay distinct through resolution', () => {
    const s = CoachSettings.defaultSettings();
    const rt = CoachSettings.resolvePrescription(mu_strength, s, null);
    expect(rt.blocks[0].restBetweenStepsSec).not.toBe(rt.blocks[0].restBetweenRoundsSec);
    const rests = Duration.restsBetween(rt);
    const short = rests.filter(r => r.kind === 'short'), long = rests.filter(r => r.kind === 'long');
    expect(short.every(r => r.sec === 25)).toBe(true);
    expect(long.every(r => r.sec === 150)).toBe(true);
    expect(short[0].sec).not.toBe(long[0].sec);
  });

  test('duration recalculates from an edited prescription', () => {
    const s = CoachSettings.defaultSettings();
    const base = Duration.calcDurationRange(CoachSettings.resolvePrescription(mu_strength, s, null));
    const def = CoachSettings.defaultsForTemplate(mu_strength); def.blocks[0].rounds = 4;
    const edited = Duration.calcDurationRange(CoachSettings.resolvePrescription(mu_strength, s, def));
    expect(edited.maxSec).toBeLessThan(base.maxSec); // fewer rounds → shorter
  });

  test('parse/format helpers round-trip rests and steps', () => {
    expect(CoachSettings.parseSecs('2:30')).toBe(150);
    expect(CoachSettings.fmtSecs(150)).toBe('2:30');
    expect(CoachSettings.parseSteps('1–2–3')).toEqual([1, 2, 3]);
    expect(CoachSettings.parseSteps('5,4,3,2,1')).toEqual([5, 4, 3, 2, 1]);
  });

  test('migration yields a valid shape and preserves unknown keys', () => {
    const m = CoachSettings.migrate({ workoutDefaults: { x: 1 }, custom: 'keep' });
    expect(m.timer).toBeTruthy();
    expect(m.exercises).toBeTruthy();
    expect(m.custom).toBe('keep');
    expect(m.version).toBe(CoachSettings.SETTINGS_VERSION);
  });
});

// ─────────────────────────── V5 proposal artifact ────────────────────────────
test.describe('V5 skill-tree proposal (review artifact)', () => {
  test('JSON validates against the expected schema', () => {
    expect(v5Proposal.status).toBe('proposal-pending-review');
    expect(v5Proposal.world).toBe('boulder');
    // Five capability lanes.
    const laneIds = v5Proposal.lanes.map(l => l.id);
    expect(laneIds.sort()).toEqual(['core', 'grade', 'grip', 'legs', 'pull']);
    // 20–40 meaningful nodes.
    expect(v5Proposal.nodes.length).toBeGreaterThanOrEqual(20);
    expect(v5Proposal.nodes.length).toBeLessThanOrEqual(40);
    const ids = new Set(v5Proposal.nodes.map(n => n.id));
    const edgeTypes = new Set(v5Proposal.edgeTypes);
    v5Proposal.nodes.forEach(n => {
      ['id', 'lane', 'name', 'type', 'description', 'criteria', 'prereqs', 'goalsSupported', 'required', 'mapPos', 'confidence', 'rationale']
        .forEach(k => expect(n).toHaveProperty(k));
      expect(laneIds).toContain(n.lane);
      (n.prereqs || []).forEach(p => {
        expect(edgeTypes.has(p.type)).toBe(true);   // every edge is a known relationship type
        expect(ids.has(p.from)).toBe(true);          // every prerequisite resolves
      });
    });
    // All five relationship types are represented (SHARED_CAPABILITY via node field).
    const used = new Set();
    v5Proposal.nodes.forEach(n => { (n.prereqs || []).forEach(p => used.add(p.type)); if (n.sharedCapability) used.add('SHARED_CAPABILITY'); });
    ['REQUIRED', 'SUPPORTS', 'ALTERNATIVE', 'UNLOCKS_ASSESSMENT', 'SHARED_CAPABILITY'].forEach(t => expect(used.has(t)).toBe(true));
    // Required content is addressed.
    ['10 Strict Pull-Ups', 'Weighted Pull-Up', 'Active Dead Hang', 'Hollow Body', 'Pistol Squat', 'Controlled High Step']
      .forEach(name => expect(v5Proposal.nodes.some(n => n.name.indexOf(name) >= 0)).toBe(true));
  });

  test('shared capability schema can reference more than one world', () => {
    expect(v5Proposal.sharedCapabilities.length).toBeGreaterThan(0);
    v5Proposal.sharedCapabilities.forEach(c => {
      expect(Array.isArray(c.worlds)).toBe(true);
      expect(c.worlds.length).toBeGreaterThanOrEqual(2);
    });
    const pull10 = v5Proposal.sharedCapabilities.find(c => c.id === 'cap_pull10');
    expect(pull10.worlds).toContain('muscleup');
    expect(pull10.worlds).toContain('boulder');
    expect(pull10.nodeByWorld.muscleup).toBe('mu_pull10');
  });

  test('supporting capabilities are not marked as universal V5 requirements', () => {
    // No pull/grip/core/legs node is a REQUIRED prerequisite of the First V5 Send.
    const v5 = v5Proposal.nodes.find(n => n.id === 'v5_grade_v5');
    const requiredInto = (v5.prereqs || []).filter(p => p.type === 'REQUIRED').map(p => p.from);
    const supportLanes = new Set(['pull', 'grip', 'core', 'legs']);
    requiredInto.forEach(fromId => {
      const node = v5Proposal.nodes.find(n => n.id === fromId);
      expect(supportLanes.has(node.lane)).toBe(false); // only grade-lane nodes gate V5
    });
  });

  test('no proposal node id leaks into the live app content', () => {
    const proposalIds = new Set(v5Proposal.nodes.map(n => n.id));
    Data.worlds.forEach(w => w.nodes.forEach(n => expect(proposalIds.has(n.id)).toBe(false)));
    // Proposed-only exercises are absent from the live catalog too.
    ['wrist_roller', 'pistol_squat', 'high_step'].forEach(id => expect(Data.exercises[id]).toBeUndefined());
  });
});

// ─────────────────────────── browser: settings & editing ─────────────────────
test.describe('settings UI', () => {
  test('Profile hub exposes Workout Defaults, Timer & Alerts, and Exercise Library', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await page.locator('.nav [data-s="profile"]').click();
    const titles = await page.locator('.settings-row[data-sview] .sr-title').allTextContents();
    const joined = titles.join('|');
    expect(joined).toContain('Workout Defaults');
    expect(joined).toMatch(/Timer/);
    expect(joined).toContain('Exercise Library');
  });

  test('ladder settings can be edited and short/long rests stay distinct', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await page.locator('.nav [data-s="profile"]').click();
    await page.locator('[data-sview="workoutDefaults"]').click();
    await page.locator('[data-editdef="mu_strength"]').click();
    await expect(page.locator('.ed-block').first()).toBeVisible();
    const stepRest = page.locator('.ed-in[data-ed="restStep"][data-bi="0"]');
    const roundRest = page.locator('.ed-in[data-ed="restRound"][data-bi="0"]');
    await stepRest.fill('0:30'); await stepRest.dispatchEvent('change');
    await roundRest.fill('3:00'); await roundRest.dispatchEvent('change');
    await expect(page.locator('.ed-in[data-ed="restStep"][data-bi="0"]')).toHaveValue('0:30');
    await expect(page.locator('.ed-in[data-ed="restRound"][data-bi="0"]')).toHaveValue('3:00');
    expect(await page.locator('.ed-in[data-ed="restStep"][data-bi="0"]').inputValue())
      .not.toBe(await page.locator('.ed-in[data-ed="restRound"][data-bi="0"]').inputValue());
  });

  test('duration in the editor recalculates as fields change', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await page.locator('.nav [data-s="profile"]').click();
    await page.locator('[data-sview="workoutDefaults"]').click();
    await page.locator('[data-editdef="mu_strength"]').click();
    const before = await page.locator('.ed-dur').textContent();
    const rounds = page.locator('.ed-in[data-ed="rounds"][data-bi="0"]');
    await rounds.fill('4'); await rounds.dispatchEvent('change');
    const after = await page.locator('.ed-dur').textContent();
    expect(after).not.toBe(before);
  });

  test('save as default persists after refresh; reset restores the template default', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    await page.locator('.nav [data-s="profile"]').click();
    await page.locator('[data-sview="workoutDefaults"]').click();
    await page.locator('[data-editdef="mu_strength"]').click();
    const rounds = page.locator('.ed-in[data-ed="rounds"][data-bi="0"]');
    await rounds.fill('4'); await rounds.dispatchEvent('change');
    await page.locator('[data-edsavedefault]').click();
    // Persists after refresh.
    await page.reload();
    const saved = await page.evaluate(() => {
      const s = window.CoachStore.makeStore().getSettings();
      return s && s.workoutDefaults && s.workoutDefaults.mu_strength ? s.workoutDefaults.mu_strength.blocks[0].rounds : null;
    });
    expect(saved).toBe(4);
    // Reset in the editor restores the template default (5 rounds) in the working copy.
    await page.locator('.nav [data-s="profile"]').click();
    await page.locator('[data-sview="workoutDefaults"]').click();
    await page.locator('[data-editdef="mu_strength"]').click();
    await page.locator('[data-edreset]').click();
    await expect(page.locator('.ed-in[data-ed="rounds"][data-bi="0"]')).toHaveValue('5');
  });

  test('workout-only edit updates Today but does not modify the saved default', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    // Establish a saved default of 4 rounds.
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore(), D = window.CoachData;
      const s = window.CoachSettings.migrate(S.getSettings());
      const def = window.CoachSettings.defaultsForTemplate(D.templates.mu_strength);
      def.blocks[0].rounds = 4; s.workoutDefaults.mu_strength = def; S.setSettings(s);
    });
    await page.reload();
    // Friday's Start-Workout preview runs the Pull-Up Ladder from the (edited)
    // mu_strength default: 4 rounds.
    const ladderEx = page.locator('.wk-ex', { hasText: 'Pull-Up Ladder' });
    await expect(ladderEx).toContainText('× 4 complete');
    // Edit the Pull-Up Ladder for today only → 5 rounds.
    await page.locator('[data-editwk]').first().click();
    const rounds = page.locator('.ed-in[data-ed="rounds"][data-bi="0"]');
    await rounds.fill('5'); await rounds.dispatchEvent('change');
    await page.locator('[data-edsavetoday]').click();
    // Today preview updates + shows the Modified flag...
    await expect(page.locator('.wk-ex', { hasText: 'Pull-Up Ladder' })).toContainText('× 5 complete');
    await expect(page.locator('.modified-flag')).toBeVisible();
    // ...but the saved default is still 4.
    const savedDefault = await page.evaluate(() => window.CoachStore.makeStore().getSettings().workoutDefaults.mu_strength.blocks[0].rounds);
    expect(savedDefault).toBe(4);
  });

  test('the daily plan list is visible on Today and item details open', async ({ page }) => {
    await page.goto('index.html'); await seed(page); // Friday
    await expect(page.locator('.q-ex')).not.toHaveCount(0);
    await expect(page.locator('.q-ex .q-name').first()).toHaveText('Pistol Squat');
    // Tapping a queue item opens its canonical metadata (goals/skills/plan days).
    await page.locator('.q-ex .q-name', { hasText: 'Pull-Up Ladder' }).click();
    await expect(page.locator('.sheet h2')).toContainText('Pull-Up Ladder');
    await expect(page.locator('.sheet')).toContainText('In your weekly plan');
    await expect(page.locator('.sheet')).toContainText('Friday');
  });

  test('an approved exercise replacement in Workout Defaults takes effect in the workout', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    // Edit the mu_strength default via Profile → Workout Defaults.
    await page.locator('.nav [data-s="profile"]').click();
    await page.locator('[data-sview="workoutDefaults"]').click();
    await page.locator('[data-editdef="mu_strength"]').click();
    // Scapular Pull-Ups (block 1) has an approved alternative (Ring Row).
    await page.locator('[data-edreplace="1"]').click();
    await expect(page.locator('[data-pick]').first()).toBeVisible();
    await page.locator('[data-pick]').first().click();
    await page.locator('[data-edsavedefault]').click();
    // The replacement carries into the mu_strength runner (started from the map).
    await startLadder(page);
    await expect(page.locator('.scr')).toContainText('Ring Row');
  });

  test('a running workout keeps its snapshot even when the default later changes', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    // Save a default of 3 rounds, then start (baking 3 into the snapshot).
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore(), D = window.CoachData;
      const s = window.CoachSettings.migrate(S.getSettings());
      const def = window.CoachSettings.defaultsForTemplate(D.templates.mu_strength);
      def.blocks[0].rounds = 3; s.workoutDefaults.mu_strength = def; S.setSettings(s);
    });
    await page.reload();
    await startLadder(page);
    await expect(page.locator('.cur-meta').first()).toHaveText(/Round 1 of 3/);
    // Change the saved default underneath the running workout.
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore(), D = window.CoachData;
      const s = S.getSettings();
      s.workoutDefaults.mu_strength.blocks[0].rounds = 5; S.setSettings(s);
    });
    // The active workout is unaffected — still 3 rounds — even across a reload.
    await page.reload();
    await expect(page.locator('.cur-meta').first()).toHaveText(/Round 1 of 3/);
  });

  test('dynamic adaptation uses the resolved prescription and never rewrites the default', async ({ page }) => {
    await page.goto('index.html'); await seed(page);
    // Custom default: step rest 30, round rest 180.
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore(), D = window.CoachData;
      const s = window.CoachSettings.migrate(S.getSettings());
      const def = window.CoachSettings.defaultsForTemplate(D.templates.mu_strength);
      def.blocks[0].restBetweenStepsSec = 30; def.blocks[0].restBetweenRoundsSec = 180;
      s.workoutDefaults.mu_strength = def; S.setSettings(s);
    });
    await page.reload();
    await startLadder(page);
    // Complete round 1 and rate it Hard (adds inter-round rest to the snapshot only).
    await page.locator('.cur-card [data-done]').click(); await page.locator('[data-tskip]').click();
    await page.locator('.cur-card [data-done]').click(); await page.locator('[data-tskip]').click();
    await page.locator('.cur-card [data-done]').click();
    await page.locator('[data-diff="hard"]').click();
    // The saved default rests are unchanged by the in-session adaptation.
    const def = await page.evaluate(() => window.CoachStore.makeStore().getSettings().workoutDefaults.mu_strength.blocks[0]);
    expect(def.restBetweenStepsSec).toBe(30);
    expect(def.restBetweenRoundsSec).toBe(180);
  });

  test('editing settings never writes a legacy puc_* key', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('puc_log', JSON.stringify([{ id: 1, reps: 8, setType: 'work' }])));
    await page.goto('index.html'); await seed(page);
    await page.locator('.nav [data-s="profile"]').click();
    await page.locator('[data-sview="workoutDefaults"]').click();
    await page.locator('[data-editdef="mu_strength"]').click();
    const rounds = page.locator('.ed-in[data-ed="rounds"][data-bi="0"]');
    await rounds.fill('4'); await rounds.dispatchEvent('change');
    await page.locator('[data-edsavedefault]').click();
    const legacy = await page.evaluate(() => ({
      log: localStorage.getItem('puc_log'),
      pucKeys: Object.keys(localStorage).filter(k => k.indexOf('puc_') === 0)
    }));
    expect(JSON.parse(legacy.log)[0].reps).toBe(8);
    expect(legacy.pucKeys).toEqual(['puc_log']); // untouched, nothing added
  });

  test('the live app renders no V5 proposal nodes', async ({ page }) => {
    await page.goto('index.html'); await seed(page, 'boulder', {});
    await page.locator('.nav [data-s="map"]').click();
    await expect(page.locator('.node').first()).toBeVisible();
    const nodeIds = await page.evaluate(() => Array.from(document.querySelectorAll('.node')).map(n => n.dataset.node));
    expect(nodeIds.some(id => id && id.indexOf('v5_') === 0)).toBe(false);
  });
});
