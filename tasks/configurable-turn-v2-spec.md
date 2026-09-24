# Configurable turn/river v2 — M3 locked contract

2026-09-23, baseline `ca0d8a8`. Locked before implementation and new acceptance solves.
Parent: [CPU-first plan](cpu-postflop-solver-plan.md). M3 does not complete M4 or M5.

## Scope and rules

Offline, heads-up, zero-sum, four known board cards, explicit weighted ranges, exact
river enumeration, whole-chip money, player 0 first on both streets. No rake, sampling,
neural leaves, GPU, new UI, preflop/flop solve, or claim of exact/universal GTO.

New `TurnV2Request`: `id`, `version: 2`, `board`, `rangeText`, `committedPerPlayer`,
`stackBehind`, and `streets: [turnMenu, riverMenu]`. Each menu contains:

- `openingTargets`: one to three distinct positive whole-chip street targets;
- `raiseTargets`: zero to three distinct positive whole-chip street targets;
- `raiseLimit`: zero or one raise **after** an opening bet;
- `includeAllIn`: a required boolean, adding the actor's exact remaining street capacity
  to either applicable menu, without duplicating another legal target.

Canonical menus sort numerically. Reject duplicate declared targets and malformed/unknown
fields. A nonzero raise limit requires a declared raise target or explicit all-in option.
An unavailable normal target is skipped, **never clipped to stack**. A normal target equal
to the actor's all-in is legal even if the all-in option is off. New targets are absolute
total contributions on the **current street**; payments are target minus already paid on
that street. They are not total money across both streets and not percentages of pot.

The game starts with equal prior contributions and zero street contributions. Check/check
or a capped call closes a street. Fold ends the hand. Betting requires an opponent with
chips; a player facing an outstanding wager may call/fold but cannot raise into an all-in.
Opening minimum is one chip in this declared finite game (there is no inferred blind size).
A full raise increases the outstanding target by at least the last full bet/raise increment.
A smaller increase is allowed only when it uses the actor's entire remaining stack.
There is at most one raise per street in this version; a two-raise expansion is deferred.
In heads-up play a short all-in leaves no non-all-in aggressor to raise against, so it
cannot reopen a further raise. Test this explicitly rather than using the raise cap alone.

At street closure return unmatched excess, carry only matched contributions forward,
and restore returned chips to the bettor's remaining stack. At the river, reset both
street contributions, current bet, previous full increment, raise count and check count;
do not reset total money, stacks or remembered turn history. If either stack is zero,
enumerate rivers without later betting. Terminal utility is net chips relative to the
declared prior contribution and all later payments/refunds. Ties split the contestable pot.

Each compatible private pair has 44 legal rivers at 1/44; the public union has 48 cards.
Root mass remains proportional to both weights times physical compatibility. The v2
information key includes only actor, own hand, visible board and both remembered public
histories. Future river cards stay hidden at every turn decision.

## Architecture and preservation

New public rules, bounded compiler, readable adapter, independent money replay, fixtures,
offline CLI/artifacts and tests live under `postflop/configurable-turn/` and new scripts.
Reuse audited M2 range and terminal kernels. Extract the minimal schema-neutral vector
game interface and parameterize the existing session/grader by action type, keeping their
arithmetic/order unchanged. The math backend/checkpoint version stays `vector-turn` v1;
the canonical game identity explicitly binds `turn-v2` rules and v2 inputs. V1 and v2
checkpoints cannot be interchanged. No second copied CFR or grader implementation.

The readable v2 adapter materializes private pairs only for small differential/oracle
tests, capped at 8 combinations/player, 16 compatible deals and 100,000 repeated states.
The production compiler builds public topology directly, without a representative deal.
Count a card-independent skeleton with factors 48 (public union) and 44 (per private pair)
before wide allocation; stop bounded counts early. No full private-pair/public-state tree.
Use the same CFR/CFR+ conventions, tolerances and exact terminal primitives as M2.
The independent vector grader still never calls regret/update code.

Preserve every old strategy artifact and public limit. M2's accepted complete policy and
payload must reproduce after any shared type/interface extraction. The readable turn-v1,
river-v3 and independent payout implementations remain unchanged.

## Preflight and offline resource contract

64 unblocked combinations/player, relative weights >=1e-12 of each player's maximum,
16,384 characters/range, amounts <=1,000,000, 100,000 iterations. Before allocating the
wide index/workspaces refuse >20,000 public nodes, >250,000 information-set upper bound,
>750,000 action-slot upper bound, 32 MiB estimated checkpoint JSON, or estimated peak
above **2 GiB**. This M3-specific ceiling uses the already approved parent's 2 GiB envelope;
M2's 1 GiB cap is unchanged. Count maps/strings, snapshots, grading, serialization and
parent checkpoint copies conservatively, not just typed arrays. Refuse larger menus/trees
instead of silently pruning them. A bounded request is not a promise of convergence.

Use one isolated solve worker. Limit total job time to ten minutes including preflight,
compile, grade and export; use the smaller of 2 GiB and one eighth of reported physical
RAM as admission/runtime budget. Record worker and parent memory observations separately;
sampled RSS and V8 heap caps are not an OS-enforced or free-memory guarantee.
Progress counts completed iterations and reports the last grade with its iteration.
Cancellation/timeout returns no accepted policy. Preserve complete saved iterations.
Fresh-path checkpoint publication, checksum/semantic validation and bit-identical
same-iteration resume remain mandatory. Existing M2 checkpoint limits stay unchanged.

## Locked acceptance corpus

All start with 50 chips contributed per player (100-chip pot). All ranges are explicitly
handcrafted teaching/test assumptions, not solved preflop ranges or imported proprietary data.
Each example has the same quality gate: exploitability <=**0.25 chip**, with <=0.10 preferred,
and a ten-minute/2 GiB job budget. Use CFR+, delay 20; grade at 256, 1,024, 4,096, 16,384,
65,536 and 100,000, accepting the first qualifying checkpoint. Save full versioned, hashed
policies and reproducible grades. No fixture/threshold change after its first solve.

The primary `turn-v2-wide-64` uses the unchanged board and both weighted ranges of
`POSTFLOP_M2_PROBE` (M2 input hash
`279c58fd54b45fac11db44dcd2e840335496d6dbd69c400038e1bc37ce34f533`).
It therefore has 64 combinations each and 3,773 compatible deals. Stacks are **100/100**.
Turn opening targets **25,50**, raise target **100**; river openings **10,25**, raise target
**50**. Both raise limits 1; both all-in options false. A legal raise must exist on both
streets. This synthetic fixture tests wider capacity, not realistic preflop range selection.

Additional named examples, with one raise allowed on both streets:

| ID / teaching purpose | Board | First range | Second range | Stacks | Turn openings / raises | River openings / raises | All-in option, both streets |
|---|---|---|---|---|---|---|---|
| `turn-v2-dry-value`, pairs versus draw/ace possibilities | As 7d 4h 2c | AcAd AhKd QcQd | 7c7h 6s5s AhQh | 100/100 | 25,50 / 100 | 10,25 / 50 | false |
| `turn-v2-paired-short`, paired board and unequal stacks | Kh Kd 7s 2c | AcAd QcQd KsJs | 7c7h AhQh JcTc | 90/60 | 20,40 / 60 | 10,20 / 40 | true |
| `turn-v2-two-tone`, made hands and flush draws | Ks 8s 4d 2c | AsQs KdKh AcAd | QsJs 9h9d 7s6s | 120/120 | 30,60 / 120 | 20,40 / 80 | false |
| `turn-v2-connected`, straights/draws and unequal stacks | Jh Th 9c 2c | AsKs QhKh JcJd | Qc8c 9h9d AcQc | 80/130 | 20,40 / 80 | 10,20 / 40 | true |

Freeze additional held-out small rule/grade cases (not acceptance-tuned): stacks 17/5,
37/61 and 0/20; overlapping private hands and nonuniform weights; double-paired river
ties; three declared sizes; targets equal to, below and beyond stack; shared-card removal.
These are audit cases, not evidence of learned generalization.

## Required mathematical evidence

- Enumerate tiny public lines and compare legal actions, every payment/refund, carried
  money, terminal utilities and slow showdown scores to an independent history replay
  that does not invoke the production transitions.
- Reduce no-raise single-size requests to v1. The adapter explicitly selects
  `min(oldBet, actorRemainingStack)` at each state; this legacy cap is **not** a change to
  v2 normal-target semantics. Compare public histories/keys through a declared mapping,
  all endpoints, short ordinary-CFR updates and independent grades.
- Reduce completed-turn river continuations to compatible v3 scenarios: prior money is
  original commitment plus matched turn contribution, stacks are actual remaining chips,
  river targets are street-relative. Compare fixed-policy values and responses, not a
  separately solved river equilibrium to a joint-turn continuation. Test conditioned
  hand weights after earlier actions and river blockers. Zero-stack continuations are
  direct showdown checks because v3 refuses zero starting stacks.
- Compare vector and readable CFR at 1/2/10/100 iterations; compare both kernels and
  graders on complete uniform, pure, seeded mixed and solved policies. Keep all M2
  hidden-hand/future-card cheating and exhaustive best-response regressions.
- Exact discrete equality; finite probabilities sum within 1e-12; value/payoff tolerance
  1e-10*S, S=max(1, max absolute terminal utility); short policy tolerance 1e-9; accumulated
  regrets/averages 1e-9*max(1,iterations*S). Investigate failures, never widen to pass.
- Seek a genuinely compatible external numerical referee. Do not copy/link external
  solver code or introduce licensing obligations. Record incompatibility/unavailable
  tooling honestly; absence of an external match is not an external-validation claim.

## Release gate and next step

Focused mathematical/session/worker/CLI tests, all existing unit tests, unchanged artifact
reproduction/audits, profiling, type-check, lint, production build and existing browser
keyboard/responsive checks. Test the exact staged export without unrelated dirty trainer
work. Document any existing browser flake; do not stage or overwrite unrelated changes.
Update README, roadmap and parent execution record only with verified results. Ship M3
only after the 64-combination, two-size, both-streets-raise fixture and corpus pass their
quality gates. Next is M4's thin saved-turn explorer, not an implicit flop/GPU expansion.

## Changelog

- **2026-09-24** — Uncallable-target collapse (matches river v2/v3, commit `401ed22`): a
  legal opening or raise target above the opponent's reachable street total
  (`stackBehind[opponent] - carried`) is offered as one target equal to that total;
  duplicates are removed. This amends "never clipped" above only for the opponent side:
  targets beyond the actor's own stack are still skipped. Payoffs are unchanged (the
  excess was always returned). `turn-v2-paired-short` gains a declared 512-iteration
  floor because its regenerated 256-iteration grade (0.125) missed the 0.10 preferred
  bar; the 0.25 gate, grade schedule and locked inputs are unchanged. Details and new
  hashes: [audit amendment](configurable-turn-v2-audit.md).
