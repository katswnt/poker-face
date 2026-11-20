# E1 release and network diagnosis — 2026-11-20

E1 shipped as `bfecbced77d8a70a1eee80315974d911a00541f5`, after isolated exact-commit
verification and all eight jobs in CI `44813301904` passed. It is deployed to
<https://pokerface.katswint.com/play>; public engine/source hashes and three-browser
play checks pass. R1's guarded production release process remains in effect.

## What E1 adds

`/play` can display action EVs for admitted live turn/river decisions and compare a
supported human action with the best listed action in the original decision model.
Expected value means chips returned from here minus future contributions; earlier
contributions are sunk. These values follow that local solved policy, not the composed
AI after later re-solves. Unsupported, translated or unavailable choices stay ungraded.
There is no inferred session EV score or claim that a zero gap proves GTO correctness.

The shared native/WASM export is opt-in, reserved before allocation and independently
checked. Blocked and unreachable rows remain unavailable. The original human model
survives off-menu preparation, cancellation and retry. AI hand-specific values remain
hidden until the hand ends. Existing policies, ranges, random draws, actions and chip
settlement are unchanged. `/solver/live` continues without this optional value export.

The frozen prospective contract and full tables are in
[live-decision-ev-spec.md](live-decision-ev-spec.md). Historical P1–P5 artifacts were not
rewritten; six new source-bound successor bundles include complete parent records.
The exact 76 implementation paths are recorded by
`git diff-tree --no-commit-id --name-only -r bfecbce`.

## Measured results

- 1,000 native hands, 1,342 requests and 1,148 distinct policies: the enabled/disabled
  exports preserve mathematical results, actions, complete logs and ledgers exactly.
- P1: 64 full-range roots, no pruning; independent median 0.244491558% pot, maximum
  0.297718121%. P2 composed exploitability remains **23.399062636% of the subgame pot**.
  The page's 23.4% warning remains visible; this is not an expected win rate or global bound.
- P3: all 200 frozen cases and 327 accepted solves pass; enabled payloads contain
  1,069,302 numbers and 191,582 unavailable cells. P4: 200 cases, 159 live solves.
- P5: all 200 UI-controller hands, 301 requests and 295 policies preserve original
  behavior. Teaching snapshots are checked separately from mathematical identities.
- Enabled Chromium response p95: **4,240.8 ms turn**, **63.9 ms river**, against unchanged
  10,000/2,000 ms gates. All 600 measured cases across three browsers pass their contracts.
- Measured turn p95 Chromium/Firefox/WebKit: **4,312.7 / 50,507 / 4,382 ms**. Firefox
  retains its existing 120-second observer contract, not a 10-second performance claim.
- Peak WASM linear memory is **31,260,672 bytes (29.8125 MiB)** in each browser, versus
  29.6875 MiB with export disabled. This excludes browser process memory and JS heaps.
  Largest actual JSON payload: 241,071 bytes. Maximum measured `finish()` is 68.8 / 812 /
  71 ms and includes finalization plus export, not just the new feature's incremental cost.
- Three tiny independent references remain within the fixed **0.0002-chip** gate;
  maximum discrepancy is 0.000033955415 chips. The five frozen production-river samples
  have maximum discrepancy **0.002390549696 chips**, below their separate prospective
  0.05-chip sample gate. Neither figure bounds error for every possible hand.

## Exact-commit verification

Clean checkout: `/private/tmp/poker-e1-exact-67o58von`, with **copied**, not symlinked,
node_modules. Both engines were rebuilt with Rust 1.98.1 and wasm-bindgen 0.2.104.

- **1,101/1,101** unit tests, zero failures/skips, 156.370 s; typecheck and lint pass.
- **23/23** Rust tests, both formatting and Clippy checks pass.
- All 14 audits pass: bridge, WASM, saved example, river v3, heads-up library, P1–P5,
  E1 values, preflop reproduction, wide-range evidence and gadget study.
- Three-browser WASM/Worker harnesses pass. River v3 still reproduces value
  16.081056725 chips and exploitability 0.009074631 chips.
- Saved-only preview build and app suite: 87 passes, 9 explicit asset-required skips.
  Missing production assets correctly refuse before Next starts.
- Prepared production build and full app suite: 96/96. Three-browser play: 28 passes,
  two explicit non-Chromium zoom-API skips. Live solver: 34 passes, two same skips.
  Zero retries. Narrow live-value tables and real Chromium 200% zoom were inspected.
- Pinned Vercel packaging succeeds; all six packaged engine/source files match the
  verified preparation. The clean source checkout remains unchanged.

Raw logs and screenshots: ignored `build/post-p5-2026-11-19/E1-exact-bfecbce/`.
Earlier candidate evidence, failure logs and measurement captures are retained under
`E1-candidate-verified/` and in `/private/tmp/poker-live-ev-87kic_rz`.
The one corrected candidate test was an expected-error mismatch: a one-chip mutation
was rejected earlier by the stricter identity check. No guard or tolerance was loosened.

## Production deployment — 2026-11-20

All eight jobs in [CI 44813301904](https://github.com/katswnt/poker-face/actions/runs/44813301904)
passed on `bfecbced77d8a70a1eee80315974d911a00541f5` before deployment.
The main push created no replacement production entry in the observed Vercel list.
Vercel CLI 62.1.0 then deployed the verified clean package to the existing project.

- Deployment: `dpl_8D4ohZcho7zqDt6yrhupq1sWxibM`; Ready, production.
- Immutable URL: <https://poker-face-ccf41zv03-kat-swints-projects.vercel.app>.
- Public page: <https://pokerface.katswint.com/play>.
- Build SHA-256: `9c60cd7b4f6d56e271f344caf8441836b88ed43f3054d0aa85076ed29b28dc7d`.
- Engine source SHA-256: `f6bc73d115885a997ac66390fdcaf489b7974541a481fbd66ddfd9127531f981`.
- WASM: **811,207 bytes**, SHA-256 `32efb5beef3f6668c0512799b5786f332694f27194256d80520b0bf476f5f5ec`.
- Corresponding AGPL source: **4,808,775 bytes**, SHA-256
  `35e959307a9dc5cbcad605975953cd3fddf91c7289b9a072753137a855e595ca`.

Public verification passed at **2026-11-20T21:14:09.749Z**: every one of the six fetched
assets matches the prepared distribution byte for byte. Both engine-serving pages link
the corresponding source archive and show the correct build identity; `/play` retains
the measured 23.4% warning. Different clean build paths/commit metadata can change
binary/archive bytes; this establishes source correspondence and numerical parity,
not a universal bit-identical-build claim.

Deployed three-browser play: **28 passes / 2 explicit non-Chromium zoom-API skips**,
zero failures/flakes/retries, **120.433 s**. This covers real
hands, off-menu actions, live EVs and original-model grades, missing-engine recovery,
Worker cancellation/retry, keyboard controls, source links, responsive layouts and real
Chromium 200% zoom. Deployed narrow live-value and zoom screenshots were inspected.
Physical phone performance remains unvalidated; the existing Firefox limitations remain.

Local release evidence is retained under ignored
`build/post-p5-2026-11-19/E1-exact-bfecbce/`; current machine-readable state is
`E1-release-current.json`. The closing documentation commit changes no app/engine code
and must pass isolated full tests, typecheck, lint and the 14 audits before push, followed
by all eight CI jobs. It is not a separate production deployment.

## Network diagnosis

Read-only checks at 20:19 UTC reproduced DNS failures for all four tested hosts inside
the restricted execution sandbox. The same hosts resolved and completed verified TLS
outside it. Poker Face, npm and GitHub returned HTTP 200 in 0.716 / 0.721 / 0.793 s.
Vercel's unauthenticated 403 explicitly says the request lacks a token; authenticated
Vercel CLI 62.1.0 `whoami` succeeds as `katswnt`. No new login is needed.

At 20:25:36.525 UTC, all six public R1 assets matched the previously verified lengths
and SHA-256 hashes; `/play` and `/solver/live` returned HTTP 200 with matching source
links. This did not reproduce a missing-engine or corrupted-deployment failure. Earlier
automatic approval-review timeouts happened before commands launched and reported no
safety finding; the explicitly approved full suite subsequently passed.

No DNS, firewall, account or credential settings were changed. The user has not supplied
the exact unseen network error, so these observations do not establish or fix every
possible Codex/browser failure. Machine-readable evidence is in ignored
`build/network-diagnostic-2026-11-20.json` and
`build/network-assets-diagnostic-2026-11-20.json`.

## Untouched work and next scope

All 15 protected non-README hashes match the P3 safeguard; the trainer README's 49
added/removed lines are preserved. Leave these tracked changes alone:
`METHODOLOGY.md`, trainer `README.md` hunks, `e2e/keyboard.spec.ts`,
`src/app/globals.css`, `src/components/PokerSim.tsx`, `test/copy.test.ts`.
Also untouched: `src/lib/poker/session.ts`, `test/session.test.ts`,
`src/lib/solver/postflop/configurable-flop/`, `tasks/configurable-flop-v2-plan.md`,
and `tasks/poker-data-reuse-and-publication.md`. Do not exclude the paused draft from
type-checking; use exact-commit isolation.

After E1 release closure: write prospective push/fold and equity-vs-range drill contracts,
then implement them, then `/play` hand review. Restricted push/fold does not validate or
unlock PF4. Preflop remains scripted, ranges hand-written, flops limited to 12 saved
boards, and strategies approximate for specified finite games. Physical iOS/Android
performance remains an open, nonblocking check; Firefox turns can take tens of seconds.
No partial turn cache or global safety guarantee is enabled by this milestone.
