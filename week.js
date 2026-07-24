/*
 * Skill Progression Coach — canonical Weekly Plan (data-driven, UMD, pure).
 *
 * This is the SINGLE source of truth for what the user trains and when. Today,
 * the Week screen, workout preview and the Skill Map all read from here — there
 * is no competing recommendation logic that ignores the schedule.
 *
 * Two layers:
 *   1. Static content (this file): the approved program template + one canonical
 *      metadata record per planned exercise. Shipped in code, but seeded into the
 *      user's own plan instance (spc_c_plan) — it is NOT forced as an immutable
 *      universal default onto hypothetical future users; the user owns their copy.
 *   2. Pure logic: a simple, explainable weekly-load model and per-day resolver
 *      that turns "planned day" + "actual weekly load / readiness" into "today's
 *      executable session" with named, cause-tagged adaptations.
 *
 * Deliberately NOT here: a rigid "max N pull exposures per week" rule, a
 * scientific optimizer, or any new skill worlds. Load is tracked as a few
 * explainable dimensions; adaptations always state their specific cause.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CoachWeek = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PLAN_VERSION = 3;

  // ---- goals & skills (approved configuration, Part 4) --------------------
  var GOALS = {
    v5: { id: 'v5', name: 'First V5', world: 'boulder' },
    muscleup: { id: 'muscleup', name: 'First Muscle-Up', world: 'muscleup' }
  };
  var SKILLS = {
    pullups10: { id: 'pullups10', name: '10 Pull-Ups', active: true, node: 'mu_pull10' },
    pistol: { id: 'pistol', name: 'Pistol Squat', active: true, node: null },
    highpull: { id: 'highpull', name: 'Chest-to-Bar / High Pull', active: false, node: 'mu_c2b' },
    transition: { id: 'transition', name: 'Muscle-Up Transition', active: false, node: 'mu_negmu' },
    dips: { id: 'dips', name: 'Parallel Bar Dips', active: false, node: 'mu_dip5' },
    tophold: { id: 'tophold', name: 'Top Hold', active: false, node: 'mu_support' },
    t2b: { id: 't2b', name: 'Toes-to-Bar', active: false, node: 'mu_knee' },
    ringsupport: { id: 'ringsupport', name: 'Ring Support Hold', active: false, node: 'mu_support' }
  };

  // Role + Priority vocabularies (Part 6, Part 11).
  var ROLE = {
    MAIN: 'Main Skill Practice', SUPPORT: 'Supporting Exercise',
    MAINT: 'Maintenance', ASSESS: 'Assessment'
  };
  // A = do not miss, B = important skill support, C = useful support, D = maintenance.
  var PRIORITY_ORDER = ['A', 'B', 'C', 'D'];

  // ---- one canonical metadata record per planned exercise (Part 11) -------
  // goals[], skills[], role, priority, loads{dimension:0-2}, sub[], nodes[].
  // `why` maps a day-key → the reason it appears THAT day (no duplication in UI).
  function X(o) {
    o.goals = o.goals || []; o.skills = o.skills || []; o.sub = o.sub || [];
    o.nodes = o.nodes || []; o.loads = o.loads || {}; o.why = o.why || {};
    o.optional = !!o.optional; o.conditional = o.conditional || null;
    return o;
  }
  var EX = {
    bouldering: X({ id: 'bouldering', name: 'Bouldering', goals: ['v5'], skills: [], role: ROLE.MAIN, priority: 'A',
      nodes: ['b_v5proj', 'b_v4', 'b_v5'], templateId: 'b_project',
      loads: { pull: 2, grip: 2, elbow: 1, shoulder: 1, explosive: 1, failure: 1 },
      why: { sun: 'Main skill practice for First V5 — real climbing is the primary driver of the grade.' },
      overlaps: ['Pulling & grip load here shapes Monday High Pull and the rest of the week.'] }),

    highpull: X({ id: 'highpull', name: 'Chest-to-Bar / High Pull', goals: ['muscleup'], skills: ['highpull'], role: ROLE.MAIN, priority: 'B',
      nodes: ['mu_fastpull', 'mu_c2b'], templateId: 'mu_highpull',
      loads: { pull: 2, grip: 1, elbow: 1, shoulder: 1, explosive: 2, failure: 1 },
      why: { mon: 'Explosive pulling for First Muscle-Up. Kept on Monday because the gym has the bar, bands and equipment.' },
      conditional: 'Skipped when Sunday climbing was hard and forearm/pulling fatigue remains high. Not moved to Tuesday.',
      overlaps: ['Shares pulling load with climbing, Pyramid and Ladder.'] }),
    transition_drill: X({ id: 'transition_drill', name: 'Transition Drill', goals: ['muscleup'], skills: ['transition'], role: ROLE.MAIN, priority: 'B',
      nodes: ['mu_lowtrans', 'mu_negmu'], templateId: 'mu_transition',
      loads: { pull: 1, grip: 1, elbow: 1, shoulder: 1, explosive: 1, failure: 0 },
      why: { mon: '2–3 clean technical sets once per week for the Muscle-Up transition, early enough that fatigue does not wreck technique.' },
      conditional: 'If High Pull is skipped, low-load transition may still remain when pain and fatigue allow.' }),
    pbdips: X({ id: 'pbdips', name: 'Parallel Bar Dips', goals: ['muscleup'], skills: ['dips'], role: ROLE.SUPPORT, priority: 'B',
      nodes: ['mu_dip5'], templateId: 'mu_dip', loads: { push: 2, shoulder: 1, elbow: 1 },
      why: { mon: 'Pushing/support strength that finishes the muscle-up above the bar.' } }),
    incline_press: X({ id: 'incline_press', name: 'Incline Chest Press', goals: [], skills: [], role: ROLE.MAINT, priority: 'C',
      loads: { push: 2, shoulder: 1 },
      why: { mon: 'General pushing and personal upper-chest development — maintenance, not a direct V5 or Muscle-Up skill.' } }),
    chest_fly: X({ id: 'chest_fly', name: 'Chest Fly', goals: [], skills: [], role: ROLE.MAINT, priority: 'D',
      loads: { push: 1 },
      why: { mon: 'Physique maintenance. Does not directly develop V5 or Muscle-Up.' } }),
    biceps: X({ id: 'biceps', name: 'Biceps', goals: [], skills: [], role: ROLE.MAINT, priority: 'D',
      loads: { pull: 1, elbow: 1 },
      why: { mon: 'General arm maintenance. First to drop when time or fatigue is limited.' } }),
    triceps: X({ id: 'triceps', name: 'Triceps', goals: [], skills: [], role: ROLE.MAINT, priority: 'D',
      loads: { push: 1, elbow: 1 },
      why: { mon: 'General arm maintenance. First to drop when time or fatigue is limited.' } }),
    hip_abduction: X({ id: 'hip_abduction', name: 'Hip Abduction', goals: ['v5'], skills: [], role: ROLE.SUPPORT, priority: 'C',
      loads: { legs: 1 },
      why: { mon: 'Hip control and stability that supports First V5.' } }),

    pullup_pyramid: X({ id: 'pullup_pyramid', name: 'Pull-Up Pyramid', goals: ['muscleup', 'v5'], skills: ['pullups10'], role: ROLE.MAIN, priority: 'A',
      nodes: ['mu_pull10'], templateId: 'mu_volume', loads: { pull: 2, grip: 1, elbow: 1, failure: 1 },
      why: { tue: 'Main pull-up volume practice for the 10 Pull-Ups skill. Kept controlled, away from unnecessary failure.' },
      overlaps: ['Trains the same 10 Pull-Ups skill as Friday’s Ladder; supported Monday by High Pull.'] }),
    tophold: X({ id: 'tophold', name: 'Top Hold', goals: ['muscleup'], skills: ['tophold'], role: ROLE.SUPPORT, priority: 'C',
      nodes: ['mu_support'], loads: { push: 1, shoulder: 1 },
      why: { tue: 'Support-position strength for the Muscle-Up, with partial climbing carryover.' } }),
    t2b: X({ id: 't2b', name: 'Toes-to-Bar', goals: ['muscleup', 'v5'], skills: ['t2b'], role: ROLE.SUPPORT, priority: 'C',
      nodes: ['mu_hollow', 'mu_knee'], sub: ['deadhang'], loads: { grip: 1, core: 2 },
      why: { tue: 'Compression, hanging control and body tension for both goals.',
        fri: 'Core and hanging control to finish the pull session — chosen over Dead Hang by accumulated grip load.' } }),
    ringsupport: X({ id: 'ringsupport', name: 'Ring Support Hold', goals: ['muscleup'], skills: ['ringsupport'], role: ROLE.MAINT, priority: 'C', optional: true,
      nodes: ['mu_support'], loads: { push: 1, shoulder: 1 },
      why: { tue: 'Optional support-hold maintenance for the Muscle-Up, based on Monday pressing and shoulder load.',
        fri: 'Optional maintenance — skipped if already done Tuesday or if Monday created high shoulder/triceps fatigue.' } }),
    deadhang: X({ id: 'deadhang', name: 'Dead Hang', goals: ['muscleup', 'v5'], skills: [], role: ROLE.SUPPORT, priority: 'C', optional: true,
      nodes: ['mu_deadhang'], sub: ['t2b'], loads: { grip: 2 },
      why: { tue: 'May replace Toes-to-Bar when grip is fresh and hanging capacity needs work.',
        fri: 'May replace Toes-to-Bar when grip is fresh and hanging capacity needs work.' } }),

    bulgarian_split: X({ id: 'bulgarian_split', name: 'Bulgarian Split Squat / Step-Up', goals: ['v5'], skills: ['pistol'], role: ROLE.SUPPORT, priority: 'B',
      loads: { legs: 2 },
      why: { wed: 'Single-leg strength directly supporting the Pistol Squat active skill.',
        thu: 'Single-leg strength directly supporting the Pistol Squat active skill.' } }),
    hip_thrust: X({ id: 'hip_thrust', name: 'Hip Thrust', goals: ['v5'], skills: [], role: ROLE.SUPPORT, priority: 'C',
      loads: { legs: 1 },
      why: { wed: 'Posterior-chain support relevant to climbing power.',
        thu: 'Posterior-chain support relevant to climbing power.' } }),
    deadlift_rdl: X({ id: 'deadlift_rdl', name: 'Deadlift / RDL', goals: ['v5'], skills: [], role: ROLE.SUPPORT, priority: 'C', optional: true,
      loads: { legs: 2, grip: 1 },
      conditional: 'Only when posterior-chain load is appropriate. Not required on both Wednesday and Thursday.',
      why: { wed: 'Posterior-chain strength when load is appropriate.',
        thu: 'Posterior-chain strength when load is appropriate.' } }),

    pistol: X({ id: 'pistol', name: 'Pistol Squat', goals: ['v5'], skills: ['pistol'], role: ROLE.MAIN, priority: 'A',
      loads: { legs: 2 },
      why: { fri: 'Main skill practice for the Pistol Squat active skill. Placed first, before fatigue lowers skill quality.' },
      overlaps: ['Supported by Bulgarian Split Squat / Step-Up in the group workouts.'] }),
    pullup_ladder: X({ id: 'pullup_ladder', name: 'Pull-Up Ladder', goals: ['muscleup', 'v5'], skills: ['pullups10'], role: ROLE.MAIN, priority: 'A',
      nodes: ['mu_pull10'], templateId: 'mu_strength', loads: { pull: 2, grip: 1, elbow: 1 },
      why: { fri: 'Main pull-up volume practice (default 1–2–3 × 5 complete rounds). Volume practice, not a failure test.' },
      overlaps: ['Same 10 Pull-Ups skill as Tuesday’s Pyramid; load adjusted by the week’s pulling.'] }),
    wristroller: X({ id: 'wristroller', name: 'Wrist Roller', goals: ['v5'], skills: [], role: ROLE.SUPPORT, priority: 'C', optional: true,
      loads: { grip: 1 },
      conditional: 'Optional support only. Never required. Max 2 sets, once per week, and only when forearms feel good and weekly grip load is not already high. Must not displace climbing, pull-ups, Pistol or transition work.',
      why: { fri: 'Optional forearm support for First V5 — shown only when forearms feel good and grip load is low.' } }),

    light_pullups: X({ id: 'light_pullups', name: 'Light Pull-Up Practice', goals: ['muscleup'], skills: ['pullups10'], role: ROLE.MAINT, priority: 'C', optional: true,
      loads: { pull: 1 },
      why: { sat: 'Optional very light practice: 2 reps × 3–4 across the day. Only when fresh, no pain, and Friday was light or skipped.' } })
  };

  // ---- the approved weekly program (Part 5) -------------------------------
  // dayId matches JS Date.getDay(): 0=Sunday … 6=Saturday.
  var DAYS = [
    { id: 0, key: 'sun', label: 'Sunday', session: 'Climbing', sub: 'Bouldering', type: 'climbing',
      goal: 'v5', templateId: 'b_project',
      emphasis: [
        { v: 'projecting', label: 'Projecting' },
        { v: 'consolidation', label: 'Grade consolidation' },
        { v: 'technique', label: 'Technique' },
        { v: 'vocabulary', label: 'Movement vocabulary' }
      ],
      exercises: ['bouldering'] },
    { id: 1, key: 'mon', label: 'Monday', session: 'Free Gym', sub: 'Push + Explosive Pull', type: 'strength',
      goal: 'muscleup', templateId: 'mu_highpull',
      exercises: ['highpull', 'transition_drill', 'pbdips', 'incline_press', 'chest_fly', 'biceps', 'triceps', 'hip_abduction'] },
    { id: 2, key: 'tue', label: 'Tuesday', session: 'Home Skill Session', sub: 'Pull-Up Pyramid focus', type: 'strength',
      goal: 'muscleup', templateId: 'mu_volume',
      exercises: ['pullup_pyramid', 'tophold', 't2b', 'deadhang', 'ringsupport'] },
    { id: 3, key: 'wed', label: 'Wednesday', session: 'Group Workout', sub: 'Log what actually appeared', type: 'group',
      goal: 'v5', templateId: null,
      exercises: ['bulgarian_split', 'hip_thrust', 'deadlift_rdl'] },
    { id: 4, key: 'thu', label: 'Thursday', session: 'Group Workout', sub: 'Single-leg / posterior chain', type: 'group',
      goal: 'v5', templateId: null,
      exercises: ['bulgarian_split', 'hip_thrust', 'deadlift_rdl'] },
    { id: 5, key: 'fri', label: 'Friday', session: 'Home Pull Session', sub: 'Pistol + Pull-Up Ladder', type: 'strength',
      goal: 'muscleup', templateId: 'mu_strength',
      exercises: ['pistol', 'pullup_ladder', 't2b', 'deadhang', 'ringsupport', 'wristroller'] },
    { id: 6, key: 'sat', label: 'Saturday', session: 'Rest', sub: 'Recovery', type: 'rest',
      goal: null, templateId: null, exercises: [] }
  ];
  var DAYS_BY_ID = {}; DAYS.forEach(function (d) { DAYS_BY_ID[d.id] = d; });

  // The group-workout movement checklist (Part 5, Wed/Thu logging). Each has a
  // pull weight so "actual load" — not the label "Group Workout" — drives Friday.
  var GROUP_MOVES = [
    { v: 'pullups', label: 'Pull-Ups', pull: 2, grip: 1 },
    { v: 'rows', label: 'Rows', pull: 1, grip: 1 },
    { v: 'pulldowns', label: 'Pulldowns', pull: 1 },
    { v: 'deadlift', label: 'Deadlift / RDL', pull: 1, grip: 2, legs: 1 },
    { v: 'carries', label: 'Carries', grip: 2 },
    { v: 'grip', label: 'Grip-heavy work', grip: 2 },
    { v: 'singleleg', label: 'Single-leg work', legs: 2 },
    { v: 'hipthrust', label: 'Hip Thrust', legs: 1 },
    { v: 'pressing', label: 'Pressing', push: 1 }
  ];

  // ---- a fresh user plan instance (seeded, not a universal default) -------
  function seedPlan() {
    return {
      version: PLAN_VERSION,
      // per-day, per-week runtime state keyed by dayId; reset weekly by the app.
      dayLog: {},          // { dayId: { completed, climb:{}, group:{moves:[]}, adaptedFrom } }
      overrides: {},       // { dayId: 'planned' | 'alternative' }  (user choice, sticky for that day)
      emphasis: {},        // { 0: 'projecting' }  Sunday emphasis selection
      lastAssessment: {},  // { pullup: isoDate, pistol: ..., climb: ..., transition: ... }
      seededAt: new Date().toISOString()
    };
  }

  // ---- explainable weekly-load model (Part 7) -----------------------------
  // Reads the week's day-logs + readiness and returns a few named dimensions
  // plus plain-language flags. NO hard "N pull exposures" cap anywhere.
  function weeklyLoad(plan, ctx) {
    ctx = ctx || {};
    var logs = (plan && plan.dayLog) || {};
    var r = ctx.readiness || {};

    var sun = logs[0] && logs[0].climb;
    var hardClimb = !!(sun && sun.difficulty === 'hard');
    var climbGripHigh = !!(sun && sun.gripLoad === 'high');
    var climbPullHigh = !!(sun && sun.pullingLoad === 'high');
    var climbElbow = !!(sun && (sun.elbow === 'sore' || sun.elbow === 'painful'));

    // Sum actual group-workout pulling/grip from Wed + Thu logged movements.
    var groupPullScore = 0, groupGripScore = 0;
    [3, 4].forEach(function (d) {
      var g = logs[d] && logs[d].group;
      if (!g || !g.moves) return;
      g.moves.forEach(function (mv) {
        var m = GROUP_MOVES.filter(function (x) { return x.v === mv; })[0];
        if (!m) return;
        groupPullScore += (m.pull || 0);
        groupGripScore += (m.grip || 0);
      });
    });
    // Bucketed, explainable — not a rigid rule. 0=low,1-2=normal,3-4=elevated,5+=high.
    var groupPull = groupPullScore <= 0 ? 'low'
      : groupPullScore <= 2 ? 'normal'
      : groupPullScore <= 4 ? 'elevated' : 'high';

    var forearmFatigue = climbGripHigh || climbPullHigh || groupGripScore >= 3 ||
      (r.upperFatigue && r.upperFatigue >= 3);
    var shoulderFatigue = (r.upperFatigue && r.upperFatigue >= 3) ||
      !!(logs[1] && logs[1].completed); // Monday pressing done → shoulders taxed
    var gripHigh = climbGripHigh || groupGripScore >= 3;

    return {
      hardClimbRecent: hardClimb,
      climbElbow: climbElbow,
      forearmFatigue: forearmFatigue,
      shoulderFatigue: shoulderFatigue,
      gripHigh: gripHigh,
      groupPull: groupPull,
      groupPullScore: groupPullScore,
      groupGripScore: groupGripScore,
      pain: !!(r.pain || ctx.pain)
    };
  }

  // ---- per-day resolution (Parts 5, 6, 8) ---------------------------------
  // Returns { day, goal, items:[{ex, priority, role, included, note}], adaptations:[{exId,action,cause}],
  //           adapted:bool, alternative:{label,note}|null, templateId, ladderRounds, status }.
  function resolveDay(plan, dayId, ctx) {
    ctx = ctx || {};
    var day = DAYS_BY_ID[dayId];
    if (!day) return null;
    var load = weeklyLoad(plan, ctx);
    // override is the user's explicit choice for THIS day (Part 13): 'planned'
    // forces the original plan (ignore load-driven adaptations); 'alternative'
    // forces the lighter option; default (unset) = load-driven. The override
    // lives only in the plan instance — it never rewrites the program template.
    var override = (plan && plan.overrides && plan.overrides[dayId]) || null;
    var forcePlanned = override === 'planned';
    var forceAlt = override === 'alternative';
    var log = (plan && plan.dayLog && plan.dayLog[dayId]) || {};
    // adaptations = headline, load-driven changes (High Pull removal, Ladder
    // reduction) that flip the day to "Adapted from your weekly plan".
    // selections = routine choices (Toes-to-Bar vs Dead Hang, optional on/off)
    // that are NOT a plan deviation and never trigger the adapted banner.
    var adaptations = [], selections = [];
    var templateId = day.templateId;
    var ladderRounds = null; // null = use the workout's own (possibly user-edited) default
    var alternative = null;

    // Swap-alternates start excluded so the plan never shows both a hang option
    // (Dead Hang is the alternate to Toes-to-Bar) or an un-triggered optional
    // (Wrist Roller). The day logic below opts them in when appropriate.
    var DEFAULT_OFF = { deadhang: true, wristroller: true };
    var items = day.exercises.map(function (exId) {
      var meta = EX[exId];
      return { exId: exId, ex: meta, priority: meta ? meta.priority : 'D',
        role: meta ? meta.role : ROLE.MAINT, included: !DEFAULT_OFF[exId], note: '' };
    });
    function find(id) { for (var i = 0; i < items.length; i++) if (items[i].exId === id) return items[i]; return null; }

    // ---- Monday: conditional High Pull removal (Part 5, Part 8) ----------
    if (dayId === 1 && !forcePlanned) {
      if ((load.hardClimbRecent && load.forearmFatigue) || forceAlt) {
        var hp = find('highpull');
        if (hp) { hp.included = false; hp.note = 'Removed today'; }
        adaptations.push({ exId: 'highpull', action: 'removed',
          cause: forceAlt
            ? 'High Pull was removed because you chose the lighter alternative for today.'
            : 'High Pull was removed because Sunday climbing was marked Hard and forearm/pulling fatigue remains high.' });
        // Transition may remain only if no pain (low-load technique).
        if (load.pain) {
          var td = find('transition_drill');
          if (td) { td.included = false; td.note = 'Removed today'; }
          adaptations.push({ exId: 'transition_drill', action: 'removed',
            cause: 'Transition Drill was removed because a pain warning is active.' });
        } else {
          var td2 = find('transition_drill');
          if (td2) td2.note = 'Kept as low-load technique only';
        }
        templateId = load.pain ? null : 'mu_transition'; // start the lighter technical session
        alternative = { label: 'Adapted option', note: 'Push/support + light transition only (no explosive High Pull today).' };
      } else {
        alternative = { label: 'Shorter version', note: 'Drop Priority D isolation (Chest Fly, Biceps, Triceps) if time is short.' };
      }
    }

    // ---- Tuesday: Dead Hang may replace Toes-to-Bar by load --------------
    if (dayId === 2 && !forcePlanned) {
      applyHangChoice(items, find, load, selections, 'tue');
      // Ring support optional; keep unless Monday shoulder fatigue is high.
      if (load.shoulderFatigue) softDrop(find('ringsupport'), selections, 'ringsupport',
        'Ring Support Hold left optional because Monday pressing raised shoulder/triceps fatigue.');
      alternative = { label: 'Lighter alternative', note: 'Pyramid only, holds trimmed, if fatigue is high.' };
    }

    // ---- Friday: Ladder load adaptation + optionals (Part 5) -------------
    // Under low/normal load, ladderRounds stays null so the workout's own
    // (possibly user-edited) default — the planned 1–2–3 × 5 — is used as-is.
    // A number is set ONLY when the plan actively reduces the session.
    if (dayId === 5 && !forcePlanned) {
      var ladderItem = find('pullup_ladder');
      if (load.pain || load.groupPull === 'high') {
        templateId = 'mu_light';
        if (ladderItem) { ladderItem.note = 'Replaced with Light Practice'; }
        adaptations.push({ exId: 'pullup_ladder', action: 'lightened',
          cause: load.pain
            ? 'Ladder replaced with Light Practice because a pain warning is active.'
            : 'Ladder replaced with Light Practice because Wednesday/Thursday pulling load was very high.' });
        alternative = { label: 'Adapted option', note: 'Light or non-pulling practice — Pistol Squat still comes first.' };
      } else if (load.groupPull === 'elevated') {
        ladderRounds = 4;
        if (ladderItem) ladderItem.note = 'Reduced to 4 rounds (longer rest)';
        adaptations.push({ exId: 'pullup_ladder', action: 'reduced',
          cause: 'Ladder reduced to 4 rounds because Wednesday/Thursday group-workout pulling load was elevated.' });
        alternative = { label: 'Shorter version', note: 'Four Ladder rounds instead of five, with more rest.' };
      }
      applyHangChoice(items, find, load, selections, 'fri');
      // Ring support: skip if done Tuesday or high shoulder fatigue.
      var tueRing = plan && plan.dayLog && plan.dayLog[2] && plan.dayLog[2].completed;
      if (tueRing || load.shoulderFatigue) softDrop(find('ringsupport'), selections, 'ringsupport',
        tueRing ? 'Ring Support Hold skipped because it was already done Tuesday.'
          : 'Ring Support Hold left optional because of shoulder/triceps fatigue.');
      // Wrist roller: optional & conditional — opted in ONLY when forearms feel
      // good AND weekly grip load is not already high. Never required.
      var wr = find('wristroller');
      if (!load.forearmFatigue && !load.gripHigh) {
        if (wr) { wr.included = true; wr.note = 'Optional — max 2 sets'; }
      } else if (wr) { wr.included = false; wr.note = 'Not today'; }
    }

    // ---- Saturday: rest by default (Part 5) ------------------------------
    if (dayId === 6) {
      var fri = plan && plan.dayLog && plan.dayLog[5];
      var friLight = !fri || !fri.completed || (fri && fri.light);
      var offerLight = friLight && !load.pain && (ctx.readiness && ctx.readiness.energy >= 3);
      if (offerLight) {
        alternative = { label: 'Optional', note: 'Very light pull-up practice: 2 reps × 3–4 across the day.' };
      }
    }

    // ---- user override: force planned or lighter alternative -------------
    if (override === 'alternative' && alternative && dayId === 1) {
      // e.g. user chose the lighter option manually
      adaptations.push({ exId: null, action: 'user', cause: 'You chose the lighter alternative for today.' });
    }

    // status
    var status = 'upcoming';
    if (log.completed) status = 'completed';
    else if (day.type === 'group' && !(log.group && log.group.moves)) status = day.type === 'group' ? 'group-pending' : 'upcoming';
    else if (adaptations.length) status = 'adapted';
    if (day.type === 'rest') status = log.completed ? 'completed' : 'rest';

    return {
      day: day, goal: day.goal ? GOALS[day.goal] : null,
      items: items, adaptations: adaptations, selections: selections,
      adapted: adaptations.length > 0,
      alternative: alternative, templateId: templateId, ladderRounds: ladderRounds,
      plannedLadderRounds: 5, load: load, status: status, override: override
    };
  }

  // Dead Hang vs Toes-to-Bar: never prescribe both automatically (Part 5). This
  // is a routine SELECTION, not a plan deviation, so it never flips "adapted".
  function applyHangChoice(items, find, load, selections, dayKey) {
    var t2b = find('t2b'), dh = find('deadhang');
    // If grip is fresh → Dead Hang may replace Toes-to-Bar; if grip is high →
    // keep Toes-to-Bar (or a non-hanging core alt), and drop the extra hang.
    if (!load.gripHigh && !load.forearmFatigue) {
      if (t2b) { t2b.included = false; t2b.note = 'Swapped for Dead Hang (grip fresh)'; }
      if (dh) { dh.included = true; dh.note = 'Chosen: grip is fresh, hanging capacity needs work'; }
      selections.push({ exId: 'deadhang', action: 'swapped',
        cause: 'Dead Hang chosen over Toes-to-Bar because grip and forearms are fresh.' });
    } else {
      if (dh) { dh.included = false; dh.note = 'Not today'; }
      if (t2b) { t2b.included = true; t2b.note = 'Kept (grip already loaded — no extra hang)'; }
    }
  }
  function softDrop(item, selections, exId, cause) {
    if (!item) return;
    item.included = false; item.note = 'Optional — not today';
    selections.push({ exId: exId, action: 'optional-off', cause: cause });
  }

  // ---- priority-aware simplification (Part 6) -----------------------------
  // Reduce Priority D before C; never sacrifice A to protect accessory volume.
  function simplify(items, level) {
    // level: 1 = drop D, 2 = drop D and C. Returns { kept, removed:[{item,reason}] }.
    var removed = [];
    var kept = items.filter(function (it) {
      if (!it.included) return false;
      var p = it.priority;
      if (level >= 1 && p === 'D') { removed.push({ item: it, reason: 'maintenance (Priority D)' }); return false; }
      if (level >= 2 && p === 'C') { removed.push({ item: it, reason: 'useful support (Priority C)' }); return false; }
      return true;
    });
    return { kept: kept, removed: removed };
  }

  // ---- assessment triggers (Part 12) --------------------------------------
  // Assessment is a distinct role, available only when a trigger is met — never
  // scheduled automatically.
  function assessmentReady(kind, plan, ctx) {
    ctx = ctx || {}; plan = plan || {};
    var r = ctx.readiness || {};
    if (r.pain || ctx.pain) return { ready: false, reason: 'A pain warning is active.' };
    if (r.energy && r.energy <= 1) return { ready: false, reason: 'Energy/fatigue is low right now.' };
    var clean = (ctx.cleanCompletions && ctx.cleanCompletions[kind]) || 0;
    if (clean < 3) return { ready: false, reason: 'Complete a few more clean sessions first (' + clean + '/3).' };
    var last = plan.lastAssessment && plan.lastAssessment[kind];
    if (last) {
      var days = (Date.now() - new Date(last).getTime()) / 86400000;
      if (days < 14) return { ready: false, reason: 'Assessed recently — wait a bit longer.' };
    }
    return { ready: true, reason: 'Enough clean sessions, low fatigue, no pain — an assessment is available.' };
  }

  // ---- weekly overview for the Week screen --------------------------------
  function resolveWeek(plan, ctx) {
    return DAYS.map(function (d) { return resolveDay(plan, d.id, ctx); });
  }

  function todayId(ctx) {
    ctx = ctx || {};
    if (ctx.todayId != null) return ctx.todayId; // test/override hook
    return new Date().getDay();
  }

  return {
    PLAN_VERSION: PLAN_VERSION,
    GOALS: GOALS, SKILLS: SKILLS, ROLE: ROLE, PRIORITY_ORDER: PRIORITY_ORDER,
    EX: EX, DAYS: DAYS, DAYS_BY_ID: DAYS_BY_ID, GROUP_MOVES: GROUP_MOVES,
    seedPlan: seedPlan, weeklyLoad: weeklyLoad, resolveDay: resolveDay,
    resolveWeek: resolveWeek, simplify: simplify, assessmentReady: assessmentReady,
    todayId: todayId
  };
});
