# Preflop v2 research — step 11

Prospective record, 2026-11-22, after `912616a` and all eight jobs in CI `45065228344`
passed. No new corpus estimates, continuation observations or fit have been taken yet.
The [step-10 contract](preflop-validation-v2-spec.md), immutable original contract,
selection transcript, 504 roots and all budgets/acceptance gates remain unchanged.

## Exact tiny joint reference (freeze before implementation)

This is a nine-card teaching/reference game, not ordinary full-deck Hold'em or a
recommended playing range. Use normal seven-card Hold'em hand ranking on this deck:
`As Ah Ks Kh Qs Qh Ac Ad 2c`.

- OOP hands/weights: `AsAh:1, KsKh:0.5, QsQh:0.25`.
- IP hands/weights: `AcAd:1, KsKh:0.5, QsQh:0.25`.
- Deal compatible private pairs with product weights. There are seven compatible pairs;
  the unnormalized partition is 2.75. No independent overlapping private draws.
- Initial stacks 10 chips, dead money 0.5. At the preflop entry IP has paid 1 and OOP 3.
  IP chooses fold or call 2. A call creates pot 6.5, with 7 chips behind each player.
- Deal each of the ten legal unordered flops given BOTH private hands with probability
  1/10. OOP then acts first: check or bet 2; IP may check/bet after a check, or fold/call
  facing a bet; OOP may fold/call facing an IP bet. No raises. After betting, deal the two
  remaining cards one at a time without replacement; no further bets. A fold ends play.
- Separate reductions use the same game with forced postflop checkdown, and with a single
  7-chip all-in size instead of 2. These are explicit variants, never substituted into
  the full-deck corpus. Returned uncalled chips, splits and full-hand accounting apply.
- Fixed reference profile, in the hand order above: IP preflop call probabilities
  `[1, 0.5, 0.25]`; OOP lead probabilities `[0.75, 0.5, 0.25]`; IP bet-after-check
  probabilities `[0.5, 0.5, 0.75]`; either seat's call-versus-bet probabilities
  `[1, 0.5, 0.25]`. These probabilities depend only on own hand and public history.
- Keys: preflop `pre|1|<own hand index>`; postflop
  `flop|<seat>|<own hand index>|<sorted flop cards joined>|<action history>`.
  Histories use `x` (check), `b` (bet), `c` (call), `f` (fold). Never include the other
  private hand or undealt cards. IP remembers the preflop call on every flop path.

The tree adapter uses the existing evaluator and generic CFR/grade interfaces. A second
oracle directly sums weighted terminal lines and groups hidden states BEFORE taking a
best-response maximum. It must not call the adapter's transitions, terminal-value helper
or the generic grader. On this particular deck the higher pocket pair wins and AA/AA
splits; check that independent ranking shortcut against every legal seven-card showdown.
The full-hand utilities sum to 0.5; subtract 0.25/player only at the generic zero-sum
interface. From-now `G` values retain the entire continuation pot and may be negative or
larger than 6.5. Test player permutation and origins separately.

Construct an immutable, blocker-aware **physical-pair** continuation table from the fixed
postflop policy and all legal boards. Compare its values and preflop-only action choices
against direct joint enumeration to 1e-10 chips. A fixed-continuation table does NOT
certify unrestricted future best responses. Grade full joint profiles independently and
test that this restricted grade is not advertised as a whole-game guarantee.

Hidden-card witness: IP `KsKh` on `AcAd2c` may face OOP `AsAh` or `QsQh`. The illegal
per-deal maximum can fold the losing hand and call the winning one. A legal response
must choose after summing those hidden states. Require a strict cheating advantage.

Also solve the base tiny game with the unchanged full-tree CFR implementation for exactly
16,384 iterations. Independently compare values and both best-response values to 1e-10;
maximum unilateral gain must be ≤0.01 chip. This is an approximate strategy for the tiny
game, not an exact equilibrium or full-deck validation. Tiny audit budget: 60 seconds and
512 MiB process RSS. A miss is recorded, never fixed by raising these gates after the run.
The existing native B2 referee games must still pass their 0.0002-chip agreement gate.

## Native capacity screen

Estimate every frozen root in manifest order, one child at a time, with the native
`estimate` command and `RAYON_NUM_THREADS=1`. This constructs public/card tables but
does not allocate strategy storage or perform iterations. Preflight timeout is 60 seconds
per child (within the original 600-second limit); sample child RSS every 50 ms and kill
at the original 16-GiB bound. A short process with no successful sample reports null,
never zero peak memory. Sampler failures are recorded, not silently labelled measured.

Use the existing strict estimate parser and compare spot id/hash, both hand counts,
memory cap and export scope to the exact input. Reserve **uncompressed engine bytes plus
the existing export working-byte estimate**, and enforce the frozen 12-GiB cap. That
export estimate is conservative engineering allowance, not measured native memory.
Report engine and export terms separately; do not infer actual solve RSS or time from
them. Save canonical input identity, original estimate bytes, timing, sampled RSS and
native binary/source identity. Never use int16 estimates to admit a float32 request.

Collect all 504 results even if some are refused. Process errors/timeouts are explicit
missing observations, not substitutes or permission to drop cases. Audit exactly one row
per frozen root, hashes, totals and refusal reasons. No large solve is allowed unless
EVERY required root passes. If this necessary gate fails, finish the independent tiny
work and report **capacity/coverage failure**, not evidence that the untested additive
candidate is mathematically invalid. PF4 stays blocked; independent steps 13/14 continue.

If admission passes, carry out the original four-hour experiment without changing its
candidate, calibration/holdout order, original-target errors or uncertainty requirements.
Freeze fitted parameters before measuring held-out values. Any further implementation
files for fitting/observation export will be declared here before writing them.

## Ownership and release

Owned additions: `src/lib/solver/preflop-v2/{table,tiny-game,tiny-oracle,preflight}.ts`,
`scripts/{audit,measure}-preflop-v2-research.ts`,
`test/preflop-v2-{table,tiny,preflight}.test.ts`,
`tasks/artifacts/preflop-v2-{preflight,tiny}.json`, this task record. Owned related edits:
package/CI audit wiring, preflop-v2 task/completion status, CPU roadmap, README research
hunks and final dated handoff. Frozen step-10 files, v1 model/artifacts, native engine,
production policies, protected trainer work and paused flop draft stay untouched.

- [ ] Failing tests precede new behavior; exact tiny joint measure, payoff representation,
  legal best responses, hidden-card witness and checkdown/all-in reductions pass.
- [ ] All 504 native estimates captured and independently re-audited; pass/fail recorded.
- [ ] Conditional large candidate experiment completed, or its necessary blocking gate
  recorded without claiming the model was fitted or falsified.
- [ ] Old artifacts/diagnosis/reference gates preserved; exact isolated commit, full tests,
  typecheck, lint, relevant audits and build as needed; explicit files; push and all CI green.

## Execution record

No new experiment result yet. Step 10's closure is recorded in its shared task document;
this milestone does not redraw its corpus or revise its acceptance conditions.
