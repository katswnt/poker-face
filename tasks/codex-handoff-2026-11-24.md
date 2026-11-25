# Codex handoff — 2026-11-24 CO–BTN diagnosis

Resumed from `90ffee3`, following the first investigation in the November 22 handoff.
This bounded milestone diagnoses the failed export; it does not complete the remaining
solver research or publish a new formation.

Two fresh runs with the original source, binary, inputs and slice plan reproduced all
14 saved-value failures exactly. The target parent and three children are byte-identical
after canonical serialization. Independent conditional recomputation isolates the cause:
reach quantization loses accuracy when blockers remove the dominant hands. Maximum error
is 0.000811752 chip before rounding, 258.197872 chips with reach rounding alone, and
258.25 chips in the actual saved representation. See the
[full experiment, example, measurements and commands](formation-export-diagnostic-v1-spec.md).

New offline command: `npm run audit:bridge:formation-export`. It needs no Rust and does
not re-solve, publish or mark the failed library accepted. The committed observation
contains unrounded target data, complete hand identities, both solve measurements,
original/fresh source hashes and a payload checksum. Complete native results remain
in ignored `build/co-export-diagnostic-2026-11-24/native-monitored/`.

The first sandbox attempt crashed when its RSS sampler could not spawn `ps`. Its start,
stderr and original controller sources are preserved under the diagnostic artifacts.
An explicit prospective environment amendment preceded the monitored runs; the interrupted
attempt is charged its full 30 minutes. Total charged formation work is 147.734627 minutes
including every prior attempt, below the unchanged eight-hour budget.

Five focused regressions and the offline audit pass. Exact isolated full-unit, type,
lint, relevant-audit and hosted CI results are recorded at release closure. The sandboxed
mixed-worktree type-check also encountered the documented unrelated draft/safeguard errors;
no exclusions or protected-source changes were made to hide them.

Local setup corrections and the one existing timeout-test failure are preserved in the
diagnostic spec. The unchanged timeout test passes three isolated repetitions; its
intermittent cause is unconfirmed. Final full-suite/commit/CI results accompany release
closure, rather than editing source-hashed evidence. The exact checkout is
`/private/tmp/poker-co-diagnostic-exact-7gbr0dck`, with copied dependencies and the matching
preserved native/WASM builds; logs are under `build/co-export-diagnostic-2026-11-24/`.

Unchanged: `/play`, native/WASM sources, original B4 and formation encoders/validators,
all historical observations and published policy bytes. The 17 original dirty files
are safeguarded under `build/co-export-diagnostic-2026-11-24/protected-hashes.json`;
README receives only isolated research-status hunks alongside the original trainer work.

Next work is a separately versioned reach representation with this fixture as a regression,
then every original formation publication gate. No silent omission of rare hands or wider
tolerance. Six CO–BTN roots remain unattempted; the five earlier accepted roots remain
withheld. Preflop validation and external MCCFR repair remain independent open research.
Production remains the previous H1 release; no app release or new device measurement occurs.
