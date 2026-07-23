/*
 * Skill Progression Coach — dynamic workout adaptation (pure, UMD, testable).
 *
 * After each set, the athlete rates difficulty (Easy / Appropriate / Hard / Failed).
 * This module deterministically adjusts the next set's target and rest duration,
 * returns a plain-language explanation, and allows user override.
 *
 * Rules are intentionally simple and transparent:
 *   Easy       → +1 rep (or +5 sec), −15 sec rest
 *   Appropriate → no change
 *   Hard       → +30 sec rest
 *   Failed     → −1 rep (or −5 sec), +30 sec rest
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CoachAdapt = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EASY = 'easy';
  var APPROPRIATE = 'appropriate';
  var HARD = 'hard';
  var FAILED = 'failed';

  function adaptNext(difficulty, currentSet) {
    var isHold = currentSet && currentSet.unit === 'sec';
    if (difficulty === EASY) {
      return {
        targetDelta: isHold ? 5 : 1,
        restDelta: -15,
        explanation: isHold
          ? 'Felt easy — added 5 sec to hold, shortened rest by 15 sec.'
          : 'Felt easy — added 1 rep, shortened rest by 15 sec.'
      };
    }
    if (difficulty === APPROPRIATE) {
      return { targetDelta: 0, restDelta: 0, explanation: 'Right on target — no adjustment.' };
    }
    if (difficulty === HARD) {
      return { targetDelta: 0, restDelta: 30, explanation: 'That was hard — added 30 sec rest before next set.' };
    }
    if (difficulty === FAILED) {
      return {
        targetDelta: isHold ? -5 : -1,
        restDelta: 30,
        explanation: isHold
          ? 'Could not complete — reduced hold by 5 sec, added 30 sec rest.'
          : 'Could not complete — reduced next set by 1 rep, added 30 sec rest.'
      };
    }
    return { targetDelta: 0, restDelta: 0, explanation: '' };
  }

  function applyTargetDelta(target, delta, unit) {
    if (target == null) return target;
    var min = unit === 'sec' ? 5 : 1;
    return Math.max(min, target + delta);
  }

  function applyRestDelta(restSecs, delta) {
    return Math.max(15, restSecs + delta);
  }

  // ---- ladder: adapt the NEXT COMPLETE ROUND -------------------------------
  // The athlete rates the round only after its final step. The prescription for
  // the next round (its step sequence) and the inter-round rest are adjusted as
  // a unit — never per individual rung.
  //   steps        : the round just completed, e.g. [1, 2, 3]
  //   failedAtStep : 1-based step index where a Failed rating occurred (or null)
  // Returns { steps, roundRestDelta, explanation, reduced }. The caller may let
  // the user override the suggested `steps` back to the original.
  function fmtSteps(a) { return a.join('–'); }

  function adaptNextRound(difficulty, steps, failedAtStep) {
    steps = (steps && steps.length) ? steps.slice() : [1, 2, 3];
    if (difficulty === EASY) {
      var up = steps.slice();
      up[up.length - 1] = up[up.length - 1] + 1;
      return { steps: up, roundRestDelta: -15, reduced: false,
        explanation: 'Felt easy — next round adds a rep (' + fmtSteps(up) + '), rest shortened by 15 sec.' };
    }
    if (difficulty === APPROPRIATE) {
      return { steps: steps.slice(), roundRestDelta: 0, reduced: false,
        explanation: 'Right on target — next round stays ' + fmtSteps(steps) + '.' };
    }
    if (difficulty === HARD) {
      return { steps: steps.slice(), roundRestDelta: 30, reduced: false,
        explanation: 'That was hard — keeping ' + fmtSteps(steps) + ', adding 30 sec before the next round.' };
    }
    if (difficulty === FAILED) {
      var cut;
      if (failedAtStep != null && failedAtStep < steps.length) {
        // Failed partway — do not demand any step at or beyond the failure point.
        cut = steps.slice(0, Math.max(1, failedAtStep - 1));
        if (!cut.length) cut = [steps[0]];
      } else {
        // Failed on (or after) the top step — drop just the top step.
        cut = steps.slice(0, Math.max(1, steps.length - 1));
      }
      return { steps: cut, roundRestDelta: 30, reduced: true,
        explanation: 'Could not complete — next round reduced to ' + fmtSteps(cut) + ', added 30 sec rest. You can keep the full round instead.' };
    }
    return { steps: steps.slice(), roundRestDelta: 0, reduced: false, explanation: '' };
  }

  return {
    EASY: EASY, APPROPRIATE: APPROPRIATE, HARD: HARD, FAILED: FAILED,
    adaptNext: adaptNext,
    adaptNextRound: adaptNextRound,
    applyTargetDelta: applyTargetDelta,
    applyRestDelta: applyRestDelta
  };
});
