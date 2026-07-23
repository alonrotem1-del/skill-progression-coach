# Bouldering V5 — Skill-Tree Content Proposal (for review)

**Status: PROPOSAL — pending user review. Not implemented in the live app.**

This document is a reviewable proposal for expanding the Bouldering "Path to V5" world
from its current shallow shape (mostly grade consolidation + a few movement skills) into
the full multi-capability model discussed previously. It is a **candidate content set for
review, not an approval to implement every item.**

- Machine-readable proposal: [`coach/content/v5-skill-tree-proposal.json`](../coach/content/v5-skill-tree-proposal.json)
- Live app is **unchanged**: none of the `v5_*` nodes below are rendered anywhere until approved.

Counts: **40 candidate nodes** across **5 capability lanes**, **4 shared capabilities**,
and **5 relationship (edge) types**. The number was driven by the content in the brief, not
a target — several low-confidence nodes are explicitly flagged as merge/cut candidates.

---

## 1. The five capability lanes

| Lane | Focus | Nodes |
|---|---|---|
| **Grade Progression, Technique & Projecting** | The performance spine: V1→V5 plus footwork, movement vocabulary and projecting tactics | 16 |
| **Pulling Strength** | Pull-up base → weighted pulling → lock-off | 7 |
| **Grip, Finger & Forearm Capacity** | Active hang → grip endurance → forearm → controlled hang → (optional) fingers | 6 |
| **Core Strength & Body Tension** | Hollow body → leg raise → overhang tension → hip position → distant-hold tension | 5 |
| **High-Step & Single-Leg Strength** | High step → split squat → pistol → rock-over → on-wall integration | 6 |

The **grade lane is the only lane that gates the V5 milestone with REQUIRED edges**. Every
other lane feeds V5 through **SUPPORTS** edges — capacity that makes V5 more accessible
without being a hard prerequisite. This is the core design correction: physical capabilities
support climbing performance, they do not block it.

---

## 2. Relationship (edge) types

Not every relationship is a mandatory prerequisite. The proposal uses five explicit types:

| Type | Meaning | Visual (proposed) |
|---|---|---|
| `REQUIRED` | Must be complete before the target unlocks | Solid edge |
| `SUPPORTS` | Helps but is not required (most cross-lane edges) | Dashed edge |
| `ALTERNATIVE` | A parallel movement/branch, not a sequential step | Dotted branch |
| `UNLOCKS_ASSESSMENT` | Completing it opens a performance attempt/test | Gold edge into a milestone |
| `SHARED_CAPABILITY` | The node mirrors one underlying capability shared with another world | Linked-node badge |

Worked examples from the brief:
- **10 Strict Pull-Ups** is `REQUIRED` before **Weighted Pull-Up** programming, but only
  `SUPPORTS` **First V5**.
- **Pistol Squat** `SUPPORTS` **High-Step / Rock-Over Strength**; it is never `REQUIRED` for V5.
- **Deadpoint**, **Flagging** and **Drop Knee** are `ALTERNATIVE` movement branches — parallel,
  not a chain.
- **Multi-Session Projecting** `UNLOCKS_ASSESSMENT` for the **First V5 Send**.

---

## 3. Shared-capability mechanism (cross-world)

Some capabilities support more than one goal. They must **not** be duplicated as unrelated
records in each world — a single underlying capability state should drive every world's view.

The proposal models this with a `sharedCapabilities` array. Each entry names one underlying
capability, the worlds it appears in, the per-world node that renders it, and the benchmark
key that is the single source of truth:

```json
{ "id": "cap_pull10", "name": "10 Strict Pull-Ups", "benchKey": "pullup_max",
  "worlds": ["muscleup", "boulder"],
  "nodeByWorld": { "muscleup": "mu_pull10", "boulder": "v5_pull_10" } }
```

Rendering rule: a world shows its own view of the shared node (its own position, its own
supporting edges), but **completion and progress come from the one shared benchmark**
(`pullup_max`, `deadhang_secs`, …), never from two independent records.

Proposed shared capabilities (each spans ≥ 2 worlds):

| Shared capability | Benchmark | Worlds | muscleup node | boulder node |
|---|---|---|---|---|
| 10 Strict Pull-Ups | `pullup_max` | muscleup, boulder | `mu_pull10` | `v5_pull_10` |
| Weighted Pull-Up | `weighted_pullup_kg` | muscleup, boulder | (future) | `v5_pull_wbench` |
| Active Dead Hang | `deadhang_secs` | muscleup, boulder | `mu_deadhang` | `v5_grip_deadhang` |
| Hollow Body / Core Tension | — | muscleup, boulder | `mu_hollow` | `v5_core_hollow` |

---

## 4. Required vs optional summary (what actually gates V5)

- **REQUIRED spine:** Consolidate V1 → V2 → V3 → First V4 → Consolidate V4 → **First V5**,
  with **Multi-Session Projecting** as the `UNLOCKS_ASSESSMENT` gate.
- **Everything in the Pull / Grip / Core / Legs lanes is `SUPPORTS`** at the V5 milestone —
  none of it is marked as a universal V5 requirement.
- **Active Dead Hang** and **Hollow Body** are marked `required: true` only as *foundations
  within their own lanes* (sensible entry points), not as gates on the V5 send.
- **Advanced finger strength is explicitly optional and advanced**, never a beginner default.

---

## 5. Safety / evidence caveats (highlights)

- **Advanced Finger Strength** — optional, advanced only; high injury risk; gate behind years
  of climbing and no finger pain. Never a default.
- **Controlled Hanging Capacity** — large edges / jugs only; explicitly *not* small-edge
  fingerboarding.
- **Weighted Pull-Up** — requires 10 strict pull-ups first; do not program load earlier.
- **First V5 Send** — gate on no active pain before a maximal attempt.

---

## 6. Open questions for review

1. Is 40 nodes too dense for a first cut? Low-confidence merge/cut candidates: `v5_proj_rest`
   (merge into Structured Attempts), `v5_leg_weighttransfer` (merge into on-wall integration),
   `v5_pull_explosive` (may be out of scope for a first V5).
2. Should `v5_core_legraise` be a **shared** node with the muscle-up world's `mu_knee`?
3. Confirm the Weighted Pull-Up benchmark target (proposed +20% bodyweight for a clean single).
4. Should the grade lane keep both **First V4** and **Consolidate V4**, or collapse to one?

---

## 7. Full proposed node table

Columns: Node ID · Capability Lane · Node Name · Type · Description · Criteria ·
Incoming Prerequisites · Relationship Type · Goals Supported · Required/Optional ·
Recommended Exercises · Safety/Evidence Caveat · Proposed Map Position · Confidence / Rationale.

| Node ID | Capability Lane | Node Name | Type | Description | Criteria | Incoming Prereqs | Relationship Type | Goals Supported | Required/Optional | Recommended Exercises | Safety/Evidence Caveat | Map Position | Confidence / Rationale |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| v5_grade_v1 | Grade Progression, Technique & Projecting | Consolidate V1 | strength | Several V1 problems across multiple styles — not a single lucky send. | 4 problem (V1 problems); 2 styles (Different styles) | — | — | boulder | REQUIRED | ring_row | — | col 1, row 1 | high — Matches the existing live b_v1 milestone; carried forward unchanged. |
| v5_grade_v2 | Grade Progression, Technique & Projecting | Consolidate V2 | strength | Deepen movement vocabulary at intermediate grade. | 4 problem (V2 problems); 2 styles (Different styles) | v5_grade_v1 [REQUIRED]; v5_tech_silentfeet [SUPPORTS] | REQUIRED, SUPPORTS | boulder | REQUIRED | — | — | col 2, row 1 | high — Existing live milestone. |
| v5_grade_v3 | Grade Progression, Technique & Projecting | Consolidate V3 | strength | Grade where technique starts to matter more than raw strength. | 3 problem (V3 problems); 2 styles (Different styles) | v5_grade_v2 [REQUIRED]; v5_tech_flag [SUPPORTS]; v5_pull_5 [SUPPORTS] | REQUIRED, SUPPORTS | boulder | REQUIRED | — | — | col 3, row 1 | high — Existing live milestone. |
| v5_grade_v4first | Grade Progression, Technique & Projecting | First V4 | milestone | A grade jump requiring good footwork and body tension. | 1 problem (V4 send) | v5_grade_v3 [REQUIRED]; v5_core_overhang [SUPPORTS]; v5_leg_highstep [SUPPORTS]; v5_tech_dropknee [SUPPORTS] | REQUIRED, SUPPORTS | boulder | REQUIRED | — | — | col 4, row 1 | high — Existing live milestone (b_v4). |
| v5_grade_v4 | Grade Progression, Technique & Projecting | Consolidate V4 | strength | Make V4 reliable across styles before projecting V5. | 3 problem (V4 problems); 2 styles (Different styles) | v5_grade_v4first [REQUIRED] | REQUIRED | boulder | optional | — | — | col 5, row 1 | medium — New node — consolidation reduces the jump to V5; optional but recommended. |
| v5_grade_v5 | Grade Progression, Technique & Projecting | First V5 Send | milestone | The central milestone of this world — a clean V5 send. | 1 problem (V5 send) | v5_grade_v4 [REQUIRED]; v5_proj_multi [UNLOCKS_ASSESSMENT]; v5_core_tension [SUPPORTS]; v5_pull_10 [SUPPORTS] | REQUIRED, UNLOCKS_ASSESSMENT, SUPPORTS | boulder | REQUIRED | — | Gate on no active pain before a maximal attempt. | col 6, row 1 | high — Existing live milestone (b_v5). |
| v5_tech_silentfeet | Grade Progression, Technique & Projecting | Silent Feet | skill | Precise, quiet foot placement — the base of efficient technique. | 2 sessions (Focused sessions) | — | — | boulder | optional | — | — | col 1, row 2 | high — Existing live skill. |
| v5_tech_flag | Grade Progression, Technique & Projecting | Flagging | skill | Balance without an extra foothold — saves energy. | 2 sessions (Intentional practice) | v5_tech_silentfeet [REQUIRED] | REQUIRED | boulder | optional | — | — | col 2, row 2 | high — Existing live skill; a movement branch, not a strict prerequisite for V5. |
| v5_tech_dropknee | Grade Progression, Technique & Projecting | Drop Knee | skill | Brings the body closer to the wall and extends reach. | 2 sessions (Intentional practice) | v5_tech_flag [ALTERNATIVE] | ALTERNATIVE | boulder | optional | — | — | col 3, row 2 | medium — Movement vocabulary; ALTERNATIVE branch to flagging rather than sequential. |
| v5_tech_deadpoint | Grade Progression, Technique & Projecting | Deadpoint | skill | Dynamic catch at the peak of movement. | 2 sessions (Intentional practice) | v5_tech_flag [ALTERNATIVE] | ALTERNATIVE | boulder | optional | — | — | col 3, row 3 | medium — Distinct movement branch — parallel to flagging/drop-knee, not a chain. |
| v5_tech_heelhook | Grade Progression, Technique & Projecting | Heel Hook | skill | Foot as a third hand on overhangs. | 2 sessions (Intentional practice) | v5_tech_deadpoint [SUPPORTS] | SUPPORTS | boulder | optional | — | — | col 4, row 3 | medium — Existing live skill. |
| v5_proj_preview | Grade Progression, Technique & Projecting | Route Preview / Reading | foundation | Plan the sequence before climbing — saves attempts. | 3 sessions (Previews) | v5_grade_v2 [REQUIRED] | REQUIRED | boulder | optional | — | — | col 3, row 0 | high — Existing live tactic. |
| v5_proj_crux | Grade Progression, Technique & Projecting | Crux Identification | foundation | Isolate the hardest move and a plan for it. | 2 sessions (Crux sessions) | v5_proj_preview [REQUIRED] | REQUIRED | boulder | optional | — | — | col 4, row 0 | medium — New tactic node split out from generic projecting. |
| v5_proj_attempts | Grade Progression, Technique & Projecting | Structured Attempts | foundation | Work a hard problem methodically rather than flailing. | 2 sessions (Project sessions) | v5_proj_crux [REQUIRED] | REQUIRED | boulder | optional | — | — | col 5, row 0 | medium — Existing live projecting, renamed for clarity. |
| v5_proj_rest | Grade Progression, Technique & Projecting | Rest Between Attempts | foundation | Full recovery between hard tries to preserve quality. | 2 sessions (Disciplined rest sessions) | v5_proj_attempts [SUPPORTS] | SUPPORTS | boulder | optional | — | — | col 5, row 2 | low — New node; may merge into Structured Attempts if it feels redundant in review. |
| v5_proj_multi | Grade Progression, Technique & Projecting | Multi-Session Projecting | milestone | Commit to a project across sessions until sent. | 1 problem (Project send) | v5_proj_attempts [REQUIRED]; v5_proj_rest [SUPPORTS] | REQUIRED, SUPPORTS | boulder | optional | — | — | col 6, row 0 | high — Existing live milestone; UNLOCKS_ASSESSMENT for First V5. |
| v5_pull_first | Pulling Strength | First Strict Pull-Up | foundation | The entry pulling milestone; shared with the Bar Muscle-Up world. | 1 reps (One clean pull-up) | — | SHARED_CAPABILITY | boulder, muscleup | optional | pullup, ring_row | — | col 0, row 4 | high — SHARED capability — reuse pulling state, do not duplicate. |
| v5_pull_5 | Pulling Strength | 5 Strict Pull-Ups | strength | Pulling base for steep terrain; shared with Bar Muscle-Up. | 5 reps (Consecutive pull-ups) | v5_pull_first [REQUIRED] | REQUIRED, SHARED_CAPABILITY | boulder, muscleup | optional | pullup | — | col 1, row 4 | high — SHARED capability. |
| v5_pull_10 | Pulling Strength | 10 Strict Pull-Ups | strength | Strength reserve for repeated hard pulls; supports V5 without being required. | 10 reps (Consecutive pull-ups) | v5_pull_5 [REQUIRED] | REQUIRED, SHARED_CAPABILITY | boulder, muscleup | optional | pullup | SUPPORTS V5, not REQUIRED — strong climbers send V5 without 10 strict pull-ups. | col 2, row 4 | high — SHARED capability with mu_pull10. |
| v5_pull_wintro | Pulling Strength | Weighted Pull-Up Introduction | strength | Introduce light added load once 10 strict pull-ups are solid. | 3 sessions (Weighted sessions) | v5_pull_10 [REQUIRED] | REQUIRED | boulder, muscleup | optional | weighted_pullup | REQUIRES 10 strict pull-ups before adding load — do not program weight earlier. | col 3, row 4 | medium — New node; gates weighted work behind a bodyweight base. |
| v5_pull_wbench | Pulling Strength | Weighted Pull-Up Benchmark | strength | A meaningful added-load benchmark (e.g. +20% bodyweight for a clean single). | 20 weight (Added load (% bodyweight)) | v5_pull_wintro [REQUIRED] | REQUIRED, SHARED_CAPABILITY | boulder, muscleup | optional | weighted_pullup | SUPPORTS V5 performance; never a hard requirement to attempt V5. | col 4, row 4 | low — SHARED capability; exact target to be confirmed in review. |
| v5_pull_lockoff | Pulling Strength | Lock-Off Control | strength | Hold a bent-arm lock while the other hand reaches. | 10 sec (Bent-arm hold) | v5_pull_5 [REQUIRED] | REQUIRED | boulder | optional | lockoff | — | col 3, row 5 | high — Existing live b_lockoff, folded into the pulling lane. |
| v5_pull_explosive | Pulling Strength | Explosive Pulling | power | Fast pulling power for dynamic moves; optional support. | 3 sessions (Power sessions) | v5_pull_10 [SUPPORTS] | SUPPORTS | boulder | optional | fastpull | Optional — only relevant for dynamic/overhang styles. | col 4, row 5 | low — New optional support; may be out of scope for a first V5. |
| v5_grip_deadhang | Grip, Finger & Forearm Capacity | Active Dead Hang | foundation | Active shoulders + grip endurance base; shared with pull-up development. | 30 sec (Stable active hang) | — | SHARED_CAPABILITY | boulder, muscleup | REQUIRED | deadhang, activehang | — | col 0, row 6 | high — SHARED capability (deadhang_secs). |
| v5_grip_endurance | Grip, Finger & Forearm Capacity | Grip Endurance | strength | Sustained gripping capacity over a climb, not a single max. | 45 sec (Repeater hang capacity) | v5_grip_deadhang [REQUIRED] | REQUIRED | boulder | optional | activehang | — | col 1, row 6 | medium — New node; endurance distinct from max grip. |
| v5_grip_forearm | Grip, Finger & Forearm Capacity | Forearm Strength | strength | General forearm/flexor strength to protect elbows and hold harder positions. | 4 sessions (Forearm sessions) | v5_grip_deadhang [SUPPORTS] | SUPPORTS | boulder | optional | wrist_roller | — | col 2, row 6 | medium — New node; general (not finger-specific) forearm work. |
| v5_grip_wristroller | Grip, Finger & Forearm Capacity | Wrist Roller / General Forearm | support | Wrist roller or equivalent — balanced forearm development, elbow health. | 4 sessions (Wrist-roller sessions) | v5_grip_forearm [ALTERNATIVE] | ALTERNATIVE | boulder | optional | wrist_roller | — | col 3, row 6 | medium — ALTERNATIVE means of building forearm capacity. |
| v5_grip_hangcap | Grip, Finger & Forearm Capacity | Controlled Hanging Capacity | strength | Controlled hangs on progressively smaller jugs/edges (large holds only). | 20 sec (Controlled hang on a large edge) | v5_grip_endurance [REQUIRED] | REQUIRED | boulder | optional | activehang | Large edges / jugs only. NOT small-edge fingerboarding. | col 2, row 7 | medium — Bridges hang endurance to on-the-wall grip without finger loading. |
| v5_grip_finger | Grip, Finger & Forearm Capacity | Advanced Finger Strength (Optional) | strength | Structured small-edge / fingerboard hangs — advanced only. | 6 sessions (Supervised fingerboard sessions) | v5_grip_hangcap [REQUIRED] | REQUIRED | boulder | optional | — | OPTIONAL and ADVANCED. Not a beginner default. High finger-injury risk; gate behind years of climbing and no finger pain. | col 3, row 7 | low — Explicitly optional per brief; must never be a default V5 requirement. |
| v5_core_hollow | Core Strength & Body Tension | Hollow Body Hold | foundation | A tight body line; shared with the Bar Muscle-Up world. | 30 sec (Stable hollow hold) | — | SHARED_CAPABILITY | boulder, muscleup | REQUIRED | hollow | — | col 0, row 8 | high — SHARED capability. |
| v5_core_legraise | Core Strength & Body Tension | Hanging Knee / Leg Raise | strength | Bring the feet up under control — essential for steep footwork. | 10 reps (Controlled raises) | v5_core_hollow [REQUIRED] | REQUIRED | boulder, muscleup | optional | — | — | col 1, row 8 | high — New node; overlaps mu_knee — candidate shared node. |
| v5_core_overhang | Core Strength & Body Tension | Overhang Body Tension | strength | Keep the feet on the wall on steep terrain. | 3 sessions (Overhang sessions) | v5_core_legraise [REQUIRED] | REQUIRED | boulder | optional | — | — | col 2, row 8 | high — Existing live b_overhang. |
| v5_core_hip | Core Strength & Body Tension | Controlled Hip Position | skill | Turn the hip to the wall to reduce load and extend reach. | 2 sessions (Hip-position drills) | v5_core_overhang [SUPPORTS] | SUPPORTS | boulder | optional | — | — | col 3, row 8 | medium — New node; technique/strength blend. |
| v5_core_tension | Core Strength & Body Tension | Tension Between Distant Holds | strength | Maintain whole-body tension across a big span without cutting feet. | 3 sessions (Tension sessions) | v5_core_overhang [REQUIRED]; v5_core_hip [SUPPORTS] | REQUIRED, SUPPORTS | boulder | optional | — | — | col 4, row 8 | medium — New node; SUPPORTS First V5. |
| v5_leg_highstep | High-Step & Single-Leg Strength | Controlled High Step | strength | Load and stand up on a high foot with control. | 6 reps (Controlled high steps / leg) | — | — | boulder | optional | high_step | — | col 1, row 9 | high — New lane root; directly SUPPORTS First V4/V5. |
| v5_leg_splitsquat | High-Step & Single-Leg Strength | Deep Split-Squat Foundation | strength | Single-leg strength base before pistols. | 8 reps (Deep split squats / leg) | v5_leg_highstep [SUPPORTS] | SUPPORTS | boulder | optional | pistol_squat | — | col 2, row 9 | medium — New node; foundation for single-leg strength. |
| v5_leg_pistol | High-Step & Single-Leg Strength | Pistol Squat Progression | strength | Full single-leg squat — strong high-step and rock-over power. | 3 reps (Clean pistol squats / leg) | v5_leg_splitsquat [REQUIRED] | REQUIRED | boulder | optional | pistol_squat | SUPPORTS high-step strength; NOT required to climb V5. | col 3, row 9 | medium — New node; SUPPORTS, never REQUIRED for V5. |
| v5_leg_rockover | High-Step & Single-Leg Strength | Rock-Over Strength | strength | Commit weight over a high foot and stand through it. | 3 sessions (Rock-over drills) | v5_leg_pistol [SUPPORTS]; v5_leg_highstep [REQUIRED] | SUPPORTS, REQUIRED | boulder | optional | — | — | col 4, row 9 | medium — New node; ties leg strength to wall movement. |
| v5_leg_weighttransfer | High-Step & Single-Leg Strength | Weight Transfer | skill | Smoothly shift weight between feet to unweight the hands. | 2 sessions (Weight-transfer drills) | v5_leg_highstep [SUPPORTS] | SUPPORTS | boulder | optional | — | — | col 3, row 10 | low — New skill node; may merge with High-Step integration. |
| v5_leg_wall | High-Step & Single-Leg Strength | High-Step Integration on the Wall | skill | Apply high-step and rock-over strength on real problems. | 3 sessions (On-wall integration sessions) | v5_leg_rockover [REQUIRED]; v5_leg_weighttransfer [SUPPORTS] | REQUIRED, SUPPORTS | boulder | optional | — | — | col 5, row 9 | medium — New node; SUPPORTS First V4/V5. |

---

## 8. Proposed new exercises (not yet in the live catalog)

| ID | Name | Category | Purpose | Equipment |
|---|---|---|---|---|
| `wrist_roller` | Wrist Roller | Grip | Balanced forearm development, elbow health | Wrist roller + light plate |
| `pistol_squat` | Pistol Squat | Legs | Single-leg strength for high steps / rock-overs | Bodyweight (optional support) |
| `high_step` | High-Step Drill | Legs | Loaded high-step and stand-up control | Box or high foothold |

These would be added to the live Exercise Library **only if** the corresponding lanes are approved.

---

**V5 content proposal created for user review; not yet implemented.**
