// Skill Progression Coach — P6b shadow evaluation.
//
// The shadow layer runs the new evaluator over the real Evidence ledger and
// compares what it concludes with what the legacy product believes. These tests
// cover the whole pipeline — real P3 row shapes in, classified comparisons out —
// and, just as importantly, they pin the authority boundary: the shadow layer
// may read legacy state, and nothing in the product may read shadow state back.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const REPO = path.resolve(__dirname, '..');
const E = require(path.join(REPO, 'evaluator.js'));
const S = require(path.join(REPO, 'shadow.js'));
const Engine = require(path.join(REPO, 'engine.js'));
const Data = require(path.join(REPO, 'data.js'));
const V = require(path.join(REPO, 'tools', 'validate-content.cjs'));

const CONTENT = V.loadContentDir(path.join(REPO, 'content'));
const BUNDLE = CONTENT.bundles[0];
const SEMANTICS = CONTENT.semantics[0];

const PKG = {
  contextId: 'ctx_1',
  manifest: { id: 'ctx_1', contentBundleVersion: BUNDLE.version,
    evaluationSemanticsVersion: SEMANTICS.version },
  contentBundle: BUNDLE,
  evaluationSemantics: SEMANTICS,
  vocabularyVersionAtWrite: CONTENT.vocabulary.vocabularyVersion,
  writtenAt: '2026-09-24T00:00:00.000Z'
};

// The legacy world the Ring Muscle-Up content is compared against.
const WORLD = Data.worlds.find((w) => w.id === 'muscleup');
const NODES = {};
WORLD.nodes.forEach((n) => { NODES[n.id] = n; });
const legacyWith = (states) => ({ nodes: NODES, states: states || {}, isComplete: Engine.isComplete });

// A row in exactly the shape P3's evidence tap appends, plus the `seq` that
// IndexedDB assigns on append. Nothing here is a convenience shape.
let SEQ = 0;
function obs(exerciseId, attributes, opts) {
  opts = opts || {};
  return {
    seq: opts.seq === undefined ? ++SEQ : opts.seq,
    kind: 'PerformanceObservation',
    occurredAt: opts.occurredAt === undefined ? '2026-09-01T10:00:00.000Z' : opts.occurredAt,
    recordedAt: '2026-09-01T10:05:00.000Z',
    exerciseId,
    side: opts.side === undefined ? null : opts.side,
    attributes,
    provenance: opts.provenance || 'demonstrated',
    provenanceSource: opts.provenanceSource || 'in_session',
    sourceWorkoutItem: { workoutId: 'w_test', itemIndex: 0 },
    sequenceInItem: 1,
    dedupeKey: 'w_test:0:s:' + (opts.seq === undefined ? SEQ : opts.seq),
    context: {
      readiness: {}, accommodationInForce: null,
      unmetDependencies: opts.unmet || [],
      prescribedDose: { scheme: 'sets', sets: 3 }, contextId: 'ctx_1'
    }
  };
}
const snap = (ledger, states) =>
  S.snapshot({ evaluator: E, pkg: PKG, ledger: ledger || [], legacy: legacyWith(states) });
const cmp = (s, holderKey, side) =>
  s.comparisons.find((c) => c.holderKey === holderKey && c.side === (side || 'combined'));
const holder = (s, holderKey, side) =>
  s.holders.find((h) => h.holderKey === holderKey && h.side === (side || 'combined'));

// ── the pipeline, end to end ──────────────────────────────────────────────
test.describe('P6b shadow — the pipeline over real content', () => {
  test('01 no Evidence: every strong mapping reports insufficient, never a difference', () => {
    const s = snap([], {});
    const strong = s.comparisons.filter((c) => c.mappingStrength === 'strong');
    expect(strong.length).toBeGreaterThan(0);
    strong.forEach((c) => {
      expect(c.classification, c.holderKey).toBe(S.CLASS.INSUFFICIENT);
      expect(c.reason, c.holderKey).toBe(S.REASON.MISSING_EVIDENCE);
    });
    // Nothing was invented about the athlete.
    expect(s.comparisons.every((c) => c.shadowSatisfied === false)).toBe(true);
  });

  test('02 one valid demonstrated observation satisfies the holder it assesses', () => {
    const s = snap([obs('pullup', { reps: 5, kip: false })], {});
    expect(holder(s, 'stage:rmu_pull_s1').requirementStatus).toBe(E.STATUS.SATISFIED);
    expect(holder(s, 'stage:rmu_pull_s2').requirementStatus).toBe(E.STATUS.SATISFIED);
    expect(holder(s, 'stage:rmu_pull_s3').requirementStatus).toBe(E.STATUS.UNSATISFIED);
    // and the row that did it is named
    expect(holder(s, 'stage:rmu_pull_s2').evidenceUsed.length).toBe(1);
  });

  test('03 claimed-only evidence is provisional, and the difference says so', () => {
    const s = snap([obs('pullup', { reps: 5, kip: false }, { provenance: 'claimed' })],
      { mu_pull1: { criteria: { reps: 5 } }, mu_pull5: { criteria: { reps: 5 } } });
    expect(holder(s, 'stage:rmu_pull_s2').requirementStatus).toBe(E.STATUS.PROVISIONAL);
    const c = cmp(s, 'stage:rmu_pull_s2');
    expect(c.classification).toBe(S.CLASS.DIFFERENCE);
    expect(c.reason).toBe(S.REASON.CLAIMED);
  });

  test('04 progression-invalid evidence: the mechanism exists, bundle 1 never triggers it', () => {
    // Bundle 1 authors no dependency that constrains evidence_validity, so no
    // real row in this content can be excluded for dependency invalidity. That
    // is a finding, not a gap in the test: the shadow report must not imply a
    // class of difference the approved content cannot actually produce.
    const validity = BUNDLE.dependencies.filter((d) => (d.constrains || []).indexOf('evidence_validity') >= 0);
    expect(validity).toEqual([]);

    // And a row carrying an unmet dependency that only constrains prescription
    // is therefore still admitted — the flag alone must not invalidate it.
    const presOnly = BUNDLE.dependencies.find((d) =>
      (d.constrains || []).indexOf('prescription') >= 0 &&
      (d.constrains || []).indexOf('evidence_validity') < 0);
    expect(presOnly).toBeTruthy();
    const flagged = obs('fg_hang', { seconds: 35 }, { unmet: [presOnly.id] });
    const s = snap([flagged], {});
    expect(holder(s, 'progression:rmu_false_grip').requirementStatus).toBe(E.STATUS.SATISFIED);
    expect(holder(s, 'progression:rmu_false_grip').evidenceUsed).toEqual([flagged.seq]);
  });

  test('05 an unmet unlocking dependency blocks establishment, not the requirement', () => {
    const dep = BUNDLE.dependencies.find((d) => (d.constrains || []).indexOf('unlocking') >= 0);
    expect(dep, 'bundle 1 authors an unlocking dependency').toBeTruthy();
    const subject = dep.subject;
    const key = 'stage:' + subject.stageId;
    const link = BUNDLE.exerciseLinks.find((l) => l.relation === 'assess' &&
      l.target.stageId === subject.stageId);
    const stage = BUNDLE.progressions.find((p) => p.id === subject.progressionId)
      .stages.find((st) => st.id === subject.stageId);
    const crit = BUNDLE.criteria.find((c) => c.id === E.leafCriteria(stage.requirement, [])[0]);
    const attrs = {};
    (crit.conditions || []).forEach((cd) => { attrs[cd.attribute] = cd.value; });
    const s = snap([obs(link.exerciseId, attrs)], {});
    const h = holder(s, key);
    expect(h.requirementStatus).toBe(E.STATUS.SATISFIED);
    expect(h.established).toBe(false);
    expect(h.unmetDependencies.length).toBeGreaterThan(0);
  });

  test('06 a satisfied dependency leaves establishment unblocked', () => {
    // Nothing is asked of a holder that has no dependency at all: it establishes
    // on its own requirement, which is the control case for test 05.
    const s = snap([obs('pullup', { reps: 10, kip: false })], {});
    const h = holder(s, 'stage:rmu_pull_s3');
    expect(h.requirementStatus).toBe(E.STATUS.SATISFIED);
    expect(h.unmetDependencies).toEqual([]);
    expect(h.established).toBe(true);
  });

  test('07 left/right asymmetry is carried per side', () => {
    const s = snap([
      obs('box_pistol', { reps: 5, depth: 'parallel' }, { side: 'left' })
    ], {});
    const L = holder(s, 'stage:pistol_str_s1', 'left');
    const R = holder(s, 'stage:pistol_str_s1', 'right');
    expect(L.requirementStatus).toBe(E.STATUS.SATISFIED);
    expect(R.requirementStatus).toBe(E.STATUS.UNSATISFIED);
    expect(L.side).toBe('left');
    expect(R.side).toBe('right');
  });

  test('08 a ladderless (DIRECT) progression is evaluated, and has no current stage', () => {
    const s = snap([obs('fg_hang', { seconds: 35 })], {});
    const h = holder(s, 'progression:rmu_false_grip');
    expect(h.kind).toBe('progression');
    expect(h.requirementStatus).toBe(E.STATUS.SATISFIED);
    expect(h.currentStage).toBeNull();
  });

  test('09 a staged progression reports its current stage', () => {
    const s = snap([obs('pullup', { reps: 5, kip: false })], {});
    expect(holder(s, 'stage:rmu_pull_s1').currentStage).toBe('rmu_pull_s3');
  });

  test('10 the Goal terminal requirement is evaluated as its own holder', () => {
    const empty = snap([], {});
    expect(holder(empty, 'goalTerminal:ring_muscle_up').requirementStatus).toBe(E.STATUS.UNSATISFIED);
    const done = snap([obs('rmu_attempt', { reps: 1, kip: false, execution: 'controlled' })], {});
    expect(holder(done, 'goalTerminal:ring_muscle_up').requirementStatus).toBe(E.STATUS.SATISFIED);
  });

  test('11 real P3 Evidence is read, but a kip-gated criterion cannot be satisfied by it', () => {
    // THE HEADLINE P6b FINDING. The row below is built by evidence.js from a
    // runner snapshot — the exact shape the tap appends. The runner measures
    // reps and seconds and nothing else, so the row carries {reps: 5} and no
    // `kip`. Every pull-up criterion in bundle 1 also requires kip === false,
    // so a real observation is admitted, read, and then excluded as
    // missing_attribute(kip). The whole rmu_pull_strength progression — the one
    // with the only strong legacy mappings — is therefore unreachable from real
    // evidence until either the runner records kip or the content stops
    // requiring it. P6b exists to surface exactly this before P7.
    const Evidence = require(path.join(REPO, 'evidence.js'));
    const rows = Evidence.fromWorkout({
      workoutId: 'w_shadow', blocks: [{
        kind: 'straight', scheme: 'sets', exId: 'pullup', restSecs: 90,
        sets: [{ target: 5, actual: 5, unit: 'reps', doneFlag: true }]
      }]
    }, { contextId: 'ctx_1', bundle: BUNDLE, unmetDependencies: [], now: '2026-09-01T10:00:00.000Z' });
    expect(rows.length).toBe(1);
    expect(rows[0].attributes).toEqual({ reps: 5 });

    // IndexedDB assigns seq on append; everything else is the tap's own shape.
    const withSeq = rows.map((r, i) => Object.assign({}, r, { seq: i + 1 }));
    const s = snap(withSeq, {});

    // The pipeline accepted the row: it was read, not rejected as malformed.
    expect(s.ledgerRows).toBe(1);
    expect(s.ledgerMaxSeq).toBe(1);
    // But it cannot satisfy the criterion, and the reason is recorded exactly.
    const h = holder(s, 'stage:rmu_pull_s2');
    expect(h.requirementStatus).toBe(E.STATUS.UNSATISFIED);
    expect(h.evidenceUsed).toEqual([]);
    const excluded = h.criteria.rmu_pull_5.excluded;
    expect(excluded).toEqual([{ seq: 1, reason: 'missing_attribute(kip)' }]);
    // And the comparison names it as missing evidence rather than guessing.
    expect(cmp(s, 'stage:rmu_pull_s2').reason).toBe(S.REASON.MISSING_EVIDENCE);
  });

  test('11b the attributes the runner never measures are listed, not discovered later', () => {
    // Which criteria are reachable from real P3 evidence at all. The tap records
    // reps and seconds; every other attribute a criterion asks for is absent
    // from every real row, so those criteria can only ever report
    // missing_attribute until something changes.
    const MEASURED = ['reps', 'seconds'];
    const unreachable = BUNDLE.criteria.filter((c) =>
      (c.conditions || []).some((cd) => MEASURED.indexOf(cd.attribute) < 0))
      .map((c) => c.id).sort();
    // Pinned deliberately: if this list changes, the migration's readiness
    // changed with it and the report must be re-read.
    expect(unreachable).toEqual([
      'ankle_12', 'ankle_9', 'deepsquat_30', 'pistol_terminal', 'rmu_pull_1',
      'rmu_pull_10', 'rmu_pull_5', 'rmu_terminal', 'slstr_box_5', 'slstr_heel_3',
      'trans_banded_3', 'trans_full_1', 'trans_lowring_3'
    ]);
    // And the ones that ARE reachable, which is where soak data will come from.
    const reachable = BUNDLE.criteria.filter((c) =>
      (c.conditions || []).every((cd) => MEASURED.indexOf(cd.attribute) >= 0))
      .map((c) => c.id).sort();
    expect(reachable).toEqual([
      'dip_bar_5', 'dip_ring_5', 'exp_c2b_3', 'exp_c2r_3', 'exp_highpull_3',
      'fg_hang_30', 'sup_ring_20', 'sup_rto_20'
    ]);
  });

  test('12 duplicate Evidence does not move the result', () => {
    const one = obs('pullup', { reps: 5, kip: false }, { seq: 1 });
    const again = Object.assign({}, one, { seq: 2 });
    const a = snap([one], {});
    const b = snap([one, again], {});
    expect(b.holders.map((h) => h.requirementStatus)).toEqual(a.holders.map((h) => h.requirementStatus));
    expect(b.comparisons.map((c) => c.classification)).toEqual(a.comparisons.map((c) => c.classification));
  });

  test('13 the snapshot records the context and content it was computed under', () => {
    const s = snap([obs('pullup', { reps: 1, kip: false }, { seq: 7 })], {});
    expect(s.contextId).toBe('ctx_1');
    expect(s.contentBundleVersion).toBe(BUNDLE.version);
    expect(s.semanticsVersion).toBe(SEMANTICS.version);
    expect(s.ledgerRows).toBe(1);
    expect(s.ledgerMaxSeq).toBe(7);
    expect(s.shadowVersion).toBe(1);
  });
});

// ── mapping discipline ────────────────────────────────────────────────────
test.describe('P6b shadow — mappings are authored, not inferred', () => {
  test('14 a strong mapping that agrees reports a match', () => {
    const s = snap([obs('pullup', { reps: 5, kip: false })],
      { mu_pull1: { criteria: { reps: 5 } }, mu_pull5: { criteria: { reps: 5 } } });
    expect(cmp(s, 'stage:rmu_pull_s1').classification).toBe(S.CLASS.MATCH);
    expect(cmp(s, 'stage:rmu_pull_s2').classification).toBe(S.CLASS.MATCH);
    expect(cmp(s, 'stage:rmu_pull_s2').reason).toBeNull();
  });

  test('15 a strong mapping that disagrees reports a difference', () => {
    // The athlete demonstrated three explosive pull-ups. The new bar is 3; the
    // legacy node's bar is 5. Same exercise, same attribute, different bar.
    const s = snap([obs('fastpull', { reps: 3 })], { mu_fastpull: { criteria: { reps: 3 } } });
    const c = cmp(s, 'stage:rmu_exp_s1');
    expect(c.classification).toBe(S.CLASS.DIFFERENCE);
    expect(c.shadowSatisfied).toBe(true);
    expect(c.legacyComplete).toBe(false);
    expect(c.reason).toBe(S.REASON.THRESHOLD);
  });

  test('16 a weak mapping never produces a comparable verdict', () => {
    // A 35-second false-grip hang satisfies the new progression; the legacy
    // dead-hang node is complete too. Agreement here would be a coincidence of
    // the mapping, not of the models, so it is reported as not comparable.
    const s = snap([obs('fg_hang', { seconds: 35 })], { mu_deadhang: { criteria: { hold: 30 } } });
    const c = cmp(s, 'progression:rmu_false_grip');
    expect(c.mappingStrength).toBe('weak');
    expect(c.classification).toBe(S.CLASS.NOT_COMPARABLE);
    expect(c.reason).toBeNull();
    expect(c.shadowSatisfied).toBe(true);
    expect(c.legacyComplete).toBe(true);
    // It still carries the rationale, because that is the point of printing it.
    expect(c.rationale).toMatch(/false grip/i);
    // And it is never counted as a match or a difference.
    expect(s.counts[S.CLASS.MATCH]).toBe(0);
    expect(s.counts[S.CLASS.DIFFERENCE]).toBe(0);
  });

  test('17 a holder with no legacy counterpart is new_model_only', () => {
    const s = snap([], {});
    // The whole Pistol goal is new: the legacy worlds have no pistol node.
    ['stage:pistol_str_s1', 'progression:pistol_deep_squat', 'goalTerminal:pistol_squat']
      .forEach((k) => {
        const c = s.comparisons.find((x) => x.holderKey === k);
        expect(c, k).toBeTruthy();
        expect(c.classification, k).toBe(S.CLASS.NEW_ONLY);
        expect(c.legacyNodeId, k).toBeNull();
      });
    // And legacy nodes with no new counterpart are reported too, not silently dropped.
    expect(s.legacyOnly.length).toBeGreaterThan(0);
    expect(s.legacyOnly.every((r) => r.classification === S.CLASS.LEGACY_ONLY)).toBe(true);
  });

  test('18 legacy state with no Evidence behind it is named, not called a difference', () => {
    // The legacy value came from benchmark seeding. The new model was never
    // given anything to judge, so this is insufficient evidence, not disagreement.
    const s = snap([], { mu_pull1: { criteria: { reps: 10 } }, mu_pull5: { criteria: { reps: 10 } } });
    const c = cmp(s, 'stage:rmu_pull_s1');
    expect(c.classification).toBe(S.CLASS.INSUFFICIENT);
    expect(c.reason).toBe(S.REASON.LEGACY_NO_EVIDENCE);
    expect(c.legacyComplete).toBe(true);
    expect(s.counts[S.CLASS.DIFFERENCE]).toBe(0);
  });

  test('19 every mapping carries a rationale and a declared strength', () => {
    expect(S.MAPPINGS.length).toBeGreaterThan(0);
    S.MAPPINGS.forEach((m) => {
      expect(['strong', 'weak'], m.holderKey).toContain(m.strength);
      expect(m.rationale.length, m.holderKey).toBeGreaterThan(40);
      expect(NODES[m.legacyNodeId], m.legacyNodeId + ' is a real legacy node').toBeTruthy();
      // and the holder it names really exists in the bundle
      const keys = S._relevantHolders(BUNDLE).map((h) => h.holderKey);
      expect(keys, m.holderKey).toContain(m.holderKey);
    });
  });

  test('20 malformed input fails explicitly rather than returning an empty report', () => {
    expect(() => S.snapshot(null)).toThrow(/evaluator and a context package/);
    expect(() => S.snapshot({ evaluator: E })).toThrow(/evaluator and a context package/);
    expect(() => S.snapshot({ pkg: PKG })).toThrow(/evaluator and a context package/);
    expect(() => S.snapshot({ evaluator: E, pkg: { contextId: 'x' } })).toThrow();
  });
});

// ── determinism ───────────────────────────────────────────────────────────
test.describe('P6b shadow — determinism', () => {
  test('21 identical inputs give identical output, every time', () => {
    const ledger = [obs('pullup', { reps: 5, kip: false }, { seq: 1 }),
      obs('box_pistol', { reps: 5, depth: 'parallel' }, { seq: 2, side: 'left' })];
    const states = { mu_pull1: { criteria: { reps: 5 } } };
    const a = JSON.stringify(snap(ledger, states));
    for (let i = 0; i < 5; i++) expect(JSON.stringify(snap(ledger, states))).toBe(a);
  });

  test('22 ledger order does not change the result', () => {
    const r1 = obs('pullup', { reps: 5, kip: false }, { seq: 1 });
    const r2 = obs('fg_hang', { seconds: 35 }, { seq: 2 });
    const forward = snap([r1, r2], {});
    const reversed = snap([r2, r1], {});
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });

  test('23 no clock is read: the snapshot carries no timestamp', () => {
    const s = snap([obs('pullup', { reps: 1, kip: false })], {});
    const text = JSON.stringify(s);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(Object.keys(s)).not.toContain('generatedAt');
    const src = fs.readFileSync(path.join(REPO, 'shadow.js'), 'utf8');
    expect(src).not.toMatch(/Date\.now|new Date\(/);
  });

  test('24 the inputs are not mutated', () => {
    const ledger = [obs('pullup', { reps: 5, kip: false }, { seq: 1 })];
    const states = { mu_pull1: { criteria: { reps: 5 } } };
    const beforeLedger = JSON.stringify(ledger), beforeStates = JSON.stringify(states);
    const beforePkg = JSON.stringify(PKG);
    snap(ledger, states);
    expect(JSON.stringify(ledger)).toBe(beforeLedger);
    expect(JSON.stringify(states)).toBe(beforeStates);
    expect(JSON.stringify(PKG)).toBe(beforePkg);
  });
});

// ── the authority boundary ────────────────────────────────────────────────
test.describe('P6b shadow — one-way observation', () => {
  test('25 the shadow module reads nothing outside its arguments and writes nothing', () => {
    const src = fs.readFileSync(path.join(REPO, 'shadow.js'), 'utf8');
    [/localStorage/, /indexedDB/, /document\./, /window\./, /fetch\(/, /XMLHttpRequest/,
      /\.setItem\(/, /CoachIDB/, /CoachStore/, /CoachContext/]
      .forEach((re) => expect(src, String(re)).not.toMatch(re));
    // It never reaches the evaluator through a global either: the evaluator is
    // handed in, so a test can substitute one and a caller cannot smuggle one.
    // (The module names CoachEvaluator in its header comment; what matters is
    // that no executable line reads it off a global.)
    expect(src).not.toMatch(/(window|self|global|globalThis)\s*\.\s*Coach/);
    expect(src).not.toMatch(/root\.Coach(?!Shadow)/);
  });

  test('26 no authoritative module can reach the shadow layer', () => {
    // These decide what the athlete is shown and told to do. If any of them
    // could read a shadow verdict, the migration would have become a cutover.
    ['week.js', 'engine.js', 'daily.js', 'adapt.js', 'progress.js', 'store.js',
      'settings.js', 'duration.js', 'data.js', 'backup.js', 'idb.js', 'context.js',
      'evidence.js', 'goals.js']
      .forEach((f) => {
        const src = fs.readFileSync(path.join(REPO, f), 'utf8');
        expect(src, f).not.toContain('CoachShadow');
        expect(src, f).not.toContain('shadow.js');
      });
  });

  test('27 app.js consults the shadow layer only from the diagnostics panel', () => {
    const app = fs.readFileSync(path.join(REPO, 'app.js'), 'utf8');
    const uses = app.match(/CoachShadow/g) || [];
    // One read in the diagnostic, one tiny accessor for the class names.
    expect(uses.length).toBe(2);
    expect(app).toContain('function shadowStatusLine');
    // It is reached from the Data & History settings view and from nowhere else.
    expect(app).toContain('shadowStatusLine(wrap);');
    expect(app.match(/shadowStatusLine\(/g).length).toBe(2); // definition + one call
    // No planning path mentions it.
    ['renderToday', 'scheduledCard', 'dailyForToday', 'startDaySession', 'renderWeek']
      .forEach((fn) => {
        const i = app.indexOf('function ' + fn);
        if (i < 0) return;
        const body = app.slice(i, i + 4000);
        expect(body, fn).not.toContain('CoachShadow');
        expect(body, fn).not.toContain('shadowStatusLine');
      });
  });

  test('28 the shadow layer cannot change legacy state even when handed it', () => {
    const states = { mu_pull1: { criteria: { reps: 5 } }, mu_pull5: { criteria: { reps: 4 } } };
    const frozen = JSON.stringify(states);
    const s = snap([obs('pullup', { reps: 10, kip: false })], states);
    // The new model now says s1..s3 are all satisfied; the legacy state is untouched.
    expect(holder(s, 'stage:rmu_pull_s3').requirementStatus).toBe(E.STATUS.SATISFIED);
    expect(JSON.stringify(states)).toBe(frozen);
    expect(Engine.isComplete(NODES.mu_pull5, states)).toBe(false);
  });

  test('29 the shell ships the shadow module and caches it', () => {
    const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
    expect(html).toContain('shadow.js');
    const sw = fs.readFileSync(path.join(REPO, 'sw.js'), 'utf8');
    expect(sw).toContain('./shadow.js');
  });

  test('30 nothing is persisted: the snapshot is a return value, not a record', () => {
    const app = fs.readFileSync(path.join(REPO, 'app.js'), 'utf8');
    const i = app.indexOf('function shadowStatusLine');
    const body = app.slice(i, app.indexOf('function renderShadowReport'));
    // It reads the ledger and the context. It appends, puts and caches nothing.
    expect(body).toContain("I.all('ledger')");
    expect(body).not.toMatch(/\.append\(|\.appendUnique\(|\.put\(|setItem/);
  });
});

// ── in the real shell ─────────────────────────────────────────────────────
test.describe('P6b shadow — in the running app', () => {
  async function seed(page) {
    await page.goto('index.html');
    await page.evaluate(() => {
      const St = window.CoachStore.makeStore(), D = window.CoachData, Eng = window.CoachEngine;
      const bench = { pullup_max: 9, dips_max: 6, ring_support_secs: 14 }; const state = {};
      D.worlds.forEach((w) => {
        const nodes = window.CoachStore.seedStates(w, bench);
        const f = Eng.autoFocus(w, nodes);
        state[w.id] = { nodes, focus: { primary: f.primary, supporting: f.supporting, manual: false } };
      });
      St.setBench(bench); St.setState(state);
      St.setProfile({ onboarded: true, activeWorld: 'muscleup', days: [0, 2, 4], duration: 'normal' });
      ['spc_c_day', 'spc_c_workout', 'spc_c_adhoc', 'spc_c_plan', 'spc_c_templates']
        .forEach((k) => localStorage.removeItem(k));
    });
    await page.reload();
  }

  test('31 the diagnostic runs in Profile and says plainly that nothing uses it', async ({ page }) => {
    await seed(page);
    await page.locator('.nav button[data-s="profile"]').click();
    await page.locator('[data-sview="data"]').click();
    const line = page.locator('[data-shadow-status]');
    await expect(line).toContainText(/Shadow evaluation/, { timeout: 15000 });
    await expect(line).toContainText(/diagnostic, not used by the app/, { timeout: 15000 });
    await expect(line).toContainText(/match/, { timeout: 15000 });
    // the detail is collapsed, and opens
    await expect(page.locator('[data-shadow-report] .why-body')).toBeHidden();
    await page.locator('[data-shadow-report] summary').click();
    await expect(page.locator('[data-shadow-report] .why-body')).toBeVisible();
  });

  test('32 running the diagnostic changes no authoritative state at all', async ({ page }) => {
    await seed(page);
    const before = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.indexOf('spc_') === 0).sort();
      const out = {}; keys.forEach((k) => { out[k] = localStorage.getItem(k); });
      return out;
    });
    const ledgerBefore = await page.evaluate(async () => {
      await window.CoachIDB.init(); return (await window.CoachIDB.all('ledger')).length;
    });

    await page.locator('.nav button[data-s="profile"]').click();
    await page.locator('[data-sview="data"]').click();
    await expect(page.locator('[data-shadow-status]'))
      .toContainText(/diagnostic, not used by the app/, { timeout: 15000 });

    const after = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.indexOf('spc_') === 0).sort();
      const out = {}; keys.forEach((k) => { out[k] = localStorage.getItem(k); });
      return out;
    });
    const ledgerAfter = await page.evaluate(async () => (await window.CoachIDB.all('ledger')).length);

    // Every legacy key byte-identical, the ledger untouched. In particular the
    // diagnostic must not have created a world entry by reading state.
    expect(after).toEqual(before);
    expect(ledgerAfter).toBe(ledgerBefore);
  });
});
