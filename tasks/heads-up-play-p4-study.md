# P4 independent gadget study — frozen implementation contract

Started 2026-09-30, only after P1 diagnostic `f394fb7` passed exact-commit isolation
(884 unit tests, 16 Rust tests, typecheck, lint, build, audits, 82 saved-only Chromium
tests and four explicit live-only skips) and all eight jobs in CI `36773596576`.
P1 is blocked, so **no production play source, flop translation or `/play` work** is
authorized by this study. P4 as a whole is not complete.

## Design and scope, before measurements

Reuse the existing compact TypeScript CFR+ implementation and the separate information-set
best-response grader. Add a small-game subgame adapter, not another poker rules engine.
The caller supplies a public cut and the opponent's observable private-hand key. Traverse
the full original game under the blueprint to collect roots with both:

- counterfactual weight = chance reach × the resolving player's reach;
- modeled weight = counterfactual weight × the opponent's modeled action reach.

Never discard a hand merely because its modeled action reach is zero. Preserve original
information-set keys below the cut: the resolving player must not observe the gadget's
hand choice or opt-out decision. Reject cuts that split a continuation information set
between the subgame and the unchanged trunk. All state counting remains bounded by the
existing small-game audit limits; no browser limit changes.

Per-hand bounds are **conditional chip values**: each hand's counterfactual best response
divided by its positive counterfactual root mass. They come from an independently graded,
complete blueprint for the same expanded game, not from an abstract game's missing action.
Keep the conditional and unnormalized conventions explicit. Only the resolving player's
strategy is replaced; the other player's profile remains fixed for whole-game grading.

1. **Resolve:** chance chooses a root in proportion to counterfactual weight; the opponent,
   knowing only their own hand, can take that hand's bound or enter the original subgame.
2. **Max-margin:** the opponent chooses a starting hand, then chance chooses a compatible
   root conditional on that hand. Subtract that hand's bound from all opponent utilities;
   remove the opt-out. The resolving player cannot observe the hand choice. This maximizes
   the worst conditional margin, rather than an average weighted by the modeled range.
3. **Unsafe comparison:** normalize modeled weights at the cut and solve without a gadget.
   An off-tree action's modeled posterior is explicitly supplied from translation; it is
   not a Bayes posterior for an action with zero blueprint probability.

Finite CFR+ gives an approximate policy, not exact equilibrium. Grade every candidate's
per-hand best responses directly and report maximum increase and minimum margin. Record
the gadget's own Nash gap as well. A candidate is not accepted merely because an aggregate
gadget grade is small. Frozen acceptance: each protected hand's increase ≤ **0.0002 chips**;
whole-game opponent best-response increase ≤ **0.0002 chips**. This is an explicit research
solve-error target, not a new floating-point equality tolerance. Independent numerical
comparison tests use 1e-9 chips. Do not loosen either after seeing results.

## Frozen fixtures and comparisons

- Analytic Coin Toss from Brown & Sandholm: chance Heads/Tails 1/2; opponent Sell pays
  +0.5/-0.5; Play asks the resolving player to guess Heads/Tails or Forfeit. A correct
  guess pays the opponent -1, incorrect +1, Forfeit +1. Blueprint opponent plays with
  probabilities 3/4 and 1/2; resolver guesses Heads/Tails/Forfeit with 1/2, 1/4, 1/4.
  Bounds are 0 and 0.5; Max-margin optimum chooses Heads 5/8, Tails 3/8, margin 1/4.
  Exhaustive pure-response enumeration independently checks values and the unsafe failure.
- **River v3 demo**, with its original checked-in strategy unchanged outside one expanded
  branch: after OOP checks, allow IP a new 150-chip bet between the saved 100 and 200.
  All other menus/ranges/board/stacks stay fixed. AI is OOP. It can fold, call, or make
  the legal short all-in raise to 200. Both neighboring saved responses use only those
  actions, so translation needs no guessed size projection. Its lower-size weight is 0.4.
- **Turn v2 dry-value referee**, likewise preserving the saved strategy: after turn
  check/check, river Ks, OOP check, allow IP a new 20-chip river bet between 10 and 25.
  Only that public node gets the added action. Actual chips and 44 legal rivers per
  compatible deal remain in the full tree. The lower-size translation weight is 11/36.
  This is a river replacement inside a fully graded turn game, not a turn gadget claim.

For each poker fixture, define a complete expanded blueprint by the pseudo-harmonic
mixture of the two saved AI responses. The new action has zero probability in the
opponent blueprint at its parent. Below it the opponent's arbitrary profile is uniform;
best-response values do not depend on that placeholder. The new branch has only one AI
decision, so mixing these behavioral responses exactly represents the translation coin.
Use the translated opponent action likelihoods solely for the explicitly unsafe posterior.

Compare whole-game profiles: translation only, unsafe after the new bet, unsafe at its
parent (copy only the AI response below the new bet), Resolve, and Max-margin. Report
profile values, both best responses, both gains, half-Nash-gap exploitability, and the
opponent's change from the expanded blueprint. Do not conflate a single player's safety
with an unrestricted claim about changing both players' strategies. Hash the original
artifact inputs, resulting policies and deterministic numerical report.

Frozen solve budget: CFR+ with averaging delay 20 and checkpoints 1,000, 10,000, 100,000,
at most 200,000 iterations per solve. Choose the first checkpoint meeting the per-hand
and whole-game bars for gadget modes; report failure if none passes. Unsafe modes use
10,000 iterations and are measured without a safety pass requirement. Timing is measured
separately from the deterministic report. No training, native engine fork or deployment.

## Tests first and release gates

- [x] Analytic Coin Toss: exact blueprint bounds, unsafe failure, Resolve protection,
  Max-margin analytic optimum, exhaustive independent best-response agreement.
- [x] Zero modeled reach stays protected; blocker/counterfactual mass, seat reversal,
  invalid cuts, deterministic strategy and no hand-choice leak into AI information sets.
- [x] Both complete poker-game study rows, independently graded; unchanged checked-in
  solver artifacts reproduce. A failed numerical gate is recorded, not concealed.
- [x] Versioned/hash-bound report, repeatable byte for byte.
- [x] Full isolated exact-commit unit/tsc/lint/audits; push; every CI job green.

## Sources and guarantee boundary

The adapter follows [Burch, Johanson & Bowling (2014), subgame re-solving and Theorem 1](https://ojs.aaai.org/index.php/AAAI/article/download/8810/8669)
and [Brown & Sandholm (2017), §§4, 6 and appendices A–B](https://noambrown.github.io/papers/17-NIPS-Safe.pdf).
The former states the per-information-set protection condition; the latter supplies the
conditional-value convention, Max-margin gadget and the warning about missing-action
value estimates. Here bounds use an actual complete translated blueprint in the expanded
game. No safety claim is made versus a missing-action abstraction or for the Rust/browser
solver, whose API has no opt-out terminal. Reach gifts, estimated bounds and learned
continuation values are out of scope.

## Measured result

Report: [hu-play-p4-gadget-study.json](artifacts/hu-play-p4-gadget-study.json), payload
SHA-256 `909f2a92a2ebaad1c151bc5da5cca7c36d6c10d86aba5c22dc23980a6f10df30`.
The expanded river game has 12,145 states, 336 information sets and 176 compatible roots;
14 AI decisions are replaced and 14 opponent hands protected. The expanded turn game has
49,193 states, 6,936 information sets and eight compatible roots at the selected river;
three AI decisions are replaced and three opponent hands protected. No chance sampling.

All values below are chips. `Max hand gain` is the largest opponent conditional BR increase
over the expanded translated blueprint; negative means every protected hand improves for
the AI. `Whole-game gain` is the opponent's full-game BR change, **not** the AI's gain
against a fixed opponent. The report also includes both profile values and both BR values.

| Game | Policy | Iterations | Max hand gain | Whole-game gain | Profile exploitability |
| --- | --- | ---: | ---: | ---: | ---: |
| River | Translation | 0 | 0 | 0 | 0.214023810 |
| River | Unsafe | 10,000 | +75.486549604 | +9.202488671 | 4.815268145 |
| River | Unsafe at parent | 10,000 | -0.033173557 | -0.409898357 | 0.009074631 |
| River | Resolve | 1,000 | -0.001406501 | -0.000136917 | 0.213955351 |
| River | Max-margin | 1,000 | -1.220790529 | -0.118838561 | 0.154604529 |
| Turn | Translation | 0 | 0 | 0 | 0.052555375 |
| Turn | Unsafe | 10,000 | +6.111608389 | +0.015451633 | 0.060281191 |
| Turn | Unsafe at parent | 10,000 | +1.206626799 | -0.000818573 | 0.052146088 |
| Turn | Resolve | 100,000 | -0.000054893 | -0.000000139 | 0.052555305 |
| Turn | Max-margin | 1,000 | -0.068805872 | -0.000173958 | 0.052468396 |

Both gadget modes pass the unchanged 0.0002-chip per-hand and whole-game bars in both
games. Resolve on the turn fixture needed 100,000 iterations: the largest protected-hand
gain was +0.037341351 chips at 1,000 and +0.000546684 at 10,000, both above the gate.
The full report retains those failed attempts. These are independent deterministic budget
runs, not a resumable-session timing/progress claim. The benchmark rebuild took 6.8 seconds
on this M1 Pro (Node 24.10), including
whole-game grading and earlier failed checkpoints; timing is observational, not a gate
or byte-stable artifact field. These timings do not describe large-range browser play.

The unsafe-at-parent policy happens to beat the gadgets in the river fixture, but increases
one protected hand's value in the turn fixture even while whole-game BR improves. Neither
outcome establishes a universal ranking or a production default. Two curated cases cannot
estimate poker strength. Max-margin's protection is relative to the complete translated
blueprint, which can itself be exploitable. No exact GTO or global Rust-path guarantee.

### Tests and numerical cautions

The module-missing, report-missing and explicit underflow/negative-reach assertions failed
before their corresponding implementations. The compact CFR+ solver and original poker
rules are unchanged. The independent grader also re-grades saved policy replacements from
the report, rather than trusting displayed summary numbers. Analytic Coin Toss has an
exhaustive pure-response cross-check and known Max-margin solution.

A rare-hand regression constructs a gadget Nash gap below 1e-10 while an opponent hand
still gains **0.5 chips**. Therefore an aggregate gadget gap alone never accepts a policy.
Positive counterfactual reach underflow and invalid probabilities fail explicitly; the
model's zero-probability opponent hands are retained. The API requires a genuine public
cut and correct opponent augmented-hand labels from its caller; it rejects split ordinary
information sets but does not infer a poker observation model from arbitrary user code.

The turn record is a river response embedded in the full turn game. Live turn nested
solving, production flop action translation, cache coverage and `/play` remain unshipped.
No browser admission cap, quality target, preflop range or AGPL boundary was changed.

## Release commands and owned scope

```sh
node --import tsx --test test/river-resolving.test.ts test/gadget-study-fixtures.test.ts test/gadget-study.test.ts test/gadget-study-record.test.ts
npm run audit:hu-play:gadget
npm test
npm run typecheck
npm run lint
npm run audit:river:v3
npm run audit:turn:v2
npm run audit:bridge
npm run audit:bridge:library
npm run audit:preflop
```

Owned paths: `src/lib/solver/river/resolving.ts`; `scripts/gadget-study-fixtures.ts`;
`scripts/audit-gadget-study.ts`; the four test files above and `test/resolving-helpers.ts`;
this record and its JSON report; the P4 boxes in `heads-up-play-resolving-spec.md`; release
notes in the CPU-ceiling/solver-lab roadmaps; package/CI audit entries; README's browser/play
paragraph only. No edits to the existing math engines, app routes, trainer/session or paused
configurable-flop work. Exact-commit isolation and observed green CI are required before
this research increment is considered landed; P1 and production P4 remain blocked.

Clean-scope candidate verification (`f394fb7` plus the explicit paths above, copied—not
symlinked—`node_modules`): **899/899 unit tests pass, no skips**; typecheck and lint pass.
The gadget and P1 admission reports reproduce byte for byte. River-v3, the full turn-v2
corpus, native bridge, bridge library and diagnosed-preflop audits all pass unchanged.
No application code changed. Repeat these gates on the exact commit before push; the
closing handoff records its hash and observed hosted-CI result.

### Exact-commit verification

Commit `0fae3eda02bca1011e41066cd2aa623833dcb82d` was verified before push in the fresh
checkout `/private/tmp/poker-p4-commit.PaKJFb`, with copied, not symlinked, dependencies.
**899/899 unit tests pass, no skips; 16/16 Rust tests; typecheck, lint and production
build pass.** Both new reports reproduce byte for byte. River-v3, the full turn-v2 corpus,
native bridge, bridge library and diagnosed-preflop audits pass unchanged.

The first full unit run, concurrent with heavy audits, stalled in the existing
flop-explorer cancellation-test file with an idle child process. That file passed 7/7
independently. Only the identified stalled child was terminated; its explicit failed-run
log was retained. The unchanged full suite then passed 899/899 without concurrent audits.
No test, timeout or quality bar was changed, and the cause was not established. The
[closing handoff](codex-handoff-2026-09-30.md) identifies both logs and hosted CI status.

After push, all eight jobs in
[CI 36779205846](https://github.com/katswnt/poker-face/actions/runs/36779205846) were
observed green, including the unchanged domain suite, both new report reproductions,
native/WASM audits and the three-browser prepared Worker/UI checks. This lands the
independent research increment only; P1 and P4's production translation remain blocked.
