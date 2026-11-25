# Prospective v3 publication metadata correction

The frozen v2 experiment completed six new native generation runs and all twelve fresh
reproductions. Every policy byte and iteration count matched. Its final publication
audit refused a chip/percentage metadata identity; no pack was published. Preserve its
source, report, original candidate manifest and full run log. `status: complete` in the
experiment means its native phases completed, not that publication succeeded.

The pinned native source declares exploitability chips as `f32` and computes percent
as `f64::from(exploitability) / starting_pot * 100`. The shortest JSON decimal is enough
to recover that float32 value but is not the exact float64 value itself. For the first
root, 1.9376081 means exactly 1.9376081228256226; using the shorter decimal as float64
creates a 3.5116342611551943e-9 percentage mismatch against the fixed 1e-9 identity check.
Recovering float32 makes the identity exact on all twelve recorded roots.

Before corrective publication: keep all twelve exported data maps byte-identical, all
native observations and existing sources unchanged, and all gates/tolerances unchanged.
Correct only each manifest entry's exploitability chip metadata using `Math.fround`.
Require the original percentage to equal the reconstructed chips / 650 * 100 at the
existing 1e-9 tolerance, with both still satisfying the original 0.3% quality gate.
No rounding of the percentage, alternate thresholds, new solves or native retries.

Add a hash-bound publication revision describing this conversion; retain the v2 saved
format and namespace. The new publisher independently binds the original manifest to
the complete experiment, journal and all data hashes. Reuse the unchanged complete v2
library audit for schema, invariants, referee, compression and byte budgets. On any
further gate failure preserve it and withhold publication. Final CI uses the corrected
read-only publisher audit; the original controller remains a historical source record.
