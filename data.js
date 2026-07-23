/*
 * Skill Progression Coach — content/seed layer (data-driven, UMD, pure data).
 *
 * The whole product is rendered from this configuration. Adding a new world
 * later means adding another entry to WORLDS — no renderer/engine change.
 *
 * All user-facing strings are in English. Duration is NOT hardcoded — it is
 * calculated at runtime by CoachDuration.calcDuration(template).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CoachData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function crit(id, label, target, unit) {
    return { id: id, label: label, target: target, unit: unit || '' };
  }

  // ---- WORLD 1 — BAR MUSCLE-UP -------------------------------------------
  var MUSCLEUP = {
    id: 'muscleup',
    slug: 'bar-muscle-up',
    name: 'Bar Muscle-Up',
    subtitle: 'Bar Muscle-Up',
    goal: 'Clean, controlled bar muscle-up',
    order: 1,
    theme: { accent: '#38bdf8', glow: '#7dd3fc' },
    icon: 'muscleup',
    branches: [
      { id: 'found', name: 'Pulling Foundation', type: 'foundation', mainline: true },
      { id: 'strength', name: 'Pulling Strength', type: 'strength', mainline: true },
      { id: 'highpull', name: 'Explosive Pull', type: 'power', mainline: true },
      { id: 'transition', name: 'Transition', type: 'skill', mainline: true },
      { id: 'dip', name: 'Push & Support', type: 'support' },
      { id: 'core', name: 'Core & Body Control', type: 'support' },
      { id: 'integration', name: 'Integration', type: 'milestone', mainline: true }
    ],
    nodes: [
      // Foundation
      { id: 'mu_deadhang', branchId: 'found', name: 'Active Dead Hang', subtitle: 'Active Dead Hang',
        col: 0, row: 1, type: 'foundation', prereq: null,
        why: 'Shoulder health and grip strength — the foundation of all pulling.',
        criteria: [crit('hold', 'Stable hang', 30, 'sec')],
        seed: { fromBench: 'deadhang_secs', completeIfBench: { key: 'pullup_max', gte: 4 } }, templates: ['mu_light'] },
      { id: 'mu_scap', branchId: 'found', name: 'Scapular Pull-Up', subtitle: 'Scapular Pull-Up',
        col: 0, row: 2, type: 'foundation', prereq: null,
        why: 'Scapular control — engages the back before bending the elbows.',
        criteria: [crit('reps', 'Clean reps', 8, 'reps')],
        seed: { completeIfBench: { key: 'pullup_max', gte: 6 } }, templates: ['mu_light'] },
      { id: 'mu_pull1', branchId: 'found', name: 'First Pull-Up', subtitle: 'First Strict Pull-Up',
        col: 1, row: 1, type: 'foundation', prereq: { all: ['mu_deadhang', 'mu_scap'] },
        why: 'First milestone on the pulling path.',
        criteria: [crit('reps', 'One clean pull-up', 1, 'rep')],
        seed: { fromBench: 'pullup_max', asReps: true }, templates: ['mu_strength'] },
      { id: 'mu_pull5', branchId: 'found', name: '5 Pull-Ups', subtitle: '5 Strict Pull-Ups',
        col: 2, row: 1, type: 'strength', prereq: { all: ['mu_pull1'] },
        why: 'Strength base before volume and transition threshold.',
        criteria: [crit('reps', 'Consecutive pull-ups', 5, 'reps')],
        seed: { fromBench: 'pullup_max', asReps: true }, templates: ['mu_strength', 'mu_volume'] },
      // Strength / high pull
      { id: 'mu_pull10', branchId: 'strength', name: '10 Pull-Ups', subtitle: '10 Strict Pull-Ups',
        col: 3, row: 1, type: 'strength', prereq: { all: ['mu_pull5'] },
        why: 'Strength-endurance reserve for repeated high pulls.',
        criteria: [crit('reps', 'Consecutive pull-ups', 10, 'reps')],
        seed: { fromBench: 'pullup_max', asReps: true }, templates: ['mu_strength', 'mu_volume'] },
      { id: 'mu_fastpull', branchId: 'highpull', name: 'Explosive Pull-Up', subtitle: 'Explosive Pull-Up',
        col: 3, row: 0, type: 'power', prereq: { all: ['mu_pull5'] },
        why: 'Initial pulling power that drives the chest high.',
        criteria: [crit('reps', 'Clean explosive reps', 5, 'reps')], templates: ['mu_highpull'] },
      { id: 'mu_c2b', branchId: 'highpull', name: 'Chest-to-Bar', subtitle: 'Strict Chest-to-Bar',
        col: 4, row: 0, type: 'power', prereq: { all: ['mu_fastpull', 'mu_pull10'] },
        why: 'The pulling range needed to get above the bar.',
        criteria: [crit('reps', 'Clean chest-to-bar', 3, 'reps')], templates: ['mu_highpull'] },
      // Support / dip
      { id: 'mu_support', branchId: 'dip', name: 'Straight-Bar Support', subtitle: 'Straight-Bar Support',
        col: 1, row: 3, type: 'support', prereq: null,
        why: 'The position you land in after the transition — must be stable.',
        criteria: [crit('hold', 'Stable support hold', 15, 'sec')],
        seed: { fromBench: 'ring_support_secs' }, templates: ['mu_dip'] },
      { id: 'mu_dip5', branchId: 'dip', name: '5 Straight-Bar Dips', subtitle: '5 Straight-Bar Dips',
        col: 2, row: 3, type: 'support', prereq: { all: ['mu_support'] },
        why: 'Pushing strength that finishes the muscle-up above the bar.',
        criteria: [crit('reps', 'Clean dips', 5, 'reps')],
        seed: { fromBench: 'dips_max', asReps: true }, templates: ['mu_dip'] },
      // Core
      { id: 'mu_hollow', branchId: 'core', name: 'Hollow Body Hold', subtitle: 'Hollow Body Hold',
        col: 1, row: 4, type: 'support', prereq: null,
        why: 'A tight body line reduces swing and saves energy.',
        criteria: [crit('hold', 'Stable hold', 30, 'sec')], templates: ['mu_light'] },
      { id: 'mu_knee', branchId: 'core', name: 'Controlled Knee Raise', subtitle: 'Controlled Knee Raise',
        col: 2, row: 4, type: 'support', prereq: { all: ['mu_hollow'] },
        why: 'Lower body control during the pull.',
        criteria: [crit('reps', 'Controlled reps', 10, 'reps')], templates: ['mu_light'] },
      // Transition
      { id: 'mu_lowtrans', branchId: 'transition', name: 'Low-Bar Transition Drill', subtitle: 'Low-Bar Transition Drill',
        col: 3, row: 2, type: 'skill', prereq: { all: ['mu_dip5'] },
        why: 'Learn the transition feel at a safe height.',
        criteria: [crit('sessions', 'Transition drills', 3, 'sessions')], templates: ['mu_transition'] },
      { id: 'mu_negmu', branchId: 'transition', name: 'Negative Muscle-Up', subtitle: 'Controlled Negative Muscle-Up',
        col: 4, row: 2, type: 'skill', prereq: { all: ['mu_lowtrans', 'mu_pull10'] },
        why: 'Build the full transition path through controlled descent.',
        criteria: [crit('reps', 'Controlled negatives', 3, 'reps')], templates: ['mu_transition'] },
      // Integration
      { id: 'mu_bandmu', branchId: 'integration', name: 'Banded Muscle-Up', subtitle: 'Banded Bar Muscle-Up',
        col: 5, row: 1, type: 'milestone', prereq: { all: ['mu_c2b', 'mu_negmu', 'mu_dip5'] },
        why: 'Connect the full chain with light assistance.',
        criteria: [crit('reps', 'Banded reps', 3, 'reps')], templates: ['mu_integrate'] },
      { id: 'mu_firstmu', branchId: 'integration', name: 'First Muscle-Up', subtitle: 'First Bar Muscle-Up',
        col: 6, row: 1, type: 'milestone',
        prereq: { all: ['mu_bandmu'], any: ['mu_c2b', 'mu_negmu'], noPain: true },
        why: 'The central milestone of this world.',
        criteria: [crit('reps', 'One clean muscle-up', 1, 'rep')], templates: ['mu_integrate', 'mu_test'] },
      { id: 'mu_reps', branchId: 'integration', name: 'Three Clean Singles', subtitle: 'Three Clean Singles',
        col: 6, row: 0, type: 'maintenance', prereq: { all: ['mu_firstmu'] },
        why: 'Making the achievement repeatable and reliable.',
        criteria: [crit('reps', 'Clean singles', 3, 'reps')], templates: ['mu_integrate'] }
    ],
    supports: [
      ['mu_knee', 'mu_negmu'], ['mu_hollow', 'mu_firstmu'], ['mu_support', 'mu_bandmu']
    ]
  };

  // ---- WORLD 2 — BOULDERING: PATH TO V5 ----------------------------------
  var BOULDER = {
    id: 'boulder',
    slug: 'bouldering-v5',
    name: 'Bouldering — Path to V5',
    subtitle: 'Bouldering · Path to V5',
    goal: 'Consistently send V5 problems in multiple styles',
    order: 2,
    theme: { accent: '#22d3a6', glow: '#6ee7c7' },
    icon: 'boulder',
    note: 'Indoor gym grades vary between gyms — treat them as estimates.',
    branches: [
      { id: 'grade', name: 'Grade Consolidation', type: 'milestone', mainline: true },
      { id: 'foot', name: 'Footwork & Body Position', type: 'skill' },
      { id: 'move', name: 'Movement Vocabulary', type: 'skill' },
      { id: 'tension', name: 'Strength & Body Tension', type: 'strength' },
      { id: 'tactics', name: 'Tactics & Projects', type: 'foundation' }
    ],
    nodes: [
      // Grade consolidation lane (row 1)
      { id: 'b_v0', branchId: 'grade', name: 'Several V0 Problems', subtitle: 'Several V0 Problems',
        col: 0, row: 1, type: 'foundation', prereq: null,
        why: 'Getting familiar with basic movement and wall confidence.',
        criteria: [crit('sends', 'Problems completed', 5, 'problems')], templates: ['b_volume'] },
      { id: 'b_v1', branchId: 'grade', name: 'Consolidate V1', subtitle: 'Consolidate V1',
        col: 1, row: 1, type: 'strength', prereq: { all: ['b_v0'] },
        why: 'Not a single send — several problems in multiple styles.',
        criteria: [crit('sends', 'V1 problems', 4, 'problems'), crit('styles', 'Different styles', 2, 'styles')],
        templates: ['b_volume', 'b_consolidate'] },
      { id: 'b_v2', branchId: 'grade', name: 'Consolidate V2', subtitle: 'Consolidate V2',
        col: 2, row: 1, type: 'strength', prereq: { all: ['b_v1'] },
        why: 'Deepening movement vocabulary at intermediate level.',
        criteria: [crit('sends', 'V2 problems', 4, 'problems'), crit('styles', 'Different styles', 2, 'styles')],
        templates: ['b_consolidate'] },
      { id: 'b_v3', branchId: 'grade', name: 'Consolidate V3', subtitle: 'Consolidate V3',
        col: 3, row: 1, type: 'strength', prereq: { all: ['b_v2'] },
        why: 'The grade where technique starts to matter more than strength.',
        criteria: [crit('sends', 'V3 problems', 3, 'problems'), crit('styles', 'Different styles', 2, 'styles')],
        templates: ['b_consolidate', 'b_project'] },
      { id: 'b_v4', branchId: 'grade', name: 'First V4', subtitle: 'First V4',
        col: 4, row: 1, type: 'milestone', prereq: { all: ['b_v3'], any: ['b_flag', 'b_lockoff'] },
        why: 'A grade jump requiring good footwork and body tension.',
        criteria: [crit('sends', 'V4 send', 1, 'problem')], templates: ['b_project'] },
      { id: 'b_v5proj', branchId: 'grade', name: 'First V5 Project', subtitle: 'First V5 Project',
        col: 5, row: 1, type: 'milestone', prereq: { all: ['b_v4'] },
        why: 'Pick a V5 problem and reach the crux.',
        criteria: [crit('crux', 'Reach the crux', 1, 'time'), crit('sessions', 'Project sessions', 2, 'sessions')],
        templates: ['b_project'] },
      { id: 'b_v5', branchId: 'grade', name: 'First V5 Send', subtitle: 'First V5 Send',
        col: 6, row: 1, type: 'milestone',
        prereq: { all: ['b_v5proj'], any: ['b_multisession', 'b_overhang'], noPain: true },
        why: 'The central milestone of this world.',
        criteria: [crit('sends', 'V5 send', 1, 'problem')], templates: ['b_project', 'b_test'] },
      // Footwork lane (row 2)
      { id: 'b_silentfeet', branchId: 'foot', name: 'Silent Feet', subtitle: 'Silent Feet',
        col: 1, row: 2, type: 'skill', prereq: null,
        why: 'Precision in foot placement — the foundation of efficient technique.',
        criteria: [crit('sessions', 'Focused sessions', 2, 'sessions')], templates: ['b_technique'] },
      { id: 'b_flag', branchId: 'foot', name: 'Flagging', subtitle: 'Flagging',
        col: 2, row: 2, type: 'skill', prereq: { all: ['b_silentfeet'] },
        why: 'Balance without an extra foothold — saves energy.',
        criteria: [crit('sessions', 'Intentional practice', 2, 'sessions')], templates: ['b_technique'] },
      { id: 'b_dropknee', branchId: 'foot', name: 'Drop Knee', subtitle: 'Drop Knee',
        col: 3, row: 2, type: 'skill', prereq: { all: ['b_flag'] },
        why: 'Brings your body closer to the wall and extends reach.',
        criteria: [crit('sessions', 'Intentional practice', 2, 'sessions')], templates: ['b_technique'] },
      // Movement lane (row 3)
      { id: 'b_deadpoint', branchId: 'move', name: 'Deadpoint', subtitle: 'Deadpoint',
        col: 2, row: 3, type: 'skill', prereq: { all: ['b_v1'] },
        why: 'Dynamic catch at the peak of movement.',
        criteria: [crit('sessions', 'Intentional practice', 2, 'sessions')], templates: ['b_power'] },
      { id: 'b_heelhook', branchId: 'move', name: 'Heel Hook', subtitle: 'Heel Hook',
        col: 3, row: 3, type: 'skill', prereq: { all: ['b_deadpoint'] },
        why: 'Foot as a "third hand" on overhangs.',
        criteria: [crit('sessions', 'Intentional practice', 2, 'sessions')], templates: ['b_technique', 'b_power'] },
      // Tension lane (row 4)
      { id: 'b_activehang', branchId: 'tension', name: 'Active Hang', subtitle: 'Active Hang',
        col: 1, row: 4, type: 'foundation', prereq: null,
        why: 'Active shoulders and grip — the base for wall strength.',
        criteria: [crit('hold', 'Stable hang', 30, 'sec')],
        seed: { fromBench: 'deadhang_secs' }, templates: ['b_strength'] },
      { id: 'b_lockoff', branchId: 'tension', name: 'Lock-Off Control', subtitle: 'Lock-Off Control',
        col: 3, row: 4, type: 'strength', prereq: { all: ['b_activehang'] },
        why: 'Holding a lock-off while reaching for the next hold.',
        criteria: [crit('hold', 'Bent-arm hold', 10, 'sec')], templates: ['b_strength'] },
      { id: 'b_overhang', branchId: 'tension', name: 'Overhang Body Tension', subtitle: 'Tension on Overhang',
        col: 4, row: 4, type: 'strength', prereq: { all: ['b_lockoff'] },
        why: 'Keeping feet on the wall on steep terrain.',
        criteria: [crit('sessions', 'Overhang sessions', 3, 'sessions')], templates: ['b_power', 'b_strength'] },
      // Tactics lane (row 0)
      { id: 'b_preview', branchId: 'tactics', name: 'Route Reading & Crux ID', subtitle: 'Preview + Crux',
        col: 3, row: 0, type: 'foundation', prereq: { all: ['b_v2'] },
        why: 'Plan before climbing — saves attempts.',
        criteria: [crit('sessions', 'Previews', 3, 'sessions')], templates: ['b_project'] },
      { id: 'b_project', branchId: 'tactics', name: 'Structured Project Work', subtitle: 'Structured Project',
        col: 4, row: 0, type: 'foundation', prereq: { all: ['b_preview'] },
        why: 'Work a hard problem methodically with proper rest.',
        criteria: [crit('sessions', 'Project sessions', 2, 'sessions')], templates: ['b_project'] },
      { id: 'b_multisession', branchId: 'tactics', name: 'Multi-Session Send', subtitle: 'Multi-Session Send',
        col: 5, row: 0, type: 'milestone', prereq: { all: ['b_project'] },
        why: 'Commit to a project across multiple sessions until sent.',
        criteria: [crit('sends', 'Project send', 1, 'problem')], templates: ['b_project'] }
    ],
    supports: [
      ['b_dropknee', 'b_v4'], ['b_heelhook', 'b_v5proj'], ['b_overhang', 'b_v5'],
      ['b_preview', 'b_v4']
    ]
  };

  // ---- SESSION TEMPLATES ----------------------------------------------------
  // No hardcoded `duration` — use CoachDuration.calcDuration(template) at runtime.
  // kind:'strength' → live set/rep runner. kind:'climbing' → climbing logger.
  var TEMPLATES = {
    // Muscle-up world
    mu_strength: { id: 'mu_strength', worldId: 'muscleup', kind: 'strength', name: 'Pulling Strength', type: 'strength',
      difficulty: 'Medium-High',
      blocks: [
        { exId: 'pullup', label: 'Strict Pull-Ups', scheme: 'ladder', steps: [1, 2, 3], rounds: 5,
          restBetweenStepsSec: 25, restBetweenRoundsSec: 150, note: '1-2-3 × 5 rounds, clean reps' },
        { exId: 'scap', label: 'Scapular Pull-Ups', scheme: 'sets', sets: 3, reps: 8 }
      ] },
    mu_volume: { id: 'mu_volume', worldId: 'muscleup', kind: 'strength', name: 'Pulling Volume', type: 'volume',
      difficulty: 'Medium',
      blocks: [{ exId: 'pullup', label: 'Pull-Ups — Pyramid', scheme: 'pyramid', rounds: 5 }] },
    mu_highpull: { id: 'mu_highpull', worldId: 'muscleup', kind: 'strength', name: 'High Pull', type: 'power',
      difficulty: 'High',
      blocks: [
        { exId: 'fastpull', label: 'Explosive Pull-Ups', scheme: 'sets', sets: 5, reps: 3, note: 'Maximum power upward' },
        { exId: 'c2b', label: 'Chest-to-Bar', scheme: 'sets', sets: 4, reps: 3 }
      ] },
    mu_transition: { id: 'mu_transition', worldId: 'muscleup', kind: 'strength', name: 'Transition Technique', type: 'skill',
      difficulty: 'Medium',
      blocks: [
        { exId: 'lowtrans', label: 'Low-Bar Transition Drill', scheme: 'sets', sets: 5, reps: 3 },
        { exId: 'negmu', label: 'Negative Muscle-Up', scheme: 'sets', sets: 4, reps: 2 }
      ] },
    mu_dip: { id: 'mu_dip', worldId: 'muscleup', kind: 'strength', name: 'Push & Support', type: 'support',
      difficulty: 'Medium',
      blocks: [
        { exId: 'support', label: 'Support Hold', scheme: 'hold', sets: 4, seconds: 15 },
        { exId: 'dip', label: 'Straight-Bar Dips', scheme: 'sets', sets: 4, reps: 6 }
      ] },
    mu_integrate: { id: 'mu_integrate', worldId: 'muscleup', kind: 'strength', name: 'Muscle-Up Integration', type: 'integration',
      difficulty: 'High',
      blocks: [
        { exId: 'bandmu', label: 'Banded Muscle-Up', scheme: 'sets', sets: 4, reps: 3 },
        { exId: 'negmu', label: 'Controlled Negatives', scheme: 'sets', sets: 3, reps: 2 }
      ] },
    mu_light: { id: 'mu_light', worldId: 'muscleup', kind: 'strength', name: 'Light Practice', type: 'light',
      difficulty: 'Easy',
      blocks: [
        { exId: 'deadhang', label: 'Active Hang', scheme: 'hold', sets: 3, seconds: 30 },
        { exId: 'scap', label: 'Scapular Pull-Ups', scheme: 'sets', sets: 3, reps: 8 },
        { exId: 'hollow', label: 'Hollow Body', scheme: 'hold', sets: 3, seconds: 25 }
      ] },
    mu_test: { id: 'mu_test', worldId: 'muscleup', kind: 'strength', name: 'Performance Test', type: 'test',
      difficulty: 'Test',
      blocks: [{ exId: 'pullup', label: 'Max Pull-Up Test', scheme: 'amrap', sets: 1 }] },
    // Bouldering world
    b_volume: { id: 'b_volume', worldId: 'boulder', kind: 'climbing', name: 'Technique Volume', type: 'volume',
      difficulty: 'Easy', targetGrade: 'V0–V1', focus: 'Silent feet and precise foot placement' },
    b_consolidate: { id: 'b_consolidate', worldId: 'boulder', kind: 'climbing', name: 'Grade Consolidation', type: 'consolidation',
      difficulty: 'Medium', targetGrade: 'V1–V3', focus: 'Several problems at the same grade, different styles' },
    b_project: { id: 'b_project', worldId: 'boulder', kind: 'climbing', name: 'Project Session', type: 'project',
      difficulty: 'High', targetGrade: 'V3–V5', focus: 'One hard problem, crux ID and proper rest' },
    b_technique: { id: 'b_technique', worldId: 'boulder', kind: 'climbing', name: 'Movement Vocabulary', type: 'movement',
      difficulty: 'Medium', targetGrade: 'V1–V3', focus: 'Focused movement drills (flagging / heel hook / drop knee)' },
    b_power: { id: 'b_power', worldId: 'boulder', kind: 'climbing', name: 'Power & Dynamic Movement', type: 'power',
      difficulty: 'High', targetGrade: 'V2–V4', focus: 'Deadpoints and dynamic moves on overhangs' },
    b_strength: { id: 'b_strength', worldId: 'boulder', kind: 'strength', name: 'Supplemental Strength', type: 'support',
      difficulty: 'Medium',
      blocks: [
        { exId: 'activehang', label: 'Active Hang', scheme: 'hold', sets: 4, seconds: 30 },
        { exId: 'lockoff', label: 'Lock-Off', scheme: 'hold', sets: 3, seconds: 10 }
      ] },
    b_test: { id: 'b_test', worldId: 'boulder', kind: 'climbing', name: 'Test Session', type: 'test',
      difficulty: 'Test', targetGrade: 'V5', focus: 'Attempt a send at target grade' }
  };

  // Exercise catalog — every entry is relevant to an active goal. Fields:
  //   category, purpose, measure ('reps'|'sec'|'weight'), benchKey (personal
  //   benchmark), related (skill node ids), alternatives (approved swaps),
  //   equipment, defaults (default sets/reps/seconds), cues (technique).
  // worlds/tracks are DERIVED from `related` at read time (see nodeIndex/branch).
  function ex(o) { o.measure = o.measure || 'reps'; o.related = o.related || []; o.alternatives = o.alternatives || []; return o; }
  var EXERCISES = {
    pullup: ex({ id: 'pullup', name: 'Strict Pull-Up', category: 'Pulling', measure: 'reps', benchKey: 'pullup_max',
      purpose: 'Vertical pulling strength — the backbone of the muscle-up and of steep climbing.',
      cues: 'Full range — straight arms to chin above the bar, no kip.', related: ['mu_pull1', 'mu_pull5', 'mu_pull10'],
      alternatives: ['ring_row', 'weighted_pullup'], equipment: 'Pull-up bar', defaults: { sets: 5, reps: 5 } }),
    weighted_pullup: ex({ id: 'weighted_pullup', name: 'Weighted Pull-Up', category: 'Pulling', measure: 'weight', benchKey: 'weighted_pullup_kg',
      purpose: 'Adds load once bodyweight pull-ups are easy — builds the strength reserve for muscle-ups and hard climbing.',
      cues: 'Small load increments, keep the same clean full-range rep.', related: ['mu_pull10'],
      alternatives: ['pullup'], equipment: 'Belt + plate or dumbbell', defaults: { sets: 5, reps: 3 } }),
    scap: ex({ id: 'scap', name: 'Scapular Pull-Up', category: 'Pulling', measure: 'reps',
      purpose: 'Scapular control that initiates every pull and protects the shoulder.',
      cues: 'Straight arms; pull the shoulders down and back only.', related: ['mu_scap'],
      alternatives: ['ring_row'], equipment: 'Pull-up bar', defaults: { sets: 3, reps: 8 } }),
    ring_row: ex({ id: 'ring_row', name: 'Ring Row', category: 'Pulling', measure: 'reps',
      purpose: 'Scalable horizontal pull for building toward a first strict pull-up.',
      cues: 'Body in one line; adjust foot position to set difficulty.', related: ['mu_pull1'],
      alternatives: ['scap', 'pullup'], equipment: 'Rings or low bar', defaults: { sets: 3, reps: 8 } }),
    deadhang: ex({ id: 'deadhang', name: 'Active Dead Hang', category: 'Grip', measure: 'sec', benchKey: 'deadhang_secs',
      purpose: 'Active shoulder engagement and grip endurance — the base of all hanging.',
      cues: 'Shoulders active, not hanging passively; even breathing.', related: ['mu_deadhang', 'b_activehang'],
      alternatives: ['activehang'], equipment: 'Pull-up bar', defaults: { sets: 3, seconds: 30 } }),
    fastpull: ex({ id: 'fastpull', name: 'High Pull (Explosive)', category: 'Power', measure: 'reps',
      purpose: 'Explosive pulling power that drives the chest high for the transition.',
      cues: 'Maximum acceleration upward, controlled descent.', related: ['mu_fastpull'],
      alternatives: [], equipment: 'Pull-up bar', defaults: { sets: 5, reps: 3 } }),
    c2b: ex({ id: 'c2b', name: 'Chest-to-Bar Pull-Up', category: 'Pulling', measure: 'reps',
      purpose: 'The extra pulling range needed to get above the bar.',
      cues: 'Pull until the chest touches the bar; keep the body tight.', related: ['mu_c2b'],
      alternatives: [], equipment: 'Pull-up bar', defaults: { sets: 4, reps: 3 } }),
    support: ex({ id: 'support', name: 'Ring / Straight-Bar Support Hold', category: 'Push & Support', measure: 'sec', benchKey: 'ring_support_secs',
      purpose: 'The locked support position you land in after the transition.',
      cues: 'Straight locked arms above the bar, tight body, shoulders down.', related: ['mu_support'],
      alternatives: [], equipment: 'Rings or straight bar', defaults: { sets: 4, seconds: 15 } }),
    dip: ex({ id: 'dip', name: 'Straight-Bar Dip', category: 'Push', measure: 'reps', benchKey: 'dips_max',
      purpose: 'Pushing strength that finishes the muscle-up above the bar.',
      cues: 'Controlled descent, full lockout at the top.', related: ['mu_dip5'],
      alternatives: ['pbdip'], equipment: 'Straight bar', defaults: { sets: 4, reps: 6 } }),
    pbdip: ex({ id: 'pbdip', name: 'Parallel-Bar Dip', category: 'Push', measure: 'reps',
      purpose: 'Parallel-bar pushing strength; a friendlier alternative to straight-bar dips.',
      cues: 'Shoulders down, slight forward lean, full lockout.', related: ['mu_dip5'],
      alternatives: ['dip'], equipment: 'Parallel bars', defaults: { sets: 4, reps: 6 } }),
    hollow: ex({ id: 'hollow', name: 'Hollow Body Hold', category: 'Core', measure: 'sec',
      purpose: 'A tight body line that reduces swing and saves energy.',
      cues: 'Lower back pressed to the floor, pelvis slightly tucked.', related: ['mu_hollow'],
      alternatives: [], equipment: 'Floor', defaults: { sets: 3, seconds: 25 } }),
    lowtrans: ex({ id: 'lowtrans', name: 'Low-Bar Transition Drill', category: 'Skill', measure: 'reps',
      purpose: 'Rehearse the transition feel safely at a low height.',
      cues: 'Get the wrists over the bar quickly — no "chicken wing".', related: ['mu_lowtrans'],
      alternatives: [], equipment: 'Low bar', defaults: { sets: 5, reps: 3 } }),
    negmu: ex({ id: 'negmu', name: 'Negative Muscle-Up', category: 'Skill', measure: 'reps',
      purpose: 'Own the full transition path through a slow, controlled descent.',
      cues: 'Slow descent through the transition; control the full range.', related: ['mu_negmu'],
      alternatives: [], equipment: 'Bar + box', defaults: { sets: 4, reps: 2 } }),
    bandmu: ex({ id: 'bandmu', name: 'Banded Muscle-Up', category: 'Skill', measure: 'reps',
      purpose: 'Connect the whole chain with light band assistance.',
      cues: 'Minimal band assistance; keep a clean bar path.', related: ['mu_bandmu'],
      alternatives: [], equipment: 'Bar + resistance band', defaults: { sets: 4, reps: 3 } }),
    activehang: ex({ id: 'activehang', name: 'Active Hang', category: 'Grip', measure: 'sec', benchKey: 'deadhang_secs',
      purpose: 'Active and engaged shoulders — the base for wall strength.',
      cues: 'Shoulders active and packed; ribs down.', related: ['b_activehang'],
      alternatives: ['deadhang'], equipment: 'Pull-up bar or jug', defaults: { sets: 4, seconds: 30 } }),
    lockoff: ex({ id: 'lockoff', name: 'Lock-Off Hold', category: 'Pulling', measure: 'sec',
      purpose: 'Hold a bent-arm lock while the other hand reaches for the next hold.',
      cues: 'Hold at a stable bent-arm angle; stay tight.', related: ['b_lockoff'],
      alternatives: [], equipment: 'Pull-up bar', defaults: { sets: 3, seconds: 10 } })
  };

  var WORLDS = [MUSCLEUP, BOULDER];

  var CLIMB_RESULTS = [
    { v: 'flash', label: 'Flash' }, { v: 'send', label: 'Send' },
    { v: 'crux', label: 'Reached Crux' }, { v: 'progress', label: 'Progress' },
    { v: 'none', label: 'No Progress' }, { v: 'abandon', label: 'Abandoned' }
  ];
  var CLIMB_STYLES = [
    { v: 'slab', label: 'Slab' }, { v: 'vertical', label: 'Vertical' },
    { v: 'overhang', label: 'Overhang' }, { v: 'dyno', label: 'Dynamic' },
    { v: 'crimp', label: 'Crimp' }, { v: 'sloper', label: 'Sloper' }
  ];

  return {
    contentVersion: '2026-07-22',
    worlds: WORLDS,
    worldsById: WORLDS.reduce(function (o, w) { o[w.id] = w; return o; }, {}),
    templates: TEMPLATES,
    exercises: EXERCISES,
    climbResults: CLIMB_RESULTS,
    climbStyles: CLIMB_STYLES,
    nodeIndex: WORLDS.reduce(function (o, w) {
      w.nodes.forEach(function (n) { o[n.id] = { node: n, worldId: w.id }; });
      return o;
    }, {})
  };
});
