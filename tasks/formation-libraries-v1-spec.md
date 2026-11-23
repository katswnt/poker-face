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

- [x] Freeze exact inputs, source identities, 36 spot/plan hashes and three benchmarks.
- [x] Fail-first contracts, chip/range/position/blocker tests, strict evidence checks.
- [x] All preflights; complete per-formation solve gates or recorded independent failure.
- [x] Publish only complete accepted coverage; byte/hash/quantization/referee audits.
- [x] Fresh native reproduction for all published roots within original budgets.
- [ ] Exact isolated commit, copied dependencies, full tests/tsc/lint/relevant audits/build;
  explicit files/README hunks; push and every CI job green.

### Frozen identity and preflight observations

The prospective contract is retained verbatim at `tasks/artifacts/formation-libraries-v1/contract.md`.
Unobserved manifest drafts were archived before final type-only cleanup; all 36 spot and
plan hashes stayed unchanged. The final corpus hash is
`8b37ece802208fbc45b6ca05681e92309c8639114fe554e43a06236398ae0b79`.
Execution identity (including the exporter and native source files):
`78ed6180c522ca86d344b7208068db2196c35ab71c59963ac02d30b2d37550ad`.
No estimates or formation solves preceded these identities. Seven focused tests pass,
including the real native tiny-slice exporter; evidence rejection tests were observed
failing before their implementation. Type-checking and focused lint pass.

All 36 native estimates pass. Largest engine-plus-export-plus-slice reservations:
SB–BB 9.498971775 GiB; CO–BTN 3.806151658 GiB; BTN–BB 3BP 1.325117853 GiB.
Summed estimate wall time is 1,769.596210 ms. There are 12 RSS samples, zero sampling
errors and 24 estimates too short to obtain a sample; those 24 have **unknown**, not zero,
observed peak memory. Estimates allocate no strategy storage. Preflight payload hash:
`1b786425696cff4c4a146279de169fc19e71d53f7a165033c7daddeb19bf3c70`.

Generation and the corrected fresh reproduction are complete. Two complete formation packs pass publication; CO–BTN remains blocked. Each native
result also has a 64-MiB serialization limit within the 512-MiB slice working allowance;
this is an additional conservative export guard, not a measured peak-memory promise.

### Additional release integrity check

Owned additions: `scripts/audit-formation-release.ts` and `test/formation-release.test.ts`.
A read-only release wrapper additionally requires every published iteration count, quality
number, rounded elapsed time and peak RSS to equal its accepted fresh-reproduction row. This catches
in-range metadata corruption that a bounds check alone would miss. Its assertion test failed
before implementation. The corrected release wrapper validates the original source/input/attempt records,
then the new direct-hash reproduction and every published file;
`npm run audit:bridge:formations` invokes these checks. This adds a check without changing the frozen
generator, games, source identities, observations, numerical gates or retry policy.

### Generation results

`generate.json` payload hash:
`f3ce16febc3894af832190f6366412632c3a3399c668ffa48f6e665be98454ad`.
All observations used eight threads and uncompressed float32. Time includes native export;
failed-attempt wall time also includes its rejected encoding/audit work.

| Formation | Attempted / accepted | Summed wall ms | Accepted iterations | Maximum accepted native gap (% pot) | Maximum accepted native RSS bytes |
| --- | --- | --- | --- | --- | --- |
| SB–BB | 12 / 12 | 2,956,978.362373 | 140–210 | 0.2992648363113403 | 9,521,512,448 |
| CO–BTN | 6 / 5; **blocked** | 328,537.312335 | 130–170 | 0.2996826171875 | 3,374,628,864 |
| BTN–BB 3BP | 12 / 12 | 162,091.104083 | 110–180 | 0.29698486328125 | 897,335,296 |

Total charged generation wall time: **3,447,606.778791 ms / 57.460113 minutes**.
The immutable local native-result cache is **1,058,962,799 bytes**, below the unchanged
1,073,741,824-byte cap. This is offline research storage, not a browser download.

**CO–BTN publication is blocked.** On `Td 7d 3c`, at path
`x b429 c 4c b995 c 3s`, 14 opponent-hand EV consistency checks fail in the quantized saved
data. Absolute differences between the saved parent value and response-weighted saved child
values range from **29.3 to 258.25 chips**. The last native checkpoint was iteration 160,
1.9201982021331787 chips / 0.29541510802048904% of the 650-chip starting pot, below the
native convergence target. Passing that target did not make the saved dataset acceptable.
The attempt ended after 48,393.465209 ms. Its final native result was rejected before cache
admission; its error and last checkpoint are preserved, but a complete rejected raw export
is not retained. No final accepted result hash or saved-data hashes exist for that attempt.

The remaining six CO–BTN flops were not attempted, and its five earlier accepted roots
are not a publishable partial formation. No opponent-value tolerance, range, board or menu
was changed. The cause is **unresolved**: the evidence does not distinguish a precision/
conditioning problem in the saved representation from an export or engine issue. A future
separate diagnosis should retain the failing full-precision node and its children before
encoding, compare blocker-compatible action weights, and only then propose a correction.
Do not call the native solver mathematically wrong on this evidence alone. A regression test
preserves the failed outcome even though its last native convergence checkpoint passed.

The other two formations passed every saved-node audit on all their generation roots,
including this same flop. Their fresh reproduction is the next publication gate. CO–BTN
is excluded from reproduction/publication; its failure is neither hidden nor retried.

### Commands and reproduction semantics

```sh
npm run build:bridge
npm run build:bridge:formations -- --estimate
npm run build:bridge:formations -- --generate
npm run build:bridge:formations -- --reproduce
npm run audit:bridge:formations
```

`--freeze` was used only once for the final unobserved manifest and refuses an existing
manifest. Estimates and phase records are immutable. `--generate`/`--reproduce` resume
recorded attempts; an unknown interrupted outcome is charged its full reserved time and
never silently retried. Once a reproduction record exists, running `--reproduce` again
checks/resumes publication and **does not claim a new native solve**. The fast audit reads
saved evidence and grades saved data; it does not run the large native games.

For an independently fresh **verification** of this release, use a separate clean checkout
with copied dependencies and the matching native bridge. Preserve all original observation
files and the frozen contracts/inputs. In that separate checkout only, move the corrected
`reproduction-v2/environment.json`, `reproduction-v2/reproduce.json` and published formation
directory into an ignored reference directory; start with no
`build/formation-reproduction-v2/` attempts or staged data. Run
`npm run reproduce:bridge:formations`, then `npm run audit:bridge:formations`. The frozen native controller
refuses a different native binary or source identity and compares all fresh bytes and
iteration counts directly to the original generation record. It does not require the
large original native-result cache. New timing/RSS/environment/report hashes are expected;
the previous failed attempts still count toward the eight-hour budget. Keep the new
experiment separate; never overwrite committed observations or relabel a failed outcome.
Exact cross-machine float32 output is not promised; this release's byte-identity gate is
for repeated solves on the recorded machine and build. Rebuilding with a different
compiler/binary requires a separately versioned experiment, not bypassing the identity check.

### Original reproduction comparator defect and recorded correction

The original first fresh SB–BB and 3BP attempts were falsely rejected because the checker
compared against a re-encoding of key-sorted cached objects. Their fresh `root.json` and
`referee.json` hashes equal the actual original generation hashes, while the re-serialized
cache hashes differ. This is a comparator implementation defect, not evidence of numerical
nondeterminism. The truncated original failure logs are insufficient to certify all fresh
files after the fact, so neither old attempt is relabelled successful.

The [separately frozen corrected pass](formation-reproduction-v2-spec.md) compares fresh
bytes directly to the original generation hashes, stages those actual bytes, and repeats all
24 eligible roots. All original engine/encoder sources and observations remain unchanged;
all prior compute stays charged to the original eight-hour budget. No numerical or byte
identity tolerance is relaxed. CO–BTN's real saved-value inconsistency remains blocked.
The original commands above are historical experiment commands; the corrected pass is
`npm run reproduce:bridge:formations`, with `npm run audit:bridge:formations` as the current
release auditor. The original controller's old `--check` assumes its failed reproduction
report still governs publication and is not used as the corrected release audit.

### Final publication measurements

All **24/24 eligible roots** freshly reproduce the original 506 data files byte for byte,
with identical iteration counts. Corrected reproduction record:
`7d9bf496eb4e64214b4c2a31027ec9d302e2a21a8a5686e9b53b850e001701d5`.
The two manifests make **508 files / 123,482,163 raw bytes** including the portable-compression v5 manifests.

| Pack | Reproduction wall ms | Iterations | Max native gap (% starting pot) | Max native RSS bytes | Raw bytes incl. manifest | Gzip bytes incl. manifest |
| --- | --- | --- | --- | --- | --- | --- |
| SB–BB | 2,894,826.589374 | 140–210 | 0.2992648363113403 | 9,457,942,528 | 95,930,297 | 24,070,489 |
| BTN–BB 3BP | 160,073.550708 | 110–180 | 0.29698486328125 | 897,384,448 | 27,551,866 | 7,436,832 |

The complete experiment charges **6,927,635.488289 ms / 115.460591 minutes** of native
work, including generation, the two original false-negative attempts and corrected
reproduction; below the unchanged eight-hour budget. Preflight adds 1,769.596210 ms.
The original native cache remains 1,058,962,799 bytes; corrected reproduction writes only
verified publication data, not a second native cache. There is no CO–BTN public directory.

The independent full-precision river referee reproduces its saved grade within 1e-9.
SB–BB: 137,116 compatible deals, 21 public nodes, 2,692-chip local pot; value discrepancy
0.000002451773 chips, independent exploitability **1.724827457636 chips / 0.0640723424%**.
3BP: 14,870 deals, nine public nodes, 12,110-chip local pot; value discrepancy
0.000058075488 chips, exploitability **87.200016832260 chips / 0.7200662001%**.
The latter exceeds 0.3% of its local pot. The frozen referee gate is value agreement within
0.01 chip, not a universal later-node quality bound. A complete-game starting-pot grade
and a conditional river-subgame grade are different quantities; neither certifies the
rounded partial saved strategy or a globally safe playing policy.

### Publication reporting correction

The first v2 publication attempt stopped before any directory rename: its old auditor
converted the shortest-decimal JSON rendering of a float32 chip value directly to float64
percentage. The [v3 publication record](formation-publication-v3-spec.md) preserves the
rejected manifest and adds an **exact**, native-equivalent conversion using `Math.fround`.
No tolerance is increased, no observation is rewritten, and all original generation and
reproduction sources stay hash-identical. A fail-first regression rejects corrupt decimals,
percentages and above-threshold values. All other library checks are unchanged.

Current commands:

```sh
npm run audit:bridge:formations        # all published evidence, files, nodes and referees
npm run publish:bridge:formations      # package existing accepted observations; no solving
npm run reproduce:bridge:formations    # current replay/fresh orchestration; see semantics below
```

The historical v2 script's publication phase retains the reporting defect. The
[current command](formation-command-v4-spec.md) handles this without manual file edits:
existing evidence goes directly to the strict current publisher; a fresh experiment runs
the frozen native controller once, preserves its log/exit outcome, archives only a verified
unpublished legacy manifest and then invokes the current publisher. Cancellation or missing
evidence stops immediately. Published files and observations are never overwritten. The
command explicitly labels replaying existing evidence as an audit, not a new native solve.
The original negative CO–BTN result remains unchanged. The duplication of the frozen
historical auditor/controller is deliberate evidence preservation, not two interchangeable
current release paths. Original source-bound observations must remain reproducible.

No app source, browser limits, original B4/play library, native engine or WASM assets change.
The new data is a repository/offline release, not a production deployment or `/play` option.
Exact-commit verification, explicit staging and hosted CI are the remaining release steps.

Twelve focused tests pass with zero skips, including both native exporter regressions;
type-checking and lint pass. An initial sandboxed focused run could not spawn the RSS
sampler (`EPERM`); the same tests pass with the required process access. No assertion or
numerical gate was changed for that environment limitation.

### Exact-commit verification

Committed as `ed097e2ceaa6c610f06fc8bd2872137ca11396bf`, with 541 explicitly staged files
and only the owned README hunks. All sixteen protected non-README file hashes and the
original trainer README changes remain unchanged. Fresh checkout
`/private/tmp/poker-pf13-exact-0li1x_f9` uses copied node_modules, not a dependency symlink.
The exact commit passes **1,171/1,171 tests**, zero skips, in 145,613.920583 ms; tsc, lint,
22 relevant audits and the production build pass. The unchanged preflop diagnosis SHA-256
is `d95b71e978f0c98650fe4583182d8ed99a2406060d0065a51b94590e96cc508d`.
The verification script confirms the checkout remains clean. Logs are under the primary
repository's ignored `build/cpu-finish-2026-11-22/step13-exact/` directory.
Pushed to origin/main; hosted CI must finish before step 14 starts.

A read-only production recheck at 2026-11-23 01:09:09 UTC (November 22 local) verifies all
six public engine/source files byte for byte against the retained clean `de7f0d6` release,
plus source links/build identity on `/play` and `/solver/live` and the visible 23.4% warning.
No deployment occurred. Build `a34c636fd90da5bcef285d97ce3af961b4550e7e78f77960357056982d2fdb4a`;
AGPL archive `268ec4566f9caecf08cd1411f98d71666050ecf784fed91c4a05bff957a8238f`.


### Hosted compression failure and portable correction

The first release's [CI run 45092458537](https://github.com/katswnt/poker-face/actions/runs/45092458537)
passed seven jobs, including the native bridge and all five multiplayer audits. Its main
job failed exact gzip accounting: Linux compressed the unchanged 95,821,613 SB–BB data
bytes to 23,929,879 bytes, while the Mac's zlib 1.2.12 observation was 24,050,604. Raw file
hashes and numerical checks did not change. This is preserved in the
[v5 compression record](formation-compression-v5-spec.md); do not report that run as green.

The current publisher/auditor uses pinned **pako 2.1.0** with a fixed gzip header/options,
independent of host zlib. Exact compressed-size comparison and the 40-MiB budget remain.
Both data-file totals equal the original Mac measurements; the two manifests grow by
1,260 raw bytes total to bind the profile and current publication sources. They total
**31,507,321 gzip bytes** including manifests. Original v3 manifests are retained verbatim
under `tasks/artifacts/formation-libraries-v1/compression-v5/original-manifests/`.
All 506 original data files, native observations and frozen v1/v2/v3 sources are unchanged.
The current entry points use `publish-portable-formations.ts`; the v3 script remains
historical source. A fail-first migration check permits only the two exact archived prior
manifests; normal publication refuses any unknown overwrite.

The command-only commit `62030ce` separately passed 1,174/1,174 isolated tests, zero skips,
tsc/lint, all 22 audits and build, with unchanged diagnosis. It is followed by the portable
compression correction before another push; it is not described as having passed hosted CI.


### Final fix-forward exact-commit verification

The command correction is `62030ce24b1ea42c987f33a74732367d0607bab7`; portable compression
is `4a87f9a5ef090fce604064d91e50e9693bb8f012`. Both are pushed after the final commit passes
in `/private/tmp/poker-pf13-compression-exact-lwmfd44f` with real copied dependencies:
**1,176/1,176 tests**, zero skips, 146,706.469084 ms; tsc, lint, 22 audits and build pass.
An additional complete audit under official Node 20.20.2 matches the Mac audit JSON byte
for byte (`6da9282f25223852c00534c3ed328c06a46b1ed197acbc4a675177eca4aff8a5`).
The actual public reproduction command also passes with that same audit output, explicitly
reports replaying existing evidence, creates no native-attempt directory, and leaves the
exact checkout clean. Preflop diagnosis remains byte-identical. The protected local work
is unchanged. All eight jobs in [CI 45096583659](https://github.com/katswnt/poker-face/actions/runs/45096583659)
are green before step 14 starts. The main job has 1,176 tests: 1,083 pass and 93 existing
native-environment skips; exact local verification above has zero skips. Its browser
suite has 104 passes and 17 existing saved-only skips. The WASM job separately passes
34 live, 48 drill and 55 play/review checks (four existing non-Chromium zoom skips).
The original failed CI is preserved above; the portable fix is verified on Linux too.
