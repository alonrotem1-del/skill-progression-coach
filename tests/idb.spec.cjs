// Skill Progression Coach — Phase 2: the IndexedDB foundation.
//
// Every test here runs against REAL Chromium IndexedDB via page.evaluate. The
// risks this phase carries are browser risks — persistence across reload,
// upgrade transactions, transaction rollback — and a fake-IDB shim would not
// exercise any of them.
//
// The foundation is deliberately NOT authoritative in this phase: localStorage
// still drives every decision the app makes. Two describe blocks below exist
// to prove exactly that (no cutover, no mutation, and the app boots normally
// even when IndexedDB is entirely unavailable).
const { test, expect } = require('@playwright/test');

const STORES = ['ledger', 'artifacts', 'events', 'commitments', 'athlete', 'cache', 'contextPackages'];

// Load the page, then drop the database the app's own boot-time init just
// created, so each test starts from a genuinely fresh device.
async function fresh(page) {
  await page.goto('index.html');
  await page.evaluate(async () => {
    const I = window.CoachIDB;
    // Let the app's own deferred boot settle first. It opens this database and
    // (since P5) chains a second async step onto it, so deleting underneath it
    // leaves a connection open that blocks the next version change.
    try { await I.init(); } catch (e) {}
    try { if (window.CoachContext) await window.CoachContext.init(); } catch (e) {}
    try { const db = await I.open(); db.close(); } catch (e) {}
    I._reset();
    if (window.CoachContext) window.CoachContext._reset();
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
    D.worlds.forEach(w => {
      const nodes = window.CoachStore.seedStates(w, bench);
      const f = E.autoFocus(w, nodes);
      state[w.id] = { nodes, focus: { primary: f.primary, supporting: f.supporting, manual: false } };
    });
    S.setBench(bench); S.setState(state);
    S.setProfile({ onboarded: true, activeWorld: 'muscleup', days: [0, 2, 4], duration: 'normal' });
    ['spc_c_day', 'spc_c_sessions', 'spc_c_workout', 'spc_c_adhoc', 'spc_c_plan', 'spc_c_templates'].forEach(k => localStorage.removeItem(k));
  });
  await page.reload();
}

// ── schema: the seven stores of Technical Schema v1.1 §16 ──────────────────
test.describe('idb.js — schema', () => {
  test('01 — open() creates database "spc" at storage-schema version 1', async ({ page }) => {
    await fresh(page);
    const info = await page.evaluate(async () => {
      const db = await window.CoachIDB.open();
      return { name: db.name, version: db.version, declared: window.CoachIDB.SCHEMA_VERSION };
    });
    expect(info.name).toBe('spc');
    expect(info.version).toBe(1);
    expect(info.declared).toBe(1);
  });

  test('02 — all seven object stores exist, and no others', async ({ page }) => {
    await fresh(page);
    const names = await page.evaluate(async () => {
      const db = await window.CoachIDB.open();
      return Array.from(db.objectStoreNames);
    });
    for (const s of STORES) expect(names).toContain(s);
    expect(names.length).toBe(7);
  });

  test('03 — each store has its §16 keyPath, and only ledger/events autoIncrement', async ({ page }) => {
    await fresh(page);
    const shape = await page.evaluate(async () => {
      const db = await window.CoachIDB.open();
      const tx = db.transaction(Array.from(db.objectStoreNames), 'readonly');
      const out = {};
      Array.from(db.objectStoreNames).forEach((n) => {
        const s = tx.objectStore(n);
        out[n] = { keyPath: s.keyPath, autoIncrement: s.autoIncrement };
      });
      return out;
    });
    expect(shape.ledger).toEqual({ keyPath: 'seq', autoIncrement: true });
    expect(shape.events).toEqual({ keyPath: 'seq', autoIncrement: true });
    expect(shape.artifacts).toEqual({ keyPath: 'id', autoIncrement: false });
    expect(shape.commitments).toEqual({ keyPath: 'id', autoIncrement: false });
    expect(shape.athlete).toEqual({ keyPath: 'id', autoIncrement: false });
    expect(shape.cache).toEqual({ keyPath: 'cacheKey', autoIncrement: false });
    expect(shape.contextPackages).toEqual({ keyPath: 'contextId', autoIncrement: false });
  });

  test('04 — ledger carries exerciseId / occurredAt / kind; artifacts and events carry kind / date', async ({ page }) => {
    await fresh(page);
    const idx = await page.evaluate(async () => {
      const db = await window.CoachIDB.open();
      const tx = db.transaction(['ledger', 'artifacts', 'events'], 'readonly');
      return {
        ledger: Array.from(tx.objectStore('ledger').indexNames).sort(),
        artifacts: Array.from(tx.objectStore('artifacts').indexNames).sort(),
        events: Array.from(tx.objectStore('events').indexNames).sort()
      };
    });
    expect(idx.ledger).toEqual(['exerciseId', 'kind', 'occurredAt']);
    expect(idx.artifacts).toEqual(['date', 'kind']);
    expect(idx.events).toEqual(['date', 'kind']);
  });

  test('05 — reopening at the same version is a no-op: no upgrade fires, nothing is lost', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      await I.append('ledger', { kind: 'performance', exerciseId: 'pullup' });
      const db = await I.open();
      db.close();
      I._reset();
      // A second open at the same version must not trigger onupgradeneeded.
      let upgraded = false;
      await new Promise((res, rej) => {
        const req = indexedDB.open('spc', 1);
        req.onupgradeneeded = () => { upgraded = true; };
        req.onsuccess = () => { req.result.close(); res(); };
        req.onerror = () => rej(req.error);
      });
      I._reset();
      return { upgraded, count: await I.count('ledger'), stores: Array.from((await I.open()).objectStoreNames).length };
    });
    expect(r.upgraded).toBe(false);
    expect(r.count).toBe(1);
    expect(r.stores).toBe(7);
  });
});

// ── the storage-schema version marker ──────────────────────────────────────
test.describe('idb.js — storage-schema version', () => {
  test('06 — init() records the storage-schema version on the athlete row', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      const status = await I.init();
      return { status, row: await I.get('athlete', I.ATHLETE_ID) };
    });
    expect(r.status.ok).toBe(true);
    expect(r.status.error).toBeNull();
    expect(r.row.storageSchemaVersion).toBe(1);
  });

  test('07 — init() is idempotent: one athlete row, version unchanged', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      await I.init();
      I._reset();
      await I.init();
      I._reset();
      await I.init();
      return { rows: await I.count('athlete'), row: await I.get('athlete', I.ATHLETE_ID) };
    });
    expect(r.rows).toBe(1);
    expect(r.row.storageSchemaVersion).toBe(1);
  });

  test('08 — recording the version preserves unrelated fields already on the athlete row', async ({ page }) => {
    await fresh(page);
    const row = await page.evaluate(async () => {
      const I = window.CoachIDB;
      await I.put('athlete', { id: I.ATHLETE_ID, displayName: 'Alon', units: 'metric' });
      I._reset();
      await I.init();
      return await I.get('athlete', I.ATHLETE_ID);
    });
    expect(row.displayName).toBe('Alon');
    expect(row.units).toBe('metric');
    expect(row.storageSchemaVersion).toBe(1);
  });

  test('09 — the athlete row carries no capability or current-context field', async ({ page }) => {
    await fresh(page);
    const keys = await page.evaluate(async () => {
      const I = window.CoachIDB;
      await I.init();
      return Object.keys(await I.get('athlete', I.ATHLETE_ID));
    });
    // Technical Schema §2: Athlete "carries no capability field of any kind",
    // and currentInterpretationContext is DERIVED from the adoption ledger —
    // never a stored mutable pointer.
    expect(keys.sort()).toEqual(['id', 'storageSchemaVersion']);
  });
});

// ── append-only semantics ─────────────────────────────────────────────────
test.describe('idb.js — append-only stores', () => {
  test('10 — append() returns a monotonically increasing seq', async ({ page }) => {
    await fresh(page);
    const seqs = await page.evaluate(async () => {
      const I = window.CoachIDB;
      const out = [];
      for (let i = 0; i < 5; i++) out.push(await I.append('ledger', { kind: 'performance', n: i }));
      return out;
    });
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
  });

  test('11 — appended records read back exactly as stored', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      const rec = {
        kind: 'performance', exerciseId: 'pullup', occurredAt: '2026-09-15',
        attributes: { reps: 8 }, side: null, provenance: 'demonstrated',
        sequenceInItem: 3, context: { readiness: null, nested: { deep: [1, 2, 3] } }
      };
      const seq = await I.append('ledger', rec);
      return { seq, back: await I.get('ledger', seq) };
    });
    expect(r.back).toEqual({
      seq: r.seq,
      kind: 'performance', exerciseId: 'pullup', occurredAt: '2026-09-15',
      attributes: { reps: 8 }, side: null, provenance: 'demonstrated',
      sequenceInItem: 3, context: { readiness: null, nested: { deep: [1, 2, 3] } }
    });
  });

  test('12 — append order survives a reopen, and seq never restarts', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      await I.append('ledger', { kind: 'performance', n: 'a' });
      await I.append('ledger', { kind: 'performance', n: 'b' });
      const db = await I.open(); db.close(); I._reset();
      const third = await I.append('ledger', { kind: 'performance', n: 'c' });
      const all = await I.allByIndex('ledger', 'kind', 'performance');
      return { third, order: all.map(x => x.n), seqs: all.map(x => x.seq) };
    });
    expect(r.third).toBe(3);
    expect(r.order).toEqual(['a', 'b', 'c']);
    expect(r.seqs).toEqual([1, 2, 3]);
  });

  test('13 — appended records survive a full page reload', async ({ page }) => {
    await fresh(page);
    await page.evaluate(async () => {
      const I = window.CoachIDB;
      await I.append('ledger', { kind: 'performance', exerciseId: 'pistol', attributes: { reps: 5 } });
      await I.append('events', { kind: 'day_override', date: '2026-09-15' });
      await I.put('contextPackages', { contextId: 'ctx_1', writtenAt: '2026-09-15' });
    });
    await page.reload();
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      return {
        ledger: await I.count('ledger'),
        events: await I.count('events'),
        pkg: await I.get('contextPackages', 'ctx_1'),
        row: await I.get('ledger', 1)
      };
    });
    expect(r.ledger).toBe(1);
    expect(r.events).toBe(1);
    expect(r.pkg).toEqual({ contextId: 'ctx_1', writtenAt: '2026-09-15' });
    expect(r.row.attributes).toEqual({ reps: 5 });
  });

  test('14 — ledger and events refuse put(): the write pattern is enforced, not documented', async ({ page }) => {
    await fresh(page);
    const errs = await page.evaluate(async () => {
      const I = window.CoachIDB;
      const out = {};
      for (const s of ['ledger', 'events']) {
        try { await I.put(s, { seq: 1, tampered: true }); out[s] = 'RESOLVED'; }
        catch (e) { out[s] = e.message; }
      }
      out.count = await I.count('ledger');
      return out;
    });
    expect(errs.ledger).toMatch(/append-only/);
    expect(errs.events).toMatch(/append-only/);
    expect(errs.count).toBe(0);
  });

  test('15 — no update or delete operation is exposed for append-only records', async ({ page }) => {
    await fresh(page);
    const api = await page.evaluate(() => Object.keys(window.CoachIDB).filter(k => typeof window.CoachIDB[k] === 'function'));
    // appendIfNone is an append with a uniqueness precondition, not an update:
    // it can only ever add a row, and only when the index key is absent.
    expect(api.sort()).toEqual(['_applySchema', '_reset', 'allByIndex', 'append', 'appendIfNone',
      'count', 'get', 'init', 'open', 'put', 'status']);
    expect(api).not.toContain('delete');
    expect(api).not.toContain('remove');
    expect(api).not.toContain('update');
    expect(api).not.toContain('clear');
  });

  test('16 — the keyed document stores refuse append()', async ({ page }) => {
    await fresh(page);
    const errs = await page.evaluate(async () => {
      const I = window.CoachIDB;
      const out = {};
      for (const s of ['artifacts', 'commitments', 'athlete', 'cache', 'contextPackages']) {
        try { await I.append(s, { id: 'x', contextId: 'x', cacheKey: 'x' }); out[s] = 'RESOLVED'; }
        catch (e) { out[s] = e.message; }
      }
      return out;
    });
    for (const s of ['artifacts', 'commitments', 'athlete', 'cache', 'contextPackages']) {
      expect(errs[s], s).toMatch(/not append-only/);
    }
  });
});

// ── reads ─────────────────────────────────────────────────────────────────
test.describe('idb.js — reads', () => {
  test('17 — allByIndex() filters by an index value', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      await I.append('ledger', { kind: 'performance', exerciseId: 'pullup', occurredAt: '2026-09-01' });
      await I.append('ledger', { kind: 'performance', exerciseId: 'pistol', occurredAt: '2026-09-02' });
      await I.append('ledger', { kind: 'activity', exerciseId: null, occurredAt: '2026-09-03' });
      await I.append('ledger', { kind: 'performance', exerciseId: 'pullup', occurredAt: '2026-09-04' });
      return {
        pullup: (await I.allByIndex('ledger', 'exerciseId', 'pullup')).map(x => x.occurredAt),
        perf: (await I.allByIndex('ledger', 'kind', 'performance')).length,
        activity: (await I.allByIndex('ledger', 'kind', 'activity')).length,
        all: (await I.allByIndex('ledger', 'kind')).length
      };
    });
    expect(r.pullup).toEqual(['2026-09-01', '2026-09-04']);
    expect(r.perf).toBe(3);
    expect(r.activity).toBe(1);
    expect(r.all).toBe(4);
  });

  test('18 — count() returns the number of records per store', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      await I.append('ledger', { kind: 'performance' });
      await I.append('ledger', { kind: 'performance' });
      await I.put('commitments', { id: 'goal_1' });
      return { ledger: await I.count('ledger'), commitments: await I.count('commitments'), cache: await I.count('cache') };
    });
    expect(r).toEqual({ ledger: 2, commitments: 1, cache: 0 });
  });

  test('19 — get() on a missing key resolves undefined rather than throwing', async ({ page }) => {
    await fresh(page);
    const v = await page.evaluate(async () => {
      const got = await window.CoachIDB.get('contextPackages', 'ctx_nope');
      return got === undefined ? 'UNDEFINED' : JSON.stringify(got);
    });
    expect(v).toBe('UNDEFINED');
  });

  test('20 — a contextPackage round-trips by value, full bundle and semantics intact', async ({ page }) => {
    await fresh(page);
    // Technical Schema §16 C2: the package is DURABLE, holds the FULL bundle
    // and the FULL policy set by value, and is what evaluation will eventually
    // read from — never the network or the service-worker cache. Phase 2 only
    // proves the storage round trip; nothing reads it for any decision yet.
    const back = await page.evaluate(async () => {
      const I = window.CoachIDB;
      const pkg = {
        contextId: 'ctx_1',
        manifest: { contentBundleVersion: 1, evaluationSemanticsVersion: 1 },
        contentBundle: { version: 1, exercises: [{ id: 'pullup', name: 'Pull-Up' }], goals: [{ id: 'ring_muscle_up' }] },
        evaluationSemantics: { version: 1, freshness: 'none', regression: 'none' },
        vocabularyVersionAtWrite: 1,
        writtenAt: '2026-09-15T10:00:00.000Z'
      };
      await I.put('contextPackages', pkg);
      const db = await I.open(); db.close(); I._reset();
      return await I.get('contextPackages', 'ctx_1');
    });
    expect(back.manifest).toEqual({ contentBundleVersion: 1, evaluationSemanticsVersion: 1 });
    expect(back.contentBundle.exercises).toEqual([{ id: 'pullup', name: 'Pull-Up' }]);
    expect(back.evaluationSemantics).toEqual({ version: 1, freshness: 'none', regression: 'none' });
    expect(back.writtenAt).toBe('2026-09-15T10:00:00.000Z');
  });

  test('21 — no adoption, package or athlete goal is fabricated by standing the store up', async ({ page }) => {
    await fresh(page);
    const counts = await page.evaluate(async () => {
      const I = window.CoachIDB;
      await I.init();
      return {
        ledger: await I.count('ledger'),
        events: await I.count('events'),
        artifacts: await I.count('artifacts'),
        commitments: await I.count('commitments'),
        cache: await I.count('cache'),
        contextPackages: await I.count('contextPackages'),
        athlete: await I.count('athlete')
      };
    });
    // Every store empty except the one storage-metadata row. Context packages
    // and the initial null → ctx_1 adoption belong to a later phase, and
    // inventing either here would reference a context this device cannot
    // evaluate.
    expect(counts).toEqual({
      ledger: 0, events: 0, artifacts: 0, commitments: 0,
      cache: 0, contextPackages: 0, athlete: 1
    });
  });
});

// ── rejection and rollback ────────────────────────────────────────────────
test.describe('idb.js — rejection and rollback', () => {
  test('22 — an unknown store or index is rejected', async ({ page }) => {
    await fresh(page);
    const errs = await page.evaluate(async () => {
      const I = window.CoachIDB;
      const out = {};
      const cases = [
        ['append', () => I.append('nope', {})],
        ['put', () => I.put('nope', {})],
        ['get', () => I.get('nope', 1)],
        ['count', () => I.count('nope')],
        ['index', () => I.allByIndex('ledger', 'nope')],
        ['indexOnStoreWithNone', () => I.allByIndex('cache', 'kind')]
      ];
      for (const [name, fn] of cases) {
        try { await fn(); out[name] = 'RESOLVED'; } catch (e) { out[name] = e.message; }
      }
      return out;
    });
    expect(errs.append).toMatch(/unknown object store: nope/);
    expect(errs.put).toMatch(/unknown object store: nope/);
    expect(errs.get).toMatch(/unknown object store: nope/);
    expect(errs.count).toMatch(/unknown object store: nope/);
    expect(errs.index).toMatch(/ledger has no index: nope/);
    expect(errs.indexOnStoreWithNone).toMatch(/cache has no index: kind/);
  });

  test('23 — a record with no value at the store keyPath is rejected', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      let err = 'RESOLVED';
      try { await I.put('contextPackages', { writtenAt: 'now' }); } catch (e) { err = e.name || e.message; }
      return { err, count: await I.count('contextPackages') };
    });
    expect(r.err).not.toBe('RESOLVED');
    expect(r.count).toBe(0);
  });

  test('24 — a failing write rolls the transaction back and leaves the store unchanged', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      const first = await I.append('ledger', { kind: 'performance', n: 1 });
      // A function is not structured-cloneable, so this write cannot commit.
      let err = 'RESOLVED';
      try { await I.append('ledger', { kind: 'performance', boom: function () {} }); }
      catch (e) { err = e.name || e.message; }
      const afterFailure = await I.count('ledger');
      const next = await I.append('ledger', { kind: 'performance', n: 2 });
      const rows = await I.allByIndex('ledger', 'kind', 'performance');
      return { first, err, afterFailure, next, ns: rows.map(x => x.n), total: rows.length };
    });
    expect(r.first).toBe(1);
    expect(r.err).not.toBe('RESOLVED');
    // The rolled-back append left nothing behind, and the store still works.
    expect(r.afterFailure).toBe(1);
    expect(r.ns).toEqual([1, 2]);
    expect(r.total).toBe(2);
  });
});

// ── upgrades: forward-only, additive, idempotent ──────────────────────────
test.describe('idb.js — schema upgrade', () => {
  test('25 — an upgrade from a partial older layout creates only what is missing and deletes nothing', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      // Simulate a device that was left at an older storage layout: only two
      // of the seven stores, ledger with none of its indexes, and one row of
      // real athlete data already in it.
      await new Promise((res, rej) => {
        const req = indexedDB.open('spc', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('ledger', { keyPath: 'seq', autoIncrement: true });
          db.createObjectStore('commitments', { keyPath: 'id' });
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('ledger', 'readwrite');
          tx.objectStore('ledger').add({ kind: 'performance', precious: 'do not lose me' });
          tx.oncomplete = () => { db.close(); res(); };
          tx.onerror = () => rej(tx.error);
        };
        req.onerror = () => rej(req.error);
      });

      // Now run the module's real upgrade routine at a higher version.
      const after = await new Promise((res, rej) => {
        const req = indexedDB.open('spc', 2);
        req.onupgradeneeded = () => { window.CoachIDB._applySchema(req.result, req.transaction); };
        req.onsuccess = () => {
          const db = req.result;
          const names = Array.from(db.objectStoreNames);
          const tx = db.transaction(['ledger'], 'readonly');
          const idx = Array.from(tx.objectStore('ledger').indexNames).sort();
          const g = tx.objectStore('ledger').get(1);
          g.onsuccess = () => { const row = g.result; db.close(); res({ names, idx, row }); };
          g.onerror = () => rej(g.error);
        };
        req.onerror = () => rej(req.error);
      });
      return after;
    });
    for (const s of STORES) expect(r.names).toContain(s);
    expect(r.names.length).toBe(7);
    expect(r.idx).toEqual(['exerciseId', 'kind', 'occurredAt']);
    // The pre-existing row survived the upgrade untouched.
    expect(r.row.precious).toBe('do not lose me');
    expect(r.row.seq).toBe(1);
  });

  test('26a — a database left at a HIGHER version by a newer build fails safely and destroys nothing', async ({ page }) => {
    await fresh(page);
    // Upgrades are forward-only, so a device that ran a newer build and then
    // came back to this one must refuse to open rather than coerce the layout
    // downward. The app keeps working because the store is not authoritative.
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      await new Promise((res, rej) => {
        const req = indexedDB.open('spc', 7);
        req.onupgradeneeded = () => {
          I._applySchema(req.result, req.transaction);
          req.transaction.objectStore('ledger').add({ kind: 'performance', fromFuture: true });
        };
        req.onsuccess = () => { req.result.close(); res(); };
        req.onerror = () => rej(req.error);
      });
      I._reset();
      const status = await I.init();
      // The future database is still intact — nothing was downgraded or wiped.
      const survived = await new Promise((res, rej) => {
        const req = indexedDB.open('spc', 7);
        req.onsuccess = () => {
          const db = req.result;
          const g = db.transaction('ledger', 'readonly').objectStore('ledger').get(1);
          g.onsuccess = () => { const row = g.result; db.close(); res({ version: db.version, row }); };
          g.onerror = () => rej(g.error);
        };
        req.onerror = () => rej(req.error);
      });
      return { status, survived };
    });
    expect(r.status.ok).toBe(false);
    expect(r.status.error).toBeTruthy();
    expect(r.survived.version).toBe(7);
    expect(r.survived.row.fromFuture).toBe(true);
  });

  test('26 — running the upgrade routine again changes nothing (idempotent in effect)', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      await I.append('ledger', { kind: 'performance', keep: 'yes' });
      const db = await I.open(); db.close(); I._reset();

      async function reapply(version) {
        return new Promise((res, rej) => {
          const req = indexedDB.open('spc', version);
          let threw = null;
          req.onupgradeneeded = () => {
            try { I._applySchema(req.result, req.transaction); }
            catch (e) { threw = e.message; }
          };
          req.onsuccess = () => {
            const d = req.result;
            const names = Array.from(d.objectStoreNames);
            const tx = d.transaction(['ledger'], 'readonly');
            const idx = Array.from(tx.objectStore('ledger').indexNames).sort();
            const g = tx.objectStore('ledger').getAll();
            g.onsuccess = () => { const rows = g.result; d.close(); res({ threw, names, idx, rows }); };
            g.onerror = () => rej(g.error);
          };
          req.onerror = () => rej(req.error);
        });
      }
      return { second: await reapply(2), third: await reapply(3) };
    });
    for (const pass of [r.second, r.third]) {
      expect(pass.threw).toBeNull();          // createIndex/createObjectStore never re-attempted
      expect(pass.names.length).toBe(7);
      expect(pass.idx).toEqual(['exerciseId', 'kind', 'occurredAt']);
      expect(pass.rows.length).toBe(1);
      expect(pass.rows[0].keep).toBe('yes');  // data untouched by repeated upgrades
    }
  });
});

// ── no source-of-truth cutover ────────────────────────────────────────────
test.describe('idb.js — no source-of-truth cutover', () => {
  test('27 — standing the store up mutates no localStorage key', async ({ page }) => {
    await seed(page, 2);
    const before = await page.evaluate(() => {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out[k] = localStorage.getItem(k); }
      return out;
    });
    await page.evaluate(async () => {
      const I = window.CoachIDB;
      I._reset();
      await I.init();
      await I.append('ledger', { kind: 'performance', exerciseId: 'pullup' });
      await I.put('cache', { cacheKey: 'k', value: 1 });
    });
    const after = await page.evaluate(() => {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out[k] = localStorage.getItem(k); }
      return out;
    });
    expect(after).toEqual(before);
  });

  test('28 — Today, Week and Progress render exactly as before with the store present', async ({ page }) => {
    await seed(page, 2);
    await page.evaluate(async () => { await window.CoachIDB.init(); });
    await expect(page.locator('.nav [data-s="today"]')).toBeVisible();
    await page.locator('.nav [data-s="week"]').click();
    await expect(page.locator('.scr')).toBeVisible();
    await page.locator('.nav [data-s="progress"]').click();
    await expect(page.locator('.scr')).toBeVisible();
    await page.locator('.nav [data-s="today"]').click();
    await expect(page.locator('.scr')).toBeVisible();
    // And nothing in the durable store was consulted to render any of it.
    const counts = await page.evaluate(async () => ({
      ledger: await window.CoachIDB.count('ledger'),
      cache: await window.CoachIDB.count('cache')
    }));
    expect(counts).toEqual({ ledger: 0, cache: 0 });
  });

  test('29 — the app boots normally when IndexedDB is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        get() { return { open() { throw new Error('simulated IndexedDB failure'); } }; }
      });
    });
    await seed(page, 2);
    // The app is fully usable: Today rendered, nav works, a workout can start.
    await expect(page.locator('.nav [data-s="today"]')).toBeVisible();
    await page.locator('.nav [data-s="week"]').click();
    await expect(page.locator('.scr')).toBeVisible();
    await page.locator('.nav [data-s="today"]').click();
    await expect(page.locator('.scr')).toBeVisible();
    const status = await page.evaluate(async () => await window.CoachIDB.init());
    expect(status.ok).toBe(false);
    expect(status.error).toMatch(/simulated IndexedDB failure/);
  });

  test('30 — a failed init surfaces as a diagnostic and says the data is unaffected', async ({ page }) => {
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
    await expect(page.locator('[data-idb-status]')).toContainText(/unavailable/i);
    await expect(page.locator('[data-idb-status]')).toContainText(/simulated IndexedDB failure/);
    await expect(page.locator('[data-idb-status]')).toContainText(/data is unaffected/i);
    // A failed init neither triggers a reset nor touches localStorage.
    await expect(page.locator('[data-backup-export]')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('spc_c_profile'))).toBe(profileBefore);
  });

  test('31 — the diagnostics line reports ready, with the schema version, when the store is up', async ({ page }) => {
    await seed(page, 2);
    await page.locator('[data-s="profile"]').click();
    await page.locator('[data-sview="data"]').click();
    await expect(page.locator('[data-idb-status]')).toContainText(/ready \(schema v1/);
  });
});

// ── PWA: the new module ships with the shell ──────────────────────────────
test.describe('idb.js — PWA / offline', () => {
  test('32 — idb.js is part of the cached shell after normal PWA caching', async ({ page }) => {
    await seed(page, 2);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForTimeout(600); // let install-time caching finish
    const cached = await page.evaluate(async () => {
      const keys = await window.caches.keys();
      const cacheName = keys.find(k => k.indexOf('skill-progression-coach-') === 0);
      const cache = await window.caches.open(cacheName);
      return { cacheName, hasIdb: !!(await cache.match('./idb.js', { ignoreSearch: true })) };
    });
    expect(cached.cacheName).toMatch(/skill-progression-coach-v20/);
    expect(cached.hasIdb).toBe(true);
  });

  test('33 — the durable store works OFFLINE with idb.js served from cache', async ({ page, context }) => {
    await seed(page, 2);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForTimeout(600);
    await context.setOffline(true);
    await page.goto('index.html');
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      if (!I) return { loaded: false };
      const status = await I.init();
      const seq = await I.append('ledger', { kind: 'performance', offline: true });
      return { loaded: true, ok: status.ok, seq, row: await I.get('ledger', seq) };
    });
    expect(r.loaded).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.row.offline).toBe(true);
    await context.setOffline(false);
  });

  test('34 — a v17→v18 update leaves no stale cache and the new module is live', async ({ page }) => {
    await seed(page, 2);
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.unregister();
      const stale = await window.caches.open('skill-progression-coach-v17');
      await stale.put('./index.html', new Response('<html>stale shell</html>', { headers: { 'Content-Type': 'text/html' } }));
    });
    await page.reload(); // re-registers the SW → fresh install/activate
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForTimeout(800); // let activate() prune obsolete caches
    const keys = await page.evaluate(() => window.caches.keys());
    expect(keys).not.toContain('skill-progression-coach-v17');
    expect(keys).toContain('skill-progression-coach-v20');
    // The live activation has idb.js, and the database still opens.
    const ok = await page.evaluate(async () => (await window.CoachIDB.init()).ok);
    expect(ok).toBe(true);
  });

  test('35 — the athlete database survives a service-worker driven reload (close/reopen proxy)', async ({ page }) => {
    await seed(page, 2);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      await window.CoachIDB.append('ledger', { kind: 'performance', marker: 'before-reload' });
    });
    await page.reload();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      return { count: await I.count('ledger'), row: await I.get('ledger', 1) };
    });
    expect(r.count).toBe(1);
    expect(r.row.marker).toBe('before-reload');
  });
});

// ── appendIfNone: the one atomic check-and-append (added for P5) ───────────
// The events store is keyed by an autoIncrement sequence, so it cannot carry a
// unique constraint. This primitive is the whole uniqueness mechanism for "at
// most one record of this kind", and it has to hold under concurrency.
test.describe('idb.js — appendIfNone', () => {
  test('31 — appends when the index is empty, and reports the assigned seq', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      const out = await I.appendIfNone('events', 'kind', 'OnlyOne', { kind: 'OnlyOne', date: 'd', n: 1 });
      return { out: out, count: await I.count('events') };
    });
    expect(r.out.appended).toBe(true);
    expect(typeof r.out.seq).toBe('number');
    expect(r.out.existing).toBe(0);
    expect(r.count).toBe(1);
  });

  test('32 — refuses a second record under the same index key, and says why', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      await I.appendIfNone('events', 'kind', 'OnlyOne', { kind: 'OnlyOne', date: 'd', n: 1 });
      const second = await I.appendIfNone('events', 'kind', 'OnlyOne', { kind: 'OnlyOne', date: 'd', n: 2 });
      // A DIFFERENT key is unaffected — this is per-key, not a store-wide latch.
      const other = await I.appendIfNone('events', 'kind', 'Another', { kind: 'Another', date: 'd', n: 3 });
      const rows = await I.allByIndex('events', 'kind', 'OnlyOne');
      return { second: second, other: other, kept: rows.map((x) => x.n), count: await I.count('events') };
    });
    expect(r.second.appended).toBe(false);
    expect(r.second.existing).toBe(1);
    expect(r.second.seq).toBeNull();
    expect(r.other.appended).toBe(true);
    expect(r.kept).toEqual([1]);              // the original, not the newcomer
    expect(r.count).toBe(2);
  });

  test('33 — under twenty racing callers exactly one append wins', async ({ page }) => {
    await fresh(page);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      const rs = await Promise.all(Array.from({ length: 20 }, (_, i) =>
        I.appendIfNone('events', 'kind', 'OnlyOne', { kind: 'OnlyOne', date: 'd', n: i })));
      return { won: rs.filter((x) => x.appended).length, count: await I.count('events') };
    });
    expect(r.won).toBe(1);
    expect(r.count).toBe(1);
  });

  test('34 — it keeps the append-only and index guards of the ordinary API', async ({ page }) => {
    await fresh(page);
    const errs = await page.evaluate(async () => {
      const I = window.CoachIDB;
      const out = [];
      const tries = [
        ['athlete', 'kind', 'x'],        // not append-only
        ['events', 'nope', 'x'],         // no such index
        ['nosuchstore', 'kind', 'x']     // no such store
      ];
      for (const t of tries) {
        try { await I.appendIfNone(t[0], t[1], t[2], { kind: 'x' }); out.push(null); }
        catch (e) { out.push(e.message); }
      }
      return out;
    });
    expect(errs[0]).toMatch(/not append-only/);
    expect(errs[1]).toMatch(/no index/);
    expect(errs[2]).toMatch(/unknown object store/);
  });
});
