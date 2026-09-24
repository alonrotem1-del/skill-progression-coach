// Skill Progression Coach — Phase 2.5: Backup Format v2.
//
// v2 exists because Phase 3 will write Evidence into IndexedDB that exists
// nowhere else. This suite proves that a backup taken today carries the whole
// durable picture — localStorage AND the six durable IndexedDB stores — and
// that restoring one lands the app in a single coherent state rather than a
// mixture of two eras.
//
// Everything below runs against REAL Chromium IndexedDB. The interesting
// failure modes (sequence identity, multi-store transactions, a half-applied
// restore across two storage systems that share no transaction) do not exist
// in a shim.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Backup = require('../backup.js');

const DURABLE = ['ledger', 'events', 'artifacts', 'commitments', 'athlete', 'contextPackages'];
const LS_KEYS = [
  'spc_c_profile', 'spc_c_state', 'spc_c_sessions', 'spc_c_bench', 'spc_c_settings', 'spc_c_plan',
  'spc_c_templates', 'spc_c_adhoc', 'spc_c_workout', 'spc_c_day',
  'puc_log', 'puc_plan', 'puc_settings', 'puc_session', 'puc_progression', 'puc_secondary'
];

function tmpFile(name, content) {
  const p = path.join(os.tmpdir(), name + '-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(p, content);
  return p;
}

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
    localStorage.setItem('puc_log', JSON.stringify([{ date: '2026-01-01', reps: 7 }]));
  });
  await page.reload();
  await page.evaluate(async () => {
    await window.CoachIDB.init();
    if (window.CoachContext) await window.CoachContext.init();
  });
}

// Recognisable content in every durable store, plus a cache entry that must
// never be exported and must never survive a restore.
async function populateDurable(page, tag) {
  return await page.evaluate(async (t) => {
    const I = window.CoachIDB;
    await I._restore.replaceAll({
      ledger: [
        { seq: 1, kind: 'performance', exerciseId: 'pullup', occurredAt: '2026-09-01', attributes: { reps: 8 }, tag: t },
        { seq: 2, kind: 'performance', exerciseId: 'pistol', occurredAt: '2026-09-02', attributes: { reps: 5 }, tag: t },
        { seq: 7, kind: 'activity', exerciseId: null, occurredAt: '2026-09-03', tag: t }
      ],
      events: [
        { seq: 1, kind: 'day_override', date: '2026-09-01', tag: t },
        { seq: 4, kind: 'plan_disposition', date: '2026-09-02', tag: t }
      ],
      artifacts: [{ id: 'wk_1', kind: 'workout', date: '2026-09-01', rationale: 'as rendered', tag: t }],
      commitments: [{ id: 'goal_1', kind: 'athlete_goal', goalId: 'ring_muscle_up', tag: t }],
      athlete: [{ id: I.ATHLETE_ID, storageSchemaVersion: I.SCHEMA_VERSION, displayName: 'Alon', tag: t }],
      contextPackages: [{ contextId: 'ctx_1', manifest: { contentBundleVersion: 1, evaluationSemanticsVersion: 1 }, tag: t }]
    });
    await I.put('cache', { cacheKey: 'derived:' + t, value: 'disposable' });
    return true;
  }, tag);
}

async function readDurable(page) {
  return await page.evaluate(async () => {
    const I = window.CoachIDB;
    const snap = await I._restore.snapshot();
    const cache = await I.count('cache');
    return { stores: snap.stores, schemaVersion: snap.schemaVersion, cacheCount: cache };
  });
}

async function readLocalStorage(page) {
  return await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out[k] = localStorage.getItem(k); }
    return out;
  });
}

// Idempotent on purpose. `settingsView` is a module-level variable that
// survives nav, so once the Data screen has been opened, clicking Profile
// re-renders Data rather than the Settings home that carries [data-sview].
// Tests that export and then restore call this twice in a row.
async function openData(page) {
  if (await page.locator('[data-backup-export]').count()) {
    await expect(page.locator('[data-backup-export]')).toBeVisible();
    return;
  }
  await page.locator('[data-s="profile"]').click();
  if (await page.locator('[data-sview="data"]').count()) {
    await page.locator('[data-sview="data"]').click();
  }
  await expect(page.locator('[data-backup-export]')).toBeVisible();
}

// Export through the real Export button and return the parsed file.
async function exportViaUI(page) {
  await openData(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-backup-export]').click()
  ]);
  return JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
}

// Restore through the real hidden file input, accepting the confirm dialog.
async function restoreViaUI(page, envelopeOrText, { accept = true } = {}) {
  await openData(page);
  let dialogSeen = false;
  page.once('dialog', d => { dialogSeen = true; accept ? d.accept() : d.dismiss(); });
  const text = typeof envelopeOrText === 'string' ? envelopeOrText : JSON.stringify(envelopeOrText);
  await page.locator('[data-backup-file]').setInputFiles(tmpFile('spc-v2', text));
  await page.waitForTimeout(500);
  return { dialogSeen };
}

function v1Envelope(overrides) {
  const keys = {}; LS_KEYS.forEach(k => keys[k] = { present: false });
  keys.spc_c_profile = { present: true, value: '{"onboarded":true,"activeWorld":"muscleup","fromV1":true}' };
  return Object.assign({ format: 'spc-backup', formatVersion: 1, app: 'skill-progression-coach', exportedAt: '2026-08-01T00:00:00.000Z', keys }, overrides || {});
}

// ── format rules (pure) ───────────────────────────────────────────────────
test.describe('Backup v2 — format rules (pure module)', () => {
  function emptyStorage() {
    const stores = {}; Backup.DURABLE_STORES.forEach(n => stores[n] = []);
    return { schemaVersion: Backup.STORAGE_SCHEMA_VERSION, stores };
  }

  test('01 — the exported envelope declares format version 2 and carries a storage block', () => {
    const env = Backup.exportAll(() => null, { storage: emptyStorage() });
    expect(env.formatVersion).toBe(2);
    expect(Backup.FORMAT_VERSION).toBe(2);
    expect(Object.keys(env.storage.stores).sort()).toEqual(DURABLE.slice().sort());
    expect(env.storage.schemaVersion).toBe(1);
  });

  test('02 — both version 1 and version 2 are importable', () => {
    expect(Backup.SUPPORTED_FORMAT_VERSIONS).toEqual([1, 2]);
    expect(Backup.validateEnvelope(v1Envelope()).ok).toBe(true);
  });

  test('03 — cache is not in the durable list and is refused if offered for export', () => {
    expect(Backup.DURABLE_STORES).not.toContain('cache');
    expect(Backup.EXCLUDED_STORES).toEqual(['cache']);
    const s = emptyStorage(); s.stores.cache = [{ cacheKey: 'x' }];
    expect(() => Backup.exportAll(() => null, { storage: s })).toThrow(/cache is derived state/i);
  });

  test('04 — export refuses to build a partial envelope rather than omitting a store', () => {
    expect(() => Backup.exportAll(() => null, {})).toThrow(/durable storage snapshot is missing/i);
    const s = emptyStorage(); delete s.stores.ledger;
    expect(() => Backup.exportAll(() => null, { storage: s })).toThrow(/no records were read for ledger/i);
  });

  test('05 — a v2 envelope missing a store, carrying an unknown store, or carrying cache is rejected', () => {
    const base = () => ({ ...Backup.exportAll(() => null, { storage: emptyStorage() }) });
    let e = base(); delete e.storage.stores.events;
    expect(Backup.validateEnvelope(e).reason).toMatch(/missing expected store: events/);
    e = base(); e.storage.stores.somethingElse = [];
    expect(Backup.validateEnvelope(e).reason).toMatch(/unexpected store in backup/);
    e = base(); e.storage.stores.cache = [];
    expect(Backup.validateEnvelope(e).reason).toMatch(/derived store: cache/);
  });

  test('06 — a ledger record without a usable sequence, or with a duplicate one, is rejected', () => {
    let e = Backup.exportAll(() => null, { storage: emptyStorage() });
    e.storage.stores.ledger = [{ kind: 'performance' }];
    expect(Backup.validateEnvelope(e).reason).toMatch(/has no valid seq/);
    e = Backup.exportAll(() => null, { storage: emptyStorage() });
    e.storage.stores.ledger = [{ seq: 3, kind: 'a' }, { seq: 3, kind: 'b' }];
    expect(Backup.validateEnvelope(e).reason).toMatch(/duplicate seq in ledger/);
  });

  test('07 — an unsupported storage schema version is rejected', () => {
    const e = Backup.exportAll(() => null, { storage: emptyStorage() });
    e.storage.schemaVersion = 99;
    expect(Backup.validateEnvelope(e).reason).toMatch(/unsupported storage schema version: 99/);
  });

  test('08 — a v1 envelope that smuggles in a storage block is rejected as self-contradictory', () => {
    expect(Backup.validateEnvelope(v1Envelope({ storage: emptyStorage() })).reason)
      .toMatch(/version 1 backup must not contain durable storage/);
  });

  test('09 — a v1 restore plans the clean baseline: no athlete-owned rows, only storage metadata', () => {
    const planned = Backup.plannedStores(v1Envelope(), { baselineAthleteRow: { id: 'athlete', storageSchemaVersion: 1 } });
    expect(planned.ledger).toEqual([]);
    expect(planned.events).toEqual([]);
    expect(planned.artifacts).toEqual([]);
    expect(planned.commitments).toEqual([]);
    expect(planned.contextPackages).toEqual([]);
    expect(planned.athlete).toEqual([{ id: 'athlete', storageSchemaVersion: 1 }]);
  });

  test('10 — a v2 restore plans exactly the backup contents, verbatim', () => {
    const s = emptyStorage();
    s.stores.ledger = [{ seq: 5, kind: 'performance', attributes: { reps: 3 } }];
    const env = Backup.exportAll(() => null, { storage: s });
    const planned = Backup.plannedStores(env, { baselineAthleteRow: { id: 'athlete', storageSchemaVersion: 1 } });
    expect(planned.ledger).toEqual([{ seq: 5, kind: 'performance', attributes: { reps: 3 } }]);
    expect(planned.athlete).toEqual([]); // the backup said empty, so empty it is
  });
});

// ── export completeness ───────────────────────────────────────────────────
test.describe('Backup v2 — export completeness', () => {
  test('11 — a real export carries localStorage and every durable store exactly, and never cache', async ({ page }) => {
    await seed(page, 2);
    await populateDurable(page, 'exported');
    const before = await readLocalStorage(page);
    const env = await exportViaUI(page);

    expect(env.formatVersion).toBe(2);
    expect(env.format).toBe('spc-backup');
    expect(env.app).toBe('skill-progression-coach');
    expect(typeof env.exportedAt).toBe('string');
    expect(env.storage.schemaVersion).toBe(1);

    // localStorage, key for key, byte for byte.
    LS_KEYS.forEach(k => {
      const rec = env.keys[k];
      if (before[k] === undefined) expect(rec, k).toEqual({ present: false });
      else expect(rec, k).toEqual({ present: true, value: before[k] });
    });

    // Every durable store, record for record.
    expect(env.storage.stores.ledger.map(r => r.seq)).toEqual([1, 2, 7]);
    expect(env.storage.stores.ledger[0]).toEqual({ seq: 1, kind: 'performance', exerciseId: 'pullup', occurredAt: '2026-09-01', attributes: { reps: 8 }, tag: 'exported' });
    expect(env.storage.stores.events.map(r => r.seq)).toEqual([1, 4]);
    expect(env.storage.stores.events[1]).toEqual({ seq: 4, kind: 'plan_disposition', date: '2026-09-02', tag: 'exported' });
    expect(env.storage.stores.artifacts).toEqual([{ id: 'wk_1', kind: 'workout', date: '2026-09-01', rationale: 'as rendered', tag: 'exported' }]);
    expect(env.storage.stores.commitments).toEqual([{ id: 'goal_1', kind: 'athlete_goal', goalId: 'ring_muscle_up', tag: 'exported' }]);
    expect(env.storage.stores.athlete).toEqual([{ id: 'athlete', storageSchemaVersion: 1, displayName: 'Alon', tag: 'exported' }]);
    expect(env.storage.stores.contextPackages).toEqual([{ contextId: 'ctx_1', manifest: { contentBundleVersion: 1, evaluationSemanticsVersion: 1 }, tag: 'exported' }]);

    // cache is absent entirely — not empty, absent.
    expect(Object.prototype.hasOwnProperty.call(env.storage.stores, 'cache')).toBe(false);
    expect(Object.keys(env.storage.stores).sort()).toEqual(DURABLE.slice().sort());
  });

  test('12 — the athlete store is carried faithfully, not reduced to today’s known fields', async ({ page }) => {
    await seed(page, 2);
    // A field a later phase might legitimately add. v2 must carry it without
    // needing a v3, so nothing here may whitelist today's minimal contents.
    await page.evaluate(async () => {
      const I = window.CoachIDB;
      await I.put('athlete', { id: I.ATHLETE_ID, storageSchemaVersion: I.SCHEMA_VERSION, units: 'metric', futureField: { nested: [1, 2] } });
    });
    const env = await exportViaUI(page);
    expect(env.storage.stores.athlete[0].units).toBe('metric');
    expect(env.storage.stores.athlete[0].futureField).toEqual({ nested: [1, 2] });
  });
});

// ── round trip ────────────────────────────────────────────────────────────
test.describe('Backup v2 — round trip', () => {
  test('13 — a full round trip restores localStorage and every durable store exactly', async ({ page }) => {
    await seed(page, 2);
    await populateDurable(page, 'original');
    const beforeLS = await readLocalStorage(page);
    const beforeDurable = await readDurable(page);
    const env = await exportViaUI(page);

    // Change everything on both sides.
    await page.evaluate(() => {
      localStorage.setItem('spc_c_bench', JSON.stringify({ pullup_max: 999 }));
      localStorage.setItem('puc_log', JSON.stringify([{ date: '2099-01-01', reps: 1 }]));
    });
    await populateDurable(page, 'modified');
    expect((await readDurable(page)).stores.ledger[0].tag).toBe('modified');

    await restoreViaUI(page, env);
    await page.waitForTimeout(700); // the UI reloads after a successful restore

    const afterLS = await readLocalStorage(page);
    const afterDurable = await readDurable(page);

    // `spc_c_day` is transient execution state that the app rebuilds on boot,
    // stamping a fresh `date` — and a successful restore ends in a reload, so
    // that rebuild happens after the restore. Everything else must be byte
    // identical; spc_c_day is compared with only that app-stamped field
    // normalised, so a genuine content change in it would still fail.
    const REGENERATED = 'spc_c_day';
    LS_KEYS.filter(k => k !== REGENERATED).forEach(k => {
      expect(afterLS[k], k).toBe(beforeLS[k]);
    });
    const normaliseDay = (raw) => {
      if (raw == null) return raw;
      const d = JSON.parse(raw); delete d.date; return JSON.stringify(d);
    };
    expect(normaliseDay(afterLS[REGENERATED])).toBe(normaliseDay(beforeLS[REGENERATED]));

    DURABLE.forEach(s => { expect(afterDurable.stores[s], s).toEqual(beforeDurable.stores[s]); });
    expect(afterDurable.stores.ledger[0].tag).toBe('original');
  });

  test('14 — ledger and events sequence identity survives, and the next append continues above the restored maximum', async ({ page }) => {
    await seed(page, 2);
    await populateDurable(page, 'seqtest');
    const env = await exportViaUI(page);

    // Wipe both append-only stores completely, then restore.
    await page.evaluate(async () => {
      const I = window.CoachIDB;
      const snap = await I._restore.snapshot();
      snap.stores.ledger = []; snap.stores.events = [];
      await I._restore.replaceAll(snap.stores);
    });
    expect((await readDurable(page)).stores.ledger.length).toBe(0);

    await restoreViaUI(page, env);
    await page.waitForTimeout(700);

    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      const snap = await I._restore.snapshot();
      // Ordinary appends — the normal append-only API, unchanged.
      const nextLedger = await I.append('ledger', { kind: 'performance', afterRestore: true });
      const nextEvents = await I.append('events', { kind: 'day_override', afterRestore: true });
      return {
        ledgerSeqs: snap.stores.ledger.map(x => x.seq),
        eventSeqs: snap.stores.events.map(x => x.seq),
        nextLedger, nextEvents
      };
    });

    // Exact sequence identity and ordering.
    expect(r.ledgerSeqs).toEqual([1, 2, 7]);
    expect(r.eventSeqs).toEqual([1, 4]);
    // The key generator was advanced past the restored maximum, so a new
    // append can never collide with or reorder a restored record.
    expect(r.nextLedger).toBeGreaterThan(7);
    expect(r.nextEvents).toBeGreaterThan(4);
  });

  test('15 — a durable row that is not in the backup does not survive the restore', async ({ page }) => {
    await seed(page, 2);
    await populateDurable(page, 'original');
    const env = await exportViaUI(page);

    // Add rows the backup has never heard of, in every durable store.
    await page.evaluate(async () => {
      const I = window.CoachIDB;
      const snap = await I._restore.snapshot();
      snap.stores.ledger.push({ seq: 99, kind: 'performance', ghost: true });
      snap.stores.events.push({ seq: 99, kind: 'ghost' });
      snap.stores.artifacts.push({ id: 'ghost_artifact' });
      snap.stores.commitments.push({ id: 'ghost_goal' });
      snap.stores.contextPackages.push({ contextId: 'ctx_ghost' });
      await I._restore.replaceAll(snap.stores);
    });

    await restoreViaUI(page, env);
    await page.waitForTimeout(700);

    const after = await readDurable(page);
    expect(after.stores.ledger.some(r => r.ghost)).toBe(false);
    expect(after.stores.ledger.map(r => r.seq)).toEqual([1, 2, 7]);
    expect(after.stores.events.some(r => r.kind === 'ghost')).toBe(false);
    expect(after.stores.artifacts.some(r => r.id === 'ghost_artifact')).toBe(false);
    expect(after.stores.commitments.some(r => r.id === 'ghost_goal')).toBe(false);
    expect(after.stores.contextPackages.some(r => r.contextId === 'ctx_ghost')).toBe(false);
  });

  test('16 — a pre-existing cache entry does not survive a restore', async ({ page }) => {
    await seed(page, 2);
    await populateDurable(page, 'original');
    const env = await exportViaUI(page);
    await page.evaluate(async () => {
      await window.CoachIDB.put('cache', { cacheKey: 'derived:stale', value: 'must not survive' });
      await window.CoachIDB.put('cache', { cacheKey: 'derived:stale2', value: 'nor this' });
    });
    expect((await readDurable(page)).cacheCount).toBeGreaterThan(0);

    await restoreViaUI(page, env);
    await page.waitForTimeout(700);

    expect((await readDurable(page)).cacheCount).toBe(0);
  });
});

// ── validate before mutating ──────────────────────────────────────────────
test.describe('Backup v2 — validation causes zero mutation', () => {
  const badCases = [
    ['malformed JSON', () => '{ not json at all', /not valid JSON/i],
    ['unsupported backup version', () => JSON.stringify(v1Envelope({ formatVersion: 99 })), /not a valid Skill Progression Coach backup/i],
    ['unsupported storage schema', () => {
      const keys = {}; LS_KEYS.forEach(k => keys[k] = { present: false });
      const stores = {}; DURABLE.forEach(n => stores[n] = []);
      return JSON.stringify({ format: 'spc-backup', formatVersion: 2, app: 'skill-progression-coach', exportedAt: 'x', keys, storage: { schemaVersion: 99, stores } });
    }, /not a valid Skill Progression Coach backup/i],
    ['a v2 backup missing a durable store', () => {
      const keys = {}; LS_KEYS.forEach(k => keys[k] = { present: false });
      const stores = {}; DURABLE.forEach(n => stores[n] = []); delete stores.ledger;
      return JSON.stringify({ format: 'spc-backup', formatVersion: 2, app: 'skill-progression-coach', exportedAt: 'x', keys, storage: { schemaVersion: 1, stores } });
    }, /not a valid Skill Progression Coach backup/i],
    ['a v2 backup carrying cache', () => {
      const keys = {}; LS_KEYS.forEach(k => keys[k] = { present: false });
      const stores = {}; DURABLE.forEach(n => stores[n] = []); stores.cache = [{ cacheKey: 'x' }];
      return JSON.stringify({ format: 'spc-backup', formatVersion: 2, app: 'skill-progression-coach', exportedAt: 'x', keys, storage: { schemaVersion: 1, stores } });
    }, /not a valid Skill Progression Coach backup/i],
    ['a ledger record with a duplicate sequence', () => {
      const keys = {}; LS_KEYS.forEach(k => keys[k] = { present: false });
      const stores = {}; DURABLE.forEach(n => stores[n] = []);
      stores.ledger = [{ seq: 2, kind: 'a' }, { seq: 2, kind: 'b' }];
      return JSON.stringify({ format: 'spc-backup', formatVersion: 2, app: 'skill-progression-coach', exportedAt: 'x', keys, storage: { schemaVersion: 1, stores } });
    }, /not a valid Skill Progression Coach backup/i]
  ];

  for (const [label, make, expected] of badCases) {
    test(`17 — ${label} is rejected with no dialog and no mutation of either store`, async ({ page }) => {
      await seed(page, 2);
      await populateDurable(page, 'untouched');
      const beforeLS = await readLocalStorage(page);
      const beforeDurable = await readDurable(page);

      const { dialogSeen } = await restoreViaUI(page, make());

      expect(dialogSeen).toBe(false); // never even reached confirmation
      await expect(page.locator('[data-backup-status]')).toContainText(expected);
      expect(await readLocalStorage(page)).toEqual(beforeLS);
      const afterDurable = await readDurable(page);
      DURABLE.forEach(s => expect(afterDurable.stores[s], s).toEqual(beforeDurable.stores[s]));
      expect(afterDurable.cacheCount).toBe(beforeDurable.cacheCount);
    });
  }

  test('18 — declining the confirmation changes neither store', async ({ page }) => {
    await seed(page, 2);
    await populateDurable(page, 'untouched');
    const beforeLS = await readLocalStorage(page);
    const beforeDurable = await readDurable(page);
    const env = await exportViaUI(page);
    await page.evaluate(() => localStorage.setItem('spc_c_bench', '{"pullup_max":42}'));

    const { dialogSeen } = await restoreViaUI(page, env, { accept: false });
    expect(dialogSeen).toBe(true);
    await expect(page.locator('[data-backup-status]')).toContainText(/cancelled/i);
    // The one change made after export is still there: nothing was restored.
    expect(await page.evaluate(() => localStorage.getItem('spc_c_bench'))).toBe('{"pullup_max":42}');
    const afterDurable = await readDurable(page);
    DURABLE.forEach(s => expect(afterDurable.stores[s], s).toEqual(beforeDurable.stores[s]));
    expect(beforeLS.spc_c_profile).toBe((await readLocalStorage(page)).spc_c_profile);
  });
});

// ── IndexedDB unavailable ─────────────────────────────────────────────────
test.describe('Backup v2 — IndexedDB unavailable', () => {
  async function breakIndexedDB(page) {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        get() { return { open() { throw new Error('simulated IndexedDB failure'); } }; }
      });
    });
  }

  test('19 — export produces NO file at all rather than a partial backup', async ({ page }) => {
    await seed(page, 2);
    await breakIndexedDB(page);
    await page.reload();
    await openData(page);

    let sawDownload = false;
    page.on('download', () => { sawDownload = true; });
    await page.locator('[data-backup-export]').click();
    await page.waitForTimeout(900);

    expect(sawDownload).toBe(false);
    await expect(page.locator('[data-backup-status]')).toContainText(/no backup file was created/i);
    await expect(page.locator('[data-backup-status]')).toContainText(/partial backup would not be safe/i);
  });

  test('20 — an import that cannot reach durable storage leaves localStorage completely untouched', async ({ page }) => {
    await seed(page, 2);
    await populateDurable(page, 'original');
    const env = await exportViaUI(page);
    // Make the backup's localStorage payload clearly different from the current
    // state, so a partial restore would be unmistakable.
    env.keys.spc_c_profile = { present: true, value: '{"onboarded":true,"activeWorld":"muscleup","restored":"SHOULD-NOT-APPEAR"}' };
    env.keys.spc_c_bench = { present: true, value: '{"pullup_max":1234}' };

    await breakIndexedDB(page);
    await page.reload();
    const beforeLS = await readLocalStorage(page);

    const { dialogSeen } = await restoreViaUI(page, env);
    expect(dialogSeen).toBe(true); // validation passed; failure happens after
    await expect(page.locator('[data-backup-status]')).toContainText(/simulated IndexedDB failure/);
    // Durable storage is replaced FIRST precisely so this case cannot
    // half-restore: localStorage was never written.
    expect(await readLocalStorage(page)).toEqual(beforeLS);
    expect(await page.evaluate(() => localStorage.getItem('spc_c_profile'))).not.toContain('SHOULD-NOT-APPEAR');
    expect(await page.evaluate(() => localStorage.getItem('spc_c_bench'))).not.toBe('{"pullup_max":1234}');
    // No reload happened — a failed restore never claims success.
    await expect(page.locator('[data-backup-export]')).toBeVisible();
  });
});

// ── rollback across both storage systems ──────────────────────────────────
test.describe('Backup v2 — rollback', () => {
  test('21 — a localStorage failure mid-restore returns BOTH stores to their exact pre-import state', async ({ page }) => {
    await seed(page, 2);
    await populateDurable(page, 'original');
    const env = await exportViaUI(page);

    // Move both stores to a clearly different "current" state.
    await populateDurable(page, 'current');
    await page.evaluate(() => localStorage.setItem('spc_c_bench', '{"pullup_max":55}'));
    const beforeLS = await readLocalStorage(page);
    const beforeDurable = await readDurable(page);
    expect(beforeDurable.stores.ledger[0].tag).toBe('current');

    // Now make one localStorage write fail, after the durable side has already
    // committed — the hard case this ordering exists to handle. puc_log is the
    // right victim: the backup definitely carries it, and the app itself never
    // writes puc_* keys, so only the restore can trigger this. It is armed for
    // a single throw so the primary pass fails and the rollback pass succeeds.
    await page.addInitScript(() => {
      const orig = Storage.prototype.setItem;
      let armed = true;
      Storage.prototype.setItem = function (k, v) {
        if (armed && k === 'puc_log') { armed = false; throw new Error('simulated disk-full'); }
        return orig.call(this, k, v);
      };
    });
    await page.reload();

    const { dialogSeen } = await restoreViaUI(page, env);
    expect(dialogSeen).toBe(true);
    await expect(page.locator('[data-backup-status]')).toContainText(/Restore failed/i);
    await expect(page.locator('[data-backup-status]')).toContainText(/simulated disk-full/i);
    await expect(page.locator('[data-backup-export]')).toBeVisible(); // no reload

    // The durable side was rolled back off the backup's contents, all the way
    // to the pre-import state — not left holding 'original'.
    const afterDurable = await readDurable(page);
    DURABLE.forEach(s => expect(afterDurable.stores[s], s).toEqual(beforeDurable.stores[s]));
    expect(afterDurable.stores.ledger[0].tag).toBe('current');
    // And localStorage rolled itself back too.
    expect(await page.evaluate(() => localStorage.getItem('spc_c_profile'))).toBe(beforeLS.spc_c_profile);
    expect(await page.evaluate(() => localStorage.getItem('spc_c_bench'))).toBe('{"pullup_max":55}');
  });
});

// ── Backup v1 compatibility ───────────────────────────────────────────────
test.describe('Backup v2 — Backup v1 files remain importable, and restore coherently', () => {
  test('22 — a v1 file still imports and restores its localStorage payload', async ({ page }) => {
    await seed(page, 2);
    await restoreViaUI(page, v1Envelope());
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => localStorage.getItem('spc_c_profile'))).toContain('"fromV1":true');
  });

  test('23 — a v1 restore removes newer athlete-owned durable data instead of leaving mixed-era state', async ({ page }) => {
    await seed(page, 2);
    await populateDurable(page, 'newer-era');
    const before = await readDurable(page);
    expect(before.stores.ledger.length).toBe(3);
    expect(before.stores.artifacts.length).toBe(1);
    expect(before.stores.commitments.length).toBe(1);
    expect(before.stores.contextPackages.length).toBe(1);

    await restoreViaUI(page, v1Envelope());
    await page.waitForTimeout(700);

    const after = await readDurable(page);
    // No evidence, artifacts or commitments from the newer era survive beside
    // the older localStorage snapshot.
    expect(after.stores.ledger).toEqual([]);
    expect(after.stores.artifacts).toEqual([]);
    expect(after.stores.commitments).toEqual([]);
    expect(after.cacheCount).toBe(0);
    // The newer era's EVENTS are gone too. What is here instead is the one row
    // boot writes on an uninitialised device: a v1 backup predates the
    // interpretation context entirely, so the restore leaves no adoption, and
    // onboarding is incomplete until null -> ctx_1 exists (invariant 26).
    // Re-establishing the shipped context is not mixed-era state; it is the
    // device becoming initialised again.
    expect(after.stores.events.map(e => e.kind)).toEqual(['InterpretationAdoption']);
    expect(after.stores.events[0].fromContextId).toBeNull();
    expect(after.stores.events[0].toContextId).toBe('ctx_1');
    expect(after.stores.events[0].trigger).toBe('initial');
    expect(after.stores.contextPackages.map(p => p.contextId)).toEqual(['ctx_1']);
    // And it is the freshly installed package, not the newer era's row.
    expect(after.stores.contextPackages[0].tag).toBeUndefined();
    expect(after.stores.contextPackages[0].contentBundle.version).toBe(1);
  });

  test('24 — a v1 restore leaves durable storage in a valid, operable clean baseline', async ({ page }) => {
    await seed(page, 2);
    await populateDurable(page, 'newer-era');
    await restoreViaUI(page, v1Envelope());
    await page.waitForTimeout(700);

    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      const db = await I.open();
      const stores = Array.from(db.objectStoreNames).sort();
      const athlete = await I.get('athlete', I.ATHLETE_ID);
      const status = await I.init();           // must still report ready
      const seq = await I.append('ledger', { kind: 'performance', postV1Restore: true });
      return { stores, athlete, ok: status.ok, version: db.version, seq };
    });

    expect(r.stores).toEqual(DURABLE.concat(['cache']).sort());
    expect(r.version).toBe(1);
    expect(r.ok).toBe(true);
    // Only the storage metadata a clean device would have — no invented
    // evidence, no fabricated adoption, no athlete-owned fields.
    expect(r.athlete).toEqual({ id: 'athlete', storageSchemaVersion: 1 });
    // And the store is immediately usable. The sequence does NOT restart at 1:
    // clearing a store leaves its key generator alone, which is exactly what
    // Technical Schema §3 requires ("it must never be reset or reused"), so a
    // sequence freed by a restore can never be handed out a second time.
    expect(r.seq).toBeGreaterThan(7); // 7 was the highest seq before the reset
  });

  test('25 — restoring a v1 file warns that newer training records will be cleared', async ({ page }) => {
    await seed(page, 2);
    await openData(page);
    let msg = '';
    page.once('dialog', d => { msg = d.message(); d.dismiss(); });
    await page.locator('[data-backup-file]').setInputFiles(tmpFile('spc-v1-warn', JSON.stringify(v1Envelope())));
    await page.waitForTimeout(400);
    expect(msg).toMatch(/older backup/i);
    expect(msg).toMatch(/cleared/i);
    // A v2 file gets no such warning, because nothing is being dropped.
    const env = await exportViaUI(page);
    let msg2 = '';
    page.once('dialog', d => { msg2 = d.message(); d.dismiss(); });
    await page.locator('[data-backup-file]').setInputFiles(tmpFile('spc-v2-warn', JSON.stringify(env)));
    await page.waitForTimeout(400);
    expect(msg2).not.toMatch(/older backup/i);
  });
});

// ── the normal API is unchanged ───────────────────────────────────────────
test.describe('Backup v2 — the append-only API is not weakened by restore support', () => {
  test('26 — ledger and events still refuse put(), and no delete/clear is exposed', async ({ page }) => {
    await seed(page, 2);
    const r = await page.evaluate(async () => {
      const I = window.CoachIDB;
      const out = { errors: {} };
      for (const s of ['ledger', 'events']) {
        try { await I.put(s, { seq: 1, tampered: true }); out.errors[s] = 'RESOLVED'; }
        catch (e) { out.errors[s] = e.message; }
      }
      out.api = Object.keys(I).filter(k => typeof I[k] === 'function').sort();
      out.restoreIsSeparate = typeof I._restore === 'object' && typeof I._restore.replaceAll === 'function';
      return out;
    });
    expect(r.errors.ledger).toMatch(/append-only/);
    expect(r.errors.events).toMatch(/append-only/);
    // The public function surface adds only appendIfNone since Phase 2 — an
    // append with a uniqueness precondition, which can still only ever add a
    // row. The restore mechanism stays in its own namespace, off the normal API.
    expect(r.api).toEqual(['_applySchema', '_reset', 'allByIndex', 'append', 'appendIfNone',
      'count', 'get', 'init', 'open', 'put', 'status']);
    expect(r.api).not.toContain('delete');
    expect(r.api).not.toContain('clear');
    expect(r.restoreIsSeparate).toBe(true);
  });
});

// ── PWA / offline ─────────────────────────────────────────────────────────
test.describe('Backup v2 — PWA / offline', () => {
  test('27 — a full v2 export works OFFLINE', async ({ page, context }) => {
    await seed(page, 2);
    await populateDurable(page, 'offline');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForTimeout(600);
    await context.setOffline(true);
    await page.goto('index.html');
    const env = await exportViaUI(page);
    expect(env.formatVersion).toBe(2);
    expect(env.storage.stores.ledger.map(r => r.seq)).toEqual([1, 2, 7]);
    expect(env.storage.stores.artifacts.length).toBe(1);
    await context.setOffline(false);
  });

  test('28 — a full v2 round trip works OFFLINE', async ({ page, context }) => {
    await seed(page, 2);
    await populateDurable(page, 'original');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForTimeout(600);
    await context.setOffline(true);
    await page.goto('index.html');
    const env = await exportViaUI(page);
    await populateDurable(page, 'modified');
    await restoreViaUI(page, env);
    await page.waitForTimeout(700);
    expect((await readDurable(page)).stores.ledger[0].tag).toBe('original');
    await context.setOffline(false);
  });

  test('29 — the PWA update path still works and the cached shell has both modules', async ({ page }) => {
    await seed(page, 2);
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.unregister();
      const stale = await window.caches.open('skill-progression-coach-v17');
      await stale.put('./index.html', new Response('<html>stale</html>', { headers: { 'Content-Type': 'text/html' } }));
    });
    await page.reload();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForTimeout(800);
    const r = await page.evaluate(async () => {
      const keys = await window.caches.keys();
      const name = keys.find(k => k.indexOf('skill-progression-coach-') === 0);
      const cache = await window.caches.open(name);
      return {
        keys,
        hasIdb: !!(await cache.match('./idb.js', { ignoreSearch: true })),
        hasBackup: !!(await cache.match('./backup.js', { ignoreSearch: true })),
        hasContext: !!(await cache.match('./context.js', { ignoreSearch: true })),
        hasBundle: !!(await cache.match('./content/bundle-1.json', { ignoreSearch: true }))
      };
    });
    expect(r.keys).not.toContain('skill-progression-coach-v17');
    expect(r.keys).toContain('skill-progression-coach-v20');
    expect(r.hasIdb).toBe(true);
    expect(r.hasBackup).toBe(true);
    expect(r.hasContext).toBe(true);
    expect(r.hasBundle).toBe(true);
    await openData(page);
    await expect(page.locator('[data-backup-export]')).toBeVisible();
  });

  test('30 — restored data survives a reload, exactly as a real close/reopen would', async ({ page }) => {
    await seed(page, 2);
    await populateDurable(page, 'original');
    const env = await exportViaUI(page);
    await populateDurable(page, 'modified');
    await restoreViaUI(page, env);
    await page.waitForTimeout(700);
    await page.reload();
    await page.evaluate(async () => { await window.CoachIDB.init(); });
    const after = await readDurable(page);
    expect(after.stores.ledger[0].tag).toBe('original');
    expect(after.stores.ledger.map(r => r.seq)).toEqual([1, 2, 7]);
    expect(after.stores.contextPackages[0].contextId).toBe('ctx_1');
  });
});
