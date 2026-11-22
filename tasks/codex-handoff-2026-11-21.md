# Codex handoff — 2026-11-21

The latest checkpoint is [H1 hand review](codex-handoff-2026-11-21-h1.md). Read it and
[its prospective contract/release gates](hand-review-h1-spec.md) before continuing.

W1–W4/P1–P5, R1, E1, D1 and D2 are shipped and verified. D2 code is `0851bed`, deployed
at <https://pokerface.katswint.com>; its closing record `1d90561` passed all eight jobs
in [CI 44965504398](https://github.com/katswnt/poker-face/actions/runs/44965504398).
The [D2 handoff](codex-handoff-2026-11-21-d2.md) retains full release/source identities.

H1 code `6ca2f9a` is pushed but not released: 200 original hands / 1,031 decisions retained.
Its full local exact-commit checks passed, but CI `44970183319` failed on two Linux WebKit
200% screenshot height limits. The fix preserves coverage with overlapping viewport tiles;
nine focused three-browser reflow checks pass. Production remains on D2. Finish exact-commit isolation with
copied dependencies, full tests, tsc/lint, all listed audits, fresh native/WASM/source,
production build, full browsers, push/green CI, guarded Vercel deploy and public verification.
Do not describe the candidate as deployed. Update the H1 record/handoff with measured results.

Protected trainer/session work, README trainer hunks, the paused configurable-flop draft,
its plan and the pre-existing data-publication note remain untouched. Check the safeguards
before staging explicit milestone files. PF4 stays gated; physical phones remain open and
nonblocking. Never exclude dirty files to pass type-checking; test the isolated exact commit.
