# Factorized heads-up river engine — release audit

**Status:** accepted as an isolated exact-card river experiment

**Contract:** [factorized river engine specification](factorized-river-engine-spec.md)

## What changed

The earlier compact engine stored the same 21-state public betting tree once for every compatible
pair of private hands. The factorized engine now stores that public tree once. Beside it, the engine
keeps an exact list of the private-hand pairs that card removal permits, their probabilities, and
their showdown results.

Nothing about the poker game changed. The readable configurable game still decides which actions
are legal, how ranges are parsed, how chips are settled, and how hands are scored. The new engine
changes only how those facts are stored and traversed.

This remains heads-up river hold'em with explicit ranges, whole-chip bet sizes, and at most one
raise. It is not a preflop solver, a multi-street solver, a continuous-bet-size solver, or a claim
of exact GTO frequencies.

## Locked wider fixture

```text
board                     2c 3d 4h 7s 9c
range combinations        76 per player after board blockers
compatible private deals  5,052
public betting states     21, stored once
equivalent repeated tree  106,093 states
information sets          608
starting pot              100 chips
stack behind              100 chips each
opening choices           check, bet 50, bet 100
later raise               raise to 100 after a 50-chip bet
```

The earlier compact public entry point rejects this game because it exceeds 50,000 repeated states.
The factorized entry point admits it under separately named limits of 10,000 compatible deals and
250,000 equivalent repeated states.

## Differential evidence

The audit compared the factorized implementation with both the readable object-tree engine and the
repeated compact engine.

| Comparison | Maximum difference |
|---|---:|
| Ordinary-CFR saved probabilities | exactly `0` |
| Ordinary-CFR current probabilities and regrets | exactly `0` |
| CFR+ probabilities on the 106,093-state fixture | exactly `0` |
| Profile value, legal best-response values, choices, and exploitability | exactly `0` chip |

The tests also compare 20 fixed mixed profiles and 40 generated mixed profiles with the readable
scorekeeper. On a reduced game, the factorized best-response values match exhaustive pure-strategy
search. Repeating the same solve produces the same strategies, regrets, checkpoints, and grade.

## Hidden information remains hidden

Each information set contains only:

- the acting player's private hand;
- public chip amounts and action history; and
- the public board, through the versioned game definition.

It never contains the opponent's private hand. The best-response checker combines every compatible
hidden opponent hand before choosing one action for that information set.

A regression test also runs an intentionally illegal checker that chooses after seeing the complete
deal. That checker obtains a strict advantage on the reduced fixture. The legal factorized checker
does not receive that advantage, which makes this a meaningful boundary test rather than a test
where both methods happen to tie.

## Approximation quality

After 400 alternating CFR+ iterations with a 20-iteration averaging delay, the independent
factorized scorekeeper reports:

| Measurement | Result |
|---|---:|
| Exploitability | `0.008281800` chip |
| Locked acceptance ceiling | `0.25` chip |

Here, exploitability means half the sum of both players' gains from switching to their exact legal
best responses. That definition is valid because this game is heads-up and zero-sum. The result is
a close approximation under this finite game definition; it does not prove a unique exact
equilibrium or apply to unrestricted hold'em.

## Measured storage and time

The locked local audit ran under Node `v24.10.0` on `arm64`:

| Measurement | Repeated compact tree | Factorized tree |
|---|---:|---:|
| Structural typed arrays | `5,310,106` bytes | `88,463` bytes |
| Solver working arrays | `4,297,224` bytes | `54,008` bytes |
| Median 50-iteration CFR+ solve | `179.693 ms` | `168.070 ms` |

The factorized structural arrays are **1.67%** of the repeated compact arrays on this fixture. The
observed solver speed ratio was only **1.07×**. The win is storage, not a dramatic runtime claim:
both engines still visit every compatible deal and public state on every regret pass.

Those byte totals cover the named typed arrays, not the whole JavaScript process. The factorized
best-response checker uses a `166,528`-byte information-set index and about `3,401,192` bytes of
working arrays because exact grading still reasons over repeated deal/public states. Improving that
temporary grading memory is possible future work; hiding it would make the audit misleading.

Timings are machine-specific observations, not performance promises.

## Six-perspective review

### Expert CTO — pass as an isolated, reversible layer

The rules engine, repeated compact implementation, and readable scorekeeper remain intact as
oracles. The factorized compiler and solver have a separate namespace, algorithm name, limits, and
audit command. Nothing is connected to the trainer or written into an accepted strategy artifact.
The milestone can be removed without changing existing product behavior.

### Expert poker player — pass for the declared game

Card blockers are applied before deal probabilities are normalized. Position, call amounts,
minimum full raises, short all-ins, unmatched-chip returns, folds, ties, and exact river showdowns
still come from the audited configurable game. The result says nothing about flop or turn play and
does not pretend that a fixed bet menu covers every no-limit option.

### Expert math professor — pass with clear definitions

Ordinary CFR has two independent differential references. CFR+ has explicitly counted alternating
regret passes and a separate information-set best-response grade. The chance weights, opponent
reach, own reach, zero-sum utilities, Nash gap, and exploitability convention are stated. Low
exploitability is reported in chips, not translated into an unsupported “percent optimal” score.

### Expert poker teacher — pass as infrastructure, not yet a lesson

The library can calculate strategies and action values for wider exact river ranges, but no raw
regret or unexplained frequency is shown to a learner. A later teaching layer must explain the
range, price, fold chance, showdown result, and action-value difference in plain language. This
milestone does not change learner-facing copy.

### Expert product person — pass with the boundary visible

The work removes a real capacity bottleneck without expanding the public promise. It is useful
evidence for a portfolio: a measured representation change, preserved correctness, and an honest
result that memory improved far more than speed. It remains a lab engine until a separate product
review decides which inputs and explanations a learner actually needs.

### Expert software engineer — pass

Compilation, solving, grading, poker rules, fixtures, and public wrappers are separate. Limits fail
before the solve. Tests cover index equivalence, ordinary-CFR equivalence, CFR+ equivalence,
generated profiles, exhaustive reduced-game responses, hidden-card cheating, deterministic output,
wide input, convergence, malformed options, and resource rejection. The audit reports the
scorekeeper's remaining repeated-state memory instead of counting only favorable arrays.

## Known limits and next move

- Runtime remains proportional to compatible deals times public states times iterations.
- The exact scorekeeper deliberately allocates work arrays across deal/public states.
- Suit isomorphisms are not merged.
- There is no subgame sampling, abstraction, worker parallelism, WebAssembly, or native engine.
- There is no automatic bet-size discovery.
- The 10,000-deal and 250,000-equivalent-state limits are intentionally conservative.
- No generated artifact or four-player trainer behavior changed.

The next justified experiment is not “add every street.” First profile the factorized engine at its
declared ceiling. If grading memory is the bottleneck, stream or compress the legal best-response
state values while retaining the repeated and readable checkers as bounded references. If regret
passes dominate, consider suit isomorphism or deterministic parallel deal batches. Earlier streets
should begin only under a separate abstraction and validation contract.

## Defensible portfolio claim

> I replaced a repeated 106,093-state river layout with one 21-state public tree plus 5,052 exact
> blocker-compatible deals. Structural typed-array storage fell to 1.67% of the repeated layout,
> while ordinary CFR, CFR+, strategy values, and legal best responses remained numerically
> identical to independent implementations. The result is a bounded heads-up river experiment,
> not a full hold'em solver.

Do not shorten that to “I built a complete poker solver.”
