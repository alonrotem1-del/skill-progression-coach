/*
 * Skill Progression Coach — raw data-safety backup / restore (pure, UMD).
 *
 * This is a SAFETY MECHANISM, not a migration format. It knows nothing about
 * any application schema (profile, plan, sessions, …) — it captures and
 * restores the EXACT raw string stored under each protected key, byte for
 * byte, and nothing else.
 *
 * Protected keys (16), exported AND restored under their own exact names:
 *   - the 8 spc_c_* keys in Store.KEYS (profile, state, sessions, bench,
 *     settings, plan, templates, adhoc)
 *   - the 2 spc_c_* keys outside Store.KEYS (workout, day) — transient
 *     execution state, but still real user data worth protecting
 *   - the 6 read-only legacy puc_* keys the app reads (log, plan, settings,
 *     session, progression, secondary)
 *
 * puc_* keys are exported AND restored under their OWN names — never
 * translated or merged into spc_c_* — because this is a raw snapshot, not a
 * migration. (Contrast with store.js's deriveBench/seedStates, which is a
 * one-way, best-effort READ of puc_* into spc_c_* content; this module never
 * does that.)
 *
 * A restore is a full snapshot, never a merge: a key absent from the backup
 * is removed if currently present; a key present in the backup is written
 * exactly as recorded, even if its value is the literal string "null".
 *
 * All storage access is injected (getRaw/setRaw/removeRaw), so every function
 * here is pure and testable without a browser or localStorage.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CoachBackup = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FORMAT = 'spc-backup';
  var FORMAT_VERSION = 1;
  var APP_ID = 'skill-progression-coach';

  // The single source of truth for what a backup covers. Additive-only: once
  // shipped, a key is never removed from this list, so an old backup file
  // always stays restorable. (A key the app stops writing simply stays
  // "not present" in future exports.)
  var PROTECTED_KEYS = [
    // spc_c_* inside Store.KEYS
    'spc_c_profile', 'spc_c_state', 'spc_c_sessions', 'spc_c_bench',
    'spc_c_settings', 'spc_c_plan', 'spc_c_templates', 'spc_c_adhoc',
    // spc_c_* outside Store.KEYS (in-progress execution state)
    'spc_c_workout', 'spc_c_day',
    // legacy puc_* — read-only elsewhere in the app; protected here too
    'puc_log', 'puc_plan', 'puc_settings', 'puc_session', 'puc_progression', 'puc_secondary'
  ];
  var PROTECTED_SET = {};
  PROTECTED_KEYS.forEach(function (k) { PROTECTED_SET[k] = true; });

  function isProtectedKey(k) { return !!PROTECTED_SET[k]; }
  // True for any spc_c_* literal, protected or not — used only by the test
  // suite's coverage guard to catch a NEW spc_c_* key introduced elsewhere in
  // the app without being added to PROTECTED_KEYS above.
  function isSpcKey(k) { return typeof k === 'string' && k.indexOf('spc_c_') === 0; }

  function bad(reason) { return { ok: false, reason: reason }; }
  function safeParse(raw) {
    if (raw === undefined || raw === null) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  // ---- export ---------------------------------------------------------------
  // getRaw(key) must return the EXACT stored string, or undefined/null if the
  // key does not exist. Values are never parsed or reserialized — captured
  // verbatim so a value that happens to be the string "null" is preserved
  // exactly, distinct from the key being absent.
  function exportAll(getRaw, meta) {
    meta = meta || {};
    var keys = {};
    PROTECTED_KEYS.forEach(function (k) {
      var v = getRaw(k);
      if (v === undefined || v === null) keys[k] = { present: false };
      else keys[k] = { present: true, value: String(v) };
    });
    return {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      app: APP_ID,
      appVersion: meta.appVersion != null ? meta.appVersion : null,
      exportedAt: meta.exportedAt || new Date().toISOString(),
      keys: keys
    };
  }

  // ---- validation -------------------------------------------------------
  // Pure, storage-free. Must pass before restoreAll performs a single write.
  // A valid envelope contains EXACTLY the protected key set — no fewer, no
  // more — because this exporter always writes all of them, so a partial or
  // over-full key map means a malformed or foreign file, not a legitimate
  // older/newer backup.
  function validateEnvelope(env) {
    if (!env || typeof env !== 'object' || Array.isArray(env)) return bad('not a backup object');
    if (env.format !== FORMAT) return bad('unrecognised backup format');
    if (typeof env.formatVersion !== 'number' || !isFinite(env.formatVersion)) return bad('missing or invalid format version');
    if (env.formatVersion !== FORMAT_VERSION) return bad('unsupported backup version: ' + env.formatVersion);
    if (env.app !== APP_ID) return bad('backup is for a different application');
    if (!env.keys || typeof env.keys !== 'object' || Array.isArray(env.keys)) return bad('missing or malformed key snapshot');

    var seen = Object.keys(env.keys);
    for (var i = 0; i < seen.length; i++) {
      if (!isProtectedKey(seen[i])) return bad('unexpected key in backup: ' + seen[i]);
    }
    for (var j = 0; j < PROTECTED_KEYS.length; j++) {
      var k = PROTECTED_KEYS[j];
      if (seen.indexOf(k) < 0) return bad('backup is missing expected key: ' + k);
      var rec = env.keys[k];
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return bad('malformed entry for key: ' + k);
      if (typeof rec.present !== 'boolean') return bad('malformed entry for key: ' + k);
      if (rec.present) {
        if (typeof rec.value !== 'string') return bad('malformed value for key: ' + k);
      } else if (Object.prototype.hasOwnProperty.call(rec, 'value')) {
        return bad('malformed entry for key: ' + k);
      }
    }
    return { ok: true };
  }

  // ---- restore ------------------------------------------------------------
  // setRaw(key,value) / removeRaw(key) / getRaw(key) act on the same store.
  // Validates the WHOLE envelope before any write. Captures a full pre-image
  // of every protected key first; if any write/remove throws mid-restore,
  // attempts to roll every protected key back to its pre-image and reports
  // the failure rather than leaving a half-restored store.
  function restoreAll(env, getRaw, setRaw, removeRaw) {
    var v = validateEnvelope(env);
    if (!v.ok) throw new Error('Backup rejected: ' + v.reason);

    var preImage = {};
    PROTECTED_KEYS.forEach(function (k) {
      var cur = getRaw(k);
      preImage[k] = (cur === undefined || cur === null) ? { present: false } : { present: true, value: String(cur) };
    });

    try {
      PROTECTED_KEYS.forEach(function (k) {
        var rec = env.keys[k]; // validated above: always present in env.keys
        if (rec.present) setRaw(k, rec.value); else removeRaw(k);
      });
      return { ok: true, restored: PROTECTED_KEYS.slice() };
    } catch (writeErr) {
      var rollbackFailed = [];
      PROTECTED_KEYS.forEach(function (k) {
        try {
          var pre = preImage[k];
          if (pre.present) setRaw(k, pre.value); else removeRaw(k);
        } catch (rollbackErr) {
          rollbackFailed.push(k);
        }
      });
      var msg = 'Restore failed: ' + (writeErr && writeErr.message ? writeErr.message : String(writeErr));
      msg += rollbackFailed.length
        ? '. Rollback ALSO failed for: ' + rollbackFailed.join(', ') + ' — those keys may be inconsistent.'
        : '. Your previous data was restored.';
      var err = new Error(msg);
      err.rollbackFailed = rollbackFailed;
      err.original = writeErr;
      throw err;
    }
  }

  // ---- in-progress detection ------------------------------------------------
  // Pure over getRaw. Used only to decide whether the restore confirmation
  // should warn that an in-progress workout/day will be replaced.
  function hasInProgressState(getRaw) {
    var wk = getRaw('spc_c_workout');
    if (wk !== undefined && wk !== null && wk !== '') return true;
    var day = safeParse(getRaw('spc_c_day'));
    if (day && (day.activeExId != null || day.status === 'in_progress')) return true;
    var adhoc = safeParse(getRaw('spc_c_adhoc'));
    if (adhoc && (adhoc.activeExId != null || adhoc.status === 'in_progress')) return true;
    return false;
  }

  return {
    FORMAT: FORMAT,
    FORMAT_VERSION: FORMAT_VERSION,
    APP_ID: APP_ID,
    PROTECTED_KEYS: PROTECTED_KEYS.slice(),
    isProtectedKey: isProtectedKey,
    isSpcKey: isSpcKey,
    exportAll: exportAll,
    validateEnvelope: validateEnvelope,
    restoreAll: restoreAll,
    hasInProgressState: hasInProgressState
  };
});
