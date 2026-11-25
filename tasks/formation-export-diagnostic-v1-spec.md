# CO–BTN export diagnosis v1

Prospective continuation, 2026-11-24, from `90ffee3`. Investigate the unchanged
`co-btn-srp-v1-td7d3c` failure at `x b429 c 4c b995 c 3s`. This is a new diagnostic
experiment, not a retry or acceptance of the rejected formation. Original evidence,
sources, gates, published packs and `/play` remain unchanged.

## Frozen experiment

- Use the original corpus, spot, complete slice plan, native sources and exact native
  binary SHA-256 recorded in `formation-libraries-v1/environment.json`. Refuse an
  identity mismatch. Retain the original admitted preflight and all original failures.
- Two fresh runs, sequential, eight threads, original 1,800-second / 16-GiB RSS limits,
  original 0.3%-pot stopping target and 3,000-iteration maximum. No retries after an
  interrupted/failed attempt. Charge both runs in addition to all original native work;
  their full reserved time must fit the original eight-hour cumulative ceiling.
- Save the complete parsed native result to ignored local storage **before encoding**,
  with a hash. Save the targeted parent and every immediate child, full hand identities
  and untouched float32 JSON numbers as a small committed diagnostic fixture. Require
  identical targeted exports and iteration counts in both fresh runs; timing/RSS may vary.
- Reproduce the unchanged encoder/auditor failure. For each live opponent hand, independently
  enumerate compatible actor hands and response probabilities. Compare full precision,
  rounded reach only, rounded strategy only, rounded EV only, and the actual saved data.
  Preserve missing/zero-compatible values as unavailable, never zero. Check child identity,
  board, opponent contributions and row dimensions before applying the value identity.
- A full-precision absolute discrepancy above 0.01 chip remains an unresolved export/value
  issue. This is a prospective diagnostic screen, not a new publication tolerance or
  certificate for the native engine. Report actual errors and compatible mass, including
  mass omitted by reach quantization. Do not infer a cause from the rounded discrepancy alone.
- Independent synthetic tests must fail first: a blocker removes the dominant actor hand,
  tiny retained/omitted weights change the conditional mixture, and missing child values
  cannot look like passing zero errors. Replay the real fixture and reject altered evidence.

## Ownership and completion

New `src/lib/solver/bridge/formations/export-diagnostic.ts`, capture/audit scripts,
`test/formation-export-diagnostic.test.ts`, this spec and the separate
`tasks/artifacts/formation-export-diagnostic-v1/` evidence. Related package/CI audit wiring,
current-status README/roadmap hunks and a dated handoff. The existing source-hashed encoder,
validator, bridge, generator and observations must remain byte-identical.

Finish with a measured diagnosis, reproducible offline audit, exact isolated full-unit /
type / lint / relevant-audit checks, explicit-file commit/push and hosted CI. This milestone
does not publish CO–BTN, repair its data format, change a threshold, adopt an engine or
unblock PF4. A proposed remedy needs a separately versioned contract and full coverage gates.

## Observed result

Both fresh monitored solves reproduced the original 14 failing saved-value messages
exactly. Both stopped at 160 iterations and 0.29541510802048904% of the starting pot.
Their targeted parent/three-child exports are identical, hash
`82749ac1682d48eae76d5bfcc401bb83f7c1dbcd40f81daae71370b4fbc0201b`.
The fixture retains all 298/224 hand identities and every unrounded row at those nodes.
The complete parsed native results (9,456,099 / 9,456,098 bytes, including different
timings/RSS) are retained under ignored `build/co-export-diagnostic-2026-11-24/native-monitored/`.

| Representation | Opponent hands checked | Maximum discrepancy, chips |
|---|---:|---:|
| Full-precision exported values, reaches and probabilities | 179 | 0.000811751764 |
| Only reach weights quantized | 179 | 258.197872070310 |
| Only action probabilities quantized | 179 | 0.000811752618 |
| Only EVs rounded to 0.1 chip | 179 | 0.093677653954 |
| Actual saved representation | 157 | 258.25 |

Twenty-two positive-reach opponent hands are omitted from the saved parent and remain
unavailable in that comparison; they are not counted as zero-error passes. The original
whole-slice audit covers 420 nodes, 840 reach checks and 71 opponent-value nodes. It still
rejects the same 14 hands. No invariant tolerance has changed.

**Cause established for this failure:** quantizing reach relative to the node's largest
hand weight destroys blocker-conditioned response proportions. For opponent `Ad5d`,
only three actor hands retain positive compatible weight:

| Actor hand | Full-precision reach | Saved integer reach (scale 10,000) |
|---|---:|---:|
| KcJc | 3.1097656e-9 | omitted |
| Kd8d | 3.848412e-8 | 3 |
| Ac8c | 2.9966486e-8 | 3 |

The parent maximum reach is 0.000118474. The compatible mass is just 7.15603716e-8;
the much larger Ad-containing actor hands are blocked. Rounding the two retained hands
to equal weights changes the check / bet-3,498 response probabilities from about
41.8758% / 58.1242% to 50% / 50%. The full-precision parent EV 1,847.2649 agrees with
the response average within 0.000217 chip. The saved parent is 1,847.3 while its saved
response average becomes 1,589.05. This is a saved-representation inconsistency, not
evidence here of a native best-response or game-solving error. Small unconditional
omitted mass does not bound conditional error after blockers remove the dominant mass.

This diagnostic covers this saved-node identity only. It does not independently certify
the full native game, rounded policy exploitability, every export or every zero-reach
continuation. CO–BTN remains withheld; its other six roots remain unattempted.

## Resources, interruption and reproduction

The initial sandbox attempt was interrupted by `spawn EPERM` in the existing `ps`
sampler. It produced no accepted diagnostic result; the native process was confirmed
absent afterward. Its start records, stderr and original capture/audit source are
preserved. The separately frozen [environment amendment](artifacts/formation-export-diagnostic-v1/environment-amendment.md)
explicitly permits the monitored rerun and charges the interrupted attempt its full
1,800,000-ms reservation. The prior no-retry rule was not silently bypassed.

The two monitored runs took 67,500.712750 / 68,941.393916 ms, peak observed native RSS
2,092,318,720 / 2,092,662,784 bytes. Total formation work charged, including all prior
failures and this interruption: **8,864,077.594955 ms / 147.734627 minutes**, below the
original eight-hour ceiling. These measurements are local native costs, not browser limits.

Evidence: `tasks/artifacts/formation-export-diagnostic-v1/observation.json`, payload hash
`9273095caa592b0e470dccd561fedf3a0d82e28920fa1e7d2d199964b8d4ed9a`.
The audit needs no native binary and recomputes all five representations:

```sh
npm run audit:bridge:formation-export
node --import tsx --test test/formation-export-diagnostic.test.ts
```

For the original two-run capture, the command was:

```sh
SOLVER_BRIDGE_BIN=/private/tmp/poker-r0-exact-4tdgtvjb/native/solver-bridge/target/release/solver-bridge \
  node --import tsx scripts/capture-formation-export-diagnostic.ts --capture \
  tasks/artifacts/formation-export-diagnostic-v1/observation.json \
  build/co-export-diagnostic-2026-11-24/native-monitored
```

It refuses existing destinations, source/binary identity mismatches and a failed native
gate. This command is a historical measurement recipe, not an instruction to retry or
overwrite existing evidence. Another fresh experiment needs its own declared budget and
record. Original B4/formation encoder and validator sources remain hash-identical.

## Next step and verification

Five regression tests cover the independent synthetic example, unavailable values,
malformed children/rows, actual numerical reproduction, and corrupted evidence/resource
accounting. The synthetic blocker assertions were observed failing before the blocker
filter was implemented, then passing. Offline replay passes.

Next: freeze a separate saved-format correction that preserves sufficiently accurate
positive reach weights under blocker conditioning, with explicit omitted-hand semantics.
Start with this captured fixture, then require every original root, saved-node invariant,
file/pack limit, referee and fresh-reproduction gate before publication. Do not discard
rare hands or widen tolerances to hide this failure. Preserve the v1 packs and failure
evidence. The preflop-validation and external-MCCFR gates are separate and remain closed.

Release verification preserves two setup/failure records. The first isolated preparation
rejected copied stale WASM assets; the matching preserved build passed source verification.
The first full suite had one module-load failure because the main worktree's dependencies
lacked pinned `pako` 2.1.0; the copied checkout received the matching package. Its next
full suite passed 1,184/1,185 tests, with zero skips: the unchanged preflop observation
timeout test did not receive the fake child's progress line before its three-second
deadline. That test passed in the preceding suite and then in three isolated repetitions.
The cause remains unconfirmed; no timeout, assertion or production source was changed.
The final full suite runs alone, after these setup corrections; final commit/CI results
are reported at release closure. All attempts remain under the ignored diagnostic work
directory. Type-check, lint, prepared production build, diagnostic replay, formation-pack
audit and original B4-library audit pass on the isolated staged source.

Release closed as `e0bc097efb541deb36b28c43316bf438170a5504`, verified tree
`424222ab336c2c0434da858dc06ba4f1a3c40628`. The final isolated suite passes
**1,185/1,185**, zero skips, in 150,069.484958 ms. All eight jobs in
[CI 45537891627](https://github.com/katswnt/poker-face/actions/runs/45537891627) are green.
Hosted verify passes 1,092 unit tests with 93 existing native-environment skips and
104 browser checks with 17 saved-only skips. The WASM job separately passes 34 live,
48 drill and 55 play/review checks, with four existing non-Chromium zoom skips.
No hosted test retried. The separately frozen [v2 continuation](formation-full-reach-v2-spec.md)
starts only after all eight jobs passed; it preserves this failed v1 observation.
