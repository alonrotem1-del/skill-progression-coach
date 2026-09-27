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
  test('47 only the evidence tap consults the evaluator; no decision path does', () => {
    const fs = require('fs');
    // P3 wires the evaluator into the runtime for ONE purpose: telling a new
    // observation which Dependencies were unmet when it was recorded. Every
    // module that decides what the athlete sees must still be unable to reach
    // it — that is what "not authoritative" means once it is loaded.
    ['week.js', 'engine.js', 'progress.js', 'daily.js', 'store.js',
      'settings.js', 'adapt.js', 'duration.js', 'data.js', 'backup.js', 'idb.js', 'context.js']
      .forEach((f) => {
        const src = fs.readFileSync(path.join(REPO, f), 'utf8');
        expect(src, f).not.toContain('CoachEvaluator');
        expect(src, f).not.toContain('evaluator.js');
      });
    // In app.js the single reference is inside the evidence tap, and it calls
    // exactly one thing: the Dependency question.
    const app = fs.readFileSync(path.join(REPO, 'app.js'), 'utf8');
    const uses = app.match(/CoachEvaluator/g) || [];
    expect(uses.length).toBe(1);
    expect(app).toContain('E.unmetDependencies(');
    ['CoachEvaluator.interpret', 'CoachEvaluator.currentStage', 'CoachEvaluator.limiter',
      'CoachEvaluator.evaluateHolder', 'CoachEvaluator.isHolderSatisfied',
      'CoachEvaluator.evaluateCriterion']
      .forEach((n) => expect(app, n).not.toContain(n));
    // The shell loads it, because the tap runs in the shell.
    const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
    expect(html).toContain('evaluator.js');
    const sw = fs.readFileSync(path.join(REPO, 'sw.js'), 'utf8');
    expect(sw).toContain('./evaluator.js');
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

// ══════════════════════════════════════════════════════════════════════════
// P6a.1 — local requirement satisfaction versus holder establishment
//
// The frozen distinction, from Design Document v2.1 §3 (locked): a Dependency
// "references another Progression's ESTABLISHED state". LDM §10 gives the
// output shape — availability and blockedBy — and LDM §12 defines `requires` as
// "what must already be established".
//
// The chain these tests need does not exist in bundle 1, so it is built here on
// a deep copy: ONE test-only Dependency making rmu_sup_s2 (B) require
// rmu_false_grip (A). The downstream link is bundle 1's own
// dep_transition_needs_rto, which already makes rmu_trans_s3 (C) require B with
// constrains [prescription, unlocking]. Authored content is never modified.
// ══════════════════════════════════════════════════════════════════════════
test.describe('P6a.1 requirement versus establishment', () => {
  const A = 'progression:rmu_false_grip';   // fg_hang_30  — seconds gte 30
  const B = 'stage:rmu_sup_s2';             // sup_rto_20  — seconds gte 20
  const C = 'stage:rmu_trans_s3';           // requires B, via dep_transition_needs_rto

  // A copy of bundle 1 with B depending on A under the given constrains facets.
  function chain(constrains) {
    const b = JSON.parse(JSON.stringify(BUNDLE));
    b.dependencies.push({
      id: 'dep_support_needs_false_grip',
      subject: { kind: 'stage', progressionId: 'rmu_ring_support', stageId: 'rmu_sup_s2' },
      requires: { kind: 'progression', progressionId: 'rmu_false_grip' },
      sideRule: 'any',
      constrains: constrains,
      severity: 'hard',
      accommodation: null,
      rationale: 'Test-only: makes rmu_sup_s2 depend on false grip so a chain exists.'
    });
    return pkgWith(b);
  }
  const rto = (secs) => obs('rto_support', { seconds: secs }, { seq: 1 });
  const fg = (secs) => obs('fg_hang', { seconds: secs }, { seq: 2 });

  test('51 an unlocking Dependency blocks establishment while leaving the requirement satisfied', () => {
    const P = chain(['prescription', 'unlocking']);
    const ledger = [rto(25)];                       // B demonstrated; A has nothing
    // The two questions give different answers, which is the whole point.
    expect(E.isRequirementSatisfied(B, ledger, P, null)).toBe(true);
    expect(E.isHolderEstablished(B, ledger, P, null)).toBe(false);
    const est = E.evaluateEstablishment(B, ledger, P, null);
    expect(est.requirement.status).toBe('satisfied');
    expect(est.established).toBe(false);
    expect(est.availability).toBe('blocked');
    expect(est.blockedBy.length).toBe(1);
    expect(est.blockedBy[0].dependencyId).toBe('dep_support_needs_false_grip');
    expect(est.blockedBy[0].requires).toBe(A);
    expect(est.blockedBy[0].severity).toBe('hard');
  });

  test('52 and C, which depends on B, sees B as unmet — without naming any of B\'s criteria', () => {
    const P = chain(['prescription', 'unlocking']);
    const ledger = [rto(25)];
    const d = E.evaluateDependency('dep_transition_needs_rto', ledger, P, 'combined');
    expect(d.met).toBe(false);
    // A reason that says WHERE the block is: B was demonstrated, so there is
    // nothing left for the athlete to demonstrate at B.
    expect(d.reason).toBe('requires_blocked');
    expect(d.requires).toBe(B);
    expect(d.requiresBlockedBy).toEqual(['dep_support_needs_false_grip']);
    expect(d.blocks).toEqual([C]);
    // C references B and nothing deeper: no upstream Criterion is duplicated.
    const dep = BUNDLE.dependencies.filter((x) => x.id === 'dep_transition_needs_rto')[0];
    expect(Object.keys(dep)).not.toContain('criterion');
    expect(JSON.stringify(dep)).not.toContain('fg_hang_30');
    expect(JSON.stringify(dep)).not.toContain('sup_rto_20');
  });

  test('53 a prescription-only Dependency does not block establishment, so it does not propagate', () => {
    const P = chain(['prescription']);
    const ledger = [rto(25)];                       // identical evidence to test 51
    const est = E.evaluateEstablishment(B, ledger, P, null);
    expect(est.requirement.status).toBe('satisfied');
    expect(est.established).toBe(true);             // the only difference is `constrains`
    expect(est.availability).toBe('achieved');
    expect(est.blockedBy).toEqual([]);
    // …and C therefore sees B as met.
    expect(E.evaluateDependency('dep_transition_needs_rto', ledger, P, 'combined').met).toBe(true);
  });

  test('54 satisfying the upstream holder establishes B and unblocks C', () => {
    const P = chain(['prescription', 'unlocking']);
    const ledger = [rto(25), fg(35)];               // A now demonstrated too
    expect(E.isHolderEstablished(A, ledger, P, null)).toBe(true);
    const est = E.evaluateEstablishment(B, ledger, P, null);
    expect(est.established).toBe(true);
    expect(est.availability).toBe('achieved');
    expect(est.blockedBy).toEqual([]);
    expect(E.evaluateDependency('dep_transition_needs_rto', ledger, P, 'combined').met).toBe(true);
  });

  test('55 a holder whose own requirement is unsatisfied is available, not blocked', () => {
    const P = chain(['prescription', 'unlocking']);
    const ledger = [rto(12), fg(35)];               // A met, B short
    const est = E.evaluateEstablishment(B, ledger, P, null);
    expect(est.requirement.status).toBe('unsatisfied');
    expect(est.established).toBe(false);
    // Nothing is blocking it — there is simply work left to demonstrate.
    expect(est.availability).toBe('available');
    expect(est.blockedBy).toEqual([]);
  });

  test('56 an empty ledger establishes nothing, and says which holders are blocked rather than merely unproven', () => {
    const P = chain(['prescription', 'unlocking']);
    [A, B, C].forEach((h) => expect(E.isHolderEstablished(h, [], P, null), h).toBe(false));
    // A has no unlocking Dependency of its own, so it is available.
    expect(E.evaluateEstablishment(A, [], P, null).availability).toBe('available');
    // B and C each carry one, unmet, so they are blocked as well as unproven.
    expect(E.evaluateEstablishment(B, [], P, null).availability).toBe('blocked');
    expect(E.evaluateEstablishment(C, [], P, null).availability).toBe('blocked');
  });

  test('57 establishment is per side where the content is per side', () => {
    // dep_pistol_needs_ankle is sideRule mirror; made unlocking here so it gates.
    const b = JSON.parse(JSON.stringify(BUNDLE));
    b.dependencies.filter((d) => d.id === 'dep_pistol_needs_ankle')[0].constrains =
      ['prescription', 'unlocking'];
    const P = pkgWith(b);
    const term = (side, seq) => obs('pistol',
      { reps: 1, depth: 'below_parallel', execution: 'controlled' }, { seq, side });
    const ledger = [
      term('left', 1), term('right', 2),
      obs('knee_wall', { cm: 12 }, { seq: 3, side: 'left' })   // left ankle only
    ];
    const G = 'goalTerminal:pistol_squat';
    // Both sides demonstrated the terminal itself.
    expect(E.isRequirementSatisfied(G, ledger, P, 'left')).toBe(true);
    expect(E.isRequirementSatisfied(G, ledger, P, 'right')).toBe(true);
    // Only the left ankle is open, so only the left side is established.
    expect(E.isHolderEstablished(G, ledger, P, 'left')).toBe(true);
    expect(E.isHolderEstablished(G, ledger, P, 'right')).toBe(false);
    const right = E.evaluateEstablishment(G, ledger, P, 'right');
    expect(right.availability).toBe('blocked');
    expect(right.blockedBy[0].dependencyId).toBe('dep_pistol_needs_ankle');
    expect(right.blockedBy[0].side).toBe('right');
    expect(E.evaluateEstablishment(G, ledger, P, 'left').availability).toBe('achieved');
  });

  test('58 availability reports not_relevant when a side is asked of an unsided holder', () => {
    // LDM §10's fourth value. It is a statement about SIDEDNESS, not capability:
    // B's criterion is combined-scope, so left and right have no separate answer.
    const P = chain(['prescription']);
    const ledger = [rto(25)];
    const est = E.evaluateEstablishment(B, ledger, P, 'left');
    expect(est.availability).toBe('not_relevant');
    // The single answer is still given, so a per-side caller is not left without one.
    expect(est.established).toBe(true);
    expect(E.evaluateEstablishment(B, ledger, P, null).availability).toBe('achieved');
  });

  test('59 a DIRECT holder and a STAGED holder establish by the same rule', () => {
    const P = chain(['prescription', 'unlocking']);
    const ledger = [rto(25), fg(35)];
    // DIRECT: rmu_false_grip holds its Criterion directly, no stages.
    expect(BUNDLE.progressions.filter((p) => p.id === 'rmu_false_grip')[0].form).toBe('DIRECT');
    expect(E.evaluateEstablishment(A, ledger, P, null).availability).toBe('achieved');
    // STAGED: rmu_sup_s2 is a stage of rmu_support.
    expect(BUNDLE.progressions.filter((p) => p.id === 'rmu_ring_support')[0].form).toBe('STAGED');
    expect(E.evaluateEstablishment(B, ledger, P, null).availability).toBe('achieved');
  });

  test('60 evidence_validity is untouched: it still reads the row\'s own stored context', () => {
    // The evidence facet works on the observation's recorded unmetDependencies
    // and is not recomputed, so establishment changes nothing about it.
    const DEP = mini('mini-dep');
    const P = pkgWith(DEP);
    const flagged = obs('d_lift', { reps: 1, depth: 'below_parallel', execution: 'controlled' },
      { seq: 1, side: 'left', unmet: ['d_dep'] });
    const before = JSON.parse(JSON.stringify(flagged));
    expect(E.evaluateCriterion('d_terminal', 'left', [flagged], P).excluded)
      .toEqual([{ seq: 1, reason: 'dependency_unmet(d_dep)' }]);
    expect(flagged).toEqual(before);                 // history is read, never rewritten
    const clean = obs('d_lift', { reps: 1, depth: 'below_parallel', execution: 'controlled' },
      { seq: 1, side: 'left' });
    expect(E.evaluateCriterion('d_terminal', 'left', [clean], P).status).toBe('satisfied');
  });

  test('61 currentStage is unchanged by establishment blocking', () => {
    const P = chain(['prescription', 'unlocking']);
    const blocked = chain(['prescription', 'unlocking']);
    const ledger = [rto(25)];                        // s1 unproven, s2 demonstrated, A missing
    // rmu_sup_s2 is blocked, yet the current Stage is still decided by criteria
    // alone — being blocked is not being undone.
    expect(E.evaluateEstablishment(B, ledger, blocked, null).established).toBe(false);
    const withA = chain(['prescription']);
    expect(E.currentStage('rmu_ring_support', ledger, P, null))
      .toBe(E.currentStage('rmu_ring_support', ledger, withA, null));
    // And the answer is the lowest stage whose own criteria are unsatisfied.
    expect(E.currentStage('rmu_ring_support', ledger, P, null)).toBe('rmu_sup_s1');
    expect(E.currentStage('rmu_ring_support', [obs('ring_support', { seconds: 25 }, { seq: 1 }), rto(25)], P, null))
      .toBeNull();
  });

  test('62 a runtime cycle throws; it is never reported as non-satisfaction', () => {
    const b = JSON.parse(JSON.stringify(BUNDLE));
    // A cycle the validator would reject: s1 requires s2 and s2 requires s1.
    b.dependencies.push({
      id: 'dep_cycle_a', subject: { kind: 'stage', progressionId: 'rmu_ring_support', stageId: 'rmu_sup_s1' },
      requires: { kind: 'stage', progressionId: 'rmu_ring_support', stageId: 'rmu_sup_s2' },
      sideRule: 'any', constrains: ['unlocking'], severity: 'hard', rationale: 'cycle probe'
    }, {
      id: 'dep_cycle_b', subject: { kind: 'stage', progressionId: 'rmu_ring_support', stageId: 'rmu_sup_s2' },
      requires: { kind: 'stage', progressionId: 'rmu_ring_support', stageId: 'rmu_sup_s1' },
      sideRule: 'any', constrains: ['unlocking'], severity: 'hard', rationale: 'cycle probe'
    });
    const P = pkgWith(b);
    expect(() => E.evaluateEstablishment('stage:rmu_sup_s1', [], P, null))
      .toThrow(/dependency cycle through holder establishment/);
    // Malformed content is not the athlete failing to satisfy something.
    let threw = false;
    try { E.isHolderEstablished('stage:rmu_sup_s1', [], P, null); } catch (e) { threw = true; }
    expect(threw).toBe(true);
    // The validator rejects the same content at authoring time.
    const rep = V.validate({ ...CONTENT, bundles: [b] });
    expect(rep.errors.some((e) => e.rule === 'V12')).toBe(true);
  });

  test('63 memoisation changes speed, never the answer', () => {
    const P = chain(['prescription', 'unlocking']);
    const ledger = [rto(25)];
    const fresh = (h, side) => E.evaluateEstablishment(h, ledger, P, side);          // own memo each call
    const shared = { done: {}, stack: {} };
    const memoised = (h, side) => E.evaluateEstablishment(h, ledger, P, side, null, shared);
    [A, B, C].forEach((h) => {
      const a = fresh(h, null), m = memoised(h, null);
      expect(JSON.stringify(m), h).toBe(JSON.stringify(a));
    });
    // Asking the same holder twice through one memo gives the identical object.
    expect(memoised(B, null)).toBe(memoised(B, null));
    // A whole unmetDependencies sweep agrees with the one-at-a-time answers.
    const sweep = E.unmetDependencies(ledger, P).map((u) => u.dependencyId + '|' + u.side).sort();
    const byHand = [];
    P.contentBundle.dependencies.forEach((d) => {
      E.dependencySides(d).forEach((s) => {
        if (!E.evaluateDependency(d.id, ledger, P, s).met) byHand.push(d.id + '|' + s);
      });
    });
    expect(sweep).toEqual(byHand.sort());
  });

  test('64 the compatibility aliases still answer the LOCAL question, unchanged', () => {
    const P = chain(['prescription', 'unlocking']);
    const ledger = [rto(25)];
    // B is demonstrated but not established. The aliases must report the
    // demonstration, exactly as they did before the split — anything else would
    // change their meaning underneath existing callers.
    expect(E.isHolderSatisfied(B, ledger, P, null)).toBe(true);
    expect(E.evaluateHolder(B, ledger, P, null).status).toBe('satisfied');
    expect(E.isHolderEstablished(B, ledger, P, null)).toBe(false);
    // And they are the same functions as the explicitly named ones.
    expect(E.isHolderSatisfied).toBe(E.isRequirementSatisfied);
    expect(E.evaluateHolder).toBe(E.evaluateRequirement);
  });
});

// ── bundle 1's own unlocking facet, which was authored and inert ──────────
test.describe('P6a.1 bundle 1 audit', () => {
  test('65 the two authored unlocking Dependencies now actually gate establishment', () => {
    // Both were authored with constrains [prescription, unlocking] and, before
    // this change, the unlocking facet did nothing at all. Content is unmodified.
    const authored = BUNDLE.dependencies.filter((d) => d.constrains.indexOf('unlocking') >= 0);
    expect(authored.map((d) => d.id).sort())
      .toEqual(['dep_ring_dip_needs_ring_support', 'dep_transition_needs_rto']);

    // dep_transition_needs_rto: stage:rmu_trans_s3 requires stage:rmu_sup_s2.
    // A full transition demonstrated with no ring support behind it.
    const transOnly = [obs('ring_transition', { reps: 1, catch_quality: 'controlled' }, { seq: 1 })];
    expect(E.isRequirementSatisfied('stage:rmu_trans_s3', transOnly, PKG, null)).toBe(true);
    const trans = E.evaluateEstablishment('stage:rmu_trans_s3', transOnly, PKG, null);
    expect(trans.established).toBe(false);
    expect(trans.availability).toBe('blocked');
    expect(trans.blockedBy.map((b) => b.dependencyId)).toEqual(['dep_transition_needs_rto']);
    // Add the ring support it requires, and it establishes.
    const withSupport = transOnly.concat([obs('rto_support', { seconds: 25 }, { seq: 2 })]);
    expect(E.isHolderEstablished('stage:rmu_trans_s3', withSupport, PKG, null)).toBe(true);

    // dep_ring_dip_needs_ring_support: stage:rmu_dip_s2 requires stage:rmu_sup_s1.
    const dipsOnly = [obs('ring_dip', { reps: 6 }, { seq: 1 })];
    expect(E.isRequirementSatisfied('stage:rmu_dip_s2', dipsOnly, PKG, null)).toBe(true);
    expect(E.isHolderEstablished('stage:rmu_dip_s2', dipsOnly, PKG, null)).toBe(false);
    const withRings = dipsOnly.concat([obs('ring_support', { seconds: 25 }, { seq: 2 })]);
    expect(E.isHolderEstablished('stage:rmu_dip_s2', withRings, PKG, null)).toBe(true);
  });

  test('66 the soft prescription-only Dependencies still block nothing', () => {
    // Three of bundle 1's five constrain prescription alone, so they shape what
    // is programmed and never gate an unlock.
    const prescriptionOnly = BUNDLE.dependencies
      .filter((d) => d.constrains.length === 1 && d.constrains[0] === 'prescription');
    expect(prescriptionOnly.map((d) => d.id).sort()).toEqual(
      ['dep_pistol_needs_ankle', 'dep_pistol_needs_deep_squat', 'dep_rmu_needs_false_grip']);
    // The Ring Muscle-Up terminal, demonstrated with no false grip behind it,
    // is established — dep_rmu_needs_false_grip is prescription-only and soft.
    const mu = [obs('rmu_attempt', { reps: 1, kip: false, execution: 'controlled' }, { seq: 1 })];
    expect(E.isRequirementSatisfied('goalTerminal:ring_muscle_up', mu, PKG, null)).toBe(true);
    expect(E.isHolderEstablished('goalTerminal:ring_muscle_up', mu, PKG, null)).toBe(true);
    expect(E.evaluateEstablishment('goalTerminal:ring_muscle_up', mu, PKG, null).availability)
      .toBe('achieved');
  });

  test('67 no bundle 1 dependency verdict changed, so nothing P3 records changes', () => {
    // Bundle 1 contains no chain: no dependency requires a holder that is itself
    // a subject. Establishment therefore agrees with local satisfaction for every
    // authored dependency, and unmetDependencies — what P3 writes onto an
    // observation — is byte-identical to what it was before the split.
    const subjects = BUNDLE.dependencies.map((d) => E.holderKeyOf(d.subject));
    BUNDLE.dependencies.forEach((d) => {
      expect(subjects, d.id + ' requires a holder that is itself a subject')
        .not.toContain(E.holderKeyOf(d.requires));
    });
    const ledgers = [
      [],
      [obs('rto_support', { seconds: 25 }, { seq: 1 })],
      [obs('fg_hang', { seconds: 35 }, { seq: 1 }), obs('ring_support', { seconds: 25 }, { seq: 2 })],
      [obs('knee_wall', { cm: 12 }, { seq: 1, side: 'left' })]
    ];
    ledgers.forEach((ledger, i) => {
      BUNDLE.dependencies.forEach((d) => {
        E.dependencySides(d).forEach((s) => {
          const viaEstablishment = E.evaluateDependency(d.id, ledger, PKG, s).met;
          const viaLocal = E.isRequirementSatisfied(d.requires, ledger, PKG, s);
          expect(viaEstablishment, 'ledger ' + i + ' / ' + d.id + '|' + s).toBe(viaLocal);
        });
      });
    });
  });
});

// ── V12, confirmed as the authored-content cycle guard ───────────────────
test.describe('P6a.1 validator cycle guard', () => {
  function withDeps(extra) {
    const b = JSON.parse(JSON.stringify(BUNDLE));
    b.dependencies = b.dependencies.concat(extra);
    return V.validate({ ...CONTENT, bundles: [b] });
  }
  const link = (id, subj, req) => ({
    id, subject: { kind: 'stage', progressionId: 'rmu_ring_support', stageId: subj },
    requires: { kind: 'stage', progressionId: 'rmu_ring_support', stageId: req },
    sideRule: 'any', constrains: ['unlocking'], severity: 'hard', rationale: 'probe'
  });

  test('68 V12 rejects a self-cycle, a two-node cycle and a three-node cycle', () => {
    const self = withDeps([link('c0', 'rmu_sup_s1', 'rmu_sup_s1')]);
    expect(self.errors.filter((e) => e.rule === 'V12').length).toBeGreaterThan(0);

    const two = withDeps([link('c1', 'rmu_sup_s1', 'rmu_sup_s2'), link('c2', 'rmu_sup_s2', 'rmu_sup_s1')]);
    expect(two.errors.filter((e) => e.rule === 'V12').length).toBeGreaterThan(0);

    const three = withDeps([
      { ...link('c3', 'rmu_sup_s1', 'rmu_dip_s1'), requires: { kind: 'stage', progressionId: 'rmu_dip_press', stageId: 'rmu_dip_s1' } },
      { ...link('c4', 'rmu_sup_s1', 'rmu_sup_s2'), subject: { kind: 'stage', progressionId: 'rmu_dip_press', stageId: 'rmu_dip_s1' }, requires: { kind: 'stage', progressionId: 'rmu_dip_press', stageId: 'rmu_dip_s2' } },
      { ...link('c5', 'rmu_sup_s1', 'rmu_sup_s1'), subject: { kind: 'stage', progressionId: 'rmu_dip_press', stageId: 'rmu_dip_s2' }, requires: { kind: 'stage', progressionId: 'rmu_ring_support', stageId: 'rmu_sup_s1' } }
    ]);
    const cyc = three.errors.filter((e) => e.rule === 'V12');
    expect(cyc.length).toBeGreaterThan(0);
    expect(cyc[0].message).toMatch(/dependency cycle/);
  });

  test('69 V12 accepts an ordinary acyclic Dependency chain', () => {
    // The very shape P6a.1 makes meaningful must not be rejected.
    const ok = withDeps([{
      id: 'dep_support_needs_false_grip',
      subject: { kind: 'stage', progressionId: 'rmu_ring_support', stageId: 'rmu_sup_s2' },
      requires: { kind: 'progression', progressionId: 'rmu_false_grip' },
      sideRule: 'any', constrains: ['prescription', 'unlocking'], severity: 'hard',
      rationale: 'A chain: false grip -> ring support S2 -> transition S3.'
    }]);
    expect(ok.errors.filter((e) => e.rule === 'V12')).toEqual([]);
  });
});
