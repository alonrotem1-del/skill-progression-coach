/*
 * P6a — the evaluator core.
 *
 * Pure node tests: no page, no storage, no browser. The evaluator takes a
 * ledger, commitments and a context package and returns verdicts, so a test is
 * a literal input and a literal expected output.
 *
 * The §15 behaviour-preservation fixtures live in tests/semantics.spec.cjs and
 * now run through this same module. What is here is the per-rule coverage those
 * cases do not isolate — and the purity guarantees, which nothing else checks.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const E = require(path.join(REPO, 'evaluator.js'));
const V = require(path.join(REPO, 'tools', 'validate-content.cjs'));

const CONTENT = V.loadContentDir(path.join(REPO, 'content'));
const BUNDLE = CONTENT.bundles[0];
const SEMANTICS = CONTENT.semantics[0];

// A package in the shape P5 stores one.
function pkgWith(bundle, policyOverrides) {
  const semantics = policyOverrides
    ? { version: SEMANTICS.version, policies: { ...SEMANTICS.policies, ...policyOverrides } }
    : SEMANTICS;
  return {
    contextId: 'ctx_1',
    manifest: { id: 'ctx_1', contentBundleVersion: bundle.version, evaluationSemanticsVersion: semantics.version },
    contentBundle: bundle,
    evaluationSemantics: semantics,
    vocabularyVersionAtWrite: CONTENT.vocabulary.vocabularyVersion,
    writtenAt: '2026-09-24T00:00:00.000Z'
  };
}
const PKG = pkgWith(BUNDLE);
const mini = (name) => require(path.join(__dirname, 'semantics', 'bundles', name + '.json'));

let SEQ = 0;
function obs(exerciseId, attributes, opts) {
  opts = opts || {};
  const at = opts.occurredAt === undefined ? '2026-09-01T10:00:00.000Z' : opts.occurredAt;
  return {
    seq: opts.seq === undefined ? ++SEQ : opts.seq,
    occurredAt: at,
    recordedAt: '2026-09-01T10:05:00.000Z',
    exerciseId,
    side: opts.side === undefined ? null : opts.side,
    attributes,
    provenance: opts.provenance || 'demonstrated',
    provenanceSource: opts.provenanceSource || 'in_session',
    sourceWorkoutItem: null,
    sequenceInItem: 1,
    context: {
      readiness: {},
      accommodationInForce: null,
      unmetDependencies: opts.unmet || [],
      prescribedDose: null,
      contextId: 'ctx_1'
    }
  };
}
const ev = (cid, side, ledger, pkg) => E.evaluateCriterion(cid, side, ledger, pkg || PKG);

// ── atomic Criteria ────────────────────────────────────────────────────────
test.describe('P6a evaluator — atomic Criteria', () => {
  test('01 an atomic Criterion is satisfied by one observation that meets every condition', () => {
    const r = ev('rmu_pull_5', 'combined', [obs('pullup', { reps: 6, kip: false }, { seq: 1 })]);
    expect(r.status).toBe('satisfied');
    expect(r.satisfiedBy).toEqual([1]);
    expect(r.excluded).toEqual([]);
    expect(r.bestObservation).toEqual({ seq: 1, attribute: 'reps', value: 6 });
    expect(r.shortfall).toBeNull();
    expect(r.contextId).toBe('ctx_1');
    expect(r.conditionResults.map((c) => [c.attribute, c.pass])).toEqual([['reps', true], ['kip', true]]);
  });

  test('02 an atomic Criterion is unsatisfied when a condition fails, and says by how much', () => {
    const r = ev('rmu_pull_5', 'combined', [obs('pullup', { reps: 3, kip: false }, { seq: 1 })]);
    expect(r.status).toBe('unsatisfied');
    expect(r.satisfiedBy).toEqual([]);
    expect(r.excluded).toEqual([]);              // admissible, merely short
    expect(r.bestObservation).toEqual({ seq: 1, attribute: 'reps', value: 3 });
    expect(r.shortfall).toBe('short by 2 reps');
    expect(r.conditionResults[0]).toEqual({ attribute: 'reps', required: { op: 'gte', value: 5 }, observed: 3, pass: false });
  });

  test('03 a non-numeric condition failing is reported without inventing a numeric shortfall', () => {
    const r = ev('rmu_pull_5', 'combined', [obs('pullup', { reps: 9, kip: true }, { seq: 1 })]);
    expect(r.status).toBe('unsatisfied');
    expect(r.shortfall).toBeNull();
    expect(r.conditionResults.filter((c) => !c.pass).map((c) => c.attribute)).toEqual(['kip']);
  });

  test('04 all conditions must hold of ONE observation (criterionComposition: one_observation)', () => {
    const spread = [
      obs('rmu_attempt', { reps: 1, kip: false, execution: 'assisted' }, { seq: 1 }),
      obs('rmu_attempt', { reps: 1, kip: true, execution: 'controlled' }, { seq: 2 })
    ];
    expect(ev('rmu_terminal', 'combined', spread).status).toBe('unsatisfied');
    const together = spread.concat([obs('rmu_attempt', { reps: 1, kip: false, execution: 'controlled' }, { seq: 3 })]);
    const r = ev('rmu_terminal', 'combined', together);
    expect(r.status).toBe('satisfied');
    expect(r.satisfiedBy).toEqual([3]);
  });

  test('05 a grade condition compares by scale position, not alphabetically', () => {
    const scale = BUNDLE.attributes.filter((a) => a.id === 'execution')[0].scale;
    expect(scale).toEqual(['uncontrolled', 'assisted', 'controlled']);
    const worse = ev('rmu_terminal', 'combined', [obs('rmu_attempt', { reps: 1, kip: false, execution: 'uncontrolled' }, { seq: 1 })]);
    expect(worse.status).toBe('unsatisfied');
    const better = ev('rmu_terminal', 'combined', [obs('rmu_attempt', { reps: 1, kip: false, execution: 'controlled' }, { seq: 1 })]);
    expect(better.status).toBe('satisfied');
  });
});

// ── RequirementExpressions ─────────────────────────────────────────────────
test.describe('P6a evaluator — RequirementExpressions', () => {
  const EXPR = mini('mini-expr');
  const P = pkgWith(EXPR);

  test('06 allOf is satisfied when every child is, each by its own observation', () => {
    const r = E.evaluateHolder('progression:m_allof',
      [obs('m_pull', { reps: 5 }, { seq: 1 }), obs('m_hang', { seconds: 30 }, { seq: 2 })], P, 'combined');
    expect(r.status).toBe('satisfied');
    expect(Object.keys(r.criteria).sort()).toEqual(['m_a', 'm_b']);
  });

  test('07 allOf is unsatisfied when only some children are satisfied', () => {
    const r = E.evaluateHolder('progression:m_allof', [obs('m_pull', { reps: 5 }, { seq: 1 })], P, 'combined');
    expect(r.status).toBe('unsatisfied');
    expect(r.criteria.m_a.status).toBe('satisfied');
    expect(r.criteria.m_b.status).toBe('unsatisfied');
  });

  test('08 anyOf is satisfied through the first branch', () => {
    const r = E.evaluateHolder('progression:m_anyof', [obs('m_pull', { reps: 5 }, { seq: 1 })], P, 'combined');
    expect(r.status).toBe('satisfied');
    expect(r.criteria.m_b.status).toBe('unsatisfied');
  });

  test('09 anyOf is satisfied through the alternate branch', () => {
    const r = E.evaluateHolder('progression:m_anyof', [obs('m_hang', { seconds: 30 }, { seq: 1 })], P, 'combined');
    expect(r.status).toBe('satisfied');
    expect(r.criteria.m_a.status).toBe('unsatisfied');
  });

  test('10 anyOf is unsatisfied when no branch is, and every child shortfall is available', () => {
    const r = E.evaluateHolder('progression:m_anyof',
      [obs('m_pull', { reps: 3 }, { seq: 1 }), obs('m_hang', { seconds: 10 }, { seq: 2 })], P, 'combined');
    expect(r.status).toBe('unsatisfied');
    expect(r.criteria.m_a.shortfall).toBe('short by 2 reps');
    expect(r.criteria.m_b.shortfall).toBe('short by 20 seconds');
  });

  test('11 a nested depth-2 expression combines inside out', () => {
    const satisfied = E.evaluateHolder('progression:m_nested',
      [obs('m_pull', { reps: 6 }, { seq: 1 }), obs('m_reach', { cm: 8 }, { seq: 2 })], P, 'combined');
    expect(satisfied.status).toBe('satisfied');
    const inner = E.evaluateHolder('progression:m_nested',
      [obs('m_pull', { reps: 6 }, { seq: 1 }), obs('m_reach', { cm: 4 }, { seq: 2 })], P, 'combined');
    expect(inner.status).toBe('unsatisfied');       // outer allOf, inner anyOf empty-handed
  });

  test('12 the bounded vocabulary is all there is: anything else is an error, not a guess', () => {
    const broken = JSON.parse(JSON.stringify(EXPR));
    broken.progressions[0].requirement = { atLeast: 2, of: [{ criterion: 'm_a' }, { criterion: 'm_b' }] };
    expect(() => E.evaluateHolder('progression:m_allof', [], pkgWith(broken), 'combined'))
      .toThrow(/neither a criterion leaf nor allOf\/anyOf/);
  });

  test('12b depth is bounded at 2 in the evaluator too, not only in the validator', () => {
    // Invariant 22 bounds an expression at depth 2. The validator catches a
    // deeper one at authoring time (V6), but the validator is not in the path of
    // a package already installed on a device — so the engine refuses it as the
    // malformed model it is rather than answering it. Silently evaluating depth 3
    // would mean the engine had accepted a rule language wider than the frozen
    // one, which is exactly how a bounded vocabulary stops being bounded.
    const withReq = (req) => {
      const bad = JSON.parse(JSON.stringify(BUNDLE));
      bad.progressions.filter((p) => p.id === 'rmu_false_grip')[0].requirement = req;
      return pkgWith(bad);
    };
    const holder = 'progression:rmu_false_grip';
    // Depth 1 and 2 are the frozen shapes, and they still evaluate.
    expect(() => E.evaluateHolder(holder, [], withReq({ criterion: 'fg_hang_30' }), null)).not.toThrow();
    expect(() => E.evaluateHolder(holder, [], withReq(
      { allOf: [{ criterion: 'fg_hang_30' }, { criterion: 'sup_rto_20' }] }), null)).not.toThrow();
    expect(() => E.evaluateHolder(holder, [], withReq(
      { allOf: [{ anyOf: [{ criterion: 'fg_hang_30' }, { criterion: 'sup_rto_20' }] },
        { criterion: 'dip_bar_5' }] }), null)).not.toThrow();
    // Depth 3 is refused, whichever operator does the nesting.
    expect(() => E.evaluateHolder(holder, [], withReq(
      { allOf: [{ anyOf: [{ allOf: [{ criterion: 'fg_hang_30' }, { criterion: 'sup_rto_20' }] },
        { criterion: 'dip_bar_5' }] }] }), null)).toThrow(/deeper than the frozen maximum of 2/);
    expect(() => E.evaluateHolder(holder, [], withReq(
      { anyOf: [{ allOf: [{ anyOf: [{ criterion: 'fg_hang_30' }, { criterion: 'sup_rto_20' }] },
        { criterion: 'dip_bar_5' }] }] }), null)).toThrow(/deeper than the frozen maximum of 2/);
    // And the content validator agrees, so the two layers cannot drift apart.
    const rep = V.validate({ ...CONTENT, bundles: [JSON.parse(JSON.stringify(BUNDLE))].map((b) => {
      b.progressions.filter((p) => p.id === 'rmu_false_grip')[0].requirement =
        { allOf: [{ anyOf: [{ allOf: [{ criterion: 'fg_hang_30' }, { criterion: 'sup_rto_20' }] },
          { criterion: 'dip_bar_5' }] }] };
      return b;
    }) });
    expect(rep.errors.some((e) => /depth 3 exceeds/.test(e.message))).toBe(true);
  });

  test('13 provisional propagates through allOf and anyOf under expressionStatusCombination: strict', () => {
    const claimBoth = [
      obs('m_pull', { reps: 5 }, { seq: 1, provenance: 'claimed', provenanceSource: 'onboarding_claim' }),
      obs('m_hang', { seconds: 30 }, { seq: 2, provenance: 'claimed', provenanceSource: 'onboarding_claim' })
    ];
    expect(E.evaluateHolder('progression:m_allof', claimBoth, P, 'combined').status).toBe('provisional');
    expect(E.evaluateHolder('progression:m_anyof', claimBoth, P, 'combined').status).toBe('provisional');
    // A satisfied child outranks a provisional one inside anyOf.
    const mixed = [claimBoth[0], obs('m_hang', { seconds: 30 }, { seq: 3 })];
    expect(E.evaluateHolder('progression:m_anyof', mixed, P, 'combined').status).toBe('satisfied');
    expect(E.evaluateHolder('progression:m_allof', mixed, P, 'combined').status).toBe('provisional');
  });
});

// ── provenance, and the line between provenance and validity ───────────────
test.describe('P6a evaluator — claimed versus demonstrated', () => {
  test('14 a claim provisionally satisfies an ordinary Criterion where semantics permit', () => {
    const r = ev('rmu_pull_5', 'combined',
      [obs('pullup', { reps: 6, kip: false }, { seq: 1, provenance: 'claimed', provenanceSource: 'onboarding_claim' })]);
    expect(r.status).toBe('provisional');
    expect(r.satisfiedBy).toEqual([1]);            // cited, not excluded
    expect(r.excluded).toEqual([]);
  });

  test('15 a claim is refused where semantics prohibit it', () => {
    // At a Goal terminal, by policy: claimedAtGoalTerminal = refuse.
    const terminal = ev('rmu_terminal', 'combined',
      [obs('rmu_attempt', { reps: 1, kip: false, execution: 'controlled' },
        { seq: 1, provenance: 'claimed', provenanceSource: 'onboarding_claim' })]);
    expect(terminal.status).toBe('unsatisfied');
    expect(terminal.excluded).toEqual([{ seq: 1, reason: 'claimed_not_eligible' }]);
    // And everywhere, under claimedEligibility = none.
    const strict = pkgWith(BUNDLE, { claimedEligibility: 'none' });
    const ordinary = ev('rmu_pull_5', 'combined',
      [obs('pullup', { reps: 6, kip: false }, { seq: 1, provenance: 'claimed', provenanceSource: 'onboarding_claim' })],
      strict);
    expect(ordinary.status).toBe('unsatisfied');
    expect(ordinary.excluded).toEqual([{ seq: 1, reason: 'claimed_not_eligible' }]);
  });

  test('16 a demonstrated row stays demonstrated even when excluded from one unlock', () => {
    // Exclusion is a property of one Dependency's constraint, not of the row.
    // mini-dep is where that constraint exists, so that is where the row is
    // excluded — and even there it is still a demonstration afterwards.
    const P = pkgWith(mini('mini-dep'));
    const row = obs('d_lift', { reps: 1, depth: 'below_parallel', execution: 'controlled' },
      { seq: 1, side: 'left', unmet: ['d_dep'] });
    const before = JSON.parse(JSON.stringify(row));
    const r = E.evaluateCriterion('d_terminal', 'left', [row], P);
    expect(r.status).toBe('unsatisfied');
    expect(r.excluded).toEqual([{ seq: 1, reason: 'dependency_unmet(d_dep)' }]);
    expect(row).toEqual(before);
    expect(row.provenance).toBe('demonstrated');
    expect(r.satisfiedBy).toEqual([]);          // not cited here
    // Nothing was relabelled: the excluded row is absent from the citation, it is
    // not present as a claim. There is no path from exclusion to provenance.
    expect(JSON.stringify(r)).not.toContain('claimed');

    // And in bundle 1, whose Dependencies constrain prescription and unlocking
    // but never evidence_validity, the same shape of row carrying the same kind
    // of unmet flag is admitted in full — the flag alone excludes nothing.
    const b1 = obs('pistol', { reps: 1, depth: 'below_parallel', execution: 'controlled' },
      { seq: 1, side: 'left', unmet: ['dep_pistol_needs_ankle'] });
    const admitted = ev('pistol_terminal', 'left', [b1]);
    expect(admitted.excluded).toEqual([]);
    expect(admitted.satisfiedBy).toEqual([1]);
    expect(admitted.status).toBe('satisfied');
  });

  test('17 demonstrated supersedes claimed in the citation, and both rows survive', () => {
    const ledger = [
      obs('pullup', { reps: 10, kip: false }, { seq: 1, provenance: 'claimed', provenanceSource: 'onboarding_claim', occurredAt: '2026-08-01T10:00:00.000Z' }),
      obs('pullup', { reps: 8, kip: false }, { seq: 2, occurredAt: '2026-09-01T10:00:00.000Z' })
    ];
    const five = ev('rmu_pull_5', 'combined', ledger);
    expect(five.status).toBe('satisfied');
    expect(five.satisfiedBy).toEqual([1, 2]);
    expect(five.bestObservation).toEqual({ seq: 2, attribute: 'reps', value: 8 });   // 8, not the claimed 10
    const ten = ev('rmu_pull_10', 'combined', ledger);
    expect(ten.status).toBe('provisional');
    expect(ten.satisfiedBy).toEqual([1]);
  });

  test('18 an undated row never outranks a dated one when the value ties', () => {
    const ledger = [
      obs('pullup', { reps: 6, kip: false }, { seq: 1, occurredAt: 'unknown', provenance: 'claimed', provenanceSource: 'legacy_migration' }),
      obs('pullup', { reps: 6, kip: false }, { seq: 2, occurredAt: '2026-09-01T10:00:00.000Z' })
    ];
    expect(ev('rmu_pull_5', 'combined', ledger).bestObservation.seq).toBe(2);
    expect(ev('rmu_pull_5', 'combined', ledger.slice().reverse()).bestObservation.seq).toBe(2);
  });
});

// ── Dependencies ───────────────────────────────────────────────────────────
test.describe('P6a evaluator — Dependencies', () => {
  test('19 a Dependency is met through the holder it references, by that holder\'s own requirement', () => {
    const met = E.evaluateDependency('dep_transition_needs_rto',
      [obs('rto_support', { seconds: 25 }, { seq: 1 })], PKG, 'combined');
    expect(met.met).toBe(true);
    expect(met.reason).toBeNull();
    expect(met.blocks).toEqual([]);
    expect(met.requires).toBe('stage:rmu_sup_s2');
  });

  test('20 a Dependency is unmet when the referenced holder falls short, and names what it blocks', () => {
    const r = E.evaluateDependency('dep_transition_needs_rto',
      [obs('rto_support', { seconds: 12 }, { seq: 1 })], PKG, 'combined');
    expect(r.met).toBe(false);
    expect(r.reason).toBe('requirement_unsatisfied');
    expect(r.blocks).toEqual(['stage:rmu_trans_s3']);
  });

  test('21 a claim cannot unblock a hard Dependency (claimedAtHardDependency: refuse)', () => {
    const r = E.evaluateDependency('dep_transition_needs_rto',
      [obs('rto_support', { seconds: 25 }, { seq: 1, provenance: 'claimed', provenanceSource: 'onboarding_claim' })],
      PKG, 'combined');
    expect(r.met).toBe(false);
    expect(r.reason).toBe('claimed_not_eligible');
    expect(r.severity).toBe('hard');
  });

  test('22 an unmet Dependency recorded on a past row excludes it where evidence_validity is constrained', () => {
    const DEP = mini('mini-dep');
    const P = pkgWith(DEP);
    const row = obs('d_lift', { reps: 1, depth: 'below_parallel', execution: 'controlled' },
      { seq: 1, side: 'left', unmet: ['d_dep'] });
    const left = E.evaluateCriterion('d_terminal', 'left', [row], P);
    expect(left.status).toBe('unsatisfied');
    expect(left.excluded).toEqual([{ seq: 1, reason: 'dependency_unmet(d_dep)' }]);
    // The stored context is read, never recomputed: with the flag absent the very
    // same row is admitted, which is what keeps this from being circular.
    const clean = obs('d_lift', { reps: 1, depth: 'below_parallel', execution: 'controlled' },
      { seq: 1, side: 'left' });
    expect(E.evaluateCriterion('d_terminal', 'left', [clean], P).status).toBe('satisfied');
  });

  test('23 no Dependency contributes a threshold of its own', () => {
    // Its verdict is the referenced holder's verdict. Raise the holder's bar in
    // content and the Dependency follows; there is nowhere else to look.
    const raised = JSON.parse(JSON.stringify(BUNDLE));
    raised.criteria.filter((c) => c.id === 'sup_rto_20')[0].conditions[0].value = 40;
    const ledger = [obs('rto_support', { seconds: 25 }, { seq: 1 })];
    expect(E.evaluateDependency('dep_transition_needs_rto', ledger, PKG, 'combined').met).toBe(true);
    expect(E.evaluateDependency('dep_transition_needs_rto', ledger, pkgWith(raised), 'combined').met).toBe(false);
  });

  test('24 every Dependency in bundle 1 is evaluable, on the sides its sideRule implies', () => {
    expect(BUNDLE.dependencies.length).toBe(5);
    const seen = [];
    BUNDLE.dependencies.forEach((d) => {
      E.dependencySides(d).forEach((side) => {
        const r = E.evaluateDependency(d.id, [], PKG, side);
        expect(typeof r.met, d.id).toBe('boolean');
        expect(r.met, d.id + ' on an empty ledger').toBe(false);
        expect(r.reason, d.id).toBe('no_evidence');
        seen.push(d.id + '|' + side);
      });
    });
    expect(seen).toEqual([
      'dep_transition_needs_rto|combined',
      'dep_rmu_needs_false_grip|combined',
      'dep_pistol_needs_ankle|left', 'dep_pistol_needs_ankle|right',
      'dep_pistol_needs_deep_squat|combined',
      'dep_ring_dip_needs_ring_support|combined'
    ]);
  });

  test('25 unmetDependencies() answers the question P3 will ask, and narrows to a subject', () => {
    const all = E.unmetDependencies([], PKG);
    expect(all.length).toBe(6);
    expect(all.every((u) => u.reason === 'no_evidence')).toBe(true);
    const narrowed = E.unmetDependencies([], PKG, { holderKeys: ['stage:rmu_trans_s3'] });
    expect(narrowed.map((u) => u.dependencyId)).toEqual(['dep_transition_needs_rto']);
    const satisfied = E.unmetDependencies([obs('rto_support', { seconds: 25 }, { seq: 1 })], PKG,
      { holderKeys: ['stage:rmu_trans_s3'] });
    expect(satisfied).toEqual([]);
  });
});

// ── an empty ledger ────────────────────────────────────────────────────────
test.describe('P6a evaluator — the empty ledger', () => {
  test('26 nothing is satisfied, nothing is excluded, and nothing is invented', () => {
    BUNDLE.criteria.forEach((c) => {
      const sides = c.sideScope === 'each' ? ['left', 'right'] : ['combined'];
      sides.forEach((side) => {
        const r = ev(c.id, side, []);
        expect(r.status, c.id + '|' + side).toBe('unsatisfied');
        expect(r.satisfiedBy, c.id).toEqual([]);
        expect(r.excluded, c.id).toEqual([]);
        expect(r.bestObservation, c.id).toBeNull();
        expect(r.shortfall, c.id).toBeNull();
        expect(r.conditionResults.every((x) => x.pass === false && x.observed === null), c.id).toBe(true);
      });
    });
  });

  test('27 every holder is unsatisfied and every current Stage is the lowest one', () => {
    BUNDLE.progressions.forEach((p) => {
      const sides = p.id.indexOf('pistol') === 0 ? ['left', 'right'] : ['combined'];
      sides.forEach((side) => {
        if (p.form === 'DIRECT') {
          expect(E.isHolderSatisfied('progression:' + p.id, [], PKG, side), p.id).toBe(false);
        } else {
          const lowest = p.stages.slice().sort((a, b) => a.order - b.order)[0].id;
          expect(E.currentStage(p.id, [], PKG, side), p.id).toBe(lowest);
        }
      });
    });
  });
});

// ── side scoping ───────────────────────────────────────────────────────────
test.describe('P6a evaluator — side scoping', () => {
  test('28 a left observation satisfies the left side and not the right', () => {
    const ledger = [obs('knee_wall', { cm: 11 }, { seq: 1, side: 'left' })];
    const left = ev('ankle_9', 'left', ledger);
    const right = ev('ankle_9', 'right', ledger);
    expect(left.status).toBe('satisfied');
    expect(left.satisfiedBy).toEqual([1]);
    expect(right.status).toBe('unsatisfied');
    expect(right.excluded).toEqual([{ seq: 1, reason: 'wrong_side' }]);
  });

  test('29 a right observation satisfies the right side and not the left', () => {
    const ledger = [obs('knee_wall', { cm: 11 }, { seq: 1, side: 'right' })];
    expect(ev('ankle_9', 'right', ledger).status).toBe('satisfied');
    expect(ev('ankle_9', 'left', ledger).excluded).toEqual([{ seq: 1, reason: 'wrong_side' }]);
  });

  test('30 asymmetric state is carried all the way to the current Stage', () => {
    const ledger = [
      obs('knee_wall', { cm: 7 }, { seq: 1, side: 'left' }),
      obs('knee_wall', { cm: 12 }, { seq: 2, side: 'right' })
    ];
    expect(E.currentStage('pistol_ankle_mobility', ledger, PKG, 'left')).toBe('pistol_ankle_s1');
    expect(E.currentStage('pistol_ankle_mobility', ledger, PKG, 'right')).toBeNull();
  });

  test('31 a bilateral measurement cannot satisfy a per-side Criterion, and vice versa', () => {
    const both = [obs('knee_wall', { cm: 12 }, { seq: 1, side: 'both' })];
    expect(ev('ankle_9', 'left', both).excluded).toEqual([{ seq: 1, reason: 'wrong_side' }]);
    expect(ev('ankle_9', 'right', both).excluded).toEqual([{ seq: 1, reason: 'wrong_side' }]);
    // A combined-scope Criterion accepts side null or both, and refuses one side.
    expect(ev('deepsquat_30', 'combined',
      [obs('deep_squat_hold', { seconds: 30, depth: 'below_parallel' }, { seq: 1, side: null })]).status).toBe('satisfied');
    expect(ev('deepsquat_30', 'combined',
      [obs('deep_squat_hold', { seconds: 30, depth: 'below_parallel' }, { seq: 1, side: 'both' })]).status).toBe('satisfied');
    expect(ev('deepsquat_30', 'combined',
      [obs('deep_squat_hold', { seconds: 30, depth: 'below_parallel' }, { seq: 1, side: 'left' })].slice())
      .excluded).toEqual([{ seq: 1, reason: 'wrong_side' }]);
  });

  test('32 asking a per-side Criterion for a combined verdict is an error, not a guess', () => {
    expect(() => ev('ankle_9', 'combined', [])).toThrow(/per-side/);
  });
});

// ── ExerciseLink admissibility (the P4.1 lock) ─────────────────────────────
test.describe('P6a evaluator — ExerciseLink admissibility', () => {
  const ROLE = mini('mini-role');
  const P = pkgWith(ROLE);

  test('33 an assess link contributes evidence', () => {
    const r = E.evaluateCriterion('r_hold_20', 'combined', [obs('r_assessed', { seconds: 20 }, { seq: 1 })], P);
    expect(r.status).toBe('satisfied');
    expect(r.satisfiedBy).toEqual([1]);
  });

  test('34 a train link does not, however far past the threshold it goes', () => {
    const r = E.evaluateCriterion('r_hold_20', 'combined', [obs('r_trained', { seconds: 45 }, { seq: 1 })], P);
    expect(r.status).toBe('unsatisfied');
    expect(r.satisfiedBy).toEqual([]);
    // Not applicable rather than excluded: every §7 exclusion reason is a reason
    // evidence was set aside, and this row was never evidence here.
    expect(r.excluded).toEqual([]);
    expect(r.bestObservation).toBeNull();
  });

  test('35 a maintain link does not either', () => {
    const withMaintain = JSON.parse(JSON.stringify(ROLE));
    withMaintain.exerciseLinks.filter((l) => l.exerciseId === 'r_trained')[0].relation = 'maintain';
    const r = E.evaluateCriterion('r_hold_20', 'combined',
      [obs('r_trained', { seconds: 45 }, { seq: 1 })], pkgWith(withMaintain));
    expect(r.status).toBe('unsatisfied');
    expect(r.satisfiedBy).toEqual([]);
    expect(r.excluded).toEqual([]);
  });

  test('36 the role is structural: no policy value can turn a train link into evidence', () => {
    // There is no dimension for it, and inventing one is rejected outright.
    expect(Object.keys(E.POLICY_DEFAULTS)).not.toContain('trainEvidenceEligibility');
    const rogue = pkgWith(ROLE, { trainEvidenceEligibility: 'admit' });
    const r = E.evaluateCriterion('r_hold_20', 'combined', [obs('r_trained', { seconds: 45 }, { seq: 1 })], rogue);
    expect(r.status).toBe('unsatisfied');
  });

  test('37 in bundle 1, the six train links that could have counted still do not', () => {
    const cases = [
      ['fg_hang_30', 'deadhang', { seconds: 60 }],
      ['fg_hang_30', 'activehang', { seconds: 60 }],
      ['trans_lowring_3', 'lowtrans', { reps: 5, catch_quality: 'controlled' }],
      ['trans_banded_3', 'transition', { reps: 5, catch_quality: 'controlled' }],
      ['trans_full_1', 'negmu', { reps: 5, catch_quality: 'controlled' }],
      ['dip_bar_5', 'pbdip', { reps: 20 }]
    ];
    cases.forEach(([cid, exId, attrs]) => {
      const r = ev(cid, 'combined', [obs(exId, attrs, { seq: 1 })]);
      expect(r.status, exId + ' -> ' + cid).toBe('unsatisfied');
      expect(r.satisfiedBy, exId).toEqual([]);
    });
    // And the one authored assess substitution does count.
    expect(ev('rmu_pull_10', 'combined', [obs('weighted_pullup', { reps: 10, kg: 12, kip: false }, { seq: 1 })]).status)
      .toBe('satisfied');
  });
});

// ── deferred policies, at their declared values ────────────────────────────
test.describe('P6a evaluator — freshness and regression are none', () => {
  test('38 freshness: none keeps an old demonstration eligible', () => {
    const old = ev('fg_hang_30', 'combined', [obs('fg_hang', { seconds: 32 }, { seq: 1, occurredAt: '2019-01-01T10:00:00.000Z' })]);
    expect(old.status).toBe('satisfied');
    expect(old.excluded).toEqual([]);           // no stale(...) reason anywhere
  });

  test('39 regression: none does not demote on a later sub-threshold row', () => {
    const r = ev('rmu_pull_5', 'combined', [
      obs('pullup', { reps: 5, kip: false }, { seq: 1, occurredAt: '2026-08-01T10:00:00.000Z' }),
      obs('pullup', { reps: 3, kip: false }, { seq: 2, occurredAt: '2026-09-01T10:00:00.000Z' })
    ]);
    expect(r.status).toBe('satisfied');
    expect(r.satisfiedBy).toEqual([1]);
    expect(r.bestObservation).toEqual({ seq: 1, attribute: 'reps', value: 5 });
  });

  test('40 a policy value this evaluator does not implement is refused, never ignored', () => {
    expect(() => ev('rmu_pull_5', 'combined', [], pkgWith(BUNDLE, { freshness: 'expire_after_months' })))
      .toThrow(/does not implement freshness/);
    expect(() => ev('rmu_pull_5', 'combined', [], pkgWith(BUNDLE, { regression: 'floor_only' })))
      .toThrow(/does not implement regression/);
  });

  test('41 supersession: best_applicable — the best value wins whatever the order', () => {
    const rows = [
      obs('pullup', { reps: 3, kip: false }, { seq: 1, occurredAt: '2026-08-01T10:00:00.000Z' }),
      obs('pullup', { reps: 6, kip: false }, { seq: 2, occurredAt: '2026-09-01T10:00:00.000Z' })
    ];
    expect(ev('rmu_pull_5', 'combined', rows).bestObservation.seq).toBe(2);
    expect(ev('rmu_pull_5', 'combined', rows.slice().reverse()).bestObservation.seq).toBe(2);
  });
});

// ── purity ────────────────────────────────────────────────────────────────
test.describe('P6a evaluator — purity', () => {
  const ledger = [
    obs('pullup', { reps: 6, kip: false }, { seq: 1 }),
    obs('knee_wall', { cm: 11 }, { seq: 2, side: 'left' }),
    obs('rto_support', { seconds: 25 }, { seq: 3, provenance: 'claimed', provenanceSource: 'onboarding_claim' })
  ];

  test('42 identical inputs give identical output, every time', () => {
    const once = E.interpret(ledger, {}, PKG, {
      evaluations: ['rmu_pull_5|combined|ctx_1', 'ankle_9|left|ctx_1'],
      holders: ['stage:rmu_pull_s2|combined'],
      currentStage: ['rmu_pull_strength|combined'],
      dependencies: ['dep_transition_needs_rto|combined']
    });
    for (let i = 0; i < 5; i++) {
      expect(E.interpret(ledger, {}, PKG, {
        evaluations: ['rmu_pull_5|combined|ctx_1', 'ankle_9|left|ctx_1'],
        holders: ['stage:rmu_pull_s2|combined'],
        currentStage: ['rmu_pull_strength|combined'],
        dependencies: ['dep_transition_needs_rto|combined']
      })).toEqual(once);
    }
  });

  test('43 the ledger is not mutated, and neither is any row in it', () => {
    const before = JSON.stringify(ledger);
    E.evaluateCriterion('rmu_pull_5', 'combined', ledger, PKG);
    E.evaluateHolder('stage:rmu_pull_s2', ledger, PKG, 'combined');
    E.evaluateDependency('dep_transition_needs_rto', ledger, PKG, 'combined');
    E.currentStage('rmu_pull_strength', ledger, PKG, 'combined');
    E.unmetDependencies(ledger, PKG);
    expect(JSON.stringify(ledger)).toBe(before);
  });

  test('44 the context package is not mutated', () => {
    const before = JSON.stringify(PKG);
    E.interpret(ledger, {}, PKG, {
      evaluations: ['rmu_pull_5|combined|ctx_1'],
      holders: ['goalTerminal:ring_muscle_up|combined'],
      dependencies: ['dep_pistol_needs_ankle|left']
    });
    E.unmetDependencies(ledger, PKG);
    expect(JSON.stringify(PKG)).toBe(before);
  });

  test('45 the module reaches for nothing outside its arguments', () => {
    const src = require('fs').readFileSync(path.join(REPO, 'evaluator.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    ['localStorage', 'indexedDB', 'fetch(', 'XMLHttpRequest', 'document', 'window.',
      'Date.now', 'new Date(', 'Math.random', 'require(', 'CoachStore', 'CoachIDB', 'CoachWeek']
      .forEach((needle) => expect(code, needle).not.toContain(needle));
    // Date.parse of a stored timestamp is reading the data, not asking the clock.
    expect(code).toContain('Date.parse');
  });

  test('46 it is synchronous: no promise anywhere in its surface', () => {
    Object.keys(E).forEach((k) => {
      if (typeof E[k] !== 'function') return;
      expect(String(E[k]), k).not.toMatch(/\bPromise\b|\basync\b|\bawait\b/);
    });
  });
});

// ── no authority ──────────────────────────────────────────────────────────
test.describe('P6a evaluator — no authority', () => {
  test('47 nothing in the app references the evaluator, and the shell does not load it', () => {
    const fs = require('fs');
    ['app.js', 'week.js', 'engine.js', 'progress.js', 'daily.js', 'store.js',
      'settings.js', 'adapt.js', 'duration.js', 'data.js', 'backup.js', 'idb.js', 'context.js']
      .forEach((f) => {
        const src = fs.readFileSync(path.join(REPO, f), 'utf8');
        expect(src, f).not.toContain('CoachEvaluator');
        expect(src, f).not.toContain('evaluator.js');
      });
    // P6a is deliberately outside the production shell: P3 wires it in when the
    // evidence tap needs it, and not before.
    const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
    expect(html).not.toContain('evaluator.js');
    const sw = fs.readFileSync(path.join(REPO, 'sw.js'), 'utf8');
    expect(sw).not.toContain('evaluator.js');
  });

  test('48 the evaluator writes nothing: no store, no cache, no state', () => {
    const src = require('fs').readFileSync(path.join(REPO, 'evaluator.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    ['setItem', 'put(', 'append(', 'transaction', 'objectStore', 'cache']
      .forEach((needle) => expect(code, needle).not.toContain(needle));
  });
});

// ── the validator's V18 half ──────────────────────────────────────────────
test.describe('P6a evaluator — V18 integration', () => {
  test('49 V18 reproduces every fixture scenario through the real evaluator', () => {
    const rep = V.validate({
      ...CONTENT,
      continuity: V.loadContinuity(REPO),
      semanticsFixtures: V.loadSemanticsFixtures(path.join(REPO, 'tests', 'semantics', 'fixtures')),
      evaluator: V.loadEvaluator(REPO, path.join(REPO, 'content'))
    });
    expect(rep.errors, JSON.stringify(rep.errors, null, 2)).toEqual([]);
    const v18 = rep.notes.filter((n) => n.rule === 'V18').map((n) => n.message).join(' ');
    expect(v18).not.toContain('PENDING');
    expect(v18).toMatch(/behaviour preservation verified: \d+ fixture scenario\(s\)/);
    expect(v18).toContain('27 fixture scenario(s)');
  });

  test('50 V18 fails loudly when the evaluator disagrees with a fixture', () => {
    const wrong = () => ({ evaluations: {}, holders: {}, currentStage: {}, limiters: {}, dependencies: {} });
    const rep = V.validate({
      ...CONTENT,
      continuity: V.loadContinuity(REPO),
      semanticsFixtures: V.loadSemanticsFixtures(path.join(REPO, 'tests', 'semantics', 'fixtures')),
      evaluator: wrong
    });
    const v18Errors = rep.errors.filter((e) => e.rule === 'V18');
    expect(v18Errors.length).toBeGreaterThan(0);
    expect(v18Errors[0].message).toContain('verdict changed');
  });
});
