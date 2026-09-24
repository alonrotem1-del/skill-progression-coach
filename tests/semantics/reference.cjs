/*
 * Behaviour-preservation reference verdicts — Implementation Plan §15.
 *
 * This file is the HAND-COMPUTED half of the harness. It exists before the
 * evaluator does, so the evaluator is built to pass it rather than the fixtures
 * being written to match whatever the evaluator happens to do.
 *
 * The verdicts here are written in a deliberately different notation from the
 * fixture JSON, and were reasoned out from the semantics-1 policy values rather
 * than copied across. tests/semantics.spec.cjs projects both sides onto the same
 * shape and requires them to agree, so a fixture cannot be edited into
 * agreement with itself.
 *
 * Notation — one line per verdict, "<kind> <subject> => <verdict>":
 *   crit    <criterionId>|<side>   => satisfied | provisional | unsatisfied
 *                                     [by <seq>,<seq>] [ex <seq>:<reason>;…]
 *   holder  <holderKey>|<side>     => satisfied | provisional | unsatisfied
 *   stage   <progressionId>|<side> => <stageId> | none
 *   limiter <goalId>|<side>        => <progressionId> | none
 *   dep     <dependencyId>|<side>  => met | unmet
 * A side of `combined` is the null side of a combined-scope Criterion.
 * Scenario 0 is the fixture's own ledger; 1.. are its alternates, in order.
 *
 * REGISTERING THE EVALUATOR (P6a). Call registerEvaluator(fn) with a function
 * (fixture, semanticsVersion, scenarioIndex) -> expected-shaped verdicts. Until
 * one is registered, interpret() returns the table below and the spec says so in
 * its own output — the harness proves the fixtures and the vocabulary today, not
 * the verdicts of code that does not exist.
 */
'use strict';

var HAND_COMPUTED = {

  'req-allof-two-observations': [
    ['crit m_a|combined => satisfied by 1',
     'crit m_b|combined => satisfied by 2',
     'holder progression:m_allof|combined => satisfied'],
    ['crit m_a|combined => satisfied by 1',
     'crit m_b|combined => unsatisfied',
     'holder progression:m_allof|combined => unsatisfied']
  ],

  'req-anyof-nearest': [
    ['crit m_a|combined => unsatisfied',
     'crit m_b|combined => satisfied by 1',
     'holder progression:m_anyof|combined => satisfied'],
    ['crit m_a|combined => unsatisfied',
     'crit m_b|combined => unsatisfied',
     'holder progression:m_anyof|combined => unsatisfied']
  ],

  'req-nested-depth-2': [
    ['crit m_a|combined => satisfied by 1',
     'crit m_b|combined => unsatisfied',
     'crit m_c|combined => satisfied by 2',
     'holder progression:m_nested|combined => satisfied'],
    ['crit m_a|combined => satisfied by 1',
     'crit m_b|combined => unsatisfied',
     'crit m_c|combined => unsatisfied',
     'holder progression:m_nested|combined => unsatisfied']
  ],

  'criterion-one-observation': [
    ['crit rmu_terminal|combined => unsatisfied',
     'holder goalTerminal:ring_muscle_up|combined => unsatisfied'],
    ['crit rmu_terminal|combined => satisfied by 3',
     'holder goalTerminal:ring_muscle_up|combined => satisfied']
  ],

  'claimed-provisional': [
    ['crit rmu_pull_5|combined => provisional by 1',
     'holder stage:rmu_pull_s2|combined => provisional']
  ],

  'claimed-refused-hard-dependency': [
    ['crit sup_rto_20|combined => provisional by 1',
     'holder stage:rmu_sup_s2|combined => provisional',
     'dep dep_transition_needs_rto|combined => unmet'],
    ['crit sup_rto_20|combined => satisfied by 1',
     'holder stage:rmu_sup_s2|combined => satisfied',
     'dep dep_transition_needs_rto|combined => met']
  ],

  'claimed-refused-goal-terminal': [
    ['crit rmu_terminal|combined => unsatisfied ex 1:claimed_not_eligible',
     'holder goalTerminal:ring_muscle_up|combined => unsatisfied']
  ],

  'demonstrated-supersedes-claimed': [
    ['crit rmu_pull_1|combined => satisfied by 1,2',
     'crit rmu_pull_5|combined => satisfied by 1,2',
     'crit rmu_pull_10|combined => provisional by 1',
     'holder stage:rmu_pull_s1|combined => satisfied',
     'holder stage:rmu_pull_s2|combined => satisfied',
     'holder stage:rmu_pull_s3|combined => provisional',
     'stage rmu_pull_strength|combined => rmu_pull_s3']
  ],

  'dependency-unmet-excluded': [
    ['crit d_terminal|left => unsatisfied ex 1:dependency_unmet(d_dep)',
     'crit d_terminal|right => unsatisfied ex 1:wrong_side',
     'holder goalTerminal:d_goal|left => unsatisfied',
     'holder goalTerminal:d_goal|right => unsatisfied',
     'dep d_dep|left => unmet',
     'dep d_dep|right => unmet'],
    ['crit d_range_9|left => satisfied by 1 ex 2:wrong_side',
     'crit d_range_9|right => satisfied by 2 ex 1:wrong_side',
     'crit d_terminal|left => satisfied by 3',
     'crit d_terminal|right => unsatisfied ex 3:wrong_side',
     'holder goalTerminal:d_goal|left => satisfied',
     'holder goalTerminal:d_goal|right => unsatisfied',
     'dep d_dep|left => met',
     'dep d_dep|right => met']
  ],

  'side-each-independent': [
    ['crit ankle_9|left => unsatisfied ex 2:wrong_side',
     'crit ankle_9|right => satisfied by 2 ex 1:wrong_side',
     'crit ankle_12|left => unsatisfied ex 2:wrong_side',
     'crit ankle_12|right => satisfied by 2 ex 1:wrong_side',
     'holder stage:pistol_ankle_s1|left => unsatisfied',
     'holder stage:pistol_ankle_s1|right => satisfied',
     'holder stage:pistol_ankle_s2|left => unsatisfied',
     'holder stage:pistol_ankle_s2|right => satisfied',
     'stage pistol_ankle_mobility|left => pistol_ankle_s1',
     'stage pistol_ankle_mobility|right => none',
     'limiter pistol_squat|left => pistol_ankle_mobility',
     'limiter pistol_squat|right => none']
  ],

  'side-combined-cannot-satisfy-each': [
    ['crit ankle_9|left => unsatisfied ex 1:wrong_side',
     'crit ankle_9|right => unsatisfied ex 1:wrong_side',
     'crit ankle_12|left => unsatisfied ex 1:wrong_side',
     'crit ankle_12|right => unsatisfied ex 1:wrong_side',
     'holder stage:pistol_ankle_s1|left => unsatisfied',
     'holder stage:pistol_ankle_s1|right => unsatisfied',
     'holder stage:pistol_ankle_s2|left => unsatisfied',
     'holder stage:pistol_ankle_s2|right => unsatisfied',
     'stage pistol_ankle_mobility|left => pistol_ankle_s1',
     'stage pistol_ankle_mobility|right => pistol_ankle_s1']
  ],

  'missing-attribute': [
    ['crit rmu_pull_1|combined => unsatisfied ex 1:missing_attribute(kip)',
     'crit rmu_pull_5|combined => unsatisfied ex 1:missing_attribute(kip)',
     'crit rmu_pull_10|combined => unsatisfied ex 1:missing_attribute(kip)',
     'holder stage:rmu_pull_s1|combined => unsatisfied',
     'holder stage:rmu_pull_s2|combined => unsatisfied',
     'holder stage:rmu_pull_s3|combined => unsatisfied',
     'stage rmu_pull_strength|combined => rmu_pull_s1'],
    ['crit rmu_pull_1|combined => satisfied by 1',
     'crit rmu_pull_5|combined => satisfied by 1',
     'crit rmu_pull_10|combined => satisfied by 1',
     'holder stage:rmu_pull_s1|combined => satisfied',
     'holder stage:rmu_pull_s2|combined => satisfied',
     'holder stage:rmu_pull_s3|combined => satisfied',
     'stage rmu_pull_strength|combined => none']
  ],

  'stage-lowest-unsatisfied': [
    ['crit exp_highpull_3|combined => satisfied by 1',
     'crit exp_c2b_3|combined => unsatisfied',
     'crit exp_c2r_3|combined => satisfied by 3',
     'holder stage:rmu_exp_s1|combined => satisfied',
     'holder stage:rmu_exp_s2|combined => unsatisfied',
     'holder stage:rmu_exp_s3|combined => satisfied',
     'stage rmu_explosive_pull|combined => rmu_exp_s2']
  ],

  'freshness-none': [
    ['crit fg_hang_30|combined => satisfied by 1',
     'holder progression:rmu_false_grip|combined => satisfied']
  ],

  'regression-none': [
    ['crit rmu_pull_5|combined => satisfied by 1',
     'holder stage:rmu_pull_s2|combined => satisfied']
  ],

  'supersession-best-applicable': [
    ['crit rmu_pull_5|combined => satisfied by 1',
     'holder stage:rmu_pull_s2|combined => satisfied'],
    ['crit rmu_pull_5|combined => satisfied by 2',
     'holder stage:rmu_pull_s2|combined => satisfied']
  ],

  'unknown-occurredAt-not-recent': [
    ['crit rmu_pull_1|combined => satisfied by 1,2',
     'crit rmu_pull_5|combined => satisfied by 1,2',
     'crit rmu_pull_10|combined => provisional by 1',
     'holder stage:rmu_pull_s1|combined => satisfied',
     'holder stage:rmu_pull_s2|combined => satisfied',
     'holder stage:rmu_pull_s3|combined => provisional',
     'stage rmu_pull_strength|combined => rmu_pull_s3']
  ]
};

var STATUSES = ['satisfied', 'provisional', 'unsatisfied'];

// "crit rmu_pull_5|combined => satisfied by 1,2 ex 3:wrong_side"
function parseLine(line) {
  var m = /^(crit|holder|stage|limiter|dep)\s+(\S+)\s+=>\s+(.*)$/.exec(line.trim());
  if (!m) throw new Error('unparsable reference line: ' + line);
  var kind = m[1], subject = m[2], rest = m[3].trim();
  if (kind === 'stage' || kind === 'limiter') {
    return { kind: kind, subject: subject, value: rest === 'none' ? null : rest };
  }
  if (kind === 'dep') {
    if (rest !== 'met' && rest !== 'unmet') throw new Error('dep verdict must be met|unmet: ' + line);
    return { kind: kind, subject: subject, met: rest === 'met' };
  }
  var sm = /^(satisfied|provisional|unsatisfied)((\s+by\s+[0-9,\s]+)?)((\s+ex\s+\S+)?)$/.exec(rest);
  if (!sm) throw new Error('unparsable verdict: ' + line);
  var by = (sm[3] || '').replace(/^\s*by\s*/, '').split(',').map(function (s) { return s.trim(); })
    .filter(Boolean).map(Number);
  var ex = (sm[5] || '').replace(/^\s*ex\s*/, '').split(';').map(function (s) { return s.trim(); })
    .filter(Boolean).map(function (pair) {
      var i = pair.indexOf(':');
      return { seq: Number(pair.slice(0, i)), reason: pair.slice(i + 1) };
    });
  return { kind: kind, subject: subject, status: sm[1], satisfiedBy: by, excluded: ex };
}

// The comparable projection: exactly the facts the two halves must agree on.
function projectReference(lines) {
  var out = { evaluations: {}, holders: {}, currentStage: {}, limiters: {}, dependencies: {} };
  lines.forEach(function (line) {
    var v = parseLine(line);
    if (v.kind === 'crit') {
      out.evaluations[v.subject] = {
        status: v.status,
        satisfiedBy: v.satisfiedBy.slice().sort(function (a, b) { return a - b; }),
        excluded: v.excluded.map(function (e) { return e.seq + ':' + e.reason; }).sort()
      };
    } else if (v.kind === 'holder') {
      out.holders[v.subject] = v.status;
    } else if (v.kind === 'stage') {
      out.currentStage[v.subject] = v.value;
    } else if (v.kind === 'limiter') {
      out.limiters[v.subject] = v.value;
    } else {
      out.dependencies[v.subject] = v.met;
    }
  });
  return out;
}

// The same projection taken from a fixture's expected block. The evaluation keys
// in a fixture carry the contextId (criterionId|side|contextId, per §7); the
// reference notation drops it, because every fixture in the set is pinned to the
// one context that exists.
function projectExpected(expected) {
  var out = { evaluations: {}, holders: {}, currentStage: {}, limiters: {}, dependencies: {} };
  Object.keys(expected.evaluations || {}).forEach(function (k) {
    var e = expected.evaluations[k];
    var parts = k.split('|');
    out.evaluations[parts[0] + '|' + parts[1]] = {
      status: e.status,
      satisfiedBy: (e.satisfiedBy || []).slice().sort(function (a, b) { return a - b; }),
      excluded: (e.excluded || []).map(function (x) { return x.seq + ':' + x.reason; }).sort()
    };
  });
  Object.keys(expected.holders || {}).forEach(function (k) { out.holders[k] = expected.holders[k].status; });
  Object.keys(expected.currentStage || {}).forEach(function (k) { out.currentStage[k] = expected.currentStage[k]; });
  Object.keys(expected.limiters || {}).forEach(function (k) { out.limiters[k] = expected.limiters[k]; });
  Object.keys(expected.dependencies || {}).forEach(function (k) { out.dependencies[k] = expected.dependencies[k].met; });
  return out;
}

var evaluator = null;
function registerEvaluator(fn) { evaluator = fn; }
function evaluatorRegistered() { return !!evaluator; }

/**
 * The projection of the verdicts for one scenario. With no evaluator registered
 * this is the hand-computed table; with one registered it is what the evaluator
 * produced, projected the same way.
 */
function interpret(fixture, semanticsVersion, scenarioIndex) {
  if (evaluator) return projectExpected(evaluator(fixture, semanticsVersion, scenarioIndex || 0));
  var table = HAND_COMPUTED[fixture.name];
  if (!table) throw new Error('no hand-computed verdicts for case "' + fixture.name + '"');
  var lines = table[scenarioIndex || 0];
  if (!lines) throw new Error('no hand-computed verdicts for scenario ' + scenarioIndex + ' of "' + fixture.name + '"');
  return projectReference(lines);
}

module.exports = {
  HAND_COMPUTED: HAND_COMPUTED,
  STATUSES: STATUSES,
  parseLine: parseLine,
  projectReference: projectReference,
  projectExpected: projectExpected,
  registerEvaluator: registerEvaluator,
  evaluatorRegistered: evaluatorRegistered,
  interpret: interpret
};
