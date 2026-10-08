/*
 * Skill Progression Coach — shadow evaluation (P6b). PURE, UMD, OBSERVATIONAL.
 *
 * P6b runs the new evaluator against the real Evidence ledger and compares what
 * it concludes with what the legacy product currently believes about the same
 * athlete. It answers "is the new model ready?" and nothing else.
 *
 * IT HAS NO AUTHORITY, AND NO PATH TO ANY. This module reads; it never writes.
 * It takes the legacy state as an argument and returns a report. Nothing in the
 * product may read that report back — the guardrail test enforces one-way
 * observation, because the moment a planning path consults a shadow verdict the
 * migration has silently become a cutover.
 *
 * PURE. No storage, no clock, no DOM, no network, no app state. The caller
 * supplies the ledger, the context package and the legacy state; this returns a
 * plain object. Determinism is a requirement, not a nicety: the same inputs must
 * give byte-identical output, so holders are walked in authored bundle order,
 * sides in a fixed order, and cited rows sorted by sequence. Nothing here reads
 * the clock, so a snapshot carries no timestamp — its identity is the highest
 * ledger sequence it saw.
 *
 * IT DOES NOT RE-IMPLEMENT THE EVALUATOR. Every verdict in a snapshot comes from
 * CoachEvaluator. This module only decides WHICH holders to ask about, WHICH
 * legacy facts are legitimately comparable, and HOW to name a difference.
 *
 * ON NOT FORCING EQUIVALENCE. The legacy world is a Bar Muscle-Up tree seeded
 * from benchmarks; the new content is a Ring Muscle-Up goal and a Pistol Squat
 * goal evaluated from observations. They are not the same model and most of
 * their parts do not correspond. Inventing a mapping so that every holder gets a
 * tidy true/false would manufacture agreement and hide exactly the differences
 * P6b exists to surface. So the mapping table below is AUTHORED, every entry
 * carries its rationale, and holders with no honest counterpart are reported as
 * new_model_only rather than compared to something that merely sounds similar.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CoachShadow = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- comparison vocabulary ----------------------------------------------
  // Fixed and small. A difference is not a bug, and "we could not compare" is a
  // real answer that must not be collapsed into "they disagree".
  var CLASS = {
    MATCH: 'comparable_match',
    DIFFERENCE: 'comparable_difference',
    NEW_ONLY: 'new_model_only',
    INSUFFICIENT: 'insufficient_evidence',
    LEGACY_ONLY: 'legacy_only',
    NOT_COMPARABLE: 'not_comparable'
  };

  var REASON = {
    MISSING_EVIDENCE: 'missing_evidence',
    CLAIMED: 'claimed_vs_demonstrated',
    INVALID: 'progression_invalid_evidence',
    DEPENDENCY: 'unmet_dependency',
    SIDE: 'side_mismatch',
    THRESHOLD: 'criterion_threshold_difference',
    CONTENT: 'content_model_difference',
    LEGACY_NO_EVIDENCE: 'legacy_state_without_evidence',
    SUSPECT: 'evaluator_or_mapping_suspect',
    UNKNOWN: 'unknown'
  };

  // ---- the authored mapping table -----------------------------------------
  //
  // STRONG means: the same capability, measured on the same exercise, by the
  // same attribute. Only a strong mapping may produce a match or a difference.
  // A differing threshold does not weaken a mapping — it is the difference, and
  // it gets named.
  //
  // WEAK means: related enough to be worth printing beside each other, not
  // close enough for a verdict. Weak mappings are diagnostic context only and
  // always classify as not_comparable.
  //
  // Everything absent from this table has NO mapping, deliberately.
  var MAPPINGS = [
    { holderKey: 'stage:rmu_pull_s1', legacyNodeId: 'mu_pull1', strength: 'strong',
      rationale: 'Same exercise (pullup assesses this stage), same attribute (reps), same threshold (1). The new criterion additionally requires kip=false, which the legacy node never recorded.' },
    { holderKey: 'stage:rmu_pull_s2', legacyNodeId: 'mu_pull5', strength: 'strong',
      rationale: 'Same exercise (pullup), same attribute (reps), same threshold (5). New criterion adds kip=false.' },
    { holderKey: 'stage:rmu_pull_s3', legacyNodeId: 'mu_pull10', strength: 'strong',
      rationale: 'Same exercise (pullup), same attribute (reps), same threshold (10). New criterion adds kip=false.' },
    { holderKey: 'stage:rmu_exp_s1', legacyNodeId: 'mu_fastpull', strength: 'strong',
      rationale: 'Same exercise (fastpull), same attribute (reps). Thresholds differ by content decision: legacy 5, new 3.' },
    { holderKey: 'stage:rmu_exp_s2', legacyNodeId: 'mu_c2b', strength: 'strong',
      rationale: 'Same exercise (c2b), same attribute (reps), same threshold (3).' },
    { holderKey: 'stage:rmu_dip_s1', legacyNodeId: 'mu_dip5', strength: 'strong',
      rationale: 'Same exercise (dip, straight bar), same attribute (reps), same threshold (5).' },

    // ---- weak: printed for context, never scored ----
    { holderKey: 'progression:rmu_false_grip', legacyNodeId: 'mu_deadhang', strength: 'weak',
      rationale: 'Both are 30-second hangs, but the new progression is assessed by fg_hang (false grip) while the legacy node measures a plain dead hang. Bundle 1 links deadhang as train, not assess, so a dead hang is deliberately not evidence here.' },
    { holderKey: 'stage:rmu_sup_s1', legacyNodeId: 'mu_support', strength: 'weak',
      rationale: 'Support holds on different apparatus: rings at 20s (new) against a straight bar at 15s (legacy). Ring support was deliberately given its own exercise id so ring evidence stays ring evidence.' },
    { holderKey: 'stage:rmu_trans_s1', legacyNodeId: 'mu_lowtrans', strength: 'weak',
      rationale: 'Low transition drill on rings, measured in reps and catch quality (new), against a low-bar drill measured in sessions (legacy). Different apparatus and a different kind of measurement.' },
    { holderKey: 'goalTerminal:ring_muscle_up', legacyNodeId: 'mu_firstmu', strength: 'weak',
      rationale: 'Different goals. The legacy world terminates at a BAR muscle-up; the new goal is a RING muscle-up. Printing them together is useful context and nothing more.' }
  ];

  function mappingFor(holderKey) {
    for (var i = 0; i < MAPPINGS.length; i++) {
      if (MAPPINGS[i].holderKey === holderKey) return MAPPINGS[i];
    }
    return null;
  }

  // ---- which holders are relevant, in a deterministic order ----------------
  // Straight from the bundle: each goal's terminal, then each coordinate
  // progression in authored order, then that progression's stages in `order`.
  // Object key iteration is never used to decide sequence.
  function relevantHolders(bundle) {
    var out = [];
    var progs = {};
    (bundle.progressions || []).forEach(function (p) { progs[p.id] = p; });

    (bundle.goals || []).forEach(function (g) {
      out.push({ holderKey: 'goalTerminal:' + g.id, kind: 'goalTerminal',
        goalId: g.id, expression: g.terminalRequirement });
      (g.coordinates || []).forEach(function (c) {
        var p = progs[c.progressionId];
        if (!p) return;
        var stages = (p.stages || []).slice().sort(function (a, b) {
          return (a.order || 0) - (b.order || 0);
        });
        if (!stages.length) {
          out.push({ holderKey: 'progression:' + p.id, kind: 'progression',
            goalId: g.id, progressionId: p.id, staged: false, expression: p.requirement });
          return;
        }
        stages.forEach(function (s) {
          out.push({ holderKey: 'stage:' + s.id, kind: 'stage', goalId: g.id,
            progressionId: p.id, stageId: s.id, staged: true, expression: s.requirement });
        });
      });
    });
    return out;
  }

  // Which sides a holder must be asked about. Per the content: a holder whose
  // leaf criteria are scoped `each` is evaluated left and right; anything else
  // is asked once, combined. Fixed order, so output never depends on traversal.
  function sidesFor(holder, bundle, evaluator) {
    var crits = evaluator.leafCriteria(holder.expression, []);
    var index = {};
    (bundle.criteria || []).forEach(function (c) { index[c.id] = c; });
    for (var i = 0; i < crits.length; i++) {
      var c = index[crits[i]];
      if (c && c.sideScope === 'each') return ['left', 'right'];
    }
    return ['combined'];
  }

  // ---- legacy state, read but never written -------------------------------
  // The legacy definition of "done" is the legacy engine's own: a node is
  // complete when every criterion reaches its target. This module does not
  // reimplement it — the caller passes `legacy.isComplete`, which is
  // CoachEngine.isComplete, so the comparison uses the product's real answer.
  function legacyFact(legacy, nodeId) {
    if (!legacy || !legacy.nodes || !legacy.states) return null;
    var node = legacy.nodes[nodeId];
    if (!node) return null;
    var st = legacy.states[nodeId] || {};
    var crits = (node.criteria || []).map(function (c) {
      var v = (st.criteria && st.criteria[c.id]);
      return { criterionId: c.id, value: (v == null ? 0 : v), target: c.target, unit: c.unit || null };
    });
    return {
      nodeId: nodeId,
      name: node.name || nodeId,
      complete: !!legacy.isComplete(node, legacy.states),
      manuallyCompleted: st.completed === true,
      criteria: crits
    };
  }

  // ---- reason classification ----------------------------------------------
  // Deterministic and ordered. Nothing is guessed: when the evidence does not
  // explain the difference, the answer is `unknown`, which is a finding in its
  // own right rather than a placeholder.
  function collectExclusions(requirement) {
    var out = [];
    var byId = requirement && requirement.criteria;
    if (!byId) return out;
    Object.keys(byId).sort().forEach(function (cid) {
      var ex = byId[cid] && byId[cid].excluded;
      if (!ex) return;
      ex.forEach(function (e) { out.push(e.reason); });
    });
    return out;
  }

  function anyStartsWith(list, prefix) {
    for (var i = 0; i < list.length; i++) {
      if (String(list[i]).indexOf(prefix) === 0) return true;
    }
    return false;
  }

  function hasAnyObservation(requirement) {
    var byId = requirement && requirement.criteria;
    if (!byId) return false;
    var keys = Object.keys(byId);
    for (var i = 0; i < keys.length; i++) {
      if (byId[keys[i]] && byId[keys[i]].bestObservation) return true;
    }
    return false;
  }

  function thresholdsDiffer(map, bundle, evaluator, holder, legacy) {
    if (!legacy || !legacy.criteria || !legacy.criteria.length) return false;
    var crits = evaluator.leafCriteria(holder.expression, []);
    var index = {};
    (bundle.criteria || []).forEach(function (c) { index[c.id] = c; });
    for (var i = 0; i < crits.length; i++) {
      var c = index[crits[i]];
      if (!c) continue;
      var primary = c.primaryAttribute;
      var conds = (c.conditions || []).filter(function (x) { return x.attribute === primary; });
      if (!conds.length) continue;
      for (var j = 0; j < legacy.criteria.length; j++) {
        if (legacy.criteria[j].target !== conds[0].value) return true;
      }
    }
    return false;
  }

  function reasonFor(holder, bundle, evaluator, requirement, establishment, legacyFacts, mapping) {
    // 1. The requirement itself holds; only an unlocking Dependency stands in
    //    the way. That is the cleanest explanation there is.
    if (requirement.status === evaluator.STATUS.SATISFIED &&
        establishment && !establishment.established) return REASON.DEPENDENCY;

    // 2. The holder is provisional, which under these semantics has exactly one
    //    cause: every row that could cite it is a claim, and none of them is a
    //    demonstration. The legacy product draws no such distinction, so this is
    //    the most common honest difference between the two models.
    if (requirement.status === evaluator.STATUS.PROVISIONAL) return REASON.CLAIMED;

    var ex = collectExclusions(requirement);
    // 3. Rows exist but were refused, and the evaluator already said why.
    if (anyStartsWith(ex, 'claimed_not_eligible')) return REASON.CLAIMED;
    if (anyStartsWith(ex, 'dependency_unmet(')) return REASON.INVALID;
    if (anyStartsWith(ex, 'wrong_side')) return REASON.SIDE;
    if (anyStartsWith(ex, 'missing_attribute(')) return REASON.MISSING_EVIDENCE;

    // 4. Nothing applicable in the ledger at all. If the legacy product
    //    nonetheless believes this is done, that belief came from benchmark
    //    seeding rather than from anything the athlete demonstrated here.
    if (!hasAnyObservation(requirement)) {
      return (legacyFacts && legacyFacts.complete)
        ? REASON.LEGACY_NO_EVIDENCE : REASON.MISSING_EVIDENCE;
    }

    // 5. Evidence exists and was admitted, but falls short of a bar the two
    //    models set differently.
    if (thresholdsDiffer(mapping, bundle, evaluator, holder, legacyFacts)) {
      return REASON.THRESHOLD;
    }
    return REASON.UNKNOWN;
  }

  // ---- one holder, one side ------------------------------------------------
  function evaluateOne(holder, side, deps) {
    var E = deps.evaluator, key = holder.holderKey;
    var requirement = E.evaluateRequirement(key, deps.ledger, deps.pkg, side);
    var establishment = E.evaluateEstablishment(key, deps.ledger, deps.pkg, side);

    // Evidence actually cited, by ledger sequence, sorted so the record is
    // stable whatever order the rows arrived in.
    var used = [];
    var byId = requirement.criteria || {};
    Object.keys(byId).sort().forEach(function (cid) {
      (byId[cid].satisfiedBy || []).forEach(function (seq) {
        if (used.indexOf(seq) < 0) used.push(seq);
      });
    });
    used.sort(function (a, b) { return a - b; });

    var row = {
      holderKey: key,
      kind: holder.kind,
      goalId: holder.goalId || null,
      progressionId: holder.progressionId || null,
      stageId: holder.stageId || null,
      side: side,
      requirementStatus: requirement.status,
      established: !!(establishment && establishment.established),
      availability: (establishment && establishment.availability) || null,
      unmetDependencies: (establishment && establishment.blockedBy) ? establishment.blockedBy.slice() : [],
      evidenceUsed: used,
      criteria: requirement.criteria || {}
    };
    // currentStage is a question only a STAGED progression has. The evaluator
    // throws for a DIRECT one, which is correct, so it is asked only where it
    // means something rather than guarded with a swallowed error.
    row.currentStage = holder.staged
      ? E.currentStage(holder.progressionId, deps.ledger, deps.pkg, side)
      : null;
    return { row: row, requirement: requirement, establishment: establishment };
  }

  // ---- comparison ----------------------------------------------------------
  function compareOne(holder, side, result, deps) {
    var map = mappingFor(holder.holderKey);
    var bundle = deps.pkg.contentBundle;
    var E = deps.evaluator;
    var satisfied = result.row.requirementStatus === E.STATUS.SATISFIED;

    if (!map) {
      return { holderKey: holder.holderKey, side: side, classification: CLASS.NEW_ONLY,
        legacyNodeId: null, mappingStrength: 'none', reason: null,
        rationale: 'No legacy node measures this capability.',
        shadowSatisfied: satisfied, legacyComplete: null };
    }

    var lf = legacyFact(deps.legacy, map.legacyNodeId);

    if (map.strength === 'weak') {
      // Context only. A weak mapping must never produce a verdict, because a
      // verdict here would be an artefact of the mapping, not of the models.
      return { holderKey: holder.holderKey, side: side, classification: CLASS.NOT_COMPARABLE,
        legacyNodeId: map.legacyNodeId, mappingStrength: 'weak', reason: null,
        rationale: map.rationale, shadowSatisfied: satisfied,
        legacyComplete: lf ? lf.complete : null, legacy: lf };
    }

    if (!lf) {
      return { holderKey: holder.holderKey, side: side, classification: CLASS.NOT_COMPARABLE,
        legacyNodeId: map.legacyNodeId, mappingStrength: 'strong', reason: REASON.SUSPECT,
        rationale: 'Mapping names a legacy node that is not present in the supplied legacy state.',
        shadowSatisfied: satisfied, legacyComplete: null };
    }

    // The new model was given nothing applicable, so it was never really asked.
    // That is not a disagreement, and recording it as one would be a lie.
    if (!hasAnyObservation(result.requirement)) {
      return { holderKey: holder.holderKey, side: side, classification: CLASS.INSUFFICIENT,
        legacyNodeId: map.legacyNodeId, mappingStrength: 'strong',
        reason: lf.complete ? REASON.LEGACY_NO_EVIDENCE : REASON.MISSING_EVIDENCE,
        rationale: map.rationale, shadowSatisfied: satisfied,
        legacyComplete: lf.complete, legacy: lf };
    }

    if (satisfied === lf.complete) {
      return { holderKey: holder.holderKey, side: side, classification: CLASS.MATCH,
        legacyNodeId: map.legacyNodeId, mappingStrength: 'strong', reason: null,
        rationale: map.rationale, shadowSatisfied: satisfied,
        legacyComplete: lf.complete, legacy: lf };
    }

    return { holderKey: holder.holderKey, side: side, classification: CLASS.DIFFERENCE,
      legacyNodeId: map.legacyNodeId, mappingStrength: 'strong',
      reason: reasonFor(holder, bundle, E, result.requirement, result.establishment, lf, map),
      rationale: map.rationale, shadowSatisfied: satisfied,
      legacyComplete: lf.complete, legacy: lf };
  }

  // ---- legacy nodes with no counterpart ------------------------------------
  // Reported so the picture is complete and nobody later mistakes silence for
  // agreement. Sorted by id, because the caller's object order is not ours.
  function legacyOnly(deps) {
    var out = [];
    if (!deps.legacy || !deps.legacy.nodes) return out;
    var mapped = {};
    MAPPINGS.forEach(function (m) { mapped[m.legacyNodeId] = true; });
    Object.keys(deps.legacy.nodes).sort().forEach(function (id) {
      if (mapped[id]) return;
      var lf = legacyFact(deps.legacy, id);
      if (!lf) return;
      out.push({ legacyNodeId: id, name: lf.name, classification: CLASS.LEGACY_ONLY,
        legacyComplete: lf.complete });
    });
    return out;
  }

  // ---- the snapshot --------------------------------------------------------
  /**
   * Deterministic. Same ledger, same context, same content, same legacy state
   * gives the same object, every time. No clock is read: a snapshot is
   * identified by the highest ledger sequence it saw, which is monotonic
   * because the ledger is append-only.
   */
  function snapshot(deps) {
    if (!deps || !deps.evaluator || !deps.pkg || !deps.pkg.contentBundle) {
      throw new Error('shadow evaluation needs an evaluator and a context package');
    }
    var bundle = deps.pkg.contentBundle;
    var ledger = deps.ledger || [];
    var holders = relevantHolders(bundle);

    var rows = [], comparisons = [];
    holders.forEach(function (h) {
      sidesFor(h, bundle, deps.evaluator).forEach(function (side) {
        var r = evaluateOne(h, side, deps);
        rows.push(r.row);
        comparisons.push(compareOne(h, side, r, deps));
      });
    });

    var maxSeq = 0;
    ledger.forEach(function (o) { if (typeof o.seq === 'number' && o.seq > maxSeq) maxSeq = o.seq; });

    var counts = {};
    Object.keys(CLASS).sort().forEach(function (k) { counts[CLASS[k]] = 0; });
    comparisons.forEach(function (c) { counts[c.classification]++; });
    var orphans = legacyOnly(deps);
    counts[CLASS.LEGACY_ONLY] += orphans.length;

    return {
      shadowVersion: 1,
      contextId: deps.pkg.contextId || null,
      semanticsVersion: (deps.pkg.manifest && deps.pkg.manifest.evaluationSemanticsVersion) ||
        (deps.pkg.evaluationSemantics && deps.pkg.evaluationSemantics.version) || null,
      contentBundleVersion: bundle.version || null,
      ledgerRows: ledger.length,
      ledgerMaxSeq: maxSeq,
      holders: rows,
      comparisons: comparisons,
      legacyOnly: orphans,
      counts: counts
    };
  }

  // One line for the on-device diagnostics footnote. Counts only — a summary
  // must never be mistaken for a verdict about the athlete.
  function summarize(snap) {
    if (!snap) return '';
    var c = snap.counts;
    return c[CLASS.MATCH] + ' match, ' + c[CLASS.DIFFERENCE] + ' differ, ' +
      c[CLASS.INSUFFICIENT] + ' without evidence, ' + c[CLASS.NEW_ONLY] + ' new-model-only, ' +
      c[CLASS.NOT_COMPARABLE] + ' not comparable, ' + c[CLASS.LEGACY_ONLY] + ' legacy-only';
  }

  return {
    CLASS: CLASS,
    REASON: REASON,
    MAPPINGS: MAPPINGS.slice(),
    snapshot: snapshot,
    summarize: summarize,
    // Exposed so the mapping rationale can be asserted directly rather than
    // inferred from a comparison row.
    _relevantHolders: relevantHolders,
    _mappingFor: mappingFor,
    _legacyFact: legacyFact
  };
});
