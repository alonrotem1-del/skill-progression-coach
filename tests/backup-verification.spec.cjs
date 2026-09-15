// Skill Progression Coach — Phase 1 strongest-possible verification of
// backup.js / the Backup & Restore UI, BEFORE building Phase 2 on top of it.
//
// This file is additive to tests/backup.spec.cjs (36 tests, unchanged) and
// goes further in three ways that file does not:
//   1. It drives a REAL round trip through Week, Today, History, Progress and
//      Settings SCREENS (not just localStorage byte comparison), including an
//      in-progress workout that must resume correctly after restore+reload.
//   2. It exercises every Section-5 invalid-file case through the actual file
//      upload → validate → (never) confirm pipeline, not only the pure
//      validateEnvelope() function.
//   3. It exercises the rollback path through the REAL app (a monkey-patched
//      localStorage.setItem), confirming the UI surfaces the failure and
//      never reloads on a failed restore — on top of the pure-module rollback
//      tests already in backup.spec.cjs (tests 22–24), which this file does
//      not duplicate and were re-run unchanged as part of this verification.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
    // A recognisable puc_* value: never written by this app, only read.
    localStorage.setItem('puc_log', JSON.stringify([{ date: '2026-01-01', reps: 7 }]));
  });
  await page.reload();
}

async function runToFinishPanel(page) {
  for (let i = 0; i < 120; i++) {
    if (await page.locator('[data-finish],[data-finishex]').count()) return;
    if (await page.locator('[data-diff="appropriate"]').count()) { await page.locator('[data-diff="appropriate"]').first().click(); continue; }
    if (await page.locator('[data-pyrdiff="appropriate"]').count()) { await page.locator('[data-pyrdiff="appropriate"]').first().click(); continue; }
    if (await page.locator('[data-tskip]').count()) { await page.locator('[data-tskip]').first().click(); continue; }
    if (await page.locator('.cur-card [data-done]').count()) { await page.locator('.cur-card [data-done]').first().click(); continue; }
    await page.waitForTimeout(40);
  }
  throw new Error('runner never reached a finish panel');
}
// Complete one ad-hoc "Start One Exercise" workout end to end, all the way
// through to Save (an exercise not assigned to today's plan, so no
// overlap-classification sheet appears) — lands back on Today with nav.
async function finishOneExercise(page, exId) {
  await page.locator('.nav [data-s="today"]').click(); // callers may arrive from Week/Settings/etc.
  await page.locator('[data-startone]').click();
  await page.locator('[data-pick="' + exId + '"]').click();
  await runToFinishPanel(page);
  await page.locator('[data-finish],[data-finishex]').first().click();
  await expect(page.getByText('Exercise Complete')).toBeVisible();
  await page.locator('[data-finishday]').click();
  await expect(page.getByText('Workout Complete')).toBeVisible();
  await page.locator('[data-save]').click();
  await expect(page.locator('[data-s="today"]')).toBeVisible();
}

async function openEditPlan(page) {
  await page.locator('.nav [data-s="week"]').click();
  await page.locator('[data-editplan]').click();
}
async function toggleDayChip(page, exerciseName, dayId) {
  await page.locator('.ep-row', { hasText: exerciseName }).locator('[data-epday="' + dayId + '"]').click();
}
// The Week OVERVIEW screen's rendered text turns out to be insensitive to
// which extra day(s) an optional exercise like Toes-to-Bar is assigned to
// (confirmed by direct inspection — it renders each day's fixed primary
// session, not the full live-assignment list). Edit Plan's own row text IS
// sensitive to it ("Your plan: 2× — Sun, Tue, Fri" vs "…— Tue"), so that is
// the Week-area UI surface this verification actually reads.
async function editPlanRowText(page, exerciseName) {
  await openEditPlan(page);
  const text = await page.locator('.ep-row', { hasText: exerciseName }).innerText();
  await page.locator('[data-epcancel]').click(); // exits without re-saving
  return text;
}

const doneSetCount = (page) => page.evaluate(() => {
  const raw = localStorage.getItem('spc_c_workout'); if (!raw) return null;
  const w = JSON.parse(raw).data; const bl = w.blocks[0];
  return bl.sets.filter(s => s.doneFlag).length;
});

// ── 1. deployed-version cross-check is done via the GitHub API in the report
//    (this sandbox's egress proxy blocks the *.github.io Pages host itself —
//    see the final report for how deployment was confirmed instead). ───────

// ── 2/3/4. full round trip across Week, Today, History, Progress, Settings —
//    plus a SEPARATE, focused check that an in-progress workout round-trips
//    correctly — split into two phases for a concrete reason confirmed by
//    reading app.js: the strength runner (renderStrength) renders bare, with
//    NO nav bar, and boot() ALWAYS resumes an in-progress workout on any
//    reload (restoreWorkoutState() short-circuits before Today ever renders).
//    So there is no UI path from "mid-workout" to Settings/Week without
//    either finishing the exercise or tapping Cancel (which discards it) —
//    that is this app's real, deliberate design, not a test limitation. ────
test.describe('Phase 1 verification — full round trip (Week / History / Progress / Settings)', () => {
  test('Week, History, Progress and Settings all return to their exact pre-modification state', async ({ page }) => {
    await seed(page, 2); // Tuesday — triceps is not plan-assigned that day, so Start One Exercise has no overlap sheet

    // -- build recognisable BEFORE state ------------------------------------
    await openEditPlan(page);
    await toggleDayChip(page, 'Toes-to-Bar', 0); // t2b defaults to Tue/Fri; add Sunday too
    await page.locator('[data-epsave]').click();

    await finishOneExercise(page, 'triceps'); // → History entry + a bench-adjacent Progress change

    await page.locator('[data-s="profile"]').click();
    await page.locator('[data-sview="timer"]').click();
    await expect(page.locator('[data-tgl="sound"]')).toHaveAttribute('aria-checked', 'true'); // default
    await page.locator('[data-tgl="sound"]').click();
    await expect(page.locator('[data-tgl="sound"]')).toHaveAttribute('aria-checked', 'false');
    await page.locator('[data-sback]').click();

    // -- capture BEFORE snapshots (real rendered UI, not just storage) -----
    const weekBefore = await editPlanRowText(page, 'Toes-to-Bar');
    await page.locator('.nav [data-s="progress"]').click();
    const progressBefore = await page.locator('.scr').innerText(); // Progress screen embeds History
    const before = {
      week: weekBefore, progress: progressBefore,
      plan: await page.evaluate(() => localStorage.getItem('spc_c_plan')),
      sessions: await page.evaluate(() => localStorage.getItem('spc_c_sessions')),
      bench: await page.evaluate(() => localStorage.getItem('spc_c_bench')),
      settings: await page.evaluate(() => localStorage.getItem('spc_c_settings')),
      pucLog: await page.evaluate(() => localStorage.getItem('puc_log'))
    };

    // -- (A) export -------------------------------------------------------
    await page.locator('[data-s="profile"]').click();
    await page.locator('[data-sview="data"]').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-backup-export]').click()
    ]);
    const backupPath = await download.path(); // (B) preserved on disk for the restore step
    expect(backupPath).toBeTruthy();
    const backupText = fs.readFileSync(backupPath, 'utf8');
    await page.locator('[data-sback]').click(); // back to Settings home (settingsView persists across nav otherwise)

    // -- (C) modify state AFTER export, across the same areas -------------
    await openEditPlan(page);
    await toggleDayChip(page, 'Toes-to-Bar', 0); // undo the Sunday assignment
    await toggleDayChip(page, 'Toes-to-Bar', 5); // and drop the Friday one too
    await page.locator('[data-epsave]').click();

    await finishOneExercise(page, 'triceps'); // a SECOND History entry + bench change

    await page.locator('[data-s="profile"]').click();
    await page.locator('[data-sview="timer"]').click();
    await page.locator('[data-tgl="sound"]').click(); // flip back on
    await expect(page.locator('[data-tgl="sound"]')).toHaveAttribute('aria-checked', 'true');
    await page.locator('[data-sback]').click();

    // Confirm the state genuinely changed before we restore over it.
    expect(await editPlanRowText(page, 'Toes-to-Bar')).not.toBe(before.week);
    await page.locator('.nav [data-s="progress"]').click();
    expect(await page.locator('.scr').innerText()).not.toBe(before.progress);

    // -- (D) restore --------------------------------------------------------
    await page.locator('[data-s="profile"]').click();
    await page.locator('[data-sview="data"]').click();
    page.once('dialog', d => d.accept());
    await Promise.all([
      page.waitForEvent('load'), // a successful restore reloads the page itself
      page.locator('[data-backup-file]').setInputFiles(tmpFile('spc-roundtrip', backupText))
    ]);

    // -- (E) verify the app returns to the EXACT pre-modification snapshot,
    //    checked through the rendered UI, not only localStorage. ----------
    const after = {
      plan: await page.evaluate(() => localStorage.getItem('spc_c_plan')),
      sessions: await page.evaluate(() => localStorage.getItem('spc_c_sessions')),
      bench: await page.evaluate(() => localStorage.getItem('spc_c_bench')),
      settings: await page.evaluate(() => localStorage.getItem('spc_c_settings')),
      pucLog: await page.evaluate(() => localStorage.getItem('puc_log'))
    };
    expect(after.plan).toBe(before.plan);
    expect(after.sessions).toBe(before.sessions);
    expect(after.bench).toBe(before.bench);
    expect(after.settings).toBe(before.settings);
    expect(after.pucLog).toBe(before.pucLog);

    await page.locator('[data-s="profile"]').click();
    await page.locator('[data-sview="timer"]').click();
    await expect(page.locator('[data-tgl="sound"]')).toHaveAttribute('aria-checked', 'false'); // back to BEFORE
    await page.locator('[data-sback]').click();

    expect(await editPlanRowText(page, 'Toes-to-Bar')).toBe(before.week);

    await page.locator('.nav [data-s="progress"]').click();
    const progressAfter = await page.locator('.scr').innerText();
    expect(progressAfter).toBe(before.progress);
    // explicit, human-readable check: the SECOND triceps completion is gone
    expect((progressAfter.match(/Triceps/g) || []).length).toBe((before.progress.match(/Triceps/g) || []).length);

    // -- reload/persistence (Section 3) --------------------------------------
    await page.reload();
    expect(await editPlanRowText(page, 'Toes-to-Bar')).toBe(before.week);
    await page.locator('[data-s="profile"]').click();
    await page.locator('[data-sview="timer"]').click();
    await expect(page.locator('[data-tgl="sound"]')).toHaveAttribute('aria-checked', 'false');
  });

  test('in-progress warning: absent when there is nothing in progress', async ({ page }) => {
    await seed(page, 2);
    await page.locator('[data-s="profile"]').click();
    await page.locator('[data-sview="data"]').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-backup-export]').click()]);
    const text = fs.readFileSync(await download.path(), 'utf8');
    let msg = '';
    page.once('dialog', d => { msg = d.message(); d.dismiss(); });
    await page.locator('[data-backup-file]').setInputFiles(tmpFile('spc-noprogress', text));
    await page.waitForTimeout(300);
    expect(msg).not.toMatch(/in-progress workout/i);
  });

  test('in-progress warning: present when a workout is genuinely mid-flight', async ({ page }) => {
    // spc_c_workout is set the same way the runner itself persists it
    // (saveWorkoutState's exact shape), WITHOUT reloading — so nav stays
    // reachable to drive this check, exactly as backup.spec.cjs's equivalent
    // test already does; repeated here alongside the "absent" case for a
    // direct side-by-side comparison in this verification pass.
    await seed(page, 2);
    await page.evaluate(() => {
      localStorage.setItem('spc_c_workout', JSON.stringify({ type: 'strength', data: { templateId: 'ex_biceps', blocks: [] } }));
    });
    await page.locator('[data-s="profile"]').click();
    await page.locator('[data-sview="data"]').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-backup-export]').click()]);
    const text = fs.readFileSync(await download.path(), 'utf8');
    let msg = '';
    page.once('dialog', d => { msg = d.message(); d.dismiss(); });
    await page.locator('[data-backup-file]').setInputFiles(tmpFile('spc-inprogress', text));
    await page.waitForTimeout(300);
    expect(msg).toMatch(/in-progress workout will be replaced/i);
  });
});

// ── 2/3 continued — a genuinely mid-flight workout (real runner, real
//    localStorage) round-trips to its exact pre-modification snapshot, and
//    survives a reload. Per the note above, the runner has no nav, so the
//    export/restore steps here call the SAME PUBLIC functions the Export/
//    Restore buttons call (window.CoachBackup.exportAll/restoreAll) directly
//    against real browser localStorage while genuinely on the runner screen
//    — the identical code path, minus the button click the runner has no way
//    to reach. The button-click path itself is exercised exhaustively by
//    every other test in this file and in backup.spec.cjs. ────────────────
test.describe('Phase 1 verification — an in-progress workout round-trips correctly', () => {
  test('a real mid-workout snapshot survives export → further logging → restore → reload', async ({ page }) => {
    await seed(page, 2);
    await page.locator('[data-startone]').click();
    await page.locator('[data-pick="biceps"]').click();
    await page.locator('.cur-card [data-done]').first().click(); // 1 set done
    if (await page.locator('[data-diff="appropriate"]').count()) await page.locator('[data-diff="appropriate"]').first().click();
    expect(await doneSetCount(page)).toBe(1);
    await expect(page.locator('.scr')).toContainText('Biceps');

    // Export via the real functions, against real storage, at this exact
    // moment — including the durable snapshot the Export button now reads.
    const envelope = await page.evaluate(async () => {
      const storage = await window.CoachIDB._restore.snapshot();
      return window.CoachBackup.exportAll(k => localStorage.getItem(k), { storage });
    });
    expect(envelope.keys.spc_c_workout.present).toBe(true);
    expect(envelope.formatVersion).toBe(2);

    // Modify the in-progress workout further (still real UI, still the runner).
    await page.locator('.cur-card [data-done]').first().click();
    if (await page.locator('[data-diff="appropriate"]').count()) await page.locator('[data-diff="appropriate"]').first().click();
    expect(await doneSetCount(page)).toBe(2);

    // Restore via the real functions, against real storage, in the same order
    // importBackupFile uses — durable stores first, then localStorage — then
    // reload, exactly as the Restore button does on success.
    await page.evaluate(async (env) => {
      const I = window.CoachIDB, B = window.CoachBackup;
      const planned = B.plannedStores(env, { baselineAthleteRow: { id: I.ATHLETE_ID, storageSchemaVersion: I.SCHEMA_VERSION } });
      await I._restore.replaceAll(planned);
      B.restoreAll(env, k => localStorage.getItem(k), (k, v) => localStorage.setItem(k, v), k => localStorage.removeItem(k));
    }, envelope);
    await page.reload();

    // boot() resumes the workout automatically: same exercise, ORIGINAL
    // 1-set-done snapshot — not the 2-sets-done state created after export.
    await expect(page.locator('.scr')).toContainText('Biceps');
    expect(await doneSetCount(page)).toBe(1);

    // Reload again: persists.
    await page.reload();
    await expect(page.locator('.scr')).toContainText('Biceps');
    expect(await doneSetCount(page)).toBe(1);
  });
});

// ── 5. invalid-file safety, through the REAL upload pipeline. ─────────────
test.describe('Phase 1 verification — invalid file safety (UI level, before any write)', () => {
  const cases = [
    ['malformed JSON', '{ not json', /not valid JSON/i],
    ['unrelated JSON (valid JSON, wrong shape entirely)', JSON.stringify({ hello: 'world' }), /not a valid Skill Progression Coach backup/i],
    ['wrong format identifier', JSON.stringify(envelope({ format: 'something-else' })), /not a valid Skill Progression Coach backup/i],
    ['wrong app', JSON.stringify(envelope({ app: 'pullup-coach' })), /not a valid Skill Progression Coach backup/i],
    ['unsupported formatVersion', JSON.stringify(envelope({ formatVersion: 99 })), /not a valid Skill Progression Coach backup/i],
    ['missing a protected key', JSON.stringify(withMissingKey()), /not a valid Skill Progression Coach backup/i],
    ['unexpected extra key', JSON.stringify(withExtraKey()), /not a valid Skill Progression Coach backup/i]
  ];

  function ALL_KEYS() {
    return ['spc_c_profile', 'spc_c_state', 'spc_c_sessions', 'spc_c_bench', 'spc_c_settings', 'spc_c_plan',
      'spc_c_templates', 'spc_c_adhoc', 'spc_c_workout', 'spc_c_day',
      'puc_log', 'puc_plan', 'puc_settings', 'puc_session', 'puc_progression', 'puc_secondary'];
  }
  function envelope(overrides) {
    const keys = {}; ALL_KEYS().forEach(k => keys[k] = { present: false });
    return Object.assign({ format: 'spc-backup', formatVersion: 1, app: 'skill-progression-coach', exportedAt: 'x', keys }, overrides || {});
  }
  function withMissingKey() { const e = envelope(); delete e.keys.spc_c_adhoc; return e; }
  function withExtraKey() { const e = envelope(); e.keys.spc_c_unregistered = { present: false }; return e; }

  for (const [label, content, expectedMsg] of cases) {
    test(label + ' is rejected before any dialog or storage write', async ({ page }) => {
      await seed(page, 2);
      const before = await page.evaluate(() => localStorage.getItem('spc_c_profile'));
      let dialogSeen = false;
      page.once('dialog', d => { dialogSeen = true; d.dismiss(); });
      await page.locator('[data-s="profile"]').click();
      await page.locator('[data-sview="data"]').click();
      await page.locator('[data-backup-file]').setInputFiles(tmpFile('spc-invalid', content));
      await page.waitForTimeout(300);
      expect(dialogSeen, 'confirm() must never appear for an invalid file').toBe(false);
      await expect(page.locator('[data-backup-status]')).toContainText(expectedMsg);
      const after = await page.evaluate(() => localStorage.getItem('spc_c_profile'));
      expect(after, 'no storage mutation from a rejected file').toBe(before);
    });
  }
});

// ── 6. snapshot semantics, in a REAL browser localStorage (not the mock). ──
test.describe('Phase 1 verification — snapshot semantics (real localStorage)', () => {
  test('a raw value that IS the string "null" round-trips as that exact string, not as absence', async ({ page }) => {
    // spc_c_bench, not spc_c_state: Today's own render calls worldView(),
    // which — independently of backup.js — treats an empty/null-parsed
    // spc_c_state as "needs seeding" and immediately rewrites it (see
    // app.js WS()/worldView(), lines 109-132). That is a real, pre-existing,
    // and CORRECT resilience behavior of the app's own state layer, but it
    // would confound a test of backup.js's own byte-fidelity, which is what
    // this test is actually about. spc_c_bench has no such read-time
    // rewrite, so it isolates the property under test.
    await seed(page, 2);
    await page.evaluate(() => { localStorage.setItem('spc_c_bench', 'null'); }); // the 4-char string, not JSON null
    await page.locator('[data-s="profile"]').click();
    await page.locator('[data-sview="data"]').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-backup-export]').click()]);
    const env = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(env.keys.spc_c_bench).toEqual({ present: true, value: 'null' });

    await page.evaluate(() => { localStorage.setItem('spc_c_bench', '{"pullup_max":42}'); }); // change it post-export
    page.once('dialog', d => d.accept());
    await Promise.all([
      page.waitForEvent('load'),
      page.locator('[data-backup-file]').setInputFiles(tmpFile('spc-nullstring', JSON.stringify(env)))
    ]);
    const restored = await page.evaluate(() => localStorage.getItem('spc_c_bench'));
    expect(restored).toBe('null'); // the literal string, exactly — never parsed, never deleted
  });

  test('a key present on the device but recorded absent in the backup is REMOVED by restore', async ({ page }) => {
    await seed(page, 2);
    await page.locator('[data-s="profile"]').click();
    await page.locator('[data-sview="data"]').click();
    // Export while spc_c_templates is absent (fresh seed never set it).
    expect(await page.evaluate(() => localStorage.getItem('spc_c_templates'))).toBeNull();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-backup-export]').click()]);
    const text = fs.readFileSync(await download.path(), 'utf8');
    expect(JSON.parse(text).keys.spc_c_templates).toEqual({ present: false });

    // Now put something there AFTER export.
    await page.evaluate(() => { localStorage.setItem('spc_c_templates', JSON.stringify([{ id: 'should-be-removed' }])); });
    expect(await page.evaluate(() => localStorage.getItem('spc_c_templates'))).not.toBeNull();

    page.once('dialog', d => d.accept());
    await Promise.all([
      page.waitForEvent('load'),
      page.locator('[data-backup-file]').setInputFiles(tmpFile('spc-removal', text))
    ]);
    expect(await page.evaluate(() => localStorage.getItem('spc_c_templates'))).toBeNull();
  });
});

// ── 7. rollback through the REAL app (on top of the pure-module tests 22–24
//    already in backup.spec.cjs, which use the same injectable mechanism and
//    were re-run unchanged as part of this verification). ─────────────────
test.describe('Phase 1 verification — rollback surfaces through the real UI', () => {
  test('a write failure mid-restore is caught, rolled back as far as possible, and reported — with no reload', async ({ page }) => {
    await seed(page, 2);
    // Monkey-patch Storage.setItem BEFORE the app's own script runs, so both
    // backupSetRaw's primary write AND its rollback attempt see the failure
    // for one specific key — this is the "rollback also fails" case.
    await page.addInitScript(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === 'spc_c_plan') throw new Error('simulated disk-full');
        return orig.call(this, k, v);
      };
    });
    await page.reload();

    const beforeProfile = await page.evaluate(() => localStorage.getItem('spc_c_profile'));
    const beforePlanExisted = await page.evaluate(() => localStorage.getItem('spc_c_plan') !== null);

    const env = { format: 'spc-backup', formatVersion: 1, app: 'skill-progression-coach', exportedAt: 'x', keys: {} };
    ['spc_c_profile', 'spc_c_state', 'spc_c_sessions', 'spc_c_bench', 'spc_c_settings', 'spc_c_plan',
      'spc_c_templates', 'spc_c_adhoc', 'spc_c_workout', 'spc_c_day',
      'puc_log', 'puc_plan', 'puc_settings', 'puc_session', 'puc_progression', 'puc_secondary'
    ].forEach(k => { env.keys[k] = { present: false }; });
    env.keys.spc_c_profile = { present: true, value: '{"onboarded":true,"activeWorld":"CHANGED"}' };
    env.keys.spc_c_plan = { present: true, value: '{"version":999}' };

    let dialogSeen = false;
    page.once('dialog', d => { dialogSeen = true; d.accept(); });
    await page.locator('[data-s="profile"]').click();
    await page.locator('[data-sview="data"]').click();
    await page.locator('[data-backup-file]').setInputFiles(tmpFile('spc-rollback', JSON.stringify(env)));
    await page.waitForTimeout(400);

    expect(dialogSeen).toBe(true); // it validated fine and reached confirmation
    // Surfaced clearly, and no silent success message:
    await expect(page.locator('[data-backup-status]')).toContainText(/Restore failed/i);
    await expect(page.locator('[data-backup-status]')).toContainText(/simulated disk-full/i);

    // No reload happened — the page is still the Data settings screen we're on.
    await expect(page.locator('[data-backup-export]')).toBeVisible();

    // Every OTHER key was rolled back to its pre-restore value (profile write
    // succeeded during the primary pass, then was itself rolled back).
    expect(await page.evaluate(() => localStorage.getItem('spc_c_profile'))).toBe(beforeProfile);
    // spc_c_plan itself: rollback ALSO fails for it (same monkey-patch), so it
    // is left in whatever state the primary attempt left it in — but it must
    // NOT silently read as the malicious "version":999 value from the backup.
    const planAfter = await page.evaluate(() => localStorage.getItem('spc_c_plan'));
    expect(planAfter).not.toBe('{"version":999}');
    expect(planAfter !== null).toBe(beforePlanExisted); // presence unchanged either way
  });
});

// ── 8. service worker / offline. ───────────────────────────────────────────
test.describe('Phase 1 verification — service worker / offline availability', () => {
  test('backup.js is part of the cached shell after normal PWA caching', async ({ page }) => {
    await seed(page, 2);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForTimeout(600); // let install-time caching finish
    const cached = await page.evaluate(async () => {
      const keys = await window.caches.keys();
      const cacheName = keys.find(k => k.indexOf('skill-progression-coach-') === 0);
      const cache = await window.caches.open(cacheName);
      const match = await cache.match('./backup.js', { ignoreSearch: true });
      return { cacheName, hasBackup: !!match };
    });
    expect(cached.cacheName).toMatch(/skill-progression-coach-v18/);
    expect(cached.hasBackup).toBe(true);
  });

  test('Backup / Restore UI is present after a reload driven by the service worker', async ({ page }) => {
    await seed(page, 2);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await page.locator('[data-s="profile"]').click();
    await page.locator('[data-sview="data"]').click();
    await expect(page.locator('[data-backup-export]')).toBeVisible();
    await expect(page.locator('[data-backup-restore]')).toBeVisible();
  });

  test('the feature remains available OFFLINE after assets are cached, and Export still works', async ({ page, context }) => {
    await seed(page, 2);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForTimeout(600);
    await context.setOffline(true);
    await page.goto('index.html');
    await page.locator('[data-s="profile"]').click();
    await page.locator('[data-sview="data"]').click();
    await expect(page.locator('[data-backup-export]')).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-backup-export]').click()]);
    const text = fs.readFileSync(await download.path(), 'utf8');
    expect(JSON.parse(text).format).toBe('spc-backup');
    await context.setOffline(false);
  });

  test('a previous-version cache update deletes the old cache and does not leave a backup-less shell active', async ({ page }) => {
    await seed(page, 2); // an onboarded profile, so the app lands on Today (with nav) rather than onboarding
    // activate() only prunes caches DURING an activation. seed() already
    // completed one activation before this test runs, so a stale cache added
    // now would just sit there until the NEXT activation — it would not
    // (yet) prove anything. Unregister and re-register to force a fresh
    // install → activate that genuinely encounters the stale cache,
    // the same way a real athlete's browser encounters an old cache on the
    // release that first ships backup.js.
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.unregister();
      const stale = await window.caches.open('skill-progression-coach-v17');
      await stale.put('./index.html', new Response('<html>stale shell</html>', { headers: { 'Content-Type': 'text/html' } }));
    });
    await page.reload(); // index.html's inline script re-registers the SW → fresh install/activate
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForTimeout(800); // let activate() prune obsolete caches
    const keys = await page.evaluate(() => window.caches.keys());
    expect(keys).not.toContain('skill-progression-coach-v17');
    expect(keys).toContain('skill-progression-coach-v18');
    // The live page (this activation) still has the current Backup UI.
    await page.locator('[data-s="profile"]').click();
    await page.locator('[data-sview="data"]').click();
    await expect(page.locator('[data-backup-export]')).toBeVisible();
  });
});
