/*
 * Skill Progression Coach — durable athlete-data store (IndexedDB, UMD).
 *
 * Technical Schema v1.1 §16: one database, seven object stores. This module
 * stands that database up and does nothing else. No athlete data is migrated
 * into it, nothing reads it for any decision, and localStorage remains the
 * authoritative store for everything the app does today. The database exists
 * and is empty.
 *
 * Storage-schema version is a FOURTH version axis (Technical Schema §3). It
 * gates nothing, appears in no InterpretationContext, and a storage migration
 * that changes no value changes no verdict — so it must never be conflated
 * with contentBundleVersion or evaluationSemanticsVersion.
 *
 * Write pattern is expressed in the API rather than documented beside it:
 *   - ledger and events are APPEND-ONLY, so they expose only append().
 *   - the five keyed document stores expose put()/get().
 *   - nothing here deletes a record. Test teardown deletes the whole database
 *     through indexedDB.deleteDatabase, which is not this module's business.
 *
 * Upgrades create only what is missing and never delete an existing store or
 * index, so they are forward-only and idempotent in effect.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CoachIDB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB_NAME = 'spc';
  var SCHEMA_VERSION = 1;

  // The single row in `athlete` that carries device-local storage metadata.
  var ATHLETE_ID = 'athlete';

  // Technical Schema v1.1 §16, verbatim. Order is presentation only.
  var STORES = [
    { name: 'ledger', keyPath: 'seq', autoIncrement: true,
      indexes: ['exerciseId', 'occurredAt', 'kind'] },
    { name: 'artifacts', keyPath: 'id', indexes: ['kind', 'date'] },
    { name: 'events', keyPath: 'seq', autoIncrement: true,
      indexes: ['kind', 'date'] },
    { name: 'commitments', keyPath: 'id', indexes: [] },
    { name: 'athlete', keyPath: 'id', indexes: [] },
    { name: 'cache', keyPath: 'cacheKey', indexes: [] },
    { name: 'contextPackages', keyPath: 'contextId', indexes: [] }
  ];

  var APPEND_ONLY = ['ledger', 'events'];

  function storeNames() {
    return STORES.map(function (s) { return s.name; });
  }
  function isAppendOnly(name) {
    return APPEND_ONLY.indexOf(name) !== -1;
  }
  function defOf(name) {
    for (var i = 0; i < STORES.length; i++) if (STORES[i].name === name) return STORES[i];
    return null;
  }

  // ---- schema ---------------------------------------------------------------
  // Creates only what is absent. Never deletes a store or an index, so running
  // it against a database that already has some of the layout is safe, and
  // running it twice changes nothing. `tx` must be the versionchange
  // transaction, which is the only way to reach an existing store's indexes.
  // Exposed as _applySchema so a test can drive it at an arbitrary version
  // while SCHEMA_VERSION is still 1.
  function applySchema(db, tx) {
    for (var i = 0; i < STORES.length; i++) {
      var def = STORES[i];
      var store;
      if (!db.objectStoreNames.contains(def.name)) {
        store = db.createObjectStore(def.name, {
          keyPath: def.keyPath,
          autoIncrement: !!def.autoIncrement
        });
      } else {
        store = tx.objectStore(def.name);
      }
      for (var j = 0; j < def.indexes.length; j++) {
        var idx = def.indexes[j];
        if (!store.indexNames.contains(idx)) store.createIndex(idx, idx);
      }
    }
  }

  // ---- open -----------------------------------------------------------------
  var _openPromise = null;

  function open() {
    if (_openPromise) return _openPromise;
    _openPromise = new Promise(function (resolve, reject) {
      var idb = (typeof indexedDB !== 'undefined') ? indexedDB : null;
      if (!idb) { reject(new Error('IndexedDB is not available')); return; }
      var req;
      try { req = idb.open(DB_NAME, SCHEMA_VERSION); }
      catch (e) { reject(e); return; }
      req.onupgradeneeded = function () { applySchema(req.result, req.transaction); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('open failed')); };
      req.onblocked = function () {
        reject(new Error('IndexedDB upgrade blocked by another open connection'));
      };
    });
    // A failed open must not be cached as a permanent verdict: a later attempt
    // (after the blocking tab closes, say) deserves a fresh try.
    _openPromise['catch'](function () { _openPromise = null; });
    return _openPromise;
  }

  // ---- transaction helper ---------------------------------------------------
  // Resolves on transaction COMPLETE, not on request success, so a request
  // that succeeds inside a transaction which later aborts is reported as the
  // failure it is — and nothing it wrote is visible.
  function run(storeName, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx, store, out;
        try {
          tx = db.transaction(storeName, mode);
          store = tx.objectStore(storeName);
        } catch (e) { reject(e); return; }
        tx.oncomplete = function () { resolve(out); };
        tx.onabort = function () { reject(tx.error || new Error('transaction aborted')); };
        tx.onerror = function () { reject(tx.error || new Error('transaction failed')); };
        var req;
        try { req = fn(store); }
        catch (e) {
          // A synchronous throw (an unclonable value, a missing key) must abort
          // rather than leave the transaction to commit whatever preceded it.
          try { tx.abort(); } catch (e2) {}
          reject(e);
          return;
        }
        if (req) req.onsuccess = function () { out = req.result; };
      });
    });
  }

  function guard(storeName, wantAppendOnly) {
    if (!defOf(storeName)) {
      return new Error('unknown object store: ' + storeName);
    }
    if (wantAppendOnly && !isAppendOnly(storeName)) {
      return new Error(storeName + ' is not append-only — use put()');
    }
    if (!wantAppendOnly && isAppendOnly(storeName)) {
      return new Error(storeName + ' is append-only — use append()');
    }
    return null;
  }

  // ---- public operations ----------------------------------------------------

  // Appends one record to an append-only store and resolves with the assigned
  // monotonic seq. The sequence is IndexedDB's own autoIncrement key.
  function append(storeName, record) {
    var bad = guard(storeName, true);
    if (bad) return Promise.reject(bad);
    return run(storeName, 'readwrite', function (store) { return store.add(record); });
  }

  // Writes one record to a keyed document store (upsert by its keyPath).
  function put(storeName, record) {
    var bad = guard(storeName, false);
    if (bad) return Promise.reject(bad);
    return run(storeName, 'readwrite', function (store) { return store.put(record); });
  }

  function get(storeName, key) {
    if (!defOf(storeName)) return Promise.reject(new Error('unknown object store: ' + storeName));
    return run(storeName, 'readonly', function (store) { return store.get(key); });
  }

  function allByIndex(storeName, indexName, query) {
    var def = defOf(storeName);
    if (!def) return Promise.reject(new Error('unknown object store: ' + storeName));
    if (def.indexes.indexOf(indexName) === -1) {
      return Promise.reject(new Error(storeName + ' has no index: ' + indexName));
    }
    return run(storeName, 'readonly', function (store) {
      var idx = store.index(indexName);
      return (query === undefined || query === null) ? idx.getAll() : idx.getAll(query);
    });
  }

  function count(storeName) {
    if (!defOf(storeName)) return Promise.reject(new Error('unknown object store: ' + storeName));
    return run(storeName, 'readonly', function (store) { return store.count(); });
  }

  // ---- init -----------------------------------------------------------------
  // Opens the database, records the storage-schema version, and asks once for
  // persistent storage. NEVER rejects: the database is not authoritative in
  // this phase, so a failure here is a diagnostic, not an app-level error.
  var _initPromise = null;
  var _status = { ok: false, pending: true, schemaVersion: SCHEMA_VERSION, persisted: false, error: null };

  function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        return navigator.storage.persist().then(function (granted) {
          return !!granted;
        })['catch'](function () { return false; });
      }
    } catch (e) {}
    return Promise.resolve(false);
  }

  // Idempotent: writes the version only when it is not already recorded, and
  // preserves every other field on the athlete row.
  function recordSchemaVersion() {
    return get('athlete', ATHLETE_ID).then(function (row) {
      if (row && row.storageSchemaVersion === SCHEMA_VERSION) return row;
      var next = {};
      if (row) for (var k in row) if (Object.prototype.hasOwnProperty.call(row, k)) next[k] = row[k];
      next.id = ATHLETE_ID;
      next.storageSchemaVersion = SCHEMA_VERSION;
      return put('athlete', next).then(function () { return next; });
    });
  }

  function init() {
    if (_initPromise) return _initPromise;
    _initPromise = open()
      .then(function () { return recordSchemaVersion(); })
      .then(function () { return requestPersistence(); })
      .then(function (persisted) {
        _status = { ok: true, pending: false, schemaVersion: SCHEMA_VERSION, persisted: persisted, error: null };
        return _status;
      })['catch'](function (err) {
        _status = {
          ok: false, pending: false, schemaVersion: SCHEMA_VERSION, persisted: false,
          error: (err && err.message) ? err.message : String(err)
        };
        return _status;
      });
    return _initPromise;
  }

  function status() { return _status; }

  // ---- backup / restore infrastructure ------------------------------------
  // PRIVILEGED. This is the only code path that may clear a store or write a
  // record with a caller-supplied sequence number, and it exists solely so a
  // backup can be restored as one coherent snapshot. It is deliberately NOT
  // part of the normal API: append() and put() keep their append-only
  // restrictions exactly as before, and nothing here is reachable from a
  // normal write path.
  var DURABLE = ['ledger', 'events', 'artifacts', 'commitments', 'athlete', 'contextPackages'];
  var DERIVED = ['cache'];

  // Reads every durable store. Rejects if any store cannot be read, so a
  // caller can never mistake a partial read for a complete snapshot.
  function snapshotDurable() {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx, out = {}, pending = DURABLE.length;
        try { tx = db.transaction(DURABLE, 'readonly'); }
        catch (e) { reject(e); return; }
        tx.onabort = function () { reject(tx.error || new Error('snapshot aborted')); };
        tx.onerror = function () { reject(tx.error || new Error('snapshot failed')); };
        tx.oncomplete = function () {
          if (pending !== 0) { reject(new Error('snapshot incomplete')); return; }
          resolve({ schemaVersion: SCHEMA_VERSION, stores: out });
        };
        DURABLE.forEach(function (name) {
          var r = tx.objectStore(name).getAll();
          r.onsuccess = function () { out[name] = r.result || []; pending--; };
        });
      });
    });
  }

  // Replaces every durable store with the given contents and empties the
  // derived cache, in ONE transaction: either the whole durable side becomes
  // the snapshot, or nothing changes at all.
  //
  // Records are written with add() carrying their own key. For ledger and
  // events that key is the record's own `seq`, which IndexedDB also uses to
  // advance the store's key generator — so restored sequences keep their exact
  // identity and ordering, and the next ordinary append() continues above the
  // restored maximum.
  function replaceDurable(stores) {
    if (!stores || typeof stores !== 'object') {
      return Promise.reject(new Error('replaceDurable requires a store map'));
    }
    for (var i = 0; i < DURABLE.length; i++) {
      if (!Array.isArray(stores[DURABLE[i]])) {
        return Promise.reject(new Error('replaceDurable is missing records for ' + DURABLE[i]));
      }
    }
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        var names = DURABLE.concat(DERIVED);
        try { tx = db.transaction(names, 'readwrite'); }
        catch (e) { reject(e); return; }
        tx.oncomplete = function () { resolve({ ok: true }); };
        tx.onabort = function () { reject(tx.error || new Error('restore transaction aborted')); };
        tx.onerror = function () { reject(tx.error || new Error('restore transaction failed')); };
        try {
          // Derived state is never restored — it is rebuilt from durable truth.
          DERIVED.forEach(function (name) { tx.objectStore(name).clear(); });
          DURABLE.forEach(function (name) {
            var store = tx.objectStore(name);
            store.clear();
            var rows = stores[name];
            for (var j = 0; j < rows.length; j++) store.add(rows[j]);
          });
        } catch (e) {
          try { tx.abort(); } catch (e2) {}
          reject(e);
        }
      });
    });
  }

  // Drops the memoized connection and init result. For tests that delete the
  // database underneath a live page; not used by the app.
  function _reset() {
    _openPromise = null;
    _initPromise = null;
    _status = { ok: false, pending: true, schemaVersion: SCHEMA_VERSION, persisted: false, error: null };
  }

  return {
    DB_NAME: DB_NAME,
    SCHEMA_VERSION: SCHEMA_VERSION,
    ATHLETE_ID: ATHLETE_ID,
    STORE_NAMES: storeNames(),
    APPEND_ONLY_STORES: APPEND_ONLY.slice(),

    open: open,
    init: init,
    status: status,

    append: append,
    put: put,
    get: get,
    allByIndex: allByIndex,
    count: count,

    // Backup/restore infrastructure only — see the note above replaceDurable.
    // Never call these from a normal write path.
    _restore: {
      DURABLE_STORES: DURABLE.slice(),
      DERIVED_STORES: DERIVED.slice(),
      snapshot: snapshotDurable,
      replaceAll: replaceDurable
    },

    _applySchema: applySchema,
    _reset: _reset
  };
});
