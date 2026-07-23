/*
 * Skill Progression Coach — workout duration calculator (pure, UMD, testable).
 *
 * Calculates workout duration from the actual template structure (sets, reps,
 * rest times, transitions). Ladders are modeled as N COMPLETE rounds of the
 * step sequence (e.g. 1-2-3 × 5 = 5 rounds, 15 steps, 30 reps), with two
 * distinct rests: a short rest BETWEEN steps and a longer rest BETWEEN rounds.
 *
 * Execution time is a configurable RANGE (2–3 sec per rep), so duration is a
 * range too. No phantom warm-up is added — only the blocks actually declared
 * in the template count.
 *
 * genSets (set/step generation) and restsBetween (the exact rest schedule) are
 * exported so the UI and the tests share one deterministic source of truth.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CoachDuration = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Explicit, configurable execution assumption: 2–3 sec per rep.
  var SEC_PER_REP_MIN = 2;
  var SEC_PER_REP_MAX = 3;
  var AMRAP_ESTIMATE_SECS = 60;
  var TRANSITION_SECS = 60;
  // Ladder defaults if a block does not specify them.
  var LADDER_STEP_REST = 25;
  var LADDER_ROUND_REST = 150;

  function ladderSteps(block) { return block.steps || [1, 2, 3]; }
  function ladderRounds(block) { return block.rounds || 1; }
  function stepRest(block) { return block.restBetweenStepsSec != null ? block.restBetweenStepsSec : LADDER_STEP_REST; }
  function roundRest(block) { return block.restBetweenRoundsSec != null ? block.restBetweenRoundsSec : LADDER_ROUND_REST; }

  // Expand a block into its ordered list of sets/steps. Ladder steps carry
  // round/step metadata so the runner and duration model agree on structure.
  function genSets(block) {
    var out = [], i, r, s;
    if (block.scheme === 'sets') {
      for (i = 0; i < block.sets; i++) out.push({ target: block.reps, unit: 'reps', actual: block.reps });
    } else if (block.scheme === 'hold') {
      for (i = 0; i < block.sets; i++) out.push({ target: block.seconds, unit: 'sec', actual: block.seconds });
    } else if (block.scheme === 'ladder') {
      var steps = ladderSteps(block), rounds = ladderRounds(block);
      for (r = 0; r < rounds; r++) {
        for (s = 0; s < steps.length; s++) {
          out.push({
            target: steps[s], unit: 'reps', actual: steps[s], ladder: true,
            round: r + 1, roundCount: rounds,
            step: s + 1, stepCount: steps.length,
            firstInRound: s === 0,
            lastInRound: s === steps.length - 1,
            label: 'Round ' + (r + 1) + ' · Step ' + (s + 1)
          });
        }
      }
    } else if (block.scheme === 'pyramid') {
      var p = block.steps || [1, 2, 3, 2, 1];
      for (i = 0; i < p.length; i++) out.push({ target: p[i], unit: 'reps', actual: p[i] });
    } else if (block.scheme === 'amrap') {
      out.push({ target: null, unit: 'reps', actual: 0, amrap: true });
    } else {
      for (i = 0; i < (block.sets || 3); i++) out.push({ target: block.reps || 5, unit: 'reps', actual: block.reps || 5 });
    }
    return out;
  }

  // Rest between consecutive straight sets, by template type.
  function restForType(type) {
    if (type === 'power' || type === 'integration') return 150;
    if (type === 'light') return 60;
    return 120;
  }

  // The exact ordered list of rests in a workout, tagged by kind. A rest is the
  // gap AFTER a set/step and BEFORE the next one; there is no rest after the very
  // last set of the last block. Between blocks there is a single transition.
  //   kind: 'short' (ladder inter-step) | 'long' (ladder inter-round)
  //       | 'straight' (between non-ladder sets) | 'transition' (between blocks)
  function restsBetween(template) {
    var rests = [];
    if (!template.blocks) return rests;
    var type = template.type;
    for (var bi = 0; bi < template.blocks.length; bi++) {
      var block = template.blocks[bi];
      var sets = genSets(block);
      for (var si = 0; si < sets.length - 1; si++) {
        var s = sets[si];
        if (s.ladder) {
          if (s.lastInRound) rests.push({ sec: roundRest(block), kind: 'long' });
          else rests.push({ sec: stepRest(block), kind: 'short' });
        } else {
          // A resolved block may carry its own editable restSecs; otherwise fall
          // back to the per-type default.
          var straightRest = block.restSecs != null ? block.restSecs : restForType(type);
          rests.push({ sec: straightRest, kind: 'straight' });
        }
      }
      if (bi < template.blocks.length - 1) rests.push({ sec: TRANSITION_SECS, kind: 'transition' });
    }
    return rests;
  }

  // Total execution seconds for a set, as a {min,max} pair.
  function execSecs(s) {
    if (s.unit === 'sec') return { min: s.target || 0, max: s.target || 0 };
    if (s.amrap) return { min: AMRAP_ESTIMATE_SECS, max: AMRAP_ESTIMATE_SECS };
    return { min: (s.target || 0) * SEC_PER_REP_MIN, max: (s.target || 0) * SEC_PER_REP_MAX };
  }

  // Duration as a {minSec,maxSec,minMin,maxMin} range, or null when the template
  // has no trainable blocks (e.g. a climbing session).
  function calcDurationRange(template) {
    if (!template.blocks || !template.blocks.length) return null;
    var minSec = 0, maxSec = 0;
    template.blocks.forEach(function (block) {
      genSets(block).forEach(function (s) {
        var e = execSecs(s); minSec += e.min; maxSec += e.max;
      });
    });
    restsBetween(template).forEach(function (r) { minSec += r.sec; maxSec += r.sec; });
    return { minSec: minSec, maxSec: maxSec, minMin: Math.round(minSec / 60), maxMin: Math.round(maxSec / 60) };
  }

  // Single-number convenience (upper bound), or null. Kept for callers that want
  // one figure; the UI prefers calcDurationRange for an honest range.
  function calcDuration(template) {
    var r = calcDurationRange(template);
    return r ? r.maxMin : null;
  }

  return {
    genSets: genSets,
    restForType: restForType,
    restsBetween: restsBetween,
    calcDuration: calcDuration,
    calcDurationRange: calcDurationRange,
    SEC_PER_REP_MIN: SEC_PER_REP_MIN,
    SEC_PER_REP_MAX: SEC_PER_REP_MAX,
    AMRAP_ESTIMATE_SECS: AMRAP_ESTIMATE_SECS,
    TRANSITION_SECS: TRANSITION_SECS,
    LADDER_STEP_REST: LADDER_STEP_REST,
    LADDER_ROUND_REST: LADDER_ROUND_REST
  };
});
