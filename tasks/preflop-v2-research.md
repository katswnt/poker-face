# Preflop v2 research — step 11

Prospective record, 2026-11-22, after `912616a` and all eight jobs in CI `45065228344`
passed. This opening protocol was frozen before new corpus estimates, continuation observations
or fitting; results are recorded separately below.
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
`test/preflop-v2-research-audit.test.ts`,
`tasks/artifacts/preflop-v2-{preflight,tiny}.json`, the immutable
`tasks/artifacts/preflop-v2-research-contract.md` copy, this task record. Owned related edits:
package/CI audit wiring, preflop-v2 task/completion status, CPU roadmap, README research
hunks and final dated handoff. Frozen step-10 files, v1 model/artifacts, native engine,
production policies, protected trainer work and paused flop draft stay untouched.

- [x] Failing tests precede new behavior; exact tiny joint measure, payoff representation,
  legal best responses, hidden-card witness and checkdown/all-in reductions pass.
- [x] All 504 native estimates captured and independently re-audited; pass/fail recorded.
- [x] Conditional large candidate experiment completed, or its necessary blocking gate
  recorded without claiming the model was fitted or falsified.
- [ ] Old artifacts/diagnosis/reference gates preserved; exact isolated commit, full tests,
  typecheck, lint, relevant audits and build as needed; explicit files; push and all CI green.

## Execution record

The 504-root capacity screen passed (report pending release audit); this permits the
original calibration experiment. Before any full-deck solve, declare these additional
owned files: `src/lib/solver/preflop-v2/observations.ts`,
`scripts/solve-preflop-v2-calibration.ts`, `test/preflop-v2-observations.test.ts`, and
`tasks/artifacts/preflop-v2-calibration.json` and the immutable execution-protocol copy
`tasks/artifacts/preflop-v2-calibration-contract.md`. This is an execution protocol, not a change
to the frozen input or acceptance gates.

Run the 144 profile-A legacy/calibration roots in their original manifest order, one
native process at a time, eight threads, exactly the frozen spot limits (600 seconds,
5,000 iterations, 0.001% pot target, float32). Sample RSS every 50 ms, retain raw stderr
progress and sampled peaks even on failure, and kill at 16 GiB. Include finalization and
export in the wall budget. Total solve wall time remains four hours; raw evidence remains
at most 1 GiB. Do not invoke any profile-B or board-holdout solve before fitted-parameter
hash freeze. Stop at the first necessary solve-quality, time, memory or coverage failure;
unattempted rows stay unmeasured, not inferred failures. No partial strategy or progress
checkpoint is a passing continuation observation. Preserve raw successful JSON and verify
it with the existing bridge contract; retain per-hand `engineEv` (payout minus future
contributions, OOP/IP order), without clipping or target shifts. Do not fit until all 144
calibration observations pass. If they do, declare and implement the already-frozen
additive candidate's fitting/export files before proceeding. A runtime/coverage failure
blocks PF4, but does not falsify a candidate that was never fitted.


## Measurements (2026-11-22)

- **Tiny reference passed.** Seven compatible private deals; 1,492 tree states, 567
  terminals, 638 chance nodes and 263 information sets. Full-tree CFR, 16,384 iterations:
  per-player gains 0.00009033023132803963 / 0.0000944719589283105 chips; exploitability
  (half their sum) 0.00009240109512817507 chips. Independent values and legal best-response
  values agree within 1e-10 on the fixed policies, varied policies and solved profile.
  Checkdown/all-in reductions, player swap, zero-probability own branches, negative
  continuations and values above the pot pass. The fixed-continuation grade is explicitly
  weaker than unrestricted joint-game grading. In the hidden-card witness a legal response
  is worth -3.25 chips; an illegal per-deal response appears worth -135/52 chips, a
  spurious advantage of 0.653846 chips. Artifact payload `bb0dc9e2b6f156c7f5a4c7a9e4d7bf969aa8c694de8cd2211246b09107f56bf3`.
- Final tiny generation took 3,217.069208 ms; process maximum RSS was 188,563,456 bytes
  (179.828 MiB), inside the 60-second/512-MiB gate. Runtime/RSS are measurements, not
  deterministic artifact fields. Original generation and reproduction logs are retained
  in `build/cpu-finish-2026-11-22/`.
- **All 504 native preflights passed.** 63,890.050149 ms summed wall time; no failed,
  refused or unsampled rows and no RSS sampling errors. Largest uncompressed engine
  estimate 12,627,754,408 bytes; largest export allowance 20,179,200 bytes; largest
  combined reservation 12,647,931,816 bytes (11.779304422438145 GiB). Component maxima
  need not occur on the same root. Largest sampled *preflight* RSS 34.890625 MiB.
  This did not allocate strategies, solve or measure solve memory. Saved report payload
  `b0071efa61bb597f204700ae09f1d16809a3edd22339c4cdde7162d38ff16ce9` is replayed from
  the original 504 rows, source hashes and frozen corpus in the audit.
- Fail-first logs cover the table/game/oracle, capacity wrapper, observation wrapper and
  saved-evidence audit. A test child using Node inherited the Node test-runner context,
  which redirected its diagnostics; replacing that fake executable with a shell fixture
  fixed the harness. The production runner and time/memory gates were unchanged.

Commands: `node --import tsx scripts/measure-preflop-v2-research.ts --estimate <new.json>`;
`node --import tsx scripts/solve-preflop-v2-calibration.ts --measure <preflight.json> <new.json>`;
`npm run audit:preflop:v2:research` (no full-deck solve); `npm run audit:preflop:v2:contract`;
`npm run audit:bridge`. Measurement commands refuse existing evidence files. The research
sources and native inputs are hashed before measurement and checked again on audit.


### Necessary coverage gate failed — PF4 remains blocked

The first root in the prescribed calibration order, `pfv2-srp-a-legacy-00-09-14`
(spot `a9e77fef43cc7c90f47ea20686e0df80dcf04cdb15b446281a8d952693bbfc59`),
hit the 600,000-ms wall limit. The child was killed; measured elapsed time through process
close was **600,282.739834 ms**. The last *progress checkpoint*, not a finalized policy,
was iteration **120** at native elapsed **589,251 ms**, with reported exploitability
**6.233832359313965 chips / 1.1334240653298118% of the 550-chip pot**. The frozen target
was **0.0055 chip / 0.001% pot**. No result or partial strategy was published.

Sampled solve peak RSS: **12,293,881,856 bytes (11.44957 GiB)**, from 11,669 samples with
zero sampling errors. This is sampled resident memory, not a guaranteed instantaneous
peak. Hardware: Apple M1 Pro, 32 GiB RAM; Node 24.10.0; eight native threads. The native
binary and all engine sources are hash-bound in the report. No other large solve ran
concurrently. Small TypeScript reference/audit checks did run during this observation;
these numbers describe this local run, not a hardware-independent performance guarantee.

**Coverage: 1/144 calibration roots attempted, 0 passed; 143 unattempted.** All 360
non-calibration required roots remain unsolved. There was no fitted candidate and no
held-out EV observation. The original stopping rule requires stopping on a necessary
root timeout; completing the other roots cannot repair this failed coverage gate. The
additive candidate is **untested, not falsified**. Step 12/PF4 remains blocked; v1 model,
production ranges and all old libraries stay unchanged. Independent steps 13/14 may proceed
after this evidence release passes CI. No retry with a changed menu, smaller range,
compressed storage, relaxed target or longer time budget was substituted.

Calibration report payload:
`37851268c19614406092b2787c9fc153505a368636054a9059858bf219da4422`.
`npm run audit:preflop:v2:research` verifies saved identities, bytes, source hashes,
original stderr checkpoints, coverage and summary; it does not rerun a ten-minute failure
or claim to reproduce machine-dependent timing. Re-running the measurement command to a
fresh destination is the explicit native reproduction path.
