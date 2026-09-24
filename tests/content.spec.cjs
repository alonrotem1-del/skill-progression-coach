/*
 * P4 — content validator tests.
 *
 *   1. the shipped content is structurally sound (zero errors);
 *   2. the exercise-id continuity contract holds against the running app;
 *   3. every validator rule V1..V18 is proved by a red fixture that fails it
 *      FOR THE INTENDED REASON, not merely somewhere.
 *
 * A fixture is a small declarative mutation of the real content set rather than
 * a hand-written broken bundle, so it cannot drift away from the content it is
 * supposed to be a counter-example to, and the sin it commits is the only
 * difference from a green run.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const V = require(path.join(REPO, 'tools', 'validate-content.cjs'));

const CONTENT = V.loadContentDir(path.join(REPO, 'content'));
const CONTINUITY = V.loadContinuity(REPO);
const FIXTURE_DIR = path.join(__dirname, 'content', 'fixtures');
const FIXTURES = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8')));

const ALL_RULES = Array.from({ length: 20 }, (_, i) => 'V' + (i + 1));

const clone = (x) => JSON.parse(JSON.stringify(x));

// ---- path resolution -----------------------------------------------------
// "bundle.progressions[#rmu_pull_strength].stages[1].order"
//   [#id]            array member by id or key
//   [@field=value]   first array member whose field equals value, and
//                    [@a=1&b=2] for more than one — exercise links have no id
//   [n]              by position
function steps(p) {
  const out = [];
  p.split('.').forEach((part) => {
    const m = /^([A-Za-z0-9_]+)((\[[^\]]+\])*)$/.exec(part);
    if (!m) throw new Error('unparsable fixture path segment: ' + part);
    out.push({ key: m[1] });
    (m[2] || '').replace(/\[([^\]]+)\]/g, (_, sel) => { out.push({ sel }); return ''; });
  });
  return out;
}

function index(container, sel) {
  if (!Array.isArray(container)) throw new Error('selector [' + sel + '] on a non-array');
  if (sel[0] === '#') {
    const id = sel.slice(1);
    const i = container.findIndex((x) => x && (x.id === id || x.key === id));
    if (i < 0) throw new Error('no member with id/key "' + id + '"');
    return i;
  }
  if (sel[0] === '@') {
    const want = sel.slice(1).split('&').map((kv) => kv.split('='));
    const deep = (o, k) => k.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), o);
    const hits = container.reduce((acc, x, i) => {
      if (want.every(([k, v]) => String(deep(x, k)) === v)) acc.push(i);
      return acc;
    }, []);
    if (!hits.length) throw new Error('no member matching [' + sel + ']');
    if (hits.length > 1) throw new Error('selector [' + sel + '] matches ' + hits.length + ' members');
    return hits[0];
  }
  const i = Number(sel);
  if (!Number.isInteger(i) || i < 0 || i >= container.length) throw new Error('index ' + sel + ' out of range');
  return i;
}

function walk(root, p) {
  const st = steps(p);
  let node = root;
  for (let i = 0; i < st.length - 1; i++) {
    const s = st[i];
    node = 'key' in s ? node[s.key] : node[index(node, s.sel)];
    if (node == null) throw new Error('fixture path does not resolve: ' + p);
  }
  const last = st[st.length - 1];
  if ('key' in last) return { parent: node, key: last.key };
  return { parent: node, key: index(node, last.sel) };
}

function applyOps(root, ops) {
  (ops || []).forEach((op) => {
    const { parent, key } = walk(root, op.path);
    if (op.op === 'set') parent[key] = clone(op.value);
    else if (op.op === 'push') {
      if (!Array.isArray(parent[key])) throw new Error('push onto a non-array: ' + op.path);
      parent[key].push(clone(op.value));
    } else if (op.op === 'remove') {
      if (Array.isArray(parent) && typeof key === 'number') parent.splice(key, 1);
      else delete parent[key];
    } else throw new Error('unknown fixture op: ' + op.op);
  });
}

// A fixture's content set: the real one, mutated. When the fixture declares
// `previous`, the real bundle is also published as the preceding version so the
// cross-bundle rules (V9, V10) have something to compare against.
function contentFor(fx) {
  const set = {
    vocabulary: clone(CONTENT.vocabulary),
    semantics: clone(CONTENT.semantics),
    bundles: [clone(CONTENT.bundles[0])],
    contexts: clone(CONTENT.contexts),
    continuity: CONTINUITY,
    semanticsFixtures: null,
    evaluator: null
  };
  if (fx.previous) {
    const prev = clone(CONTENT.bundles[0]);
    applyOps({ bundle: prev, vocabulary: set.vocabulary, semantics: set.semantics, contexts: set.contexts }, fx.previous);
    set.bundles = [prev, set.bundles[0]];
    set.bundles[1].version = (prev.version || 1) + 1;
  }
  const root = {
    bundle: set.bundles[set.bundles.length - 1],
    vocabulary: set.vocabulary,
    semantics: set.semantics,
    contexts: set.contexts
  };
  applyOps(root, fx.ops);
  return set;
}

// =========================================================================

test.describe('P4 content — shipped content', () => {
  test('01 the content directory loads: one bundle, one semantics version, one context', () => {
    expect(CONTENT.bundles.map((b) => b.version)).toEqual([1]);
    expect(CONTENT.semantics.map((s) => s.version)).toEqual([1]);
    expect(CONTENT.contexts.map((c) => c.id)).toEqual(['ctx_1']);
    expect(CONTENT.vocabulary.vocabularyVersion).toBe(1);
  });

  test('02 the validator reports no errors on the shipped content', () => {
    const rep = V.validate({ ...CONTENT, continuity: CONTINUITY });
    expect(rep.errors, JSON.stringify(rep.errors, null, 2)).toEqual([]);
  });

  test('03 ctx_1 pins bundle 1 to semantics 1 and satisfies requiresSemanticsAtLeast', () => {
    const ctx = CONTENT.contexts[0];
    expect(ctx.contentBundleVersion).toBe(1);
    expect(ctx.evaluationSemanticsVersion).toBe(1);
    expect(ctx.evaluationSemanticsVersion).toBeGreaterThanOrEqual(CONTENT.bundles[0].requiresSemanticsAtLeast);
    expect(typeof ctx.mintedAt).toBe('string');
  });

  test('04 semantics 1 sets every vocabulary dimension explicitly, deferred ones included', () => {
    const keys = CONTENT.vocabulary.dimensions.map((d) => d.key);
    const set = Object.keys(CONTENT.semantics[0].policies);
    expect(set.sort()).toEqual(keys.slice().sort());
    expect(CONTENT.semantics[0].policies.freshness).toBe('none');
    expect(CONTENT.semantics[0].policies.regression).toBe('none');
  });

  test('05 every vocabulary dimension declares an allowed behaviour-preserving default', () => {
    CONTENT.vocabulary.dimensions.forEach((d) => {
      expect(d.allowedValues.length, d.key).toBeGreaterThan(0);
      expect(d.allowedValues, d.key).toContain(d.behaviourPreservingDefault);
      expect(d.introducedInVocabulary, d.key).toBe(1);
    });
  });

  test('06 the bundle carries no evaluation rule: no policy, freshness or regression field anywhere', () => {
    const text = JSON.stringify(CONTENT.bundles[0]);
    ['"policies"', '"policy"', '"freshness"', '"regression"', '"supersession"', '"rule"', '"formula"', '"script"']
      .forEach((needle) => expect(text, needle).not.toContain(needle));
  });
});

// ExerciseLink.relation is load-bearing, and these tests are what makes it so
// on the content side. LOCKED: assess is the evidence-eligible relationship,
// train is prescription only, and there is no "harder than" exception — a
// substitution that should count is written as a second assess link.
test.describe('P4 content — exercise link role semantics', () => {
  const B = CONTENT.bundles[0];
  const exById = {}; B.exercises.forEach((e) => (exById[e.id] = e));
  const crById = {}; B.criteria.forEach((c) => (crById[c.id] = c));
  const holderKey = (t) => t.kind === 'stage' ? 'stage:' + t.stageId
    : t.kind === 'progression' ? 'progression:' + t.progressionId : 'goalTerminal:' + t.goalId;

  const holders = {};
  B.progressions.forEach((p) => {
    if (p.form === 'DIRECT') holders['progression:' + p.id] = V.leafCriteria(p.requirement);
    (p.stages || []).forEach((st) => (holders['stage:' + st.id] = V.leafCriteria(st.requirement)));
  });
  B.goals.forEach((g) => (holders['goalTerminal:' + g.id] = V.leafCriteria(g.terminalRequirement)));

  const linksByHolder = {};
  B.exerciseLinks.forEach((l) => {
    (linksByHolder[holderKey(l.target)] = linksByHolder[holderKey(l.target)] || []).push(l);
  });
  const holdersOfCriterion = {};
  Object.keys(holders).forEach((h) => holders[h].forEach((cid) => {
    (holdersOfCriterion[cid] = holdersOfCriterion[cid] || []).push(h);
  }));

  // The single definition of "can this exercise, through this link, satisfy this
  // criterion". Everything below asks it; nothing below has its own opinion.
  function canAssess(link, criterion) {
    if (link.relation !== 'assess') return false;
    const ex = exById[link.exerciseId];
    const produces = ex.producesAttributes || [];
    if (!criterion.conditions.every((cd) => produces.indexOf(cd.attribute) >= 0)) return false;
    return criterion.sideScope === 'each'
      ? (link.sideScope === 'each' && !!ex.unilateral)
      : link.sideScope === 'combined';
  }
  const assessorsOf = (cid) => (holdersOfCriterion[cid] || []).reduce((acc, h) => {
    (linksByHolder[h] || []).forEach((l) => { if (canAssess(l, crById[cid])) acc.push(l.exerciseId); });
    return acc;
  }, []);
  const attributeMatch = (link, criterion) => criterion.conditions
    .every((cd) => (exById[link.exerciseId].producesAttributes || []).indexOf(cd.attribute) >= 0);

  test('15 a train link can never satisfy a criterion, whatever it produces', () => {
    const trains = B.exerciseLinks.filter((l) => l.relation === 'train');
    expect(trains.length, 'the bundle should still prescribe through train links').toBeGreaterThan(0);
    trains.forEach((l) => {
      (holders[holderKey(l.target)] || []).forEach((cid) => {
        expect(canAssess(l, crById[cid]), l.exerciseId + ' train -> ' + cid).toBe(false);
      });
    });
    // And the point of the lock: several of those train links DO produce every
    // attribute their criterion asks for. Under the old reading they were evidence.
    const wouldHaveCounted = trains.filter((l) =>
      (holders[holderKey(l.target)] || []).some((cid) => attributeMatch(l, crById[cid])));
    expect(wouldHaveCounted.map((l) => l.exerciseId).sort()).toEqual(
      ['activehang', 'deadhang', 'lowtrans', 'negmu', 'pbdip', 'transition']);
  });

  test('16 the same exercise satisfies a criterion only where an assess link exists', () => {
    // The weighted pull-up is the authored case: assess on the pull stages,
    // and nothing anywhere else in the bundle.
    expect(assessorsOf('rmu_pull_10')).toContain('weighted_pullup');
    expect(assessorsOf('rmu_pull_5')).toContain('weighted_pullup');
    expect(assessorsOf('rmu_pull_1')).toContain('weighted_pullup');
    expect(assessorsOf('rmu_terminal')).not.toContain('weighted_pullup');
    // Nothing in the bundle carries both roles to the same holder, so no link
    // needs an exception to be readable.
    const seen = {};
    B.exerciseLinks.forEach((l) => {
      const k = l.exerciseId + '@' + holderKey(l.target);
      expect(seen[k], k + ' is linked twice').toBeUndefined();
      seen[k] = l.relation;
    });
  });

  test('17 false-grip training alternatives cannot assess the false grip', () => {
    expect(assessorsOf('fg_hang_30')).toEqual(['fg_hang']);
    ['deadhang', 'activehang'].forEach((id) => {
      const l = B.exerciseLinks.find((x) => x.exerciseId === id && x.target.progressionId === 'rmu_false_grip');
      expect(l, id + ' should still be prescribed for the false grip').toBeTruthy();
      expect(l.relation).toBe('train');
      expect(attributeMatch(l, crById['fg_hang_30']), id + ' does record seconds').toBe(true);
      expect(canAssess(l, crById['fg_hang_30']), id + ' must not assess it').toBe(false);
    });
  });

  test('18 bar transition drills cannot assess a ring transition criterion', () => {
    expect(assessorsOf('trans_lowring_3')).toEqual(['lowring_transition']);
    expect(assessorsOf('trans_banded_3')).toEqual(['banded_ring_transition']);
    expect(assessorsOf('trans_full_1')).toEqual(['ring_transition']);
    ['lowtrans', 'transition', 'negmu'].forEach((id) => {
      B.exerciseLinks.filter((x) => x.exerciseId === id).forEach((l) => expect(l.relation, id).toBe('train'));
    });
  });

  test('19 the heel-elevated pistol cannot assess the pistol terminal', () => {
    expect(assessorsOf('pistol_terminal')).toEqual(['pistol']);
    expect(B.exerciseLinks.some((l) =>
      l.exerciseId === 'pistol_heel' && l.target.kind === 'goalTerminal')).toBe(false);
    // It remains the accommodation for the ankle dependency, which is how the
    // plan reaches it — an accommodation is prescription, never evidence.
    const dep = B.dependencies.find((d) => d.id === 'dep_pistol_needs_ankle');
    expect(dep.accommodation.exerciseId).toBe('pistol_heel');
    // and it assesses its own stage, where it is the movement being measured
    expect(assessorsOf('slstr_heel_3')).toEqual(['pistol_heel']);
  });

  test('20 ring support criteria cannot be assessed by the bar top hold', () => {
    expect(assessorsOf('sup_ring_20')).toEqual(['ring_support']);
    expect(assessorsOf('sup_rto_20')).toEqual(['rto_support']);
    expect(B.exerciseLinks.some((l) => l.exerciseId === 'support')).toBe(false);
    expect(assessorsOf('dip_ring_5')).toEqual(['ring_dip']);
    expect(assessorsOf('exp_c2r_3')).toEqual(['c2r_pullup']);
  });

  test('21 the weighted pull-up assess relationship behaves exactly as authored', () => {
    const links = B.exerciseLinks.filter((l) => l.exerciseId === 'weighted_pullup');
    expect(links.length).toBe(3);
    expect(links.map((l) => l.target.stageId).sort()).toEqual(['rmu_pull_s1', 'rmu_pull_s2', 'rmu_pull_s3']);
    links.forEach((l) => {
      expect(l.relation).toBe('assess');
      expect(l.rank).toBe(2);              // the bodyweight pull-up stays rank 1
      expect(l.sideScope).toBe('combined');
    });
    // It reports added load, which is what makes the substitution safe, and the
    // criteria say nothing about load — "strict" governs the kip, not the weight.
    expect(exById.weighted_pullup.producesAttributes).toContain('kg');
    ['rmu_pull_1', 'rmu_pull_5', 'rmu_pull_10'].forEach((cid) => {
      expect(crById[cid].conditions.map((c) => c.attribute).sort()).toEqual(['kip', 'reps']);
    });
  });

  test('22 every criterion in the bundle has exactly the assess route it should', () => {
    const routes = {};
    B.criteria.forEach((c) => (routes[c.id] = assessorsOf(c.id).sort()));
    Object.keys(routes).forEach((cid) => {
      expect(routes[cid].length, cid + ' has no assess route').toBeGreaterThan(0);
    });
    expect(routes).toEqual({
      rmu_pull_1: ['pullup', 'weighted_pullup'],
      rmu_pull_5: ['pullup', 'weighted_pullup'],
      rmu_pull_10: ['pullup', 'weighted_pullup'],
      fg_hang_30: ['fg_hang'],
      exp_highpull_3: ['fastpull'],
      exp_c2b_3: ['c2b'],
      exp_c2r_3: ['c2r_pullup'],
      sup_ring_20: ['ring_support'],
      sup_rto_20: ['rto_support'],
      trans_lowring_3: ['lowring_transition'],
      trans_banded_3: ['banded_ring_transition'],
      trans_full_1: ['ring_transition'],
      dip_bar_5: ['dip'],
      dip_ring_5: ['ring_dip'],
      rmu_terminal: ['rmu_attempt'],
      slstr_box_5: ['box_pistol'],
      slstr_heel_3: ['pistol_heel'],
      deepsquat_30: ['deep_squat_hold'],
      ankle_9: ['knee_wall'],
      ankle_12: ['knee_wall'],
      pistol_terminal: ['pistol']
    });
  });

  test('23 the role is a structural invariant, not a policy dimension', () => {
    const keys = CONTENT.vocabulary.dimensions.map((d) => d.key);
    ['trainEvidenceEligibility', 'linkRole', 'relationEvidence', 'evidenceRelation']
      .forEach((k) => expect(keys, k + ' must not be a policy dimension').not.toContain(k));
    expect(JSON.stringify(CONTENT.semantics[0].policies)).not.toMatch(/train|assess/i);
  });

  test('24 no dependency constrains evidence_validity: a proxy never overrules a demonstration', () => {
    expect(B.dependencies.filter((d) => (d.constrains || []).indexOf('evidence_validity') >= 0)
      .map((d) => d.id)).toEqual([]);
  });

  test('25 no goal terminal is gated by a hard dependency on a supporting capability', () => {
    expect(B.dependencies.filter((d) => d.subject.kind === 'goalTerminal' && d.severity === 'hard')
      .map((d) => d.id)).toEqual([]);
  });

  test('26 every hard dependency offers an accommodation, since it changes what is prescribed', () => {
    B.dependencies.filter((d) => d.severity === 'hard').forEach((d) => {
      expect(d.accommodation, d.id).toBeTruthy();
      expect(exById[d.accommodation.exerciseId], d.id + ' accommodation exercise').toBeTruthy();
      expect(d.accommodation.doseNote.length, d.id).toBeGreaterThan(20);
    });
  });
});

test.describe('P4 content — exercise-id continuity (V15)', () => {
  test('07 every exercise id the app cites is defined in bundle 1', () => {
    const defined = new Set(CONTENT.bundles[0].exercises.map((e) => e.id));
    const missing = Object.keys(CONTINUITY).filter((id) => !defined.has(id))
      .map((id) => id + ' <- ' + CONTINUITY[id].join(', '));
    expect(missing).toEqual([]);
  });

  test('08 the continuity set is read from the app, and covers every source of cited ids', () => {
    const sources = new Set();
    Object.keys(CONTINUITY).forEach((id) => CONTINUITY[id].forEach((s) => sources.add(s)));
    expect(Array.from(sources).sort()).toEqual([
      'data.js block.exId', 'data.js exercises', 'week.js CLIMB_EX', 'week.js block.exId'
    ]);
    // Guards against a silently empty continuity set passing rule V15.
    expect(Object.keys(CONTINUITY).length).toBeGreaterThanOrEqual(25);
  });

  test('09 every exercise the bundle defines is either cited by the app or newly authored content', () => {
    // Not a validator rule — a review aid. It must never fail silently, so the
    // count is pinned: a new exercise is a deliberate authoring act.
    const cited = new Set(Object.keys(CONTINUITY));
    const authored = CONTENT.bundles[0].exercises.map((e) => e.id).filter((id) => !cited.has(id));
    expect(authored.sort()).toEqual([
      'banded_ring_transition', 'box_pistol', 'c2r_pullup', 'deep_squat_hold', 'fg_hang',
      'knee_wall', 'lowring_transition', 'pistol_heel', 'ring_dip', 'ring_transition',
      'rmu_attempt', 'rto_support'
    ].sort());
  });
});

test.describe('P4 content — red fixtures', () => {
  test('10 every rule V1..V18 has at least one red fixture', () => {
    const covered = new Set(FIXTURES.map((f) => f.rule));
    expect(ALL_RULES.filter((r) => !covered.has(r))).toEqual([]);
  });

  test('11 every fixture states its rule, its reason and what it expects', () => {
    FIXTURES.forEach((f) => {
      expect(ALL_RULES, f.name).toContain(f.rule);
      expect(f.reason.length, f.name).toBeGreaterThan(20);
      expect(['error', 'warning'], f.name).toContain(f.expect.level);
      expect(f.ops.length, f.name).toBeGreaterThan(0);
    });
  });

  for (const fx of FIXTURES) {
    test(`12 ${fx.name} — ${fx.rule} rejects it: ${fx.reason}`, () => {
      const rep = V.validate(contentFor(fx));
      const bucket = fx.expect.level === 'error' ? rep.errors : rep.warnings;
      const hits = bucket.filter((f) => f.rule === fx.rule);
      expect(hits.length, fx.rule + ' did not fire. Findings: ' + JSON.stringify(rep.errors.concat(rep.warnings), null, 2))
        .toBeGreaterThan(0);
      expect(hits.map((h) => h.message).join(' | ')).toContain(fx.expect.includes);
      if (fx.expect.level === 'error') expect(rep.errors.length).toBeGreaterThan(0);
    });
  }

  test('13 the fixtures are red only because of their mutation: an empty mutation is green', () => {
    const rep = V.validate(contentFor({ name: 'no-op', rule: 'V1', ops: [] }));
    expect(rep.errors).toEqual([]);
  });

  test('14 publishing the real bundle twice, as version 1 and 2, stays green across the cross-bundle rules', () => {
    const rep = V.validate(contentFor({ name: 'reissue', rule: 'V9', previous: [], ops: [] }));
    expect(rep.errors, JSON.stringify(rep.errors, null, 2)).toEqual([]);
  });
});
