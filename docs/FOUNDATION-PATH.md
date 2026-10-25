# Foundation Path — first usable build

The Calixpert Beginner Program as the home of the app: Path → workout →
real results → back to the Path, with Max Tests, the SPC Foundation Exit and a
minimum Academy (Ring Muscle-Up, Pistol Squat).

## 1. Content: built, verified, never committed

The course is third-party, paid material. It is never in this repository.

```
node tools/build-program.cjs  "<path>/calixpert_protocols_master.md"
node tools/verify-program.cjs "<path>/calixpert_protocols_master.md"
```

- `build-program.cjs` reads the Beginner chapter of the master (the per-lesson
  workout tables — the transcriptions of the table images) and writes
  `private/beginner-program.json` (git-ignored). Every row keeps its raw cell
  text, its parsed value and its master line; every workout keeps its lesson URL.
  The source's own documented contradictions and gaps (BP-2…BP-11, Missing
  items) are attached to exactly the rows they concern.
- `verify-program.cjs` is independent of the builder: it re-reads the master,
  compares every row of every week with the chapter's separate "at a glance"
  tables (708 week-cells), and checks the shape (6 phases, 24 weeks, 96 + 24
  workouts, deloads before Phases 4–6, 7 Max Test points), the source
  fingerprint (md5) and every row's master line. Current result: 36/36 pass,
  0 mismatches. `tests/program.spec.cjs` runs it as test 01.
- The app loads the package from `private/` when it is served locally, and
  otherwise from the device (Settings → Program → Import program file). It is
  kept on the device, so the path works offline. The service worker never
  caches `private/`.

## 2. Data: prescription and performance are separate

| | where | written by |
|---|---|---|
| Authored prescription | the program package (`spc_c_programpkg` on the device) | only the builder / an import |
| What the athlete did | `spc_c_program`: an append-only event list | the app |
| A workout in progress | `spc_c_programrun` | the app; cleared on finish |

Events: `enrolled`, `repositioned`, `workout_completed` (with per-set results,
a summary, and the prescription's raw text copied by value for history),
`deload_completed`, `maxtest_recorded`, `exit_test_recorded`,
`foundation_exit_passed`. Position, outcomes, Foundation Exit and Academy status
are all derived by `program.js` (pure, Node-tested). All four keys are in the
backup inventory.

## 3. Rule register

### SOURCE — the Beginner Program as written
- Sequence: Max Test → Phases 1–6 (deload week before Week 1 of Phases 4–6) →
  Max Test after every phase. 4 required workouts per week + optional legs.
- No performance gates between weeks or phases; the Max Test is a benchmark
  with no pass mark.
- Easy / Hard: both shown; how to choose is "Not specified on site".
- EMOM, alternating EMOM, EMOM cycle, Pyramid EMOM, AMRAP and core-circuit
  definitions are shown verbatim from the program.

### APPROVED SPC methodology
- Foundation Exit, Stage 5A Calibration v1: F1 5 pull-ups · F2 15 push-ups ·
  F3 5 parallel-bar dips · F4 30 s dead hang · F5 60 s forearm plank · F6 12
  squats + 8 reverse lunges per leg · F7 every counted rep/second valid. All six
  required; evidence within 45 days for the initial approval; once passed, never
  revoked. Max Test results count only when they are the very same test.
- Academy, Stage 4 ledger: globally locked until the Exit; Ring Muscle-Up entry
  6 clean pull-ups + 6 clean parallel-bar dips (SPC reading of "bar dips",
  Stage 5A §2.2), reusing the same evidence; Pistol Squat open after the Exit.
  No in-goal progression (Stage 5B is not approved and is not implemented).

### SPC-v1 product rules (from the build brief)
- A valid value anywhere in a prescribed range — or above it — counts as done;
  the top of the range is never required.
- Below-range results are kept exactly; nothing is reset, regressed or
  substituted.
- Completing the scheduled training advances the path.
- The existing athlete starts at Phase 4, Week 3 with Push done (reported, no
  set data); earlier content is "placed past", never fabricated as done.

### IMPLEMENTATION DETAILS — decided here, flagged, not methodology
1. Workouts of the current week can be done in any order (the source gives
   none); "Next" marks the lowest-numbered one not yet done.
2. Finishing a workout completes it for the path, even with skipped or
   below-range exercises (the athlete confirms first). Not a performance gate.
3. Per-leg / per-arm prescriptions log left and right; in range only if both are.
4. EMOM is in range when at least the lower bound of minutes is logged and every
   logged minute reaches the lower bound of reps. Pyramid EMOM and AMRAP are
   "logged" only — the source sets no target.
5. Circuits log one value per exercise plus the rounds done (not round by round).
6. A deload week is completed by the athlete tapping "Deload week done".
7. A Max Test needs at least one result to be saved; families can be marked
   "not tested".
8. For Max Test → Exit equivalence the app asks for grip (pull, hang),
   apparatus (dips) and plank form, plus a validity tick. "Hang On The Bar" is
   treated as the two-hand hang only when the grip "two hands, overhand" is chosen.
9. Exit and entry tests are self-recorded with the full validity checklist
   (Stage 5A accepts a structured log with technique confirmation); the
   assessor (self / video / witnessed) is stored.
10. Ring Muscle-Up 6 + 6: no freshness window is applied (none is approved).
11. The Foundation Exit can be recorded at any time (fast-track, Stage 5A).
12. The starting point can be changed in Settings → Program; it never deletes
    anything, earlier content becomes placed past.
13. A brand-new athlete starts at the first Max Test (no placement rule is
    approved).
14. Easy / Hard defaults to the athlete's last choice for that exercise (Easy the
    first time).
15. The earlier weekly-plan app (Today / Goals / legacy plan and runners) is no
    longer reachable; it stays in `app.js` behind `window.__spcLegacyShell`, and
    its suites run with that switch on.

## 4. Not in this build
- Deploying the course to the phone: the package must be imported on the device
  (or hosted privately) — the public repository and GitHub Pages never carry it.
- Training sets as Exit evidence (e.g. a 3 × 8 dips session): only Max Tests and
  Exit tests count today.
- The IndexedDB evidence ledger is not fed by program workouts yet.
- The readiness check at workout start (READY-6).
- The True Beginner Program (not collected).
- Source contradictions are shown at the rows they concern, never resolved.
