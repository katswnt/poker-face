# Saved turn explorer — M4 audit

2026-09-23. Baseline `dce11e9`. [Locked contract](saved-turn-explorer-spec.md),
[parent plan](cpu-postflop-solver-plan.md), [unchanged source solver audit](configurable-turn-v2-audit.md).

## Shipped scope and honest boundaries

`/solver/postflop` inspects two already accepted, jointly solved turn/river strategies.
The complete public histories and compatible acting hands are navigable, including
off-path actions, raises, all-in runouts and returned excess. There is no browser solve,
new training, flop engine, neural approximation, GPU dependency or external parity claim.
The source mathematical engines, their limits, full policies and grades are unchanged.

Both displayed scenarios have three handcrafted combinations/player. They demonstrate
the M3 betting rules, not new capacity or recommended preflop ranges. The 64-hand capacity
probe stays offline. No 23 MB source policy is sent to the browser. Existing Leduc/River
Labs remain, with one navigation link added to each. Dirty trainer files are out of scope.

| Example | Compatible deals | Public states | Information sets | Exploitability, chips |
|---|---:|---:|---:|---:|
| An ace on the board | 8 | 6,699 | 6,930 | 0.05214608826282152 |
| Paired board, shorter stacks | 9 | 7,665 | 7,764 | 0.03868136901252228 |

Both use CFR+, averaging delay 20: the ace board at 256 iterations, the paired board at
512 since the 2026-09-24 uncallable-target collapse removed duplicate all-in branches
([amendment](configurable-turn-v2-audit.md)); before it the paired board was 8,868 public
states at 0.09751331204562774. Exact enumeration
and independent grading are floating-point calculations; these strategies are approximate
for their declared finite games, not exact or universal GTO.

## Explanation semantics and independent evidence

The offline derivation enumerates each compatible private pair, propagates joint reach
forward, and evaluates the saved continuation backward. It never runs CFR, picks a best
response or resolves a river. It refuses more than 8 hands/player, 16 deals or 100,000
equivalent states; it explicitly rejects the wider policy instead of pruning it.

Action EV forces that action once, including actions with zero saved frequency. All
later actions follow the saved policy. EV from now adds back the actor's already-paid
net contributions. Uncalled excess is excluded from the short caller's pot price. A fold
is worth zero from now; no such value is invented at an undefined conditional decision.

Opponent weights condition on the current actor's hand and all prior actions/cards.
An immediate response multiplies each opponent weight by its response frequency before
normalization. For an unsupported response the posterior is null, not uniform. Static
check-down share averages all legal remaining cards without later betting; action-specific
showdown share conditions on subsequent play actually reaching showdown. The two are
shown separately and neither substitutes for EV.

Range action mixes use each actor hand's joint reach. Public river previews integrate
both hidden hands given public history: selecting a hand in the inspector does not fix a
private deal for subsequent navigation. Each river's public probability and conditional
continuation value average back to the pre-reveal value. Turn actions cannot see a later
selected river. Whole-game exploitability is not a local action-value error bar.

At exact zero reach the view says off path. At positive reach <=1e-12 it instead says
numerically unsupported, and also withholds conditional facts. Positive reach <1e-6 has
a separate rare-decision warning. Legal frequencies/navigation remain available. Stored
numbers are not rounded; only display strings are rounded.

Unit evidence includes:

- Every public node/compatible acting hand matches the compiled source index; every
  public money state matches the independent history/cash ledger. Every saved frequency
  equals the source policy. Both root policy values match the independent vector grader.
- A separate repeated-state forward/recursive continuation audit checks **every**
  explanation in a weighted, overlapping-range, multi-size/raise fixture against slow
  showdown/money settlement. It checks conditional EV/outcomes, posterior normalization,
  response-conditioned ranges and static check-down share. It deliberately finds cases
  where equal-hand averaging is wrong and static versus selected-showdown shares differ.
- Every checked scenario's short-call price matches independent ledger payments and
  matched pot size. Chance previews average back to their parent conditional value.
- Pure policies test zero-frequency forced actions, zero-reach histories and unsupported
  response posteriors. A separate positive-tiny-reach policy verifies numerical refusal.
- Transport/store tests reject truncation, excess bytes, wrong digests, wrong versions,
  malformed shape/normalization/IDs and mismatched scenarios. Streaming limits apply
  before JSON parsing. Supersession, cancellation, retry, unmount and bounded cache behavior
  preserve the last valid result and ignore late replies.

This is internal oracle/differential evidence, not third-party certification.

## Data pipeline, integrity and measured costs

```sh
npm run audit:turn:explorer
npm run generate:turn:explorer
```

The first command validates source schema, hashes, rules identity, legal policy and
independent quality, regenerates all derived data and compares bytes without overwriting.
The second intentionally regenerates the versioned derived files. Source policies are
never rewritten. CI includes reproduction. The catalog binds each chunk to its scenario,
source payload and exact byte SHA-256; checksums are not authenticity signatures.

Each example has one turn slice and 48 river-card slices, each containing all histories
for that card. All 98 chunks satisfy the locked limits with no truncation or gate change.

| Data | Raw bytes | Gzip bytes |
|---|---:|---:|
| Ace-board scenario, all 49 chunks | 9,623,970 | 1,471,564 |
| Paired/short scenario, all 49 chunks | 12,851,715 | 1,486,102 |
| Complete two-example catalog, chunks only | 22,475,685 | 2,957,666 |

Manifest: 17,406 bytes. Default embedded turn slice: 98,046 bytes; other turn slice:
126,111 bytes. Largest lazy chunk: 286,249 bytes. Gzip counts measure a gzip-compressed
file sum on Node 24, not a promise of a deployment's transfer encoding. A browser never loads the
whole catalog at once. The active lazy cache retains one chunk, in addition to the
immutable initial hydration slice; history holds only IDs. One bounded pending load may
coexist. Parsing uses temporary bytes/text/object allocations too, so this is not a hard
process-memory guarantee.

A local Node 24/M1 Pro reproduction took about 1.12 seconds for both scenarios, including
source grading. In that run the maximum per-chunk parse was 1.10 ms, maximum validation
1.41 ms, and largest sampled heap increase across JSON parsing about 403 KB. These are
local observations, not mobile-device promises or peak retained-memory measurements;
sampling can miss transients and garbage collection affects it. Decompressed bytes are
enforced independently of timings. Browser timing observations are recorded by Playwright.

The clean production Chromium run observed 153,792 raw HTML bytes, 739,225 script-response
bytes across 15 responses, and one lazy river response of 210,462 decoded bytes. The
measured top-level chunk parse was about 0.60 ms and local response duration 5.30 ms.
The script observation includes shared framework/navigation resources; it is not an
explorer-only bundle size or compressed network total. These desktop localhost timings
are not mobile/network guarantees. Tests also check that the initial payload/scripts
exclude source-policy information keys and numerical-engine sentinels.

Cross-version checking found that Node 20 and 24 produced identical raw JSON but different
gzip sizes. The first manifest mistakenly included gzip measurements and therefore failed
Node 20 reproduction. Gzip observations were removed from identity, not from admission:
both runtimes still enforce every compressed-size gate. The raw manifest and all 98 chunks
now reproduce byte-for-byte on both. Node 20 observed 2,846,757 gzip bytes versus Node 24's
2,957,666; neither changes a policy, an explanation value or a chunk hash. No tolerance or
resource gate was weakened. The generator validates the entire catalog before writing any
output file; a filesystem/deployment failure can still interrupt a multi-file update.

## UI and accessibility

The default view is server-rendered and readable without JavaScript; interactive navigation
requires it. Client code imports only the small model, validated loader and navigation
store. There is no evaluator, compiler, CFR code, source-policy key or Web Worker needed
for this route. Actual fetches stream under byte limits, check SHA-256, then validate
shape/identity before replacing the last valid view. The embedded first view is covered
by build-time reproduction and initial shape validation, not a separate browser hash of
React's reserialized hydration payload.

The baseline-ui/fixing-accessibility skills led to native selects/buttons/details/tables,
the existing dark/green palette, route-scoped CSS, explicit action labels, no motion or
color-only meaning, visible focus and 44px controls. There are no custom keyboard widgets
or new dependencies. History selection uses an explicit open button. Successful navigation
focuses the decision heading; errors focus the nearby status block and cancellation
returns focus to the unchanged decision. A visible jump link complements the keyboard
skip link on long phone layouts. Heading scroll margin keeps its focus ring in view.

Production browser coverage includes both examples, every starting-hand selection,
turn/river bets/raises/calls, real lazy loading, no background solves, all-in refunds,
rare versus off-path facts, keyboard focus, cancelled/failed/corrupt request recovery,
no-JavaScript initial facts, unique metadata, and initial-bundle/source-policy boundaries.
320/390/1280px checks include internal text/table/button overflow and long provenance
hashes. The 200% check uses CSS zoom, not a claimed physical-device/browser-UI zoom test.
Screenshots are inspected as well as asserting overflow. This is not a full screen-reader
audit; Firefox, Safari and assistive-technology testing remain follow-up work.

## Release verification

On macOS/M1 Pro, Node 24.10.0, using the installed Next.js 16.3.3 and production Chromium:

| Check | Working tree | Exact staged release, without unrelated trainer edits |
|---|---:|---:|
| `npm test` | 634 passed | 623 passed |
| `npm run typecheck` | Passed | Passed |
| `npm run lint` | Passed | Passed |
| `npm run build` | Passed | Passed |
| Production Playwright, `--retries=0 --reporter=list` | 50 passed | 47 passed |
| `npm run audit:turn:explorer` | Passed | Passed |

The difference is 11 unit and 3 browser tests in preserved unrelated trainer work. M4
itself adds 11 unit tests and 12 browser tests. The new unit tests also pass on Node 20.
All 98 raw chunks and the canonical manifest reproduce byte-for-byte on Node 20 and 24.
The clean browser suite passed in 36.1 seconds with no retries. Screenshots at 320, 390,
1280 pixels and 200% CSS zoom were checked for layout; focused decision screenshots
confirm that the heading focus outline remains visible after the jump.

The following existing reproduction/audit commands also passed unchanged in the working
tree: `audit:turn:v2` (all five accepted artifacts), `audit:turn:vector`,
`audit:turn:compact`, `audit:turn`, `audit:river:v3`, `audit:river:factorized`,
`audit:leduc`, `audit:kuhn`, and `audit:river:exchange`. This milestone did not rerun
every extended historical multiway/profile command. All old source engines, policies,
grades and artifact bytes remain untouched.

Development checks caught test-selector issues around closed details/global alerts and
a timing instrument that also counted React hydration JSON. Selectors were scoped to
the actual result, and measurement now counts only a parsed top-level explorer chunk;
the application integrity checks were not relaxed. Cross-runtime gzip identity was
corrected as documented above. A first clean build could not fetch the existing Google
font inside the network sandbox; retrying with network access then hit a generated
Next font-query error. Moving that temporary export's failed `.next` directory aside
and rebuilding succeeded. No font, dependency, Next configuration or application source
was changed to bypass the failure. Its exact cache-level cause was not established.

The release was exported from the index and every indexed file matched its export by
Git blob hash. The seven unrelated non-README dirty files retain their initial SHA-256
hashes; the README's original trainer additions/deletions are unchanged and excluded
from the index. Only solver-owned README edits and explicitly named milestone files are
staged. CI now includes explorer reproduction; this local audit does not by itself
claim the new hosted CI run has passed. The baseline M3 hosted run had passed.

## Next

M5 starts with a new tiny joint flop/turn/river reference and a locked single-size/no-raise
contract, not an immediate full-range flop product. It needs both future-card transitions,
all-in runouts, independent settlement, reductions to turn and new hidden-card-cheating
tests before scalable menus. Wider browser catalogs, arbitrary requests and additional
solver dimensions remain separate, measured work.
