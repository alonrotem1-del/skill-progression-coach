/*
 * Skill Progression Coach — Interpretation Context, durable and local (UMD).
 *
 * Technical Schema v1.1 §8 and §16. This module makes the approved context
 * available on the device and records that the athlete adopted it. It does not
 * evaluate anything, derive anything, or read any athlete data: localStorage
 * remains authoritative for everything the app does today.
 *
 * Two invariants shape every function here.
 *
 *   §16 / invariant 24 — PERSIST BEFORE ADOPT. The complete package is written
 *   and read back out of IndexedDB before the adoption naming it is appended.
 *   The adoption log therefore cannot reference a context this device cannot
 *   evaluate, including at first boot.
 *
 *   §8 / invariant 11 + 26 — THE CURRENT CONTEXT IS DERIVED. It is the
 *   toContextId of the newest InterpretationAdoption. There is no stored
 *   pointer, no default-context constant and no fallback: an empty adoption log
 *   means "not initialised", which is reported, never papered over.
 *
 * The network and the service-worker cache DELIVER content. They are never in
 * the read path for a context already installed — that is §16's tier-A rule and
 * invariant 25, and it is why offline is the ordinary path rather than a case.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CoachContext = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ADOPTION_KIND = 'InterpretationAdoption';
  var EVENTS = 'events';
  var PACKAGES = 'contextPackages';
  var CONTENT_BASE = 'content/';
  var TRIGGERS = ['initial', 'offered', 'required'];

  // `root` belongs to the UMD wrapper, not to this factory, so the global is
  // resolved here rather than captured.
  function glob() {
    if (typeof self !== 'undefined') return self;
    if (typeof window !== 'undefined') return window;
    if (typeof global !== 'undefined') return global;
    return null;
  }

  // Injectable for tests; in the app both come from the page.
  var deps = { idb: null, fetch: null };
  function setDeps(d) {
    if (!d) { deps = { idb: null, fetch: null }; return; }
    if ('idb' in d) deps.idb = d.idb;
    if ('fetch' in d) deps.fetch = d.fetch;
  }
  function idb() {
    if (deps.idb) return deps.idb;
    var g = glob();
    return (g && g.CoachIDB) ? g.CoachIDB : null;
  }
  function doFetch(url) {
    var g = glob();
    var f = deps.fetch || (g ? g.fetch : null);
    if (!f) return Promise.reject(new Error('fetch is not available'));
    return f.call(g, url);
  }

  function fetchJson(path) {
    return doFetch(path).then(function (res) {
      if (!res || !res.ok) {
        throw new Error('cannot load ' + path + (res ? ' (HTTP ' + res.status + ')' : ''));
      }
      return res.json();
    });
  }

  function need() {
    var I = idb();
    if (!I) return new Error('durable storage module is not loaded');
    return null;
  }

  // ---- the minted contexts, as shipped -------------------------------------

  function manifests() {
    return fetchJson(CONTENT_BASE + 'contexts.json').then(function (doc) {
      var list = Array.isArray(doc) ? doc : (doc && doc.contexts);
      if (!Array.isArray(list) || !list.length) throw new Error('contexts.json declares no context');
      return list;
    });
  }

  // The context an uninitialised athlete adopts: the first one the release
  // minted. It is read from content rather than named in code, so there is no
  // default-context constant anywhere in the app (invariant 26).
  function initialManifest() {
    return manifests().then(function (list) { return list[0]; });
  }

  function manifestFor(contextId) {
    return manifests().then(function (list) {
      for (var i = 0; i < list.length; i++) if (list[i].id === contextId) return list[i];
      throw new Error('no minted context with id ' + contextId);
    });
  }

  // ---- the package ---------------------------------------------------------

  // Everything required to evaluate under one context, by value. Shape per §16.
  function buildPackage(manifest, bundle, semantics, vocabularyVersion) {
    return {
      contextId: manifest.id,
      manifest: {
        id: manifest.id,
        contentBundleVersion: manifest.contentBundleVersion,
        evaluationSemanticsVersion: manifest.evaluationSemanticsVersion,
        mintedAt: manifest.mintedAt,
        releaseNotes: manifest.releaseNotes || ''
      },
      contentBundle: bundle,
      evaluationSemantics: semantics,
      vocabularyVersionAtWrite: vocabularyVersion,
      writtenAt: new Date().toISOString()
    };
  }

  // A package that does not hold what its manifest promises is not a package.
  // Checked on write AND on read, because a corrupt row must not be treated as
  // an installed context.
  function verifyPackage(pkg) {
    if (!pkg || typeof pkg !== 'object') return 'package is missing';
    if (!pkg.contextId) return 'package has no contextId';
    var m = pkg.manifest;
    if (!m) return 'package has no manifest';
    if (m.id !== pkg.contextId) return 'manifest id does not match the package key';
    if (!pkg.contentBundle) return 'package carries no content bundle';
    if (!pkg.evaluationSemantics) return 'package carries no evaluation semantics';
    if (pkg.contentBundle.version !== m.contentBundleVersion) {
      return 'package holds content bundle ' + pkg.contentBundle.version +
        ' but its manifest names ' + m.contentBundleVersion;
    }
    if (pkg.evaluationSemantics.version !== m.evaluationSemanticsVersion) {
      return 'package holds evaluation semantics ' + pkg.evaluationSemantics.version +
        ' but its manifest names ' + m.evaluationSemanticsVersion;
    }
    var atLeast = pkg.contentBundle.requiresSemanticsAtLeast;
    if (atLeast != null && m.evaluationSemanticsVersion < atLeast) {
      return 'content bundle ' + pkg.contentBundle.version + ' requires semantics >= ' + atLeast +
        ' but this context names ' + m.evaluationSemanticsVersion;
    }
    return null;
  }

  // Reads an installed package from durable storage. Never from the network.
  function readPackage(contextId) {
    var bad = need(); if (bad) return Promise.reject(bad);
    return idb().get(PACKAGES, contextId).then(function (pkg) {
      if (!pkg) return null;
      var why = verifyPackage(pkg);
      if (why) throw new Error('installed package for ' + contextId + ' is unusable: ' + why);
      return pkg;
    });
  }

  /**
   * Makes one minted context durably available. Idempotent: an already
   * installed, verifying package is returned untouched and nothing is fetched.
   * Resolves only after the record has been read back out of IndexedDB, so a
   * caller that then appends an adoption cannot be wrong about persistence.
   */
  function installContextPackage(contextId) {
    var bad = need(); if (bad) return Promise.reject(bad);
    var I = idb();
    return readPackage(contextId).then(function (existing) {
      if (existing) return existing;
      return manifestFor(contextId).then(function (manifest) {
        return Promise.all([
          fetchJson(CONTENT_BASE + 'bundle-' + manifest.contentBundleVersion + '.json'),
          fetchJson(CONTENT_BASE + 'semantics-' + manifest.evaluationSemanticsVersion + '.json'),
          fetchJson(CONTENT_BASE + 'vocabulary.json')
        ]).then(function (parts) {
          var pkg = buildPackage(manifest, parts[0], parts[1], parts[2].vocabularyVersion);
          var why = verifyPackage(pkg);
          if (why) throw new Error('refusing to install ' + contextId + ': ' + why);
          return I.put(PACKAGES, pkg);
        }).then(function () {
          // Read back, in a separate transaction, before anyone may adopt it.
          return I.get(PACKAGES, contextId);
        }).then(function (stored) {
          var why = verifyPackage(stored);
          if (why) throw new Error('package for ' + contextId + ' did not persist: ' + why);
          return stored;
        });
      });
    });
  }

  // ---- the adoption log ----------------------------------------------------

  function adoptionLog() {
    var bad = need(); if (bad) return Promise.reject(bad);
    return idb().allByIndex(EVENTS, 'kind', ADOPTION_KIND).then(function (rows) {
      return (rows || []).slice().sort(function (a, b) { return a.seq - b.seq; });
    });
  }

  function adoptionRecord(fromContextId, toContextId, trigger, approvedExplicitly, impact) {
    var at = new Date().toISOString();
    return {
      kind: ADOPTION_KIND,
      date: at,                 // the events store indexes `date`
      at: at,
      fromContextId: fromContextId === undefined ? null : fromContextId,
      toContextId: toContextId,
      trigger: trigger,
      approvedExplicitly: !!approvedExplicitly,
      impact: impact || null
    };
  }

  function validateAdoption(rec) {
    if (!rec.toContextId) return 'an adoption must name the context adopted';
    if (TRIGGERS.indexOf(rec.trigger) === -1) return 'unknown adoption trigger: ' + rec.trigger;
    if (rec.trigger === 'initial' && rec.fromContextId !== null) {
      return 'the initial adoption comes from null, not from ' + rec.fromContextId;
    }
    return null;
  }

  /**
   * Appends one adoption. Refuses unless the package it names is already
   * installed and verifying — invariant 24, enforced here rather than trusted
   * of callers, because this is the only place the ledger can be written.
   */
  function appendInterpretationAdoption(opts) {
    var bad = need(); if (bad) return Promise.reject(bad);
    opts = opts || {};
    var rec = adoptionRecord(opts.fromContextId === undefined ? null : opts.fromContextId,
      opts.toContextId, opts.trigger, opts.approvedExplicitly, opts.impact);
    var why = validateAdoption(rec);
    if (why) return Promise.reject(new Error(why));
    return readPackage(rec.toContextId).then(function (pkg) {
      if (!pkg) {
        throw new Error('refusing to adopt ' + rec.toContextId +
          ': its package is not durably installed (persist before adopt)');
      }
      return idb().append(EVENTS, rec);
    }).then(function (seq) { return seq; });
  }

  /**
   * Appends the initial adoption exactly once, whatever else is happening.
   * The check and the append share ONE readwrite transaction, so a second tab,
   * a second boot or a reload cannot produce a second initial row.
   */
  function ensureInitialAdoption(contextId) {
    var bad = need(); if (bad) return Promise.reject(bad);
    var rec = adoptionRecord(null, contextId, 'initial', false, null);
    var why = validateAdoption(rec);
    if (why) return Promise.reject(new Error(why));
    return readPackage(contextId).then(function (pkg) {
      if (!pkg) {
        throw new Error('refusing to adopt ' + contextId +
          ': its package is not durably installed (persist before adopt)');
      }
      return idb().appendIfNone(EVENTS, 'kind', ADOPTION_KIND, rec);
    });
  }

  // ---- what the athlete is pinned to --------------------------------------

  // The head of the adoption log, or null when there is none. NOT a fallback:
  // null means "this athlete is not initialised", and every caller must treat
  // it as that rather than substituting a context.
  function currentContext() {
    return adoptionLog().then(function (rows) {
      if (!rows.length) return null;
      return rows[rows.length - 1].toContextId;
    });
  }

  function getCurrentContextPackage() {
    return currentContext().then(function (id) {
      if (!id) return null;
      return readPackage(id);
    });
  }

  // ---- boot ----------------------------------------------------------------
  // Never rejects. The new engine is not authoritative, so a failure here is a
  // diagnostic: nothing in localStorage is touched, no adoption is written, and
  // the legacy app carries on exactly as before.
  var _initPromise = null;
  var _status = {
    ok: false, pending: true, contextId: null, packageInstalled: false,
    adoptionAppended: false, adoptions: 0, error: null
  };

  function initOnce() {
    var I = idb();
    if (!I) return Promise.reject(new Error('durable storage module is not loaded'));
    return currentContext().then(function (cur) {
      if (cur) {
        // Already initialised. Keep the pin exactly where it is: re-install the
        // package only if it is missing (tier-A recovery), and never adopt
        // anything else, however new.
        return installContextPackage(cur).then(function () {
          return { contextId: cur, appended: false };
        });
      }
      return initialManifest().then(function (manifest) {
        return installContextPackage(manifest.id).then(function () {
          return ensureInitialAdoption(manifest.id);
        }).then(function (res) {
          return { contextId: manifest.id, appended: !!(res && res.appended) };
        });
      });
    }).then(function (out) {
      return adoptionLog().then(function (rows) {
        return {
          ok: true, pending: false, contextId: out.contextId, packageInstalled: true,
          adoptionAppended: out.appended, adoptions: rows.length, error: null
        };
      });
    });
  }

  function init() {
    if (_initPromise) return _initPromise;
    _initPromise = initOnce().then(function (s) {
      _status = s; return s;
    })['catch'](function (err) {
      _status = {
        ok: false, pending: false, contextId: null, packageInstalled: false,
        adoptionAppended: false, adoptions: 0,
        error: (err && err.message) ? err.message : String(err)
      };
      return _status;
    });
    return _initPromise;
  }

  function status() { return _status; }

  function _reset() {
    _initPromise = null;
    _status = {
      ok: false, pending: true, contextId: null, packageInstalled: false,
      adoptionAppended: false, adoptions: 0, error: null
    };
  }

  return {
    ADOPTION_KIND: ADOPTION_KIND,
    TRIGGERS: TRIGGERS.slice(),

    init: init,
    status: status,

    installContextPackage: installContextPackage,
    appendInterpretationAdoption: appendInterpretationAdoption,
    ensureInitialAdoption: ensureInitialAdoption,
    currentContext: currentContext,
    getCurrentContextPackage: getCurrentContextPackage,
    adoptionLog: adoptionLog,
    readPackage: readPackage,

    verifyPackage: verifyPackage,
    manifests: manifests,
    initialManifest: initialManifest,

    _setDeps: setDeps,
    _reset: _reset
  };
});
