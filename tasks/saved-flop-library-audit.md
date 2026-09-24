# M6 saved flop library and three-street explorer — release audit

Date: 2026-09-24. Contract: [saved-flop-library-spec.md](saved-flop-library-spec.md).
Parent: [CPU-first plan](cpu-postflop-solver-plan.md). Source baseline: `4545a08` (M5).
Status: implemented and verified. Git history records the scoped release commit.

## What changed and what did not

`/solver/flop` exposes six jointly solved finite heads-up flop/turn/river games. Five
handcrafted small-range examples cover dry, two-tone, paired, connected and monotone
boards. The sixth is M5's unchanged synthetic 64-by-64 capacity example. It is not a
realistic preflop formation. No opponent ranges were copied from another application.

All games retain flop-v1: one capped opening bet per street, no raises, no rake, exact
ordered public cards, first/second action order, short calls and returned uncalled chips.
No source engine, previous accepted source artifact, old teaching cap, or trainer behavior
is changed. Existing Leduc, river and turn explorers receive only a navigation link.
No dependency, native backend, GPU, neural model, sampling or card abstraction is added.

The output is an approximate strategy for the declared finite game. Exact enumeration
does not make finite-iteration CFR+ an exact equilibrium. No numerical parity with an
external full flop solver or Griffin's unseen implementation is claimed.

## Frozen jobs, identity and acceptance

[Frozen requests](../src/lib/solver/postflop/flop-library/fixtures.ts) and
[pre-solve cache hashes](saved-flop-library-input-hashes.json) were committed with M5,
before new M6 acceptance solves. Each key includes game, algorithm, delay, maximum
iterations, quality target, backend/rules/library versions. The
[queue manifest](../src/lib/solver/postflop/flop-library/artifacts/queue.json) records
complete canonical payload/policy hashes and every accepted grade.

All six passed at the first scheduled 256-iteration checkpoint, CFR+ with delay 20.
The limit was <=0.25% of starting pot, preferring <=0.10%; all pots are 100 chips.

| Scenario | Exploitability, chips |
|---|---:|
| `flop-two-tone` | 0.002712988938334604 |
| `flop-dry` | 0.020847684186438897 |
| `flop-paired` | 0.025315639990045824 |
| `flop-connected` | 0.009255943832968683 |
| `flop-monotone` | 0.016788315132290066 |
| `flop-vector-wide-64` | 0.024089327546898076 |

The queue runs one local solve at a time. It records pending, accepted, incomplete or
failed status. Cached sources undergo bounded decompression, complete policy/counts/
options identity validation and independent regrading; file existence is insufficient.
Partial source pairs and corrupt files stop the queue. No nearby fixture is substituted.
`--resume` chooses the latest complete numbered checkpoint filename; the existing M5
decoder validates its contents and iteration boundary. New output never overwrites that
resume input. A temporary/incomplete checkpoint filename is not selected.

During initial generation, the first export exposed a wrapper identity mismatch: the
engine serializes its default `kernel: "vector"` explicitly. The library verifier now
normalizes expected options using the engine's existing validator. Frozen requests,
hashes, arithmetic and quality gates were not changed. The retained 256-iteration
checkpoint resumed and regraded without restarting the solve. The five new small jobs
took roughly 16–25 seconds apiece on Node 24/M1 Pro; the validated M5 wide source was
reused for generation. Full reproduction deliberately reruns all six jobs.

## Conditional mathematics and browser boundary

`derive.ts` independently streams compatible private pairs through the entire saved
tree offline. It keeps reusable per-pair/depth scratch and front-street accumulators,
not a pair-by-public-node matrix. For every displayed hand/action it computes forced-
action continuation values and terminal outcome probabilities. Earlier betting and
public cards enter the joint reach. An inspected private hand conditions only its own
explanation, never the public-card navigation probabilities.

Values from now add back prior contributions and payments; a current fold is zero from
now. Check-down share keeps the opponent's current range and counts all remaining cards.
Selected-showdown share conditions on actual continuation to showdown. Immediate opposing
responses update the range by Bayes weighting; own forced action with one's hand known
does not itself alter that opponent range. Short-call price excludes unmatched excess.

Reach zero and reach <=1e-12 withhold conditional facts; reach below 1e-6 carries a rare-
decision warning. Saved legal action frequencies remain visible. Global exploitability
is not a local action-EV error bound. Public range groups use joint reach, not equal
averages over hands, and preserve exact physical combinations in a companion table.

River slices contain exact saved policy rows, not full per-hand explanations. A typed
Web Worker receives bounded ranges and active slices with needed ancestry, validates
them, and evaluates the selected river subtree exactly. At most nine public nodes times
compatible private deals are admitted, capped at 100,000 repeated states. The caller
checks request/source/history identity, numeric facts, work counts, and unchanged policy.
Cancellation terminates the owned worker; stale completions cannot replace the current
view. No synchronous main-thread fallback, CFR restart, fake percentage or Monte Carlo
is used. Displayed elapsed time measures that river evaluation, not the earlier solve.

## Publication, download and memory measurements

Each of six scenarios has 638 slices: one flop, 49 turn, and twelve groups of up to four
river cards per turn. Metadata binds source identity, SHA-256 and byte count for every
slice. Source-version-bound URLs prevent mixed deployment data being silently accepted.
`--check` compares regenerated bytes without writes; `--write` validates all staged
candidates before per-file atomic publication. This is not an atomic whole-deployment
transaction. Failed/truncated/oversized/hash-mismatched loads preserve the last valid view.

Node 24 generation, M1 Pro, sequential and without another heavy job:

| Scenario | Raw bytes | Gzip bytes | Largest slice, raw | Metadata, raw | Metadata + flop, gzip |
|---|---:|---:|---:|---:|---:|
| Two-tone | 58,983,341 | 3,564,582 | 96,920 | 156,697 | 36,143 |
| Dry | 63,019,773 | 4,833,123 | 104,488 | 153,997 | 38,344 |
| Paired | 38,959,934 | 3,181,422 | 67,236 | 155,454 | 38,176 |
| Connected | 61,634,786 | 4,366,800 | 102,516 | 157,685 | 36,847 |
| Monotone | 38,065,546 | 3,044,907 | 65,763 | 156,722 | 38,364 |
| Wide | 166,074,674 | 45,210,836 | 287,911 | 163,479 | 71,980 |

Including catalog and embedded initial view: 3,842 files, 426,916,487 raw bytes,
64,239,204 gzip bytes (61.3 MiB), below the 100 MiB whole-catalog cap. Gzip bytes are
transport observations, not canonical identity; compression can differ by Node version.
All slices are below 1 MiB, all metadata below 256 KiB, and default flop below 256 KiB.
Metadata + flop is not the whole page transfer; browser measurements include page/scripts.

Initial full generation: 135.38 seconds and 957,022,208-byte process max RSS. Largest
observed JSON parse: 3.543 ms; largest sampled parse heap delta: 1,162,024 bytes. These
are local observations, not hard peak-memory/device guarantees. The separate wide
derivation profile took 62.27 seconds and 660,488,192-byte max RSS. The final accounting
reports 15,476,840 bytes: 15,452,820 bytes of persistent derivation arrays/depth scratch
plus 24,020 bytes of per-deal masks/signs/equity arrays. It excludes the compiled game,
policy, JS objects and garbage-collection-delayed reclamation; it is not process peak RSS.
Its root value was 3.214052854463272 chips, agreeing with the independent grade to
floating-point tolerance. No second optimized explanation math path was needed.

The UI retains only current flop/turn/river slices plus the selected river's <=9-node
explanations. It does not retain an unbounded visited-board cache. React also retains
the small default hydration props; the source research policy is never sent to the page.

## Verification record

Release matrix completed on local macOS/M1 Pro:

- Focused M6: 14 passing unit tests; type-check and lint pass.
- Source reproduction: all six manifest and decompressed numeric policy bytes reproduce
  on Node 24.10.0 and Node 20.20.0. Node 20's wide solve/grade/export reached its last
  reported export at 574.07 seconds, within the unchanged 600-second cap; the five
  small jobs took about 41–61 seconds each. Node 24's wide rerun took about 234 seconds.
- Every explorer file reproduces byte for byte on Node 20/24. Node 20: 115.60 seconds,
  1,093,992,448-byte max RSS, 62,618,751 gzip bytes, maximum observed parse 3.11 ms.
  Node 24: 89.71 seconds, 984,842,240-byte max RSS, 64,239,204 gzip bytes, maximum
  observed parse 1.46 ms. Raw bytes/hashes are identical; gzip output differs as expected.
- All 15 new production Chromium checks pass: actual worker evaluation, all scenarios,
  input links, range controls, exact-hand/history links, history back, no-JS initial
  facts, stale-version refusal, rare/off-path warnings, load and worker cancellation,
  failure/retry, corruption, keyboard focus, accessible names and responsive layouts.
  Screenshots at 320/390/1280 pixels and 200% CSS zoom were visually inspected; automated
  checks include internal clipping and 200% text-size behavior.
- Working tree: 673 unit tests and 65 production Chromium tests pass, with zero retries.
  Type-check, lint and the production build pass.
- Isolated staged release: 662 unit tests and 62 production Chromium tests pass, with
  zero retries. Type-check, lint, production build and complete six-source independent
  regrading pass. The 11-unit/3-browser difference is preserved local trainer/session
  work, not tests removed from this milestone. M6 adds 14 unit and 15 browser tests.
- Existing `audit:kuhn`, `audit:leduc`, `audit:turn`, `audit:turn:compact`,
  `audit:turn:vector`, `audit:turn:v2`, `audit:turn:explorer`, `audit:river:v3`,
  `audit:river:factorized`, `audit:river:exchange` and `audit:flop:reference` pass unchanged.
  `audit:flop:library` passes in working and isolated trees. Exhaustive historical
  multiway/evaluator/profile commands were not all rerun for this additive milestone.
- Normal CI now validates/regrades all six sources and reproduces all browser slices.
  The explicit extended workflow reproduces all six complete solves sequentially;
  its overall timeout is 30 minutes, with each solve's original 10-minute limit intact.

The release was exported to a new temporary directory and all 4,400 indexed files
matched their Git blob hashes. Final documentation-only updates were refreshed after
the checks. Only explicit owned paths and solver README hunks were staged. The seven
unrelated non-README files retain their initial SHA-256 hashes; all original README
trainer additions/deletions remain exact and unstaged. No old solver source/artifact
bytes were changed, staged, reverted or removed.

First production browser observations (local Chromium, mobile is 390px touch emulation):
HTML 218,146 raw bytes. Opening wide metadata/flop, then a turn and river fetched four
files of 163,479 / 105,101 / 272,689 / 245,911 raw bytes, transported as
35,428 / 36,552 / 88,030 / 63,998 encoded bytes. Desktop resource durations were
4.1 / 4.8 / 10.3 / 7.7 ms; mobile-emulated durations 4.1 / 4.6 / 9.6 / 8.9 ms.
Three top-level slice parses were about 0.3 / 0.7 / 0.8 ms on both. Reported JS heap
was approximately 11.9 MB, a coarse Chromium sample, not decompressed-memory peak.
Page plus all observed scripts (including link prefetches) passed the 5 MiB gzip gate.
These are localhost timings, not network/device performance promises.

The first test authoring pass used an over-specific frequency selector that excluded
the truthful `<0.1%` label, and an imprecise label query also matched the setup region.
Correcting those test selectors preserved both UI text and numerical assertions.

Tests cover independent repeated-state conditional values/outcomes on tiny games across
all front decisions and selected complete river histories; static equity uses the slow
hand evaluator. They cover global grade agreement, public-card mass/weighted-value
identities, exact saved policy rows, blockers, zero/tiny reach, short calls, malformed
worker payloads, wrong source replies, cancellation/retry/staleness, bounded cache,
corrupt/truncated/oversized slices, frozen identities and queue checkpoint selection.
M5's existing real checkpoint resume/checksum/cancellation tests remain unchanged.

## UI review and remaining limits

The requested baseline-ui and fixing-accessibility skills led to existing native
controls, visible focus, semantic tables, status/error recovery and isolated route CSS;
fixing-metadata supplied one deterministic canonical/title/social metadata definition.
No dirty global/trainer styles were edited. The earlier labs remain available.

Browser evidence is Chromium desktop and mobile emulation, not a physical-phone
benchmark. Firefox, WebKit, real mobile hardware and manual screen-reader testing are
not claimed. The application supplies screen-reader semantics and automated accessible-
name/keyboard checks, but those are not a full accessibility certification.

The library has six finite games, not arbitrary-board coverage. Five ranges are tiny;
the wider range is synthetic. No preflop provenance, raises, extra flop sizes, rake,
multiway generalization or external numerical certification is implied. Other menus
and more representative ranges require a new locked contract and measured acceptance.

M7 decision: native/GPU acceleration is not needed for this accepted target. M5 fits
its CPU envelope and M6 fits publication/browser limits. Node 20 wide reproduction is
close to the ten-minute cap, so broader targets still require profiling. M7 is a
conditional gate evaluated here, not an unimplemented required backend.
