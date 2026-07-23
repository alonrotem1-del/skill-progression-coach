/*
 * Skill Progression Coach — storage + non-destructive migration (UMD).
 *
 * Hard contract (identical to the Preview's):
 *   - writes/deletes ONLY spc_* keys (guarded — throws otherwise)
 *   - reads puc_* strictly read-only, and never deletes legacy data
 * This app uses the spc_c_* namespace so it can coexist with the v2 Preview's
 * spc_* keys without collision.
 *
 * Migration is additive: existing Pull-Up Coach records are read to SEED node
 * benchmarks (pull-up max → pulling nodes, dips/hang/ring-support → support
 * nodes). Unmapped legacy data is left untouched; the user confirms mapping in
 * onboarding. Pure helpers (deriveBench / seedStates) take plain objects so they
 * are unit-testable without a browser.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CoachStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PREFIX = 'spc_c_';
  var KEYS = {
    profile: PREFIX + 'profile',
    state: PREFIX + 'state',
    sessions: PREFIX + 'sessions',
    bench: PREFIX + 'bench',
    settings: PREFIX + 'settings'
  };
  var LEGACY_KEYS = ['puc_log', 'puc_plan', 'puc_settings', 'puc_session', 'puc_progression', 'puc_secondary'];

  function isWorking(e) { return (e.reps || 0) > 0 && e.setType !== 'summary' && e.setType !== 'skip'; }

  // ---- pure: derive benchmarks from a legacy snapshot ---------------------
  function deriveBench(puc) {
    puc = puc || {};
    var log = Array.isArray(puc.puc_log) ? puc.puc_log : [];
    var working = log.filter(isWorking);
    var pullupMax = working.reduce(function (m, e) { return Math.max(m, e.reps || 0); }, 0);

    var bench = {};
    if (pullupMax > 0) bench.pullup_max = pullupMax;

    // Secondary skills → best value, matched by name/id tokens (best-effort).
    var skills = (puc.puc_secondary && puc.puc_secondary.skills) || [];
    skills.forEach(function (s) {
      if (!s.log || !s.log.length) return;
      var best = Math.max.apply(null, s.log.map(function (e) { return e.value; }));
      var hay = ((s.id || '') + ' ' + (s.name || '')).toLowerCase();
      if (/ring.*support|support.*hold/.test(hay)) bench.ring_support_secs = max(bench.ring_support_secs, best);
      else if (/dip/.test(hay)) bench.dips_max = max(bench.dips_max, best);
      else if (/dead.*hang|hang/.test(hay)) bench.deadhang_secs = max(bench.deadhang_secs, best);
    });
    return bench;
  }
  function max(a, b) { return Math.max(a == null ? -Infinity : a, b); }

  // ---- pure: seed a world's node criteria from benchmarks -----------------
  // Returns a fresh per-node state map { nodeId: { criteria:{critId:val} } }.
  function seedStates(world, bench) {
    bench = bench || {};
    var out = {};
    world.nodes.forEach(function (n) {
      out[n.id] = { criteria: {} };
      if (!n.seed) return;
      // benchmark implies the whole node is already satisfied (obvious prereqs)
      if (n.seed.completeIfBench) {
        var b = bench[n.seed.completeIfBench.key];
        if (b != null && b >= n.seed.completeIfBench.gte) {
          (n.criteria || []).forEach(function (c) { out[n.id].criteria[c.id] = c.target; });
        }
      }
      if (!n.seed.fromBench) return;
      var val = bench[n.seed.fromBench];
      if (val == null) return;
      // seed the node's first criterion of the matching kind
      var target = n.criteria && n.criteria[0];
      if (!target) return;
      // reps-based seed only feeds reps criteria; hold seed feeds hold criteria
      var isReps = n.seed.asReps;
      if (isReps && target.unit.indexOf('rep') === 0) out[n.id].criteria[target.id] = val;
      else if (!isReps && target.unit === 'sec') out[n.id].criteria[target.id] = val;
    });
    return out;
  }

  function makeStore(storage) {
    storage = storage || (typeof localStorage !== 'undefined' ? localStorage : memStore());
    function get(k) { try { return JSON.parse(storage.getItem(k)); } catch (e) { return null; } }
    function set(k, v) {
      if (String(k).indexOf('spc_') !== 0) throw new Error('Coach may only write spc_* keys, refused: ' + k);
      storage.setItem(k, JSON.stringify(v));
    }
    function del(k) {
      if (String(k).indexOf('spc_') !== 0) throw new Error('Coach may only delete spc_* keys, refused: ' + k);
      storage.removeItem(k);
    }
    function readLegacy() {
      var out = {};
      LEGACY_KEYS.forEach(function (k) {
        var raw = storage.getItem(k);
        try { out[k] = raw == null ? null : JSON.parse(raw); } catch (e) { out[k] = null; }
      });
      return out;
    }
    return {
      KEYS: KEYS,
      get: get, set: set, del: del, readLegacy: readLegacy,
      getProfile: function () { return get(KEYS.profile); },
      setProfile: function (p) { set(KEYS.profile, p); },
      getState: function () { return get(KEYS.state) || {}; },
      setState: function (s) { set(KEYS.state, s); },
      getSessions: function () { return get(KEYS.sessions) || []; },
      setSessions: function (a) { set(KEYS.sessions, a); },
      getBench: function () { return get(KEYS.bench) || {}; },
      setBench: function (b) { set(KEYS.bench, b); },
      getSettings: function () { return get(KEYS.settings); },
      setSettings: function (s) { set(KEYS.settings, s); },
      reset: function () { Object.keys(KEYS).forEach(function (k) { del(KEYS[k]); }); }
    };
  }

  function memStore() {
    var m = {};
    return {
      getItem: function (k) { return k in m ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; }
    };
  }

  return {
    KEYS: KEYS,
    LEGACY_KEYS: LEGACY_KEYS,
    deriveBench: deriveBench,
    seedStates: seedStates,
    makeStore: makeStore,
    _memStore: memStore
  };
});
