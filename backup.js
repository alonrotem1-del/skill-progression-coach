/*
 * Skill Progression Coach — raw data-safety backup / restore (pure, UMD).
 *
 * This is a SAFETY MECHANISM, not a migration format. It knows nothing about
 * any application schema (profile, plan, sessions, evidence, …) — it captures
 * and restores EXACTLY what is stored, and nothing else. Backup never
 * reinterprets: it does not evaluate criteria, recompute progression, derive
 * evidence, or assign an interpretation context.
 *
 * ── Format v1 — localStorage only ────────────────────────────────────────
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
 * ── Format v2 — localStorage + durable IndexedDB ─────────────────────────
 * v2 adds a `storage` block carrying the durable, non-derived IndexedDB
 * stores of Technical Schema v1.1 §16 — ledger, events, artifacts,
 * commitments, athlete, contextPackages — plus the storage-schema version
 * they were written under, so a restore can refuse a layout it cannot
 * understand. Records are carried VERBATIM; ledger and events keep their own
 * `seq`, so sequence identity and ordering survive a round trip exactly.
 *
 * `cache` is NEVER exported and is always emptied on restore: it is derived,
 * disposable state that must be recomputed from durable truth.
 *
 * ── Restore semantics ────────────────────────────────────────────────────
 * A restore is a full snapshot, never a merge. For localStorage: a key absent
 * from the backup is removed if currently present; a key present is written
 * exactly as recorded, even if its value is the literal string "null". For
 * the durable stores: every store is replaced wholesale, so a row that is not
 * in the backup does not survive the restore.
 *
 * Restoring a v1 file on a build that has durable storage does NOT leave
 * newer athlete-owned rows behind — that would mix two eras into one
 * incoherent state. Instead the durable stores are reset to the clean
 * baseline a v1-era device would have had: everything empty, with only the
 * storage metadata needed to operate. No evidence is fabricated from the v1
 * payload; legacy-to-evidence migration is a separate, later phase.
 *
 * All localStorage access is injected (getRaw/setRaw/removeRaw), so every
 * function here is pure and testable without a browser. The durable-store
 * half is likewise pure: this module decides WHAT the stores must become
 * (plannedStores) and the caller performs the writes.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CoachBackup = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FORMAT = 'spc-backup';
  var FORMAT_VERSION = 2;                      // what this build EXPORTS
  var SUPPORTED_FORMAT_VERSIONS = [1, 2];      // what this build IMPORTS
  var APP_ID = 'skill-progression-coach';

  // The newest IndexedDB storage-schema layout this build understands inside a
  // backup payload. A payload from a NEWER layout is refused: its stores may
  // mean something this build cannot honour. An older payload is accepted —
  // a store this build has but the payload lacks simply restores empty.
  var STORAGE_SCHEMA_VERSION = 1;

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

  // Durable, non-derived IndexedDB stores (Technical Schema §16). Order is
  // presentation only. `cache` is deliberately absent and must stay absent.
  var DURABLE_STORES = ['ledger', 'events', 'artifacts', 'commitments', 'athlete', 'contextPackages'];
  var EXCLUDED_STORES = ['cache'];
  // Each durable store's keyPath, so a record can be checked for a usable key
  // before anything is written.
  var STORE_KEYPATH = {
    ledger: 'seq', events: 'seq', artifacts: 'id',
    commitments: 'id', athlete: 'id', contextPackages: 'contextId'
  };
  // The two append-only stores, whose keys are monotonic sequence numbers.
  var SEQ_STORES = ['ledger', 'events'];

  function isProtectedKey(k) { return !!PROTECTED_SET[k]; }
  // True for any spc_c_* literal, protected or not — used only by the test
  // suite's coverage guard to catch a NEW spc_c_* key introduced elsewhere in
  // the app without being added to PROTECTED_KEYS above.
  function isSpcKey(k) { return typeof k === 'string' && k.indexOf('spc_c_') === 0; }
  function isDurableStore(n) { return DURABLE_STORES.indexOf(n) !== -1; }
  function isSeqStore(n) { return SEQ_STORES.indexOf(n) !== -1; }

  function bad(reason) { return { ok: false, reason: reason }; }
  function safeParse(raw) {
    if (raw === undefined || raw === null) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function isPlainObject(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function isPositiveInt(n) {
    return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n > 0;
  }

  // ---- export ---------------------------------------------------------------
  // getRaw(key) must return the EXACT stored string, or undefined/null if the
  // key does not exist. Values are never parsed or reserialized — captured
  // verbatim so a value that happens to be the string "null" is preserved
  // exactly, distinct from the key being absent.
  //
  // meta.storage is REQUIRED and must be { schemaVersion, stores }, normally
  // produced by reading the durable stores. It is required rather than
  // optional on purpose: an omitted durable payload would silently produce a
  // backup that looks complete and is not.
  function exportAll(getRaw, meta) {
    meta = meta || {};
    var storage = buildStorageBlock(meta.storage);

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
      keys: keys,
      storage: storage
    };
  }

  // Normalises a durable snapshot into the exported `storage` block. Throws
  // rather than emitting a partial payload, and refuses to carry `cache`.
  function buildStorageBlock(snapshot) {
    if (!isPlainObject(snapshot)) {
      throw new Error('Backup export failed: the durable storage snapshot is missing.');
    }
    if (!isPositiveInt(snapshot.schemaVersion)) {
      throw new Error('Backup export failed: the durable storage snapshot has no schema version.');
    }
    if (!isPlainObject(snapshot.stores)) {
      throw new Error('Backup export failed: the durable storage snapshot has no stores.');
    }
    for (var e = 0; e < EXCLUDED_STORES.length; e++) {
      if (Object.prototype.hasOwnProperty.call(snapshot.stores, EXCLUDED_STORES[e])) {
        throw new Error('Backup export failed: ' + EXCLUDED_STORES[e] + ' is derived state and must never be exported.');
      }
    }
    var stores = {};
    for (var i = 0; i < DURABLE_STORES.length; i++) {
      var name = DURABLE_STORES[i];
      var rows = snapshot.stores[name];
      if (!Array.isArray(rows)) {
        throw new Error('Backup export failed: no records were read for ' + name + '.');
      }
      stores[name] = rows;
    }
    return { schemaVersion: snapshot.schemaVersion, stores: stores };
  }

  // ---- validation -------------------------------------------------------
  // Pure, storage-free. Must pass COMPLETELY before a restore performs a
  // single write to either store.
  function validateEnvelope(env) {
    if (!isPlainObject(env)) return bad('not a backup object');
    if (env.format !== FORMAT) return bad('unrecognised backup format');
    if (typeof env.formatVersion !== 'number' || !isFinite(env.formatVersion)) return bad('missing or invalid format version');
    if (SUPPORTED_FORMAT_VERSIONS.indexOf(env.formatVersion) < 0) return bad('unsupported backup version: ' + env.formatVersion);
    if (env.app !== APP_ID) return bad('backup is for a different application');

    var k = validateKeys(env);
    if (!k.ok) return k;

    if (env.formatVersion >= 2) {
      var s = validateStorage(env.storage);
      if (!s.ok) return s;
    } else if (Object.prototype.hasOwnProperty.call(env, 'storage')) {
      // A v1 envelope carrying a durable payload is self-contradictory.
      return bad('a version 1 backup must not contain durable storage');
    }
    return { ok: true };
  }

  // A valid envelope contains EXACTLY the protected key set — no fewer, no
  // more — because this exporter always writes all of them, so a partial or
  // over-full key map means a malformed or foreign file, not a legitimate
  // older/newer backup.
  function validateKeys(env) {
    if (!isPlainObject(env.keys)) return bad('missing or malformed key snapshot');
    var seen = Object.keys(env.keys);
    for (var i = 0; i < seen.length; i++) {
      if (!isProtectedKey(seen[i])) return bad('unexpected key in backup: ' + seen[i]);
    }
    for (var j = 0; j < PROTECTED_KEYS.length; j++) {
      var k = PROTECTED_KEYS[j];
      if (seen.indexOf(k) < 0) return bad('backup is missing expected key: ' + k);
      var rec = env.keys[k];
      if (!isPlainObject(rec)) return bad('malformed entry for key: ' + k);
      if (typeof rec.present !== 'boolean') return bad('malformed entry for key: ' + k);
      if (rec.present) {
        if (typeof rec.value !== 'string') return bad('malformed value for key: ' + k);
      } else if (Object.prototype.hasOwnProperty.call(rec, 'value')) {
        return bad('malformed entry for key: ' + k);
      }
    }
    return { ok: true };
  }

  // Validates the durable payload thoroughly enough that a restore can never
  // wipe a store on the strength of a truncated or foreign file.
  function validateStorage(storage) {
    if (!isPlainObject(storage)) return bad('missing or malformed durable storage');
    if (!isPositiveInt(storage.schemaVersion)) return bad('missing or invalid storage schema version');
    if (storage.schemaVersion > STORAGE_SCHEMA_VERSION) {
      return bad('unsupported storage schema version: ' + storage.schemaVersion);
    }
    if (!isPlainObject(storage.stores)) return bad('missing or malformed durable stores');

    var seen = Object.keys(storage.stores);
    for (var i = 0; i < seen.length; i++) {
      if (EXCLUDED_STORES.indexOf(seen[i]) !== -1) {
        return bad('backup must not contain the derived store: ' + seen[i]);
      }
      if (!isDurableStore(seen[i])) return bad('unexpected store in backup: ' + seen[i]);
    }
    for (var j = 0; j < DURABLE_STORES.length; j++) {
      var name = DURABLE_STORES[j];
      if (seen.indexOf(name) < 0) return bad('backup is missing expected store: ' + name);
      var v = validateStoreRows(name, storage.stores[name]);
      if (!v.ok) return v;
    }
    return { ok: true };
  }

  function validateStoreRows(name, rows) {
    if (!Array.isArray(rows)) return bad('malformed records for store: ' + name);
    var keyPath = STORE_KEYPATH[name];
    var seenKeys = {};
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!isPlainObject(row)) return bad('malformed record in ' + name + ' at position ' + i);
      var key = row[keyPath];
      if (isSeqStore(name)) {
        // The sequence IS the identity of an append-only record, and the
        // restore relies on it to keep ordering and to continue numbering
        // above the restored maximum.
        if (!isPositiveInt(key)) {
          return bad('record in ' + name + ' at position ' + i + ' has no valid ' + keyPath);
        }
      } else if (typeof key !== 'string' || key === '') {
        if (typeof key !== 'number' || !isFinite(key)) {
          return bad('record in ' + name + ' at position ' + i + ' has no valid ' + keyPath);
        }
      }
      var seenAs = String(key);
      if (seenKeys[seenAs]) return bad('duplicate ' + keyPath + ' in ' + name + ': ' + seenAs);
      seenKeys[seenAs] = true;
    }
    return { ok: true };
  }

  // ---- what the durable stores must become --------------------------------
  // Pure. Given a VALIDATED envelope, returns the complete desired contents of
  // every durable store. The caller writes exactly this and nothing else, so
  // the replacement semantics live here where they can be tested without a
  // browser.
  //
  // opts.baselineAthleteRow is the storage-metadata row a clean device holds;
  // it is used only for a v1 restore, which has no durable payload of its own.
  function plannedStores(env, opts) {
    var v = validateEnvelope(env);
    if (!v.ok) throw new Error('Backup rejected: ' + v.reason);
    opts = opts || {};

    if (env.formatVersion >= 2) {
      var out = {};
      DURABLE_STORES.forEach(function (name) {
        out[name] = env.storage.stores[name].slice();
      });
      return out;
    }
    return cleanBaselineStores(opts.baselineAthleteRow);
  }

  // The durable baseline a version 1 backup implies: no athlete-owned rows at
  // all, and only the storage metadata required to operate. Restoring a v1
  // file must land here rather than leaving newer evidence, events or
  // commitments behind beside an older localStorage snapshot.
  function cleanBaselineStores(baselineAthleteRow) {
    var out = {};
    DURABLE_STORES.forEach(function (name) { out[name] = []; });
    if (isPlainObject(baselineAthleteRow)) out.athlete = [baselineAthleteRow];
    return out;
  }

  // ---- restore (localStorage half) ----------------------------------------
  // setRaw(key,value) / removeRaw(key) / getRaw(key) act on the same store.
  // Validates the WHOLE envelope before any write. Captures a full pre-image
  // of every protected key first; if any write/remove throws mid-restore,
  // attempts to roll every protected key back to its pre-image and reports
  // the failure rather than leaving a half-restored store.
  //
  // The durable half is applied separately by the caller, BEFORE this, because
  // IndexedDB can be replaced atomically and localStorage cannot — so the
  // ordering puts the recoverable failure first.
  function restoreAll(env, getRaw, setRaw, removeRaw) {
    var v = validateEnvelope(env);
    if (!v.ok) throw new Error('Backup rejected: ' + v.reason);

    var preImage = snapshotKeys(getRaw);

    try {
      PROTECTED_KEYS.forEach(function (k) {
        var rec = env.keys[k]; // validated above: always present in env.keys
        if (rec.present) setRaw(k, rec.value); else removeRaw(k);
      });
      return { ok: true, restored: PROTECTED_KEYS.slice() };
    } catch (writeErr) {
      var rollbackFailed = restoreKeysFrom(preImage, setRaw, removeRaw);
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

  // A pre-image of every protected key, in the same shape restoreKeysFrom
  // expects. Exposed so the caller can take one before a multi-store restore.
  function snapshotKeys(getRaw) {
    var out = {};
    PROTECTED_KEYS.forEach(function (k) {
      var cur = getRaw(k);
      out[k] = (cur === undefined || cur === null) ? { present: false } : { present: true, value: String(cur) };
    });
    return out;
  }

  // Writes a pre-image back. Returns the keys that could not be restored.
  function restoreKeysFrom(preImage, setRaw, removeRaw) {
    var failed = [];
    PROTECTED_KEYS.forEach(function (k) {
      var pre = preImage[k];
      if (!pre) return;
      try {
        if (pre.present) setRaw(k, pre.value); else removeRaw(k);
      } catch (e) {
        failed.push(k);
      }
    });
    return failed;
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
    SUPPORTED_FORMAT_VERSIONS: SUPPORTED_FORMAT_VERSIONS.slice(),
    STORAGE_SCHEMA_VERSION: STORAGE_SCHEMA_VERSION,
    APP_ID: APP_ID,
    PROTECTED_KEYS: PROTECTED_KEYS.slice(),
    DURABLE_STORES: DURABLE_STORES.slice(),
    EXCLUDED_STORES: EXCLUDED_STORES.slice(),
    isProtectedKey: isProtectedKey,
    isSpcKey: isSpcKey,
    exportAll: exportAll,
    validateEnvelope: validateEnvelope,
    plannedStores: plannedStores,
    cleanBaselineStores: cleanBaselineStores,
    restoreAll: restoreAll,
    snapshotKeys: snapshotKeys,
    restoreKeysFrom: restoreKeysFrom,
    hasInProgressState: hasInProgressState
  };
});
