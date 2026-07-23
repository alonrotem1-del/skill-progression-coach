/*
 * Skill Progression Coach — deterministic engine (pure, UMD, no DOM, testable).
 *
 * Two responsibilities, both explainable and side-effect-free:
 *   1. Node status:  real criteria + prerequisite logic → visual state.
 *   2. Next-best-action: readiness + focus + recent load → a recommended
 *      session, a lighter alternative, target nodes, and a plain-language why.
 *
 * No node state is invented: it comes only from completed criteria, prerequisite
 * satisfaction and (for focus) the current training selection.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.CoachEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- criteria & completion ---------------------------------------------
  function nodeState(states, id) { return (states && states[id]) || {}; }

  function critCurrent(states, nodeId, critId) {
    var s = nodeState(states, nodeId);
    return (s.criteria && s.criteria[critId]) || 0;
  }

  // A node is complete when it was manually marked, or every criterion reaches
  // its target. This is the ONLY definition of "done".
  function isComplete(node, states) {
    var s = nodeState(states, node.id);
    if (s.completed === true) return true;
    if (!node.criteria || !node.criteria.length) return false;
    return node.criteria.every(function (c) {
      return ((s.criteria && s.criteria[c.id]) || 0) >= c.target;
    });
  }

  // Prerequisite satisfaction: ALL of `all` complete, and (if present) at least
  // one of `any` complete. `noPain` is a recommendation gate, not a lock.
  function prereqMet(node, states) {
    var p = node.prereq;
    if (!p) return true;
    var allOk = !p.all || p.all.every(function (id) {
      var e = idx(states.__content, id); return e && isComplete(e, states);
    });
    var anyOk = !p.any || p.any.some(function (id) {
      var e = idx(states.__content, id); return e && isComplete(e, states);
    });
    return allOk && anyOk;
  }

  // content lookup is threaded through states.__content (set by caller) so the
  // pure functions can resolve prerequisite nodes by id.
  function idx(content, id) { return content && content[id]; }

  // Visual state for a node given the current focus selection.
  //   completed | maintenance | current | supporting | available | locked
  function statusOf(node, states, focus) {
    if (isComplete(node, states)) {
      return node.type === 'maintenance' ? 'maintenance' : 'completed';
    }
    if (!prereqMet(node, states)) return 'locked';
    if (focus && focus.primary === node.id) return 'current';
    if (focus && focus.supporting === node.id) return 'supporting';
    return 'available';
  }

  function progressText(node, states) {
    if (!node.criteria || !node.criteria.length) return '';
    if (node.criteria.length === 1) {
      var c = node.criteria[0];
      return critCurrent(states, node.id, c.id) + '/' + c.target + ' ' + c.unit;
    }
    var done = node.criteria.filter(function (c) {
      return critCurrent(states, node.id, c.id) >= c.target;
    }).length;
    return done + '/' + node.criteria.length + ' criteria';
  }

  function missingCriteria(node, states) {
    if (!node.criteria) return [];
    return node.criteria.filter(function (c) {
      return critCurrent(states, node.id, c.id) < c.target;
    });
  }

  // Which prerequisite nodes are not yet complete (for the "locked because…" text).
  function missingPrereqs(node, states, content) {
    var out = [];
    var p = node.prereq;
    if (!p) return out;
    (p.all || []).forEach(function (id) {
      var e = content[id]; if (e && !isComplete(e, states)) out.push(e);
    });
    if (p.any && !p.any.some(function (id) { var e = content[id]; return e && isComplete(e, states); })) {
      p.any.forEach(function (id) { var e = content[id]; if (e) out.push(e); });
    }
    return out;
  }

  // ---- automatic focus selection -----------------------------------------
  // Milestone-driven (spec §9): find the nearest incomplete milestone on the
  // progression "spine"; if it's available, train it; if it's locked, target the
  // nearest AVAILABLE prerequisite blocking it. Supporting = an available
  // support/skill node that plausibly limits the primary.
  var SPINE_TYPE = { milestone: true, strength: true, foundation: true };

  function autoFocus(world, states) {
    var content = {}; world.nodes.forEach(function (n) { content[n.id] = n; });
    states = withContent(states, content);
    function avail(n) { return !isComplete(n, states) && prereqMet(n, states) && n.type !== 'maintenance'; }

    // Spine = the mainline branch(es) if declared, else fall back to node type.
    var mainline = {};
    (world.branches || []).forEach(function (b) { if (b.mainline) mainline[b.id] = true; });
    var hasMainline = Object.keys(mainline).length > 0;
    function onSpine(n) { return hasMainline ? !!mainline[n.branchId] : !!SPINE_TYPE[n.type]; }

    var spine = world.nodes.filter(function (n) { return onSpine(n) && !isComplete(n, states); })
      .sort(function (a, b) { return a.col - b.col; });
    var target = spine[0];
    var primary = null;
    if (target && prereqMet(target, states)) {
      primary = target;
    } else if (target) {
      // walk prerequisites for the nearest available, incomplete ancestor
      var cand = blockingAvailable(target, states, content);
      primary = cand || target;
    }
    if (!primary) {
      var any = world.nodes.filter(avail).sort(function (a, b) { return a.col - b.col; });
      if (!any.length) return { primary: null, supporting: null };
      primary = any[0];
    }

    // supporting: an available support/skill/power node other than primary,
    // preferring one that feeds the primary (its prereq or a `supports` edge).
    var feeders = {};
    (primary.prereq && primary.prereq.all || []).forEach(function (id) { feeders[id] = true; });
    (primary.prereq && primary.prereq.any || []).forEach(function (id) { feeders[id] = true; });
    (world.supports || []).forEach(function (e) { if (e[1] === primary.id) feeders[e[0]] = true; });

    var supportCands = world.nodes.filter(function (n) {
      return n.id !== primary.id && avail(n) &&
        (n.type === 'support' || n.type === 'skill' || n.type === 'power');
    });
    supportCands.sort(function (a, b) {
      var fa = feeders[a.id] ? 0 : 1, fb = feeders[b.id] ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return a.col - b.col;
    });
    return { primary: primary.id, supporting: supportCands.length ? supportCands[0].id : null };
  }

  // Nearest available, incomplete node reachable through `target`'s prerequisites
  // (the thing actually blocking progress). Breadth-first, prefer lowest col.
  function blockingAvailable(target, states, content) {
    var seen = {}, queue = [], found = [];
    function pushPrereqs(n) {
      if (!n.prereq) return;
      (n.prereq.all || []).forEach(function (id) { if (!seen[id]) { seen[id] = 1; queue.push(id); } });
      (n.prereq.any || []).forEach(function (id) { if (!seen[id]) { seen[id] = 1; queue.push(id); } });
    }
    pushPrereqs(target);
    while (queue.length) {
      var node = content[queue.shift()];
      if (!node || isComplete(node, states)) continue;
      if (prereqMet(node, states) && node.type !== 'maintenance') found.push(node);
      else pushPrereqs(node);
    }
    found.sort(function (a, b) { return a.col - b.col; });
    return found[0] || null;
  }

  function withContent(states, content) {
    var s = {};
    Object.keys(states || {}).forEach(function (k) { s[k] = states[k]; });
    s.__content = content;
    return s;
  }

  // ---- recommendation engine ---------------------------------------------
  // ctx: { world, states, focus, templates, readiness, recent }
  //   readiness: { energy:1-3, upperFatigue:1-3, fingerSkin:1-3, pain:bool, time:'short'|'normal'|'long' }
  //   recent: [{ kind:'strength'|'climbing', date, hardPull:bool }]  (most-recent first)
  function recommend(ctx) {
    var world = ctx.world, templates = ctx.templates, states = ctx.states;
    var r = ctx.readiness || {};
    var focus = ctx.focus || autoFocus(world, states);
    var content = {}; world.nodes.forEach(function (n) { content[n.id] = n; });
    var primaryNode = focus.primary ? content[focus.primary] : null;

    var fatigued = (r.energy && r.energy <= 1) || (r.upperFatigue && r.upperFatigue >= 3);
    var shortTime = r.time === 'short';
    var recentHardClimb = (ctx.recent || []).slice(0, 2).some(function (s) {
      return s.kind === 'climbing' && s.hardPull;
    });

    var reasons = [];
    var caution = null;
    var pick, alt;

    // The focus node's own templates are the natural training options.
    var focusTemplates = (primaryNode && primaryNode.templates) || [];
    var mainId = focusTemplates[0] || defaultTemplate(world);

    // Rule 10 — pain avoids aggravating work.
    if (r.pain) {
      pick = lightestTemplate(world, templates);
      alt = pick;
      caution = 'You reported pain — today\'s recommendation is light and restorative only. If pain is sharp or persistent, rest and consult a professional.';
      reasons.push('Pain reported — avoiding strenuous work');
      return build(pick, alt, focus, reasons, caution, templates);
    }

    // Rule 1 — no benchmark test when fatigued.
    if (templates[mainId] && templates[mainId].type === 'test' && (fatigued || shortTime)) {
      mainId = swapType(world, templates, focusTemplates, ['strength', 'volume', 'consolidation']) || mainId;
      reasons.push('Skipping performance test when fatigued — quality training preferred');
    }

    // Rules 2/3 — climbing counts as pulling/grip load.
    if (recentHardClimb && templates[mainId] && (templates[mainId].type === 'strength' || templates[mainId].type === 'power')) {
      var lighter = swapType(world, templates, focusTemplates, ['skill', 'light', 'movement', 'technique']) || lightestTemplate(world, templates);
      mainId = lighter;
      reasons.push('Recent hard climbing — pulling/grip load is high, choosing lighter technical work');
    }

    // General fatigue / short time → lighter session.
    if ((fatigued || shortTime) && templates[mainId] &&
        templates[mainId].type !== 'light' && templates[mainId].type !== 'technique') {
      var l = swapType(world, templates, focusTemplates, ['light', 'technique', 'movement', 'skill']);
      if (l) { mainId = l; reasons.push(shortTime ? 'Short on time — focused, brief workout' : 'Low energy/fatigue — lighter workout today'); }
    }

    if (!reasons.length && primaryNode) {
      reasons.push('Next step on the path: ' + primaryNode.name);
    }

    pick = templates[mainId] ? mainId : defaultTemplate(world);
    alt = lightestTemplate(world, templates);
    if (alt === pick) alt = shortAlternative(world, templates, pick);
    return build(pick, alt, focus, reasons, caution, templates);
  }

  function build(pickId, altId, focus, reasons, caution, templates) {
    return {
      sessionTemplateId: pickId,
      alternativeTemplateId: altId,
      targetNodeIds: [focus.primary, focus.supporting].filter(Boolean),
      focus: focus,
      why: reasons.join(' · '),
      reasons: reasons,
      caution: caution
    };
  }

  function templatesForWorld(world, templates) {
    return Object.keys(templates).map(function (k) { return templates[k]; })
      .filter(function (t) { return t.worldId === world.id; });
  }
  function defaultTemplate(world) {
    return world.id === 'boulder' ? 'b_consolidate' : 'mu_strength';
  }
  function lightestTemplate(world, templates) {
    var list = templatesForWorld(world, templates);
    var light = list.filter(function (t) { return t.type === 'light' || t.type === 'technique' || t.type === 'movement'; });
    return (light[0] || list[0]).id;
  }
  function shortAlternative(world, templates, notId) {
    var list = templatesForWorld(world, templates).filter(function (t) { return t.id !== notId; });
    list.sort(function (a, b) { return (a.duration || 60) - (b.duration || 60); });
    return list.length ? list[0].id : notId;
  }
  function swapType(world, templates, preferIds, types) {
    for (var i = 0; i < preferIds.length; i++) {
      var t = templates[preferIds[i]];
      if (t && types.indexOf(t.type) >= 0) return t.id;
    }
    var list = templatesForWorld(world, templates);
    for (var j = 0; j < types.length; j++) {
      var found = list.filter(function (t) { return t.type === types[j]; })[0];
      if (found) return found.id;
    }
    return null;
  }

  return {
    isComplete: isComplete,
    prereqMet: function (node, states, content) { return prereqMet(node, withContent(states, content)); },
    statusOf: function (node, states, content, focus) { return statusOf(node, withContent(states, content), focus); },
    progressText: progressText,
    missingCriteria: missingCriteria,
    missingPrereqs: missingPrereqs,
    autoFocus: autoFocus,
    recommend: recommend,
    _withContent: withContent
  };
});
