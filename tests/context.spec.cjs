// Skill Progression Coach — P5: the Interpretation Context, durable and local.
//
// Real Chromium IndexedDB throughout, via page.evaluate. The guarantees this
// phase makes are storage guarantees — persistence across reload, one atomic
// initial adoption, persist-before-adopt, offline availability — and a fake-IDB
// shim would exercise none of them.
//
// P5 is deliberately invisible: nothing is evaluated under the context, and
// localStorage still drives every decision the app makes. Two describe blocks
// below exist to prove exactly that.
const { test, expect } = require('@playwright/test');

const bundle1 = require('../content/bundle-1.json');
const semantics1 = require('../content/semantics-1.json');
const contexts = require('../content/contexts.json');

const CTX = contexts.contexts[0].id;

// Load the page and drop the database the app's own boot just created, so each
// test starts from a genuinely fresh device. Boot is then re-run explicitly by
// whichever test needs it.
async function fresh(page) {
  await page.goto('index.html');
  await page.evaluate(async () => {
    const I = window.CoachIDB;
    // Settle the app's deferred boot before deleting: it opens this database and
    // chains the context install onto it, so a delete underneath leaves an open
    // connection and a half-finished install racing the test.
    try { await I.init(); } catch (e) {}
    try { await window.CoachContext.init(); } catch (e) {}
    try { const db = await I.open(); db.close(); } catch (e) {}
    I._reset();
    window.CoachContext._reset();
    await new Promise((res) => {
      const r = indexedDB.deleteDatabase('spc');
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  });
}

// An onboarded profile, so the app lands on Today (with nav) rather than
// onboarding. Mirrors the seed used by the other specs.
async function seed(page, dayId) {
  await page.addInitScript((d) => { window.__spcTodayId = d; }, dayId);
  await page.goto('index.html');
  await page.evaluate(() => {
    const S = window.CoachStore.makeStore(), D = window.CoachData, E = window.CoachEngine;
    const bench = { pullup_max: 9, dips_max: 6 };
    const state = {};
    D.worlds.forEach((w) => {
      const nodes = window.CoachStore.seedStates(w, bench);
      const f = E.autoFocus(w, nodes);
      state[w.id] = { nodes, focus: { primary: f.primary, supporting: f.supporting, manual: false } };
    });
    S.setBench(bench); S.setState(state);
    S.setProfile({ onboarded: true, activeWorld: 'muscleup', days: [0, 2, 4], duration: 'normal' });
  });
  await page.reload();
}

const bootContext = (page) => page.evaluate(async () => {
  await window.CoachIDB.init();
  return window.CoachContext.init();
});

const adoptions = (page) => page.evaluate(() => window.CoachContext.adoptionLog());

// ── the package ────────────────────────────────────────────────────────────
test.describe('P5 context — the durable package', () => {
  test('01 — ctx_1 installs, keyed by contextId in contextPackages', async ({ page }) => {
    await fresh(page);
    const out = await page.evaluate(async (ctx) => {
      await window.CoachIDB.init();
      const pkg = await window.CoachContext.installContextPackage(ctx);
      const raw = await window.CoachIDB.get('contextPackages', ctx);
      return {
        contextId: pkg.contextId,
        manifest: pkg.manifest,
        vocab: pkg.vocabularyVersionAtWrite,
        writtenAt: typeof pkg.writtenAt,
        storedSameKey: !!raw && raw.contextId === ctx,
        verify: window.CoachContext.verifyPackage(raw)
      };
    }, CTX);
    expect(out.contextId).toBe(CTX);
    expect(out.manifest.contentBundleVersion).toBe(1);
    expect(out.manifest.evaluationSemanticsVersion).toBe(1);
    expect(out.vocab).toBe(1);
    expect(out.writtenAt).toBe('string');
    expect(out.storedSameKey).toBe(true);
    expect(out.verify).toBeNull();
  });

  test('02 — the round trip preserves bundle and semantics identity exactly', async ({ page }) => {
    await fresh(page);
    const stored = await page.evaluate(async (ctx) => {
      await window.CoachIDB.init();
      await window.CoachContext.installContextPackage(ctx);
      const pkg = await window.CoachContext.readPackage(ctx);
      return { bundle: pkg.contentBundle, semantics: pkg.evaluationSemantics };
    }, CTX);
    // Deep equality against the shipped files, not a version-number spot check:
    // a package that quietly lost a criterion would still pass the latter.
    expect(stored.bundle).toEqual(bundle1);
    expect(stored.semantics).toEqual(semantics1);
  });

  test('03 — the package survives a reload, and is not re-fetched', async ({ page }) => {
    await fresh(page);
    await bootContext(page);
    const before = await page.evaluate((ctx) => window.CoachIDB.get('contextPackages', ctx), CTX);

    // Count content requests after the reload: a package already installed must
    // be read from IndexedDB, not fetched again.
    const fetched = [];
    page.on('request', (r) => { if (/\/content\//.test(r.url())) fetched.push(r.url()); });
    await page.reload();
    const after = await page.evaluate(async (ctx) => {
      await window.CoachIDB.init();
      await window.CoachContext.init();
      return window.CoachIDB.get('contextPackages', ctx);
    }, CTX);

    expect(after.writtenAt).toBe(before.writtenAt);      // the same row, not a rewrite
    expect(after.contentBundle).toEqual(before.contentBundle);
    expect(fetched.filter((u) => /bundle-1\.json/.test(u))).toEqual([]);
  });

  test('04 — a package whose manifest disagrees with its contents is refused, not used', async ({ page }) => {
    await fresh(page);
    const out = await page.evaluate(async (ctx) => {
      await window.CoachIDB.init();
      await window.CoachContext.installContextPackage(ctx);
      const pkg = await window.CoachIDB.get('contextPackages', ctx);
      pkg.contentBundle.version = 99;                    // corruption, of the subtlest kind
      await window.CoachIDB.put('contextPackages', pkg);
      let err = null;
      try { await window.CoachContext.readPackage(ctx); } catch (e) { err = e.message; }
      const verdict = window.CoachContext.verifyPackage(pkg);
      return { err: err, verdict: verdict };
    }, CTX);
    expect(out.err).toContain('unusable');
    expect(out.verdict).toContain('content bundle 99');
  });
});

// ── the adoption ledger ────────────────────────────────────────────────────
test.describe('P5 context — the adoption ledger', () => {
  test('05 — first initialisation appends exactly one null → ctx_1, trigger initial', async ({ page }) => {
    await fresh(page);
    const status = await bootContext(page);
    const log = await adoptions(page);
    expect(status.ok).toBe(true);
    expect(status.contextId).toBe(CTX);
    expect(status.adoptionAppended).toBe(true);
    expect(log.length).toBe(1);
    expect(log[0].fromContextId).toBeNull();
    expect(log[0].toContextId).toBe(CTX);
    expect(log[0].trigger).toBe('initial');
    expect(log[0].approvedExplicitly).toBe(false);
    expect(log[0].kind).toBe('InterpretationAdoption');
    expect(typeof log[0].at).toBe('string');
    expect(typeof log[0].seq).toBe('number');
  });

  test('06 — currentContext() derives from the head of the log', async ({ page }) => {
    await fresh(page);
    await bootContext(page);
    const out = await page.evaluate(async (ctx) => {
      const C = window.CoachContext;
      const first = await C.currentContext();
      // A second, later adoption moves the head — and nothing else moves with it.
      await window.CoachIDB.append('events', {
        kind: 'InterpretationAdoption', date: new Date().toISOString(), at: new Date().toISOString(),
        fromContextId: ctx, toContextId: 'ctx_test_head', trigger: 'offered',
        approvedExplicitly: true, impact: null
      });
      return { first: first, afterHead: await C.currentContext() };
    }, CTX);
    expect(out.first).toBe(CTX);
    expect(out.afterHead).toBe('ctx_test_head');
  });

  test('07 — repeated initialisation appends no second adoption', async ({ page }) => {
    await fresh(page);
    await bootContext(page);
    const again = await page.evaluate(async () => {
      window.CoachContext._reset();
      const s = await window.CoachContext.init();
      window.CoachContext._reset();
      const t = await window.CoachContext.init();
      return [s, t];
    });
    await page.reload();
    await bootContext(page);
    const log = await adoptions(page);
    expect(again[0].adoptionAppended).toBe(false);
    expect(again[1].adoptionAppended).toBe(false);
    expect(log.length).toBe(1);
  });

  test('08 — concurrent initialisation cannot create a duplicate initial adoption', async ({ page }) => {
    await fresh(page);
    const out = await page.evaluate(async (ctx) => {
      await window.CoachIDB.init();
      await window.CoachContext.installContextPackage(ctx);
      // Eight racing callers, as a second tab and a fast double boot would be.
      const rs = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7]
        .map(() => window.CoachContext.ensureInitialAdoption(ctx)));
      const log = await window.CoachContext.adoptionLog();
      return { appended: rs.filter((r) => r.appended).length, rows: log.length };
    }, CTX);
    expect(out.appended).toBe(1);
    expect(out.rows).toBe(1);
  });

  test('09 — an empty adoption ledger yields null, never a default context', async ({ page }) => {
    await fresh(page);
    const out = await page.evaluate(async () => {
      await window.CoachIDB.init();
      return {
        current: await window.CoachContext.currentContext(),
        pkg: await window.CoachContext.getCurrentContextPackage(),
        rows: (await window.CoachContext.adoptionLog()).length
      };
    });
    expect(out.current).toBeNull();
    expect(out.pkg).toBeNull();
    expect(out.rows).toBe(0);
    // And no constant anywhere in the module could supply one.
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'context.js'), 'utf8');
    expect(src).not.toMatch(/ctx_1/);
  });

  test('10 — an already-initialised athlete keeps their pin; init adopts nothing', async ({ page }) => {
    await fresh(page);
    await bootContext(page);
    const out = await page.evaluate(async (ctx) => {
      // Pin to a context that is not the one the release ships first.
      const pkg = await window.CoachIDB.get('contextPackages', ctx);
      pkg.contextId = 'ctx_old'; pkg.manifest.id = 'ctx_old';
      await window.CoachIDB.put('contextPackages', pkg);
      await window.CoachIDB.append('events', {
        kind: 'InterpretationAdoption', date: new Date().toISOString(), at: new Date().toISOString(),
        fromContextId: ctx, toContextId: 'ctx_old', trigger: 'offered',
        approvedExplicitly: true, impact: null
      });
      window.CoachContext._reset();
      const s = await window.CoachContext.init();
      return { status: s, rows: (await window.CoachContext.adoptionLog()).length };
    }, CTX);
    expect(out.status.ok).toBe(true);
    expect(out.status.contextId).toBe('ctx_old');
    expect(out.status.adoptionAppended).toBe(false);
    expect(out.rows).toBe(2);
  });
});

// ── persist before adopt (invariant 24) ────────────────────────────────────
test.describe('P5 context — persist before adopt', () => {
  test('11 — the package is present before the adoption naming it exists', async ({ page }) => {
    await fresh(page);
    const order = await page.evaluate(async () => {
      await window.CoachIDB.init();
      const seen = [];
      const realPut = window.CoachIDB.put;
      const realAppend = window.CoachIDB.append;
      window.CoachIDB.put = function (store, rec) {
        if (store === 'contextPackages') seen.push('package:' + rec.contextId);
        return realPut.apply(null, arguments);
      };
      window.CoachIDB.appendIfNone = (function (real) {
        return function (store, idx, key, rec) {
          if (rec && rec.kind === 'InterpretationAdoption') seen.push('adoption:' + rec.toContextId);
          return real.apply(null, arguments);
        };
      })(window.CoachIDB.appendIfNone);
      window.CoachContext._reset();
      await window.CoachContext.init();
      window.CoachIDB.put = realPut; window.CoachIDB.append = realAppend;
      return seen;
    });
    const firstPackage = order.findIndex((e) => e.indexOf('package:') === 0);
    const firstAdoption = order.findIndex((e) => e.indexOf('adoption:') === 0);
    expect(firstPackage, 'no package was written: ' + JSON.stringify(order)).toBeGreaterThanOrEqual(0);
    expect(firstAdoption, 'no adoption was attempted: ' + JSON.stringify(order)).toBeGreaterThan(firstPackage);
    // Stronger: for every adoption attempt, its context's package came first.
    order.forEach((e, i) => {
      if (e.indexOf('adoption:') !== 0) return;
      const ctx = e.slice('adoption:'.length);
      expect(order.slice(0, i), e).toContain('package:' + ctx);
    });
  });

  test('12 — a failed package write leaves no adoption at all', async ({ page }) => {
    await fresh(page);
    const out = await page.evaluate(async () => {
      await window.CoachIDB.init();
      const real = window.CoachIDB.put;
      window.CoachIDB.put = function (store) {
        if (store === 'contextPackages') return Promise.reject(new Error('simulated quota failure'));
        return real.apply(null, arguments);
      };
      window.CoachContext._reset();
      const s = await window.CoachContext.init();
      window.CoachIDB.put = real;
      return {
        status: s,
        packages: await window.CoachIDB.count('contextPackages'),
        rows: (await window.CoachContext.adoptionLog()).length
      };
    });
    expect(out.status.ok).toBe(false);
    expect(out.status.error).toContain('simulated quota failure');
    expect(out.packages).toBe(0);
    expect(out.rows).toBe(0);
  });

  test('13 — adopting a context with no installed package is refused outright', async ({ page }) => {
    await fresh(page);
    const out = await page.evaluate(async () => {
      await window.CoachIDB.init();
      let err = null;
      try {
        await window.CoachContext.appendInterpretationAdoption({
          fromContextId: null, toContextId: 'ctx_never_installed', trigger: 'initial'
        });
      } catch (e) { err = e.message; }
      let err2 = null;
      try { await window.CoachContext.ensureInitialAdoption('ctx_never_installed'); } catch (e) { err2 = e.message; }
      return { err: err, err2: err2, rows: (await window.CoachContext.adoptionLog()).length };
    });
    expect(out.err).toContain('persist before adopt');
    expect(out.err2).toContain('persist before adopt');
    expect(out.rows).toBe(0);
  });

  test('14 — a failed adoption leaves the package present and no current context', async ({ page }) => {
    await fresh(page);
    const out = await page.evaluate(async (ctx) => {
      await window.CoachIDB.init();
      const real = window.CoachIDB.appendIfNone;
      window.CoachIDB.appendIfNone = function () { return Promise.reject(new Error('simulated append failure')); };
      window.CoachContext._reset();
      const s = await window.CoachContext.init();
      window.CoachIDB.appendIfNone = real;
      return {
        status: s,
        pkg: !!(await window.CoachIDB.get('contextPackages', ctx)),
        current: await window.CoachContext.currentContext(),
        currentPkg: await window.CoachContext.getCurrentContextPackage()
      };
    }, CTX);
    expect(out.status.ok).toBe(false);
    expect(out.status.error).toContain('simulated append failure');
    expect(out.pkg).toBe(true);           // persisted, as it should be
    expect(out.current).toBeNull();       // but no false current context
    expect(out.currentPkg).toBeNull();
  });

  test('15 — an adoption is rejected before it is written when its shape is wrong', async ({ page }) => {
    await fresh(page);
    const out = await page.evaluate(async (ctx) => {
      await window.CoachIDB.init();
      await window.CoachContext.installContextPackage(ctx);
      const errs = [];
      const tries = [
        { fromContextId: 'ctx_something', toContextId: ctx, trigger: 'initial' },
        { fromContextId: null, toContextId: ctx, trigger: 'invented' },
        { fromContextId: null, trigger: 'initial' }
      ];
      for (const t of tries) {
        try { await window.CoachContext.appendInterpretationAdoption(t); errs.push(null); }
        catch (e) { errs.push(e.message); }
      }
      return { errs: errs, rows: (await window.CoachContext.adoptionLog()).length };
    }, CTX);
    expect(out.errs[0]).toContain('comes from null');
    expect(out.errs[1]).toContain('unknown adoption trigger');
    expect(out.errs[2]).toContain('must name the context');
    expect(out.rows).toBe(0);
  });
});

// ── offline, and the cache is delivery only ────────────────────────────────
test.describe('P5 context — offline and the read path', () => {
  test('16 — the current package loads with the network offline', async ({ page, context }) => {
    await fresh(page);
    await bootContext(page);
    await context.setOffline(true);
    try {
      const out = await page.evaluate(async () => {
        window.CoachContext._reset();
        const s = await window.CoachContext.init();
        const pkg = await window.CoachContext.getCurrentContextPackage();
        return { status: s, ctx: pkg && pkg.contextId, bundleVersion: pkg && pkg.contentBundle.version };
      });
      expect(out.status.ok).toBe(true);
      expect(out.ctx).toBe(CTX);
      expect(out.bundleVersion).toBe(1);
    } finally {
      await context.setOffline(false);
    }
  });

  test('17 — with the package installed, nothing under /content/ is requested again', async ({ page }) => {
    await fresh(page);
    await bootContext(page);
    const seen = [];
    page.on('request', (r) => { if (/\/content\//.test(r.url())) seen.push(r.url()); });
    await page.evaluate(async () => {
      window.CoachContext._reset();
      await window.CoachContext.init();
      await window.CoachContext.getCurrentContextPackage();
    });
    expect(seen).toEqual([]);
  });

  test('18 — the read path is IndexedDB: a poisoned cache entry cannot change the context', async ({ page }) => {
    await fresh(page);
    await bootContext(page);
    const out = await page.evaluate(async () => {
      // Overwrite the delivery cache with a different bundle. Evaluation reads
      // definitions only from contextPackages (invariant 25), so this must have
      // no effect whatsoever on the installed context.
      const keys = await caches.keys();
      const name = keys.filter((k) => k.indexOf('skill-progression-coach-') === 0)[0];
      let poisoned = false;
      if (name) {
        const c = await caches.open(name);
        await c.put('content/bundle-1.json',
          new Response(JSON.stringify({ version: 999, exercises: [], criteria: [] }),
            { headers: { 'Content-Type': 'application/json' } }));
        poisoned = true;
      }
      window.CoachContext._reset();
      await window.CoachContext.init();
      const pkg = await window.CoachContext.getCurrentContextPackage();
      return { poisoned: poisoned, version: pkg.contentBundle.version, criteria: pkg.contentBundle.criteria.length };
    });
    expect(out.poisoned).toBe(true);
    expect(out.version).toBe(1);
    expect(out.criteria).toBe(bundle1.criteria.length);
  });
});

// ── P5 changes nothing the athlete can see ────────────────────────────────
test.describe('P5 context — no new engine behaviour', () => {
  test('19 — the athlete row gains no context pointer and no capability field', async ({ page }) => {
    await fresh(page);
    await bootContext(page);
    const row = await page.evaluate(() => window.CoachIDB.get('athlete', window.CoachIDB.ATHLETE_ID));
    // The row already existed from P2, carrying storage metadata only. P5 adds
    // nothing to it: the current context is derived from the adoption log.
    expect(Object.keys(row).sort()).toEqual(['id', 'storageSchemaVersion']);
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'context.js'), 'utf8');
    expect(src).not.toMatch(/currentContextId|currentInterpretationContext/);
  });

  test('20 — localStorage is untouched by installing and adopting a context', async ({ page }) => {
    await fresh(page);
    const before = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort()
      .map((k) => [k, localStorage.getItem(k)])));
    await bootContext(page);
    const after = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort()
      .map((k) => [k, localStorage.getItem(k)])));
    expect(after).toBe(before);
  });

  test('21 — Week, Today and Progress are byte-identical before and after adoption', async ({ page }) => {
    await page.addInitScript(() => { window.__spcTodayId = 2; });
    await page.goto('index.html');
    const snapshot = () => page.evaluate(() => {
      const W = window.CoachWeek, S = window.CoachStore.makeStore();
      const plan = S.getPlan();
      return JSON.stringify({
        week: W.resolveWeek(plan, {}),
        today: W.resolveDay(plan, W.todayId({ todayId: 2 }), {}),
        load: W.weeklyLoad(plan, {}),
        bench: S.getBench(),
        state: S.getState()
      });
    });
    // Before: drop the database so no context exists at all.
    await page.evaluate(async () => {
      const I = window.CoachIDB;
      try { const db = await I.open(); db.close(); } catch (e) {}
      I._reset(); window.CoachContext._reset();
      await new Promise((res) => {
        const r = indexedDB.deleteDatabase('spc');
        r.onsuccess = r.onerror = r.onblocked = () => res();
      });
    });
    const before = await snapshot();
    await bootContext(page);
    const after = await snapshot();
    expect(after).toBe(before);
  });

  test('22 — the context module derives nothing: no evaluator surface at all', async ({ page }) => {
    await fresh(page);
    const api = await page.evaluate(() => Object.keys(window.CoachContext).sort());
    expect(api).toEqual([
      'ADOPTION_KIND', 'TRIGGERS', '_reset', '_setDeps', 'adoptionLog',
      'appendInterpretationAdoption', 'currentContext', 'ensureInitialAdoption',
      'getCurrentContextPackage', 'init', 'initialManifest', 'installContextPackage',
      'manifests', 'readPackage', 'status', 'verifyPackage'
    ]);
    // Scan code, not prose: the header says in words that it evaluates nothing.
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'context.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    ['satisfied', 'unsatisfied', 'provisional', 'criterionEvaluation', 'progressionState',
      'currentStage', 'limiter', 'shortfall']
      .forEach((w) => expect(code.toLowerCase(), w).not.toContain(w.toLowerCase()));
  });

  test('23 — the app stays fully usable when IndexedDB is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        get() { return { open() { throw new Error('simulated IndexedDB failure'); } }; }
      });
    });
    await seed(page, 2);
    await expect(page.locator('.nav [data-s="today"]')).toBeVisible();
    await page.locator('.nav [data-s="week"]').click();
    await expect(page.locator('.scr')).toBeVisible();
    await page.locator('.nav [data-s="today"]').click();
    await expect(page.locator('.scr')).toBeVisible();
    const status = await page.evaluate(async () => {
      window.CoachContext._reset();
      return window.CoachContext.init();
    });
    expect(status.ok).toBe(false);
    expect(status.contextId).toBeNull();
    expect(status.error).toMatch(/simulated IndexedDB failure/);
  });

  test('24 — the failure surfaces as a diagnostic that says the data is unaffected', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        get() { return { open() { throw new Error('simulated IndexedDB failure'); } }; }
      });
    });
    await seed(page, 2);
    const profileBefore = await page.evaluate(() => localStorage.getItem('spc_c_profile'));
    await page.locator('[data-s="profile"]').click();
    await page.locator('[data-sview="data"]').click();
    await expect(page.locator('[data-ctx-status]')).toContainText(/unavailable/i);
    await expect(page.locator('[data-ctx-status]')).toContainText(/data is unaffected/i);
    await expect(page.locator('[data-backup-export]')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('spc_c_profile'))).toBe(profileBefore);
  });

  test('25 — with storage working, the diagnostic names the installed context', async ({ page }) => {
    await seed(page, 2);
    await page.locator('[data-s="profile"]').click();
    await page.locator('[data-sview="data"]').click();
    await expect(page.locator('[data-ctx-status]')).toContainText(new RegExp(CTX));
    await expect(page.locator('[data-ctx-status]')).toContainText(/installed and adopted/i);
  });
});

// ── the service worker delivers, and says so ──────────────────────────────
test.describe('P5 context — delivery', () => {
  test('26 — context.js and the content files are cached for a first offline boot', async ({ page }) => {
    await page.goto('index.html');
    // Poll for the INSTALL to finish rather than for a cache to merely exist:
    // the cache is created empty and addAll fills it a moment later.
    const read = () => page.evaluate(async () => {
      const keys = await caches.keys();
      const name = keys.filter((k) => k.indexOf('skill-progression-coach-') === 0)[0];
      if (!name) return { name: null, urls: [] };
      const urls = (await (await caches.open(name)).keys()).map((r) => r.url);
      return { name: name, urls: urls };
    });
    let cached = await read();
    for (let i = 0; i < 40 && !cached.urls.some((u) => u.indexOf('context.js') >= 0); i++) {
      await page.waitForTimeout(250);
      cached = await read();
    }
    expect(cached.name).toMatch(/skill-progression-coach-v20/);
    ['context.js', 'content/contexts.json', 'content/vocabulary.json',
      'content/bundle-1.json', 'content/semantics-1.json']
      .forEach((f) => expect(cached.urls.some((u) => u.indexOf(f) >= 0), f).toBe(true));
  });
});

// ── backup ────────────────────────────────────────────────────────────────
// Backup format v2 (Phase 2.5) already exports every durable store, which
// includes both stores P5 writes to. These tests verify that rather than assume
// it, because the alternative — a format change — would be a large change to
// make on an assumption.
test.describe('P5 context — backup', () => {
  test('27 — a v2 backup carries the context package and the adoption', async ({ page }) => {
    await fresh(page);
    await bootContext(page);
    const env = await page.evaluate(async () => {
      const snap = await window.CoachIDB._restore.snapshot();
      return {
        stores: Object.keys(snap.stores).sort(),
        packages: snap.stores.contextPackages.map((p) => p.contextId),
        bundleVersion: snap.stores.contextPackages[0].contentBundle.version,
        adoptions: snap.stores.events.filter((e) => e.kind === 'InterpretationAdoption')
          .map((e) => [e.fromContextId, e.toContextId, e.trigger, e.seq])
      };
    });
    expect(env.stores).toContain('contextPackages');
    expect(env.stores).toContain('events');
    expect(env.packages).toEqual([CTX]);
    expect(env.bundleVersion).toBe(1);
    expect(env.adoptions.length).toBe(1);
    expect(env.adoptions[0][0]).toBeNull();
    expect(env.adoptions[0][1]).toBe(CTX);
    expect(env.adoptions[0][2]).toBe('initial');
  });

  test('28 — a restore preserves the adoption sequence and adds no second one', async ({ page }) => {
    await fresh(page);
    await bootContext(page);
    const out = await page.evaluate(async () => {
      const I = window.CoachIDB, C = window.CoachContext;
      const snap = await I._restore.snapshot();
      const seqBefore = (await C.adoptionLog()).map((a) => a.seq);
      await I._restore.replaceAll(snap.stores);
      const after = await C.adoptionLog();
      // Boot again on the restored device: the adoption is already there, so
      // nothing is appended and the pin is unchanged.
      C._reset();
      const status = await C.init();
      const final = await C.adoptionLog();
      return {
        seqBefore: seqBefore,
        seqAfter: after.map((a) => a.seq),
        status: status,
        finalRows: final.length,
        pkg: !!(await C.getCurrentContextPackage())
      };
    });
    expect(out.seqAfter).toEqual(out.seqBefore);
    expect(out.status.ok).toBe(true);
    expect(out.status.contextId).toBe(CTX);
    expect(out.status.adoptionAppended).toBe(false);
    expect(out.finalRows).toBe(1);
    expect(out.pkg).toBe(true);
  });

  test('29 — ctx_1 is reconstructible, so losing the package is recoverable', async ({ page }) => {
    await fresh(page);
    await bootContext(page);
    const out = await page.evaluate(async (ctx) => {
      const I = window.CoachIDB, C = window.CoachContext;
      const before = await I.get('contextPackages', ctx);
      // Simulate eviction of the package while the adoption survives — the
      // §16 tier-A case. Boot must re-install THAT context, not adopt another.
      await I._restore.replaceAll({
        ledger: [], events: (await I._restore.snapshot()).stores.events,
        artifacts: [], commitments: [],
        athlete: (await I._restore.snapshot()).stores.athlete, contextPackages: []
      });
      const gone = await I.get('contextPackages', ctx);
      C._reset();
      const status = await C.init();
      const after = await I.get('contextPackages', ctx);
      return {
        gone: !!gone, status: status,
        restoredSameBundle: JSON.stringify(after.contentBundle) === JSON.stringify(before.contentBundle),
        rows: (await C.adoptionLog()).length
      };
    }, CTX);
    expect(out.gone).toBe(false);
    expect(out.status.ok).toBe(true);
    expect(out.status.contextId).toBe(CTX);
    expect(out.status.adoptionAppended).toBe(false);   // the pin was never moved
    expect(out.restoredSameBundle).toBe(true);
    expect(out.rows).toBe(1);
  });
});
