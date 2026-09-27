/*
 * Skill Progression Coach — the evidence tap (pure, UMD).
 *
 * Technical Schema v1.1 §6. This module turns what the athlete ACTUALLY DID
 * into PerformanceObservation and ActivityObservation rows. It is the strangler
 * boundary: from here on the ledger fills with real per-set facts while every
 * decision the athlete sees is still made by the legacy engine.
 *
 * PURE. No storage, no network, no DOM, no clock, no app state. The caller
 * supplies the runner snapshot and a context; this returns rows. It never
 * mutates its inputs. The whole reason it is pure is that the interesting part
 * — WHEN the context is read relative to the append — belongs to the caller and
 * must be visible there rather than buried in here.
 *
 * WHAT AN OBSERVATION IS, AND IS NOT.
 *
 *   It is a fact. What was performed, how much of it, when it was recorded,
 *   under which interpretation context, and which Dependencies were unmet at
 *   that moment. Every one of those is knowable at the time and unrecoverable
 *   later, which is precisely why it is stored.
 *
 *   It is not a conclusion. No criterion id, no verdict, no status, no
 *   progression, no "this cleared the stage" (invariant 02). Whether a row is
 *   evidence for anything is decided by the evaluator, later, possibly
 *   differently under a later context — and a row that no Criterion can ever
 *   cite is still a true record of a set that was performed.
 *
 * THE PLANNED VALUE IS NEVER RECORDED AS THE ACTUAL ONE. Every row carries the
 * measured `actual`. A hold stopped at 12 of 20 seconds records 12. What was
 * asked for is kept separately, by value, in `context.prescribedDose`, so
 * planned and actual can be compared without either overwriting the other.
 *
 * ONLY WHAT WAS MEASURED IS RECORDED. The runner measures reps and seconds. It
 * does not observe whether a pull-up kipped, how deep a squat went or how
 * controlled a transition was, so those attributes are ABSENT rather than
 * assumed — and a Criterion that needs one of them reports
 * `missing_attribute`, which is the honest answer and the whole point of the
 * tri-state rule. Filling them in with defaults would manufacture evidence.
 *
 * SIDE IS NEVER GUESSED. `side` is recorded only when the caller genuinely
 * knows it. The current runner never does — a unilateral block collects ONE
 * actual for "5 × 3 each side" and has no field for which side it was — so its
 * rows carry `side: null`, and a per-side Criterion correctly declines them as
 * `wrong_side`. That is a real gap in what the app can prove, and it is
 * recorded as a gap rather than papered over with a plausible-looking left.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CoachEvidence = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PERFORMANCE = 'PerformanceObservation';
  var ACTIVITY = 'ActivityObservation';

  // The two attributes the runner actually measures, by the unit it measures
  // them in. Nothing else is inferred from a set.
  var UNIT_ATTRIBUTE = { reps: 'reps', sec: 'seconds' };

  // ---- dedupe keys --------------------------------------------------------
  // Derived from STABLE EXECUTION COORDINATES and nothing else: which workout,
  // which block, which set or which step of which round. No timestamp, no
  // counter, no random part, no value from the performance itself.
  //
  // That is what makes the key survive everything that legitimately replays a
  // completion — a reload, a resume, a re-render, a second Finish tap, a
  // background/foreground cycle — while still distinguishing every genuinely
  // different set. A key containing the time would change on every replay and
  // duplicate the whole workout; a key containing the reps performed would
  // merge two different sets that happened to match.

  function setKey(workoutId, blockIdx, setIdx) {
    return workoutId + ':' + blockIdx + ':s:' + setIdx;
  }
  function stepKey(workoutId, blockIdx, roundIdx, stepIdx) {
    return workoutId + ':' + blockIdx + ':r:' + roundIdx + ':' + stepIdx;
  }
  function climbKey(workoutId) {
    return workoutId + ':climb';
  }

  // ---- reading the content bundle -----------------------------------------
  // Read-only, and only to answer one question: does this exercise record this
  // attribute at all? An attribute an exercise does not produce must never
  // appear on an observation of it.

  function producesAttribute(bundle, exerciseId, attributeId) {
    var list = (bundle && bundle.exercises) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === exerciseId) {
        return (list[i].producesAttributes || []).indexOf(attributeId) >= 0;
      }
    }
    return false;
  }

  // The measured value of one set, as attributes. Returns {} when the exercise
  // does not record what was measured — an empty attribute map is an honest
  // record of a performed set whose measurement this content cannot express.
  function attributesFor(bundle, exerciseId, unit, actual) {
    var attributeId = UNIT_ATTRIBUTE[unit] || UNIT_ATTRIBUTE.reps;
    var out = {};
    if (typeof actual !== 'number' || !isFinite(actual)) return out;
    if (!producesAttribute(bundle, exerciseId, attributeId)) return out;
    out[attributeId] = actual;
    return out;
  }

  // ---- the prescribed dose, by value --------------------------------------
  // What was ASKED FOR, reconstructed from the live block. Opaque to the domain
  // (invariant 20): it is stored so planned and actual can be compared, and
  // nothing evaluates it.

  function doseOf(block, target) {
    var dose = { scheme: (block.kind === 'ladder') ? 'ladder' : (block.scheme || 'sets') };
    if (block.kind === 'ladder') {
      dose.steps = (block.origSteps || []).slice();
      dose.rounds = (block.rounds || []).length;
      dose.restBetweenStepsSec = block.restStepSec;
      dose.restBetweenRoundsSec = block.restRoundSec;
    } else {
      dose.sets = (block.sets || []).length;
      dose.restSec = block.restSecs;
    }
    if (target !== undefined) dose.target = target;
    return dose;
  }

  // ---- one row ------------------------------------------------------------

  function observation(fields, ctx) {
    return {
      kind: PERFORMANCE,
      occurredAt: ctx.now,
      recordedAt: ctx.now,
      exerciseId: fields.exerciseId,
      // Never inferred. See the header: the runner does not know a side.
      side: (fields.side === undefined) ? null : fields.side,
      attributes: fields.attributes,
      provenance: 'demonstrated',
      provenanceSource: ctx.provenanceSource || 'in_session',
      sourceWorkoutItem: { workoutId: ctx.workoutId, itemIndex: fields.itemIndex },
      sequenceInItem: fields.sequenceInItem,
      dedupeKey: fields.dedupeKey,
      context: {
        readiness: {},
        accommodationInForce: null,
        unmetDependencies: (ctx.unmetDependencies || []).slice(),
        prescribedDose: fields.prescribedDose,
        contextId: ctx.contextId
      }
    };
  }

  // ---- a finished strength workout ---------------------------------------
  /**
   * Every performed set of every block, at the finest granularity the runner
   * holds: per set for straight blocks (including a pyramid, whose planned and
   * extra sets share one array), per step for a ladder.
   *
   * MUST be called on the live runner state, before the result normaliser
   * collapses it: `exerciseResult()` reduces a ladder to a total and a best,
   * plain sets to a total and a best, and a pyramid's extras to a sum. Those
   * summaries cannot be taken apart again afterwards.
   *
   * A set that was not performed emits nothing. `doneFlag` is the runner's own
   * record of "this was completed", and a skipped or pending set is not a fact
   * about the athlete.
   */
  function fromWorkout(w, ctx) {
    var rows = [];
    if (!w || !Array.isArray(w.blocks)) return rows;
    // The workout carries its own identity, minted when it was built; ctx may
    // supply one for a caller that holds it separately.
    var workoutId = w.workoutId || (ctx && ctx.workoutId);
    if (!workoutId || !ctx || !ctx.contextId) {
      throw new Error('an observation needs an execution identity and a context');
    }
    ctx = { workoutId: workoutId, contextId: ctx.contextId, bundle: ctx.bundle,
      unmetDependencies: ctx.unmetDependencies, now: ctx.now, side: ctx.side,
      provenanceSource: ctx.provenanceSource };
    w.blocks.forEach(function (block, blockIdx) {
      var exerciseId = block.exId;
      if (!exerciseId) return;
      if (block.kind === 'ladder') {
        // sequenceInItem runs across the whole block, so a ladder can be
        // redisplayed in order without the reader knowing what a ladder is.
        var n = 0;
        (block.rounds || []).forEach(function (round, roundIdx) {
          (round.steps || []).forEach(function (step, stepIdx) {
            n++;
            if (!step.doneFlag) return;
            rows.push(observation({
              exerciseId: exerciseId,
              itemIndex: blockIdx,
              sequenceInItem: n,
              attributes: attributesFor(ctx.bundle, exerciseId, 'reps', step.actual),
              prescribedDose: doseOf(block, step.target),
              dedupeKey: stepKey(ctx.workoutId, blockIdx, roundIdx, stepIdx),
              side: ctx.side
            }, ctx));
          });
        });
        return;
      }
      (block.sets || []).forEach(function (set, setIdx) {
        if (!set.doneFlag) return;
        rows.push(observation({
          exerciseId: exerciseId,
          itemIndex: blockIdx,
          sequenceInItem: setIdx + 1,
          // The MEASURED elapsed value, never set.target.
          attributes: attributesFor(ctx.bundle, exerciseId, set.unit, set.actual),
          prescribedDose: doseOf(block, set.target),
          dedupeKey: setKey(ctx.workoutId, blockIdx, setIdx),
          side: ctx.side
        }, ctx));
      });
    });
    return rows;
  }

  // ---- a finished climbing session ---------------------------------------
  /**
   * One ActivityObservation (§6): a session that produced real load but no
   * criterion-bearing measurement. It has no exercise, no attributes and no
   * side, which is exactly why the schema gives it its own row type — a climb
   * is a load input, and a V4 send is not evidence of a Criterion.
   *
   * The performed detail the logger genuinely captured is kept as fact:
   * problems, and the load the existing weekly model already derives from them.
   */
  function fromClimb(session, ctx) {
    if (!session) return [];
    if (!ctx || !ctx.workoutId || !ctx.contextId) {
      throw new Error('an observation needs an execution identity and a context');
    }
    var problems = (session.problems || []).map(function (p) {
      return { grade: p.grade, style: p.style, result: p.result };
    });
    return [{
      kind: ACTIVITY,
      activity: 'climbing',
      occurredAt: ctx.now,
      recordedAt: ctx.now,
      dedupeKey: climbKey(ctx.workoutId),
      sourceWorkoutItem: { workoutId: ctx.workoutId, itemIndex: 0 },
      // Reported by the athlete at the end of the session, so these are
      // self-reported facts about the session, not a derived verdict.
      intensity: session.rpe >= 4 ? 'hard' : (session.rpe === 3 ? 'moderate' : 'easy'),
      loadDimensions: {
        pulling: session.hardPull ? 'high' : 'moderate',
        grip: (session.finger != null && session.finger <= 1) ? 'high' : 'moderate'
      },
      problems: problems,
      rpe: (session.rpe == null) ? null : session.rpe,
      finger: (session.finger == null) ? null : session.finger,
      skin: (session.skin == null) ? null : session.skin,
      context: {
        readiness: {},
        accommodationInForce: null,
        unmetDependencies: (ctx.unmetDependencies || []).slice(),
        prescribedDose: null,
        contextId: ctx.contextId
      }
    }];
  }

  return {
    PERFORMANCE: PERFORMANCE,
    ACTIVITY: ACTIVITY,

    fromWorkout: fromWorkout,
    fromClimb: fromClimb,

    // Exposed so the dedupe contract can be asserted directly rather than
    // inferred from a row, and so nothing else has to restate the format.
    setKey: setKey,
    stepKey: stepKey,
    climbKey: climbKey,

    attributesFor: attributesFor,
    doseOf: doseOf
  };
});
