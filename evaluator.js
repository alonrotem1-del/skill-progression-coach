/*
 * Skill Progression Coach — the evaluator (pure, UMD).
 *
 * Technical Schema v1.1 §7 and §9. Given a ledger, an athlete's commitments and
 * one Interpretation Context Package, this answers what the athlete's evidence
 * means under that context — and nothing else. It is the capability P3 needs to
 * record a truthful `context.unmetDependencies` before it appends a row.
 *
 * PURE, and that is load-bearing rather than stylistic:
 *   no storage, no network, no DOM, no app state, no clock, no randomness;
 *   never mutates its inputs; same inputs always produce the same output.
 * Every definition comes from the package passed in, so an athlete pinned to an
 * older context is evaluated by the content and policies they actually adopted
 * (invariant 25 — evaluation reads definitions only from a durable package).
 *
 * WHAT IT DOES NOT DO. It stores nothing (§7: evaluations are a return value,
 * never a row), writes no cache, derives no recommendation, generates no plan,
 * reads no legacy state, and has no authority over anything the athlete sees.
 * It does not consult `spc_c_state` or bench values to fill a gap: an absent
 * fact is an absent fact.
 *
 * THREE DISTINCTIONS IT MUST NOT COLLAPSE.
 *
 *   Criterion vs Dependency. A Criterion is a local demonstrated condition. A
 *   Dependency relates independently evaluated holder states and carries no
 *   threshold of its own (invariant 05), so asking "is this dependency met?"
 *   means evaluating the holder it references by that holder's own requirement.
 *
 *   Provenance vs validity. `provenance` is a permanent field on the
 *   observation; validity is not a field at all (§7). A demonstrated row stays
 *   demonstrated when it is excluded from one unlock, and the same row can be
 *   cited by one evaluation and excluded by another in the same instant.
 *
 *   Stored context vs recomputed history. A past row carries the
 *   `unmetDependencies` that were true when it was recorded. That is historical
 *   fact and is READ, never recomputed — which is exactly what keeps dependency
 *   evaluation from being circular.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CoachEvaluator = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATUS_SATISFIED = 'satisfied';
  var STATUS_PROVISIONAL = 'provisional';
  var STATUS_UNSATISFIED = 'unsatisfied';

  // The policy vocabulary ships with the engine and is deliberately NOT packaged
  // (Technical Schema §16). A dimension a stored semantics set predates resolves
  // to the value that reproduces the world before that dimension existed.
  var POLICY_DEFAULTS = {
    supersession: 'best_applicable',
    provenancePrecedence: 'demonstrated_supersedes',
    claimedEligibility: 'provisional_ordinary',
    claimedAtHardDependency: 'refuse',
    claimedAtGoalTerminal: 'refuse',
    dependencyInvalidEvidence: 'exclude',
    missingAttribute: 'cannot_satisfy',
    criterionComposition: 'one_observation',
    holderComposition: 'all_criteria_any_observation',
    expressionStatusCombination: 'strict',
    stageSelection: 'lowest_unsatisfied',
    sideAggregation: 'combined_cannot_satisfy_each',
    freshness: 'none',
    regression: 'none'
  };

  // Only these values are implemented. A package asking for anything else is an
  // error rather than a silent fallback: an evaluator that quietly ignored a
  // policy would reinterpret an athlete without telling anyone.
  var POLICY_IMPLEMENTED = {
    supersession: ['best_applicable'],
    provenancePrecedence: ['demonstrated_supersedes'],
    claimedEligibility: ['provisional_ordinary', 'none'],
    claimedAtHardDependency: ['refuse'],
    claimedAtGoalTerminal: ['refuse', 'admit'],
    dependencyInvalidEvidence: ['exclude'],
    missingAttribute: ['cannot_satisfy'],
    criterionComposition: ['one_observation'],
    holderComposition: ['all_criteria_any_observation'],
    expressionStatusCombination: ['strict'],
    stageSelection: ['lowest_unsatisfied'],
    sideAggregation: ['combined_cannot_satisfy_each'],
    freshness: ['none'],
    regression: ['none']
  };

  // ---- side ---------------------------------------------------------------
  // A combined-scope Criterion is evaluated on the null side. `combined` is the
  // name that side goes by in a key, because a key needs a token.
  var COMBINED = 'combined';
  function normSide(side) {
    if (side === null || side === undefined || side === COMBINED) return COMBINED;
    return side;
  }

  // ---- reading the package ------------------------------------------------

  function policy(pkg, dimension) {
    var policies = (pkg && pkg.evaluationSemantics && pkg.evaluationSemantics.policies) || {};
    var value = (dimension in policies) ? policies[dimension] : POLICY_DEFAULTS[dimension];
    if (value === undefined) throw new Error('unknown policy dimension: ' + dimension);
    var allowed = POLICY_IMPLEMENTED[dimension];
    if (allowed.indexOf(value) < 0) {
      throw new Error('this evaluator does not implement ' + dimension + ' = ' + value +
        ' (implemented: ' + allowed.join(', ') + ')');
    }
    return value;
  }

  /**
   * Refuse a package this evaluator cannot honour, before answering anything.
   *
   * `policy()` alone is not enough: a dimension is only consulted where it
   * changes an answer, so an unimplemented `freshness` would pass unnoticed
   * precisely because ignoring it is what the bug looks like. Every dimension
   * the vocabulary defines is therefore resolved on entry, so a package asking
   * for behaviour that is not here fails loudly instead of being answered as
   * though its policies had been applied.
   */
  function assertPolicies(pkg) {
    for (var dimension in POLICY_DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(POLICY_DEFAULTS, dimension)) policy(pkg, dimension);
    }
  }

  function holderKeyOf(ref) {
    if (!ref) return null;
    if (typeof ref === 'string') return ref;
    if (ref.kind === 'progression') return 'progression:' + ref.progressionId;
    if (ref.kind === 'stage') return 'stage:' + ref.stageId;
    if (ref.kind === 'goalTerminal') return 'goalTerminal:' + ref.goalId;
    return null;
  }

  function leafCriteria(expr, out) {
    out = out || [];
    if (!expr || typeof expr !== 'object') return out;
    if (typeof expr.criterion === 'string') { out.push(expr.criterion); return out; }
    ['allOf', 'anyOf'].forEach(function (op) {
      if (Array.isArray(expr[op])) expr[op].forEach(function (child) { leafCriteria(child, out); });
    });
    return out;
  }

  // One pass over the bundle. Read-only: nothing here writes back into it.
  function index(pkg) {
    assertPolicies(pkg);
    var bundle = (pkg && pkg.contentBundle) || {};
    var ix = {
      bundle: bundle,
      attributes: {}, exercises: {}, criteria: {}, progressions: {}, goals: {}, dependencies: {},
      stageOwner: {},          // stageId -> progression
      requirement: {},         // holderKey -> RequirementExpression
      holdersOfCriterion: {},  // criterionId -> [holderKey]
      assessLinks: {}          // holderKey -> [ExerciseLink] (assess only)
    };
    (bundle.attributes || []).forEach(function (a) { ix.attributes[a.id] = a; });
    (bundle.exercises || []).forEach(function (e) { ix.exercises[e.id] = e; });
    (bundle.criteria || []).forEach(function (c) { ix.criteria[c.id] = c; });
    (bundle.goals || []).forEach(function (g) { ix.goals[g.id] = g; });
    (bundle.dependencies || []).forEach(function (d) { ix.dependencies[d.id] = d; });

    function hold(key, requirement) {
      ix.requirement[key] = requirement;
      leafCriteria(requirement).forEach(function (cid) {
        (ix.holdersOfCriterion[cid] = ix.holdersOfCriterion[cid] || []).push(key);
      });
    }
    (bundle.progressions || []).forEach(function (p) {
      ix.progressions[p.id] = p;
      if (p.form === 'DIRECT') hold('progression:' + p.id, p.requirement);
      (p.stages || []).forEach(function (s) {
        ix.stageOwner[s.id] = p;
        hold('stage:' + s.id, s.requirement);
      });
    });
    (bundle.goals || []).forEach(function (g) { hold('goalTerminal:' + g.id, g.terminalRequirement); });

    // LOCKED by content/CONTRACT.md and Technical Schema §4: `assess` is the
    // evidence-eligible relation. `train` and `maintain` are prescription
    // relationships, so they are not indexed here at all — an observation that
    // reaches a holder only through one of them is not evidence about that
    // holder's Criteria. This is structural, not a policy dimension: it cannot
    // vary between EvaluationSemantics versions.
    (bundle.exerciseLinks || []).forEach(function (l) {
      if (l.relation !== 'assess') return;
      var k = holderKeyOf(l.target);
      if (!k) return;
      (ix.assessLinks[k] = ix.assessLinks[k] || []).push(l);
    });
    return ix;
  }

  // ---- conditions ---------------------------------------------------------

  function gradeRank(ix, attributeId, value) {
    var a = ix.attributes[attributeId];
    var scale = (a && a.scale) || [];
    return scale.indexOf(value);
  }

  function compare(op, got, want) {
    switch (op) {
      case 'gte': return got >= want;
      case 'gt': return got > want;
      case 'lte': return got <= want;
      case 'lt': return got < want;
      case 'eq': return got === want;
      case 'neq': return got !== want;
      default: return false;
    }
  }

  function conditionHolds(ix, cond, value) {
    var attr = ix.attributes[cond.attribute];
    if (!attr) return false;
    if (attr.type === 'grade') {
      var got = gradeRank(ix, cond.attribute, value);
      var want = gradeRank(ix, cond.attribute, cond.value);
      if (got < 0 || want < 0) return false;
      return compare(cond.op, got, want);
    }
    if (attr.type === 'flag') {
      if (cond.op === 'eq') return value === cond.value;
      if (cond.op === 'neq') return value !== cond.value;
      return false;
    }
    return compare(cond.op, value, cond.value);
  }

  function primaryCondition(criterion) {
    var conds = criterion.conditions || [];
    for (var i = 0; i < conds.length; i++) {
      if (conds[i].attribute === criterion.primaryAttribute) return conds[i];
    }
    return null;
  }

  // ---- one observation against one criterion on one side ------------------
  // Returns a standing, not a verdict:
  //   'not_applicable'  this row is not evidence about this Criterion
  //   'meets'           admissible, every condition holds
  //   'short'           admissible, some condition does not hold
  //   <reason>          admissible-looking but set aside, with a §7 reason

  function rowStanding(ix, pkg, obs, criterion, side, holders) {
    // Admissible only through an assess link at a holder of this Criterion.
    var applicable = holders.filter(function (hk) {
      return (ix.assessLinks[hk] || []).some(function (l) { return l.exerciseId === obs.exerciseId; });
    });
    if (!applicable.length) return { standing: 'not_applicable' };

    // An exercise that does not record what the Criterion asks about is not
    // evidence for it — distinct from recording it and leaving it blank, below.
    var ex = ix.exercises[obs.exerciseId];
    var produces = (ex && ex.producesAttributes) || [];
    var needed = (criterion.conditions || []).map(function (c) { return c.attribute; });
    var covers = needed.every(function (a) { return produces.indexOf(a) >= 0; });
    if (!covers) return { standing: 'not_applicable' };

    // sideAggregation: combined_cannot_satisfy_each. A bilateral measurement
    // cannot stand in for one side, and a one-sided row is not bilateral.
    if (criterion.sideScope === 'each') {
      if (normSide(obs.side) !== normSide(side)) return { standing: 'wrong_side' };
    } else if (obs.side === 'left' || obs.side === 'right') {
      return { standing: 'wrong_side' };
    }

    // missingAttribute: cannot_satisfy — the tri-state rule. An absent value is
    // an unanswered question, not a pass and not the athlete's failure.
    if (policy(pkg, 'missingAttribute') === 'cannot_satisfy') {
      var attrs = obs.attributes || {};
      for (var i = 0; i < needed.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(attrs, needed[i])) {
          return { standing: 'missing_attribute(' + needed[i] + ')' };
        }
      }
    }

    if (obs.provenance === 'claimed') {
      if (policy(pkg, 'claimedEligibility') === 'none') {
        return { standing: 'claimed_not_eligible' };
      }
      // A Goal is not achieved on the athlete's word.
      var atTerminal = applicable.some(function (hk) { return hk.indexOf('goalTerminal:') === 0; });
      if (atTerminal && policy(pkg, 'claimedAtGoalTerminal') === 'refuse') {
        return { standing: 'claimed_not_eligible' };
      }
    }

    // dependencyInvalidEvidence: exclude. Read from the row's OWN stored
    // context — never recomputed from the timeline.
    var depId = invalidatingDependency(ix, obs, applicable, side);
    if (depId) return { standing: 'dependency_unmet(' + depId + ')' };

    var holds = (criterion.conditions || []).every(function (c) {
      return conditionHolds(ix, c, (obs.attributes || {})[c.attribute]);
    });
    return { standing: holds ? 'meets' : 'short' };
  }

  // Which unmet Dependency, as recorded on the row at the time, invalidates it
  // as evidence for one of these holders. Only a Dependency that constrains
  // evidence_validity can do this.
  function invalidatingDependency(ix, obs, holderKeys, side) {
    var unmet = (obs.context && obs.context.unmetDependencies) || [];
    for (var i = 0; i < unmet.length; i++) {
      var dep = ix.dependencies[unmet[i]];
      if (!dep) continue;
      if ((dep.constrains || []).indexOf('evidence_validity') < 0) continue;
      var subject = holderKeyOf(dep.subject);
      if (holderKeys.indexOf(subject) < 0) continue;
      if (dep.sideRule === 'mirror' && normSide(side) !== COMBINED &&
          normSide(obs.side) !== normSide(side)) continue;
      return unmet[i];
    }
    return null;
  }

  // ---- picking the observation to cite ------------------------------------
  // supersession: best_applicable — the best applicable value wins, whatever
  // order the rows arrived in. provenancePrecedence: demonstrated_supersedes —
  // when a demonstration is available it is what gets reported, even if a claim
  // reads higher. Both records survive either way; this only decides the
  // citation.

  function occurredRank(obs) {
    // §6: a row with occurredAt 'unknown' is never treated as more recent than
    // a dated one.
    if (!obs.occurredAt || obs.occurredAt === 'unknown') return -Infinity;
    var t = Date.parse(obs.occurredAt);
    return isNaN(t) ? -Infinity : t;
  }

  function betterValue(ix, criterion, a, b) {
    var cond = primaryCondition(criterion);
    var attr = ix.attributes[criterion.primaryAttribute];
    var av = (a.attributes || {})[criterion.primaryAttribute];
    var bv = (b.attributes || {})[criterion.primaryAttribute];
    if (av === undefined) return false;
    if (bv === undefined) return true;
    if (attr && attr.type === 'grade') {
      av = gradeRank(ix, criterion.primaryAttribute, av);
      bv = gradeRank(ix, criterion.primaryAttribute, bv);
    }
    if (attr && attr.type === 'flag') {
      // "Better" for a flag is meeting the condition; otherwise neither is.
      var aOk = cond ? conditionHolds(ix, cond, (a.attributes || {})[criterion.primaryAttribute]) : false;
      var bOk = cond ? conditionHolds(ix, cond, (b.attributes || {})[criterion.primaryAttribute]) : false;
      if (aOk !== bOk) return aOk;
      return false;
    }
    var lowerIsBetter = cond && (cond.op === 'lte' || cond.op === 'lt');
    if (av !== bv) return lowerIsBetter ? av < bv : av > bv;
    return false;
  }

  function pickBest(ix, pkg, criterion, candidates) {
    if (!candidates.length) return null;
    var pool = candidates;
    if (policy(pkg, 'provenancePrecedence') === 'demonstrated_supersedes') {
      var demonstrated = candidates.filter(function (o) { return o.provenance === 'demonstrated'; });
      if (demonstrated.length) pool = demonstrated;
    }
    var best = pool[0];
    for (var i = 1; i < pool.length; i++) {
      var o = pool[i];
      if (betterValue(ix, criterion, o, best)) { best = o; continue; }
      if (betterValue(ix, criterion, best, o)) continue;
      // Equal on the primary attribute: the more recent row, then the later seq.
      var ro = occurredRank(o), rb = occurredRank(best);
      if (ro > rb || (ro === rb && o.seq > best.seq)) best = o;
    }
    return best;
  }

  function unitOf(ix, attributeId) {
    var a = ix.attributes[attributeId];
    return (a && a.unit) || '';
  }

  function shortfallText(ix, criterion, best) {
    if (!best) return null;
    var cond = primaryCondition(criterion);
    if (!cond) return null;
    var attr = ix.attributes[criterion.primaryAttribute];
    if (!attr || attr.type !== 'quantity') return null;
    if (cond.op !== 'gte' && cond.op !== 'gt') return null;
    var have = (best.attributes || {})[criterion.primaryAttribute];
    if (typeof have !== 'number') return null;
    var need = cond.op === 'gt' ? cond.value + 1 : cond.value;
    var by = need - have;
    if (by <= 0) return null;
    var unit = unitOf(ix, criterion.primaryAttribute);
    if (unit === 'reps' && by === 1) unit = 'rep';
    if (unit === 'seconds' && by === 1) unit = 'second';
    return 'short by ' + by + (unit ? ' ' + unit : '');
  }

  // ---- §7 CriterionEvaluation --------------------------------------------

  function evaluateCriterion(criterionId, side, ledger, pkg, ix) {
    ix = ix || index(pkg);
    var criterion = ix.criteria[criterionId];
    if (!criterion) throw new Error('unknown criterion: ' + criterionId);
    var s = normSide(side);
    if (criterion.sideScope === 'each' && s === COMBINED) {
      throw new Error('criterion ' + criterionId + ' is per-side; evaluate it on left or right');
    }
    var holders = ix.holdersOfCriterion[criterionId] || [];
    var rows = ledger || [];

    var satisfiedBy = [], excluded = [], admissible = [];
    for (var i = 0; i < rows.length; i++) {
      var obs = rows[i];
      var res = rowStanding(ix, pkg, obs, criterion, s, holders);
      if (res.standing === 'not_applicable') continue;
      if (res.standing === 'meets') { satisfiedBy.push(obs.seq); admissible.push(obs); continue; }
      if (res.standing === 'short') { admissible.push(obs); continue; }
      excluded.push({ seq: obs.seq, reason: res.standing });
    }

    // A claim may provisionally satisfy an ordinary Criterion; a demonstration
    // is what makes it satisfied. Both rows stay in satisfiedBy — provenance
    // decides the STATUS, never membership.
    var citedRows = rows.filter(function (o) { return satisfiedBy.indexOf(o.seq) >= 0; });
    var status = STATUS_UNSATISFIED;
    if (citedRows.length) {
      status = citedRows.some(function (o) { return o.provenance === 'demonstrated'; })
        ? STATUS_SATISFIED : STATUS_PROVISIONAL;
    }

    var best = pickBest(ix, pkg, criterion, admissible);
    var conditionResults = (criterion.conditions || []).map(function (c) {
      var observed = best ? (best.attributes || {})[c.attribute] : undefined;
      return {
        attribute: c.attribute,
        required: { op: c.op, value: c.value },
        observed: observed === undefined ? null : observed,
        pass: best ? conditionHolds(ix, c, observed) : false
      };
    });

    return {
      criterionId: criterionId,
      side: s,
      contextId: (pkg && pkg.contextId) || null,
      status: status,
      conditionResults: conditionResults,
      satisfiedBy: satisfiedBy.slice().sort(function (a, b) { return a - b; }),
      excluded: excluded,
      bestObservation: best ? {
        seq: best.seq,
        attribute: criterion.primaryAttribute,
        value: (best.attributes || {})[criterion.primaryAttribute]
      } : null,
      shortfall: status === STATUS_SATISFIED ? null : shortfallText(ix, criterion, best)
    };
  }

  // ---- RequirementExpression ---------------------------------------------
  // expressionStatusCombination: strict. allOf is satisfied iff every child is,
  // provisional if all are satisfied-or-provisional with at least one
  // provisional; anyOf is satisfied iff any child is, provisional if any is.
  // The bounded vocabulary is a leaf, allOf and anyOf — nothing else, and depth
  // is whatever the validator already permits.

  function combine(expr, statusOf, pkg) {
    if (!expr || typeof expr !== 'object') throw new Error('requirement is not an expression');
    if (typeof expr.criterion === 'string') return statusOf(expr.criterion);
    var op = Array.isArray(expr.allOf) ? 'allOf' : (Array.isArray(expr.anyOf) ? 'anyOf' : null);
    if (!op) throw new Error('requirement is neither a criterion leaf nor allOf/anyOf');
    var kids = expr[op].map(function (child) { return combine(child, statusOf, pkg); });
    if (!kids.length) throw new Error('empty ' + op);
    if (op === 'allOf') {
      if (kids.every(function (x) { return x === STATUS_SATISFIED; })) return STATUS_SATISFIED;
      if (kids.every(function (x) { return x === STATUS_SATISFIED || x === STATUS_PROVISIONAL; })) return STATUS_PROVISIONAL;
      return STATUS_UNSATISFIED;
    }
    if (kids.some(function (x) { return x === STATUS_SATISFIED; })) return STATUS_SATISFIED;
    if (kids.some(function (x) { return x === STATUS_PROVISIONAL; })) return STATUS_PROVISIONAL;
    return STATUS_UNSATISFIED;
  }

  function evaluateHolder(holderRef, ledger, pkg, side, ix) {
    ix = ix || index(pkg);
    var key = holderKeyOf(holderRef);
    var requirement = ix.requirement[key];
    if (!requirement) throw new Error('unknown holder: ' + key);
    var criteria = {};
    var status = combine(requirement, function (cid) {
      var c = ix.criteria[cid];
      if (!c) throw new Error('requirement names unknown criterion: ' + cid);
      // A per-side Criterion inside a combined-scope question is evaluated on
      // the side asked for; a combined one ignores the side, as its scope says.
      var s = c.sideScope === 'each' ? normSide(side) : COMBINED;
      var ev = evaluateCriterion(cid, s, ledger, pkg, ix);
      criteria[cid] = ev;
      return ev.status;
    }, pkg);
    return { holderKey: key, side: normSide(side), status: status, criteria: criteria };
  }

  // The primary capability P3 needs. Satisfied means satisfied: a provisional
  // holder is not satisfied.
  function isHolderSatisfied(holderRef, ledgerRows, contextPackage, side) {
    return evaluateHolder(holderRef, ledgerRows, contextPackage, side).status === STATUS_SATISFIED;
  }

  // ---- Dependencies -------------------------------------------------------
  // A Dependency carries no threshold (invariant 05): it is met exactly when the
  // holder it references is satisfied by that holder's own requirement. No
  // second threshold is invented here, and the referenced holder's Criteria are
  // never copied into the dependent one.

  function dependencySides(dep) {
    return dep.sideRule === 'mirror' ? ['left', 'right'] : [COMBINED];
  }

  function evaluateDependency(dependencyId, ledger, pkg, side, ix) {
    ix = ix || index(pkg);
    var dep = ix.dependencies[dependencyId];
    if (!dep) throw new Error('unknown dependency: ' + dependencyId);
    var s = normSide(side);
    var required = evaluateHolder(dep.requires, ledger, pkg, s, ix);
    var met = required.status === STATUS_SATISFIED;
    var reason = null;
    if (!met) {
      // Admissible evidence exists when some Criterion found a best observation
      // to measure against — whether or not that observation cleared the bar.
      // "short of the requirement" and "nothing to go on" are different answers
      // and P3 will want to say different things about them.
      var anyEvidence = Object.keys(required.criteria).some(function (cid) {
        return required.criteria[cid].bestObservation !== null;
      });
      // claimedAtHardDependency: refuse — a claim may not unblock a hard
      // Dependency, and saying so is more useful than "no evidence".
      reason = (required.status === STATUS_PROVISIONAL && dep.severity === 'hard')
        ? 'claimed_not_eligible'
        : (anyEvidence ? 'requirement_unsatisfied' : 'no_evidence');
    }
    return {
      dependencyId: dependencyId,
      side: s,
      met: met,
      reason: reason,
      severity: dep.severity,
      constrains: (dep.constrains || []).slice(),
      requires: holderKeyOf(dep.requires),
      blocks: met ? [] : [holderKeyOf(dep.subject)]
    };
  }

  /**
   * Every Dependency that is unmet right now, as P3 will ask it: the list a new
   * observation records in its own context. Optionally narrowed to the
   * Dependencies whose subject is one of `holderKeys`, and to one side.
   */
  function unmetDependencies(ledger, pkg, opts) {
    opts = opts || {};
    var ix = index(pkg);
    var wantHolders = opts.holderKeys || null;
    var wantSide = opts.side === undefined ? null : normSide(opts.side);
    var out = [];
    (ix.bundle.dependencies || []).forEach(function (dep) {
      if (wantHolders && wantHolders.indexOf(holderKeyOf(dep.subject)) < 0) return;
      dependencySides(dep).forEach(function (s) {
        if (wantSide && s !== COMBINED && s !== wantSide) return;
        var res = evaluateDependency(dep.id, ledger, pkg, s, ix);
        if (!res.met) out.push({ dependencyId: dep.id, side: s, reason: res.reason, severity: dep.severity });
      });
    });
    return out;
  }

  // ---- stage selection ----------------------------------------------------
  // stageSelection: lowest_unsatisfied. The current Stage is the lowest-order
  // one that is not satisfied — a gap is not skipped because something above it
  // happens to be cleared. null means every Stage is satisfied.

  function currentStage(progressionId, ledger, pkg, side, ix) {
    ix = ix || index(pkg);
    var p = ix.progressions[progressionId];
    if (!p) throw new Error('unknown progression: ' + progressionId);
    if (p.form !== 'STAGED') throw new Error('progression ' + progressionId + ' is DIRECT and has no stages');
    var ordered = (p.stages || []).slice().sort(function (a, b) { return a.order - b.order; });
    for (var i = 0; i < ordered.length; i++) {
      var st = evaluateHolder('stage:' + ordered[i].id, ledger, pkg, side, ix);
      if (st.status !== STATUS_SATISFIED) return ordered[i].id;
    }
    return null;
  }

  /**
   * The limiting Progression for a Goal on one side, among a caller-supplied
   * scope of Progressions. The scope is required on purpose: WHICH incomplete
   * capability to name is a presentation choice, not a semantics dimension, and
   * this function will not invent one. Within the scope the rule is
   * mechanical — the first coordinated Progression, in the Goal's own
   * coordinate order, that is not complete.
   */
  function limiter(goalId, ledger, pkg, side, scopeProgressions, ix) {
    ix = ix || index(pkg);
    var goal = ix.goals[goalId];
    if (!goal) throw new Error('unknown goal: ' + goalId);
    if (!Array.isArray(scopeProgressions) || !scopeProgressions.length) {
      throw new Error('limiter() needs an explicit scope of progressions to choose among');
    }
    var coords = (goal.coordinates || []).filter(function (co) {
      return scopeProgressions.indexOf(co.progressionId) >= 0;
    });
    for (var i = 0; i < coords.length; i++) {
      var p = ix.progressions[coords[i].progressionId];
      if (!p) continue;
      var complete = p.form === 'STAGED'
        ? currentStage(p.id, ledger, pkg, side, ix) === null
        : evaluateHolder('progression:' + p.id, ledger, pkg, side, ix).status === STATUS_SATISFIED;
      if (!complete) return p.id;
    }
    return null;
  }

  // ---- interpret ----------------------------------------------------------
  /**
   * The §15 harness entry point: answers a set of named questions about one
   * ledger under one package. The caller says which questions; the evaluator
   * supplies only the answers, so nothing here decides what "everything" means.
   *
   * query = {
   *   evaluations:  ['<criterionId>|<side>|<contextId>', …]
   *   holders:      ['<holderKey>|<side>', …]
   *   currentStage: ['<progressionId>|<side>', …]
   *   limiters:     ['<goalId>|<side>', …]      (needs query.scopeProgressions)
   *   dependencies: ['<dependencyId>|<side>', …]
   *   scopeProgressions: ['<progressionId>', …]
   * }
   */
  function interpret(ledger, commitments, pkg, query) {
    query = query || {};
    var ix = index(pkg);
    var out = {};

    if (query.evaluations) {
      out.evaluations = {};
      query.evaluations.forEach(function (key) {
        var parts = key.split('|');
        var ev = evaluateCriterion(parts[0], parts[1], ledger, pkg, ix);
        out.evaluations[key] = {
          status: ev.status,
          satisfiedBy: ev.satisfiedBy,
          excluded: ev.excluded,
          bestObservation: ev.bestObservation,
          shortfall: ev.shortfall
        };
      });
    }
    if (query.holders) {
      out.holders = {};
      query.holders.forEach(function (key) {
        var parts = key.split('|');
        out.holders[key] = { status: evaluateHolder(parts[0], ledger, pkg, parts[1], ix).status };
      });
    }
    if (query.currentStage) {
      out.currentStage = {};
      query.currentStage.forEach(function (key) {
        var parts = key.split('|');
        out.currentStage[key] = currentStage(parts[0], ledger, pkg, parts[1], ix);
      });
    }
    if (query.limiters) {
      out.limiters = {};
      query.limiters.forEach(function (key) {
        var parts = key.split('|');
        out.limiters[key] = limiter(parts[0], ledger, pkg, parts[1], query.scopeProgressions, ix);
      });
    }
    if (query.dependencies) {
      out.dependencies = {};
      query.dependencies.forEach(function (key) {
        var parts = key.split('|');
        var d = evaluateDependency(parts[0], ledger, pkg, parts[1], ix);
        out.dependencies[key] = { met: d.met, reason: d.reason, blocks: d.blocks };
      });
    }
    return out;
  }

  return {
    STATUS: { SATISFIED: STATUS_SATISFIED, PROVISIONAL: STATUS_PROVISIONAL, UNSATISFIED: STATUS_UNSATISFIED },
    COMBINED: COMBINED,
    POLICY_DEFAULTS: POLICY_DEFAULTS,

    isHolderSatisfied: isHolderSatisfied,
    evaluateHolder: evaluateHolder,
    evaluateCriterion: evaluateCriterion,
    evaluateDependency: evaluateDependency,
    unmetDependencies: unmetDependencies,
    currentStage: currentStage,
    limiter: limiter,
    interpret: interpret,

    // Read helpers the harness and the validator use; no evaluation in them.
    policy: policy,
    holderKeyOf: holderKeyOf,
    leafCriteria: leafCriteria,
    dependencySides: dependencySides,
    _index: index
  };
});
