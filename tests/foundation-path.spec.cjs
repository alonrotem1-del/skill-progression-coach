// The Foundation Path in the running app: the Beginner Program as the home
// screen, real execution against the authored prescription, Max Tests, the SPC
// Foundation Exit and the minimum Academy. Needs the locally built program
// package (private/, git-ignored course content); skips without it.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const PKG_FILE = path.join(__dirname, '..', 'private', 'beginner-program.json');
const HAVE = fs.existsSync(PKG_FILE);
const pkg = HAVE ? JSON.parse(fs.readFileSync(PKG_FILE, 'utf8')) : null;
test.skip(!HAVE, 'program package not built on this machine');

const LEGACY_SESSION = [{ id: 'cs_legacy_1', kind: 'strength', templateId: 'pullup_ladder', date: '2026-10-01T10:00:00.000Z', exercises: [] }];

// The athlete who used the earlier app: a profile and history, no program state.
async function existingAthlete(page) {
  await page.goto('index.html');
  await page.evaluate((sessions) => {
    localStorage.clear();
    localStorage.setItem('spc_c_profile', JSON.stringify({ onboarded: true, activeWorld: 'muscleup', days: [0, 2, 4], duration: 'normal' }));
    localStorage.setItem('spc_c_sessions', JSON.stringify(sessions));
  }, LEGACY_SESSION);
  await page.reload();
  await expect(page.locator('.fp-node.current')).toBeVisible({ timeout: 15000 });
}
// Append athlete events the way the app does (through program.js), then reload.
async function addEvents(page, evs) {
  await page.evaluate((list) => {
    let s = JSON.parse(localStorage.getItem('spc_c_program'));
    list.forEach((e) => { s = window.CoachProgram.addEvent(s, e); });
    localStorage.setItem('spc_c_program', JSON.stringify(s));
  }, evs);
  await page.reload();
  await expect(page.locator('.fp-path, .fp-wh, .fp-runcard').first()).toBeVisible({ timeout: 15000 });
}
const required = (weekId, except) => pkg.weeks[weekId].workouts.filter((id) => !pkg.workouts[id].optional && id !== except)
  .map((id) => ({ type: 'workout_completed', workoutId: id, source: 'app', result: [] }));

test.describe('Foundation Path — first open', () => {
  test('01 the app opens on the Path with existing data intact, and no old dashboard', async ({ page }) => {
    await existingAthlete(page);
    expect(await page.locator('.nav button').allTextContents()).toEqual(['Path', 'Academy']);
    await expect(page.locator('[data-settings]')).toBeVisible();
    expect(await page.locator('.rec.sched, .today-grid, [data-startday]').count()).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('spc_c_sessions'))).toBe(JSON.stringify(LEGACY_SESSION));
  });

  test('02 the current position is Phase 4 Week 4; the four required Week 3 workouts are done, its Legs is not', async ({ page }) => {
    await existingAthlete(page);
    await expect(page.locator('.fp-head .fp-t')).toHaveText('Phase 4 · Week 4');
    await expect(page.locator('.fp-node.current')).toContainText('Week 4');
    await expect(page.locator('[data-node="P4W3"]')).toHaveClass(/done/);
    const row = (id) => page.locator('.fp-week [data-pw="' + id + '"]');
    for (const id of ['P4W4-1', 'P4W4-2', 'P4W4-3', 'P4W4-4']) await expect(row(id)).toContainText(/Next|Available/);
    await expect(row('P4W4-L')).toContainText('Optional');
    await expect(page.locator('.fp-week .fp-k')).toContainText('0 of 4 required done');
    await page.locator('[data-node="P4W3"]').click();
    const sheet = page.locator('.sheet');
    for (const id of ['P4W3-1', 'P4W3-2', 'P4W3-3', 'P4W3-4']) await expect(sheet.locator('[data-pw="' + id + '"]')).toContainText('Done');
    await expect(sheet.locator('[data-pw="P4W3-L"]')).not.toContainText('Done');
    const done = await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_program')).events.filter((e) => e.type === 'workout_completed'));
    expect(done.map((e) => e.workoutId)).toEqual(['P4W3-1', 'P4W3-2', 'P4W3-3', 'P4W3-4']);
    expect(done.every((e) => e.source === 'reported' && e.result === undefined)).toBe(true);   // no invented set data
  });

  test('03 earlier phases are placed past, not completed', async ({ page }) => {
    await existingAthlete(page);
    await expect(page.locator('.fp-placed')).toContainText('Placed past');
    await expect(page.locator('[data-node="P4W1"]')).toHaveClass(/placed/);
    expect(await page.locator('.fp-node.done').evaluateAll((els) => els.map((e) => e.dataset.node))).toEqual(['P4W3']);
  });
});

test.describe('Foundation Path — a workout', () => {
  test('04 a workout shows the source exercises in source order, with their prescription', async ({ page }) => {
    await existingAthlete(page);
    await page.locator('.fp-week [data-pw="P4W4-3"]').click();
    const w = pkg.workouts['P4W4-3'];
    const blocks = page.locator('.fp-block');
    await expect(blocks).toHaveCount(w.blocks.length);
    for (let i = 0; i < w.blocks.length; i++) {
      const b = w.blocks[i], t = await blocks.nth(i).innerText();
      const name = b.kind === 'emom' && b.style === 'single' ? b.exercise : b.easy;
      expect(t, 'row ' + (i + 1)).toContain(name.replace(/^Pyramid EMOM:\s*/, ''));
      if (b.kind === 'exercise') {
        expect(t).toContain(b.sets + ' sets × ' + (b.dose.min === b.dose.max ? b.dose.min : b.dose.min + '–' + b.dose.max));
      }
      if (b.kind === 'emom') expect(t).toContain('every minute');
    }
  });

  test('05 Easy and Hard stay two distinct exercises', async ({ page }) => {
    await existingAthlete(page);
    await page.locator('.fp-week [data-pw="P4W4-3"]').click();
    const first = page.locator('.fp-block').first();
    await expect(first).toContainText('Easy · Assisted Chin Ups');
    await expect(first).toContainText('Hard · Chin Ups');
  });

  test('06 results are entered, a value inside the range counts, below is kept, and a reload resumes', async ({ page }) => {
    await existingAthlete(page);
    await page.locator('.fp-week [data-pw="P4W4-3"]').click();
    await page.locator('[data-startpw]').click();
    // Set 1: 7 on a 6–8 prescription = inside the range.
    await page.locator('[data-inc="s0"]').click();           // starts at the bottom of the range (6)
    await page.locator('[data-inc="s0"]').click();           // 7
    await page.locator('[data-setdone="0"]').click();
    await expect(page.locator('.fp-set').first()).toContainText('in range');
    // Set 2: 5 = below the range.
    await page.locator('[data-inc="s1"]').click();
    await page.locator('[data-dec="s1"]').click();
    await page.locator('[data-setdone="1"]').click();
    await expect(page.locator('.fp-set').nth(1)).toContainText('below');
    await page.reload();
    await expect(page.locator('.fp-runcard')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.fp-set').first()).toContainText('7');
    await expect(page.locator('.fp-set').nth(1)).toContainText('5');
  });

  test('07 finishing keeps what happened, never the prescription, and survives a reload', async ({ page }) => {
    await existingAthlete(page);
    const pkgBefore = await page.evaluate(() => localStorage.getItem('spc_c_programpkg'));
    await page.locator('.fp-week [data-pw="P4W4-3"]').click();
    await page.locator('[data-startpw]').click();
    await page.locator('[data-inc="s0"]').click();
    await page.locator('[data-dec="s0"]').click();           // 5: below 6–8
    await page.locator('[data-setdone="0"]').click();
    page.on('dialog', (d) => d.accept());
    for (let i = 1; i < pkg.workouts['P4W4-3'].blocks.length; i++) await page.locator('[data-next]').click();
    await page.locator('[data-finishrun]').click();
    await expect(page.locator('.scr')).toContainText('Workout saved');
    await expect(page.locator('.scr')).toContainText('below');
    await page.reload();
    await expect(page.locator('.fp-week [data-pw="P4W4-3"]')).toContainText('Done', { timeout: 15000 });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_program')).events.filter((e) => e.workoutId === 'P4W4-3')[0]);
    expect(saved.result[0].sets[0].value).toBe(5);
    expect(saved.summary.blocks[0].outcome).toBe('below');
    expect(await page.evaluate(() => localStorage.getItem('spc_c_programpkg'))).toBe(pkgBefore);
    expect(await page.evaluate(() => localStorage.getItem('spc_c_programrun'))).toBe(null);
  });

  test('08 the optional leg session stays optional', async ({ page }) => {
    await existingAthlete(page);
    await page.locator('.fp-week [data-pw="P4W4-L"]').click();
    await expect(page.locator('.fp-wh')).toContainText('Optional session');
    await page.locator('[data-backpath]').click();
    await addEvents(page, required('P4W4'));
    await expect(page.locator('.fp-node.current')).toContainText('Max Test');
  });
});

test.describe('Foundation Path — Max Test, Foundation Exit, Academy', () => {
  test('09 the Max Test comes after Week 4, records results, passes nothing, and is kept', async ({ page }) => {
    await existingAthlete(page);
    await addEvents(page, required('P4W4'));
    await expect(page.locator('.fp-node.current')).toContainText('Max Test');
    await page.locator('.fp-node.current').click();
    const fams = page.locator('[data-fam]');
    await expect(fams).toHaveCount(5);
    expect(await fams.evaluateAll((els) => els.map((e) => e.dataset.fam))).toEqual(['hang', 'pull', 'push', 'dip', 'plank']);
    const pull = page.locator('[data-fam="pull"]');
    await pull.locator('[data-variant]').selectOption('Pull Ups');
    await pull.locator('[data-grip]').selectOption('overhand');
    await pull.locator('[data-val]').fill('7');
    await pull.locator('[data-valid]').check();
    for (const f of ['hang', 'push', 'dip', 'plank']) await page.locator('[data-fam="' + f + '"] [data-nt]').check();
    await page.locator('[data-mtsave]').click();
    await expect(page.locator('.fp-node.current')).toContainText('Deload', { timeout: 15000 });
    await page.reload();
    const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_program')).events.filter((e) => e.type === 'maxtest_recorded'));
    expect(rec.length).toBe(1);
    expect(rec[0].nodeId).toBe('MT4');
    expect(rec[0].results.find((r) => r.family === 'pull')).toMatchObject({ variant: 'Pull Ups', value: 7, grip: 'overhand', valid: true });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_program')).events.some((e) => e.type === 'foundation_exit_passed'))).toBe(false);
  });

  test('10 the end of Phase 6 leads to the Foundation Exit, not into the Academy', async ({ page }) => {
    await existingAthlete(page);
    let evs = required('P4W4').concat([{ type: 'maxtest_recorded', nodeId: 'MT4', results: [] }]);
    for (const p of [5, 6]) {
      evs.push({ type: 'deload_completed', nodeId: 'P' + p + 'D' });
      for (let w = 1; w <= 4; w++) evs = evs.concat(required('P' + p + 'W' + w));
      evs.push({ type: 'maxtest_recorded', nodeId: 'MT' + p, results: [] });
    }
    await addEvents(page, evs);
    await expect(page.locator('.fp-node.current')).toContainText('Foundation Exit');
    await page.locator('.nav [data-s="academy"]').click();
    await expect(page.locator('.scr')).toContainText('Opens after the Foundation Exit');
  });

  test('11 the Academy opens only when all six Foundation domains pass; Ring Muscle-Up then needs 6 + 6', async ({ page }) => {
    await existingAthlete(page);
    await page.evaluate(() => window.CoachApp._goto('pexit'));
    async function record(test, values) {
      await page.locator('[data-rectest="' + test + '"]').first().click();
      const sheet = page.locator('.sheet');
      for (const [k, v] of Object.entries(values)) await sheet.locator('[data-tv="' + k + '"]').fill(String(v));
      for (const c of await sheet.locator('[data-vchk]').all()) await c.check();
      await sheet.locator('[data-savetest]').click();
    }
    await record('pullup', { value: 5 });
    await record('pushup', { value: 15 });
    await record('pbdip', { value: 5 });
    await record('deadhang', { value: 30 });
    await record('forearmplank', { value: 60 });
    await page.locator('.nav [data-s="academy"]').click();
    await expect(page.locator('.scr')).toContainText('5 of 6 domains passed');
    await page.evaluate(() => window.CoachApp._goto('pexit'));
    await record('legs', { squats: 12, lungeR: 8, lungeL: 8 });
    await expect(page.locator('.scr')).toContainText('The Academy is open');
    await page.locator('[data-goacademy]').click();
    const goal = (label) => page.locator('.fp-goal', { hasText: label });
    await expect(goal('Pistol Squat')).toContainText('Open');
    await expect(goal('Ring Muscle-Up')).toContainText('Entry check needed');
    await record('pullup', { value: 6 });
    await record('pbdip', { value: 6 });
    await expect(goal('Ring Muscle-Up')).toContainText('Open');
    await expect(goal('Ring Muscle-Up')).toContainText('still being finalized');
  });

  test('12 the program data is part of every backup', async ({ page }) => {
    await existingAthlete(page);
    const keys = await page.evaluate(() => window.CoachBackup.PROTECTED_KEYS);
    expect(keys).toEqual(expect.arrayContaining(['spc_c_program', 'spc_c_programrun', 'spc_c_programpkg', 'spc_c_programvariants']));
  });
});

test.describe('Foundation Path — a normal workout set as Foundation evidence', () => {
  // Week 4, Workout 2 (Push) opens with Assisted Dips (Easy) / Dips (Hard), 8–10 reps.
  async function dipsWorkout(page, variant, clicks) {
    await page.locator('.fp-week [data-pw="P4W4-2"]').click();
    await page.locator('[data-startpw]').click();
    await page.locator('[data-var="' + variant + '"]').click();
    for (let k = 0; k < clicks; k++) await page.locator('[data-inc="s0"]').click();   // the first tap sets 8, each next one adds 1
    await page.locator('[data-setdone="0"]').click();
    for (let i = 1; i < pkg.workouts['P4W4-2'].blocks.length; i++) await page.locator('[data-next]').click();
    await page.locator('[data-finishrun]').click();
    await expect(page.locator('.scr')).toContainText('Workout saved');
  }
  async function answer(page, fields) {
    await page.locator('.fp-evbox [data-evset]').first().click();
    const sheet = page.locator('.sheet');
    for (const [k, v] of Object.entries(fields)) await sheet.locator('[data-cf="' + k + '"]').selectOption(v);
    for (const c of await sheet.locator('[data-vchk]').all()) await c.check();
    await sheet.locator('[data-evsave]').click();
  }

  test.beforeEach(async ({ page }) => { page.on('dialog', (d) => d.accept()); });   // "finish anyway?" for the skipped blocks

  test('13 8 clean parallel-bar dips in a workout satisfy F3 once confirmed; no separate test is asked for', async ({ page }) => {
    await existingAthlete(page);
    await dipsWorkout(page, 'hard', 1);
    await expect(page.locator('.fp-evbox')).toContainText('Dips · 8 reps');
    await expect(page.locator('.fp-evbox')).toContainText('F3');
    await answer(page, { apparatus: 'parallel-bars', assistance: 'none' });
    await expect(page.locator('.fp-evbox')).toContainText('Counts for F3');
    await page.evaluate(() => window.CoachApp._goto('pexit'));
    const f3 = page.locator('.fp-dom', { hasText: 'F3' });
    await expect(f3).toContainText('Passed');
    await expect(f3).toContainText('workout · Dips, set 1');
    await expect(f3.locator('[data-rectest]')).toHaveCount(0);
    const evs = await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_program')).events);
    const conf = evs.find((e) => e.type === 'evidence_confirmed');
    expect(conf).toMatchObject({ test: 'pbdip', block: 0, index: 0, apparatus: 'parallel-bars', assistance: 'none', valid: true, assessor: 'self' });
    expect(conf).not.toHaveProperty('value');
    expect(evs.find((e) => e.id === conf.workoutEventId).result[0].sets[0].value).toBe(8);   // read from the workout, once
  });

  test('14 assisted dips are never offered; dips on two chairs are kept as answered but do not count', async ({ page }) => {
    await existingAthlete(page);
    await dipsWorkout(page, 'easy', 3);                       // Assisted Dips, 10
    await expect(page.locator('.fp-evbox')).toHaveCount(0);
    await existingAthlete(page);
    await dipsWorkout(page, 'hard', 2);                       // Dips, 9
    await answer(page, { apparatus: 'two-chairs', assistance: 'none' });
    await expect(page.locator('.fp-evbox')).toContainText('Not counted: not the same test as F3');
    await page.evaluate(() => window.CoachApp._goto('pexit'));
    await expect(page.locator('.fp-dom', { hasText: 'F3' })).toContainText('No result yet');
    await expect(page.locator('.fp-dom', { hasText: 'F3' }).locator('[data-evset]')).toHaveCount(0);   // answered: not offered again
  });
});

test.describe('Foundation Path — deload week', () => {
  test('15 the deload week shows the program\'s guidance, and one tap completes it as a planned recovery week', async ({ page }) => {
    await existingAthlete(page);
    await addEvents(page, required('P4W4').concat([{ type: 'maxtest_recorded', nodeId: 'MT4', results: [] }]));
    await expect(page.locator('.fp-node.current')).toContainText('Deload');
    await page.locator('.fp-node.current').click();
    const scr = page.locator('.scr');
    await expect(scr).toContainText('From the program');
    await expect(scr).toContainText('50%');
    for (const t of pkg.deload.text) await expect(scr).toContainText(t.replace(/^-\s*/, '').replace(/\s+/g, ' ').trim());
    await expect(scr.locator('.fp-ul li')).toHaveCount(pkg.deload.text.filter((t) => /^-/.test(t)).length);
    await page.locator('[data-deloaddone]').click();
    await expect(page.locator('.fp-node.current')).toContainText('Week 1');
    await expect(page.locator('[data-node="P5D"]')).toContainText('recovery week done');
    const ev = await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_program')).events.find((e) => e.type === 'deload_completed'));
    expect(ev).toMatchObject({ nodeId: 'P5D', kind: 'planned-recovery' });
    await page.evaluate(() => window.CoachApp._goto('history'));
    await expect(page.locator('.scr')).toContainText('Planned recovery week, completed');
  });
});

test.describe('Foundation Path — no hosting dependency', () => {
  test.use({ serviceWorkers: 'block' });   // every request is then seen, and blocked, by the route below
  test('16 with the private folder unreachable, importing the program file once is enough, and nothing goes to another host', async ({ page }) => {
    const elsewhere = [];
    page.on('request', (r) => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') elsewhere.push(r.url()); });
    await page.route('**/private/**', (r) => r.fulfill({ status: 404, body: 'not here' }));
    await page.goto('index.html');
    await page.evaluate((sessions) => {
      localStorage.clear();
      localStorage.setItem('spc_c_profile', JSON.stringify({ onboarded: true, activeWorld: 'muscleup', days: [0, 2, 4], duration: 'normal' }));
      localStorage.setItem('spc_c_sessions', JSON.stringify(sessions));
    }, LEGACY_SESSION);
    await page.reload();
    await expect(page.locator('.fp-empty')).toContainText('not installed', { timeout: 15000 });
    await page.locator('[data-goprog]').click();
    await page.locator('[data-pkgfile]').setInputFiles(PKG_FILE);
    await expect(page.locator('.scr')).toContainText(pkg.title);
    await page.evaluate(() => window.CoachApp._goto('path'));
    await expect(page.locator('.fp-head .fp-t')).toHaveText('Phase 4 · Week 4');
    await page.reload();                                      // from the copy on the device; private/ still unreachable
    await expect(page.locator('.fp-head .fp-t')).toHaveText('Phase 4 · Week 4', { timeout: 15000 });
    expect(elsewhere).toEqual([]);
  });
});

test.describe('Foundation Path — EMOM in the runner', () => {
  // Week 4, Workout 3 (Pull), block 5: EMOM Pull Ups, 3–5 reps every minute, 12 minutes.
  async function toEmom(page) {
    await page.locator('.fp-week [data-pw="P4W4-3"]').click();
    await page.locator('[data-startpw]').click();
    for (let i = 0; i < 4; i++) await page.locator('[data-next]').click();
    await expect(page.locator('.fp-runcard h2')).toHaveText('Pull Ups');
  }

  test('17 an EMOM starts from a base — minutes and reps each — and any minute can be changed afterwards', async ({ page }) => {
    await existingAthlete(page);
    await toEmom(page);
    await expect(page.locator('[data-useplan]')).toHaveText('Start: 12 × 3');   // the bottom of the prescription
    await page.locator('[data-dec="pm"]').click();                               // 11 minutes
    await page.locator('[data-inc="pr"]').click();                               // 4 reps
    await page.locator('[data-useplan]').click();
    await expect(page.locator('.fp-set.done')).toHaveCount(11);
    await page.locator('[data-dec="m1"]').click();                               // minute 2 went to 3
    await page.locator('[data-delmin]').click();                                 // one minute fewer
    await page.locator('[data-addmin]').click();                                 // and back: a new minute copies the last one
    await page.locator('[data-delmin]').click();
    const run = await page.evaluate(() => JSON.parse(localStorage.getItem('spc_c_programrun')).blocks[4]);
    expect(run.minutes).toEqual([4, 3, 4, 4, 4, 4, 4, 4, 4, 4]);
    expect(run.plan).toBeUndefined();
    await expect(page.locator('[data-useplan]')).toHaveCount(0);
  });

  test('18 the EMOM clock ticks on the last 3 seconds of each minute, then beeps', async ({ page }) => {
    // A stand-in for the speaker: records every tone the app plays.
    await page.addInitScript(() => {
      window.__tones = [];
      const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
      class Ctx {
        constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
        resume() {}
        createGain() { return { gain: param(), connect() {} }; }
        createOscillator() {
          const f = {}; Object.defineProperty(f, 'value', { set: (v) => window.__tones.push(v), get: () => 0 });
          return { frequency: f, type: '', connect() {}, start() {}, stop() {} };
        }
      }
      window.AudioContext = Ctx; window.webkitAudioContext = Ctx;
    });
    await page.clock.install();
    await existingAthlete(page);
    await toEmom(page);
    await page.locator('[data-useplan]').click();
    await page.evaluate(() => { window.__tones = []; });
    await page.locator('[data-clock]').click();
    await page.clock.runFor(56000);
    expect(await page.evaluate(() => window.__tones)).toEqual([]);
    await page.clock.runFor(4000);                                               // seconds 57, 58, 59, then the new minute
    expect(await page.evaluate(() => window.__tones)).toEqual([440, 440, 440, 660, 770, 880]);
  });
});
