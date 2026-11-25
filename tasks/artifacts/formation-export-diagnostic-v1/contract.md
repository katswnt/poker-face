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
