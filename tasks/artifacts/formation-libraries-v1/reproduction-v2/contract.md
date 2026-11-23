# Formation reproduction comparator correction — 2026-11-22

This is an implementation correction within CPU step 13, not a new numerical game or a
relaxed quality gate. The original frozen sources, inputs, attempts and observation files
remain unchanged. No corrected large native attempt has run yet.

## Observed defect and prospective correction

Original generation passed all 12 SB–BB and all 12 BTN–BB 3BP roots. CO–BTN remains blocked
by 14 saved opponent-EV consistency failures; it is not retried or published here.

The first reproduction attempts for SB–BB and 3BP were marked failed by a comparator bug:
the comparator re-encoded the original native result after its cache had sorted object
keys. `JSON.stringify` then emitted a different key order in `root.json` and `referee.json`.
The fresh hashes shown in each failure equal the **actual original generation hashes**:

| Root | File | Original generation and fresh hash |
| --- | --- | --- |
| SB–BB K♠7♥2♦ | root | `7cf5646713c5fb9d36a75110098b4e45c25d1d4f1e50f90cfd9d80da8c977e2f` |
| SB–BB K♠7♥2♦ | referee | `71e74e85e2f9fbdc4f8180b55952c4f86021b7455f120004d01e6616bea9610d` |
| 3BP K♠7♥2♦ | root | `bc3c0c8bd3681eeed9c9a4e13c9cf94cef38200a1f1856052409aed505f182d5` |
| 3BP K♠7♥2♦ | referee | `543c80678eb2bae91f156b0c283de143d845d6716d747a1456707bfbcc2df93b` |

These errors do not establish numerical nondeterminism. They also do not provide a complete
successful reproduction record: the original failure logger discarded the full fresh result
and truncated its hash diff. Preserve both failures and run a new, explicitly versioned pass.

Correct comparison: fresh native files must equal the immutable original generation
`dataHashes` **directly**, with equal iteration count. Do not compare against re-serialization
of a cache. Do not normalize away numerical differences, round more values, drop a file, or
retroactively mark an earlier attempt successful. Publish the actual matching fresh bytes,
without re-encoding a cached result again. The file formats and URLs remain v1.

## Unchanged gates and accounting

Use the original 36 frozen spot/plan identities and original preflight observations. Only
the two formations with complete generation coverage are eligible. Every one of their 24
roots must pass a new fresh solve and byte comparison; failures stop that formation.
The original numerical, coverage, 8-thread float32, 12-GiB reservation, 16-GiB native RSS,
1,800-s/root, file/gzip/raw-size and 1-GiB original native-cache limits are unchanged.
The **8-hour native budget includes all original generation and failed reproduction work**
(3,872,735.348206999 ms), plus this corrected pass. No additional full native-result cache
is created. Staged matching publication files are counted against the original data budgets.
Unknown interrupted attempts remain failed and charged their full reserved time.

## Implementation and evidence

- New `scripts/reproduce-formation-libraries.ts` is a small corrected controller. It reuses
  the unchanged native runner, encoder, per-node invariants and independent river referee.
  It validates the original hashed source/input/preflight/attempt records independently of
  the original controller's obsolete no-publication assumption.
- New immutable evidence under `tasks/artifacts/formation-libraries-v1/reproduction-v2/`
  binds the correction's sources, original evidence hashes, binary and each fresh attempt.
  Its `contract.md` is a verbatim copy of this prospective contract before execution.
- Per-root journals/staged output use `build/formation-reproduction-v2/`. Compare all fresh
  hashes to the original generation record, retain diagnostic hashes on a failure, and
  stage exact matching bytes. Publish only complete, fully audited formations.
- A published manifest retains original generation source hashes and adds explicit corrected
  verification provenance. Its timing, RSS, iterations and native quality are the actual
  fresh reproduction observations and are checked against that record.
- `scripts/audit-formation-release.ts` and package/CI commands use the corrected read-only
  auditor. The original frozen controller remains available as historical source; its
  old `--check` assumes its failed report governs publication and is not the release audit.
- Fail-first `test/formation-reproduction.test.ts` reproduces the cache-key-order trap on
  a tiny native game and checks direct original-hash comparison, missing files and mutations.
  Existing metadata/failure regressions remain. No shared numerical validator is changed.

Related owned changes: this record, the main formation task record, README/CPU-roadmap status,
package/CI wiring, and the final handoff. Trainer/session work and the paused flop draft stay
untouched. No app/game/browser admission change or new production deployment is implied.

## Checklist

- [ ] Reproduce the comparator defect with a failing test; implement direct-hash comparison.
- [ ] Freeze corrected execution sources and validate the original immutable evidence.
- [ ] Fresh attempts on every eligible root, with all original gates and total time accounting.
- [ ] Publish only complete verified groups; original CO–BTN failure remains explicit.
- [ ] Exact isolated commit, copied dependencies, full checks/audits/build, push and green CI.
