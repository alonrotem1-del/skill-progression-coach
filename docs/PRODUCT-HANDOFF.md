SKILL PROGRESSION COACH
FULL PRODUCT + IMPLEMENTATION HANDOFF
=====================================

PURPOSE OF THIS DOCUMENT
------------------------

You are taking over active development of Skill Progression Coach.

You have direct access to:
- the full repository
- current code
- git history
- tests
- the working PWA

You do NOT have access to the long product/design conversations that led to the current decisions.

This document is intended to transfer that context.

Important:

1. Do not assume the current UI represents the desired product.
   It should now be treated mainly as a FUNCTIONAL PROTOTYPE.

2. Do not reopen product philosophy casually.
   A large amount of product/domain thinking has already been done and several
   architectural principles are intentionally frozen.

3. At the same time, do not preserve UI structures merely because they already exist.
   The user has explicitly decided that the presentation layer can be substantially
   redesigned, and potentially rebuilt, if that produces a much better product.

4. Preserve proven infrastructure and working behavior unless a task explicitly
   requires changing it.

5. If this document conflicts with the actual repository state regarding what has
   already been implemented, inspect git history and current code and report the
   discrepancy. Do not silently recreate or duplicate completed work.


======================================================================
1. WHAT THE PRODUCT IS
======================================================================

Skill Progression Coach is a mobile-first PWA for systematically progressing toward
difficult physical skills.

The initial canonical Goals are:

- Ring Muscle-Up
- Pistol Squat

The broader concept can later support other physical skills, but the product must
not become a generic workout tracker or exercise library.

The core user problem is NOT:

"How do I log workouts?"

It is:

"I want to achieve a difficult physical skill, but I do not know:
- what I am missing,
- what I should improve next,
- whether I am ready to progress,
- and what I should do today."

Traditional fitness apps usually organize the world around:

workout -> exercise -> set -> history

Skill Progression Coach organizes the world around:

Goal -> Progression -> demonstrated capability -> next requirement -> today's work

The primary product promise is:

The athlete chooses a Goal.
The system understands the capabilities required to reach that Goal.
It tracks what the athlete has actually demonstrated.
It determines what is currently missing.
It turns that into a practical weekly structure and a clear recommendation for today.

The product should feel like a coach making progression understandable,
not like a database that the athlete must manage.


TARGET USER
-----------

The product is for people actively trying to achieve physical skills where progress
is multi-step and prerequisites matter.

Examples:

- Ring Muscle-Up
- Pistol Squat
- advanced pull-up variations
- future calisthenics skills

The user may also:
- train in a gym
- climb
- do general strength work
- have multiple training days
- miss sessions
- be fatigued
- improve faster or slower than expected

The product must fit around real training rather than force training into a rigid
app taxonomy.


THE FOUR QUESTIONS
------------------

The interface should ultimately help the athlete answer only four fundamental
questions:

1. What is my Goal?
2. Where am I?
3. What is missing?
4. What should I do today?

This is an important filter for every product and UI decision.

Engine complexity that does not help answer one of these questions should normally
remain invisible.


======================================================================
2. LONG-TERM PRODUCT VISION
======================================================================

The product is intended to become a progression-first coaching platform.

Canonical principle:

"The engine is progression-first, not workout-first.
Workouts are disposable outputs; progression state is the persistent truth."

The long-term system concept is:

Goal
  ->
Multiple Parallel Progressions
  ->
Dependencies / Criteria
  ->
Recovery / Readiness
  ->
Workout

And the feedback path is:

Workout Performance
  ->
Evidence
  ->
Progression State

Planning becomes:

Progression State
  ->
Weekly Plan
  ->
Daily Recovery / Readiness
  ->
Today's Workout


WHY THIS MATTERS
----------------

A workout is not the Goal.

For example, a Ring Muscle-Up may depend on several capabilities developing in
parallel:

- pulling height / pulling strength
- transition ability
- false grip
- ring support
- technique/control

A user can improve in some of these while still being limited by another.

Therefore:

- completing X workouts does not automatically unlock progress
- time spent at a stage does not automatically unlock progress
- progression is based on demonstrated capability
- different Progressions may move at different speeds


PRODUCT IDENTITY
----------------

This should NOT evolve into:

- a generic workout logger
- an exercise catalogue
- a general gym tracker
- a calorie/nutrition app
- a wearable dashboard
- a social fitness feed
- a gamification-heavy XP system

The differentiation is:

"Tell me where I am in relation to the skill I want, what is missing, and what I
should do next."


FUTURE EXPERIENCE
-----------------

The ideal mature experience is:

I open the app.

I immediately understand:
- the Goal I am working toward,
- what the current focus is,
- and what I should do today.

I train.

The app captures what I actually did.

That performance becomes Evidence.

The engine re-evaluates the relevant Progressions.

If I have demonstrated enough capability:
the path advances.

If not:
the system keeps developing the missing capability.

If recovery/readiness is poor:
the progression state may stay the same while today's prescription changes.

The athlete should experience this as simple coaching even if the engine underneath
is sophisticated.


======================================================================
3. THE MAJOR PRODUCT CHANGE HAPPENING NOW
======================================================================

We are intentionally stopping the previous incremental UI patch cycle.

The existing application accumulated too much visible complexity:

- too many cards
- too many actions
- too many "Start" buttons
- too much internal engine information
- planning and execution mixed together
- readiness exposed too prominently
- excessive navigation
- screens behaving like dashboards
- UI changes being handled as tiny patches instead of a coherent design system

The user no longer wants to keep correcting individual buttons and cards.

The decision is:

RETHINK THE USER-FACING PRODUCT AS A WHOLE.

This does NOT mean rewriting the domain/storage engine from scratch.

It means the presentation layer and information architecture may change
substantially.


CURRENT UI STATUS
-----------------

Treat the existing UI as:

FUNCTIONAL PROTOTYPE

not:

DESIGN BASELINE


WHAT SHOULD BE PRESERVED
------------------------

Where already working and compatible with the architecture, preserve:

- PWA behavior
- offline behavior
- runners
- rest timers
- set/repetition logging
- timed holds
- ladder / pyramid execution
- Planned vs Actual behavior
- existing workout execution logic
- existing history data
- Backup / Restore
- IndexedDB work
- Interpretation Context architecture
- Evidence architecture/migration work
- tested domain logic
- useful stable workout primitives

These are assets.

Do not rewrite them simply because the interface around them is changing.


WHAT MAY CHANGE SUBSTANTIALLY
-----------------------------

The following may be redesigned/rebuilt:

- app shell
- primary navigation
- Today/Home
- Goals
- Goal Detail
- Settings information architecture
- weekly planning presentation
- visual system
- card/surface structure
- information hierarchy
- wording
- visibility of advanced information


USER EXPERIENCE TARGET
----------------------

The new product should feel:

- calm
- clear
- beautiful
- inviting
- confident
- coach-like
- much less dense

The athlete should not feel that they are operating an engine.

They should feel that the engine understands what matters and gives them the
next useful action.


======================================================================
4. NEW TOP-LEVEL UX ARCHITECTURE
======================================================================

The current direction is intentionally very minimal.

PRIMARY BOTTOM NAVIGATION:

1. Today
2. Goals

Only these two are currently planned as primary tabs.


GLOBAL SETTINGS ENTRY
---------------------

There should be a persistent gear icon in the top-right area of main screens.

Settings is NOT a bottom tab.

The user specifically wants a permanent, obvious entry point such as a gear rather
than hiding settings in an unclear navigation structure.

Settings is the "control" area.


MENTAL MODEL
------------

Today = Coach / Home
Goals = Progress
Settings = Control

Workout Runner = temporary execution mode, NOT a tab


WHAT MOVES INTO SETTINGS
------------------------

Secondary/administrative destinations should be accessible from Settings,
including where appropriate:

- This Week
- Profile
- training availability
- schedule controls
- History / Activity
- Data & Backup
- application preferences
- other low-frequency controls

"This Week" is important functionality but is NOT considered important enough for
a primary tab.

The weekly plan should be available when the athlete wants to inspect or edit it,
not demand daily attention.


WHY PLAN IS NOT A PRIMARY TAB
-----------------------------

The weekly plan matters because:

- users sometimes need to see their week
- users may move a workout
- users may change availability
- climbing or other external load may matter
- the generated plan must remain visible and user-owned

However, that does not mean the user needs to visit the plan every day.

The product should normally make the coaching decision rather than require the
user to manage a schedule continuously.

Therefore:

Plan / This Week remains a product capability,
but becomes a secondary management screen inside Settings.


======================================================================
5. TODAY / HOME — CURRENT APPROVED PRODUCT DIRECTION
======================================================================

Today is the most important screen in the product.

It should NOT be a mini dashboard.

It should NOT display the entire workout by default.

It should be close to a launch screen.


TODAY MUST ANSWER
-----------------

1. What am I working toward?
2. What should I do today?

That is enough for the default view.


CONCEPTUAL TRAINING-DAY STRUCTURE
---------------------------------

Example:

MONDAY, 13 OCT                                      [gear]

WORKING TOWARD

Ring Muscle-Up

Building transition control


TODAY

Push + Explosive Pull

~35 min

[ START WORKOUT ]

View workout

Train something else


This is conceptual hierarchy, not final pixel specification.


WHY THE GOAL APPEARS
--------------------

The user wants Today to communicate that today's training is part of a process.

An athlete should not feel:

"Here is another random workout."

They should feel:

"I am working toward Ring Muscle-Up, the current focus is transition control,
and this is today's work in service of that Goal."


WHAT SHOULD NOT APPEAR BY DEFAULT ON TODAY
------------------------------------------

Do not default to showing:

- full exercise list
- sets/reps for every movement
- Start This Exercise per movement
- Skip buttons
- exercise controls
- progression graphs
- progression percentages
- Stage IDs
- dependencies
- engine terminology
- weekly calendar
- history
- readiness dashboard
- readiness score
- multiple primary CTAs
- lots of conditional/optional badges
- internal model detail

The user already accepted/defined the plan.

There is no need to force them to read the entire prescription before starting.


VIEW WORKOUT
------------

"View workout" may exist as a secondary action.

It allows an athlete who wants to preview the session to inspect it.

This is not the default presentation.


PRIMARY CTA
-----------

On a scheduled training day:

START WORKOUT

should be the one obvious primary action.


TRAIN SOMETHING ELSE
--------------------

There should still be user autonomy.

A quiet tertiary action such as:

Train something else

can expose an escape route.

Potential options:

- repeat a recent workout
- train one exercise
- free workout
- relevant optional work

This must not become the main interaction model.


OPEN DAY
--------

If no workout is scheduled:

[date]                                             [gear]

WORKING TOWARD
Ring Muscle-Up

Building transition control


TODAY

Open day

Nothing scheduled today.

[ TRAIN NOW ]

In this state Train Now becomes the primary action.

A quiet link to This Week may also be useful.


READINESS ON TODAY
------------------

Do NOT permanently display a readiness dashboard.

The philosophy is:

show the athlete the EFFECT of readiness,
not the mechanism of readiness.

For example, if today's workout was changed:

Adjusted today

Less pulling volume after yesterday's climbing.

Then show the adjusted workout and normal Start Workout CTA.

If readiness did not meaningfully change anything:
do not show readiness.

If the engine genuinely needs athlete input:
ask contextually at the appropriate moment.

Do not show a numerical readiness score merely because one exists internally.


======================================================================
6. WORKOUT RUNNER
======================================================================

Workout Runner is execution mode.

It is NOT part of primary navigation.

When the athlete presses Start Workout:

Today is left behind and the app enters the runner.


RUNNER RESPONSIBILITY
---------------------

The runner may show:

- current movement
- set number
- target reps/time
- actual reps/time
- rest timer
- next/done
- skip when supported
- other execution controls required by the workout type

This is where detail belongs.


TODAY VS RUNNER
---------------

Today:
"What should I do?"

Runner:
"Help me do it."

Do not merge these two experiences again.


RUNNER DESIGN PRINCIPLE
-----------------------

The runner is a tool.

It should prioritize:

- readability
- speed
- thumb accessibility
- low cognitive load

Do not over-decorate it.


======================================================================
7. GOALS — CURRENT PRODUCT DIRECTION
======================================================================

Goals is the second primary tab.

Its purpose is:

"Show me where I am in the journey and what is missing."


ACTIVE GOALS
------------

The athlete currently has exactly two canonical primary Goals:

- Ring Muscle-Up
- Pistol Squat

Normally the system should support only a small number of active Goals,
roughly 1–3.


IMPORTANT:
Supporting capabilities are not automatically separate Goals.

Examples such as:

- false grip
- ring support
- chest-to-bar / pull height
- transition
- deep squat capability

may be Supporting Progressions for a Goal.


GOALS SCREEN
------------

The current conceptual direction is deliberately restrained.

Example:

Ring Muscle-Up

Next up:
Build enough high-pull height and transition control.

Pull strength — progressing
Transition — needs work
Ring support — ready
False grip — ready


Pistol Squat

Next up:
Left-side depth and ankle range are the current limiters.


Do NOT show arbitrary overall percentages such as:

"Ring Muscle-Up — 67% complete"

The Goal consists of parallel Progressions and does not necessarily have one honest
linear position.


GOAL DETAIL
-----------

Goal Detail may provide more depth.

Example:

RING MUSCLE-UP

You are building four things

Pull height
Current: chest-to-bar x3
Target: sternum-to-bar x3

Transition
Current: assisted transition x3
Target: controlled low-ring transition x3

Ring support
Ready

False grip
Ready

WHAT MATTERS NOW

Transition control

That is why it appears twice in this week's training.


The product should explain progression in human language.

Do not expose the internal graph just because the engine uses graph-like
relationships.


GOALS REDESIGN STATUS
---------------------

The overall purpose and philosophy are decided.

The detailed Goals UI is NOT yet fully locked.

Do not assume old Map/Progress screens are the future design.

Goals should be deliberately redesigned after Today / app shell.


======================================================================
8. CORE DOMAIN CONCEPTS
======================================================================

These concepts are important and should not be blurred together.


8.1 GOAL
--------

A Goal is an athlete-desired outcome.

Examples:

- Ring Muscle-Up
- Pistol Squat

A Goal coordinates one or more Progressions.

Goal and Progression are conceptually distinct.

Do NOT simplify the ontology to:

"Goal = Progression with a tag."

They may share technical primitives internally if justified, but the domain
meaning is different.


8.2 PROGRESSION
---------------

A Progression represents a capability path that can develop over time.

A Goal may depend on several Progressions simultaneously.

Example Ring Muscle-Up:

Goal
  - Pull capability progression
  - Transition progression
  - False-grip progression
  - Ring-support progression

They do not have to advance together.


8.3 SUPPORTING PROGRESSION
--------------------------

"Supporting Progression" is a ROLE relative to a Goal, not an intrinsic content
type.

For example:

Weighted Pull-Up might be:
- a Supporting Progression for Ring Muscle-Up in one context
- a Goal in another context

Do not encode product semantics based on the assumption that a capability is
permanently either "Goal" or "support."


8.4 STAGE
---------

A Progression may contain Stages representing meaningful capability states or
steps.

Advancement is based on Criteria, not merely time.


8.5 CRITERION
-------------

A Criterion is an atomic formal evaluation rule.

Example conceptually:

- hold X seconds
- complete X repetitions
- reach a given movement standard

A Criterion belongs to a requirement holder.

Criterion must remain atomic.


8.6 REQUIREMENT EXPRESSION
--------------------------

Logical composition is one level above Criterion.

Approved forms are:

- criterion
- allOf [...]
- anyOf [...]

Maximum approved expression depth: 2.

Do not invent a generic rule language.

Deferred:
- atLeast(n)
- generic scripting
- arbitrary boolean DSL


8.7 DEPENDENCY
--------------

A Dependency expresses a relationship between independently evaluated states.

Important:

A Dependency should reference another holder/state.

It should NOT duplicate another Progression's metric.

Wrong conceptual approach:

"Transition Stage requires pull height >= X"
where X is copied into the transition rule.

Correct concept:

"Transition Stage depends on the relevant Pull holder being satisfied."

This prevents duplicated truth.


8.8 EVIDENCE
------------

Evidence is the factual record of what the athlete actually demonstrated.

Examples could include:

- reps completed
- weight lifted
- hold duration
- movement performance
- side-specific performance

Evidence should be append-oriented.

It is different from interpreted Progression State.

This distinction is critical:

FACT:
what happened

INTERPRETATION:
what that performance means under the current progression model


8.9 CLAIMED VS DEMONSTRATED
---------------------------

Evidence provenance matters.

Claimed:
the athlete states they can already do something.

Demonstrated:
the application has actual performance evidence.

Claimed capability may provisionally satisfy ordinary Criteria where policy allows.

Claimed evidence must NOT automatically satisfy high-consequence requirements
such as protected/hard dependencies or terminal Goal completion where the approved
semantics prohibit it.

Demonstrated should supersede Claimed when real evidence becomes available.


8.10 VALIDITY FOR PROGRESSION
-----------------------------

Evidence provenance and progression-validity are separate dimensions.

A performance can be:

Demonstrated

but:

not valid for unlocking a progression state

for example because a required dependency was not satisfied at the time.

Do not collapse:

"invalid for progression"

into:

"did not happen."

The performance remains a true historical fact.


8.11 SIDE-SCOPED STATE
----------------------

Some capabilities are asymmetric.

Example:
Pistol Squat left vs right.

Progression State and Evidence must support side scope where relevant.


8.12 RECOVERY / READINESS
-------------------------

Recovery / Readiness is an explicit engine layer.

It is NOT simply a visual filter added after workout generation.

Important behavior:

Progression State may remain unchanged,
while today's Workout is changed because readiness is poor.

Example:

The athlete is still at the same Pull Stage,
but pulling volume is reduced today due to yesterday's climbing.

Recovery affects today's prescription without rewriting underlying capability.


8.13 WORKOUT
------------

Workout is generated output.

It is NOT the persistent truth of the system.

This is one of the most important architectural principles.

Workouts can change.
Progression State persists.


8.14 WEEKLY PLAN
----------------

The engine may generate a Weekly Plan.

Once exposed/accepted by the athlete, the plan becomes stable and user-owned.

Both:
- training intent
- scheduled placement

should not silently mutate.

Readiness may adapt Today or recommend a swap.

If the week itself should change:
the athlete should approve that change.


8.15 ASSESSMENT / TEST
----------------------

Assessments exist when the system needs information it does not yet have.

Examples conceptually:

- can you hold X?
- can you perform Y?
- left/right ability check

An Assessment should be:

- focused
- understandable
- usually one capability at a time

The app should not force large repeated testing flows.

Assessment results create Evidence.

Tests are therefore information-gathering mechanisms, not a separate product
universe.


8.16 MILESTONE / UNLOCK
-----------------------

When enough Criteria are demonstrated, a progression can advance or a meaningful
milestone can be recognized.

This is an "earned" moment.

The UI may give such events more visual/emotional weight than ordinary workouts.

Do not turn every workout into gamification.


8.17 HISTORY / ACTIVITY
-----------------------

History is the athlete-readable record of what happened.

It is useful for:

- reviewing sessions
- seeing meaningful performance
- understanding progression history

But History is NOT the source of truth for current progression simply because it
is a chronological list.

The engine interprets Evidence to derive current state.


======================================================================
9. INTERPRETATION CONTEXT AND MODEL VERSIONING
======================================================================

The application is being migrated toward an architecture where athlete facts remain
stable while interpretation rules/content can evolve.

InterpretationContext is a first-class immutable release object.

It identifies an approved compatible pair of:

- ContentBundleVersion
- EvaluationSemanticsVersion

Arbitrary pairing should not be representable.


ADOPTION
--------

The athlete's current Interpretation Context is derived from an append-only
InterpretationAdoption ledger.

It is not merely a mutable current-context pointer.


STORAGE
-------

Context packages are intended to be durably stored.

Evaluator logic should operate from durable context packages rather than depend
on:

- network
- service-worker cache
- transient UI state


HISTORY
-------

Historical artifacts should remain explainable even if content/semantics change.

Exact computational replay may depend on retained evaluator/context definitions,
but frozen historical artifacts should carry enough interpreted information by
value to remain understandable.


======================================================================
10. CURRENT TECHNICAL / MIGRATION CONTEXT
======================================================================

The repository has been undergoing a strangler migration rather than a rewrite.

Do NOT assume every phase listed below is still pending.

Inspect git history and current code before acting.

Known historical plan / sequence:

P4 -> P5 -> P6a -> P3 -> P6b -> P7 onward

The numbering was deliberately preserved for traceability even when execution order
changed.


P1 — BACKUP / RESTORE SAFETY
----------------------------

A raw reversible Backup/Restore layer was implemented before dangerous migrations.

Known historical commit:

f3c1a4b3f16a4b6ab037197d8799dafa81cee0e3

It protected both current `spc_c_*` data and legacy `puc_*` reads.

A physical Samsung installed-PWA round trip was successfully tested:

- export
- modify state
- restore
- confirm changes reverted
- force close/reopen
- confirm restored data persisted

Do not casually break backup compatibility.


DURABLE STORAGE / CONTEXT
-------------------------

A later physical Samsung verification showed:

- Durable storage ready
- schema v1 persisted
- Interpretation context ctx_1 installed and adopted

Therefore meaningful context/persistence work exists in the repo.

VERIFY exact implementation and commit history directly.


P4
--

Content + validator + semantics + context manifest.

The approved first legitimate context should include both canonical Goals rather
than intentionally shipping a knowingly incomplete fake context.


P5
--

Durable context package persistence + initial adoption + deriving current context
from the adoption head.


P6a
----

Pure evaluator core.

Conceptually:

isHolderSatisfied(
    holderRef,
    ledgerRows,
    contextPackage,
    side
)

or an equivalent approved API.

Evaluator should be:

- deterministic
- pure
- explicit-input based
- independent from UI
- independent from IndexedDB reads
- independent from localStorage reads
- independent from network

It should support the approved requirement forms and dependency semantics.

IMPORTANT:
Inspect the repository to determine whether P6a is already implemented.
Do not assume based only on this handoff.


P3 — EVIDENCE TAP
-----------------

This phase was deliberately moved until after evaluator/context foundations.

The purpose is to let real workout execution generate new Evidence while the
legacy product remains operational.

Important migration rule:

Before final cutover, the legacy product may temporarily continue writing its old
session/benchmark/progression structures while the new architecture ALSO appends
Evidence.

This temporary double-write situation is an explicit migration exception.

Rules:

- legacy writes remain authoritative for the legacy product until cutover
- new Evidence is authoritative only as factual input to the new/shadow engine
- new engine must not derive truth from legacy progression writes
- legacy engine must not derive truth from shadow evaluations
- no bidirectional synchronization
- cutover ends the exception


IMPORTANT GROUP LOG FINDING
---------------------------

Legacy Group Log was found unsuitable as a reliable Evidence source.

Historically it behaved like mutable weekday state rather than append-only dated
observations:

- overwritten weekday slots
- insufficient date identity
- repeated mutation
- no reliable occurrence identity
- no useful supersedes lineage

Therefore Group Log was deliberately removed from the initial Evidence Tap scope.

Do NOT invent fake:

- dateKey
- occurredAt
- dedupeKey
- supersedes

A separate Group Activity Observation Model can be designed later if needed.


PRE-PERFORMANCE DEPENDENCY CONTEXT
----------------------------------

When generating Evidence, if validity depends on whether dependencies were already
satisfied, evaluate dependency state against the ledger BEFORE adding the new row.

New Evidence must not retroactively make its own prerequisite true.


PER-SET DATA
------------

Legacy execution may collapse detailed runner state into summarized session
results.

For the new Evidence Tap, detailed observations should be captured before that
collapse where needed.

Examples:

- per set
- per ladder step
- per timed hold


P6b — SHADOW EVALUATION
-----------------------

New engine output should first be compared in shadow mode.

Shadow mode is non-authoritative.

Its purpose is to identify disagreements safely before source-of-truth cutover.


SOURCE-OF-TRUTH CUTOVER
-----------------------

Only after the new path is proven should the legacy progression-state write path be
severed.

Do not allow both engines to independently become authoritative at the same time.


======================================================================
11. LEGACY / EXISTING APP CONTEXT WORTH KNOWING
======================================================================

Historical repo investigation found several useful facts.

Verify they are still true before relying on them.


OLD STORAGE
-----------

The app historically used localStorage heavily.

Known current-style keys included:

- spc_c_profile
- spc_c_state
- spc_c_sessions
- spc_c_bench
- spc_c_settings
- spc_c_plan
- spc_c_templates
- spc_c_adhoc
- spc_c_workout
- spc_c_day

There were also legacy read-only `puc_*` sources.

Backup/restore was specifically designed around preserving raw values.


OLD DAILY FLOW
--------------

`daily.js` / DailyWorkout historically resembled the future Workout abstraction.

History normalized multiple generations of session records.

A single Daily completion could historically create more than one session record.

Do not assume those legacy records map cleanly one-to-one to new Evidence.


OLD PLANNING
------------

Legacy planning contained hardcoded/day-driven behavior and multiple historical
vocabularies.

This is one reason the architecture moved toward explicit progression-first content
and interpretation.

Do not preserve old conceptual vocabulary merely because it exists in code.


EXISTING WORKOUT PRIMITIVES
---------------------------

The current app has useful execution primitives worth preserving.

Examples historically included:

- standard sets/reps
- Pyramid
- Ladder
- timed holds
- timers
- daily workout queue

These should remain domain-agnostic where possible.


======================================================================
12. VISUAL / DESIGN DIRECTION
======================================================================

The approved visual personality is:

QUIET PAPER, EARNED ILLUSTRATION


THE APP SHOULD NOT LOOK LIKE
----------------------------

- a blue SaaS dashboard
- a dark bodybuilding app
- a crypto dashboard
- a dense quantified-self app
- a collection of cards
- a gamified mobile game
- a generic component library demo


CORE VISUAL LANGUAGE
--------------------

Direction:

- warm paper / off-white background
- near-black "ink" text
- clay as primary accent
- sage for positive / achieved state
- restrained ochre if useful
- generous whitespace
- hairlines/dividers rather than cards everywhere
- very limited elevation
- confident typography
- serif selectively for larger/editorial moments
- clean sans-serif for functional UI
- no gradients
- no glow
- no neon
- no excessive shadows


DESIGN METAPHOR
---------------

The app should feel closer to:

a beautifully designed training notebook / coaching journal

than:

a dashboard.


EARNED ILLUSTRATION
-------------------

Illustration should appear when it creates value.

Good uses:

- Goal identity
- Assessment instruction
- progression milestone
- meaningful unlock
- movement explanation where visually necessary

Bad uses:

- an illustration beside every exercise
- decorative clutter in the runner
- filling whitespace simply because the screen feels empty


TRAINING MODE
-------------

During active training:

clarity beats decoration.

Runner/timers/set entry should have little or no decorative illustration.


======================================================================
13. PRODUCT/UI DECISION FILTER
======================================================================

For every visible element ask:

"What decision does this help the athlete make right now?"

If there is no strong answer:
remove it.

If useful but not required by default:
move it to detail.

If used rarely:
move it to Settings.

If only the engine needs it:
do not show it.

This rule is especially important because the previous UI became overloaded by
exposing technically available information merely because it existed.


======================================================================
14. IMPORTANT PRODUCT DECISIONS ALREADY MADE
======================================================================

These are considered decided unless actual implementation exposes a genuine
contradiction.


A. PROGRESSION-FIRST
--------------------

Workouts are generated outputs.
Progression State is persistent truth.


B. FEW ACTIVE GOALS
-------------------

Keep active Goals small in number.

Typical target:
1–3.


C. MULTIPLE PARALLEL PROGRESSIONS
---------------------------------

A Goal may depend on several capabilities progressing independently.


D. PERFORMANCE UNLOCKS
----------------------

Demonstrated capability unlocks progression.

Time alone does not.


E. MOBILITY
-----------

Mobility should normally be treated as a limiter/capability.

It is not automatically a separate Goal or Skill.


F. READINESS IS ENGINE-LEVEL
----------------------------

Readiness can modify today's prescription without changing underlying Progression
State.


G. USER AUTONOMY
----------------

Dependencies constrain:

- prescription
- unlocking
- interpretation

They generally should not prohibit a user from attempting/logging a movement.


H. WEEKLY PLAN STABILITY
------------------------

Once the weekly plan is shown/accepted:

do not silently rewrite it.

Readiness can adapt Today.

Schedule changes should be visible and usually athlete-approved.


I. CLAIMED CAPABILITY
---------------------

Claimed ability can help initialize the model where appropriate.

It must not be treated as equally trustworthy as demonstrated Evidence in protected
contexts.


J. "SKILL" AS FORMAL ONTOLOGY
-----------------------------

"Skill" was retired as a formal engine ontology category because it created
unnecessary ambiguity.

Plain-language UI may still naturally use the word when appropriate.


K. NO AUTOMATIC GRAPH UI
------------------------

The engine may be graph-like.

That does NOT mean the user needs to see a graph.

Visualization must earn its place by answering one of the four core user
questions better than simpler presentation.


L. HISTORY IS NOT THE PRODUCT
-----------------------------

History is useful but secondary.

The product is about forward progression, not retrospective logging.


M. TODAY IS THE CORE DAILY EXPERIENCE
-------------------------------------

Today should be extremely simple.

Its job is not to expose everything the engine knows.


N. SETTINGS IS NOT A PRIMARY TAB
--------------------------------

Settings gets a persistent gear entry point.


O. THIS WEEK IS NOT A PRIMARY TAB
---------------------------------

Weekly plan remains accessible but moves under Settings / control flow.


P. TRAIN NOW IS AN ACTION, NOT A TAB
------------------------------------

There was explicit discussion about adding a separate "Train Now" tab.

Decision:
do NOT add one.

If a workout is scheduled:
Start Workout is the primary action.

If the day is open:
Train Now can become the contextual primary action.

The workout runner itself is a temporary mode.


======================================================================
15. THINGS INTENTIONALLY DEFERRED
======================================================================

Do not invent solutions for these merely because they are not finished.


DETAILED GOALS UI
-----------------

Purpose is clear.

Exact final layout is not yet locked.


EXACT GRAPH VISUALIZATION
-------------------------

No commitment that a graph should be visible at all.


DETAILED READINESS SCORING
--------------------------

Recovery/Readiness exists as an engine concept.

Detailed scoring and presentation are not finalized.


FRESHNESS / DECAY
-----------------

Schema should support future policy.

Initial semantics may be:

freshness = none


REGRESSION POLICY
-----------------

Schema should support it.

Initial semantics may be:

regression = none


CLAIM EXPIRY
------------

Not fully decided.


ATLEAST(N) REQUIREMENTS
-----------------------

Deferred.

Do not implement a generalized rule engine preemptively.


GROUP ACTIVITY OBSERVATION MODEL
--------------------------------

Deferred because existing Group Log semantics are insufficient.


FULL GOALS REDESIGN
-------------------

Should follow the new app shell / Today work rather than being improvised in
parallel.


DETAILED PLAN / THIS WEEK REDESIGN
----------------------------------

The screen remains functionally necessary, but it is no longer primary navigation.

Its detailed redesign can happen after core shell/Today/Goals are coherent.


MONETIZATION / SOCIAL / COMMUNITY
---------------------------------

Not part of the current implementation focus.


NUTRITION
---------

Explicitly outside this product.


======================================================================
16. THINGS THAT MUST NOT BE BROKEN
======================================================================

Treat these as high-risk regression areas.


DATA SAFETY
-----------

- existing athlete data
- backup/restore compatibility
- raw legacy data where still needed
- context adoption
- durable storage


WORKOUT EXECUTION
-----------------

- ability to start a workout
- exercise ordering
- logging
- timers
- timed holds
- ladder/pyramid flows
- workout completion


HISTORY
-------

Existing completed workouts/history must remain accessible.


PWA
---

- installation
- offline use where supported
- service-worker updates
- cache version behavior


MIGRATION BOUNDARIES
--------------------

Do not accidentally make new shadow architecture authoritative before approved
cutover.


DOMAIN PHILOSOPHY
-----------------

Do not alter training/product methodology merely to make implementation easier.

If implementation is difficult:

first question the technical representation,
not the progression-first philosophy.


CONTENT TRUTH
-------------

Do not invent:

- stages
- criteria
- exercises
- athlete capability
- progression status

for UI convenience.

If data required by a design does not exist truthfully:

use an honest fallback or presentation adapter,
or report the gap.


======================================================================
17. EXECUTION PLAN FROM HERE
======================================================================

IMPORTANT:

Before implementing this plan, inspect the current repository and git history.

Determine which engine/migration phases have already landed.

Do not repeat completed work.


PHASE UX-0 — REPOSITORY / PRODUCT AUDIT
---------------------------------------

Goal:
Understand what currently exists before changing the presentation layer.

Inspect:

- app shell
- routes/views
- Today rendering
- bottom navigation
- settings/profile
- Week / Plan
- Goals / Map / Progress legacy screens
- workout preview
- workout start path
- runner entry/exit
- open-day behavior
- free/custom workout behavior
- active Goal data currently available
- current-focus data currently available
- readiness data currently available
- history
- service worker
- relevant UI tests

Also inspect git history for:

- Backup/Restore phase
- durable storage
- P4/P5
- evaluator
- Evidence Tap
- any newer migration work not represented correctly in this document

DONE WHEN:

- you can clearly describe the existing product flow
- you know which parts can be reused
- you know which parts should be replaced
- you know the actual current migration phase
- no code has been duplicated due to stale assumptions


PHASE UX-1 — NEW APP SHELL
--------------------------

Build the simplified product shell.

Primary bottom navigation:

- Today
- Goals

Global:

- persistent gear/settings entry

Remove legacy primary nav destinations such as:

- Plan
- Profile
- Map
- Progress
- Week

from primary navigation.

Do NOT necessarily delete underlying screens/functions.

Route them appropriately.

Settings should expose access to relevant management/admin areas including
This Week.

DONE WHEN:

- app has only Today + Goals as primary destinations
- gear access is consistently available
- This Week/Profile/History/Data etc. remain reachable through secondary flows
- workout runner can still leave/return correctly
- no important functionality is orphaned


PHASE UX-2 — TODAY REBUILD
--------------------------

Rebuild Today as a calm Home/Coach screen.

Do not micro-patch the old dense layout.

Training day should expose only the essential hierarchy:

- date
- settings gear
- relevant Goal context
- current human-readable focus when truthfully available
- today's workout name
- optional reliable duration
- Start Workout
- View Workout secondary
- Train Something Else tertiary

Open day:

- Goal context
- Open Day
- Nothing scheduled
- Train Now

Readiness only appears when it actually affected today's prescription or input is
genuinely required.

DONE WHEN:

- default Today has no full exercise list
- only one obvious primary action exists
- user understands both Goal context and today's action within seconds
- workout preview remains accessible
- scheduled and open-day flows both work
- runner still works
- no fake Goal/progression state is hardcoded
- mobile Samsung-sized viewport is visually coherent
- existing functional tests remain green


PHASE UX-3 — VISUAL SYSTEM PASS
-------------------------------

Make the approved "Quiet Paper, Earned Illustration" direction consistent.

Establish:

- background/surface language
- typography
- spacing scale
- button hierarchy
- divider language
- accent use
- icon language
- illustration rules
- mobile spacing / safe areas

Avoid solving each screen independently.

DONE WHEN:

- app shell and Today feel like one intentional product
- design tokens / CSS conventions are reusable
- density is substantially lower than legacy UI
- the result no longer looks like the old UI recolored


PHASE UX-4 — GOALS PRODUCT DESIGN
---------------------------------

Do NOT blindly implement the old Map/Progress screens.

Goals needs a dedicated redesign based on:

- Where am I?
- What is missing?
- What matters next?

Likely structure:

Goals list
  ->
Goal Detail
  ->
supporting progression states / next requirements
  ->
assessment or evidence detail only when useful

Avoid meaningless global percentages.

Avoid exposing internal graph vocabulary.

DONE WHEN:

- active Goals are understandable at a glance
- Goal Detail makes current constraints and next steps clear
- supporting progressions are visible without becoming a technical dependency map
- user can understand why current training matters


PHASE UX-5 — SETTINGS / CONTROL CLEANUP
--------------------------------------

Once primary experience is stable, rationalize:

- This Week
- profile
- history/activity
- availability
- data/backup
- preferences

Settings should remain secondary.

DONE WHEN:

- low-frequency controls are organized coherently
- nothing administrative competes visually with Today/Goals
- This Week remains easy enough to find
- no important legacy capability is lost


PHASE UX-6 — RUNNER VISUAL CLEANUP
----------------------------------

Only after Today/Goals architecture is stable.

Preserve functionality.

Simplify execution UI if needed.

DONE WHEN:

- runner is fast and obvious
- no unnecessary progression/dashboard elements appear during sets
- timers/logging remain fully functional
- one-hand mobile use is comfortable


PHASE UX-7 — SECONDARY EXPERIENCES
----------------------------------

Later refine:

- assessments
- milestones/unlocks
- movement detail
- empty states
- adaptation explanations
- history storytelling

These can carry more illustration/personality where appropriate.


======================================================================
18. ENGINE MIGRATION PLAN MUST CONTINUE IN PARALLEL WITH UX, NOT BE REPLACED BY IT
======================================================================

The UI redesign does not invalidate the progression engine migration.

After inspecting actual repo state, continue the approved migration from the
current real phase.

The intended architecture remains:

Goal
 -> Progressions
 -> Requirements / Dependencies
 -> Evidence evaluation
 -> Progression State
 -> Planning
 -> Readiness
 -> Workout

UI should consume this architecture through clean presentation boundaries.

Do not let the new UI become a second hidden source of progression truth.


======================================================================
19. OPEN QUESTIONS
======================================================================

These are genuinely open or not yet fully designed.


1. EXACT GOALS SCREEN
---------------------

We know its job.

We have not yet locked the final screen composition.


2. EXACT GOAL DETAIL VISUALIZATION
----------------------------------

Likely progression rows / capability states / current limiter.

Need final UX design.

A graph is not assumed.


3. MULTIPLE GOALS ON TODAY
--------------------------

Current direction:

Show the Goal most relevant to today's workout.

If a workout genuinely supports both Goals:
use a restrained "Supports: Goal A · Goal B" treatment.

Need final rule based on actual planning/domain data.


4. CURRENT FOCUS TEXT
---------------------

Example:

"Building transition control"

This is valuable only if it can be derived truthfully.

Need to determine:

- whether the engine currently exposes an explicit current focus
- whether a safe presentation adapter can derive it
- whether content needs user-facing labels

Do NOT hardcode fake state.


5. DURATION
-----------

Today may show:

~35 min

only if a sufficiently reliable estimate exists.

Otherwise omit it.


6. ILLUSTRATION
---------------

Small Goal/context illustration is desirable.

Exact asset/style system is not finalized.

Illustration must be purposeful and sparse.


7. THIS WEEK UI
---------------

We decided where it lives.

We have not finalized its new visual design.


8. SETTINGS STRUCTURE
---------------------

Exact grouping/order still needs refinement after inventorying actual settings.


9. HISTORY POSITION
-------------------

Currently expected inside Settings/control area.

Could later receive a better Activity entry point if user testing shows it is used
frequently enough.

Do not promote it prematurely.


10. ASSESSMENT UX
-----------------

Domain purpose is clear.

Detailed assessment screen design remains open.


11. MILESTONE / UNLOCK EXPERIENCE
---------------------------------

Should feel meaningful and visually richer than ordinary training.

Exact experience is open.


12. FUTURE AI ROLE
------------------

AI may eventually help with explanation/coaching/adaptation.

Core progression truth should remain deterministic and inspectable where possible.

Do not make the core engine dependent on generative AI simply because AI is
available.


======================================================================
20. DEVELOPMENT WORKING RULES
======================================================================

1. Inspect before rewriting.

2. Prefer clean boundaries over patches.

3. Do not ask the user about every minor visual choice.
   Make strong professional decisions inside the approved design system.

4. Do ask / stop if:
   - domain semantics would need to change
   - data safety is at risk
   - a migration invariant would be violated
   - a requested UI requires inventing nonexistent athlete truth

5. A large coherent rewrite of the PRESENTATION layer is acceptable.

6. A large rewrite of proven infrastructure without necessity is not.

7. Preserve tests.

8. Add tests around new behavior.

9. Do not weaken existing tests simply to make redesign code pass.

10. If production assets change, correctly handle service-worker cache/versioning.

11. Validate on a realistic mobile viewport.

12. Assume installed Samsung/Android PWA is an important real-world target.

13. Prefer progression over feature variety.

14. Prefer user clarity over engine visibility.

15. Prefer one strong action over five equal buttons.

16. Empty space is allowed.

17. Do not add components merely to fill the screen.


======================================================================
21. DEFINITION OF PRODUCT SUCCESS
======================================================================

The new app should eventually pass this test:

A new or returning athlete opens Skill Progression Coach.

Within approximately five seconds they understand:

- the Goal they are working toward
- the current focus of that journey
- what they should do today

They do not need to understand:

- dependency graphs
- evidence semantics
- interpretation contexts
- progression engine internals
- stage IDs
- readiness scores

When they want more detail:

Goals explains progress.

When they want control:

Settings exposes it.

When they are training:

Runner gets out of the way and helps them execute.

That is the intended product.


======================================================================
22. IMMEDIATE NEXT STEP FOR CLAUDE CODE
======================================================================

Do NOT immediately start changing random UI components.

First:

1. read this document
2. inspect the entire relevant repository structure
3. inspect recent git history
4. reconcile this handoff against current implementation state
5. identify:
   - what is already implemented
   - what is legacy
   - what can be safely reused
   - what should be replaced
   - current engine migration phase
6. then prepare/execute the new app-shell + Today redesign as a coherent product
   change, not a sequence of cosmetic patches

The first visible target is:

NEW APP SHELL
+
NEW TODAY / HOME

with:

Today | Goals

as the only primary bottom navigation,

a persistent settings gear,

and a dramatically simplified Today experience.

Do not perform a full Goals redesign until its detailed UX has been reviewed.

Do not reopen the core progression philosophy.

Do not throw away proven infrastructure.

The goal is not to make the current app slightly prettier.

The goal is to make the application finally feel like the product described in
this document.
