# Preflop ranges: sourcing research (6-max, 100bb cash, no ante)

Date: 2026-09-25. Scope: where to get defensible preflop ranges for the saved BTN-vs-BB SRP flop library
(and later RFI by position, BB defend vs BTN/CO, SB vs BB, 3-bet pots). This was desk research only: no
builds or solves. **Not legal advice.** The license notes below are an engineer's reading and flag
uncertainty where it exists.

Where we are today: `src/lib/solver/bridge/fixtures.ts:150` labels the spot ranges
`"hand-written approximations, not solved: rough 100bb BTN 2.5bb open / BB flat-call ranges for benchmarking only"`,
and `contract.ts:52` hashes that provenance string into the spot. That label is honest. The question is
what to replace the ranges with.

---

## 1. Options table

| # | Source | License (verbatim / status) | Formations | Format | Quality / provenance | Effort | Usable? |
|---|---|---|---|---|---|---|---|
| A | **TexasSolver v0.2.0 release zip**, `ranges/6max_range/…` and `ranges/qb_ranges/{100bb 2.5x 500rake, PioRanges_nlhe_100bb_3x_NL200}` (the Windows zip has 3,013 range entries; the Linux zip has none). The same files ship byte-identical in TexasSolverGPU. | The repo is AGPL-3.0 (GitHub SPDX). README: "TexasSolver is under AGPL-V3 license". **But** the files are dated 2019, which predates the 2021 project, and one folder is literally named `PioRanges_…_NL200`. Open issue #11 says: *"The TexasSolverGPU EULA does not grant an explicit public license for the bundled materials."* No maintainer has replied. | Full 6-max tree: UTG/MP/CO/BTN 2.5bb, SB 3bb, vs-open, 3-bet (11bb), 4-bet (22–24bb), all-in. Includes 500rake. | Text, 1326-combo weights | Solver-looking output from an **unknown, probably commercial** source (PioSolver range packs?). Rake model undocumented. | Low (parse text) | **No.** The AGPL label on the repo doesn't show that the uploader had the right to license third-party range packs. The provenance can't be defended. |
| B | **jensbaagaard/poker-practice** `data/openSourcePokerData/*.json` (Cash_100_GTO, _2bb, _3bb, PRO, PTO, Simple) | MIT. README: *"MIT. The range data in `data/openSourcePokerData/` is free to use."* | 6/8/9-max. Cash 100bb (2/2.5/3bb opens) and MTT depths. RFI, vs raise, vs 3/4/5-bet. | JSON | The data README gives **no solver, rake, or creator**. It was added in one commit ("Open Range Viewer…", co-authored by an LLM). The "openSourcePokerData" name suggests it was lifted from somewhere else. | Low | **No (for now).** MIT from a party who may not own the data is worth nothing as provenance. We could ask the author where it came from. |
| C | Other MIT GitHub trainers (NittonNi/poker-app-v1 has no license; byw1/poker-trainer MIT; Rizehigh/gto-preflop-trainer MIT; frla18cz/poker-solver MIT with "825 precomputed preflop spots"; hansel7121/GTO) | Mostly MIT, some with no license. hansel7121 says its ranges are "text ranges published on pokercoaching.com". frla18cz calls its data "a starting point, not a solved game". | Mostly RFI, some vs-open | JSON/TS | Hand-written or copied from commercial sites. None documents a solve. | Low | **No.** At best these are the same thing we already have. |
| D | b-inary **wasm-postflop / desktop-postflop / postflop-solver** | AGPL-3.0-or-later: *"This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version."* | **None.** These are postflop-only and ship no preflop presets (checked README/docs). | n/a | n/a | n/a | Nothing to reuse. |
| E | **Commercial / free-but-proprietary charts** (GTO Wizard, Upswing, PokerCoaching, Red Chip, PioSolver packs, preflopwizard.app, BeyondGTO, freebetrange) | GTO Wizard ToS 7.5: *"User may not monetize or otherwise use in commerce, individually or via third-party application, poker ranges, poker trees and poker charts downloaded or otherwise obtained from Service."* 7.7: *"User shall not use any automated requests or any scripts within Service…"* Upswing: *"You may not modify, copy, publish, display, transmit, adapt or in any way exploit the content of the Site."* It permits only *"one copy … for personal, noncommercial home use only"*. | Everything | Images/PDF/app | Highest quality (real solves with documented rake), but provenance is theirs | Low to copy | **No.** See section 2. Use them only as cited aggregate **sanity-check numbers**, never as data. |
| F | **Compute our own** (section 3): a small CFR preflop solver, with flop EV = pot × equity × realization factor R | Ours, AGPL-3.0-or-later | We choose. Start with BTN vs BB, then RFI for all seats, SB vs BB, 3-bet pots. | Our spot-contract range strings | Fully reproducible, but it's a **model**: R is an assumption. Quality depends on R. | ~3–6 days to MVP | **Yes. Recommended.** |
| G | Open-source preflop solvers to reuse or crib from: **exinori/DCFR-SOLVER** (MIT; "6-max preflop solver using External Sampling MCCFR: 2.2 million information sets, 100 million iterations in 14 minutes"). **MatthewPDingle/GTOpen** (Rust; "Preflop is solved against an equity-realization model, not full-game trees"). **krukah/robopoker** (MIT; full-game abstraction; "Training: 16 vCPU / 120 GB" + Postgres 64 GB). **OpenSpiel** (Apache-2.0; universal_poker/ACPC, heads-up). | DCFR MIT. **GTOpen has no LICENSE file** (GitHub reports none), so all rights are reserved by default: don't copy it, only read its ideas. robopoker MIT. OpenSpiel Apache-2.0. | varies | code | DCFR doesn't document how it values flop terminals. GTOpen documents R fitted from "91k observations". robopoker is a full blueprint and far too heavy. | Med (integrating Rust is less work than writing our own TS solver, but it's another dependency) | DCFR (MIT) is a usable cross-check or oracle. robopoker and OpenSpiel are overkill. |

### Reusing AGPL-licensed ranges in an AGPL project

It's compatible. AGPL-3.0(-only) material combined into our AGPL-3.0-or-later work is fine. The combined
work is then effectively distributable under AGPL-3.0, and the or-later grant still covers our own files.
The obligations (AGPL §5, verbatim from the license text):
- *"a) The work must carry prominent notices stating that you modified it, and giving a relevant date."*
- *"c) You must license the entire work, as a whole, under this License to anyone who comes into possession of a copy."*
- §4/§5: keep the original copyright and license notices, and credit the source in a NOTICE/README section.

MIT and Apache-2.0 inputs are also one-way compatible into AGPL-3.0. MIT requires *"The above copyright
notice and this permission notice shall be included in all copies or substantial portions of the
Software."* Apache-2.0 requires keeping its NOTICE file.

**The catch:** a license is only worth as much as the licensor's ownership of the thing licensed. For A
and B, that ownership is exactly what's in doubt.

## 2. Proprietary charts: facts vs. expression (uncertain; not legal advice)

- **US:** *Feist v. Rural* (499 U.S. 340, 1991) holds that facts aren't copyrightable. A compilation is
  protected only for its original selection and arrangement. A solver's output ("AKo raises 100% at node
  X") is arguably a machine-computed fact, so a re-typed 169-cell frequency table could have thin or no
  copyright. But the chart images, colour layout, and curated "simplified" charts (human rounding and
  selection choices) are more clearly expression.
- **EU/UK:** the *sui generis* database right (Directive 96/9/EC) can protect a substantial extraction from
  a database that took substantial investment to make, even when the contents are facts. Solver-farm
  output plausibly qualifies.
- **Contract beats copyright:** anyone who accepted GTO Wizard's or Upswing's ToS is bound by the
  no-commerce, no-copying, and no-scripting clauses whatever the copyright status. This repo is public and
  presented as a portfolio piece, so "they might not be copyrightable" is not a position to put in a README.
- **Bottom line:** don't copy, transcribe, or scrape proprietary charts. Citing *aggregate* statistics from
  them (e.g. "BTN opens ~43%") with a link, as validation targets, is ordinary commentary and fine.

## 3. Computing our own: feasibility

**Model (what GTOpen, MonkerSolver-style "preflop-only" solvers and Janda-style analyses do).** We solve
the preflop betting tree exactly and replace each flop-reaching terminal with
`EV_i = pot × equity_i(hand | opp range) × R_i − invested_i`, where `R_i` is a realization factor. R
depends on position and hand class: IP > 1 is common for suited/connected hands, OOP BB is often
~0.7–0.9. All-in terminals use raw equity with R = 1.

**Size and runtime (days, not months).**
- Hand representation: 169 classes with card-removal weights, or 1326 combos. Precompute a 169×169 (or
  1326×1326) all-in equity matrix once. Monte Carlo at ~1e5 runouts per pair takes minutes on CPU. Our
  `src/lib/poker` evaluator already exists.
- HU subtree (BTN vs BB after folds, SB treated as folded; open 2.5 / 3-bet 11 / 4-bet 24 / jam): about 10
  decision nodes × 169 hands. CFR+ converges in **seconds**.
- Full 6-max RFI with a single raise size and 3/4-bet/jam responses is ~1e5–1e6 infosets (DCFR-SOLVER
  quotes 2.2M infosets, 100M MCCFR iterations in 14 min). That's **minutes to an hour** on CPU. Multiway
  pots after cold calls need a multiway equity approximation. GTOpen uses "coupled-deck equity". It's
  simplest to disallow cold-calls at first, or to treat 3-way as rare and restrict it.
- **Elegant twist for this repo:** calibrate R for BTN-vs-BB SRP from **our own postflop-solver library**.
  Realized EV / (pot × equity) per hand class, averaged over the saved flops, gives R. Feed it back into
  the preflop solve and iterate once or twice. That turns an assumed parameter into a measured one and
  ties the preflop and postflop halves of the project together.

**Academic grounding.** Brown & Sandholm, *Superhuman AI for multiplayer poker* (Pluribus), Science 2019:
the 6-max blueprint came from MCCFR over an abstracted full game, and the blueprint wasn't released.
Chen & Ankenman, *The Mathematics of Poker* (2006): the realization and equity framework, and jam/fold
games. Ganzfried & Sandholm (AAMAS 2008, "Computing an approximate jam/fold equilibrium for 3-player
no-limit Texas hold'em tournaments"): exact small-game preflop equilibria. These justify the method. None
of them supplies usable 100bb charts.

**Validation (aggregate targets, cited; all secondary sources with only partly documented assumptions).**

| Metric | Target band | Source |
|---|---|---|
| RFI UTG / HJ / CO / BTN / SB | ~15 / 19 / 27 / 43 / 36% (2.5bb, SB 3bb) | preflopwizard.app/blog/6-max-preflop-charts; beyondgto.com/ranges (no solver or rake stated) |
| BB defend vs BTN 2.5x | ~52–58% raked; wider without rake | vip-grinders.com/poker-strategy/big-blind-defense; preflopwizard.app/blog/big-blind-defense ("~56%", assumptions not disclosed) |
| BB vs LJ open, 100bb cash | folds 62% (NL50) vs 59% (NL500) | blog.gtowizard.com/rake-rakeback-explained-optimize-your-poker-earnings |
| Rake direction | more rake means tighter preflop play; "no flop no drop" widens 3-betting | same GTO Wizard article |

Note: the brief's "BB defend vs BTN ~60–70%" is above every raked figure I found. It may be about right
for **no rake**, but I found no citable no-rake number. Treat 55–70% as the band and record which rake we
model.

Structural checks, all automatable in `npm test`:
- ranges are monotone in position (UTG ⊂ HJ ⊂ CO ⊂ BTN, approximately);
- BB defense ≥ the MDF-style lower bound (≈ 1.5/4.0 = 37.5% vs 2.5x, before accounting for realization);
- all 1326 weights are in [0,1] and action frequencies sum to 1;
- the solver's own exploitability or convergence gap is below a threshold;
- the output reproduces when re-run from the seed or config hash.

## 4. Recommendation

**Option F: compute our own, with R measured from our postflop library.** Keep the current hand-written
ranges, honestly labelled, until the first output passes validation.

Concrete next step (after the CPU benchmarks finish): write `tasks/preflop-solver-v1-spec.md` for a **HU
BTN-vs-BB preflop CFR+ solver** with this scope:
1. Tree: BTN open 2.5 (SB folded), BB fold/call/3-bet 11, BTN fold/call/4-bet 24, BB fold/call/jam, BTN
   fold/call. No rake in v1, with a rake parameter stubbed.
2. Precompute a 169×169 equity matrix with card-removal weights, as a checked-in JSON file with a hash.
3. Use literature R defaults (IP 1.0, OOP 0.8; configurable). Solve. Emit BTN-open ∩ BB-call ranges into
   the spot-contract `provenance` field as
   `"poker-face preflop CFR+ v1, HU BTN vs BB, R=…, no rake, config <hash>"`.
4. Calibration pass: measure R from the saved flop library, re-solve, and diff the ranges.
5. Validation tests from section 3, wired into `npm test`.
6. Optional: MIT DCFR-SOLVER as an independent cross-check on one spot.
7. Then extend to RFI for all seats, SB vs BB, and 3-bet-pot ranges.

## 5. README labelling guidance

- **Now:** "Preflop ranges for the flop library are hand-written approximations of 100bb 6-max BTN-open /
  BB-call ranges. They are not solved and not taken from any chart service. Postflop results are exact
  for these input ranges, not for 'real' GTO preflop play."
- **After F:** "Preflop ranges come from our own simplified preflop solve: CFR+ on the preflop betting
  tree only, flop play modelled by equity × realization factor (R measured from our postflop solves). No
  ante, <rake>. This is a model, not a full-game equilibrium. It matches published aggregate stats within
  <bands> (sources linked)." Link this file.
- **Never** say "GTO preflop ranges" without "simplified model". Never name a commercial product as the
  source. Cite aggregate numbers as validation, not as the origin.

## Sources
- TexasSolver: https://github.com/bupticybee/TexasSolver (release v0.2.0 assets inspected)
- TexasSolverGPU issue #11: https://github.com/bupticybee/TexasSolverGPU/issues/11
- poker-practice: https://github.com/jensbaagaard/poker-practice
- b-inary: https://github.com/b-inary/wasm-postflop, https://github.com/b-inary/desktop-postflop
- DCFR-SOLVER: https://github.com/exinori/DCFR-SOLVER
- GTOpen: https://github.com/MatthewPDingle/GTOpen
- robopoker: https://github.com/krukah/robopoker
- OpenSpiel: https://github.com/google-deepmind/open_spiel
- frla18cz/poker-solver: https://github.com/frla18cz/poker-solver
- hansel7121/GTO: https://github.com/hansel7121/GTO
- GTO Wizard terms: https://gtowizard.com/terms
- Upswing terms: https://upswingpoker.com/terms/
- GTO Wizard rake article: https://blog.gtowizard.com/rake-rakeback-explained-optimize-your-poker-earnings/
- preflopwizard: https://www.preflopwizard.app/blog/6-max-preflop-charts, https://www.preflopwizard.app/blog/big-blind-defense
- BeyondGTO: https://beyondgto.com/ranges
- VIP Grinders: https://www.vip-grinders.com/poker-strategy/big-blind-defense/
- Feist v. Rural: https://supreme.justia.com/cases/federal/us/499/340/
