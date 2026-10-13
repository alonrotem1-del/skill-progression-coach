SKILL PROGRESSION COACH — UPDATED PRODUCT DECISIONS
Response to Repository Audit + Foundation Model + UX Reset
13 Oct 2026

Your repository audit is accepted.

It exposed an important missing concept in the previous handoff, and we have now
refined the product model further.

The most important correction is:

The user may choose a long-term Goal immediately,
but that does NOT mean training becomes Goal-specific immediately.

For many users, especially beginners, there is first a Foundation period.

However:

FOUNDATION IS NOT ONE GLOBAL GATE.

Different capabilities may leave Foundation at different times.

That is now a core product principle.


======================================================================
1. REFINED CORE PRODUCT MODEL
======================================================================

The athlete chooses a long-term Goal.

Examples:

- Ring Muscle-Up
- Pistol Squat
- Handstand
- future advanced calisthenics skills

That Goal remains the destination from the beginning.

But the athlete may initially lack enough general capacity to train every
Goal-specific progression directly.

Therefore each relevant capability can conceptually move through:

FOUNDATION
    ->
GOAL-SPECIFIC DEVELOPMENT
    ->
TARGET CAPABILITY / READY

independently.


Example for Ring Muscle-Up:

Goal: Ring Muscle-Up

Parallel capability areas might include:

- pulling strength / height
- dip / push strength
- ring support / stability
- transition ability
- trunk/body control
- grip / false grip where relevant

At the beginning:

Pull strength      -> Foundation
Dip strength       -> Foundation
Core control       -> Foundation
Ring support       -> Foundation
Transition         -> not yet ready / needs assessment

Later:

Pull strength      -> Goal-specific
Dip strength       -> Goal-specific
Core control       -> still Foundation
Ring support       -> Goal-specific
Transition         -> Foundation / needs assessment

Training can therefore become hybrid.

Some work remains foundational.

Other work becomes Goal-specific as soon as demonstrated capability justifies it.


======================================================================
2. FOUNDATION IS CAPABILITY-SCOPED, NOT ALL-OR-NOTHING
======================================================================

Do NOT model:

Goal
  ->
Foundation Program complete
  ->
Goal-specific Program starts

as a single hard switch.

That would recreate a linear course model and violate the progression-first
philosophy.

Instead:

Goal
  ->
multiple capability progressions
  ->
each capability remains foundational only as long as needed
  ->
each capability can graduate independently into Goal-specific work


Canonical principle:

Foundation is continuously reassessed, not simply completed.

An athlete does not need every capability to leave Foundation at the same time.


======================================================================
3. ROLE OF THE BEGINNER / FOUNDATION PROGRAM
======================================================================

A structured Beginner Program is still extremely useful.

For a true beginner, it may initially provide almost all training.

Conceptually:

early:
mostly Foundation Program

later:
Foundation work
+
Goal-specific work

later still:
mostly Goal-specific work
+
only the foundational work that is still necessary


Do NOT expose percentages such as:

70% Foundation / 30% Goal-specific

to the athlete.

That is engine/planning logic, not UI.


IMPORTANT:

The Foundation Program is a prescription source.

It is NOT:

- a Goal
- Progression State
- proof of capability

Completing a week in the Program does not automatically mean a capability is ready.

Evidence does.


======================================================================
4. PROGRAM SOURCE VS GENERATED TRAINING
======================================================================

Keep the Program Library as an immutable authored source.

For a source program, preserve:

Program
  ->
Phase
  ->
Week
  ->
Workout
  ->
exact authored prescription

Never rewrite the source program itself.

If the coaching engine later produces a hybrid week containing:

- Foundation Program work
- Goal-specific work
- bouldering
- recovery changes

that generated Weekly Plan is an athlete-specific prescription.

It must not pretend that every modified session is still the untouched original
source program.


This distinction is important:

PROGRAM LIBRARY
= what the authored course says

WEEKLY PLAN
= what the athlete is actually scheduled to do


======================================================================
5. MONTHLY MAX TEST / PERIODIC REASSESSMENT
======================================================================

The Beginner Program's periodic Max Test is an important part of the future engine.

It should not be treated as just another workout.

Its main product role is:

PERIODIC REASSESSMENT / HIGH-VALUE EVIDENCE EVENT


The current source indicates a Max Test before Phase 1 and after each phase,
approximately monthly, rather than continuously.

Preserve the actual source cadence once authoritative program data is ingested.

Do not invent extra Max Tests.


A Max Test may provide Evidence for areas such as:

- pull-up performance
- hang
- push-up capacity
- dip capacity
- plank / trunk capacity

depending on the verified source.


IMPORTANT:

The Max Test does NOT itself mean:

"the athlete passed Foundation."

Instead:

Max Test
  ->
new Evidence
  ->
reevaluate each relevant capability independently
  ->
some capabilities may graduate into Goal-specific work
  ->
others remain foundational


Normal workouts can also produce Evidence between tests.

The monthly test is a strong reassessment checkpoint,
not the only way progression can happen.


======================================================================
6. CRITERIA NOT COVERED BY THE MAX TEST
======================================================================

The repository audit found Criteria requiring observations such as:

- movement depth
- kip
- execution quality
- catch quality
- measured distance/height
- technique

Do NOT weaken those Criteria simply because normal workout logging does not record
them.

Do NOT add those fields to every ordinary set.

Those require explicit Assessment / judgement Evidence where appropriate.


Therefore Evidence can come from:

1. normal workout execution
2. periodic Max Test
3. targeted Assessment/Test
4. other explicit observation flows where justified


Important UI semantics:

Missing Evidence is not the same as failure.

A capability may be:

- demonstrated / ready
- still developing
- needs assessment
- unknown

Do not label unknown capability as weak merely because the app cannot currently
measure it.


======================================================================
7. UPDATED HIGH-LEVEL TRAINING FLOW
======================================================================

The long-term architecture should now be understood as:

ATHLETE GOAL
     ↓
Parallel Capability Progressions
     ↓
Current capability state per progression
     ↓
Foundation work OR Goal-specific work per capability
     +
Program / authored prescription sources
     +
fixed activities / availability
     ↓
Weekly Plan
     ↓
Daily Readiness / Recovery
     ↓
Workout
     ↓
Performance
     ↓
Evidence
     ↓
Re-evaluation of capabilities


Periodic Max Tests / Assessments feed directly into the Evidence layer.


======================================================================
8. ACTIVE PROGRAM / PROGRAM ENROLLMENT
======================================================================

Keep the distinct Program concept identified in the previous response.

The athlete may have:

Active Program / Program Enrollment

with:

- program identity/version
- current phase
- current week
- current workout position
- completed units
- explicit repeats/skips where needed


However:

Program position and capability state remain independent.

Example:

The athlete may be:

Calixpert Beginner Program
Phase 4
Week 3

while simultaneously having:

Pull capability      -> Goal-specific
Core capability      -> Foundation
Ring support         -> Goal-specific
Transition           -> needs assessment


That is valid.

Do not collapse those into a single "current phase" domain state.


======================================================================
9. TODAY — UPDATED PRODUCT MEANING
======================================================================

Today should still be rebuilt as the minimal Home / Coach screen.

But it must now communicate the distinction between:

WHERE I WANT TO GO

and

WHAT KIND OF TRAINING I NEED RIGHT NOW


Conceptually:

[date]                                           [gear]

YOUR GOAL

Ring Muscle-Up


CURRENTLY

Building the foundation

or, later:

Foundation + Muscle-Up work


TODAY

Pull

Beginner Program · Phase 4 · Week 3

[ START WORKOUT ]

View workout

Train something else


Do NOT use these exact words blindly.

The visible state must come from truthful domain/presentation data.


IMPORTANT:

Today must remain extremely sparse.

Do not show all capability states here.

Do not show:

- progression graph
- percentages
- all Criteria
- all supporting Progressions
- full exercise list
- readiness dashboard
- weekly plan
- engine terminology


Today answers:

1. What am I working toward?
2. What should I do now?


Goals answers the deeper:

3. Where am I?
4. What is still missing?


======================================================================
10. MAJOR UX RESET — STILL APPROVED
======================================================================

The repository audit does NOT cancel the major UI redesign.

The current UI remains a functional prototype.

We still want a substantial presentation-layer reset.


PRIMARY NAVIGATION
------------------

Bottom navigation:

- Today
- Goals

ONLY.


GLOBAL CONTROL
--------------

Persistent gear icon in the top-right.

Settings / Control contains:

- This Week
- Active Program
- Profile
- availability / scheduling
- History / Activity
- Data & Backup
- app settings


Remove as primary tabs:

- Plan
- Profile
- Progress
- Map
- Week


Workout Runner is not a tab.

Train Now is not a tab.


======================================================================
11. TODAY MUST NOT BECOME A WORKOUT LIST
======================================================================

The previous UI became too dense because Today tried to be:

- home
- plan
- runner
- readiness screen
- exercise selector

at the same time.

Do not repeat that.


On a scheduled day the default Today screen should NOT show:

- every exercise
- sets/reps for every exercise
- Start This Exercise buttons
- Skip buttons
- several large actions
- optional/conditional badges everywhere


The athlete already has a prescription.

The primary action is:

START WORKOUT


"View workout" is secondary.


======================================================================
12. READINESS DECISION
======================================================================

The permanent readiness card should disappear from Today.

However, the audit correctly identified that it is currently the only readiness
input.

Therefore readiness moves to the Start Workout transition.


Conceptually:

Start Workout
   ↓
very short readiness check if needed
   ↓
apply adaptation
   ↓
show explanation only if something materially changed
   ↓
Runner


Keep it minimal.

Example concepts:

Normal
Fatigued
Pain / discomfort

Do not create a large questionnaire.

Persist the observation.

Do not use a numerical readiness dashboard.


Future principle:

Readiness modifies today's prescription.

It does NOT rewrite capability state or Program source content.


======================================================================
13. BOULDERING
======================================================================

Bouldering is part of the athlete's real training.

Restore it as:

PLANNED EXTERNAL TRAINING LOAD

not as the old "First V5" Goal.


It should be able to:

- occupy a scheduled day
- count as Pull / Grip / finger load
- affect recovery/readiness
- appear in This Week

Only generate Goal Evidence where an explicit legitimate mapping exists.


Do NOT restore "First V5" as an active canonical Goal.


======================================================================
14. CANONICAL GOALS
======================================================================

Use the new-engine canonical Goals as athlete-facing truth.

Currently:

- Ring Muscle-Up
- Pistol Squat

Retire visible legacy vocabularies such as:

- Bar Muscle-Up
- First Muscle-Up
- First V5

where those mean old product Goal concepts.

Preserve old IDs/data only where required for migration compatibility.


======================================================================
15. GOALS SCREEN IMPLICATION
======================================================================

Goals should eventually show the parallel capability nature of progress.

For example:

RING MUSCLE-UP

Pull strength
Ready for Muscle-Up-specific work

Dip strength
Ready for Goal-specific work

Core control
Still building foundation

Transition
Needs assessment

Ring support
Developing


This is conceptually much closer to the real product than:

"67% complete."


The exact Goals visual design is still NOT final.

Do not perform the full Goals redesign yet.


======================================================================
16. SOURCE OF TRUTH FOR LIMITERS / CURRENT FOCUS
======================================================================

The audit found conflicting logic between:

- goals.js
- bundle athleteFacingName/order
- evaluator.limiter()

Resolve this before exposing a strong current-focus sentence.

There must be one canonical interpretation path.

Preferred principle:

- evaluator/domain state = progression truth
- content bundle = athlete-facing labels/content
- UI adapter = presentation only


Do not maintain separate Goal semantics inside goals.js.


======================================================================
17. PROGRAM INGESTION RULE
======================================================================

The Calixpert Beginner Program still needs authoritative ingestion.

You correctly found that lesson prose is insufficient because the actual:

- sets
- reps
- hold durations
- EMOM targets

live in image tables / workout templates.


Do not fabricate them.

Search local/project materials for the athlete's downloaded workout tables.

If authoritative materials are unavailable:

stop Program content ingestion and report exactly what is missing.


Do not let this block independent shell/visual work.


======================================================================
18. UPDATED IMPLEMENTATION SEQUENCE
======================================================================

We want meaningful progress now, but without rebuilding Today on false data.

Proceed in this sequence.


--------------------------------------------------
UX-1 — APP SHELL + VISUAL SYSTEM
--------------------------------------------------

Proceed now.

Implement:

- Today | Goals primary bottom nav
- persistent Settings gear
- secondary Settings/control navigation
- move This Week / Profile / History / Data out of primary nav
- remove normal links to hidden Map / Progress
- fix navigation bugs found in audit
- fix local-date vs UTC date-key inconsistency
- establish Quiet Paper visual tokens


VISUAL DIRECTION:

Quiet Paper, Earned Illustration

Use:

- warm paper/off-white
- near-black ink
- clay accent
- sage for achieved/positive
- restrained ochre if needed
- generous whitespace
- hairlines instead of card overload
- selective serif for large/editorial text
- sans-serif for functional UI
- minimal shadows
- no glow
- no gradients
- no blue SaaS dashboard aesthetic

DONE WHEN:

- only Today + Goals are primary tabs
- gear/settings route works
- all old important functions remain reachable
- navigation bugs are resolved
- date boundary is consistent
- shared visual foundation exists
- regression suite passes


--------------------------------------------------
DOMAIN-2 — FOUNDATION / PROGRAM MODEL DESIGN
--------------------------------------------------

Before implementation, report the proposed concrete representation.

It must preserve these distinctions:

Goal
Progression
Capability foundation state
Program source
Program enrollment
Weekly Plan
Workout
Evidence

Do NOT create "Foundation" as a third Goal type.

Do NOT create one global boolean:

foundationComplete = true/false

Foundation readiness is capability-scoped.

DONE WHEN:

- model can represent different capability areas at different maturity states
- Program position is independent
- domain does not violate existing Technical Schema philosophy


--------------------------------------------------
PROGRAM-3 — PROGRAM LIBRARY + ENROLLMENT
--------------------------------------------------

Implement minimum clean Program foundation.

Use authoritative source content only.

DONE WHEN:

- source Program can be represented/versioned
- athlete program position can be persisted
- no invented content exists
- tests pass


--------------------------------------------------
ASSESSMENT-4 — MAX TEST / EVIDENCE MODEL
--------------------------------------------------

Represent periodic Max Test as an Assessment/Evidence event.

Do not make it a separate progression engine.

Map verified test outputs to relevant Criteria/observations.

DONE WHEN:

- test results become normal Evidence
- evaluator can use them
- monthly reassessment does not automatically advance all capabilities
- each capability is reevaluated independently


--------------------------------------------------
PLAN-5 — HYBRID WEEKLY PRESCRIPTION
--------------------------------------------------

Design planning so a week may eventually contain:

- remaining Foundation work
- Goal-specific work
- source Program sessions/components
- bouldering
- explicit athlete constraints

The source Program remains immutable.

The generated athlete Plan may be hybrid.

Any deviation from source Program must be explicit.

DONE WHEN:

- plan can represent the real athlete week
- Program identity is not lost
- Goal-specific additions are distinguishable
- bouldering is represented
- accepted schedule remains stable


--------------------------------------------------
READY-6 — READINESS BRIDGE
--------------------------------------------------

Move readiness input into workout start.

Persist it.

Preserve current adaptation behavior while new readiness engine remains unfinished.

DONE WHEN:

- permanent Today card removed
- input captured only when needed
- adaptation still works
- reload does not erase the relevant observation


--------------------------------------------------
TODAY-7 — FULL NEW TODAY / HOME
--------------------------------------------------

Then rebuild Today properly.

Requirements:

- sparse
- visually inviting
- Goal context
- truthful current training context
- Program context when relevant
- one primary action
- no workout-detail overload
- no duration until reliable
- no fake current-focus text

DONE WHEN:

the athlete opens the app and understands within seconds:

Where am I trying to go?

What should I do now?


--------------------------------------------------
ASSESSMENT-8 — NON-STANDARD CRITERIA COVERAGE
--------------------------------------------------

Add targeted Assessment paths for Criteria that cannot be captured through:

- normal sets
- Max Tests

Do not bloat the Runner.

DONE WHEN:

every canonical Criterion has an honest evidence-acquisition path or is explicitly
marked unsupported/needs assessment.


--------------------------------------------------
GOALS-9 — GOALS REDESIGN
--------------------------------------------------

Redesign Goals around:

- where I am
- what is ready
- what still needs Foundation
- what needs assessment
- what matters next

No arbitrary global percentage.

No graph unless it clearly improves comprehension.


======================================================================
19. VISUAL / PRODUCT RULE FOR ALL NEW SCREENS
======================================================================

For every visible element ask:

"What decision does this help the athlete make right now?"

If there is no strong answer:

remove it.

If useful but secondary:

put it in details.

If rarely used:

put it in Settings.

If only the engine needs it:

do not expose it.


======================================================================
20. DO NOT BREAK
======================================================================

Do not break:

- Backup / Restore
- athlete history
- PWA install/offline behavior
- current workout execution
- timers
- ladders
- pyramids
- timed holds
- actual logging
- IndexedDB/context work
- Evidence Tap
- evaluator
- shadow evaluation
- E1 / E1.1
- migration compatibility

Do not accidentally perform source-of-truth cutover.

Legacy engine remains authoritative until a separate cutover decision is made.


======================================================================
21. CURRENT SOURCE-OF-TRUTH STATUS
======================================================================

Verified repository state from your audit is accepted:

- P1 complete
- P2 complete
- P2.5 complete
- P4 complete
- P4.1 complete
- P5 complete
- P6a complete
- P6a.1 complete
- P3 complete
- Product renovation landed
- Today cleanup landed
- P6b complete
- E1 complete
- E1.1 complete

CUTOVER HAS NOT HAPPENED.


======================================================================
22. IMMEDIATE ACTION
======================================================================

Proceed now with:

UX-1 — APP SHELL + VISUAL SYSTEM.

In parallel, inspect the repository and authoritative local files sufficiently to
prepare:

DOMAIN-2 — FOUNDATION / PROGRAM MODEL DESIGN.

Do NOT yet implement the final Today screen.

Before implementing DOMAIN-2, report the proposed data/domain shape so we can
review it once.

Do not stop to ask about small design choices during UX-1.

Use strong product/design judgement.

The purpose of this work is NOT to make the existing UI slightly cleaner.

The purpose is to move the application toward a fundamentally simpler product:

Today = Coach
Goals = Progress
Settings = Control

while preserving the progression-first engine underneath.
