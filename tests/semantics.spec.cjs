/*
 * P4 — behaviour-preservation harness (Implementation Plan §15).
 *
 * The evaluator does not exist yet. What ships here is the thing the evaluator
 * will be built against:
 *
 *   · 17 named cases, each a ledger plus the verdicts semantics 1 must produce;
 *   · a hand-computed reference table in a different notation (reference.cjs),
 *     cross-checked against every fixture, so neither half can be quietly
 *     edited into agreement with the other;
 *   · a consistency checker that re-derives, from the bundle and the semantics-1
 *     policy values alone, WHICH observations may be cited for a criterion and
 *     which must be excluded and why — so "expected" cannot assert a verdict the
 *     content and the policies do not support.
 *
 * The checker is a fixture checker, not the evaluator. It decides admissibility
 * and condition-meeting for a single observation, which is exactly what
 * criterionComposition, missingAttribute, sideAggregation, claimedEligibility,
 * claimedAtGoalTerminal and dependencyInvalidEvidence pin down. It deliberately
 * does not compute stage selection, limiters or expression combination from the
 * ledger; for those it checks the fixture's own declarations against each other.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const V = require(path.join(REPO, 'tools', 'validate-content.cjs'));
const REF = require(path.join(__dirname, 'semantics', 'reference.cjs'));

const CONTENT = V.loadContentDir(path.join(REPO, 'content'));
const POLICIES = CONTENT.semantics[0].policies;
const FIXTURE_DIR = path.join(__dirname, 'semantics', 'fixtures');
const BUNDLE_DIR = path.join(__dirname, 'semantics', 'bundles');

const NAMED_CASES = [
  'req-allof-two-observations', 'req-anyof-nearest', 'req-nested-depth-2',
  'criterion-one-observation', 'claimed-provisional', 'claimed-refused-hard-dependency',
  'claimed-refused-goal-terminal', 'demonstrated-supersedes-claimed', 'dependency-unmet-excluded',
  'side-each-independent', 'side-combined-cannot-satisfy-each', 'missing-attribute',
  'stage-lowest-unsatisfied', 'freshness-none', 'regression-none',
  'supersession-best-applicable', 'unknown-occurredAt-not-recent'
];

const FIXTURES = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).sort()
  .map((f) => Object.assign(JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8')), { _file: f }));

const PROVENANCE = ['demonstrated', 'claimed'];
const SOURCES = ['in_session', 'onboarding_claim', 'legacy_migration', 'ad_hoc'];
const SIDES = [null, 'left', 'right', 'both'];
const EXCLUSION_REASON = /^(dependency_unmet\([a-z0-9_]+\)|claimed_not_eligible|missing_attribute\([a-z0-9_]+\)|wrong_side|stale\([a-z0-9_]+\))$/;
const DEP_REASON = [null, 'no_evidence', 'claimed_not_eligible'];

function resolveBundle(ref) {
  if (ref === 'bundle-1') return CONTENT.bundles[0];
  const file = path.join(BUNDLE_DIR, ref + '.json');
  if (!fs.existsSync(file)) throw new Error('fixture names an unknown bundle: ' + ref);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ---- a small read model over a bundle ------------------------------------
function model(bundle) {
  const m = {
    bundle,
    attributes: {}, exercises: {}, criteria: {}, progressions: {}, goals: {}, dependencies: {},
    stages: {},                 // stageId -> { stage, progression }
    holdersOfCriterion: {},     // criterionId -> [holderKey]
    holderRequirement: {},      // holderKey -> requirement
    linksByHolder: {}
  };
  (bundle.attributes || []).forEach((a) => (m.attributes[a.id] = a));
  (bundle.exercises || []).forEach((e) => (m.exercises[e.id] = e));
  (bundle.criteria || []).forEach((c) => (m.criteria[c.id] = c));
  (bundle.goals || []).forEach((g) => (m.goals[g.id] = g));
  (bundle.dependencies || []).forEach((d) => (m.dependencies[d.id] = d));
  (bundle.progressions || []).forEach((p) => {
    m.progressions[p.id] = p;
    (p.stages || []).forEach((s) => (m.stages[s.id] = { stage: s, progression: p }));
  });
  const add = (key, requirement) => {
    m.holderRequirement[key] = requirement;
    V.leafCriteria(requirement).forEach((cid) => {
      (m.holdersOfCriterion[cid] = m.holdersOfCriterion[cid] || []).push(key);
    });
  };
  (bundle.progressions || []).forEach((p) => {
    if (p.form === 'DIRECT') add('progression:' + p.id, p.requirement);
    (p.stages || []).forEach((s) => add('stage:' + s.id, s.requirement));
  });
  (bundle.goals || []).forEach((g) => add('goalTerminal:' + g.id, g.terminalRequirement));
  (bundle.exerciseLinks || []).forEach((l) => {
    const k = l.target.kind === 'progression' ? 'progression:' + l.target.progressionId
      : l.target.kind === 'stage' ? 'stage:' + l.target.stageId
        : 'goalTerminal:' + l.target.goalId;
    (m.linksByHolder[k] = m.linksByHolder[k] || []).push(l);
  });
  return m;
}

const gradeRank = (m, attrId, value) => (m.attributes[attrId].scale || []).indexOf(value);

function conditionHolds(m, cond, value) {
  const attr = m.attributes[cond.attribute];
  if (attr.type === 'grade') {
    const got = gradeRank(m, cond.attribute, value);
    const want = gradeRank(m, cond.attribute, cond.value);
    if (got < 0 || want < 0) return false;
    switch (cond.op) {
      case 'gte': return got >= want; case 'gt': return got > want;
      case 'lte': return got <= want; case 'lt': return got < want;
      case 'eq': return got === want; case 'neq': return got !== want;
      default: return false;
    }
  }
  if (attr.type === 'flag') {
    return cond.op === 'eq' ? value === cond.value : cond.op === 'neq' ? value !== cond.value : false;
  }
  switch (cond.op) {
    case 'gte': return value >= cond.value; case 'gt': return value > cond.value;
    case 'lte': return value <= cond.value; case 'lt': return value < cond.value;
    case 'eq': return value === cond.value; case 'neq': return value !== cond.value;
    default: return false;
  }
}

// Which dependency, if any, invalidates this row as evidence for this holder on
// this side. dependencyInvalidEvidence: exclude — and only a Dependency that
// constrains evidence_validity can do it.
function invalidatingDependency(m, obs, holderKey, side) {
  const unmet = (obs.context && obs.context.unmetDependencies) || [];
  for (const depId of unmet) {
    const dep = m.dependencies[depId];
    if (!dep) continue;
    if ((dep.constrains || []).indexOf('evidence_validity') < 0) continue;
    const subject = dep.subject.kind === 'progression' ? 'progression:' + dep.subject.progressionId
      : dep.subject.kind === 'stage' ? 'stage:' + dep.subject.stageId
        : 'goalTerminal:' + dep.subject.goalId;
    if (subject !== holderKey) continue;
    if (dep.sideRule === 'mirror' && side !== 'combined' && obs.side !== side) continue;
    return depId;
  }
  return null;
}

/*
 * The verdict a single observation earns towards one criterion on one side.
 *   'n/a'        not evidence about this criterion at all
 *   'meets'      admissible and every condition holds
 *   'short'      admissible and some condition does not hold
 *   or an exclusion reason string
 */
function rowVerdict(m, obs, criterion, side, holders) {
  const applicableHolders = holders.filter((hk) =>
    (m.linksByHolder[hk] || []).some((l) =>
      l.exerciseId === obs.exerciseId && (l.relation === 'train' || l.relation === 'assess')));
  if (!applicableHolders.length) return { v: 'n/a' };

  const ex = m.exercises[obs.exerciseId];
  const produces = ex.producesAttributes || [];
  const needed = (criterion.conditions || []).map((c) => c.attribute);
  if (!needed.every((a) => produces.indexOf(a) >= 0)) return { v: 'n/a' };

  if (criterion.sideScope === 'each') {
    // sideAggregation: combined_cannot_satisfy_each
    if (obs.side !== side) return { v: 'wrong_side' };
  } else if (obs.side === 'left' || obs.side === 'right') {
    // A one-sided row is not a bilateral measurement.
    return { v: 'wrong_side' };
  }

  // missingAttribute: cannot_satisfy — an absent value is an unanswered question.
  const missing = needed.filter((a) => !(obs.attributes && a in obs.attributes));
  if (missing.length) return { v: 'missing_attribute(' + missing[0] + ')' };

  const terminalHolders = applicableHolders.filter((hk) => hk.indexOf('goalTerminal:') === 0);
  if (obs.provenance === 'claimed') {
    if (POLICIES.claimedEligibility === 'none') return { v: 'claimed_not_eligible' };
    if (terminalHolders.length && POLICIES.claimedAtGoalTerminal === 'refuse') return { v: 'claimed_not_eligible' };
  }

  for (const hk of applicableHolders) {
    const depId = invalidatingDependency(m, obs, hk, side);
    if (depId) return { v: 'dependency_unmet(' + depId + ')' };
  }

  const holds = (criterion.conditions || []).every((c) => conditionHolds(m, c, obs.attributes[c.attribute]));
  return { v: holds ? 'meets' : 'short' };
}

function combineStrict(m, expr, statusOf) {
  if (typeof expr.criterion === 'string') return statusOf(expr.criterion);
  const op = expr.allOf ? 'allOf' : 'anyOf';
  const kids = expr[op].map((k) => combineStrict(m, k, statusOf));
  if (op === 'allOf') {
    if (kids.every((s) => s === 'satisfied')) return 'satisfied';
    if (kids.every((s) => s === 'satisfied' || s === 'provisional')) return 'provisional';
    return 'unsatisfied';
  }
  if (kids.some((s) => s === 'satisfied')) return 'satisfied';
  if (kids.some((s) => s === 'provisional')) return 'provisional';
  return 'unsatisfied';
}

// Each fixture yields one scenario per ledger it declares.
function scenarios(fx) {
  return [{ index: 0, note: 'primary', ledger: fx.ledger, expected: fx.expected }].concat(
    (fx.alternates || []).map((a, i) => ({ index: i + 1, note: a.note, ledger: a.ledger, expected: a.expected })));
}

// =========================================================================

test.describe('P4 semantics harness — the fixture set', () => {
  test('01 exactly the 17 named §15 cases are present, one file each', () => {
    expect(FIXTURES.map((f) => f.name).sort()).toEqual(NAMED_CASES.slice().sort());
    FIXTURES.forEach((f) => expect(f._file).toBe(f.name + '.json'));
  });

  test('02 every fixture names a published semantics version', () => {
    const published = new Set(CONTENT.semantics.map((s) => s.version));
    FIXTURES.forEach((f) => {
      expect(f.semantics.length, f.name).toBeGreaterThan(0);
      f.semantics.forEach((v) => expect(published.has(v), f.name + ' -> semantics ' + v).toBe(true));
    });
  });

  test('03 semantics 1 holds freshness and regression at none, which is what these fixtures assert', () => {
    expect(POLICIES.freshness).toBe('none');
    expect(POLICIES.regression).toBe('none');
    const text = JSON.stringify(FIXTURES);
    expect(text).not.toContain('stale(');
  });

  test('04 the validator loads the fixtures and reports its evaluative half as pending, not passing', () => {
    const rep = V.validate({
      ...CONTENT,
      continuity: V.loadContinuity(REPO),
      semanticsFixtures: V.loadSemanticsFixtures(FIXTURE_DIR),
      evaluator: null
    });
    expect(rep.errors).toEqual([]);
    const v18 = rep.notes.filter((n) => n.rule === 'V18').map((n) => n.message).join(' ');
    expect(v18).toContain('PENDING');
    expect(v18).toContain('17 behaviour-preservation fixtures');
  });

  test('05 the evaluator seam is unregistered, so interpret() serves the hand-computed table', () => {
    expect(REF.evaluatorRegistered()).toBe(false);
    const got = REF.interpret(FIXTURES.find((f) => f.name === 'freshness-none'), 1, 0);
    expect(got.evaluations['fg_hang_30|combined'].status).toBe('satisfied');
  });

  test('06 a registered evaluator is the thing under test, and a wrong one fails', () => {
    const fx = FIXTURES.find((f) => f.name === 'freshness-none');
    REF.registerEvaluator(() => ({ evaluations: { 'fg_hang_30|combined|ctx_1': { status: 'unsatisfied', satisfiedBy: [], excluded: [] } } }));
    try {
      expect(REF.evaluatorRegistered()).toBe(true);
      expect(REF.interpret(fx, 1, 0).evaluations['fg_hang_30|combined'].status).toBe('unsatisfied');
      expect(REF.interpret(fx, 1, 0)).not.toEqual(REF.projectExpected(fx.expected));
    } finally {
      REF.registerEvaluator(null);
    }
    expect(REF.evaluatorRegistered()).toBe(false);
  });

  test('07 the reference table covers every case and every scenario, and nothing else', () => {
    expect(Object.keys(REF.HAND_COMPUTED).sort()).toEqual(NAMED_CASES.slice().sort());
    FIXTURES.forEach((f) => {
      expect(REF.HAND_COMPUTED[f.name].length, f.name + ' scenario count').toBe(scenarios(f).length);
    });
  });
});

for (const fx of FIXTURES) {
  test.describe(`P4 semantics harness — ${fx.name}`, () => {
    const bundle = resolveBundle(fx.bundle);
    const m = model(bundle);

    test(`10 ${fx.name} — the case states what it proves`, () => {
      expect(fx.description.length).toBeGreaterThan(40);
      expect(fx.commitments).toBeTruthy();
      expect(Array.isArray(fx.commitments.athleteGoals)).toBe(true);
      scenarios(fx).forEach((s) => {
        expect(s.ledger.length, s.note).toBeGreaterThan(0);
        expect(s.expected, s.note).toBeTruthy();
      });
    });

    test(`11 ${fx.name} — every observation is a well-formed PerformanceObservation`, () => {
      scenarios(fx).forEach((s) => {
        let last = 0;
        s.ledger.forEach((o) => {
          const at = fx.name + ' / ' + s.note + ' / seq ' + o.seq;
          expect(o.seq, at).toBeGreaterThan(last);
          last = o.seq;
          expect(o.occurredAt === 'unknown' || !Number.isNaN(Date.parse(o.occurredAt)), at).toBe(true);
          expect(Number.isNaN(Date.parse(o.recordedAt)), at).toBe(false);
          expect(m.exercises[o.exerciseId], at + ' exercise ' + o.exerciseId).toBeTruthy();
          expect(SIDES, at).toContain(o.side);
          expect(PROVENANCE, at).toContain(o.provenance);
          expect(SOURCES, at).toContain(o.provenanceSource);
          // context is stored because it is unrecoverable later; unmetDependencies
          // is the one field the D5 lock makes mandatory.
          expect(o.context, at).toBeTruthy();
          expect(Array.isArray(o.context.unmetDependencies), at + ' unmetDependencies').toBe(true);
          o.context.unmetDependencies.forEach((d) => expect(m.dependencies[d], at + ' dep ' + d).toBeTruthy());
          expect(o.context.contextId, at).toBe('ctx_1');
          // an observation never names a criterion or carries a verdict
          expect(Object.keys(o)).not.toContain('criterionId');
          expect(Object.keys(o)).not.toContain('status');
          const produced = m.exercises[o.exerciseId].producesAttributes || [];
          Object.keys(o.attributes).forEach((a) => {
            expect(produced, at + ' attribute ' + a).toContain(a);
            if (m.attributes[a].type === 'grade') {
              expect(m.attributes[a].scale, at + ' grade ' + a).toContain(o.attributes[a]);
            }
          });
          if (o.provenance === 'claimed') expect(o.sourceWorkoutItem, at).toBeNull();
        });
      });
    });

    test(`12 ${fx.name} — every cited and excluded observation is consistent with semantics 1`, () => {
      scenarios(fx).forEach((s) => {
        const bySeq = {};
        s.ledger.forEach((o) => (bySeq[o.seq] = o));
        Object.keys(s.expected.evaluations || {}).forEach((key) => {
          const parts = key.split('|');
          const [cid, side, ctxId] = parts;
          const at = fx.name + ' / ' + s.note + ' / ' + key;
          expect(parts.length, at).toBe(3);
          expect(ctxId, at).toBe('ctx_1');
          const c = m.criteria[cid];
          expect(c, at + ' unknown criterion').toBeTruthy();
          expect(side, at).toBe(c.sideScope === 'each' ? side : 'combined');
          if (c.sideScope === 'each') expect(['left', 'right'], at).toContain(side);

          const e = s.expected.evaluations[key];
          expect(REF.STATUSES, at).toContain(e.status);
          const holders = m.holdersOfCriterion[cid] || [];
          expect(holders.length, at + ' criterion belongs to no holder').toBeGreaterThan(0);

          const cited = (e.satisfiedBy || []).slice().sort();
          const excluded = (e.excluded || []).slice();
          excluded.forEach((x) => {
            expect(EXCLUSION_REASON.test(x.reason), at + ' reason "' + x.reason + '"').toBe(true);
            expect(bySeq[x.seq], at + ' excluded seq ' + x.seq).toBeTruthy();
          });
          cited.concat(excluded.map((x) => x.seq)).forEach((sq) =>
            expect(bySeq[sq], at + ' cites seq ' + sq + ', which is not in the ledger').toBeTruthy());
          expect(cited.filter((sq) => excluded.some((x) => x.seq === sq)), at + ' a row both cited and excluded').toEqual([]);

          // Re-derive every row's standing from the bundle and the policies.
          const expectCited = [], expectExcluded = [];
          s.ledger.forEach((o) => {
            const v = rowVerdict(m, o, c, side, holders).v;
            if (v === 'meets') expectCited.push(o.seq);
            else if (v !== 'n/a' && v !== 'short') expectExcluded.push({ seq: o.seq, reason: v });
          });
          expect(cited, at + ' satisfiedBy').toEqual(expectCited.slice().sort());
          expect(excluded.map((x) => x.seq + ':' + x.reason).sort(), at + ' excluded')
            .toEqual(expectExcluded.map((x) => x.seq + ':' + x.reason).sort());

          // provenance decides satisfied vs provisional; it never decides membership.
          const citedRows = cited.map((sq) => bySeq[sq]);
          if (e.status === 'unsatisfied') {
            expect(cited, at + ' unsatisfied with citations').toEqual([]);
          } else {
            expect(cited.length, at + ' ' + e.status + ' with nothing cited').toBeGreaterThan(0);
            const demonstrated = citedRows.some((o) => o.provenance === 'demonstrated');
            expect(demonstrated, at + ' ' + e.status + ' vs provenance of cited rows')
              .toBe(e.status === 'satisfied');
          }

          // A shortfall is computed on the primary attribute, so when it is
          // written in the "short by N unit" form it must be exactly the gap
          // between the best observation and that attribute's target.
          if (typeof e.shortfall === 'string') {
            const sm = /^short by (\d+) (\w+)$/.exec(e.shortfall);
            if (sm) {
              expect(e.bestObservation, at + ' a numeric shortfall needs a bestObservation').toBeTruthy();
              const cond = (c.conditions || []).filter((x) => x.attribute === c.primaryAttribute)[0];
              expect(m.attributes[c.primaryAttribute].type, at + ' numeric shortfall on a non-quantity').toBe('quantity');
              expect(Number(sm[1]), at + ' shortfall size').toBe(cond.value - e.bestObservation.value);
            }
          }

          // bestObservation, when given, is a citation — a seq and its value on
          // the primary attribute. Under demonstrated_supersedes a demonstrated
          // row is reported even when a claim reads higher.
          if (e.bestObservation) {
            const b = bySeq[e.bestObservation.seq];
            expect(b, at + ' bestObservation seq').toBeTruthy();
            expect(e.bestObservation.attribute, at).toBe(c.primaryAttribute);
            expect(b.attributes[c.primaryAttribute], at + ' bestObservation value').toEqual(e.bestObservation.value);
            if (b.provenance === 'claimed' && POLICIES.provenancePrecedence === 'demonstrated_supersedes') {
              const demoAlternative = citedRows.some((o) => o.provenance === 'demonstrated');
              expect(demoAlternative, at + ' a claim is reported while a demonstrated row was cited').toBe(false);
            }
          }
        });
      });
    });

    test(`13 ${fx.name} — holder statuses follow expressionStatusCombination: strict`, () => {
      expect(POLICIES.expressionStatusCombination).toBe('strict');
      scenarios(fx).forEach((s) => {
        Object.keys(s.expected.holders || {}).forEach((key) => {
          const [hk, side] = key.split('|');
          const at = fx.name + ' / ' + s.note + ' / ' + key;
          const requirement = m.holderRequirement[hk];
          expect(requirement, at + ' unknown holder').toBeTruthy();
          const statusOf = (cid) => {
            const k = cid + '|' + side + '|ctx_1';
            expect(s.expected.evaluations[k], at + ' needs evaluation ' + k).toBeTruthy();
            return s.expected.evaluations[k].status;
          };
          expect(combineStrict(m, requirement, statusOf), at).toBe(s.expected.holders[key].status);
        });
      });
    });

    test(`14 ${fx.name} — currentStage is the lowest unsatisfied stage, limiters stay inside the case's scope`, () => {
      expect(POLICIES.stageSelection).toBe('lowest_unsatisfied');
      scenarios(fx).forEach((s) => {
        Object.keys(s.expected.currentStage || {}).forEach((key) => {
          const [pid, side] = key.split('|');
          const at = fx.name + ' / ' + s.note + ' / ' + key;
          const p = m.progressions[pid];
          expect(p, at + ' unknown progression').toBeTruthy();
          expect(p.form, at).toBe('STAGED');
          const ordered = p.stages.slice().sort((a, b) => a.order - b.order);
          const statuses = ordered.map((st) => {
            const hk = 'stage:' + st.id + '|' + side;
            expect(s.expected.holders[hk], at + ' needs holder ' + hk).toBeTruthy();
            return s.expected.holders[hk].status;
          });
          const i = statuses.findIndex((x) => x !== 'satisfied');
          expect(i < 0 ? null : ordered[i].id, at).toBe(s.expected.currentStage[key]);
        });

        Object.keys(s.expected.limiters || {}).forEach((key) => {
          const [gid, side] = key.split('|');
          const at = fx.name + ' / ' + s.note + ' / limiter ' + key;
          expect(m.goals[gid], at).toBeTruthy();
          const scope = fx.scopeProgressions || [];
          expect(scope.length, at + ' a limiter assertion needs scopeProgressions').toBeGreaterThan(0);
          const incomplete = scope.filter((pid) => s.expected.currentStage[pid + '|' + side] != null);
          const declared = s.expected.limiters[key];
          if (declared == null) expect(incomplete, at + ' no limiter declared but progressions are incomplete').toEqual([]);
          else {
            expect(scope, at).toContain(declared);
            expect(incomplete, at).toContain(declared);
          }
        });
      });
    });

    test(`15 ${fx.name} — dependency verdicts name a real dependency and a known reason`, () => {
      scenarios(fx).forEach((s) => {
        Object.keys(s.expected.dependencies || {}).forEach((key) => {
          const [depId, side] = key.split('|');
          const at = fx.name + ' / ' + s.note + ' / ' + key;
          const dep = m.dependencies[depId];
          expect(dep, at + ' unknown dependency').toBeTruthy();
          const d = s.expected.dependencies[key];
          expect(DEP_REASON, at + ' reason').toContain(d.reason === undefined ? null : d.reason);
          expect(d.met === true || d.met === false, at + ' met').toBe(true);
          if (d.met) expect(d.blocks || [], at + ' a met dependency blocks nothing').toEqual([]);
          (d.blocks || []).forEach((hk) => expect(m.holderRequirement[hk], at + ' blocks ' + hk).toBeTruthy());
          // claimedAtHardDependency: refuse — a claim can never meet a hard dependency.
          if (dep.severity === 'hard' && d.met) {
            const required = V.leafCriteria(
              m.holderRequirement[dep.requires.kind === 'stage' ? 'stage:' + dep.requires.stageId
                : dep.requires.kind === 'progression' ? 'progression:' + dep.requires.progressionId
                  : 'goalTerminal:' + dep.requires.goalId]);
            required.forEach((cid) => {
              const ev = s.expected.evaluations[cid + '|' + (side === 'combined' ? 'combined' : side) + '|ctx_1'];
              if (ev) expect(ev.status, at + ' met hard dependency on a ' + ev.status + ' criterion').toBe('satisfied');
            });
          }
        });
      });
    });

    test(`16 ${fx.name} — the hand-computed reference agrees with the fixture, scenario by scenario`, () => {
      scenarios(fx).forEach((s) => {
        fx.semantics.forEach((version) => {
          const reference = REF.interpret(fx, version, s.index);
          const declared = REF.projectExpected(s.expected);
          expect(reference, fx.name + ' / ' + s.note + ' / semantics ' + version).toEqual(declared);
        });
      });
    });
  });
}
