# River benchmark and strategy exchange — v1 contract

Date: 2026-09-22. Status: implemented and accepted; see the
[release audit](river-strategy-exchange-audit.md). This contract was written before implementation.

## Purpose and boundary

Make a small set of existing, bounded heads-up river games portable, then independently
grade a complete strategy produced elsewhere. This is a CLI/library milestone, not a new
poker game, GPU implementation, browser importer, or claim of exact equilibrium play.
The accepted v1/v2/v3 solver artifacts and mathematical engine must remain unchanged.

V1 supports four declared v3 games: the accepted two-raise example, a tiny weighted
blocker case, an unequal-stack short-all-in case, and a board-play/tie case. Each has a
fixed CFR+ iteration budget and averaging delay. Reference strategies are reproducible
baselines, not an assertion that every benchmark meets the original fixture's quality gate.

## Portable game

Export JSON with a format name and schema version, full normalized scenario, conventions,
exact compatible private deals and probabilities, public tree, and information sets.
Each public action edge names the action and child node. Each terminal contains player
zero's net chip utility for every private deal, in deal order; player one's utility is its
negative. Thus another implementation can reconstruct the entire finite game without
reimplementing hold'em rules or depending on TypeScript object layouts.

An information set contains the acting player, that player's cards, public-node index,
opaque stable key, and legal actions. It never distinguishes the opponent's hand.
The exported environment necessarily contains hidden deals to simulate and score play;
an agent's observation must use only its own information-set record and public facts.

Fingerprint the entire canonical payload with SHA-256. This exchange fingerprint is
separate from older artifact rule hashes; it binds the format, conventions, scenario,
chance probabilities, action graph, information-set partition, and terminal utilities.
It is an integrity/identity check, not authentication or a proof of implementation quality.
Bound exports to 100,000 equivalent repeated states, 128 combinations per range, and the
existing v3 input bounds. Keep the larger solver's limits unchanged.

## Imported policy and grade

A policy envelope names the format/version, game fingerprint, units, and a complete map
from the exported information-set keys to legal action probabilities. Require every legal
action, including zero-probability actions and decisions unreachable under that policy.
Reject extra fields, unknown/missing information sets or actions, non-numbers, non-finite
values, values outside [0,1], and distributions whose sum differs from one by over 1e-12
(the existing mathematical engine's tolerance). Export full precision, not rounded UI
percentages; producers of float32 probabilities must normalize in higher precision before export.
Never repair, silently renormalize, or fill missing policies with uniform play.

The importer binds policies to a trusted locally reconstructed benchmark, not a supplied
payoff table or self-reported score. A statewise map keyed by the opponent's cards must fail.
This enforces what the imported policy can condition on; it cannot certify the data or
training process used by its author. Value-only predictions are not accepted as policies.

Use the existing independent factorized scorekeeper to report both player values, both
legal best-response values and gains, Nash gap, and half-Nash-gap exploitability in net
chips per hand. Hash the canonical imported strategy separately for report provenance.
No monotonic-convergence, unique-frequency, general hold'em, or multiway claim is allowed.

## CLI and reproduction

Provide `list`, `export`, `solve`, and `grade` commands through one npm entry point.
The benchmark ID selects a trusted catalog entry. Export, policy, and grade output can go
to stdout or an explicit new output file; refuse to overwrite existing files. Reject
unknown flags, partial arguments, oversized/non-regular input files, and invalid JSON.
Do not load executable plugins, fetch remote policies, or change artifacts during grading.

A separate generation/check script maintains a small checked-in reference manifest with
game fingerprints, solver settings, strategy hashes, counts, and independent grades.
`--check` must not write it. Require byte-for-byte repeated generation without timings.
Add that audit and v3 reproduction to CI. No collaborator-specific adapter is possible
until its actual rules, output, and licensing are inspected.

## Acceptance gates

- Every exported deal, action edge, information-set coordinate, and terminal payoff agrees
  with the readable game; money/showdown values also agree with the independent oracle.
- Exported information sets do not grow when the same own hand has more possible opponent
  hands. A deliberately cheating per-deal strategy is rejected.
- JSON export/import preserves the complete existing v3 average strategy and its grade.
- Imported strategies match the readable independent grader, including generated mixtures
  and unreachable branches, within 1e-9 chip on all four benchmarks.
- Altered scenarios, payoff units, hashes, missing/extra actions, and malformed probabilities
  fail before grading. No quality score is emitted for invalid input.
- Reference manifest reproduces, old artifacts reproduce, and the full regression suite,
  type-checking, lint, production build, and existing browser checks pass.
- CLI tests cover round trips, machine-readable output, rejected input, resource bounds,
  and refusal to overwrite files. No UI changes or new dependencies are required.
