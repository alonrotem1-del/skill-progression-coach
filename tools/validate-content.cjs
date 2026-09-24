#!/usr/bin/env node
/*
 * Content validator — Implementation Plan §14 (rules V1..V18).
 *
 * Runs as a node script inside `npm test`, before Playwright, so invalid
 * content cannot reach a green build. It judges STRUCTURE ONLY. Whether 30 s is
 * the right false-grip bar, whether three Transition stages are too many,
 * whether heel elevation is the right accommodation — none of that is checkable
 * here, and a green run means "structurally sound", nothing more.
 *
 * Usage
 *   node tools/validate-content.cjs                  validate ./content against ./week.js + ./data.js
 *   node tools/validate-content.cjs --json           machine-readable report on stdout
 *   node tools/validate-content.cjs --dir <path>     a different content directory
 *   node tools/validate-content.cjs --no-continuity  skip V15 (no app sources present)
 *
 * Also usable as a library: require() it and call validate(contentSet). That is
 * how tests/content.spec.cjs drives the red fixtures.
 *
 * LOCKED: ExerciseLink.relation decides evidence eligibility.
 *
 *   assess    observations of this exercise MAY be evaluated against the linked
 *             holder's Criteria. It may also be prescribed for training.
 *   train     a prescription / development relationship ONLY. Evidence from this
 *             exercise can never satisfy the linked holder's Criteria.
 *   maintain  likewise non-evidential: keeping a capability already held.
 *
 *   TRAIN DOES NOT IMPLY EVIDENCE ELIGIBILITY.
 *
 * This is a structural invariant of the content contract, not an evaluation
 * policy: it does not appear in content/vocabulary.json, it cannot vary between
 * EvaluationSemantics versions, and there is no exception for an exercise that
 * is "harder than" what a Criterion asks for. A substitution that should count
 * is written as a second assess link, in content, where a reader can see it.
 * A new kind of evidence relationship would be a new role, added through the
 * ordinary schema versioning process.
 *
 * Consequently no rule here treats the roles as interchangeable. V8, V11 and
 * V19 count assess links only; V20 checks that an assess link asserts something
 * it can actually perform. See content/CONTRACT.md.
 */
'use strict';

var fs = require('fs');
var path = require('path');

// ---- frozen enumerations (Technical Schema v1.1 §4) ----------------------
var LOAD_DIMENSIONS = ['pull', 'push', 'grip', 'elbow', 'shoulder', 'legs', 'core', 'explosive'];
var ATTRIBUTE_TYPES = ['quantity', 'flag', 'grade'];
var FORMS = ['DIRECT', 'STAGED'];
var RELATIONS = ['train', 'assess', 'maintain'];
var SIDE_SCOPES = ['each', 'combined'];
var SIDE_RULES = ['mirror', 'any', 'specific'];
var CONSTRAINS = ['prescription', 'unlocking', 'evidence_validity'];
var SEVERITIES = ['hard', 'soft'];
var HOLDER_KINDS = ['progression', 'stage', 'goalTerminal'];
var OPS = ['gte', 'lte', 'gt', 'lt', 'eq', 'neq'];

// A Dependency states an ordering, never a quantity (V5). Any of these keys, or
// any numeric leaf anywhere in a Dependency, means a threshold has leaked in.
var QUANTITY_KEYS = /^(min|max|threshold|target|value|unit|amount|seconds|reps|kg|cm|count|level|order|minSeconds|minReps|required[A-Z])/;

// =========================================================================
// report plumbing
// =========================================================================

function Report() {
  this.errors = [];
  this.warnings = [];
  this.notes = [];
}
Report.prototype.err = function (rule, at, message) {
  this.errors.push({ rule: rule, at: at, message: message });
};
Report.prototype.warn = function (rule, at, message) {
  this.warnings.push({ rule: rule, at: at, message: message });
};
Report.prototype.note = function (rule, message) {
  this.notes.push({ rule: rule, message: message });
};
Report.prototype.has = function (rule) {
  return this.errors.concat(this.warnings).some(function (f) { return f.rule === rule; });
};

function byId(list) {
  var m = Object.create(null);
  (list || []).forEach(function (x) { if (x && x.id != null) m[x.id] = x; });
  return m;
}

function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }

// =========================================================================
// bundle index — one pass, reused by most rules
// =========================================================================

function indexBundle(bundle) {
  var ix = {
    bundle: bundle,
    attributes: byId(bundle.attributes),
    exercises: byId(bundle.exercises),
    criteria: byId(bundle.criteria),
    progressions: byId(bundle.progressions),
    goals: byId(bundle.goals),
    dependencies: byId(bundle.dependencies),
    stages: Object.create(null),          // stageId -> { stage, progression }
    holders: Object.create(null),         // holderKey -> { kind, id, requirement, ownerId }
    linksByHolder: Object.create(null)    // holderKey -> [ExerciseLink]
  };
  (bundle.progressions || []).forEach(function (p) {
    (p.stages || []).forEach(function (s) {
      if (s && s.id != null) ix.stages[s.id] = { stage: s, progression: p };
    });
  });
  return ix;
}

// A holder is the only place a requirement may live (V7 / invariant 23).
function holderKey(ref) {
  if (!isPlainObject(ref)) return null;
  if (ref.kind === 'progression') return 'progression:' + ref.progressionId;
  if (ref.kind === 'stage') return 'stage:' + ref.stageId;
  if (ref.kind === 'goalTerminal') return 'goalTerminal:' + ref.goalId;
  return null;
}

function collectHolders(ix) {
  (ix.bundle.progressions || []).forEach(function (p) {
    if (p.form === 'DIRECT') {
      ix.holders['progression:' + p.id] = { kind: 'progression', id: p.id, ownerId: p.id, requirement: p.requirement };
    }
    (p.stages || []).forEach(function (s) {
      ix.holders['stage:' + s.id] = { kind: 'stage', id: s.id, ownerId: p.id, requirement: s.requirement };
    });
  });
  (ix.bundle.goals || []).forEach(function (g) {
    ix.holders['goalTerminal:' + g.id] = { kind: 'goalTerminal', id: g.id, ownerId: g.id, requirement: g.terminalRequirement };
  });
  (ix.bundle.exerciseLinks || []).forEach(function (l) {
    var k = holderKey(l.target);
    if (!k) return;
    (ix.linksByHolder[k] = ix.linksByHolder[k] || []).push(l);
  });
}

// Every leaf criterion id of a RequirementExpression, in order.
function leafCriteria(expr, out) {
  out = out || [];
  if (!isPlainObject(expr)) return out;
  if (typeof expr.criterion === 'string') { out.push(expr.criterion); return out; }
  ['allOf', 'anyOf'].forEach(function (op) {
    if (Array.isArray(expr[op])) expr[op].forEach(function (c) { leafCriteria(c, out); });
  });
  return out;
}

function expressionDepth(expr) {
  if (!isPlainObject(expr)) return 0;
  if (typeof expr.criterion === 'string') return 0;
  var children = [];
  ['allOf', 'anyOf'].forEach(function (op) {
    if (Array.isArray(expr[op])) children = children.concat(expr[op]);
  });
  if (!children.length) return 1;
  return 1 + Math.max.apply(null, children.map(expressionDepth));
}

// =========================================================================
// V1 — ids unique across the whole bundle
// =========================================================================

function v1(ix, rep) {
  var seen = Object.create(null);
  function claim(kind, id, at) {
    if (id == null) { rep.err('V1', at, kind + ' has no id'); return; }
    if (seen[id]) rep.err('V1', at, 'duplicate id "' + id + '" (already used by ' + seen[id] + ')');
    else seen[id] = kind;
  }
  var b = ix.bundle;
  (b.attributes || []).forEach(function (a, i) { claim('attribute', a.id, 'attributes[' + i + ']'); });
  (b.exercises || []).forEach(function (e, i) { claim('exercise', e.id, 'exercises[' + i + ']'); });
  (b.criteria || []).forEach(function (c, i) { claim('criterion', c.id, 'criteria[' + i + ']'); });
  (b.progressions || []).forEach(function (p, i) {
    claim('progression', p.id, 'progressions[' + i + ']');
    (p.stages || []).forEach(function (s, j) { claim('stage', s.id, 'progressions[' + i + '].stages[' + j + ']'); });
  });
  (b.goals || []).forEach(function (g, i) { claim('goal', g.id, 'goals[' + i + ']'); });
  (b.dependencies || []).forEach(function (d, i) { claim('dependency', d.id, 'dependencies[' + i + ']'); });
}

// =========================================================================
// V2 — every reference resolves
// =========================================================================

function v2(ix, rep) {
  var b = ix.bundle;

  (b.exercises || []).forEach(function (e, i) {
    (e.producesAttributes || []).forEach(function (a) {
      if (!ix.attributes[a]) rep.err('V2', 'exercises[' + i + '].producesAttributes', 'unknown attribute "' + a + '"');
    });
    Object.keys(e.loadDimensions || {}).forEach(function (d) {
      if (LOAD_DIMENSIONS.indexOf(d) < 0) rep.err('V2', 'exercises[' + i + '].loadDimensions', 'unknown load dimension "' + d + '"');
    });
  });

  (b.criteria || []).forEach(function (c, i) {
    (c.conditions || []).forEach(function (cond, j) {
      var at = 'criteria[' + i + '].conditions[' + j + ']';
      if (!ix.attributes[cond.attribute]) rep.err('V2', at, 'unknown attribute "' + cond.attribute + '"');
      if (OPS.indexOf(cond.op) < 0) rep.err('V2', at, 'unknown operator "' + cond.op + '"');
    });
    if (c.primaryAttribute != null && !ix.attributes[c.primaryAttribute]) {
      rep.err('V2', 'criteria[' + i + '].primaryAttribute', 'unknown attribute "' + c.primaryAttribute + '"');
    }
  });

  function checkExpr(expr, at) {
    leafCriteria(expr).forEach(function (cid) {
      if (!ix.criteria[cid]) rep.err('V2', at, 'requirement names unknown criterion "' + cid + '"');
    });
  }
  (b.progressions || []).forEach(function (p, i) {
    if (p.requirement) checkExpr(p.requirement, 'progressions[' + i + '].requirement');
    (p.stages || []).forEach(function (s, j) { checkExpr(s.requirement, 'progressions[' + i + '].stages[' + j + '].requirement'); });
  });
  (b.goals || []).forEach(function (g, i) {
    checkExpr(g.terminalRequirement, 'goals[' + i + '].terminalRequirement');
    (g.coordinates || []).forEach(function (co, j) {
      if (!ix.progressions[co.progressionId]) {
        rep.err('V2', 'goals[' + i + '].coordinates[' + j + ']', 'unknown progression "' + co.progressionId + '"');
      }
    });
  });

  function checkHolderRef(ref, at) {
    if (!isPlainObject(ref)) { rep.err('V2', at, 'holder reference is not an object'); return; }
    if (HOLDER_KINDS.indexOf(ref.kind) < 0) { rep.err('V2', at, 'unknown holder kind "' + ref.kind + '"'); return; }
    if (ref.kind === 'progression') {
      if (!ix.progressions[ref.progressionId]) rep.err('V2', at, 'unknown progression "' + ref.progressionId + '"');
    } else if (ref.kind === 'stage') {
      var st = ix.stages[ref.stageId];
      if (!st) rep.err('V2', at, 'unknown stage "' + ref.stageId + '"');
      else if (ref.progressionId != null && st.progression.id !== ref.progressionId) {
        rep.err('V2', at, 'stage "' + ref.stageId + '" belongs to "' + st.progression.id + '", not "' + ref.progressionId + '"');
      }
    } else {
      if (!ix.goals[ref.goalId]) rep.err('V2', at, 'unknown goal "' + ref.goalId + '"');
    }
  }

  (b.dependencies || []).forEach(function (d, i) {
    checkHolderRef(d.subject, 'dependencies[' + i + '].subject');
    checkHolderRef(d.requires, 'dependencies[' + i + '].requires');
    if (d.accommodation && !ix.exercises[d.accommodation.exerciseId]) {
      rep.err('V2', 'dependencies[' + i + '].accommodation', 'unknown exercise "' + d.accommodation.exerciseId + '"');
    }
    if (SIDE_RULES.indexOf(d.sideRule) < 0) rep.err('V2', 'dependencies[' + i + '].sideRule', 'unknown side rule "' + d.sideRule + '"');
    if (SEVERITIES.indexOf(d.severity) < 0) rep.err('V2', 'dependencies[' + i + '].severity', 'unknown severity "' + d.severity + '"');
    (d.constrains || []).forEach(function (c) {
      if (CONSTRAINS.indexOf(c) < 0) rep.err('V2', 'dependencies[' + i + '].constrains', 'unknown facet "' + c + '"');
    });
    if (!(d.constrains || []).length) rep.err('V2', 'dependencies[' + i + '].constrains', 'a dependency that constrains nothing has no effect');
  });

  (b.exerciseLinks || []).forEach(function (l, i) {
    var at = 'exerciseLinks[' + i + ']';
    if (!ix.exercises[l.exerciseId]) rep.err('V2', at, 'unknown exercise "' + l.exerciseId + '"');
    checkHolderRef(l.target, at + '.target');
    if (RELATIONS.indexOf(l.relation) < 0) rep.err('V2', at, 'unknown relation "' + l.relation + '"');
    if (SIDE_SCOPES.indexOf(l.sideScope) < 0) rep.err('V2', at, 'unknown side scope "' + l.sideScope + '"');
  });

  (b.attributes || []).forEach(function (a, i) {
    if (ATTRIBUTE_TYPES.indexOf(a.type) < 0) rep.err('V2', 'attributes[' + i + ']', 'unknown attribute type "' + a.type + '"');
  });
}

// =========================================================================
// V3 — progression form is coherent
// =========================================================================

function v3(ix, rep) {
  (ix.bundle.progressions || []).forEach(function (p, i) {
    var at = 'progressions[' + i + ']';
    if (FORMS.indexOf(p.form) < 0) { rep.err('V3', at, 'unknown form "' + p.form + '"'); return; }
    if (p.form === 'DIRECT') {
      if (p.stages != null) rep.err('V3', at, 'a DIRECT progression carries no stages');
      if (!p.requirement) rep.err('V3', at, 'a DIRECT progression needs exactly one requirement');
    } else {
      var stages = p.stages || [];
      if (stages.length < 2) rep.err('V3', at, 'a STAGED progression needs at least 2 stages (found ' + stages.length + ') — one stage is a DIRECT progression');
      if (p.requirement) rep.err('V3', at, 'a STAGED progression carries no requirement of its own; its stages do');
      var orders = Object.create(null);
      stages.forEach(function (s, j) {
        var sat = at + '.stages[' + j + ']';
        if (typeof s.order !== 'number') rep.err('V3', sat, 'stage order must be an explicit number');
        else if (orders[s.order]) rep.err('V3', sat, 'stage order ' + s.order + ' is shared with "' + orders[s.order] + '" — stages need a total order');
        else orders[s.order] = s.id;
        if (!s.requirement) rep.err('V3', sat, 'stage has no requirement');
      });
    }
  });
}

// =========================================================================
// V4 — a dependency on a STAGED progression must name the stage
// =========================================================================

function v4(ix, rep) {
  (ix.bundle.dependencies || []).forEach(function (d, i) {
    ['subject', 'requires'].forEach(function (side) {
      var ref = d[side];
      if (!isPlainObject(ref) || ref.kind !== 'progression') return;
      var p = ix.progressions[ref.progressionId];
      if (p && p.form === 'STAGED') {
        rep.err('V4', 'dependencies[' + i + '].' + side,
          'names STAGED progression "' + p.id + '" directly; a dependency must name which stage');
      }
    });
  });
}

// =========================================================================
// V5 — a dependency carries no quantity
// =========================================================================

function v5(ix, rep) {
  (ix.bundle.dependencies || []).forEach(function (d, i) {
    walk(d, 'dependencies[' + i + ']');
  });
  function walk(node, at) {
    if (node == null) return;
    if (typeof node === 'number') { rep.err('V5', at, 'numeric value ' + node + ' — a dependency states an ordering, never a quantity'); return; }
    if (Array.isArray(node)) { node.forEach(function (v, i) { walk(v, at + '[' + i + ']'); }); return; }
    if (typeof node !== 'object') return;
    Object.keys(node).forEach(function (k) {
      if (QUANTITY_KEYS.test(k)) rep.err('V5', at + '.' + k, 'threshold-shaped field "' + k + '" on a dependency');
      walk(node[k], at + '.' + k);
    });
  }
}

// =========================================================================
// V6 — requirement expressions stay a bounded composition layer
// =========================================================================

function v6(ix, rep) {
  function check(expr, at) {
    if (!isPlainObject(expr)) { rep.err('V6', at, 'requirement is not an expression'); return; }
    var ops = ['allOf', 'anyOf'].filter(function (o) { return expr[o] !== undefined; });
    var isLeaf = typeof expr.criterion === 'string';
    if (isLeaf && ops.length) { rep.err('V6', at, 'an expression is either a leaf or one operator, not both'); return; }
    if (!isLeaf && !ops.length) { rep.err('V6', at, 'expression is neither a criterion leaf nor allOf/anyOf'); return; }
    if (ops.length > 1) { rep.err('V6', at, 'expression carries both allOf and anyOf'); return; }
    if (isLeaf) return;
    var op = ops[0], kids = expr[op];
    if (!Array.isArray(kids) || kids.length === 0) { rep.err('V6', at + '.' + op, 'empty ' + op); return; }
    if (kids.length === 1) { rep.err('V6', at + '.' + op, 'single-child ' + op + ' — write it as a bare leaf'); }
    kids.forEach(function (k, j) { check(k, at + '.' + op + '[' + j + ']'); });
    if (expressionDepth(expr) > 2) rep.err('V6', at, 'expression depth ' + expressionDepth(expr) + ' exceeds the frozen maximum of 2');
  }
  Object.keys(ix.holders).forEach(function (k) {
    var h = ix.holders[k];
    if (h.requirement) check(h.requirement, k + '.requirement');
  });
}

// =========================================================================
// V7 — a requirement lives only on a holder
// =========================================================================

function v7(ix, rep) {
  var b = ix.bundle;
  var allowed = Object.create(null);

  (b.progressions || []).forEach(function (p, i) {
    allowed['progressions[' + i + '].requirement'] = true;
    (p.stages || []).forEach(function (s, j) { allowed['progressions[' + i + '].stages[' + j + '].requirement'] = true; });
  });
  (b.goals || []).forEach(function (g, i) { allowed['goals[' + i + '].terminalRequirement'] = true; });

  function scan(node, at) {
    if (node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(function (v, i) { scan(v, at + '[' + i + ']'); }); return; }
    Object.keys(node).forEach(function (k) {
      var here = at ? at + '.' + k : k;
      if ((k === 'requirement' || k === 'terminalRequirement') && !allowed[here]) {
        rep.err('V7', here, 'a requirement may only sit on a stage, a DIRECT progression or a goal terminal');
      }
      if (k !== 'requirement' && k !== 'terminalRequirement') scan(node[k], here);
    });
  }
  Object.keys(b).forEach(function (k) { if (Array.isArray(b[k])) scan(b[k], k); });

  // A STAGED progression's own requirement is reported by V3, not here.
  (b.progressions || []).forEach(function (p, i) {
    if (p.form === 'STAGED' && p.requirement) {
      rep.err('V7', 'progressions[' + i + '].requirement', 'a STAGED progression is not a requirement holder; its stages are');
    }
  });
}

// =========================================================================
// V8 — every condition attribute is actually observable at its holder
// =========================================================================
// Assess links only. A train-only exercise is never counted when deciding
// whether a holder can be assessed, because its evidence cannot satisfy the
// holder's Criteria at all.

function v8(ix, rep) {
  Object.keys(ix.holders).forEach(function (hk) {
    var h = ix.holders[hk];
    if (!h.requirement) return;
    var links = (ix.linksByHolder[hk] || []).filter(function (l) {
      return l.relation === 'assess';
    });
    var produced = Object.create(null);
    links.forEach(function (l) {
      var ex = ix.exercises[l.exerciseId];
      if (ex) (ex.producesAttributes || []).forEach(function (a) { produced[a] = true; });
    });
    leafCriteria(h.requirement).forEach(function (cid) {
      var c = ix.criteria[cid];
      if (!c) return;
      (c.conditions || []).forEach(function (cond) {
        if (!produced[cond.attribute]) {
          rep.err('V8', hk + ' / ' + cid,
            'condition on "' + cond.attribute + '" but no ASSESS-linked exercise produces it' +
            (links.length ? '' : ' (the holder has no assess link at all; a train link cannot assess)'));
        }
      });
    });
  });
}

// =========================================================================
// V9 — grade scales are ordered and only ever extended above the top
// =========================================================================

function v9(bundle, previous, rep) {
  (bundle.attributes || []).forEach(function (a, i) {
    var at = 'attributes[' + i + ']';
    if (a.type !== 'grade') {
      if (a.scale) rep.err('V9', at, 'only a grade attribute carries a scale');
      return;
    }
    if (!Array.isArray(a.scale) || a.scale.length === 0) { rep.err('V9', at, 'a grade attribute needs a non-empty ordered scale'); return; }
    var seen = Object.create(null);
    a.scale.forEach(function (lv) {
      if (typeof lv !== 'string') rep.err('V9', at, 'scale level is not a string');
      if (seen[lv]) rep.err('V9', at, 'scale level "' + lv + '" appears twice');
      seen[lv] = true;
    });
    if (!previous) return;
    var prev = byId(previous.attributes)[a.id];
    if (!prev) return;
    if (prev.type !== 'grade') { rep.err('V9', at, 'attribute "' + a.id + '" changed type from ' + prev.type + ' to grade'); return; }
    var old = prev.scale || [];
    var head = a.scale.slice(0, old.length);
    var identical = old.length <= a.scale.length && old.every(function (lv, k) { return head[k] === lv; });
    if (!identical) {
      rep.err('V9', at, 'grade scale for "' + a.id + '" changed below the top: was [' + old.join(', ') +
        '], now [' + a.scale.join(', ') + ']. A stored observation would silently change meaning — levels may only be appended above the existing top.');
    }
  });
}

// =========================================================================
// V10 — primaryAttribute is a condition attribute and never moves
// =========================================================================

function v10(bundle, previous, rep) {
  var prevCriteria = previous ? byId(previous.criteria) : null;
  (bundle.criteria || []).forEach(function (c, i) {
    var at = 'criteria[' + i + ']';
    var attrs = (c.conditions || []).map(function (cd) { return cd.attribute; });
    if (attrs.indexOf(c.primaryAttribute) < 0) {
      rep.err('V10', at, 'primaryAttribute "' + c.primaryAttribute + '" is not one of this criterion\'s condition attributes [' + attrs.join(', ') + ']');
    }
    if (prevCriteria && prevCriteria[c.id] && prevCriteria[c.id].primaryAttribute !== c.primaryAttribute) {
      rep.err('V10', at, 'primaryAttribute for "' + c.id + '" moved from "' + prevCriteria[c.id].primaryAttribute +
        '" to "' + c.primaryAttribute + '" under the same id — a frozen artifact\'s shortfall sentence would now count something else');
    }
  });
}

// =========================================================================
// V11 — per-side declarations are coherent
// =========================================================================

function v11(ix, rep) {
  var holderOf = Object.create(null);
  Object.keys(ix.holders).forEach(function (hk) {
    var h = ix.holders[hk];
    if (!h.requirement) return;
    leafCriteria(h.requirement).forEach(function (cid) { (holderOf[cid] = holderOf[cid] || []).push(hk); });
  });

  (ix.bundle.criteria || []).forEach(function (c, i) {
    var at = 'criteria[' + i + ']';
    if (SIDE_SCOPES.indexOf(c.sideScope) < 0) { rep.err('V11', at, 'unknown sideScope "' + c.sideScope + '"'); return; }
    if (c.sideScope !== 'each') return;
    var holders = holderOf[c.id] || [];
    if (!holders.length) return;                       // orphan criterion: V2/V8 territory
    var ok = holders.some(function (hk) {
      return (ix.linksByHolder[hk] || []).some(function (l) {
        if (l.relation !== 'assess') return false;
        var ex = ix.exercises[l.exerciseId];
        return !!(ex && ex.unilateral && l.sideScope === 'each');
      });
    });
    if (!ok) {
      rep.err('V11', at, 'sideScope "each" but no holder of this criterion has a unilateral ASSESS exercise linked with sideScope "each" — the criterion could never be satisfied per side');
    }
  });

  (ix.bundle.exerciseLinks || []).forEach(function (l, i) {
    var ex = ix.exercises[l.exerciseId];
    if (ex && !ex.unilateral && l.sideScope === 'each') {
      rep.err('V11', 'exerciseLinks[' + i + ']', 'bilateral exercise "' + l.exerciseId + '" linked with sideScope "each"');
    }
  });
}

// =========================================================================
// V12 — no dependency cycles across holders
// =========================================================================

function v12(ix, rep) {
  var edges = Object.create(null);
  (ix.bundle.dependencies || []).forEach(function (d) {
    var from = holderKey(d.subject), to = holderKey(d.requires);
    if (!from || !to) return;
    (edges[from] = edges[from] || []).push({ to: to, dep: d.id });
  });
  var state = Object.create(null);   // 1 = on stack, 2 = done
  var stack = [];
  function visit(node) {
    if (state[node] === 2) return;
    if (state[node] === 1) {
      var at = stack.indexOf(node);
      rep.err('V12', node, 'dependency cycle: ' + stack.slice(at).concat(node).join(' -> '));
      return;
    }
    state[node] = 1; stack.push(node);
    (edges[node] || []).forEach(function (e) { visit(e.to); });
    stack.pop(); state[node] = 2;
  }
  Object.keys(edges).forEach(visit);
}

// =========================================================================
// V13 — anti-duplication (warning): a top stage that restates a goal terminal
// =========================================================================

function normalizeConditions(c) {
  return (c.conditions || []).map(function (cd) { return cd.attribute + ' ' + cd.op + ' ' + JSON.stringify(cd.value); })
    .sort().join(' & ');
}

function primaryCondition(c) {
  return (c.conditions || []).filter(function (cd) { return cd.attribute === c.primaryAttribute; })[0] || null;
}

function v13(ix, rep) {
  (ix.bundle.goals || []).forEach(function (g) {
    var terminals = leafCriteria(g.terminalRequirement).map(function (id) { return ix.criteria[id]; }).filter(Boolean);
    (g.coordinates || []).forEach(function (co) {
      var p = ix.progressions[co.progressionId];
      if (!p) return;
      var top = null, at = null;
      if (p.form === 'STAGED') {
        (p.stages || []).forEach(function (s) { if (!top || s.order > top.order) { top = s; } });
        if (!top) return;
        at = p.id + '/' + top.id;
      } else {
        top = p; at = p.id;
      }
      leafCriteria(top.requirement).forEach(function (cid) {
        var c = ix.criteria[cid];
        if (!c) return;
        terminals.forEach(function (t) {
          if (t.id === c.id) {
            rep.warn('V13', at, 'top requirement is literally the goal terminal criterion "' + t.id + '" of "' + g.id + '"');
            return;
          }
          if (c.primaryAttribute !== t.primaryAttribute) return;
          var pc = primaryCondition(c), pt = primaryCondition(t);
          if (!pc || !pt) return;
          if (pc.op !== pt.op || JSON.stringify(pc.value) !== JSON.stringify(pt.value)) return;
          if (normalizeConditions(c) === normalizeConditions(t)) {
            rep.warn('V13', at, 'restates the terminal of goal "' + g.id + '": criterion "' + c.id +
              '" has the same conditions as "' + t.id + '". A progression inside a goal should demand a component, not the goal.');
          } else {
            rep.warn('V13', at, 'resembles the terminal of goal "' + g.id + '": "' + c.id + '" and "' + t.id +
              '" share primary attribute "' + c.primaryAttribute + '" ' + pc.op + ' ' + JSON.stringify(pc.value) +
              ' but differ on the remaining conditions. Review whether the stage is a component or the goal restated.');
          }
        });
      });
    });
  });
}

// =========================================================================
// V14 — goal coordination carries no primacy
// =========================================================================

function v14(ix, rep) {
  (ix.bundle.goals || []).forEach(function (g, i) {
    var co = g.coordinates || [];
    if (!co.length) rep.err('V14', 'goals[' + i + ']', 'a goal coordinates at least one progression');
    co.forEach(function (c, j) {
      var at = 'goals[' + i + '].coordinates[' + j + ']';
      if (!ix.progressions[c.progressionId]) rep.err('V14', at, 'unknown progression "' + c.progressionId + '"');
      if ('primary' in c) rep.err('V14', at, 'a coordination link carries no "primary" field — a goal has no single primary progression');
      if ('weight' in c || 'order' in c) rep.err('V14', at, 'a coordination link carries no ranking field');
    });
    var seen = Object.create(null);
    co.forEach(function (c, j) {
      if (seen[c.progressionId]) rep.err('V14', 'goals[' + i + '].coordinates[' + j + ']', 'progression "' + c.progressionId + '" coordinated twice');
      seen[c.progressionId] = true;
    });
  });
}

// =========================================================================
// V15 — exercise-id continuity with the running app (until P13)
// =========================================================================

function v15(ix, continuity, rep) {
  if (!continuity) { rep.note('V15', 'skipped: no app exercise-id sources supplied'); return; }
  var missing = [];
  Object.keys(continuity).sort().forEach(function (id) {
    if (!ix.exercises[id]) missing.push(id + ' (' + continuity[id].join(', ') + ')');
  });
  if (missing.length) {
    rep.err('V15', 'exercises', 'the running app cites exercise ids the bundle does not define, so an observation could not be interpreted: ' + missing.join('; '));
  } else {
    rep.note('V15', 'id continuity: all ' + Object.keys(continuity).length + ' exercise ids cited by the app resolve in the bundle');
  }
}

// =========================================================================
// V16 — semantics completeness against the vocabulary
// =========================================================================

function v16(vocabulary, semanticsList, rep) {
  var dims = byId((vocabulary.dimensions || []).map(function (d) { return { id: d.key, d: d }; }));
  var known = Object.create(null);
  (vocabulary.dimensions || []).forEach(function (d, i) {
    var at = 'vocabulary.dimensions[' + i + ']';
    if (!d.key) { rep.err('V16', at, 'dimension has no key'); return; }
    if (known[d.key]) rep.err('V16', at, 'dimension "' + d.key + '" declared twice');
    known[d.key] = d;
    if (!Array.isArray(d.allowedValues) || !d.allowedValues.length) rep.err('V16', at, 'dimension "' + d.key + '" has no allowedValues');
  });

  semanticsList.forEach(function (s) {
    var at = 'semantics-' + s.version;
    var policies = s.policies || {};
    Object.keys(policies).forEach(function (k) {
      var d = known[k];
      if (!d) { rep.err('V16', at + '.policies.' + k, 'unknown policy dimension "' + k + '" — the vocabulary is the only place a dimension may be introduced'); return; }
      if ((d.allowedValues || []).indexOf(policies[k]) < 0) {
        rep.err('V16', at + '.policies.' + k, 'value "' + policies[k] + '" is not one of [' + (d.allowedValues || []).join(', ') + ']');
      }
    });
    Object.keys(known).forEach(function (k) {
      if (k in policies) return;
      var d = known[k];
      if (d.behaviourPreservingDefault === undefined) {
        rep.err('V16', at, 'dimension "' + k + '" is neither set by this semantics version nor given a behaviour-preserving default in the vocabulary — the evaluator could not resolve it');
      }
    });
  });
  return dims;
}

// =========================================================================
// V17 — context compatibility
// =========================================================================

function v17(contexts, bundles, semanticsList, rep) {
  var byVersion = Object.create(null);
  bundles.forEach(function (b) { byVersion[b.version] = b; });
  var semVersions = Object.create(null);
  semanticsList.forEach(function (s) { semVersions[s.version] = s; });
  var seen = Object.create(null);

  (contexts || []).forEach(function (c, i) {
    var at = 'contexts[' + i + ']';
    if (!c.id) rep.err('V17', at, 'context has no id');
    if (seen[c.id]) rep.err('V17', at, 'context id "' + c.id + '" minted twice');
    seen[c.id] = true;
    if (!c.mintedAt) rep.err('V17', at, 'context "' + c.id + '" has no mintedAt');
    var b = byVersion[c.contentBundleVersion];
    var s = semVersions[c.evaluationSemanticsVersion];
    if (!b) { rep.err('V17', at, 'context "' + c.id + '" names content bundle ' + c.contentBundleVersion + ', which does not exist'); }
    if (!s) { rep.err('V17', at, 'context "' + c.id + '" names evaluation semantics ' + c.evaluationSemanticsVersion + ', which does not exist'); }
    if (b && s) {
      var need = b.requiresSemanticsAtLeast;
      if (need != null && c.evaluationSemanticsVersion < need) {
        rep.err('V17', at, 'context "' + c.id + '" pairs bundle ' + b.version + ' (requires semantics >= ' + need +
          ') with semantics ' + c.evaluationSemanticsVersion + ' — refusing to mint');
      }
    }
  });
}

// =========================================================================
// V18 — behaviour preservation across vocabulary versions
// =========================================================================
// Two halves. The structural half runs now: a vocabulary extension cannot ship
// without a behaviour-preserving default, and every retained semantics version
// must resolve every dimension. The evaluative half — running the §15 fixtures
// through the evaluator and comparing verdicts — needs an evaluator, which does
// not exist until P6a; until one is registered it is reported as PENDING, never
// as a pass.

function v18(vocabulary, semanticsList, options, rep) {
  var vocabVersion = vocabulary.vocabularyVersion;
  (vocabulary.dimensions || []).forEach(function (d, i) {
    var at = 'vocabulary.dimensions[' + i + ']';
    if (d.behaviourPreservingDefault === undefined) {
      rep.err('V18', at, 'dimension "' + d.key + '" declares no behaviourPreservingDefault. A dimension introduced later must reproduce the world before it existed, or every retained semantics version changes meaning the moment it ships.');
      return;
    }
    if ((d.allowedValues || []).indexOf(d.behaviourPreservingDefault) < 0) {
      rep.err('V18', at, 'behaviourPreservingDefault "' + d.behaviourPreservingDefault + '" for "' + d.key + '" is not one of its allowedValues');
    }
    if (d.introducedInVocabulary == null) {
      rep.err('V18', at, 'dimension "' + d.key + '" does not say which vocabulary version introduced it');
    } else if (vocabVersion != null && d.introducedInVocabulary > vocabVersion) {
      rep.err('V18', at, 'dimension "' + d.key + '" claims to be introduced in vocabulary ' + d.introducedInVocabulary + ', later than this vocabulary (' + vocabVersion + ')');
    }
  });

  var fixtures = (options && options.semanticsFixtures) || null;
  if (!fixtures || !fixtures.length) {
    rep.note('V18', 'no behaviour-preservation fixtures supplied — structural half only');
  } else {
    var haveSemantics = Object.create(null);
    semanticsList.forEach(function (s) { haveSemantics[s.version] = true; });
    fixtures.forEach(function (f) {
      var versions = f.semantics || [];
      if (!versions.length) rep.err('V18', 'fixture ' + f.name, 'lists no semantics version, so it proves nothing about behaviour preservation');
      versions.forEach(function (v) {
        var n = typeof v === 'number' ? v : Number(String(v).replace(/^semantics-/, ''));
        if (!haveSemantics[n]) rep.err('V18', 'fixture ' + f.name, 'lists retained semantics version ' + v + ', which is not published');
      });
    });
    if (options.evaluator) {
      fixtures.forEach(function (f) {
        (f.semantics || []).forEach(function (v) {
          var got, want = f.expected;
          try { got = options.evaluator(f, v); } catch (e) {
            rep.err('V18', 'fixture ' + f.name, 'evaluator threw under semantics ' + v + ': ' + e.message);
            return;
          }
          if (JSON.stringify(got) !== JSON.stringify(want)) {
            rep.err('V18', 'fixture ' + f.name, 'verdict changed under semantics ' + v);
          }
        });
      });
    } else {
      rep.note('V18', 'evaluative half PENDING: ' + fixtures.length + ' behaviour-preservation fixtures are loaded and internally checked, but no evaluator is registered. It activates at P6a; until then V18 proves the fixtures and the vocabulary, not the verdicts.');
    }
  }
}

// =========================================================================
// V19 — every criterion has a real assess route
// =========================================================================
// One assess-linked exercise, at one of the criterion's holders, that produces
// EVERY attribute the criterion conditions on, with a compatible side scope.
// Anything less is a criterion nobody can ever clear.

function assessLinksFor(ix, hk) {
  return (ix.linksByHolder[hk] || []).filter(function (l) { return l.relation === 'assess'; });
}

function coversCriterion(ix, link, criterion) {
  var ex = ix.exercises[link.exerciseId];
  if (!ex) return false;
  var produces = ex.producesAttributes || [];
  var covered = (criterion.conditions || []).every(function (cd) { return produces.indexOf(cd.attribute) >= 0; });
  if (!covered) return false;
  // A per-side Criterion needs per-side evidence; a combined Criterion cannot be
  // assessed by a link that only ever reports one side.
  if (criterion.sideScope === 'each') return link.sideScope === 'each' && !!ex.unilateral;
  return link.sideScope === 'combined';
}

function v19(ix, rep) {
  var holdersOf = Object.create(null);
  Object.keys(ix.holders).forEach(function (hk) {
    var h = ix.holders[hk];
    if (!h.requirement) return;
    leafCriteria(h.requirement).forEach(function (cid) {
      (holdersOf[cid] = holdersOf[cid] || []).push(hk);
    });
  });
  (ix.bundle.criteria || []).forEach(function (c, i) {
    var at = 'criteria[' + i + ']';
    var holders = holdersOf[c.id] || [];
    if (!holders.length) {
      rep.err('V19', at, 'criterion "' + c.id + '" is not the requirement of any holder, so nothing could ever assess it');
      return;
    }
    var routes = [];
    holders.forEach(function (hk) {
      assessLinksFor(ix, hk).forEach(function (l) {
        if (coversCriterion(ix, l, c)) routes.push(hk + ' <- ' + l.exerciseId);
      });
    });
    if (!routes.length) {
      rep.err('V19', at, 'criterion "' + c.id + '" has no assess route: no assess-linked exercise at ' +
        holders.join(' / ') + ' produces all of [' +
        (c.conditions || []).map(function (cd) { return cd.attribute; }).join(', ') +
        '] with sideScope "' + (c.sideScope === 'each' ? 'each' : 'combined') +
        '". Evidence eligibility is explicit: a train link cannot stand in for it.');
    }
  });
}

// =========================================================================
// V20 — an assess link asserts something it can perform
// =========================================================================
// Labelling a link `assess` is a claim that observations of that exercise can be
// evaluated against the holder. If it produces no criterion's attributes there,
// the claim is empty and usually means `train` was meant.

function v20(ix, rep) {
  (ix.bundle.exerciseLinks || []).forEach(function (l, i) {
    if (l.relation !== 'assess') return;
    var hk = holderKey(l.target);
    var h = hk && ix.holders[hk];
    if (!h || !h.requirement) return;              // V2 reports an unresolved target
    var assessable = leafCriteria(h.requirement).some(function (cid) {
      var c = ix.criteria[cid];
      return !!c && coversCriterion(ix, l, c);
    });
    if (!assessable) {
      rep.err('V20', 'exerciseLinks[' + i + ']',
        'assess link "' + l.exerciseId + '" -> ' + hk + ' cannot assess any criterion there ' +
        '(attributes or side scope do not match). Did you mean relation "train"?');
    }
  });
}

// =========================================================================
// the whole run
// =========================================================================

/**
 * @param set {
 *   vocabulary, semantics: [ … ], bundles: [ … sorted by version … ],
 *   contexts: [ … ], continuity: { exId: [source, …] } | null,
 *   semanticsFixtures: [ … ] | null, evaluator: fn | null
 * }
 */
function validate(set) {
  var rep = new Report();
  var bundles = (set.bundles || []).slice().sort(function (a, b) { return (a.version || 0) - (b.version || 0); });
  var semanticsList = (set.semantics || []).slice().sort(function (a, b) { return (a.version || 0) - (b.version || 0); });

  if (!set.vocabulary) rep.err('V16', 'vocabulary', 'no policy vocabulary supplied');
  if (!bundles.length) rep.err('V2', 'bundles', 'no content bundle supplied');

  bundles.forEach(function (bundle, i) {
    var previous = i > 0 ? bundles[i - 1] : null;
    var ix = indexBundle(bundle);
    collectHolders(ix);
    v1(ix, rep); v2(ix, rep); v3(ix, rep); v4(ix, rep); v5(ix, rep);
    v6(ix, rep); v7(ix, rep); v8(ix, rep);
    v9(bundle, previous, rep); v10(bundle, previous, rep);
    v11(ix, rep); v12(ix, rep); v13(ix, rep); v14(ix, rep);
    v19(ix, rep); v20(ix, rep);
    if (i === bundles.length - 1) v15(ix, set.continuity, rep);
  });

  if (set.vocabulary) {
    v16(set.vocabulary, semanticsList, rep);
    v18(set.vocabulary, semanticsList, set, rep);
  }
  v17(set.contexts, bundles, semanticsList, rep);
  return rep;
}

// =========================================================================
// loading from disk
// =========================================================================

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error('cannot read ' + file + ': ' + e.message); }
}

function loadContentDir(dir) {
  var files = fs.readdirSync(dir);
  var bundles = [], semantics = [];
  files.filter(function (f) { return /^bundle-\d+\.json$/.test(f); }).forEach(function (f) { bundles.push(readJson(path.join(dir, f))); });
  files.filter(function (f) { return /^semantics-\d+\.json$/.test(f); }).forEach(function (f) { semantics.push(readJson(path.join(dir, f))); });
  var vocabulary = readJson(path.join(dir, 'vocabulary.json'));
  var ctxFile = readJson(path.join(dir, 'contexts.json'));
  var contexts = Array.isArray(ctxFile) ? ctxFile : (ctxFile.contexts || []);
  return { vocabulary: vocabulary, semantics: semantics, bundles: bundles, contexts: contexts };
}

/**
 * The exercise ids the running app cites, read from the app itself rather than
 * from a hand-kept list, so the contract cannot drift silently (V15).
 *   week.js  EX[*].block.exId  — what a logged set of a planned exercise cites
 *            CLIMB_EX          — the climbing session's exercise
 *   data.js  templates[*].blocks[*].exId  and  exercises{} keys
 */
function loadContinuity(repoRoot) {
  repoRoot = path.resolve(repoRoot);   // require() needs a path, not a bare name
  var out = Object.create(null);
  function add(id, source) {
    if (id == null) return;
    (out[id] = out[id] || []);
    if (out[id].indexOf(source) < 0) out[id].push(source);
  }
  var Week = require(path.join(repoRoot, 'week.js'));
  Object.keys(Week.EX || {}).forEach(function (k) {
    var b = Week.EX[k].block;
    if (b && b.exId) add(b.exId, 'week.js block.exId');
  });
  if (Week.CLIMB_EX) add(Week.CLIMB_EX, 'week.js CLIMB_EX');

  var Data = require(path.join(repoRoot, 'data.js'));
  Object.keys(Data.templates || {}).forEach(function (tid) {
    (Data.templates[tid].blocks || []).forEach(function (b) { if (b && b.exId) add(b.exId, 'data.js block.exId'); });
  });
  Object.keys(Data.exercises || {}).forEach(function (id) { add(id, 'data.js exercises'); });
  return out;
}

function loadSemanticsFixtures(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).sort()
    .map(function (f) { return readJson(path.join(dir, f)); });
}

// =========================================================================
// CLI
// =========================================================================

function formatFinding(f) {
  return '  ' + f.rule + '  ' + f.at + '\n        ' + f.message;
}

function main(argv) {
  var repoRoot = path.resolve(__dirname, '..');
  var dir = path.join(repoRoot, 'content');
  var asJson = false, continuity = true;
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') dir = path.resolve(argv[++i]);
    else if (argv[i] === '--json') asJson = true;
    else if (argv[i] === '--no-continuity') continuity = false;
    else { process.stderr.write('unknown argument: ' + argv[i] + '\n'); return 2; }
  }

  var set;
  try {
    set = loadContentDir(dir);
    set.continuity = continuity ? loadContinuity(repoRoot) : null;
    set.semanticsFixtures = loadSemanticsFixtures(path.join(repoRoot, 'tests', 'semantics', 'fixtures'));
    set.evaluator = null;   // registered at P6a
  } catch (e) {
    process.stderr.write('content validator: ' + e.message + '\n');
    return 2;
  }

  var rep = validate(set);
  if (asJson) {
    process.stdout.write(JSON.stringify({ errors: rep.errors, warnings: rep.warnings, notes: rep.notes }, null, 2) + '\n');
    return rep.errors.length ? 1 : 0;
  }

  var counted = set.bundles.map(function (b) { return 'bundle ' + b.version; }).join(', ');
  process.stdout.write('content validator — ' + counted + ', semantics ' +
    set.semantics.map(function (s) { return s.version; }).join(', ') +
    ', ' + set.contexts.length + ' context(s)\n');
  rep.notes.forEach(function (n) { process.stdout.write('  note  ' + n.rule + '  ' + n.message + '\n'); });
  if (rep.warnings.length) {
    process.stdout.write('\n' + rep.warnings.length + ' warning(s) — structural patterns for a human to judge:\n');
    rep.warnings.forEach(function (f) { process.stdout.write(formatFinding(f) + '\n'); });
  }
  if (rep.errors.length) {
    process.stdout.write('\n' + rep.errors.length + ' error(s):\n');
    rep.errors.forEach(function (f) { process.stdout.write(formatFinding(f) + '\n'); });
    process.stdout.write('\nFAIL — invalid content.\n');
    return 1;
  }
  process.stdout.write('\nOK — structurally sound. This says nothing about whether the coaching is right.\n');
  return 0;
}

module.exports = {
  validate: validate,
  loadContentDir: loadContentDir,
  loadContinuity: loadContinuity,
  loadSemanticsFixtures: loadSemanticsFixtures,
  leafCriteria: leafCriteria,
  expressionDepth: expressionDepth,
  LOAD_DIMENSIONS: LOAD_DIMENSIONS
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
