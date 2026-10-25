#!/usr/bin/env node
/*
 * Builds the Beginner Program package from the athlete's own private copy of
 * the Calixpert course extract (calixpert_protocols_master.md).
 *
 *   node tools/build-program.cjs <path-to-master.md> [out.json]
 *
 * The course content is third-party, paid material. The package is written to
 * private/ (git-ignored) and is never committed or deployed from this
 * repository; the app loads it from there locally, or the athlete imports it
 * on the device (Settings -> Program).
 *
 * The parser reads the per-lesson workout tables (the transcriptions of the
 * table images — the source of truth for every prescription), keeps every raw
 * cell next to its parsed value, and records the master line of every row.
 * Nothing is inferred: a value the source does not give is null, and every
 * documented ambiguity from the source's own QA sections is attached to the
 * item it concerns. tools/verify-program.cjs re-checks the result against the
 * independent "at a glance" tables of the same chapter.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BUILDER = 'tools/build-program.cjs v1';

function fail(msg) { console.error('build-program: ' + msg); process.exit(1); }

// ---------- small parsers (each keeps the raw text) ----------------------------
function restSeconds(cell) {
  const t = clean(cell);
  if (!t || t === '-' || /\(empty\)/.test(cell)) return null;
  const m = t.match(/^(\d+(?:[.,]\d+)?)\s*min/i);
  return m ? Math.round(parseFloat(m[1].replace(',', '.')) * 60) : null;
}
// Strip the transcriber's annotations ("*(one cell across ...)*") but keep the value.
function clean(cell) { return String(cell || '').replace(/\*\([^)]*\)\*/g, '').trim(); }
function isMergedMember(cell) { return /\*\(merged/.test(cell || ''); }
function spansBoth(cell) { return /\*\(spans Easy \+ Hard\)\*/.test(cell || ''); }

// "8-10", "15", "6-12 reps", "6-8 reps / leg", "6 Reps / Side", "10-20 sec",
// "8-12 sec/arm", "5-6/leg", "10/side", "6-8 sec/reps", "20 Reps", "30 sec".
function parseDose(cell) {
  const raw = clean(cell);
  const out = { raw: raw, min: null, max: null, unit: null, per: null, ambiguousUnit: false, unitWritten: false };
  const m = raw.match(/^(\d+)(?:\s*-\s*(\d+))?\s*(reps?|secs?)?\s*(?:\/\s*(leg|side|arm|position|reps))?$/i);
  if (!m) return out;
  out.min = +m[1]; out.max = m[2] ? +m[2] : +m[1];
  const unit = (m[3] || '').toLowerCase();
  const per = (m[4] || '').toLowerCase();
  if (unit.indexOf('sec') === 0) { out.unit = 'sec'; out.unitWritten = true; }
  else if (unit.indexOf('rep') === 0) { out.unit = 'reps'; out.unitWritten = true; }
  else out.unit = 'reps'; // a bare number in the Reps column
  if (per === 'reps') { out.unit = 'sec-or-reps'; out.ambiguousUnit = true; } // "6-8 sec/reps"
  else if (per) out.per = per;
  return out;
}
// EMOM time cell: "10 Min (1 min rounds)", "8 min", "8-10 min", "12 (no unit written)".
function parseMinutes(cell) {
  const raw = clean(cell);
  const m = raw.match(/^(\d+)(?:\s*-\s*(\d+))?\s*(min)?/i);
  if (!m) return { raw: raw, min: null, max: null, unitWritten: false };
  return { raw: raw, min: +m[1], max: m[2] ? +m[2] : +m[1], unitWritten: !!m[3] };
}
function splitOptions(name) { return name.split(/\s+\/\s+/).map(s => s.trim()).filter(Boolean); }

function emomOf(easy, hard) {
  const name = easy.replace(/^(Pyramid )?EMOM:\s*/i, '').trim();
  const pyramid = /^Pyramid EMOM:/i.test(easy);
  if (pyramid) return { style: 'pyramid', exercise: name, hardExercise: hard ? hard.replace(/^Pyramid EMOM:\s*/i, '').trim() : null };
  let m = name.match(/^Even minute = (.+?), Odd minute = (.+)$/i);
  if (m) return { style: 'alternating', parts: [{ minutes: 'odd', exercise: m[2].trim() }, { minutes: 'even', exercise: m[1].trim() }] };
  if (/^Min 1 -/i.test(name)) {
    const parts = name.split(/,\s*/).map(p => { const q = p.match(/^Min (\d+) - (.+)$/i); return q ? { minute: +q[1], exercise: q[2].trim() } : null; });
    if (parts.some(p => !p)) fail('unreadable EMOM cycle: ' + easy);
    return { style: 'cycle', parts: parts };
  }
  return { style: 'single', exercise: name, options: splitOptions(name) };
}

// ---------- source reading -----------------------------------------------------
function readChapter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => /^# Beginner Program\s*$/.test(l));
  const end = lines.findIndex((l, i) => i > start && /^# QA Annex/.test(l));
  if (start < 0 || end < 0) fail('Beginner Program chapter not found');
  return { text, lines, start, end };
}
function urlIn(line) { const m = line.match(/https:\/\/www\.skool\.com\/\S+?(?=[)\s]|$)/); return m ? m[0] : null; }
function tableRow(line) { return line.split('|').slice(1, -1).map(s => s.trim()); }

function main() {
  const file = process.argv[2];
  const out = process.argv[3] || path.join(__dirname, '..', 'private', 'beginner-program.json');
  if (!file) fail('usage: node tools/build-program.cjs <calixpert_protocols_master.md> [out.json]');
  const src = readChapter(file);
  const L = src.lines;
  const md5 = crypto.createHash('md5').update(src.text).digest('hex');
  const at = (i) => i + 1; // 1-based master line

  const pkg = {
    schema: 1,
    programId: 'calixpert-beginner',
    title: 'Beginner Program',
    publisher: 'Calixpert',
    source: { file: path.basename(file), md5: md5, lines: L.length - (L[L.length - 1] === '' ? 1 : 0), chapter: [at(src.start), at(src.end - 1)] },
    builtAt: new Date().toISOString(),
    builder: BUILDER,
    entry: null,
    formats: {},
    globalNotes: [],
    maxTest: null,
    deload: null,
    sequence: [],
    weeks: {},
    workouts: {},
    qa: []
  };

  // --- course url, entry line, written format definitions (section 1.4) ---
  for (let i = src.start; i < src.end; i++) {
    const l = L[i];
    if (!pkg.entry && /Start here if you can already do 1 pull-up and 5 push-ups/.test(l)) pkg.entry = { text: 'Start here if you can already do 1 pull-up and 5 push-ups.', line: at(i) };
    const fm = l.match(/^- (Workouts with a standard EMOM \(Phases 1–5\)|Phase 5 Workout 3 - Pull|Phase 6 Workout 1 - Push & Pull|Phase 6 Workout 2 - Push and Workout 3 - Pull|Phase 4–5 Workout 4 - Core & Stability) — "[^"]+": "(.+)"\s*$/);
    if (fm) {
      const key = /standard EMOM/.test(fm[1]) ? 'emom' : /Phase 5 Workout 3/.test(fm[1]) ? 'emom-alternating' : /Phase 6 Workout 1/.test(fm[1]) ? 'emom-cycle' : /Pyramid|Workout 2 - Push and/.test(fm[1]) ? 'emom-pyramid' : 'amrap';
      pkg.formats[key] = { text: fm[2], line: at(i) };
    }
    if (/^- Phase 6 Workout 4 - Core & Stability: the table header reads/.test(l)) pkg.formats['core-circuit'] = { text: l.replace(/^- /, ''), line: at(i) };
    if (/^- \*\*Easy \/ Hard columns:\*\*/.test(l)) pkg.globalNotes.push({ id: 'easy-hard', text: l.replace(/^- \*\*Easy \/ Hard columns:\*\*\s*/, ''), line: at(i) });
    if (/^- Which days of the week to train/.test(l)) pkg.globalNotes.push({ id: 'schedule', text: l.replace(/^- /, ''), line: at(i) });
    if (/^- Performance criteria for moving to the next week or phase/.test(l)) pkg.globalNotes.push({ id: 'advancement', text: l.replace(/^- /, ''), line: at(i) });
  }
  ['emom', 'emom-alternating', 'emom-cycle', 'emom-pyramid', 'amrap', 'core-circuit'].forEach(k => { if (!pkg.formats[k]) fail('format definition missing: ' + k); });

  // --- Max Test (2.2): url, families and their listed variations ---
  const mtStart = L.findIndex((l, i) => i > src.start && /^### 2\.2 Max Test/.test(l));
  if (mtStart < 0) fail('Max Test lesson not found');
  const mt = { url: null, line: at(mtStart), restMinMinutes: 2, order: ['hang', 'pull', 'push', 'dip', 'plank'], families: [], spareSlots: 2, notes: [] };
  const famCols = [];
  for (let i = mtStart + 1; i < src.end && !/^### /.test(L[i]); i++) {
    const l = L[i];
    if (!mt.url && /^- Source URL:/.test(l)) mt.url = urlIn(l);
    const r = l.match(/^\| (\d+) \|(.*)$/);
    if (r) {
      const cells = tableRow(l).slice(1); // B..H
      const rowNo = +r[1];
      if (rowNo === 6) cells.forEach((c, ci) => { if (c) famCols[ci] = { label: c, variants: [], line: at(i) }; });
      else if (rowNo >= 7 && rowNo <= 11) cells.forEach((c, ci) => { if (c && famCols[ci]) famCols[ci].variants.push(c); });
    }
    if (/Rest at least two minutes|at least two minutes of rest/.test(l)) mt.notes.push({ text: 'At least two minutes of rest between the five tests.', line: at(i) });
  }
  const famIds = { 'Hang': ['hang', 'sec'], 'Pull': ['pull', 'reps'], 'Push Up': ['push', 'reps'], 'Dips': ['dip', 'reps'], 'Plank': ['plank', 'sec'] };
  famCols.filter(Boolean).forEach(f => {
    const id = famIds[f.label]; if (!id) fail('unknown Max Test family: ' + f.label);
    mt.families.push({ id: id[0], label: f.label, unit: id[1], variants: f.variants, line: f.line });
  });
  if (mt.families.length !== 5) fail('expected 5 Max Test families, found ' + mt.families.length);
  pkg.maxTest = mt;

  // --- walk phases / weeks / workouts ---
  let phase = null, week = null, cur = null;
  const deloads = {}, endTests = {};
  function finishWorkout() { if (cur) { buildWorkout(cur); cur = null; } }
  for (let i = src.start; i < src.end; i++) {
    const l = L[i];
    let m = l.match(/^## (\d+)\. Phase (\d) \(folder\)/);
    if (m) { finishWorkout(); phase = +m[2]; week = null; continue; }
    m = l.match(/^### \d+\.\d+ Week (\d)\s*$/);
    if (m && phase) { finishWorkout(); week = +m[1]; const id = 'P' + phase + 'W' + week; pkg.weeks[id] = { id, phase, week, line: at(i), url: null, workouts: [] }; continue; }
    m = l.match(/^### \d+\.\d+ 🧘🏼DELOAD WEEK/);
    if (m && phase) { finishWorkout(); deloads[phase] = { line: at(i), url: null, scan: i }; week = null; continue; }
    m = l.match(/^### \d+\.\d+ 💪🏻Max Test \(end of Phase (\d)\)/);
    if (m) { finishWorkout(); endTests[+m[1]] = { line: at(i), url: null, scan: i }; week = null; continue; }
    m = l.match(/^#### (\d+\.\d+\.\d+) (.+?) — Phase (\d), Week (\d)\s*$/);
    if (m) { finishWorkout(); cur = { section: m[1], title: m[2], phase: +m[3], week: +m[4], line: at(i), body: [], bodyStart: i + 1 }; continue; }
    if (/^#{1,4} /.test(l)) { finishWorkout(); continue; }
    if (cur) cur.body.push(l);
    if (week && phase && /^- Week divider lesson:/.test(l)) pkg.weeks['P' + phase + 'W' + week].url = urlIn(l);
  }
  finishWorkout();
  [deloads, endTests].forEach(group => Object.values(group).forEach(d => {
    for (let k = d.scan + 1; k < d.scan + 12; k++) if (/^- Source URL:/.test(L[k])) { d.url = urlIn(L[k]); break; }
    delete d.scan;
  }));

  // deload lesson text (identical in Phases 4–6, stated by the source)
  const dl = deloads[4];
  if (!dl) fail('deload lesson not found');
  const dlText = [];
  for (let k = dl.line; k < dl.line + 30 && !/^### /.test(L[k]); k++) if (/^(A deload|This week|- Doing|- Or doing|- Or a mix|Think of this)/.test(L[k])) dlText.push(L[k].replace(/\*\*/g, ''));
  pkg.deload = { phases: Object.keys(deloads).map(Number), text: dlText, line: dl.line };

  function buildWorkout(w) {
    const slot = /^Legs - Optional/.test(w.title) ? 'L' : +((w.title.match(/^Workout (\d)/) || [])[1]);
    if (!slot) fail('unknown workout title ' + w.title);
    const id = 'P' + w.phase + 'W' + w.week + '-' + slot;
    const wk = { id, phase: w.phase, week: w.week, slot, optional: slot === 'L', title: w.title, section: w.section, line: w.line,
      url: null, video: null, image: null, header: null, format: 'sets', warmup: [], cooldown: null, blocks: [], qa: [], siteNotes: [] };
    let tableHeader = null, circuit = null, order = 0;
    w.body.forEach((l, k) => {
      const lineNo = w.bodyStart + k + 1;
      let m;
      if (/^- Source URL:/.test(l)) wk.url = urlIn(l);
      else if ((m = l.match(/^- Media on page: video ([\d:]+).*workout-table image "([^"]+)"/))) { wk.video = m[1]; wk.image = m[2]; }
      else if ((m = l.match(/^- Warm-up rows: (.+)$/))) wk.warmup = m[1].split(/;\s*/).map(s => { const p = s.split(/\s+—\s+/); return { name: p[0], note: p.length > 2 ? p[1] : null, dose: p[p.length - 1] }; });
      else if ((m = l.match(/^- Cooldown rows: "([^"]+)" — (.+?) — (.+)$/))) wk.cooldown = { label: m[1], name: m[2], dose: m[3] };
      else if ((m = l.match(/^- Section header: "(.+)"$/))) {
        wk.header = m[1];
        if (/^AMRAP/i.test(m[1])) { wk.format = 'amrap'; }
        else if (/^CORE CIRCUIT/i.test(m[1])) { wk.format = 'circuit'; }
      }
      else if (/^- Shown as done on the site/.test(l)) wk.siteNotes.push({ text: l.replace(/^- /, ''), line: lineNo });
      else if (/^\| ?(Easy|Exercise) \|/.test(l)) { tableHeader = tableRow(l); if (tableHeader[3] === 'Rounds') wk.format = 'rounds'; }
      else if (/^\|---/.test(l)) { /* separator */ }
      else if (/^\| /.test(l) && tableHeader) {
        const c = tableRow(l);
        if (wk.format === 'circuit') {
          if (/rest between rounds/i.test(c[0])) { circuit.restBetweenRoundsSec = restSeconds(c[0].replace(/rest between rounds.*$/i, '')); circuit.restRaw = clean(c[0]); return; }
          if (!circuit) { const rm = wk.header.match(/(\d+) ROUNDS/i); circuit = { kind: 'circuit', order: ++order, rounds: rm ? +rm[1] : null, restBetweenRoundsSec: null, restRaw: null, items: [], line: lineNo }; wk.blocks.push(circuit); }
          circuit.items.push({ order: circuit.items.length + 1, easy: c[0], hard: null, dose: parseDose(c[1]), line: lineNo });
          return;
        }
        if (wk.format === 'amrap') {
          if (!circuit) { const mm = wk.header.match(/(\d+)\s*MIN/i); circuit = { kind: 'amrap', order: ++order, minutes: mm ? +mm[1] : null, items: [], line: lineNo }; wk.blocks.push(circuit); }
          circuit.items.push({ order: circuit.items.length + 1, easy: c[0], hard: spansBoth(c[1]) ? null : c[1], dose: parseDose(c[2]), line: lineNo });
          return;
        }
        const easy = c[0], hard = spansBoth(c[1]) ? null : c[1];
        if (/^(Pyramid )?EMOM:/i.test(easy)) {
          const e = emomOf(easy, hard);
          const pyramid = e.style === 'pyramid';
          const blk = Object.assign({ kind: 'emom', order: ++order, easy: easy, hard: hard, line: lineNo,
            perMinute: pyramid ? null : parseDose(c[2]),
            minutes: pyramid ? null : parseMinutes(c[3]),
            rule: pyramid ? clean(c[2]) : null,
            raw: { reps: clean(c[2]), time: clean(c[3]) } }, e);
          wk.blocks.push(blk); circuit = null; return;
        }
        if (wk.format === 'rounds') {
          // A shared "Rounds" cell opens a circuit; "(merged ...)" rows belong to it.
          if (isMergedMember(c[3]) && circuit) { circuit.items.push({ order: circuit.items.length + 1, easy, hard, dose: parseDose(c[2]), line: lineNo }); return; }
          if (/one cell for the 3 rows/.test(c[3])) {
            circuit = { kind: 'circuit', order: ++order, rounds: +clean(c[3]) || null, restBetweenRoundsSec: restSeconds(c[4]), restRaw: clean(c[4]), items: [{ order: 1, easy, hard, dose: parseDose(c[2]), line: lineNo }], line: lineNo };
            wk.blocks.push(circuit); return;
          }
          circuit = null;
        }
        const sets = clean(c[3]);
        wk.blocks.push({ kind: 'exercise', order: ++order, easy, hard, line: lineNo, dose: parseDose(c[2]),
          sets: /^\d+$/.test(sets) ? +sets : null, setsLabel: tableHeader[3] === 'Rounds' ? 'rounds' : 'sets',
          restSec: restSeconds(c[4]), raw: { reps: clean(c[2]), sets: sets, rest: clean(c[4]) } });
      }
    });
    if (!wk.url) fail('no source URL for ' + id);
    if (!wk.blocks.length) fail('no table rows for ' + id);
    pkg.workouts[id] = wk;
    pkg.weeks['P' + w.phase + 'W' + w.week].workouts.push(id);
  }

  // --- sequence (source order): Max Test, Phases 1–6 (deload first in 4–6), Max Test after each phase ---
  pkg.sequence.push({ type: 'maxtest', id: 'MT0', point: 1, before: 1, url: mt.url, line: mt.line, label: 'Max Test' });
  for (let p = 1; p <= 6; p++) {
    if (deloads[p]) pkg.sequence.push({ type: 'deload', id: 'P' + p + 'D', phase: p, url: deloads[p].url, line: deloads[p].line, label: 'Deload week' });
    for (let w = 1; w <= 4; w++) { const id = 'P' + p + 'W' + w; if (!pkg.weeks[id]) fail('missing week ' + id); pkg.sequence.push({ type: 'week', id, phase: p, week: w }); }
    if (!endTests[p]) fail('missing end-of-phase Max Test for phase ' + p);
    pkg.sequence.push({ type: 'maxtest', id: 'MT' + p, point: p + 1, afterPhase: p, url: endTests[p].url, line: endTests[p].line, label: 'Max Test' });
  }

  attachQa(pkg, L, src);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(pkg, null, 1));
  // Remember where the source lives (private, git-ignored) so the verification
  // test can re-check the package against it without a hard-coded path.
  fs.writeFileSync(path.join(path.dirname(out), 'source.json'), JSON.stringify({ master: path.resolve(file), md5: md5 }, null, 1));
  const n = Object.values(pkg.workouts);
  console.log('wrote ' + out);
  console.log('  source md5 ' + md5 + ', ' + L.length + ' lines');
  console.log('  ' + Object.keys(pkg.weeks).length + ' weeks, ' + n.filter(x => !x.optional).length + ' required + ' + n.filter(x => x.optional).length + ' optional workouts, ' +
    pkg.sequence.filter(s => s.type === 'maxtest').length + ' Max Tests, ' + pkg.sequence.filter(s => s.type === 'deload').length + ' deload weeks, ' + pkg.qa.length + ' QA items');
}

// The source's own documented issues, attached to exactly the items they concern.
function attachQa(pkg, L, src) {
  const rows = {};
  const contra = L.findIndex((l, i) => i > src.start && /^## Beginner Program — Site Contradiction \/ Inconsistency/.test(l));
  const missing = L.findIndex((l, i) => i > src.start && /^## Beginner Program — Missing \/ Unverified Information/.test(l));
  if (contra < 0 || missing < 0) throw new Error('QA sections not found');
  for (let i = contra; i < missing; i++) {
    const m = L[i].match(/^\| (\d+) \| \*\*(.+?)\*\* \|/);
    if (m) { const c = tableRow(L[i]); rows['BP-' + m[1]] = { id: 'BP-' + m[1], kind: 'contradiction', topic: m[2], sourceA: c[2], sourceB: c[3], class: c[4], line: i + 1 }; }
  }
  for (let i = missing; i < src.end && !/^## Beginner Program Extraction/.test(L[i]); i++) {
    const m = L[i].match(/^\| (\d+) \| (.+?) \| (.+?) \| (.+) \|$/);
    if (m && /^\d+$/.test(m[1])) rows['MU-' + m[1]] = { id: 'MU-' + m[1], kind: 'missing', topic: m[2], expected: m[3], text: m[4], line: i + 1 };
  }
  const want = ['BP-2', 'BP-3', 'BP-4', 'BP-5', 'BP-6', 'BP-7', 'BP-8', 'BP-10', 'BP-11', 'MU-3', 'MU-4', 'MU-5', 'MU-7', 'MU-8', 'MU-9', 'MU-10', 'MU-11', 'MU-12', 'MU-14'];
  want.forEach(k => { if (!rows[k]) throw new Error('QA item missing in source: ' + k); pkg.qa.push(rows[k]); });

  const W = pkg.workouts;
  const each = (pred, fn) => Object.values(W).filter(pred).forEach(fn);
  const blockNamed = (w, re) => w.blocks.find(b => re.test(b.easy || '') || (b.items || []).some(it => re.test(it.easy)));
  function tag(w, id, blockRe) {
    w.qa.push(id);
    if (blockRe) { const b = blockNamed(w, blockRe); if (!b) throw new Error(id + ': no block ' + blockRe + ' in ' + w.id); (b.qa = b.qa || []).push(id); }
  }
  each(w => w.phase <= 3 && w.slot === 2 && /PUSH WORKOUT/.test(w.header), w => tag(w, 'BP-2'));
  each(w => w.phase === 3 && (w.slot === 1 || w.slot === 3), w => tag(w, 'BP-3', /^Assisted Dips$/));
  each(w => w.phase === 2 && w.slot === 4, w => tag(w, 'BP-4', /Reversed Plank/));
  each(w => w.phase === 6 && w.slot === 1, w => tag(w, 'BP-5', /Jumping Muscle Up/));
  each(w => w.phase === 5 && w.slot === 3, w => tag(w, 'BP-6', /Even minute/));
  each(w => w.phase === 4 && w.slot === 3, w => tag(w, 'BP-7', /^Assisted 90 Degree Chin Ups$/));
  each(w => w.phase === 6 && (w.slot === 2 || w.slot === 3), w => tag(w, 'BP-8', /^Pyramid EMOM/));
  each(w => w.warmup.some(x => /WristFlow|BodyFlow/.test(x.name)), w => w.qa.push('BP-11'));
  each(w => w.id === 'P6W3-2', w => tag(w, 'MU-7', /^Pyramid EMOM/));
  each(w => w.phase === 2 && w.slot === 2, w => tag(w, 'MU-8', /Hyperextension Hold/));
  each(w => w.id === 'P6W4-1', w => tag(w, 'MU-8', /Incline rows/));
  each(w => w.phase >= 4 && w.slot === 4, w => w.qa.push('MU-9'));
  each(w => w.format === 'amrap', w => tag(w, 'MU-10', /./));
}

main();
