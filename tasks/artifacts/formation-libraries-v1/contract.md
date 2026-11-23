# Additional formation libraries v1 — CPU step 13

Prospective contract, 2026-11-22, after `2877408` and all eight jobs in CI 45073738933
passed. No new formation estimate or solve has been taken. Step 12/PF4 remains blocked
by the preflop validation timeout. These independently scoped postflop games use explicitly
hand-written ranges; their results cannot validate or replace preflop policies.

## Games and frozen inputs

The machine-readable `src/lib/solver/bridge/formations/inputs.json` is frozen before
implementation/measurement. It contains exact expanded weighted class tokens and all
boards. Weight 1 means relative range mass, not a recommendation to play the hand.
All weights are dyadic float32-exact. No rake, 100 chips per big blind, 100bb starting
stacks. Both active players have contributed equally by the flop.

| Formation / independent version | OOP (acts first postflop) | IP (acts second) | Paid each | Dead money | Flop pot | Behind each |
| --- | --- | --- | --- | --- | --- | --- |
| `sb-bb-srp-v1` | SB opener | BB caller | 250 | 0 | 500 | 9750 |
| `co-btn-srp-v1` | CO opener | BTN caller | 250 | 150 | 650 | 9750 |
| `btn-bb-3bp-v1` | BB three-bettor | BTN caller | 1100 | 50 | 2250 | 8900 |

SB–BB means a blind-versus-blind pot after the other seats fold; this is NOT the
button/small-blind position rule of a two-seat match. CO–BTN includes both folded blinds;
BTN–BB 3BP includes the folded small blind. Tests independently reconstruct the pots,
remaining stacks, player order, range weights and card removal.

Coverage is **12 flops per formation / 36 total**, using the existing B4 twelve texture
boards and their exact eight turn cards and two turn/river boards. This is chosen teaching
coverage, not a random population estimate or held-out test. Every formation's first
K♠7♥2♦ root is its locked benchmark. All 36 spot hashes and slice-plan hashes are frozen
and audited before the first native estimate.

Menus: start with the B3 lean tree, with one prospective addition: IP may bet **33% or
66% on the flop**. OOP flop bets remain 33%/66%; both turn bets 66%; OOP river 50%/100%,
IP river 66%. Raises remain call plus 60% of the pot after calling, at most one raise per
street, no added all-in size, forced all-in threshold 0.2, no merging or separate donk
menu. B3 found additional IP sizes mattered on one benchmark, at considerable cost;
this intermediate menu includes a small IP flop option without claiming universal sizing
accuracy. Never mutate the original B3/B4 menu, ranges, hashes or play artifacts.

Exact range lists, with the first player always OOP, are in `inputs.json`. They include
manually chosen fractional premium-hand mass and suited speculative hands. They are not
outputs of preflop-v1/v2, a commercial chart, or an empirical population fit.

## Capacity, solve and publication gates

- Estimate all 36 roots first, one native estimate at a time. No compression substitution.
  Reserve uncompressed engine + native first-street export allowance + **512 MiB** slice
  working allowance, at most **12 GiB**. The additional allowance is conservative engineering
  headroom, not a measured bound or browser admission. Actual native RSS has a **16-GiB**
  hard stop. A failed estimate stops that formation; independent formations may continue.
- One heavy solve at a time; **8 threads**, float32, **≤0.3% pot** native reported
  exploitability (the unchanged B4 publication gate), **≤3,000 iterations**, **≤1,800 s**
  per solve including export. Maximum summed native wall time **8 hours**, including
  fresh reproduction solves. These are different games and a different publication purpose
  from the failed preflop-v2 validation experiment; none of its gates are changed.
- A formation is published only if all its twelve roots pass and reproduce. No replacing
  a difficult flop, dropping a range, accepting a partial policy or filling a coverage hole.
  Stop a failed formation, retain its evidence, continue other independent formations.
- Keep every flop decision, B4's depth-two turn/river slices on unraised earlier lines,
  both players' reach/equity/EVs, action frequencies and action EVs. Use the existing
  quantization (reach 1e-4, strategy 1e-3, EV 0.1 chip, equity 1e-3); retain omitted reach.
  Root values and referee policies remain full precision. Existing B4 invariant tolerances
  are unchanged. Require nonzero reach-chain and opponent-value audit coverage per spot.
- One full-precision river subtree for each K♠7♥2♦ benchmark: flop check, IP **66%** bet,
  call, Q♥, check, IP 66% bet, call, 2♣. With the extra IP flop size, use the correct
  ordinal for 66%, not the old `s0` shortcut. Re-grade with our independent factorized
  river checker: native value discrepancy **≤0.01 chip**, saved grade reproduces **≤1e-9**.
  The whole-game native B2 referee still passes **0.0002 chip** on its locked small games.
  A local river grade never certifies the earlier streets or a composed playing policy.
- Per ordinary data file **≤1 MiB**; full-precision offline referee file **≤8 MiB**;
  per-formation total **≤40 MiB gzip** including manifest, all published raw data **≤512 MiB**;
  immutable native-result cache **≤1 GiB**. Byte counts and SHA-256 on every file; no extra,
  missing or path-traversing file references. Totals and gzip sizes recompute in audit.
- Re-solve every accepted root from scratch on this machine, with the same input/plan,
  and require byte-identical deterministic data chunks/root/referee export and equal
  iteration count. Timing/RSS observations are not deterministic. Keep a hash-bound
  reproduction record. CI re-encodes immutable cached evidence when available and always
  audits published bytes, source/input identities, every saved node and each referee;
  CI does not spend hours regenerating the large libraries.

Native whole-game exploitability grades the complete unrounded engine policy, not the
rounded partial saved slices. State this explicitly in every manifest. No exact/universal
GTO claim; no global safety claim for local re-solving. These are separate offline/data
libraries. `/play`, its scripted preflop, existing 12-flop game and browser limits stay
unchanged. New UI integration or browser capacity is not inferred from saved data.

## Implementation, tradeoffs and ownership

New namespace `src/lib/solver/bridge/formations/`: immutable `inputs.json`, fixture/hash
builder `fixtures.ts`, frozen `manifest.json`, and a small Node-only `library.ts` encoder/
reader/auditor. Reuse the unchanged bridge contract, slice encoder, schema/invariant checks
and river referee. New CLI `scripts/build-formation-libraries.ts` supports explicit freeze,
estimate/generate/check/reproduce modes, immutable per-root cache and resumable records.
New tests `test/formation-{contract,library}.test.ts` fail first and cover identity,
accounting, both private ranges, blockers, altered data, missing coverage, wrong namespaces,
quality gates and reproduction. Output `public/solver-data/bridge-formations-v1/` has one
versioned manifest per formation; evidence goes in `tasks/artifacts/formation-libraries-v1/`.

Related owned edits: this spec, package/CI audit wiring, README formation/status hunks,
CPU/completion roadmap and step-11 release closure, final dated handoff. Protected trainer
work, paused configurable-flop draft, v1/v2 preflop inputs and original B4/play data are
outside ownership. Do not alter shared validators to force a new library to pass.

Pros: additional positions and stack/pot relationships; reusable, hash-bound observations;
independent small-game and river checks; no new browser compute burden. Cons: manual ranges
and finite menus limit realism; slices omit most later decisions; library growth and full
reproduction cost laptop time/storage. Mitigations: explicit inputs/coverage and provenance,
separate versions, strict byte/compute caps, immutable resumable evidence, and measured
failures instead of silently shrinking the frozen game.

## Checklist and execution record

- [ ] Freeze exact inputs, source identities, 36 spot/plan hashes and three benchmarks.
- [ ] Fail-first contracts, chip/range/position/blocker tests, strict evidence checks.
- [ ] All preflights; complete per-formation solve gates or recorded independent failure.
- [ ] Publish only complete accepted coverage; byte/hash/quantization/referee audits.
- [ ] Fresh native reproduction for all published roots within original budgets.
- [ ] Exact isolated commit, copied dependencies, full tests/tsc/lint/relevant audits/build;
  explicit files/README hunks; push and every CI job green.

No new formation measurement yet.
