/*
 * Skill Progression Coach — settings + resolved workout prescription (pure, UMD).
 *
 * ONE resolved prescription combines, in increasing precedence:
 *   1. Saved template defaults (from CoachData templates)
 *   2. User-specific workout defaults  (settings.workoutDefaults[templateId])
 *   3. Today-only edits                (a transient override for one workout)
 *   4. Dynamic in-session adjustments   (applied by the runner to its snapshot)
 *
 * The runner builds its workout from a resolved prescription and then owns its
 * own snapshot — later default changes never mutate an in-progress workout.
 * Dynamic adjustments never persist to defaults unless the user saves them.
 *
 * Pure and DOM-free so the resolution is inspectable and unit-testable.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./duration.js'));
  else root.CoachSettings = factory(root.CoachDuration);
})(typeof self !== 'undefined' ? self : this, function (Duration) {
  'use strict';

  var SETTINGS_VERSION = 1;

  function restForType(type) { return Duration.restForType(type); }

  // Normalise one block into a fully-resolved block carrying every parameter the
  // duration model and the runner need. Idempotent (safe to re-run on a resolved
  // block). exId/label/note flow through so exercise swaps and removals survive.
  function resolvedBlock(b, type) {
    var out = { scheme: b.scheme, exId: b.exId, label: b.label, note: b.note || '' };
    if (b.scheme === 'ladder') {
      out.steps = (b.steps || [1, 2, 3]).slice();
      out.rounds = b.rounds != null ? b.rounds : 1;
      out.restBetweenStepsSec = b.restBetweenStepsSec != null ? b.restBetweenStepsSec : Duration.LADDER_STEP_REST;
      out.restBetweenRoundsSec = b.restBetweenRoundsSec != null ? b.restBetweenRoundsSec : Duration.LADDER_ROUND_REST;
      out.maxTarget = b.maxTarget != null ? b.maxTarget : null;
      out.adaptEnabled = b.adaptEnabled !== false;
    } else if (b.scheme === 'pyramid') {
      out.steps = (b.steps || [1, 2, 3, 2, 1]).slice();
      out.rounds = b.rounds != null ? b.rounds : 1;
      out.restSecs = b.restSecs != null ? b.restSecs : restForType(type);
      out.adaptEnabled = b.adaptEnabled !== false;
    } else if (b.scheme === 'hold') {
      out.sets = b.sets != null ? b.sets : 3;
      out.seconds = b.seconds != null ? b.seconds : 30;
      out.restSecs = b.restSecs != null ? b.restSecs : restForType(type);
    } else if (b.scheme === 'amrap') {
      /* single max set — no editable numeric params */
    } else {
      out.scheme = 'sets';
      out.sets = b.sets != null ? b.sets : 3;
      out.reps = b.reps != null ? b.reps : 5;
      out.restSecs = b.restSecs != null ? b.restSecs : restForType(type);
      out.adaptEnabled = b.adaptEnabled !== false;
    }
    return out;
  }

  // Template defaults as a { blocks:[…] } prescription object.
  function defaultsForTemplate(t) {
    return { blocks: (t.blocks || []).map(function (b) { return resolvedBlock(b, t.type); }) };
  }

  function userDefault(t, settings) {
    var d = settings && settings.workoutDefaults && settings.workoutDefaults[t.id];
    return (d && d.blocks) ? d : null;
  }

  // The most-specific prescription: today edit → user default → template default.
  function effective(t, settings, todayEdit) {
    if (todayEdit && todayEdit.blocks) return todayEdit;
    return userDefault(t, settings) || defaultsForTemplate(t);
  }

  // Resolve to a template-shaped object the duration calc and runner consume.
  function resolvePrescription(t, settings, todayEdit) {
    var eff = effective(t, settings, todayEdit);
    var resolved = {};
    Object.keys(t).forEach(function (k) { resolved[k] = t[k]; });
    resolved.blocks = eff.blocks.map(function (b) { return resolvedBlock(b, t.type); });
    return resolved;
  }

  function normBlocks(blocks, type) {
    return JSON.stringify((blocks || []).map(function (b) { return resolvedBlock(b, type); }));
  }
  // Does a today-only edit differ from the saved default (user or template)?
  function isModifiedForToday(t, settings, todayEdit) {
    if (!todayEdit || !todayEdit.blocks) return false;
    var base = userDefault(t, settings) || defaultsForTemplate(t);
    return normBlocks(todayEdit.blocks, t.type) !== normBlocks(base.blocks, t.type);
  }
  // Does the user have a saved default that differs from the template's?
  function isCustomDefault(t, settings) {
    var d = userDefault(t, settings);
    if (!d) return false;
    return normBlocks(d.blocks, t.type) !== normBlocks(defaultsForTemplate(t).blocks, t.type);
  }

  // Parse a step/rep sequence typed as "1-2-3", "1–2–3", "5,4,3,2,1", "1 2 3".
  function parseSteps(text) {
    if (Array.isArray(text)) return text.map(Number).filter(function (n) { return n > 0; });
    return String(text || '').split(/[^0-9]+/).map(function (s) { return parseInt(s, 10); })
      .filter(function (n) { return !isNaN(n) && n > 0; });
  }
  function stepsText(arr) { return (arr || []).join('–'); }

  // mm:ss for a seconds value; and a lenient parser accepting "150", "2:30".
  function fmtSecs(s) { s = Math.max(0, s | 0); var m = (s / 60) | 0, ss = s % 60; return m + ':' + (ss < 10 ? '0' : '') + ss; }
  function parseSecs(text) {
    var t = String(text == null ? '' : text).trim();
    if (t.indexOf(':') >= 0) { var p = t.split(':'); return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0); }
    return parseInt(t, 10) || 0;
  }

  function defaultSettings() {
    return { version: SETTINGS_VERSION, workoutDefaults: {}, timer: { sound: true, vibrate: true, countdown: true }, exercises: {} };
  }
  // Additive migration: never drops unknown keys, always yields a valid shape.
  function migrate(s) {
    s = s || {};
    if (!s.workoutDefaults || typeof s.workoutDefaults !== 'object') s.workoutDefaults = {};
    if (!s.timer || typeof s.timer !== 'object') s.timer = { sound: true, vibrate: true, countdown: true };
    else {
      if (s.timer.sound == null) s.timer.sound = true;
      if (s.timer.vibrate == null) s.timer.vibrate = true;
      if (s.timer.countdown == null) s.timer.countdown = true;
    }
    if (!s.exercises || typeof s.exercises !== 'object') s.exercises = {};
    s.version = SETTINGS_VERSION;
    return s;
  }
  function exerciseEnabled(settings, exId) {
    var e = settings && settings.exercises && settings.exercises[exId];
    return !e || e.enabled !== false;
  }

  return {
    SETTINGS_VERSION: SETTINGS_VERSION,
    resolvedBlock: resolvedBlock,
    defaultsForTemplate: defaultsForTemplate,
    effective: effective,
    resolvePrescription: resolvePrescription,
    isModifiedForToday: isModifiedForToday,
    isCustomDefault: isCustomDefault,
    parseSteps: parseSteps,
    stepsText: stepsText,
    fmtSecs: fmtSecs,
    parseSecs: parseSecs,
    defaultSettings: defaultSettings,
    migrate: migrate,
    exerciseEnabled: exerciseEnabled
  };
});
