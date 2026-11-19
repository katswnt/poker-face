# After P5: production safeguard, then live decision values

Authorized by Kat on 2026-11-19. Baseline: `a9cbce9`; production app/engine: `22f513e`.
W1–W4/P1–P5 remain complete. Preserve the trainer/session work and paused configurable-
flop draft exactly. Follow the CPU roadmap's isolated verification, explicit staging,
fail-first tests, unchanged mathematical gates and honest-copy rules for each milestone.

## R1 — prevent an asset-less Git build replacing live play

Observed failure: pushing P5's closing docs produced a default Vercel build without the
ignored `public/solver-live` assets. Production needed manual re-promotion. The fix is an
explicit release path, not silently claiming that ordinary Git builds contain the engine.

- Disable Git-triggered deployments for `main` in repository `vercel.json`; unspecified
  preview branches retain Vercel's default automatic builds. CLI deployments remain available.
- Use a Vercel build wrapper. Production requires prepared assets. Reject a dirty checkout,
  an engine manifest from another commit, stale bridge sources, missing/corrupted files,
  and an AGPL archive whose contents differ from the corresponding distribution.
- Keep ordinary local/CI saved-only builds available. No engine or mathematical change.
- Add a reusable public verification command: compare descriptor, manifest, glue, WASM,
  notices and source archive bytes; check both serving pages link the corresponding source.
- Document the clean native/WASM rebuild, exact-commit checks, pinned CLI package/deploy,
  and post-deploy verification. No new project, plan change or credential in the repository.

Pros: docs pushes preserve working production; release identity and source are checked;
no new secret or CI deployment credential. Cost: merging code is not a production release;
an operator must run the documented release procedure. Preview builds remain saved-only
unless deliberately prepared. The explicit procedure and verifier make this visible.

R1 gates, set before implementation:

- [x] Tests fail first for absent, stale, corrupted and mismatched prepared/source data;
  valid data and saved-only preview builds pass. Production refuses before invoking Next.
- [ ] Real clean distribution/archive passes; tampering is detected. No source, strategy,
  admission, tolerance or frozen solver artifact changes.
- [ ] Isolated exact commit with copied node_modules: full unit suite, typecheck, lint,
  bridge/WASM, saved example, river v3 and heads-up P1–P5 audits; production build.
- [ ] Explicit-files commit/push; all eight hosted CI jobs green. Verify the main push
  does not create a replacement production build and the known live identity remains.
- [ ] Exercise the guarded prepared Vercel build and release; verify public bytes and
  real-hand/cancel/retry smoke; record identities and measured results below.

Owned R1 paths: `vercel.json`, `scripts/build-vercel.mjs`,
`scripts/verify-live-release.mjs`, `test/live-release.test.ts`, `package.json`,
this task record, and only the relevant README release instructions. The build-failure
amendment below also owns `src/app/layout.tsx` and the three explicit
`public/fonts/jetbrains-mono/{JetBrainsMono-variable.ttf,OFL.txt,provenance.json}` files.

Official configuration/CLI references checked November 19:
[branch deployment control](https://vercel.com/docs/project-configuration/git-configuration#gitdeploymentenabled),
[prebuilt deployment](https://vercel.com/docs/cli/deploy#prebuilt),
[staged production](https://vercel.com/docs/cli/deploy#skip-domain).

## E1 — live action values and grades

First write `tasks/live-decision-ev-spec.md`, with the precise value convention, valid
decision coverage, independent reference calculations, tolerances, performance budgets,
source-bound evidence migration and release gates. Do not change the engine before that
contract and failing tests exist.

Target: action EVs for admitted live turn/river decisions and the difference between a
human's supported choice and the best-valued available action, under that local solved
policy. These are not values against the later composed re-solving opponent or a global
optimality guarantee. Never infer values from action frequency or showdown equity.
Unsupported/off-menu/translated actions stay explicitly ungraded unless the exact action
and continuation are represented by the graded solve. Preserve original saved-policy grades.

Investigate the native slice export/value conventions before choosing the implementation.
Prefer a teaching export that leaves strategy generation, reach, RNG and chip settlement
unchanged. Bound its data size and measure solve/export cost. Account for forced prefixes,
sunk chips, blocked/zero-reach hands, both seats, all-ins and zero-frequency actions.
Avoid changing frozen P1–P5 evidence in place: extend source-bound proof records if needed.

Pros: learners can distinguish costly choices from harmless mixing; values are auditable.
Risks: wrong chip conventions, misleading certainty near ties, extra export cost, and
confusing local values with whole-opponent performance. Mitigate with independent tiny-game
references, explicit units/error handling, measured budgets and persistent scope labels.

After E1: prospective contracts for push/fold drills and equity-vs-range drills, then
`/play` hand review. PF4 stays gated. Physical-device checks remain open and nonblocking
under Kat's existing policy; no new phone-performance claim.

## Execution record

Initial tree matches the closing handoff. All 15 protected non-README hashes match the
P3 safeguard; trainer README bytes/diff were saved in ignored `build/post-p5-2026-11-19/`.
Work uses an isolated candidate with copied dependencies. No implementation changes yet.


### R1 candidate — 2026-11-19

Added six assertion-based test cases before the implementation (initial run failed on
missing release tooling). The implementation now passes all six, including valid clean
source, absent assets before Next, byte corruption, missing archives, both kinds of dirty
worktree, stale source, old commits, incorrect archive contents and archive links.
Typecheck and lint pass. Test files use disposable Git repositories; no global Git
configuration, production state, mathematical engine or protected draft is changed.

`npm run verify:release` verifies the local manifest and every distribution file, the
clean commit, original bridge input hashes and complete archive contents. Its `--origin`
mode fetches six public assets and verifies both pages' matching build/source identity.
The Vercel wrapper calls this verification before Next for production/required-live builds;
preview builds can still omit the engine. Main-only Git deployment suppression is the
normal path; the build guard also refuses unprepared manual production builds.

The exact-commit, real-distribution, hosted CI and live-deployment gates above remain
open until measured. Candidate logs: ignored `build/post-p5-2026-11-19/` on primary.


### R1 build-failure amendment — same milestone, not a solver change

The first exact commit (`4498146`, not pushed) passed **1,066/1,066** tests (136.451 s),
typecheck, lint and all 12 listed solver audits. Its preview build failed in Next/font:
`next/font/google queries have exactly one entry`. The unchanged `npm run build` failed
identically; Next/SWC package versions, native module bytes and lockfile match the shipped
P5 checkout. This is the [reported upstream extensionless Google Fonts URL problem](https://github.com/vercel/next.js/issues/99114), not an engine or wrapper failure.

The bounded fix uses `next/font/local` with the same JetBrains Mono family and existing
CSS variable/400–700 weight range. The unmodified upstream v2.304 variable font is
303,144 bytes, pinned to commit `cd5227bd1f61dff3bbd6c814ceaf7ffd95e947d9`, Git blob
`b60e77f5dbf5505436c1904cb7a9ac4111ee76d0`; SHA-256 is recorded beside it. Its SIL OFL 1.1
licence is included publicly; it remains under that licence, not relicensed as AGPL.
This trades a larger complete variable-font asset for network-independent builds and
full upstream glyph coverage. No claim of improved phone load time. No protected global
styles or trainer files are changed.

Before the layout edit, a seventh test failed on the Google-font import. It now verifies
local loading, the original CSS variable, font format/length, exact upstream binary identity
and licence presence. All seven release tests and the previously failing preview build pass.
The amended exact commit must repeat full verification and full prepared app/P5 browser
checks, including narrow screens and real 200% zoom, before pushing. No dependency upgrade,
font mock, bundler switch, reduced test coverage or loosened gate is used.
