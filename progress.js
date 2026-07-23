/*
 * Skill Progression Coach — session → progress application (pure, UMD, testable).
 *
 * Turns a completed session into concrete criteria updates, benchmark updates,
 * and the set of nodes that became complete ("unlocked downstream"). No DOM, no
 * storage — the UI calls this and then persists the returned state.
 *
 * Meaningful-progress only: rep/second benchmarks move by MAX (never celebrate
 * noise below the current best); skill/technique criteria count real sessions;
 * climbing sends count distinct problems and distinct styles.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./engine.js'));
  } else {
    root.CoachProgress = factory(root.CoachEngine);
  }
})(typeof self !== 'undefined' ? self : this, function (Engine) {
  'use strict';

  function contentOf(world) {
    var c = {}; world.nodes.forEach(function (n) { c[n.id] = n; }); return c;
  }
  function clone(states) { return JSON.parse(JSON.stringify(states || {})); }
  function ensure(states, id) { if (!states[id]) states[id] = { criteria: {} }; if (!states[id].criteria) states[id].criteria = {}; return states[id]; }
  function completeSet(world, states) {
    var content = contentOf(world), done = {};
    world.nodes.forEach(function (n) { done[n.id] = Engine.isComplete(n, withC(states, content)); });
    return done;
  }
  function withC(states, content) { var s = {}; Object.keys(states).forEach(function (k) { s[k] = states[k]; }); s.__content = content; return s; }

  function diffUnlocks(world, before, after) {
    var newly = [];
    world.nodes.forEach(function (n) { if (!before[n.id] && after[n.id]) newly.push(n.id); });
    return newly;
  }

  // ---- strength session ---------------------------------------------------
  // session.exResults: { exId: { bestReps, bestSeconds } }
  // session.templateId, session.targetNodeIds (focus) — used to count skill sessions.
  function applyStrength(world, statesIn, session, exercises) {
    var states = clone(statesIn);
    var before = completeSet(world, states);
    var bench = {};
    var exRes = session.exResults || {};

    // 1) rep/second benchmarks feed related nodes' first matching criterion (by MAX).
    Object.keys(exRes).forEach(function (exId) {
      var ex = exercises[exId]; if (!ex) return;
      var best = exRes[exId];
      (ex.related || []).forEach(function (nodeId) {
        var node = world.nodes.filter(function (n) { return n.id === nodeId; })[0];
        if (!node || !node.criteria || !node.criteria.length) return;
        var c0 = node.criteria[0];
        var st = ensure(states, nodeId);
        if (best.bestReps != null && c0.unit.indexOf('rep') === 0) st.criteria[c0.id] = Math.max(st.criteria[c0.id] || 0, best.bestReps);
        if (best.bestSeconds != null && c0.unit === 'sec') st.criteria[c0.id] = Math.max(st.criteria[c0.id] || 0, best.bestSeconds);
      });
      if (best.bestReps != null && exId === 'pullup') bench.pullup_max = Math.max(bench.pullup_max || 0, best.bestReps);
      if (best.bestReps != null && exId === 'dip') bench.dips_max = Math.max(bench.dips_max || 0, best.bestReps);
      if (best.bestSeconds != null && (exId === 'deadhang' || exId === 'activehang')) bench.deadhang_secs = Math.max(bench.deadhang_secs || 0, best.bestSeconds);
      if (best.bestSeconds != null && exId === 'support') bench.ring_support_secs = Math.max(bench.ring_support_secs || 0, best.bestSeconds);
    });

    // 2) skill/technique nodes measured in "sessions" advance by 1 when trained.
    countSessionNodes(world, states, session);

    var after = completeSet(world, states);
    return { states: states, unlocked: diffUnlocks(world, before, after), bench: bench,
             completedNow: diffUnlocks(world, before, after) };
  }

  // A node measured in sessions advances when it is a target of this
  // session OR when the session's template trains it.
  function countSessionNodes(world, states, session) {
    var targets = {}; (session.targetNodeIds || []).forEach(function (id) { targets[id] = true; });
    world.nodes.forEach(function (n) {
      if (!n.criteria) return;
      var c = n.criteria.filter(function (c) { return c.unit === 'sessions'; })[0];
      if (!c) return;
      var trains = (n.templates || []).indexOf(session.templateId) >= 0;
      if (targets[n.id] || trains) {
        var st = ensure(states, n.id);
        st.criteria[c.id] = Math.min((st.criteria[c.id] || 0) + 1, c.target);
      }
    });
  }

  // ---- climbing session ---------------------------------------------------
  // session.problems: [{ grade:'V2', style:'overhang', result:'send'|'flash'|'crux'|... }]
  // session.templateId, session.targetNodeIds, session.techniqueFocus:[nodeIds]
  var GRADE_NODE = { muscleup: {}, boulder: { V0: 'b_v0', V1: 'b_v1', V2: 'b_v2', V3: 'b_v3', V4: 'b_v4', V5: 'b_v5' } };

  function applyClimbing(world, statesIn, session) {
    var states = clone(statesIn);
    var before = completeSet(world, states);
    var gradeMap = GRADE_NODE[world.id] || {};
    var problems = session.problems || [];

    problems.forEach(function (p) {
      var nodeId = gradeMap[p.grade];
      var sent = p.result === 'send' || p.result === 'flash';
      if (nodeId && sent) {
        var node = byId(world, nodeId);
        var st = ensure(states, nodeId);
        var sendsC = firstCrit(node, 'problem');
        if (sendsC) st.criteria[sendsC.id] = Math.min((st.criteria[sendsC.id] || 0) + 1, sendsC.target);
        // distinct styles
        var stylesC = firstCrit(node, 'styles');
        if (stylesC && p.style) {
          st.stylesSet = st.stylesSet || {};
          st.stylesSet[p.style] = true;
          st.criteria[stylesC.id] = Math.min(Object.keys(st.stylesSet).length, stylesC.target);
        }
      }
      // reaching the crux advances V5-project crux criteria
      if (p.result === 'crux' || p.result === 'send' || p.result === 'flash') {
        world.nodes.forEach(function (n) {
          var cx = firstCrit(n, 'crux');
          if (cx && (session.targetNodeIds || []).indexOf(n.id) >= 0) {
            var st2 = ensure(states, n.id);
            st2.criteria[cx.id] = Math.min((st2.criteria[cx.id] || 0) + 1, cx.target);
          }
        });
      }
    });

    // technique focus + session-counted nodes (tactics/project) advance by 1.
    var extraTargets = (session.techniqueFocus || []).slice();
    countSessionNodes(world, states, { templateId: session.templateId, targetNodeIds: (session.targetNodeIds || []).concat(extraTargets) });

    var after = completeSet(world, states);
    return { states: states, unlocked: diffUnlocks(world, before, after), bench: {},
             completedNow: diffUnlocks(world, before, after) };
  }

  function byId(world, id) { return world.nodes.filter(function (n) { return n.id === id; })[0]; }
  // Match a criterion by unit OR label token.
  function firstCrit(node, token) {
    if (!node || !node.criteria) return null;
    return node.criteria.filter(function (c) {
      return c.unit.indexOf(token) >= 0 || (c.label && c.label.indexOf(token) >= 0);
    })[0] || null;
  }

  return { applyStrength: applyStrength, applyClimbing: applyClimbing, _GRADE_NODE: GRADE_NODE };
});
