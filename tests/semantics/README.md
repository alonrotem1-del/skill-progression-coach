# Behaviour-preservation fixtures

The harness described in the Implementation Plan §15. It ships in P4, **before the
evaluator exists**, so the evaluator is built to pass it rather than the fixtures
being written to match whatever the evaluator happens to do.

    fixtures/<case>.json     one of the 17 named cases
    bundles/mini-expr.json    a minimal bundle for the three expression cases
    reference.cjs             the hand-computed verdicts, in a different notation
    ../semantics.spec.cjs     the checker

## Fixture shape

    {
      name, description,
      bundle:      "bundle-1" | "<file in bundles/>",
      semantics:   [1],                every retained version this case must hold under
      commitments: { athleteGoals, constraints, preferences },
      ledger:      [ PerformanceObservation … ],   §6 shape, seq ascending
      expected:    { … see below … },
      alternates:  [ { note, ledger, expected } … ],   further scenarios of the same case
      scopeProgressions: [ progressionId … ]           required to assert limiters
    }

`expected` carries five sections. The first three are §15's; the other two exist
because two of the 17 named cases are about a Dependency verdict and five are
about how child statuses combine, and neither is expressible as a Criterion
evaluation:

    evaluations  { "<criterionId>|<side>|<contextId>": {
                     status, satisfiedBy[seq], excluded[{seq,reason}],
                     bestObservation{seq,attribute,value}, shortfall } }
    holders      { "<holderKey>|<side>": { status } }
    currentStage { "<progressionId>|<side>": stageId | null }
    limiters     { "<goalId>|<side>":       progressionId | null }
    dependencies { "<dependencyId>|<side>": { met, reason, blocks[holderKey] } }

`<side>` is `left`, `right`, `both`, or **`combined`** for the null side of a
combined-scope Criterion. `<holderKey>` is `progression:<id>`, `stage:<id>` or
`goalTerminal:<id>`. A dependency `reason` is `no_evidence`,
`claimed_not_eligible` or `null` when met.

## What the checker actually proves today

No evaluator exists, so nothing here proves the product computes these verdicts.
What it does prove:

1. **The verdicts are supported by the content and the policies.** For every
   evaluation the checker re-derives, from the bundle and the semantics-1 policy
   values alone, which observations may be cited and which must be excluded and
   with which reason — then requires `satisfiedBy` and `excluded` to match
   exactly. A fixture cannot assert a verdict the content does not support.
2. **The two halves agree.** `reference.cjs` states the same verdicts in a
   line-oriented notation, written from the policy values rather than copied, and
   every fixture is compared against it. Editing one side alone fails.
3. **The declarations are consistent with each other.** Holder statuses must
   follow `expressionStatusCombination: strict`; `currentStage` must be the
   lowest stage that is not satisfied; a limiter must be an incomplete
   progression inside the case's declared scope; a met hard Dependency may not
   rest on a provisional Criterion.

A row that simply fell short of a threshold is **not** excluded: exclusion is
about admissibility, and §7's reasons are all admissibility reasons. Such a row
is absent from both lists and may still be cited as `bestObservation`.

## Registering the evaluator (P6a)

    REF.registerEvaluator(function (fixture, semanticsVersion, scenarioIndex) {
      return /* an `expected`-shaped object */;
    });

With an evaluator registered, `interpret()` returns what the evaluator produced
and the same comparison becomes a test of the evaluator. `V18` in the content
validator takes the same seam: until an evaluator is passed to it, it reports its
evaluative half as PENDING rather than as a pass.

## Extension rule

When `content/vocabulary.json` gains a dimension, every fixture must still pass
under every semantics version it lists, with the new dimension resolved to its
`behaviourPreservingDefault`. That is what makes a vocabulary extension additive
rather than a silent reinterpretation of everything already recorded.
