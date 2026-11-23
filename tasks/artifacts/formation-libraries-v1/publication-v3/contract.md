# Formation publication v3 — exact float32 reporting conversion

After all 24 corrected fresh roots matched generation byte for byte, the v2 publisher
stopped before its first directory rename. The frozen v1 auditor compared JSON's short
float32 chip decimal as a float64 against a percentage computed from the original float32.
For the first SB–BB root: 1.4154626 chips, 0.2830925226211548% of 500; direct decimal
conversion gives 0.28309251999999996%. Native `lib.rs` declares chips as f32 and computes
percentage from `f64::from(exploitability) / starting_pot * 100.0`.

This is a reporting-conversion defect. Preserve original source files, attempts, both
reproduction reports and the rejected staged manifest. No native solve or exported data
changes. The corrected check reconstructs that exact native operation with `Math.fround`,
then requires strict equality. It introduces no tolerance and keeps the 0.3%-pot gate.
All other byte, completeness, saved-value, referee and resource checks remain identical.

Ownership: new `src/lib/solver/bridge/formations/publication.ts` (read-only corrected
library auditor), `scripts/publish-formation-libraries.ts` (original evidence verification,
manifest creation and atomic publication), `test/formation-publication.test.ts`, this record,
package/CI and README/status hunks. Original generation/reproduction runtime sources stay
hash-identical. New manifest publication provenance binds these two new source files and
this prospective contract copy, separately from the frozen observation source identities.

Fail-first tests cover the actual float32 case, corrupt values and threshold rejection;
then audit all 24 staged roots before publication, with exact original file hashes and
iteration counts. A failed saved-value gate still blocks its formation. CO–BTN remains
withheld. The current auditor becomes `audit:bridge:formations`; `publish:bridge:formations`
only packages existing accepted observations. Reproduction is still the v2 native command,
whose historical publisher has this defect; follow it with the v3 packaging command.

No new app deployment or browser-capacity claim. No change to PF4, native or WASM code.
