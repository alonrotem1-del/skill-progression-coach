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

const ALL_RULES = Array.from({ length: 18 }, (_, i) => 'V' + (i + 1));

const clone = (x) => JSON.parse(JSON.stringify(x));

// ---- path resolution -----------------------------------------------------
// "bundle.progressions[#rmu_pull_strength].stages[1].order"
//   [#id] selects an array member by id or key; [n] by position.
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

// The two authoring rules the bundle's own note states. Both were review
// findings, so they are tests now rather than paragraphs: nothing in the schema
// makes a `train` link less evidential than an `assess` link, and nothing stops
// a Dependency from invalidating evidence, so content has to hold the line.
test.describe('P4 content — evidence discipline', () => {
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

  // A train link whose exercise could satisfy the holder's criterion, allowed
  // only where the substitution is strictly harder than what it stands in for.
  const ALLOWED_TRAIN_EVIDENCE = {
    'stage:rmu_pull_s3/rmu_pull_10/weighted_pullup':
      'Ten clean weighted pull-ups are strictly harder than the ten bodyweight reps the criterion asks for.'
  };

  test('15 no train link can satisfy a criterion it was only meant to develop', () => {
    const offenders = [];
    Object.keys(holders).forEach((h) => {
      holders[h].forEach((cid) => {
        const need = crById[cid].conditions.map((cd) => cd.attribute);
        (linksByHolder[h] || []).forEach((l) => {
          if (l.relation !== 'train') return;
          const produces = exById[l.exerciseId].producesAttributes || [];
          if (!need.every((a) => produces.indexOf(a) >= 0)) return;      // not evidence about this criterion
          const key = h + '/' + cid + '/' + l.exerciseId;
          if (!ALLOWED_TRAIN_EVIDENCE[key]) offenders.push(key);
        });
      });
    });
    expect(offenders, 'a bar drill must not silently satisfy a ring criterion').toEqual([]);
  });

  test('16 every holder is assessable, and only by an assess link', () => {
    Object.keys(holders).forEach((h) => {
      const assess = (linksByHolder[h] || []).filter((l) => l.relation === 'assess');
      expect(assess.length, h + ' has no assess link').toBeGreaterThan(0);
      holders[h].forEach((cid) => {
        const need = crById[cid].conditions.map((cd) => cd.attribute);
        const covered = assess.some((l) => need.every((a) => (exById[l.exerciseId].producesAttributes || []).indexOf(a) >= 0));
        expect(covered, h + ' / ' + cid + ' is not covered by any assess link').toBe(true);
      });
    });
  });

  test('17 no dependency constrains evidence_validity: a proxy never overrules a demonstration', () => {
    const offenders = B.dependencies
      .filter((d) => (d.constrains || []).indexOf('evidence_validity') >= 0)
      .map((d) => d.id);
    expect(offenders).toEqual([]);
  });

  test('18 no goal terminal is gated by a hard dependency on a supporting capability', () => {
    const hardOnTerminal = B.dependencies.filter((d) =>
      d.subject.kind === 'goalTerminal' && d.severity === 'hard').map((d) => d.id);
    expect(hardOnTerminal, 'a clean terminal performance is the evidence for the Goal').toEqual([]);
  });

  test('19 every hard dependency offers an accommodation, since it changes what is prescribed', () => {
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
