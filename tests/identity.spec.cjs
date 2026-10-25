// Skill Progression Coach — E1: the exercise a workout is recorded AS.
//
// The Evidence ledger is append-only, so a wrong exercise identity can never be
// corrected after the fact. These tests pin that every live workout writes the
// identity of the movement the athlete actually performed, and that no future
// change can quietly map one physical movement onto a different bundle exercise
// just because the runner happens to reuse a block.
//
// THE MAPPINGS BELOW ARE WRITTEN OUT BY HAND. They are not derived from the
// table under test and not matched by name: a test that computed its own
// expected value from the code would pass for any mapping at all.
const { test, expect } = require('@playwright/test');
// Written for the earlier weekly-plan app, which now runs only behind the
// legacy shell switch; these tests keep guarding it there.
test.beforeEach(async ({ page }) => { await page.addInitScript(() => { window.__spcLegacyShell = true; }); });
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const W = require(path.join(REPO, 'week.js'));
const Data = require(path.join(REPO, 'data.js'));
const Evidence = require(path.join(REPO, 'evidence.js'));
const V = require(path.join(REPO, 'tools', 'validate-content.cjs'));

const CONTENT = V.loadContentDir(path.join(REPO, 'content'));
const BUNDLE = CONTENT.bundles[0];
const EXERCISES = {};
BUNDLE.exercises.forEach((e) => { EXERCISES[e.id] = e; });

// ── the identity table, by hand ───────────────────────────────────────────
const VARIANT_EXPECTED = {
  highpull: { high_pull: 'fastpull', chest_to_bar: 'c2b' },
  transition_drill: {
    low_bar: 'lowtrans', low_ring: 'lowring_transition',
    banded_ring: 'banded_ring_transition', ring: 'ring_transition'
  },
  pistol: { box: 'box_pistol', heel: 'pistol_heel', full: 'pistol' }
};
const ident = (item, variant, blockEx) => W.evidenceIdentity(item, blockEx || null, variant === undefined ? null : variant);

test.describe('E1 identity — what each plan item is recorded as', () => {
  test('01 Parallel Bar Dips can never be recorded as `dip`', () => {
    // Whatever the runner's block says, and whatever "variant" is passed.
    ['dip', 'pbdip', null, undefined, '', 'anything'].forEach((blockEx) => {
      ['high_pull', 'full', '', null, undefined].forEach((v) => {
        const r = W.evidenceIdentity('pbdips', blockEx, v);
        expect(r.exerciseId, 'block=' + blockEx + ' variant=' + v).not.toBe('dip');
      });
    });
    // and nothing in the whole table maps to `dip` except the item that IS one
    Object.keys(W.EVIDENCE_IDENTITY).forEach((item) => {
      const e = W.EVIDENCE_IDENTITY[item];
      const ids = e.variants ? e.variants.map((v) => v.exerciseId) : [e.exerciseId];
      expect(ids, item).not.toContain('dip');
    });
  });

  test('02 Parallel Bar Dips are recorded as `pbdip`', () => {
    expect(ident('pbdips', null, 'dip').exerciseId).toBe('pbdip');
    expect(W.EVIDENCE_IDENTITY.pbdips).toEqual({ exerciseId: 'pbdip' });
  });

  test('03 High Pull is recorded as `fastpull`', () => {
    expect(ident('highpull', 'high_pull').exerciseId).toBe('fastpull');
  });
  test('04 Chest-to-Bar is recorded as `c2b`', () => {
    expect(ident('highpull', 'chest_to_bar').exerciseId).toBe('c2b');
  });
  test('05 the low-bar transition drill is recorded as `lowtrans`', () => {
    expect(ident('transition_drill', 'low_bar').exerciseId).toBe('lowtrans');
  });
  test('06 low rings with the feet assisting is `lowring_transition`', () => {
    expect(ident('transition_drill', 'low_ring').exerciseId).toBe('lowring_transition');
  });
  test('07 the banded ring transition is `banded_ring_transition`', () => {
    expect(ident('transition_drill', 'banded_ring').exerciseId).toBe('banded_ring_transition');
  });
  test('08 the unassisted ring transition is `ring_transition`', () => {
    expect(ident('transition_drill', 'ring').exerciseId).toBe('ring_transition');
  });
  test('09 a box pistol is recorded as `box_pistol`', () => {
    expect(ident('pistol', 'box').exerciseId).toBe('box_pistol');
  });
  test('10 a heel-elevated pistol is recorded as `pistol_heel`', () => {
    expect(ident('pistol', 'heel').exerciseId).toBe('pistol_heel');
  });
  test('11 only a full pistol squat is recorded as `pistol`', () => {
    expect(ident('pistol', 'full').exerciseId).toBe('pistol');
    // A supporting variant must never become the Goal's terminal exercise.
    ['box', 'heel'].forEach((v) => expect(ident('pistol', v).exerciseId, v).not.toBe('pistol'));
  });

  test('12 every identity a live path can emit is declared in the content bundle', () => {
    const emitted = [];
    Object.keys(W.EVIDENCE_IDENTITY).forEach((item) => {
      const e = W.EVIDENCE_IDENTITY[item];
      if (e.variants) e.variants.forEach((v) => emitted.push([item, v.exerciseId]));
      else if (e.fromBlock) {
        // The one replaceable block: the athlete may swap it for an approved
        // alternative, so every id it could become must be declared too.
        const own = W.EX[item].block.exId;
        [own].concat((Data.exercises[own] || {}).alternatives || []).forEach((id) => emitted.push([item, id]));
      } else emitted.push([item, e.exerciseId]);
    });
    expect(emitted.length).toBeGreaterThan(20);
    emitted.forEach(([item, id]) => expect(EXERCISES[id], item + ' -> ' + id).toBeTruthy());
  });

  test('13 every plan item with a runner has an authored identity, and none is orphaned', () => {
    const withBlock = Object.keys(W.EX).filter((id) => W.EX[id].block).sort();
    expect(withBlock.length).toBe(20);
    expect(Object.keys(W.EVIDENCE_IDENTITY).sort()).toEqual(withBlock);
  });

  test('14 the variants are exactly the authored ones, in the authored order', () => {
    Object.keys(VARIANT_EXPECTED).forEach((item) => {
      const vs = W.variantsOf(item);
      expect(vs.map((v) => v.id), item).toEqual(Object.keys(VARIANT_EXPECTED[item]));
      vs.forEach((v) => expect(v.exerciseId, item + '/' + v.id).toBe(VARIANT_EXPECTED[item][v.id]));
    });
    // and no other item offers a choice
    Object.keys(W.EVIDENCE_IDENTITY).filter((i) => !VARIANT_EXPECTED[i])
      .forEach((i) => expect(W.variantsOf(i), i).toBeNull());
  });

  test('15 each runner title is the bundle\'s own name for the exercise, not a paraphrase', () => {
    Object.keys(VARIANT_EXPECTED).forEach((item) => {
      W.variantsOf(item).forEach((v) => {
        expect(v.runnerLabel, item + '/' + v.id).toBe(EXERCISES[v.exerciseId].name);
      });
    });
  });

  test('16 every variant is an exercise the existing reps runner can truthfully run', () => {
    // E1 adds no workout mechanics. A variant whose exercise does not record
    // reps could not run through the reps runner without inventing something.
    Object.keys(VARIANT_EXPECTED).forEach((item) => {
      W.variantsOf(item).forEach((v) => {
        expect(EXERCISES[v.exerciseId].producesAttributes, item + '/' + v.id).toContain('reps');
        expect(W.EX[item].block.scheme, item).toBe('sets');
      });
    });
  });

  test('17 the resolver never guesses', () => {
    expect(ident('pistol', null)).toEqual({ error: 'variant_required' });
    expect(ident('pistol', '')).toEqual({ error: 'variant_required' });
    expect(ident('pistol', 'nonsense')).toEqual({ error: 'unknown_variant' });
    expect(ident('highpull', 'box')).toEqual({ error: 'unknown_variant' });   // another item's variant
    expect(W.evidenceIdentity('not_a_plan_item', 'x', null)).toEqual({ error: 'unknown_item' });
    expect(W.evidenceIdentity('pullup_ladder', null, null)).toEqual({ error: 'no_block_identity' });
  });

  test('18 the Pull-Up Ladder is recorded as whatever the athlete actually ran', () => {
    expect(W.evidenceIdentity('pullup_ladder', 'pullup', null).exerciseId).toBe('pullup');
    expect(W.evidenceIdentity('pullup_ladder', 'ring_row', null).exerciseId).toBe('ring_row');
    expect(W.evidenceIdentity('pullup_ladder', 'weighted_pullup', null).exerciseId).toBe('weighted_pullup');
  });

  test('19 the legacy runner identities are untouched, so legacy progress is unchanged', () => {
    // Progress.applyStrength reads these. Changing any of them would change what
    // the authoritative legacy engine credits, which E1 must not do.
    expect(W.EX.pbdips.block.exId).toBe('dip');
    expect(W.EX.highpull.block.exId).toBe('fastpull');
    expect(W.EX.transition_drill.block.exId).toBe('lowtrans');
    expect(W.EX.pistol.block.exId).toBe('pistol');
    expect(W.EX.pullup_ladder.block.exId).toBe('pullup');
  });

  test('20 the archived legacy template workouts only name exercises the bundle declares', () => {
    // Reachable only from the archived Skill Map. Their blocks carry their own
    // honest ids and have no plan item, so they are recorded as-is.
    const ids = {};
    Object.keys(Data.templates).forEach((t) => (Data.templates[t].blocks || []).forEach((b) => { ids[b.exId] = t; }));
    expect(Object.keys(ids).length).toBeGreaterThan(8);
    Object.keys(ids).forEach((id) => expect(EXERCISES[id], id + ' (' + ids[id] + ')').toBeTruthy());
  });

  test('21 normal Evidence attributes are unchanged: a reps block still records reps and nothing else', () => {
    // The quality attributes are E3's job. Choosing a variant must not conjure
    // any of them, whatever the exercise could in principle produce.
    Object.keys(VARIANT_EXPECTED).forEach((item) => {
      W.variantsOf(item).forEach((v) => {
        const rows = Evidence.fromWorkout({
          workoutId: 'w_id', blocks: [{ kind: 'straight', scheme: 'sets', exId: v.exerciseId, restSecs: 90,
            sets: [{ target: 3, actual: 3, unit: 'reps', doneFlag: true }] }]
        }, { contextId: 'ctx_1', bundle: BUNDLE, unmetDependencies: [], now: '2026-10-11T10:00:00.000Z' });
        expect(rows.length, v.exerciseId).toBe(1);
        expect(rows[0].exerciseId).toBe(v.exerciseId);
        expect(rows[0].attributes, v.exerciseId).toEqual({ reps: 3 });
        expect(rows[0].side, v.exerciseId).toBeNull();
      });
    });
  });
});

// ── through the real runner, into the real ledger ─────────────────────────
async function seed(page, dayId) {
  await page.addInitScript((d) => { window.__spcTodayId = d; }, dayId);
  await page.goto('index.html');
  await page.evaluate(() => {
    const S = window.CoachStore.makeStore(), D = window.CoachData, E = window.CoachEngine;
    const bench = { pullup_max: 9, dips_max: 6 }; const state = {};
    D.worlds.forEach((w) => {
      const nodes = window.CoachStore.seedStates(w, bench);
      const f = E.autoFocus(w, nodes);
      state[w.id] = { nodes, focus: { primary: f.primary, supporting: f.supporting, manual: false } };
    });
    S.setBench(bench); S.setState(state);
    S.setProfile({ onboarded: true, activeWorld: 'muscleup', days: [0, 2, 4], duration: 'normal' });
    ['spc_c_day', 'spc_c_sessions', 'spc_c_workout', 'spc_c_adhoc', 'spc_c_plan', 'spc_c_templates']
      .forEach((k) => localStorage.removeItem(k));
  });
  await page.reload();
  await expect(page.locator('.rec.sched, .rec')).toBeVisible({ timeout: 15000 });
}

async function runToFinishPanel(page) {
  for (let i = 0; i < 200; i++) {
    if (await page.locator('[data-finish],[data-finishex]').count()) return;
    if (await page.locator('[data-diff="appropriate"]').count()) { await page.locator('[data-diff="appropriate"]').first().click(); continue; }
    if (await page.locator('[data-pyrdiff="appropriate"]').count()) { await page.locator('[data-pyrdiff="appropriate"]').first().click(); continue; }
    if (await page.locator('[data-tskip]').count()) { await page.locator('[data-tskip]').first().click(); continue; }
    if (await page.locator('.cur-card [data-done]').count()) { await page.locator('.cur-card [data-done]').first().click(); continue; }
    await page.waitForTimeout(40);
  }
  throw new Error('runner never reached a finish panel');
}

// The ledger once the fire-and-forget tap has settled: stable across two reads.
async function settledLedger(page) {
  let last = -1;
  for (let i = 0; i < 100; i++) {
    const rows = await page.evaluate(() => window.CoachIDB.all('ledger'));
    if (rows.length > 0 && rows.length === last) return rows;
    last = rows.length;
    await page.waitForTimeout(80);
  }
  return page.evaluate(() => window.CoachIDB.all('ledger'));
}

const rowFor = (page, name) => page.locator('.q-ex', { hasText: name });

// Start an item from Today, answer the question if it is asked, run it to the
// end, and return what the ledger recorded.
async function performVariant(page, dayId, itemName, variantId) {
  await seed(page, dayId);
  await rowFor(page, itemName).locator('[data-exstart]').click();
  if (variantId) await page.locator('[data-vpick="' + variantId + '"]').click();
  await runToFinishPanel(page);
  await page.locator('[data-finish],[data-finishex]').first().click();
  return settledLedger(page);
}

test.describe('E1 identity — through the real runner into the ledger', () => {
  test('22 the first start of an ambiguous item asks, and cancelling starts nothing', async ({ page }) => {
    await seed(page, 5);
    await rowFor(page, 'Pistol Squat').locator('[data-exstart]').click();
    await expect(page.locator('.sheet h2')).toContainText('Which pistol squat are you doing?');
    await expect(page.locator('[data-vpick]')).toHaveCount(3);
    // Nothing was built, saved or marked in progress behind the question.
    expect(await page.evaluate(() => localStorage.getItem('spc_c_workout'))).toBeNull();
    await page.locator('.sheet [data-close]').click();
    await expect(page.locator('.sheet')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('spc_c_workout'))).toBeNull();
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_day'))
      .exercises.find((e) => e.exId === 'pistol').state);
    expect(state).toBe('not_started');
    expect(await page.evaluate(() => localStorage.getItem('spc_c_profile')))
      .not.toContain('variants');
  });

  test('23 a box pistol is written to the ledger as `box_pistol`, never `pistol`', async ({ page }) => {
    const rows = await performVariant(page, 5, 'Pistol Squat', 'box');
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((r) => {
      expect(r.exerciseId).toBe('box_pistol');
      expect(r.kind).toBe('PerformanceObservation');
      expect(r.provenance).toBe('demonstrated');
      expect(r.provenanceSource).toBe('in_session');
      expect(Object.keys(r.attributes)).toEqual(['reps']);   // no depth, no execution
      expect(r.side).toBeNull();                              // no side was asked, none is claimed
      expect(r.context.contextId).toBe('ctx_1');
    });
  });

  test('24 a heel-elevated pistol is written as `pistol_heel`', async ({ page }) => {
    const rows = await performVariant(page, 5, 'Pistol Squat', 'heel');
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((r) => { expect(r.exerciseId).toBe('pistol_heel'); expect(r.side).toBeNull(); });
  });

  test('25 a full pistol squat is written as `pistol`, with no depth or side invented', async ({ page }) => {
    const rows = await performVariant(page, 5, 'Pistol Squat', 'full');
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((r) => {
      expect(r.exerciseId).toBe('pistol');
      expect(Object.keys(r.attributes)).toEqual(['reps']);
      expect(r.side).toBeNull();
    });
    // So the terminal still cannot be satisfied: depth, execution and side are
    // missing and nothing here made them up.
    const v = await page.evaluate(async () => {
      const pkg = await window.CoachContext.getCurrentContextPackage();
      const ledger = await window.CoachIDB.all('ledger');
      return ['left', 'right'].map((s) =>
        window.CoachEvaluator.evaluateCriterion('pistol_terminal', s, ledger, pkg).status);
    });
    expect(v).toEqual(['unsatisfied', 'unsatisfied']);
  });

  test('26 High Pull is written as `fastpull`', async ({ page }) => {
    const rows = await performVariant(page, 1, 'Chest-to-Bar / High Pull', 'high_pull');
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((r) => { expect(r.exerciseId).toBe('fastpull'); expect(Object.keys(r.attributes)).toEqual(['reps']); });
  });

  test('27 Chest-to-Bar is written as `c2b`, and reps alone then satisfy its stage', async ({ page }) => {
    const rows = await performVariant(page, 1, 'Chest-to-Bar / High Pull', 'chest_to_bar');
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((r) => expect(r.exerciseId).toBe('c2b'));
    // exp_c2b_3 asks for nothing but reps, so this is a TRUE newly reachable
    // criterion, not one that passed because an attribute was invented.
    const s = await page.evaluate(async () => {
      const pkg = await window.CoachContext.getCurrentContextPackage();
      const ledger = await window.CoachIDB.all('ledger');
      return window.CoachEvaluator.evaluateCriterion('exp_c2b_3', 'combined', ledger, pkg).status;
    });
    expect(s).toBe('satisfied');
  });

  for (const [variant, exerciseId] of [
    ['low_bar', 'lowtrans'], ['low_ring', 'lowring_transition'],
    ['banded_ring', 'banded_ring_transition'], ['ring', 'ring_transition']
  ]) {
    test('28 the transition drill as `' + variant + '` is written as `' + exerciseId + '`, with no catch quality invented', async ({ page }) => {
      const rows = await performVariant(page, 1, 'Muscle-Up Transition Drill', variant);
      expect(rows.length).toBeGreaterThan(0);
      rows.forEach((r) => {
        expect(r.exerciseId).toBe(exerciseId);
        expect(Object.keys(r.attributes)).toEqual(['reps']);   // no catch_quality
      });
      // No transition stage may pass on reps alone: each needs a catch quality
      // nobody has been asked for yet.
      const open = await page.evaluate(async () => {
        const pkg = await window.CoachContext.getCurrentContextPackage();
        const ledger = await window.CoachIDB.all('ledger');
        return ['trans_lowring_3', 'trans_banded_3', 'trans_full_1']
          .map((c) => window.CoachEvaluator.evaluateCriterion(c, 'combined', ledger, pkg).status);
      });
      expect(open).toEqual(['unsatisfied', 'unsatisfied', 'unsatisfied']);
    });
  }

  test('29 Parallel Bar Dips are written as `pbdip`, and legacy progress is untouched', async ({ page }) => {
    await seed(page, 1);
    // Make the legacy effect observable: low benchmark, empty node.
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore();
      const b = S.getBench(); b.dips_max = 1; S.setBench(b);
      const st = S.getState(); st.muscleup.nodes.mu_dip5 = { criteria: {} }; S.setState(st);
    });
    await page.reload();
    await rowFor(page, 'Parallel Bar Dips').locator('[data-exstart]').click();
    await runToFinishPanel(page);
    await page.locator('[data-finish],[data-finishex]').first().click();
    const rows = await settledLedger(page);
    expect(rows.length).toBe(4);
    rows.forEach((r) => { expect(r.exerciseId).toBe('pbdip'); expect(r.exerciseId).not.toBe('dip'); });
    // The authoritative legacy engine credited exactly what it always did.
    const legacy = await page.evaluate(() => {
      const S = window.CoachStore.makeStore();
      return { dips: S.getBench().dips_max, node: S.getState().muscleup.nodes.mu_dip5.criteria };
    });
    expect(legacy.dips).toBe(6);
    expect(Object.values(legacy.node)).toContain(6);
    // And the truthful identity means a parallel-bar set no longer satisfies the
    // straight-bar stage. That is the correct outcome, not a regression.
    const s = await page.evaluate(async () => {
      const pkg = await window.CoachContext.getCurrentContextPackage();
      const ledger = await window.CoachIDB.all('ledger');
      return window.CoachEvaluator.evaluateCriterion('dip_bar_5', 'combined', ledger, pkg).status;
    });
    expect(s).toBe('unsatisfied');
  });

  test('30 choosing chest-to-bar still credits the legacy node it always credited', async ({ page }) => {
    await seed(page, 1);
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore(); const st = S.getState();
      st.muscleup.nodes.mu_fastpull = { criteria: {} }; st.muscleup.nodes.mu_c2b = { criteria: {} }; S.setState(st);
    });
    await page.reload();
    await rowFor(page, 'Chest-to-Bar / High Pull').locator('[data-exstart]').click();
    await page.locator('[data-vpick="chest_to_bar"]').click();
    await runToFinishPanel(page);
    await page.locator('[data-finish],[data-finishex]').first().click();
    await settledLedger(page);
    const nodes = await page.evaluate(() => window.CoachStore.makeStore().getState().muscleup.nodes);
    // Legacy keeps reading the runner's own id (`fastpull`), so its behaviour is
    // identical to before: mu_fastpull credited, mu_c2b untouched.
    expect(Object.keys(nodes.mu_fastpull.criteria).length).toBeGreaterThan(0);
    expect(Object.keys(nodes.mu_c2b.criteria).length).toBe(0);
  });
});

test.describe('E1 identity — the remembered choice', () => {
  test('31 a remembered choice is shown before starting, reused, and changeable', async ({ page }) => {
    await seed(page, 5);
    await rowFor(page, 'Pistol Squat').locator('[data-exstart]').click();
    await page.locator('[data-vpick="box"]').click();
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Box Pistol Squat');
    page.on('dialog', (d) => d.accept());
    await page.locator('[data-cancel]').click();

    // Remembered per plan item, as the variant's own id (not an exercise id).
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_profile')).variants))
      .toEqual({ pistol: 'box' });

    // A fresh item the next time: the row says which one, and offers to change.
    await page.evaluate(() => localStorage.removeItem('spc_c_day'));
    await page.evaluate(() => localStorage.removeItem('spc_c_workout'));
    await page.reload();
    await expect(rowFor(page, 'Pistol Squat')).toContainText('Box pistol');
    await expect(rowFor(page, 'Pistol Squat').locator('[data-exvariant]')).toHaveText('change');
    // Starting from that row reuses it without asking again.
    await rowFor(page, 'Pistol Squat').locator('[data-exstart]').click();
    await expect(page.locator('.sheet')).toHaveCount(0);
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Box Pistol Squat');
  });

  test('32 switching the choice changes what is recorded, and never rewrites what was', async ({ page }) => {
    await seed(page, 5);
    await rowFor(page, 'Pistol Squat').locator('[data-exstart]').click();
    await page.locator('[data-vpick="box"]').click();
    await runToFinishPanel(page);
    await page.locator('[data-finish],[data-finishex]').first().click();
    const first = await settledLedger(page);
    const firstJson = JSON.stringify(first);
    first.forEach((r) => expect(r.exerciseId).toBe('box_pistol'));

    // A second attempt, as a different variant, through Redo.
    page.on('dialog', (d) => d.accept());
    await page.evaluate(() => window.CoachApp._goto('today'));
    await expect(rowFor(page, 'Pistol Squat').locator('[data-exredo]')).toBeVisible({ timeout: 15000 });
    await rowFor(page, 'Pistol Squat').locator('[data-exredo]').click();
    // Redo always asks, because the finished row no longer shows which it was.
    await expect(page.locator('.sheet h2')).toContainText('Which pistol squat');
    await expect(page.locator('[data-vpick="box"]')).toContainText('last time');
    await page.locator('[data-vpick="heel"]').click();
    await runToFinishPanel(page);
    await page.locator('[data-finish],[data-finishex]').first().click();
    let all = [];
    for (let i = 0; i < 100; i++) {
      all = await page.evaluate(() => window.CoachIDB.all('ledger'));
      if (all.length > first.length) { await page.waitForTimeout(250); all = await page.evaluate(() => window.CoachIDB.all('ledger')); break; }
      await page.waitForTimeout(60);
    }
    const added = all.slice(first.length);
    expect(added.length).toBeGreaterThan(0);
    added.forEach((r) => expect(r.exerciseId).toBe('pistol_heel'));
    // The earlier rows are byte-for-byte what they were.
    expect(JSON.stringify(all.slice(0, first.length))).toBe(firstJson);
  });

  test('33 cancelling the question on a redo leaves the finished result exactly as it was', async ({ page }) => {
    await seed(page, 5);
    await rowFor(page, 'Pistol Squat').locator('[data-exstart]').click();
    await page.locator('[data-vpick="full"]').click();
    await runToFinishPanel(page);
    await page.locator('[data-finish],[data-finishex]').first().click();
    await settledLedger(page);
    const before = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('spc_c_day'))
      .exercises.find((e) => e.exId === 'pistol')));
    page.on('dialog', (d) => d.accept());
    await page.evaluate(() => window.CoachApp._goto('today'));
    await rowFor(page, 'Pistol Squat').locator('[data-exredo]').click();
    await expect(page.locator('.sheet h2')).toBeVisible();
    await page.locator('.sheet [data-close]').click();
    const after = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('spc_c_day'))
      .exercises.find((e) => e.exId === 'pistol')));
    expect(after).toBe(before);
  });

  test('34 a start that did not show the remembered choice asks again', async ({ page }) => {
    await seed(page, 6);   // Saturday: nothing planned, so no overlap question
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore(); const p = S.getProfile();
      p.variants = { pistol: 'box' }; S.setProfile(p);
    });
    await page.reload();
    await page.locator('[data-startone]').click();
    await page.locator('[data-pick="pistol"]').click();
    // The picker never displayed "Box pistol", so it must not be assumed.
    await expect(page.locator('.sheet h2')).toContainText('Which pistol squat');
    await expect(page.locator('[data-vpick="box"]')).toContainText('last time');
    await page.locator('[data-vpick="full"]').click();
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Pistol Squat');
    await expect(page.locator('.wk-block-wrap').first()).not.toContainText('Box');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_workout')).data.blocks[0].evidenceExId))
      .toBe('pistol');
  });

  test('35 a remembered choice that is no longer on offer is no choice at all', async ({ page }) => {
    await seed(page, 5);
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore(); const p = S.getProfile();
      p.variants = { pistol: 'a_variant_that_was_removed', highpull: 'high_pull' }; S.setProfile(p);
    });
    await page.reload();
    await expect(rowFor(page, 'Pistol Squat').locator('[data-exvariant]')).toHaveText('Which one?');
    await rowFor(page, 'Pistol Squat').locator('[data-exstart]').click();
    await expect(page.locator('.sheet h2')).toContainText('Which pistol squat');
  });

  test('36 a workout keeps the identity it started with, whatever is remembered later', async ({ page }) => {
    await seed(page, 5);
    await rowFor(page, 'Pistol Squat').locator('[data-exstart]').click();
    await page.locator('[data-vpick="box"]').click();
    // Change what is remembered while the workout is in flight, then reload.
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore(); const p = S.getProfile();
      p.variants = { pistol: 'full' }; S.setProfile(p);
    });
    await page.reload();
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Box Pistol Squat');
    await runToFinishPanel(page);
    await page.locator('[data-finish],[data-finishex]').first().click();
    const rows = await settledLedger(page);
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((r) => expect(r.exerciseId).toBe('box_pistol'));
  });
});


// ── E1.1: the cue and the tap target ──────────────────────────────────────
//
// E1 made the runner's TITLE follow the selected exercise, but the cue under it
// still came from the legacy library keyed on the runner's own id, which several
// movements share. A chest-to-bar showed the high-pull cue and a ring transition
// showed a cue about getting the wrists over a BAR. A cue for a different
// movement undermines the identity E1 exists to guarantee.
//
// The bundle's exercises carry no cue text. The only authored cues are the
// legacy library's, keyed by exercise id, so the rule is: show the library cue
// for the SELECTED exercise if it has one, otherwise show none.
const cueOf = (id) => (Data.exercises[id] || {}).cues || null;
const CUE_CASES = [
  // day, plan item, variant, the exercise it is, and whether an approved cue exists
  [1, 'Chest-to-Bar / High Pull', 'high_pull', 'fastpull', true],
  [1, 'Chest-to-Bar / High Pull', 'chest_to_bar', 'c2b', true],
  [1, 'Muscle-Up Transition Drill', 'low_bar', 'lowtrans', true],
  [1, 'Muscle-Up Transition Drill', 'low_ring', 'lowring_transition', false],
  [1, 'Muscle-Up Transition Drill', 'banded_ring', 'banded_ring_transition', false],
  [1, 'Muscle-Up Transition Drill', 'ring', 'ring_transition', false],
  [5, 'Pistol Squat', 'box', 'box_pistol', false],
  [5, 'Pistol Squat', 'heel', 'pistol_heel', false],
  [5, 'Pistol Squat', 'full', 'pistol', false]
];

test.describe('E1.1 cue — what the runner says matches what was selected', () => {
  test('42 the cases that show no cue really have no approved cue of their own', () => {
    // Stated, not assumed: if the library ever gains an entry for one of these,
    // this fails and someone must decide whether that text is right for it.
    CUE_CASES.forEach(([, , variant, id, has]) => {
      expect(cueOf(id) !== null, variant + ' (' + id + ')').toBe(has);
    });
  });

  test('43 no variant can inherit another movement\'s cue through a shared runner', () => {
    // High pull and chest-to-bar are different movements with different cues.
    expect(cueOf('fastpull')).not.toBe(cueOf('c2b'));
    // None of the three ring transitions may carry the low-BAR drill's cue.
    ['lowring_transition', 'banded_ring_transition', 'ring_transition'].forEach((id) => {
      expect(cueOf(id), id).not.toBe(cueOf('lowtrans'));
      expect(cueOf(id), id).toBeNull();
    });
    // A supporting pistol variant never borrows from anything.
    ['box_pistol', 'pistol_heel', 'pistol'].forEach((id) => expect(cueOf(id), id).toBeNull());
  });

  for (const [day, item, variant, id, has] of CUE_CASES) {
    test('44 ' + variant + ': the runner shows the title and cue of `' + id + '` and nothing else', async ({ page }) => {
      await seed(page, day);
      await rowFor(page, item).locator('[data-exstart]').click();
      await page.locator('[data-vpick="' + variant + '"]').click();
      const block = page.locator('.wk-block-wrap').first();
      await expect(block).toBeVisible({ timeout: 15000 });
      // Title: the bundle's own name for the selected exercise.
      await expect(block.locator('.section').first())
        .toContainText(EXERCISES[id].name.toUpperCase().slice(0, 12), { ignoreCase: true });
      // Cue: that exercise's own, or none.
      if (has) await expect(block.locator('.wk-cues')).toHaveText(cueOf(id));
      else await expect(block.locator('.wk-cues')).toHaveCount(0);
      // And nothing about the identity E1 wrote has moved.
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_workout')).data.blocks[0].evidenceExId))
        .toBe(id);
    });
  }

  test('45 changing the variant changes the displayed identity and its cue together', async ({ page }) => {
    await seed(page, 1);
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore(); const p = S.getProfile();
      p.variants = { highpull: 'high_pull' }; S.setProfile(p);
    });
    await page.reload();
    const row = rowFor(page, 'Chest-to-Bar / High Pull');
    await expect(row).toContainText('High pull');
    await row.locator('[data-exstart]').click();
    const first = page.locator('.wk-block-wrap').first();
    await expect(first.locator('.section').first()).toContainText('High Pull', { ignoreCase: true });
    await expect(first.locator('.wk-cues')).toHaveText(cueOf('fastpull'));
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_workout')).data.blocks[0].evidenceExId)).toBe('fastpull');

    // Start over with the other variant, chosen through the row's own link.
    await page.evaluate(() => { localStorage.removeItem('spc_c_day'); localStorage.removeItem('spc_c_workout'); });
    await page.reload();
    await row.locator('[data-exvariant]').click();
    await page.locator('[data-vpick="chest_to_bar"]').click();
    await expect(row).toContainText('Chest-to-bar');
    await row.locator('[data-exstart]').click();
    const second = page.locator('.wk-block-wrap').first();
    await expect(second.locator('.section').first()).toContainText('Chest-to-Bar', { ignoreCase: true });
    await expect(second.locator('.wk-cues')).toHaveText(cueOf('c2b'));
    // The two sets of text can never be mixed.
    await expect(second).not.toContainText(cueOf('fastpull'));
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_workout')).data.blocks[0].evidenceExId)).toBe('c2b');
  });

  test('46 Parallel Bar Dips show the parallel-bar cue, not the straight-bar one', async ({ page }) => {
    await seed(page, 1);
    await rowFor(page, 'Parallel Bar Dips').locator('[data-exstart]').click();
    const block = page.locator('.wk-block-wrap').first();
    await expect(block.locator('.wk-cues')).toHaveText(cueOf('pbdip'));
    expect(cueOf('pbdip')).not.toBe(cueOf('dip'));
  });

  test('47 an exercise whose identity is unchanged still shows the cue it always did', async ({ page }) => {
    await seed(page, 2);   // Tuesday: Pull-Up Pyramid, Top Hold, Toes-to-Bar, Ring Support
    await rowFor(page, 'Pull-Up Pyramid').locator('[data-exstart]').click();
    await expect(page.locator('.wk-block-wrap').first().locator('.wk-cues')).toHaveText(cueOf('pullup'));
  });
});

test.describe('E1.1 tap target — the variant link is comfortable to hit', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  async function geometry(page) {
    // Today fades in over 0.18s with a few pixels of travel. Measure the settled
    // layout, not a frame of the animation.
    await page.waitForSelector('[data-exvariant]');
    await page.waitForTimeout(500);
    return page.evaluate(() => {
      const link = document.querySelector('[data-exvariant]');
      const row = link.closest('.q-ex');
      const start = row.querySelector('[data-exstart]');
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom, top: b.top }; };
      return { link: r(link), start: start ? r(start) : null,
        font: parseFloat(getComputedStyle(link).fontSize) };
    });
  }

  test('48 "Which one?" is at least 44px tall and wide, with its text still light', async ({ page }) => {
    await seed(page, 5);
    const g = await geometry(page);
    expect(g.link.h).toBeGreaterThanOrEqual(44);
    expect(g.link.w).toBeGreaterThanOrEqual(44);
    expect(g.font).toBeLessThanOrEqual(15);   // the text did not grow to get there
    // The box is real, so it cannot overlap the Start button just below it.
    expect(g.link.bottom).toBeLessThanOrEqual(g.start.top + 0.5);
  });

  test('49 "change" meets the same rule once a variant is remembered', async ({ page }) => {
    await seed(page, 5);
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore(); const p = S.getProfile();
      p.variants = { pistol: 'box' }; S.setProfile(p);
    });
    await page.reload();
    await expect(rowFor(page, 'Pistol Squat')).toContainText('Box pistol');
    const g = await geometry(page);
    expect(g.link.h).toBeGreaterThanOrEqual(44);
    expect(g.link.w).toBeGreaterThanOrEqual(44);
    expect(g.link.bottom).toBeLessThanOrEqual(g.start.top + 0.5);
  });

  test('50 taps near the top and bottom edges of the box really open the question', async ({ page }) => {
    await seed(page, 5);
    const g = await geometry(page);
    for (const dy of [3, g.link.h - 3]) {
      await page.mouse.click(g.link.x + 6, g.link.y + dy);
      await expect(page.locator('.sheet h2')).toContainText('Which pistol squat');
      await page.locator('.sheet [data-close]').click();
      await expect(page.locator('.sheet')).toHaveCount(0);
    }
  });

  test('51 the Start button still starts, and is not shadowed by the link above it', async ({ page }) => {
    await seed(page, 5);
    const g = await geometry(page);
    // Tap the very top edge of Start: it must be Start that receives it.
    await page.mouse.click(g.start.x + g.start.w / 2, g.start.top + 2);
    await expect(page.locator('.sheet h2')).toContainText('Which pistol squat');   // Start asks, as designed
    await expect(page.locator('[data-vpick]')).toHaveCount(3);
  });
});

test.describe('E1 identity — storage', () => {
  test('41 the remembered choice lives only in the profile, so Backup, Restore and Reset already cover it', async ({ page }) => {
    await seed(page, 5);
    const keysBefore = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.indexOf('spc_') === 0).sort());
    await rowFor(page, 'Pistol Squat').locator('[data-exstart]').click();
    await page.locator('[data-vpick="heel"]').click();
    await expect(page.locator('.wk-block-wrap').first()).toContainText('Heel-Elevated Pistol Squat');
    const keysAfter = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.indexOf('spc_') === 0).sort());
    // Only the keys a workout in progress always creates; nothing new for the choice.
    const added = keysAfter.filter((k) => keysBefore.indexOf(k) < 0);
    added.forEach((k) => expect(['spc_c_workout', 'spc_c_day'], k).toContain(k));
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_profile')).variants)).toEqual({ pistol: 'heel' });
    // Backup's protected key list already names the profile, so the choice rides along.
    const backup = require('fs').readFileSync(path.join(REPO, 'backup.js'), 'utf8');
    expect(backup).toContain("'spc_c_profile'");
    // And Reset (every Store key) clears it with the profile.
    await page.evaluate(() => window.CoachStore.makeStore().reset());
    expect(await page.evaluate(() => localStorage.getItem('spc_c_profile'))).toBeNull();
  });
});

test.describe('E1 identity — the ledger is never rewritten, and never guessed into', () => {
  test('37 existing Evidence is untouched by any of this', async ({ page }) => {
    await seed(page, 5);
    // A row written the way the app wrote it before E1, including the false id.
    const historical = await page.evaluate(async () => {
      await window.CoachIDB.init(); await window.CoachContext.init();
      const row = { kind: 'PerformanceObservation', occurredAt: '2026-10-01T09:00:00.000Z',
        recordedAt: '2026-10-01T09:00:00.000Z', exerciseId: 'dip', side: null, attributes: { reps: 6 },
        provenance: 'demonstrated', provenanceSource: 'in_session',
        sourceWorkoutItem: { workoutId: 'w_before_e1', itemIndex: 0 }, sequenceInItem: 1,
        dedupeKey: 'w_before_e1:0:s:0',
        context: { readiness: {}, accommodationInForce: null, unmetDependencies: [], prescribedDose: null, contextId: 'ctx_1' } };
      await window.CoachIDB.appendUnique('ledger', row);
      return JSON.stringify((await window.CoachIDB.all('ledger'))[0]);
    });
    await rowFor(page, 'Pistol Squat').locator('[data-exstart]').click();
    await page.locator('[data-vpick="heel"]').click();
    await runToFinishPanel(page);
    await page.locator('[data-finish],[data-finishex]').first().click();
    let all = [];
    for (let i = 0; i < 100; i++) {
      all = await page.evaluate(() => window.CoachIDB.all('ledger'));
      if (all.length > 1) { await page.waitForTimeout(250); all = await page.evaluate(() => window.CoachIDB.all('ledger')); break; }
      await page.waitForTimeout(60);
    }
    expect(all.length).toBeGreaterThan(1);
    expect(JSON.stringify(all[0])).toBe(historical);   // not edited, retyped or migrated
    expect(all[0].exerciseId).toBe('dip');              // the old false id is left exactly as written
  });

  test('38 a workout saved before identity existed: fixed items resolve, ambiguous ones write nothing', async ({ page }) => {
    await seed(page, 5);
    const r = await page.evaluate(async () => {
      await window.CoachIDB.init(); await window.CoachContext.init();
      const block = (exId) => ({ kind: 'straight', scheme: 'sets', exId, label: 'x', restSecs: 90,
        sets: [{ target: 5, actual: 5, unit: 'reps', doneFlag: true }] });
      // As persisted by the app before E1: no evidenceExId on the block.
      await window.CoachApp._evidence.tapWorkout({ workoutId: 'w_old_dips', dailyExId: 'pbdips', blocks: [block('dip')] });
      await window.CoachApp._evidence.tapWorkout({ workoutId: 'w_old_pistol', dailyExId: 'pistol', blocks: [block('pistol')] });
      return { rows: await window.CoachIDB.all('ledger'), status: window.CoachApp._evidence.status() };
    });
    // Parallel Bar Dips need no choice, so they are rightly `pbdip` even from an old snapshot.
    expect(r.rows.map((x) => x.exerciseId)).toEqual(['pbdip']);
    // The pistol needed a choice nobody made, so it writes nothing, and says so.
    expect(r.status.failed).toBe(1);
    expect(r.status.lastError).toMatch(/no exercise identity was recorded/);
  });

  test('39 a legacy template workout has no plan item, so its block is recorded as it is', async ({ page }) => {
    await seed(page, 5);
    const r = await page.evaluate(async () => {
      await window.CoachIDB.init(); await window.CoachContext.init();
      await window.CoachApp._evidence.tapWorkout({ workoutId: 'w_template', blocks: [
        { kind: 'straight', scheme: 'sets', exId: 'dip', restSecs: 90,
          sets: [{ target: 5, actual: 5, unit: 'reps', doneFlag: true }] }] });
      return window.CoachIDB.all('ledger');
    });
    // Straight-bar dips, run from the template that really is straight-bar dips.
    expect(r.map((x) => x.exerciseId)).toEqual(['dip']);
  });

  test('40 evidence.js itself was not touched: it still reads only the block it is handed', async () => {
    const src = require('fs').readFileSync(path.join(REPO, 'evidence.js'), 'utf8');
    expect(src).toContain('var exerciseId = block.exId;');
    // Identity is resolved in the app and handed over on the snapshot copy; the
    // pure module knows nothing of plan items, choices or the stamped field.
    ['evidenceExId', 'variantId', 'dailyExId', 'CoachWeek'].forEach((w) => expect(src, w).not.toContain(w));
  });
});
