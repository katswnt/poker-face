# River benchmark and strategy exchange v1 — release audit

Date: 2026-09-22. Status: accepted within the [locked contract](river-strategy-exchange-spec.md).
Usage and interoperability details: [exchange guide](river-strategy-exchange-guide.md).

## Delivered result

Poker Face can export four complete, bounded heads-up river games as versioned JSON,
export a CPU-generated policy, and independently grade a policy submitted in that format.
The CLI provides `list`, `export`, `solve`, and `grade`; library APIs use the same boundary.
No existing game rule, CFR arithmetic loop, scorekeeper, worker, route, or accepted
artifact was changed. No dependency or third-party implementation was added.

The exported environment contains exact compatible joint deals, their probabilities,
the public action graph, the legal information-set partition, and a player-zero payoff
for every terminal/deal pair. A consumer can run the game without reproducing our hand
evaluator. Player-one payoffs are the negatives, in net chips including old contributions.
Agent observations remain limited to their own cards and public information.

The policy importer requires every information set and legal action. It rejects wrong
format/version, mismatched fingerprints or units, extra/missing keys, statewise hidden-card
keys, invalid types, non-finite probabilities, probabilities outside [0,1], and sums outside
the existing engine's 1e-12 tolerance. It does not repair input or trust submitted scores.
The strict envelope cannot establish whether the author's training process had data leakage.

The CLI reconstructs a trusted catalog game rather than accepting arbitrary payoff tables.
It refuses file overwrites and caps policy input at 8 MiB, including the actual read after
the size check. Nonblocking open permits rejecting FIFOs without waiting for a writer.
Errors produce no grade and return a nonzero exit code. Export construction has a separate
100,000-equivalent-state cap; the larger solver's limits are untouched.

## Reproduced measurements

All four CPU reference policies use 1,000 CFR+ iterations and averaging delay 20.
They are measured reference approximations, not universal strategies or a claim that
all possible inputs meet any fixed convergence gate.

| Benchmark | Deals | Public / equivalent states | Information sets | Exploitability, chips/hand |
|---|---:|---:|---:|---:|
| v3-two-raise | 176 | 63 / 11,089 | 308 | 0.009074631 |
| weighted-blockers | 8 | 21 / 169 | 24 | 0.000665281 |
| short-all-in | 4 | 33 / 133 | 24 | 0.000002354 |
| board-ties | 3 | 24 / 73 | 18 | 0 |

The [checked-in manifest](../src/lib/solver/river/exchange/artifacts/benchmarks-v1.json)
records full-precision values, both deviation gains, game fingerprints, policy hashes,
settings, and independent checks. It reproduces byte for byte, with no timing fields.
All four saved-policy grades had zero measured difference from the readable grader;
the independent probability, terminal-money/showdown, and zero-sum checks also had zero
measured difference. These are floating-point enumeration results, not symbolic proofs.

The v3 policy round trip preserves the accepted strategy exactly. Its player-zero value
remains +16.081056725 chips, gains remain 0.014993444 and 0.003155818 chips, and its
original artifact SHA-256 remains
`320759e74808f8c5cb784b0e92c3410de02567252346d671a7b0a6eb722ea4e9`.
The exchange's game fingerprint is intentionally a different format-specific hash.

Pretty-printed game exports measured 248,614, 17,141, 19,388, and 14,023 bytes respectively.
The larger existing CPU boundary profile still passed at 10,240 deals, 87 public states,
and 890,881 equivalent states. No benchmark timing is a correctness or browser-safety gate.

## Test evidence

The full working-tree suite passed **438 unit tests**, including 36 new exchange tests.
Counts include the pre-existing uncommitted trainer/session tests, not just this commit.
The existing production Chromium suite passed **20 tests without retries**, including
keyboard operation, live worker solving/cancellation, mobile layouts, and 200% text.
There are no UI changes in this milestone; no new visual design or screen-reader
certification is claimed. The prior random-hand-dependent trainer-test risk remains
documented in the River Lab audit and is not repaired by this successful run.

New checks cover:

- Every exported compatible deal, legal edge, information-set coordinate, and terminal
  payoff against the readable game; every terminal payoff also against the separate oracle.
- A JSON-only consumer that independently evaluates the exported graph without using
  our compiled arrays, poker transitions, or hand evaluator.
- 32 reproducibly generated mixed strategies across the four games, compared with
  readable independent values and best responses, including the zero-sum/Nash-gap identities.
- The complete accepted v3 strategy, exact import/export identity, and unchanged grade.
- Two identical generations of the reference manifest.
- Fingerprint changes for different cards, range weights, stacks, prior contributions,
  betting menus, raise limit, units, and terminal payoffs.
- Zero-frequency actions and off-path decisions; rejection of incomplete and deliberately
  per-deal/hidden-opponent-card policies; rejection of prototype-like JSON keys.
- CLI subprocess round trips, clean JSON output, deterministic exports, invalid flags and
  iteration bounds, wrong-game policies, malformed/oversized/missing/non-regular files,
  and refusal to overwrite an existing file or the policy being graded.

Validation commands completed locally under Node v24.10.0 on arm64:

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
npm run audit:kuhn
npm run audit:leduc
npm run audit:river
npm run audit:river:v2
npm run audit:river:v3
npm run audit:river:exchange
npm run audit:river:compact
npm run audit:river:scorekeeper
npm run audit:river:factorized
npm run profile:river:factorized
```

Chromium used the existing `/private/tmp/poker-face-playwright` installation and permission
to bind the local test server. The production build passed both through the local browser
configuration and as a separate build command. CI now explicitly reproduces v3 and the
exchange manifest alongside the existing Kuhn/Leduc checks; this describes the committed
workflow, not an unobserved hosted CI result. Older multiway artifacts were graded by the
full unit suite but their longer regeneration scripts were not rerun in this milestone.

## Review perspectives and remaining scope

This is an internal engineering review, not a claim of external expert certification.

- **Math and poker:** no new game approximation was introduced. The exported finite game,
  payoff origin, action sizing, information sets, and grading convention are explicit and
  checked. No policies are compared by requiring unique equilibrium action frequencies.
- **Engineering:** imported JSON is data, not executable code. Game identity is tied to
  locally reconstructed rules; filesystem writes are explicit and non-overwriting in
  normal CLI use. The intentional manifest generator is separately named.
- **Teaching and product:** this makes the existing solver usable as a reference and
  scorekeeper for another implementation. It does not claim a GPU speedup or add poker
  strength. The guide distinguishes the environment's hidden state from legal observations.
- **Reproducibility:** fixed settings, hashes, deterministic generation, round-trip tests,
  and CI checks protect the exchange and existing accepted results.

No browser importer, GPU backend, neural model, collaborator adapter, arbitrary external
game loader, or held-out generalization benchmark is shipped. Public fixtures used for
training cannot also serve as independent held-out evaluation. Probability precision is
deliberately strict; external producers must export full-precision normalized values.
The repository's license still needs a user decision before code reuse is agreed.

The next independent product step is guided one-variable comparisons in the River Lab.
A collaborator-specific adapter can follow inspection of their repository; it is not
needed to keep improving the solver's teaching and verification tools.

All pre-existing unrelated files were preserved, and their contents checked against
initial hashes. Existing README edits remain local; only this milestone's additions
and corrections are included in its commit.
