# Formation reproduction command — current orchestration

Follow-up within CPU step 13, after the verified `ed097e2` data release. The mathematical
checks, original controllers, manifests and observations remain immutable. The public
`reproduce:bridge:formations` command should not invoke the historical v2 publisher against
a v3 manifest. Add one orchestration entry point; no new solve or dataset is required.

Frozen behavior before implementation:
- Existing corrected report: package/check its accepted observations with the current v3
  publisher. Clearly report that this is a replay/audit, not a fresh native solve.
- No corrected report in a separate fresh experiment: run the frozen native v2 controller
  once. Abort on cancellation/unknown outcome or missing/invalid evidence. If its complete
  report exists, keep the native exit status and log; let the current strict v3 publisher
  independently validate every record, byte and numerical gate before acceptance.
- Before packaging, archive only an unpublished staged legacy manifest that is canonical,
  correctly hashed and bound to the exact original generation/corrected reproduction rows.
  Never remove or rewrite any published file, solve report, or attempt. No retry of a failed
  root and no reclassification of the genuine CO–BTN failure. Failed formation groups stay
  blocked; their absence is checked by the current publisher.
- No source, policy, threshold, size cap, CI numerical check or production behavior changes.

Owned files: new `scripts/formation-reproduction-command.ts`, new fail-first boundary test,
package script pointer, this record and related formation docs/README command explanation.
The pure command planner and staged-manifest validator have rejection tests before code.
Run focused tests, exact-commit full verification and all hosted CI before step 14.


## Validation before commit

Three fail-first boundary tests pass. Type-checking and focused lint pass. The actual
command against the checked-in release exits successfully, states that no fresh native
solve occurred, and rechecks all 24 roots / 508 files / 123,480,903 raw bytes. No data,
manifest, native source or original attempt/observation file changes. The previous native
charge stays 6,927,635.488289 ms. Exact-commit/full-suite/CI verification follows.
