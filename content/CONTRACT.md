# Content contract

Rules that content must satisfy and that code may rely on. Technical Schema v1.1
defines the shapes; this file records the decisions that give two of its fields
their meaning, where the schema left the meaning implicit. Everything here is
executable: `tools/validate-content.cjs` enforces the structural half and
`tests/content.spec.cjs` / `tests/semantics.spec.cjs` enforce the rest.

## ExerciseLink.relation decides evidence eligibility

`ExerciseLink` carries `relation: train | assess | maintain` (§4). What that field
means for evaluation is now fixed:

| relation | Prescribable | Evidence-eligible |
|---|---|---|
| `assess` | yes | **yes** — observations of this exercise may be evaluated against the linked holder's Criteria |
| `train` | yes | **no** |
| `maintain` | yes | **no** |

> **TRAIN DOES NOT IMPLY EVIDENCE ELIGIBILITY.**

An observation that reaches a holder only through a `train` link is **not
applicable** to that holder's Criteria. It is not *excluded*: every exclusion
reason in §7 (`dependency_unmet`, `claimed_not_eligible`, `missing_attribute`,
`wrong_side`, `stale`) is a reason a piece of evidence was set aside, and this row
was never evidence about this Criterion — the same standing as an observation of
an exercise that does not record the attribute at all.

### Why this is structural, not a policy

It is **not** an entry in `content/vocabulary.json`, it cannot vary between
`EvaluationSemantics` versions, and adopting a new context can never change it.
The field has one stable meaning. A policy such as
`trainEvidenceEligibility = true|false` would make the same content mean two
different things depending on which semantics version an athlete is pinned to,
which is exactly the ambiguity this rule removes.

A genuinely new kind of evidence relationship is a **new role**, added through the
ordinary schema versioning process — not a reinterpretation of an existing one.

### No "harder than" exceptions

There is no evaluator allowlist and no rule that a `train`-linked exercise may
satisfy a Criterion because it is harder than what the Criterion asks for.
Eligibility is explicit in content or it does not exist. A substitution that
should count is written as a **second `assess` link**, visible to anyone reading
the bundle.

Bundle 1 has exactly one such case. The weighted pull-up assesses all three
Vertical Pull Strength stages at `rank: 2`, because those Criteria condition on
`reps` and `kip` and say nothing about load — "strict" governs the kip, not the
weight — and adding load cannot make a rep easier. It is an authored `assess`
link, not an exception.

### What the validator checks

| Rule | Check |
|---|---|
| V8 | every condition attribute of a holder's Criteria is produced by an **assess**-linked exercise. A train-only exercise is never counted. |
| V11 | a `sideScope: each` Criterion has a unilateral **assess** link with `sideScope: each`. |
| V19 | every Criterion has at least one assess route: an assess-linked exercise, at one of its holders, producing **all** its condition attributes with a compatible side scope. |
| V20 | every `assess` link can assess something at its target — otherwise `train` was meant. |

No rule treats the roles as interchangeable.

## Dependencies never invalidate a demonstration

Bundle 1 ships no `Dependency` that constrains `evidence_validity`, and no hard
`Dependency` whose subject is a Goal terminal. An unmet Dependency changes what is
prescribed and what is opened up; it never changes what a clean demonstration
means. A proxy capability must not overrule the performance it is a proxy for —
if the terminal Criterion measures depth and control directly, a mobility
measurement does not get to veto it.

The `evidence_validity` mechanism itself remains part of the schema and is pinned
by `tests/semantics/fixtures/dependency-unmet-excluded.json` against a fixture
bundle, for a later bundle that needs it.

Enforced by content.spec 24–26.
