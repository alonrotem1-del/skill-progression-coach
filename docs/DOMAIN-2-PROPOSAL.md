# DOMAIN-2 — Foundation / Program model: proposed shape (for review)

Status: PROPOSAL ONLY. Nothing below is implemented. Written after UX-1, from
the real repository (content bundle-1, semantics-1, evaluator, ledger, context
adoption). Please review once; implementation starts after approval.

## 0. Principles this shape is built to keep

- Progression state stays **derived** from the Evidence ledger by the pure
  evaluator. Nothing new stores "where the athlete is" as a mutable field.
- Foundation is **per capability**, never a global flag.
- A Program is a **prescription source**. It is never proof of capability,
  never a Goal, and its authored content is never rewritten.
- Program **position** and capability **state** are independent.
- New durable facts are **append-only events**, like `InterpretationAdoption`.
- No invented content: every Program field comes from an authoritative source
  file and carries provenance.

## 1. Capability foundation state — content, not a new store

### Shape
Add one optional field to each **Stage** in the content bundle:

```
stage.band: "foundation" | "specific"      (default "specific")
```

and allow a progression to begin with one or more foundation-band stages,
authored like any other stage (a Criterion, an expression of depth <= 2).

Example (Ring Muscle-Up, illustrative only — real criteria come from review):

```
rmu_pull_strength:   s0 foundation  "8 strict pull-ups"        <- new
                     s1 specific    "1 strict pull-up" ...      (existing stages
                                                                 re-banded as
                                                                 the content
                                                                 owner decides)
rmu_dip_press:       s0 foundation  "10 parallel-bar dips"      <- new
```

### Derived, per capability (no storage)
For each `coordinate` of a Goal the presentation adapter derives exactly one of:

| derived state      | rule (from evaluator output, per side where relevant) |
|--------------------|--------------------------------------------------------|
| `needs_assessment` | no applicable evidence for the current stage's Criterion (missing attribute / never observed) |
| `foundation`       | current stage is in the `foundation` band |
| `specific`         | current stage is in the `specific` band |
| `ready`            | every stage established |

`needs_assessment` is the honest answer for missing evidence. It is never
rendered as "weak" or "failing".

### Why this and not a separate Foundation object
- It reuses the existing stage/criterion/evaluator machinery: graduation out of
  Foundation is literally "the foundation stage's Criterion is established", so
  Max Tests and normal workouts move it through the same path as everything else.
- Different capabilities graduate independently because each progression has its
  own current stage.
- There is no `foundationComplete` anywhere; there is nothing to set.
- It is a content change, so it is versioned through a new ContentBundleVersion +
  InterpretationContext, exactly as P4/P5 intended.

Open for you: which existing stages are "foundation" vs "specific", and the
foundation Criteria themselves. The engine does not decide this.

## 2. Program Library — a new, separately versioned content package

### Shape (immutable, authored)
```
ProgramPackage {
  id: "calixpert_beginner", version: 1, publishedAt,
  source: { publisher: "Calixpert", url, retrievedAt, materials: [...] },
  phases: [ {
    id: "p4", order: 4, name: "Phase 4",
    weeks: [ {
      id: "p4w3", order: 3, kind: "training" | "deload" | "test",
      workouts: [ {
        id: "p4w3_w3", order: 3, name: "Workout 3 – Pull", role: "pull",
        optional: false,
        warmup: ["general" | "band", "wristflow", "bodyflow"], cooldown: ["recoveryflow"],
        items: [ {
          exerciseId: "<bundle exercise id>" | null,
          sourceName: "Chin-Ups",                 // verbatim from source
          prescription: { scheme: "sets"|"emom"|"amrap"|"hold"|"ladder"|"pyramid",
                          sets, repsMin, repsMax, secondsMin, secondsMax, minutes, ... },
          variants: ["Assisted Chin-Ups"],        // the source's "X / Y" alternatives
          provenance: { lesson, table: "image" | "sheet", verified: true|false }
        } ]
      } ]
    } ]
  } ],
  assessments: [ { id: "max_test", cadence: "start_and_after_each_phase",
                   items: [hang, pull, push-up, dip, plank], restMinSeconds: 120 } ]
}
```

- Stored like context packages: durable, immutable, versioned; validated by a
  program validator (every item has a prescription from a verified source or is
  explicitly `verified:false` and then not prescribable).
- `exerciseId` maps a source exercise onto the bundle's exercise vocabulary when
  one exists; `null` + `sourceName` when it does not (no invented mapping).
- Not stored in the public repository: the authored course content stays in a
  private package the app imports (see section 7).

## 3. Program Enrollment — append-only events, position derived

```
ProgramEvent (in the existing `events` ledger)
  enrolled          { programId, version, startPhase, startWeek, at }
  workout_done      { workoutRef, sessionId, at }          // links to the real session
  workout_skipped   { workoutRef, reason?, at }
  week_repeated     { weekRef, reason?, at }               // explicit, never automatic
  advanced          { from, to, basis: "source" | "athlete", at }
  paused / ended    { at }
```

`currentPosition(events, package)` is a pure function, like
`currentContext(adoptions)`. Phase 4 / Week 3 / next = Workout 3 is derived,
never edited in place. Position never feeds the evaluator; capability state
never moves the position.

"Source says advance, readiness says repeat" is represented as the athlete's
explicit `week_repeated` or `advanced{basis}` event, after the app recommends.

## 4. Weekly Plan — explicit sources per slot

The plan stays user-owned and stable once accepted. Each scheduled slot names
where it came from:

```
PlanSlot {
  day, order,
  source: { kind: "program", workoutRef }             // untouched source workout
        | { kind: "program_adapted", workoutRef, changes:[...] }   // deviation is explicit
        | { kind: "goal_work", progressionId, exerciseId, dose }   // Goal-specific add-on
        | { kind: "external", activity: "bouldering", load:{pull,grip,fingers} }
        | { kind: "open" }
}
```

- Bouldering returns as an `external` slot that carries load, not as a Goal.
- A hybrid week (Program sessions + Goal-specific add-ons + bouldering) is just a
  list of slots with different sources; Program identity is never lost.
- Migration: the legacy `spc_c_plan` stays authoritative until cutover; this
  shape is introduced beside it (shadow first), as P6b did for evaluation.

## 5. Max Test — an Assessment that writes ordinary Evidence

- The Max Test is an `assessment` defined in the ProgramPackage.
- Its runner records exactly the attributes its Criteria need, and nothing more.
  Example: the pull item records `reps` AND `kip:false` (strict is the test's
  standard), which is precisely what `rmu_pull_*` Criteria require and what
  normal sets do not record today.
- Each result is a normal `PerformanceObservation` with
  `provenance: "demonstrated"`, `context: "assessment"`, linked via `assess`
  ExerciseLinks. No separate engine, no "Foundation passed" outcome.
- After a test, the evaluator re-runs per progression; some capabilities move
  band, others do not.
- Cadence comes only from the source (before Phase 1 and after each phase).

Mapping needed (for review): hang -> `deadhang`, pull -> `pullup`,
push-up -> (no bundle exercise yet), dip -> `dip`, plank -> (no bundle exercise
yet). Two new bundle exercises (and possibly criteria) are required.

## 6. Criteria that need judgement (ASSESSMENT-8 later)

13 of 21 criteria need `kip`, `depth`, `execution`, `catch_quality` or `cm`.
Proposal: each such Criterion gets an explicit acquisition path recorded in
content — `acquisition: "set" | "max_test" | "assessment:<id>"` — and anything
without one is shown as `needs_assessment`, never as failure. The runner is not
widened for ordinary sets.

## 7. Where things live

| thing | where | why |
|---|---|---|
| Content bundle (+ `band`) | repo, `content/` | already public, authored by us |
| ProgramPackage (course content) | **private**, imported on device | it is a third party's paid material; the repo is public |
| Enrollment events | IndexedDB `events` ledger | append-only, backed up with everything else |
| Plan slots | new store beside `spc_c_plan` | shadow first, cutover later |

## 8. Blocker for PROGRAM-3

The Beginner Program's sets/reps/holds/EMOM targets live in per-lesson table
images and the "Workout Template" sheet, not in lesson text. The athlete has
those tables on another computer. PROGRAM-3 cannot start until they are
available here; the program shape above does not depend on them.

## 9. Questions for you

1. Approve `stage.band` as the Foundation representation (vs. a separate object)?
2. Who authors the foundation Criteria per capability, and from which source?
3. ProgramPackage kept private and imported on the device — acceptable?
4. Max Test pull item records `kip:false` explicitly — acceptable as the
   standard for "strict"?
5. Plan slots introduced in shadow beside the legacy plan, cutover later — agreed?
