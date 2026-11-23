# Formation compression v5 — portable, pinned byte accounting

CI run 45092458537 on `ed097e2` failed the formation audit only: the 253 SB–BB data
files were 95,821,613 raw bytes with unchanged hashes, but Linux Node 20 compressed them
to 23,929,879 bytes versus the recorded Mac Node 24.10.0/system zlib 1.2.12 measurement
of 24,050,604. Seven other jobs passed. No numerical discrepancy was reported. This is
a compressor-version reproducibility defect; do not drop the exact comparison or increase
the unchanged 40-MiB-per-pack gzip gate.

Use **pako 2.1.0**, pinned in package.json/package-lock.json, for the current publisher and
read-only auditor. Profile: gzip level 9, zero modification time, OS byte 255, no optional
header fields. This JavaScript implementation is independent of the host zlib. Verify a
fixed known byte vector, round-trip through Node's independent inflater, exact counts and
current pack bounds. Then run the complete audit with both the local runtime and official
Node 20 before pushing. No new native solve: input, policy/data bytes, iteration counts,
quality observations and all saved-node/referee checks remain unchanged.

The original v1/v2/v3 runtime sources and observation records remain frozen. New current
files: `portable-compression.ts`, `portable-publication.ts`, and
`scripts/publish-portable-formations.ts`. New manifest publication revision 5 binds those
sources, this prospective contract copy and the exact compression profile. Preserve the
two v3 manifests verbatim in this record's artifacts before updating their metadata. A
one-time migration may replace only those two exact known manifests; ordinary publication
remains immutable. Never overwrite a policy data file, solve report or attempt. Recompute
manifest sizes after provenance changes. All 506 original data hashes remain required.

Update the current command wrapper and package audit/publish pointers to the v5 publisher.
Add fail-first compression and migration-boundary tests. CI also runs the formation audit
early so a portability failure is visible before the older long-running audits. This adds
a check; it does not remove or relax any check. Explicit files, isolated exact commit,
full tests/tsc/lint/audits/build and all eight hosted jobs green before step 14.

Pako is a development-only dependency, not an app/Worker import. Official upstream:
https://github.com/nodeca/pako/tree/2.1.0 ; package licence `(MIT AND Zlib)`. Preserve its MIT
licence and the zlib notice from lib/zlib/deflate.js with the experiment record. No AGPL
source/archive, native/WASM build or production deployment changes.
