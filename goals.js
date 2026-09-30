/*
 * Skill Progression Coach — the athlete-facing Goal view (pure, UMD).
 *
 * This module answers the only four questions the product exists to answer:
 *
 *     What is my Goal?   Where am I?   What is missing?   What do I do today?
 *
 * It turns authored content plus the athlete's evidence into short, plain
 * sentences. It decides nothing about training and writes nothing anywhere: it
 * is a presentation layer over the engine, and the engine keeps its own
 * vocabulary to itself. No Criterion ids, no Dependency ids, no Stage ids and
 * no policy names reach the athlete through here.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It is not authoritative. The legacy engine
 * still owns what the athlete is told to train until the P8 cutover, so nothing
 * here feeds prescription, the plan or progression state. It only describes.
 *
 * TWO SOURCES, AND THE HONEST ORDER BETWEEN THEM.
 *
 *   1. The Evidence ledger, read through the evaluator. This is the real
 *      measurement — per set, dated, with provenance — and it wins whenever it
 *      exists.
 *   2. The legacy benchmark values, for the three measures where the old app
 *      genuinely recorded the same exercise and the same attribute. An athlete
 *      who has been training for months should not be told they have done
 *      nothing just because the ledger only started filling recently.
 *
 * Anything else reads as NOT MEASURED YET, which is the truth rather than a
 * zero. A number is never invented, a target is never softened, and an area is
 * only ever called done when the evaluator says its requirement is satisfied.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CoachGoals = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The two Goals this product is about, in the order the athlete sees them,
  // with the athlete-facing name for each supporting area. The names are here
  // and not in content because they are a product voice decision: content says
  // "rmu_explosive_pull", the athlete reads "High Pull".
  var GOALS = [
    {
      goalId: 'ring_muscle_up',
      name: 'Ring Muscle-Up',
      areas: [
        { progressionId: 'rmu_false_grip', name: 'False Grip' },
        { progressionId: 'rmu_pull_strength', name: 'Pull Strength' },
        { progressionId: 'rmu_explosive_pull', name: 'High Pull' },
        { progressionId: 'rmu_ring_support', name: 'Ring Support' },
        { progressionId: 'rmu_transition', name: 'Transition' },
        { progressionId: 'rmu_dip_press', name: 'Dip Strength' }
      ]
    },
    {
      goalId: 'pistol_squat',
      name: 'Pistol Squat',
      areas: [
        { progressionId: 'pistol_sl_strength', name: 'Single-Leg Strength' },
        { progressionId: 'pistol_deep_squat', name: 'Squat Depth' },
        // Mobility is a capability and typically a limiter — never a Goal of its
        // own (frozen principle 6). It is shown only when it is actually
        // holding the athlete back; see `hideUnlessLimiting`.
        { progressionId: 'pistol_ankle_mobility', name: 'Ankle Mobility', hideUnlessLimiting: true }
      ]
    }
  ];

  // The legacy benchmark values that measure the SAME exercise and the SAME
  // attribute as an authored Criterion. Only these three qualify: a bar dead
  // hang is not a false-grip hang, and a weighted pull-up is two numbers rather
  // than one, so neither is carried across.
  var BENCH_EQUIVALENTS = {
    pullup_max: { exerciseId: 'pullup', attribute: 'reps' },
    dips_max: { exerciseId: 'dip', attribute: 'reps' },
    ring_support_secs: { exerciseId: 'ring_support', attribute: 'seconds' }
  };

  var UNIT_WORD = { reps: 'reps', seconds: 's', kg: 'kg', cm: 'cm' };

  function unitOf(bundle, attributeId) {
    var list = (bundle && bundle.attributes) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === attributeId) return list[i].unit || '';
    return '';
  }
  function attributeType(bundle, attributeId) {
    var list = (bundle && bundle.attributes) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === attributeId) return list[i].type;
    return null;
  }
  function criterionById(bundle, id) {
    var list = (bundle && bundle.criteria) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function progressionById(bundle, id) {
    var list = (bundle && bundle.progressions) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function measure(value, unit) {
    if (value === null || value === undefined) return null;
    var word = UNIT_WORD[unit] || unit || '';
    if (word === 's') return value + ' s';
    if (word === 'reps' && value === 1) word = 'rep';
    return word ? value + ' ' + word : String(value);
  }

  // The one Criterion a stage or direct progression is measured by, for display.
  // A holder with several is shown by its primary one; the rest are detail.
  function leafOf(expr) {
    if (!expr || typeof expr !== 'object') return null;
    if (typeof expr.criterion === 'string') return expr.criterion;
    var kids = expr.allOf || expr.anyOf || [];
    for (var i = 0; i < kids.length; i++) {
      var found = leafOf(kids[i]);
      if (found) return found;
    }
    return null;
  }

  function primaryCondition(criterion) {
    var conds = (criterion && criterion.conditions) || [];
    for (var i = 0; i < conds.length; i++) {
      if (conds[i].attribute === criterion.primaryAttribute) return conds[i];
    }
    return null;
  }

  // Best value the athlete has actually shown for this Criterion, and where it
  // came from. The ledger first, then a legacy benchmark for the same exercise
  // and attribute, then nothing — never a zero standing in for "unknown".
  function bestFor(deps, criterion, side) {
    var ev = null;
    try { ev = deps.evaluator.evaluateCriterion(criterion.id, side, deps.ledger, deps.pkg); }
    catch (e) { return { value: null, source: null, satisfied: false }; }
    if (ev.bestObservation && ev.bestObservation.value !== undefined && ev.bestObservation.value !== null) {
      return { value: ev.bestObservation.value, source: 'measured', satisfied: ev.status === 'satisfied' };
    }
    // Legacy fallback, only where the old value measures the same thing.
    var bench = deps.bench || {};
    for (var key in BENCH_EQUIVALENTS) {
      if (!Object.prototype.hasOwnProperty.call(BENCH_EQUIVALENTS, key)) continue;
      var eq = BENCH_EQUIVALENTS[key];
      if (eq.attribute !== criterion.primaryAttribute) continue;
      if (!criterionAssessedBy(deps.pkg.contentBundle, criterion.id, eq.exerciseId)) continue;
      if (typeof bench[key] !== 'number' || !bench[key]) continue;
      return { value: bench[key], source: 'history', satisfied: false };
    }
    return { value: null, source: null, satisfied: ev.status === 'satisfied' };
  }

  // Is this exercise an assess route to a holder that owns this Criterion? The
  // legacy fallback must respect the same eligibility rule as real evidence, or
  // it would smuggle in a number the engine would refuse.
  function criterionAssessedBy(bundle, criterionId, exerciseId) {
    var holders = {};
    (bundle.progressions || []).forEach(function (p) {
      if (p.form === 'DIRECT' && leafCriteriaOf(p.requirement).indexOf(criterionId) >= 0) {
        holders['progression:' + p.id] = true;
      }
      (p.stages || []).forEach(function (s) {
        if (leafCriteriaOf(s.requirement).indexOf(criterionId) >= 0) holders['stage:' + s.id] = true;
      });
    });
    (bundle.goals || []).forEach(function (g) {
      if (leafCriteriaOf(g.terminalRequirement).indexOf(criterionId) >= 0) holders['goalTerminal:' + g.id] = true;
    });
    return (bundle.exerciseLinks || []).some(function (l) {
      if (l.relation !== 'assess' || l.exerciseId !== exerciseId) return false;
      var t = l.target;
      var key = t.kind === 'progression' ? 'progression:' + t.progressionId
        : t.kind === 'stage' ? 'stage:' + t.stageId : 'goalTerminal:' + t.goalId;
      return !!holders[key];
    });
  }

  function leafCriteriaOf(expr, out) {
    out = out || [];
    if (!expr || typeof expr !== 'object') return out;
    if (typeof expr.criterion === 'string') { out.push(expr.criterion); return out; }
    ['allOf', 'anyOf'].forEach(function (op) {
      if (Array.isArray(expr[op])) expr[op].forEach(function (c) { leafCriteriaOf(c, out); });
    });
    return out;
  }

  // ---- one area, on one side ----------------------------------------------

  function areaOnSide(deps, area, side) {
    var bundle = deps.pkg.contentBundle;
    var prog = progressionById(bundle, area.progressionId);
    if (!prog) return null;

    var holderKey, criterionId, stepText = null, stepIndex = 0;
    if (prog.form === 'DIRECT') {
      holderKey = 'progression:' + prog.id;
      criterionId = leafOf(prog.requirement);
    } else {
      var ordered = (prog.stages || []).slice().sort(function (a, b) { return a.order - b.order; });
      // A legacy value the athlete genuinely earned should place them on the
      // right step, not on step 1 with a target they cleared years ago. So a
      // step also counts as passed when a carried-over benchmark for the SAME
      // exercise and attribute already meets its primary condition. The step is
      // never reported as done on that basis — only skipped past, so the
      // athlete is shown the bar they are actually working on.
      var current = null, index = 0;
      for (var i = 0; i < ordered.length; i++) {
        var passed = false;
        try {
          passed = deps.evaluator.isRequirementSatisfied('stage:' + ordered[i].id, deps.ledger, deps.pkg, side);
        } catch (e) { passed = false; }
        if (!passed) passed = historyClears(deps, ordered[i], side);
        if (!passed) { current = ordered[i]; index = i; break; }
      }
      if (!current) {           // every step cleared
        current = ordered[ordered.length - 1];
        index = ordered.length - 1;
      }
      holderKey = 'stage:' + current.id;
      criterionId = leafOf(current.requirement);
      stepText = 'Step ' + (index + 1) + ' of ' + ordered.length;
      stepIndex = index;
    }

    var criterion = criterionById(bundle, criterionId);
    if (!criterion) return null;
    var cond = primaryCondition(criterion);
    var unit = unitOf(bundle, criterion.primaryAttribute);
    var best = bestFor(deps, criterion, criterion.sideScope === 'each' ? side : null);

    // Whole-area completion, not just the current step.
    var areaDone = false;
    try {
      areaDone = prog.form === 'DIRECT'
        ? deps.evaluator.isRequirementSatisfied('progression:' + prog.id, deps.ledger, deps.pkg, side)
        : (deps.evaluator.currentStage(prog.id, deps.ledger, deps.pkg, side) === null);
    } catch (e) { areaDone = false; }

    // Blocked is a real, separate answer: the work is done but something else
    // has to open first. It comes from the engine, never guessed here.
    var blockedBy = [];
    try {
      var est = deps.evaluator.evaluateEstablishment(holderKey, deps.ledger, deps.pkg,
        criterion.sideScope === 'each' ? side : null);
      if (!est.established && est.requirement.status === 'satisfied') {
        blockedBy = est.blockedBy.map(function (b) { return b.requires; });
      }
    } catch (e) { blockedBy = []; }

    var state = areaDone ? 'done'
      : blockedBy.length ? 'blocked'
        : (best.value === null ? 'not_started' : 'working');

    return {
      name: area.name,
      side: criterion.sideScope === 'each' ? side : null,
      state: state,
      step: stepText,
      stepIndex: stepIndex,
      current: measure(best.value, unit),
      currentValue: best.value,
      fromHistory: best.source === 'history',
      target: cond ? measure(cond.value, unit) : null,
      targetValue: cond ? cond.value : null,
      // True when the bar asks for something the runner never records, so the
      // area cannot tick itself off however good the numbers look. Said plainly
      // rather than shown as a stuck bar with no explanation.
      needsJudgement: needsUnrecordedAttribute(bundle, criterion),
      percent: percentOf(best.value, cond, attributeType(bundle, criterion.primaryAttribute))
    };
  }

  // Does a carried-over legacy benchmark already clear this step's primary bar?
  // Used only to place the athlete on the right step; never to mark one done.
  function historyClears(deps, stage, side) {
    var bundle = deps.pkg.contentBundle;
    var criterion = criterionById(bundle, leafOf(stage.requirement));
    if (!criterion) return false;
    var cond = primaryCondition(criterion);
    if (!cond || typeof cond.value !== 'number') return false;
    if (attributeType(bundle, criterion.primaryAttribute) !== 'quantity') return false;
    var best = bestFor(deps, criterion, criterion.sideScope === 'each' ? side : null);
    if (best.source !== 'history' || typeof best.value !== 'number') return false;
    return cond.op === 'gte' ? best.value >= cond.value
      : cond.op === 'gt' ? best.value > cond.value : false;
  }

  // Attributes the runner does not observe today. A Criterion conditioning on
  // one of them can be approached but not auto-confirmed.
  var UNRECORDED = ['kip', 'depth', 'execution', 'catch_quality'];
  function needsUnrecordedAttribute(bundle, criterion) {
    return (criterion.conditions || []).some(function (c) {
      return c.attribute !== criterion.primaryAttribute && UNRECORDED.indexOf(c.attribute) >= 0;
    });
  }

  function percentOf(value, cond, type) {
    if (typeof value !== 'number' || !cond || type !== 'quantity') return null;
    if (typeof cond.value !== 'number' || cond.value <= 0) return null;
    var pct = Math.round((value / cond.value) * 100);
    return Math.max(0, Math.min(100, pct));
  }

  // ---- one Goal ------------------------------------------------------------

  function goalView(deps, spec) {
    var bundle = deps.pkg.contentBundle;
    var perSide = isPerSideGoal(bundle, spec.goalId);
    var areas = [];

    spec.areas.forEach(function (area) {
      // Sidedness is a property of the AREA, not of the Goal. Squat depth is
      // one measurement even inside a per-side Goal, and showing it twice would
      // invent a distinction the content does not make.
      if (perSide && isPerSideArea(bundle, area.progressionId)) {
        var left = areaOnSide(deps, area, 'left');
        var right = areaOnSide(deps, area, 'right');
        if (!left && !right) return;
        // One row for the area, with both sides on it — the athlete reads
        // "Left 2 of 5 · Right 4 of 5", never a laterality mechanism.
        areas.push({
          name: area.name, perSide: true, left: left, right: right,
          state: worstState(left && left.state, right && right.state),
          step: (left && left.step) || (right && right.step) || null,
          target: (left && left.target) || (right && right.target) || null,
          needsJudgement: !!((left && left.needsJudgement) || (right && right.needsJudgement)),
          hideUnlessLimiting: !!area.hideUnlessLimiting
        });
      } else {
        var one = areaOnSide(deps, area, null);
        if (!one) return;
        one.perSide = false;
        one.hideUnlessLimiting = !!area.hideUnlessLimiting;
        areas.push(one);
      }
    });

    // What is missing: the first area that is not finished, in the authored
    // order. One answer, not a list of problems — a list is not a diagnosis.
    var limiter = null;
    for (var i = 0; i < areas.length; i++) {
      if (areas[i].state !== 'done') { limiter = areas[i]; break; }
    }
    // Mobility appears only when it is the thing in the way.
    var visible = areas.filter(function (a) {
      return !a.hideUnlessLimiting || (limiter && limiter.name === a.name) || a.state === 'blocked';
    });

    // The count the athlete reads must be the count the athlete can see. An
    // area hidden for not being in the way has to leave BOTH sides of the
    // fraction, or the page says "0 of 3" above two rows and invites exactly
    // the question the hiding was meant to avoid.
    //
    // This cannot flatter a goal. A hidden area is only ever hidden while it is
    // not the limiter, and the limiter is the FIRST unfinished area, so an
    // unfinished hidden area always has an unfinished visible one ahead of it:
    // "every visible area done" cannot coexist with a hidden one that is not.
    // `complete` is asked of every area regardless, hidden ones included.
    var done = visible.filter(function (a) { return a.state === 'done'; }).length;
    var allDone = areas.filter(function (a) { return a.state === 'done'; }).length;
    return {
      goalId: spec.goalId,
      name: spec.name,
      perSide: perSide,
      areas: visible,
      areasDone: done,
      areasTotal: visible.length,
      limiter: limiter,
      // The next meaningful target, in one sentence, from the limiting area.
      next: limiter ? nextLine(limiter) : null,
      complete: allDone === areas.length
    };
  }

  function worstState(a, b) {
    var order = ['blocked', 'not_started', 'working', 'done'];
    var ia = order.indexOf(a), ib = order.indexOf(b);
    if (ia < 0) return b || 'not_started';
    if (ib < 0) return a || 'not_started';
    return order[Math.min(ia, ib)];
  }

  function nextLine(area) {
    if (area.perSide) {
      var behind = worstSide(area);
      if (!behind || !behind.target) return area.name;
      return area.name + ' — ' + (behind.current ? behind.current + ' of ' + behind.target : behind.target) +
        (behind.side ? ' (' + behind.side + ')' : '');
    }
    if (!area.target) return area.name;
    return area.name + ' — ' + (area.current ? area.current + ' of ' + area.target : area.target);
  }

  // The side that is actually behind: further back in the ladder first, and
  // only then the smaller measurement. Comparing values alone gets it wrong
  // whenever neither side has been measured on its own current step.
  function worstSide(area) {
    var l = area.left, r = area.right;
    if (!l) return r;
    if (!r) return l;
    if (l.state === 'done' && r.state !== 'done') return r;
    if (r.state === 'done' && l.state !== 'done') return l;
    if (l.stepIndex !== r.stepIndex) return l.stepIndex < r.stepIndex ? l : r;
    var lv = typeof l.currentValue === 'number' ? l.currentValue : -1;
    var rv = typeof r.currentValue === 'number' ? r.currentValue : -1;
    return lv <= rv ? l : r;
  }

  // Does any Criterion this area is measured by care about sides?
  function isPerSideArea(bundle, progressionId) {
    var prog = progressionById(bundle, progressionId);
    if (!prog) return false;
    var exprs = prog.form === 'DIRECT' ? [prog.requirement]
      : (prog.stages || []).map(function (s) { return s.requirement; });
    return exprs.some(function (e) {
      return leafCriteriaOf(e).some(function (cid) {
        var c = criterionById(bundle, cid);
        return c && c.sideScope === 'each';
      });
    });
  }

  function isPerSideGoal(bundle, goalId) {
    var goal = null;
    (bundle.goals || []).forEach(function (g) { if (g.id === goalId) goal = g; });
    if (!goal) return false;
    return leafCriteriaOf(goal.terminalRequirement).some(function (cid) {
      var c = criterionById(bundle, cid);
      return c && c.sideScope === 'each';
    });
  }

  /**
   * Every Goal, ready to render.
   *
   * deps = { evaluator, pkg, ledger, bench }
   * Returns [] when no context package is available — the caller shows an
   * honest "not ready yet" rather than an empty skeleton.
   */
  function view(deps) {
    if (!deps || !deps.evaluator || !deps.pkg || !deps.pkg.contentBundle) return [];
    var d = {
      evaluator: deps.evaluator, pkg: deps.pkg,
      ledger: deps.ledger || [], bench: deps.bench || {}
    };
    var out = [];
    GOALS.forEach(function (spec) {
      var g = goalView(d, spec);
      if (g) out.push(g);
    });
    return out;
  }

  return {
    GOAL_IDS: GOALS.map(function (g) { return g.goalId; }),
    BENCH_EQUIVALENTS: BENCH_EQUIVALENTS,
    view: view,
    _goalSpecs: GOALS
  };
});
