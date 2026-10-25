#!/usr/bin/env node
/*
 * Proves that a built Beginner Program package matches its source.
 *
 *   node tools/verify-program.cjs <path-to-master.md> [package.json]
 *
 * Independent of the builder: it re-reads the master, takes the chapter's own
 * "Phase N at a glance" tables (a separate rendering of the same 120 table
 * images) and compares every row, week and value with the package. It also
 * checks the program's shape (6 phases, 24 weeks, 4 required + 1 optional
 * workout per week, deloads before Phases 4–6, a Max Test before Phase 1 and
 * after each phase), the source fingerprint, and that every row's recorded
 * master line really holds that exercise. Exit code 0 only when all pass.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const master = process.argv[2];
const pkgFile = process.argv[3] || path.join(__dirname, '..', 'private', 'beginner-program.json');
if (!master) { console.error('usage: node tools/verify-program.cjs <master.md> [package.json]'); process.exit(2); }

const text = fs.readFileSync(master, 'utf8');
const L = text.split(/\r?\n/);
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
const failures = [];
const passed = [];
function check(name, ok, detail) { (ok ? passed : failures).push(name + (ok || !detail ? '' : ' — ' + detail)); }
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();

// ---- source fingerprint ----
const md5 = crypto.createHash('md5').update(text).digest('hex');
check('source fingerprint matches (md5 ' + md5 + ')', pkg.source.md5 === md5, 'package built from ' + pkg.source.md5);

// ---- shape ----
const W = pkg.workouts;
const all = Object.values(W);
const phases = [...new Set(all.map(w => w.phase))].sort();
check('6 phases', phases.join() === '1,2,3,4,5,6', phases.join());
check('24 weeks', Object.keys(pkg.weeks).length === 24, Object.keys(pkg.weeks).length);
check('96 required workouts', all.filter(w => !w.optional).length === 96, all.filter(w => !w.optional).length);
check('24 optional leg sessions', all.filter(w => w.optional).length === 24 && all.filter(w => w.optional).every(w => w.slot === 'L' && /^Legs - Optional/.test(w.title)));
Object.values(pkg.weeks).forEach(wk => {
  const slots = wk.workouts.map(id => W[id].slot).join(',');
  check('week ' + wk.id + ' has Workouts 1–4 + optional legs', slots === '1,2,3,4,L', slots);
});
const split = p => p <= 3 ? ['Push & Pull', 'Push & Pull', 'Push & Pull', 'Core & Stability'] : ['Push & Pull', 'Push', 'Pull', 'Core & Stability'];
all.filter(w => !w.optional).forEach(w => {
  const want = 'Workout ' + w.slot + ' - ' + split(w.phase)[w.slot - 1];
  if (w.title !== want) check('title of ' + w.id, false, w.title + ' (expected ' + want + ')');
});
check('workout titles follow the stated split (Phases 1–3 vs 4–6)', !failures.some(f => /^title of/.test(f)));
const seq = pkg.sequence.map(s => s.id).join(' ');
const wantSeq = ['MT0'];
for (let p = 1; p <= 6; p++) { if (p >= 4) wantSeq.push('P' + p + 'D'); for (let w = 1; w <= 4; w++) wantSeq.push('P' + p + 'W' + w); wantSeq.push('MT' + p); }
check('sequence: Max Test → phases in order, deload before Week 1 of Phases 4–6, Max Test after every phase', seq === wantSeq.join(' '), seq);
check('7 Max Test points', pkg.sequence.filter(s => s.type === 'maxtest').length === 7);
check('every workout, deload and Max Test has a source URL', all.every(w => /skool\.com/.test(w.url)) && pkg.sequence.filter(s => s.type !== 'week').every(s => /skool\.com/.test(s.url)));
check('Max Test families in source order: Hang, Pull, Push Up, Dips, Plank', pkg.maxTest.families.map(f => f.label).join() === 'Hang,Pull,Push Up,Dips,Plank');

// ---- every row's master line really holds it ----
function rows(w) {
  const out = [];
  w.blocks.forEach(b => { if (b.items) b.items.forEach(it => out.push({ b, it })); else out.push({ b, it: null }); });
  return out;
}
let badLines = 0;
all.forEach(w => rows(w).forEach(({ b, it }) => {
  const r = it || b; const src = L[r.line - 1] || '';
  if (src.indexOf('| ' + r.easy + ' |') !== 0) { badLines++; if (badLines < 5) check('line ' + r.line + ' holds ' + r.easy, false, src.slice(0, 80)); }
}));
check('every row points at its own master line', badLines === 0, badLines + ' rows');

// ---- compare with the independent at-a-glance tables ----
function cellOf(w, b, it) {
  if (b.kind === 'exercise') return b.raw.reps + ' × ' + b.raw.sets + ' · ' + b.raw.rest;
  if (b.kind === 'emom') return b.style === 'pyramid' ? b.rule : b.raw.reps + ' · EMOM ' + b.raw.time;
  if (b.kind === 'amrap') return it.dose.raw + ' (AMRAP ' + b.minutes + ' min)';
  if (b.kind === 'circuit' && w.format === 'circuit') return it.dose.raw + ' (' + b.rounds + ' rounds; ' + b.restRaw + ')';
  if (b.kind === 'circuit') return it.dose.raw + ' · ' + b.rounds + ' rounds (shared) · ' + b.restRaw;
  return '?';
}
// The at-a-glance tables write a name that changes during the phase as
// "Box Walk (Wk1) / Box walk to L-shape (Wk2–4)"; pick the name for this week.
function nameForWeek(cell, wk) {
  if (!/\(Wk/.test(cell)) return norm(cell);
  const parts = cell.split(/\s+\/\s+(?=[^/]*\(Wk)/);
  for (const p of parts) {
    const m = p.match(/^(.+?)\s*\(Wk(\d)(?:[–-](\d))?\)\s*$/);
    if (m && wk >= +m[2] && wk <= +(m[3] || m[2])) return norm(m[1]);
  }
  return norm(cell);
}
let compared = 0, mismatched = 0;
for (let i = 0; i < L.length; i++) {
  const m = L[i].match(/^### \d+\.1 Phase (\d) at a glance/);
  if (!m) continue;
  const p = +m[1];
  for (let k = i + 1; k < L.length && !/^### /.test(L[k]); k++) {
    const r = L[k].match(/^\| (Workout \d - [^|]+?|Legs - Optional) \| (\d+) \| (.+?) \| (.+?) \| (.+?) \| (.+?) \| (.+?) \| (.+?) \|$/);
    if (!r) continue;
    const slot = /^Legs/.test(r[1]) ? 'L' : +r[1].match(/^Workout (\d)/)[1];
    const n = +r[2];
    for (let wk = 1; wk <= 4; wk++) {
      const w = W['P' + p + 'W' + wk + '-' + slot];
      compared++;
      const row = w && rows(w)[n - 1];
      if (!row) { mismatched++; check('P' + p + 'W' + wk + '-' + slot + ' row ' + n + ' exists', false); continue; }
      const it = row.it || row.b;
      const easyOk = norm(it.easy) === nameForWeek(r[3], wk);
      const hardWant = r[4] === '—' ? '' : nameForWeek(r[4], wk);
      const hardOk = norm(it.hard || '') === hardWant;
      const want = norm(r[4 + wk]);
      const got = norm(cellOf(w, row.b, row.it));
      if (!easyOk || !hardOk || got !== want) {
        mismatched++;
        if (mismatched <= 12) check(w.id + ' row ' + n, false, 'package "' + it.easy + ' | ' + (it.hard || '—') + ' | ' + got + '" vs at-a-glance "' + r[3] + ' | ' + r[4] + ' | ' + want + '"');
      }
    }
  }
}
check('every value matches the at-a-glance tables (' + compared + ' week-cells compared)', mismatched === 0 && compared > 0, mismatched + ' mismatches');

// ---- counts that a reader can sanity-check ----
const exRows = all.reduce((a, w) => a + rows(w).length, 0);
const withHard = all.reduce((a, w) => a + rows(w).filter(({ b, it }) => (it || b).hard).length, 0);
const emoms = all.reduce((a, w) => a + w.blocks.filter(b => b.kind === 'emom').length, 0);
console.log('Beginner Program package verification');
console.log('  package: ' + pkgFile);
console.log('  rows: ' + exRows + ' (Easy+Hard pairs: ' + withHard + ', EMOM rows: ' + emoms + ', AMRAP days: ' + all.filter(w => w.format === 'amrap').length + ', circuit days: ' + all.filter(w => w.format === 'circuit' || w.format === 'rounds').length + ')');
console.log('  QA items attached: ' + pkg.qa.length);
passed.forEach(p => console.log('  ok   ' + p));
failures.forEach(f => console.log('  FAIL ' + f));
console.log(failures.length ? '\n' + failures.length + ' check(s) FAILED' : '\nALL ' + passed.length + ' CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
