// Skill Progression Coach — raw data-safety backup / restore.
//
// This is a SAFETY MECHANISM, not a migration format: export/import capture
// the EXACT raw string under every protected key (8 spc_c_* in Store.KEYS,
// 2 spc_c_* outside it, 6 read-only legacy puc_*) and restore is a true
// snapshot — never a merge, never a translation of puc_* into spc_c_*.
//
// Part A exercises the pure module (backup.js) directly, the same way the
// rest of this suite unit-tests engine.js/week.js/daily.js. Part B drives the
// real Export/Restore UI in a page, including the confirm() dialog and the
// hidden file input.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const os = require('os');
const Backup = require('../backup.js');
const Store = require('../store.js');

const ROOT = path.join(__dirname, '..');
const SOURCE_FILES = [
  'app.js', 'store.js', 'week.js', 'daily.js', 'settings.js',
  'duration.js', 'adapt.js', 'data.js', 'engine.js', 'progress.js', 'backup.js'
];

// The same 16-key inventory the implementation plan's audit + this task's
// re-confirmation from source arrived at.
const EXPECTED_KEYS = [
  'spc_c_profile', 'spc_c_state', 'spc_c_sessions', 'spc_c_bench',
  'spc_c_settings', 'spc_c_plan', 'spc_c_templates', 'spc_c_adhoc',
  'spc_c_workout', 'spc_c_day',
  'puc_log', 'puc_plan', 'puc_settings', 'puc_session', 'puc_progression', 'puc_secondary'
];

// A tiny in-memory key/value store standing in for localStorage, with a
// getRaw/setRaw/removeRaw surface identical to what app.js wires up.
function memRaw(seed) {
  var m = Object.assign({}, seed || {});
  return {
    map: m,
    getRaw: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setRaw: function (k, v) { m[k] = v; },
    removeRaw: function (k) { delete m[k]; }
  };
}

// Backup v2 carries the durable IndexedDB stores alongside the localStorage
// keys. These pure tests exercise the localStorage half, so they pass an
// EMPTY-but-complete durable snapshot: exportAll deliberately refuses to build
// a partial envelope, which is itself asserted below.
function emptyStorage() {
  var stores = {};
  Backup.DURABLE_STORES.forEach(function (n) { stores[n] = []; });
  return { schemaVersion: Backup.STORAGE_SCHEMA_VERSION, stores: stores };
}

function validBackup(overrides) {
  var keys = {};
  EXPECTED_KEYS.forEach(function (k) { keys[k] = { present: false }; });
  var env = {
    format: Backup.FORMAT, formatVersion: Backup.FORMAT_VERSION, app: Backup.APP_ID,
    appVersion: '2026-07-22', exportedAt: '2026-09-14T00:00:00.000Z', keys: keys,
    storage: emptyStorage()
  };
  return Object.assign(env, overrides || {});
}

// ── Part A — pure module ────────────────────────────────────────────────

test.describe('backup.js — key inventory', () => {
  test('1 — the protected key list is exactly the 16 keys re-confirmed from source', () => {
    expect(Backup.PROTECTED_KEYS.slice().sort()).toEqual(EXPECTED_KEYS.slice().sort());
    expect(Backup.PROTECTED_KEYS.length).toBe(16);
  });

  test('registered inventory covers every Store.KEYS value and every LEGACY_KEYS value', () => {
    Object.keys(Store.KEYS).forEach(function (k) {
      expect(Backup.isProtectedKey(Store.KEYS[k]), Store.KEYS[k]).toBe(true);
    });
    Store.LEGACY_KEYS.forEach(function (k) {
      expect(Backup.isProtectedKey(k), k).toBe(true);
    });
    expect(Backup.isProtectedKey('spc_c_workout')).toBe(true);
    expect(Backup.isProtectedKey('spc_c_day')).toBe(true);
  });

  test('15 — coverage guard: scanning the current source finds no spc_c_* literal missing from PROTECTED_KEYS', () => {
    var found = new Set();
    SOURCE_FILES.forEach(function (f) {
      var text = fs.readFileSync(path.join(ROOT, f), 'utf8');
      var re = /spc_c_[a-zA-Z_]+/g, m;
      while ((m = re.exec(text))) found.add(m[0]);
    });
    var unregistered = Array.from(found).filter(function (k) { return !Backup.isProtectedKey(k); });
    expect(unregistered).toEqual([]);
    // sanity: the scan actually found something (it isn't silently matching nothing)
    expect(found.size).toBeGreaterThan(0);
  });

  test('15b — the SAME guard logic actually flags an unregistered spc_c_* key when one is introduced', () => {
    var syntheticSource = "var NEW_KEY = 'spc_c_totally_new_thing';";
    var found = new Set();
    var re = /spc_c_[a-zA-Z_]+/g, m;
    while ((m = re.exec(syntheticSource))) found.add(m[0]);
    var unregistered = Array.from(found).filter(function (k) { return !Backup.isProtectedKey(k); });
    expect(unregistered).toEqual(['spc_c_totally_new_thing']);
  });
});

test.describe('backup.js — export', () => {
  test('2 — export includes every protected existing key', () => {
    var r = memRaw({ spc_c_profile: '{"onboarded":true}', puc_log: '[1,2,3]' });
    var env = Backup.exportAll(r.getRaw, { storage: emptyStorage() });
    EXPECTED_KEYS.forEach(function (k) { expect(env.keys[k], k).toBeTruthy(); });
    expect(env.keys.spc_c_profile).toEqual({ present: true, value: '{"onboarded":true}' });
    expect(env.keys.puc_log).toEqual({ present: true, value: '[1,2,3]' });
    expect(env.keys.spc_c_bench).toEqual({ present: false });
  });

  test('3 — export preserves exact raw values (whitespace, unicode, odd JSON)', () => {
    var raw = '{"a":1,  "b":"  spaced  ","emoji":"💪","nested":[1,2,{"x":null}]}';
    var r = memRaw({ spc_c_sessions: raw });
    var env = Backup.exportAll(r.getRaw, { storage: emptyStorage() });
    expect(env.keys.spc_c_sessions.value).toBe(raw);
  });

  test('4 — export distinguishes a missing key from a key whose value is the string "null"', () => {
    var r = memRaw({ spc_c_state: 'null' }); // value IS the 4-char string "null"
    var env = Backup.exportAll(r.getRaw, { storage: emptyStorage() });
    expect(env.keys.spc_c_state).toEqual({ present: true, value: 'null' });
    expect(env.keys.spc_c_bench).toEqual({ present: false }); // truly absent
  });

  test('5 — export does not mutate storage', () => {
    var seed = { spc_c_profile: 'x', spc_c_plan: 'y' };
    var r = memRaw(seed);
    var before = Object.assign({}, r.map);
    Backup.exportAll(r.getRaw, { storage: emptyStorage() });
    expect(r.map).toEqual(before);
  });

  test('envelope carries format identifier, version, app id, and timestamp', () => {
    var r = memRaw({});
    var env = Backup.exportAll(r.getRaw, { appVersion: '2026-07-22', exportedAt: '2026-01-01T00:00:00.000Z', storage: emptyStorage() });
    expect(env.format).toBe('spc-backup');
    expect(env.formatVersion).toBe(2);
    expect(env.app).toBe('skill-progression-coach');
    expect(env.appVersion).toBe('2026-07-22');
    expect(env.exportedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

test.describe('backup.js — validation', () => {
  test('9 — an envelope for a different application is rejected', () => {
    var v = Backup.validateEnvelope(validBackup({ app: 'pullup-coach' }));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/different application/);
  });

  test('9b — an envelope with the wrong format identifier is rejected', () => {
    var v = Backup.validateEnvelope(validBackup({ format: 'something-else' }));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/format/);
  });

  test('10 — an unsupported backup version is rejected', () => {
    var v = Backup.validateEnvelope(validBackup({ formatVersion: 99 }));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/unsupported/i);
  });

  test('11 — an envelope containing an unapproved key is rejected', () => {
    var env = validBackup();
    env.keys.puc_secret_thing = { present: true, value: 'x' };
    var v = Backup.validateEnvelope(env);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/unexpected key/);
  });

  test('a partial key set (older/incomplete backup) is rejected, not silently accepted', () => {
    var env = validBackup();
    delete env.keys.spc_c_adhoc;
    var v = Backup.validateEnvelope(env);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/missing expected key/);
  });

  test('a malformed per-key record is rejected (present:true with no value; present:false with a value)', () => {
    var a = validBackup(); a.keys.spc_c_profile = { present: true };
    expect(Backup.validateEnvelope(a).ok).toBe(false);
    var b = validBackup(); b.keys.spc_c_profile = { present: false, value: 'x' };
    expect(Backup.validateEnvelope(b).ok).toBe(false);
  });

  test('8 — a non-object (e.g. what a failed JSON.parse would never even produce, but null/array/string) is rejected', () => {
    expect(Backup.validateEnvelope(null).ok).toBe(false);
    expect(Backup.validateEnvelope(undefined).ok).toBe(false);
    expect(Backup.validateEnvelope([]).ok).toBe(false);
    expect(Backup.validateEnvelope('not an object').ok).toBe(false);
  });

  test('a fully valid envelope passes', () => {
    expect(Backup.validateEnvelope(validBackup()).ok).toBe(true);
  });
});

test.describe('backup.js — restore semantics', () => {
  test('6 — a valid backup restores every spc_c_* key to its exact recorded value', () => {
    var env = validBackup();
    env.keys.spc_c_profile = { present: true, value: '{"onboarded":true,"activeWorld":"muscleup"}' };
    env.keys.spc_c_plan = { present: true, value: '{"version":5}' };
    var r = memRaw({}); // starts empty
    Backup.restoreAll(env, r.getRaw, r.setRaw, r.removeRaw);
    expect(r.map.spc_c_profile).toBe('{"onboarded":true,"activeWorld":"muscleup"}');
    expect(r.map.spc_c_plan).toBe('{"version":5}');
  });

  test('7 — a valid backup restores protected puc_* keys under their OWN names, unmodified', () => {
    var env = validBackup();
    env.keys.puc_log = { present: true, value: '[{"date":"2026-01-01","reps":8}]' };
    var r = memRaw({});
    Backup.restoreAll(env, r.getRaw, r.setRaw, r.removeRaw);
    expect(r.map.puc_log).toBe('[{"date":"2026-01-01","reps":8}]');
    expect(r.map.spc_c_log).toBeUndefined(); // never translated into an spc_c_* key
  });

  test('restore removes protected keys that were recorded as absent in the snapshot', () => {
    var env = validBackup(); // everything present:false
    var r = memRaw({ spc_c_bench: 'stale', puc_progression: 'stale-too' });
    Backup.restoreAll(env, r.getRaw, r.setRaw, r.removeRaw);
    expect(r.map.spc_c_bench).toBeUndefined();
    expect(r.map.puc_progression).toBeUndefined();
  });

  test('restore rejects an invalid envelope and performs NO writes at all', () => {
    var env = validBackup({ app: 'other' });
    var r = memRaw({ spc_c_profile: 'keep-me' });
    var wrote = false;
    var spySet = function () { wrote = true; r.setRaw.apply(null, arguments); };
    expect(function () { Backup.restoreAll(env, r.getRaw, spySet, r.removeRaw); }).toThrow(/Backup rejected/);
    expect(wrote).toBe(false);
    expect(r.map.spc_c_profile).toBe('keep-me');
  });

  test('14 — a failing write mid-restore rolls back every protected key to its pre-image', () => {
    var env = validBackup();
    env.keys.spc_c_profile = { present: true, value: 'NEW' };
    env.keys.spc_c_plan = { present: true, value: 'NEW-PLAN' };
    var r = memRaw({ spc_c_profile: 'OLD', spc_c_plan: 'OLD-PLAN', spc_c_bench: 'OLD-BENCH' });
    var failOn = 'spc_c_plan'; // fails partway through the fixed key order
    var setRaw = function (k, v) { if (k === failOn) throw new Error('disk full'); r.setRaw(k, v); };
    expect(function () { Backup.restoreAll(env, r.getRaw, setRaw, r.removeRaw); }).toThrow(/Restore failed/);
    // rollback restored every key to what it was before restore started
    expect(r.map.spc_c_profile).toBe('OLD');
    expect(r.map.spc_c_plan).toBe('OLD-PLAN');
    expect(r.map.spc_c_bench).toBe('OLD-BENCH');
  });

  test('14b — the error message names the write failure and confirms the rollback succeeded', () => {
    var env = validBackup();
    env.keys.spc_c_profile = { present: true, value: 'NEW' }; // must be present:true, or setRaw is never called
    var r = memRaw({});
    var setRaw = function () { throw new Error('disk full'); };
    var thrown = null;
    try { Backup.restoreAll(env, r.getRaw, setRaw, r.removeRaw); }
    catch (e) { thrown = e; }
    expect(thrown).toBeTruthy();
    expect(thrown.message).toMatch(/disk full/);
    expect(thrown.message).toMatch(/previous data was restored/);
  });

  test('14c — when rollback itself partially fails, the error says exactly which keys could not be recovered', () => {
    var env = validBackup();
    env.keys.spc_c_profile = { present: true, value: 'NEW' };
    var r = memRaw({ spc_c_profile: 'OLD', spc_c_bench: 'OLD-BENCH' });
    var setRaw = function (k, v) {
      if (k === 'spc_c_profile') throw new Error('write blocked'); // primary write fails
      r.setRaw(k, v);
    };
    var origSet = r.setRaw;
    var rollbackSet = function (k, v) {
      if (k === 'spc_c_bench') throw new Error('rollback blocked for bench'); // rollback ALSO fails for one key
      origSet(k, v);
    };
    // First call fails the primary write; subsequent (rollback) calls use rollbackSet's behaviour.
    var calls = 0;
    var combined = function (k, v) {
      calls++;
      if (calls === 1) return setRaw(k, v);
      return rollbackSet(k, v);
    };
    expect(function () { Backup.restoreAll(env, r.getRaw, combined, r.removeRaw); }).toThrow(/Rollback ALSO failed for: spc_c_bench/);
  });
});

test.describe('backup.js — in-progress workout detection', () => {
  test('13 — a present, non-empty spc_c_workout means in progress', () => {
    var r = memRaw({ spc_c_workout: '{"type":"strength"}' });
    expect(Backup.hasInProgressState(r.getRaw)).toBe(true);
  });
  test('13b — an active daily queue (activeExId set) means in progress', () => {
    var r = memRaw({ spc_c_day: JSON.stringify({ activeExId: 'pullup', status: 'in_progress' }) });
    expect(Backup.hasInProgressState(r.getRaw)).toBe(true);
  });
  test('13c — an active ad-hoc queue means in progress', () => {
    var r = memRaw({ spc_c_adhoc: JSON.stringify({ status: 'in_progress' }) });
    expect(Backup.hasInProgressState(r.getRaw)).toBe(true);
  });
  test('13d — no workout key, no active day, no active adhoc → not in progress', () => {
    var r = memRaw({ spc_c_day: JSON.stringify({ status: 'not_started' }) });
    expect(Backup.hasInProgressState(r.getRaw)).toBe(false);
  });
  test('a completed (not in-progress) daily queue does not trigger the warning', () => {
    var r = memRaw({ spc_c_day: JSON.stringify({ status: 'completed', activeExId: null }) });
    expect(Backup.hasInProgressState(r.getRaw)).toBe(false);
  });
});

// ── Part B — real page, real UI ─────────────────────────────────────────

async function seedOnboarded(page) {
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
    S.setBench(bench);
    S.setState(state);
    S.setProfile({ onboarded: true, activeWorld: 'muscleup', days: [0, 2, 4], duration: 'normal' });
    // A recognisable puc_* value the app never writes, only reads — proves a
    // round trip preserves it untouched.
    localStorage.setItem('puc_log', JSON.stringify([{ date: '2026-01-01', reps: 7 }]));
  });
  await page.reload();
}

async function openDataSettings(page) {
  await page.locator('[data-s="profile"]').click();
  await page.locator('[data-sview="data"]').click();
}

test.describe('backup — Data settings UI', () => {
  test.beforeEach(async ({ page }) => { await seedOnboarded(page); });

  test('Export/Restore controls are present under Data & History', async ({ page }) => {
    await openDataSettings(page);
    await expect(page.locator('[data-backup-export]')).toBeVisible();
    await expect(page.locator('[data-backup-restore]')).toBeVisible();
  });

  test('round trip: export → change several values → restore → original state returns', async ({ page }) => {
    await openDataSettings(page);

    const before = await page.evaluate(() => ({
      profile: localStorage.getItem('spc_c_profile'),
      bench: localStorage.getItem('spc_c_bench'),
      pucLog: localStorage.getItem('puc_log')
    }));

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-backup-export]').click()
    ]);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const backupText = fs.readFileSync(filePath, 'utf8');
    const env = JSON.parse(backupText);
    expect(env.format).toBe('spc-backup');
    expect(env.keys.spc_c_profile.value).toBe(before.profile);

    // Change several things through normal app usage / direct edits.
    await page.evaluate(() => {
      const bench = JSON.parse(localStorage.getItem('spc_c_bench'));
      bench.pullup_max = 999;
      localStorage.setItem('spc_c_bench', JSON.stringify(bench));
      localStorage.setItem('spc_c_templates', JSON.stringify([{ id: 'temp-only' }]));
      localStorage.setItem('puc_log', JSON.stringify([{ date: '2099-01-01', reps: 1 }]));
    });

    // Restore from the exported file. A successful restore reloads the page
    // itself (app.js), so wait for that navigation rather than racing it.
    const tmp = path.join(os.tmpdir(), 'spc-restore-' + Date.now() + '.json');
    fs.writeFileSync(tmp, backupText);
    page.once('dialog', d => d.accept());
    await Promise.all([
      page.waitForEvent('load'),
      page.locator('[data-backup-file]').setInputFiles(tmp)
    ]);

    const after = await page.evaluate(() => ({
      profile: localStorage.getItem('spc_c_profile'),
      bench: localStorage.getItem('spc_c_bench'),
      templates: localStorage.getItem('spc_c_templates'),
      pucLog: localStorage.getItem('puc_log')
    }));
    expect(after.profile).toBe(before.profile);
    expect(after.bench).toBe(before.bench);
    expect(after.pucLog).toBe(before.pucLog); // puc_* restored under its own name, untranslated
    expect(after.templates).toBeNull(); // was absent at export time → removed by restore
    fs.unlinkSync(tmp);
  });

  test('12 — restoring asks for confirmation, and declining changes nothing', async ({ page }) => {
    await openDataSettings(page);
    const before = await page.evaluate(() => localStorage.getItem('spc_c_profile'));

    const env = validBackup();
    env.keys.spc_c_profile = { present: true, value: '{"onboarded":true,"activeWorld":"CHANGED"}' };
    const tmp = path.join(os.tmpdir(), 'spc-decline-' + Date.now() + '.json');
    fs.writeFileSync(tmp, JSON.stringify(env));

    let dialogSeen = false;
    page.once('dialog', d => { dialogSeen = true; d.dismiss(); });
    await page.locator('[data-backup-file]').setInputFiles(tmp);
    await page.waitForTimeout(300);
    expect(dialogSeen).toBe(true);
    const after = await page.evaluate(() => localStorage.getItem('spc_c_profile'));
    expect(after).toBe(before); // unchanged — restore was cancelled
    fs.unlinkSync(tmp);
  });

  test('13 — the confirmation explicitly warns when a workout is in progress', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('spc_c_workout', JSON.stringify({ type: 'strength', data: {} }));
    });
    await openDataSettings(page);

    const env = validBackup();
    const tmp = path.join(os.tmpdir(), 'spc-inprogress-' + Date.now() + '.json');
    fs.writeFileSync(tmp, JSON.stringify(env));

    let msg = '';
    page.once('dialog', d => { msg = d.message(); d.dismiss(); });
    await page.locator('[data-backup-file]').setInputFiles(tmp);
    await page.waitForTimeout(300);
    expect(msg).toMatch(/in-progress workout will be replaced/i);
    fs.unlinkSync(tmp);
  });

  test('no in-progress workout → the confirmation does not mention one', async ({ page }) => {
    await openDataSettings(page);
    const env = validBackup();
    const tmp = path.join(os.tmpdir(), 'spc-noprogress-' + Date.now() + '.json');
    fs.writeFileSync(tmp, JSON.stringify(env));

    let msg = '';
    page.once('dialog', d => { msg = d.message(); d.dismiss(); });
    await page.locator('[data-backup-file]').setInputFiles(tmp);
    await page.waitForTimeout(300);
    expect(msg).not.toMatch(/in-progress workout/i);
    fs.unlinkSync(tmp);
  });

  test('8 — a malformed (non-JSON) file is rejected before any dialog or write', async ({ page }) => {
    await openDataSettings(page);
    const before = await page.evaluate(() => localStorage.getItem('spc_c_profile'));
    const tmp = path.join(os.tmpdir(), 'spc-badjson-' + Date.now() + '.json');
    fs.writeFileSync(tmp, '{ this is not JSON');
    let dialogSeen = false;
    page.once('dialog', d => { dialogSeen = true; d.dismiss(); });
    await page.locator('[data-backup-file]').setInputFiles(tmp);
    await page.waitForTimeout(300);
    expect(dialogSeen).toBe(false); // never even reached confirmation
    await expect(page.locator('[data-backup-status]')).toContainText(/not valid JSON/i);
    const after = await page.evaluate(() => localStorage.getItem('spc_c_profile'));
    expect(after).toBe(before);
    fs.unlinkSync(tmp);
  });

  test('9 — a backup for a different app is rejected before any dialog or write', async ({ page }) => {
    await openDataSettings(page);
    const before = await page.evaluate(() => localStorage.getItem('spc_c_profile'));
    const env = validBackup({ app: 'pullup-coach' });
    const tmp = path.join(os.tmpdir(), 'spc-wrongapp-' + Date.now() + '.json');
    fs.writeFileSync(tmp, JSON.stringify(env));
    let dialogSeen = false;
    page.once('dialog', d => { dialogSeen = true; d.dismiss(); });
    await page.locator('[data-backup-file]').setInputFiles(tmp);
    await page.waitForTimeout(300);
    expect(dialogSeen).toBe(false);
    await expect(page.locator('[data-backup-status]')).toContainText(/not a valid Skill Progression Coach backup/i);
    const after = await page.evaluate(() => localStorage.getItem('spc_c_profile'));
    expect(after).toBe(before);
    fs.unlinkSync(tmp);
  });
});
