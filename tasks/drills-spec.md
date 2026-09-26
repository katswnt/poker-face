# Instant poker math drills — spec (2026-09-25)

North star: the project exists to practice poker math until the common numbers are instant.
The drills page (`/drills`) asks one short question at a time, times the answer, grades it
against an exact value, and explains the exact formula with the user's numbers plugged in plus
the at-table shortcut. Everything the page computes is exact arithmetic or exact enumeration;
rules of thumb are always labelled as approximations.

## Goals

1. Speed with correctness: a visible timer and per-type speed targets; a fast wrong answer is
   still wrong.
2. Learn the shortcut, not only the answer: every explanation shows (a) the exact formula,
   (b) the numbers substituted, (c) the result, (d) the at-table shortcut and how far it is from
   exact for this question.
3. Revisit what you miss: missed questions enter a Leitner review queue and come back after a
   short, then longer, gap.
4. Deterministic and testable: every question is a pure function of `(type, seed, level)`.
   Tests replay seeds; the review queue stores only those three values.
5. No time pressure that fails you: the timer measures, it never auto-submits or auto-fails
   (WCAG 2.2.1). Speed only affects the "fast" badge and the difficulty ramp.

Non-goals (now): multiway pot odds, implied odds, rake, ICM. Solver-backed decisions were
specced here as a later pluggable source and are now implemented (see "Solver-backed decisions").

## Conventions (used identically in the code, the copy and the tests)

- **pot** `P` = chips in the middle before the bet being discussed.
- **bet** `B` = the opponent's bet (heads-up, into `P`).
- **call** `C` = what the hero must add to continue. In these drills the hero has put nothing in
  on this street, so `C = B`.
- **pot before call** = `P + B` (it includes the bet).
- All chip amounts are in big blinds (bb), shown with at most 1 decimal.

## Drill types and exact formulas

| id | Question | Exact answer | Answer kind | Tolerance | Speed target |
| --- | --- | --- | --- | --- | --- |
| `pot-odds` | Opponent bets `B` into `P`. What equity do you need to call? | `C / (P + B + C) = B / (P + 2B)` | percent | ±1.0 pt | 6 s |
| `mdf` | Opponent bets `B` into `P`. Minimum defence frequency? | `P / (P + B)` | percent | ±1.0 pt | 6 s |
| `bluff-share` | You bet `B` into `P` with a polar range (nuts or air). What share of the bets can be bluffs so a bluff-catcher is indifferent? | `B / (P + 2B)` | percent | ±1.0 pt | 8 s |
| `outs-equity` | You have `X` clean outs with `k ∈ {1, 2}` cards to come and `U` unseen cards. Chance to hit at least one? | `k = 1`: `X / U`; `k = 2`: `1 − C(U−X, 2) / C(U, 2)` | percent | ±2.0 pt | 6 s |
| `outs-count` | Your hole cards and the flop are shown. How many turn cards give you a straight or a flush (or better)? | count of unseen cards `c` such that hole + flop + `c` contains a straight or flush | integer | exact | 15 s |
| `combos` | Board and (sometimes) your hole cards are shown. How many combos of a named holding remain? | see *Combo counting* | integer | exact | 12 s (20 s for "either" questions) |
| `call-or-fold` | Opponent bets `B` into `P`; your equity is `E`. Call or fold? | call iff `E > B / (P + 2B)`; generator keeps `|E − required| ≥ 3 pts` so the answer is never a coin flip on rounding | choice | exact | 8 s |

`U` is 47 on the flop (52 − 2 hole − 3 board) and 46 on the turn. `k = 2` means "flop, all-in,
see both turn and river"; `k = 1` means one card (flop→turn or turn→river).

`bluff-share` equals the `pot-odds` number on purpose: the caller's break-even equity is exactly
the bluff share that makes calling break-even. The explanation says so.

`call-or-fold` EV (shown in the explanation, relative to folding): `EV = E·(P + 2B) − B`.

### Combo counting

Dead cards = board plus the hero's hole cards (when shown). For a rank `r`, `n_r` = remaining
cards of that rank (4 minus dead). `N` = remaining cards (52 − dead).

- pocket pair `rr`: `C(n_r, 2)`.
- unpaired `ab`, any suits: `n_a · n_b`.
- suited `abs`: number of suits in which both `a` and `b` remain.
- offsuit `abo`: `n_a · n_b − suited`.
- sets on this board: `Σ C(n_r, 2)` over the board's distinct ranks (pocket pairs that make
  three of a kind).
- "contains an `a` or a `b`" (inclusion–exclusion): `|A ∪ B| = |A| + |B| − |A ∩ B|` where
  `|A| = C(N, 2) − C(N − n_a, 2)`, `|A ∩ B| = n_a · n_b`. Equivalent closed form:
  `C(N, 2) − C(N − n_a − n_b, 2)`. The explanation shows the inclusion–exclusion terms.

At-table shortcuts: pairs 6 → 3 → 1 as one or two are dead; unpaired 16 = 4 suited + 12
offsuit; each dead card of a rank removes a quarter of that rank's combos.

### Outs counting (`outs-count`)

Only flop spots are generated, filtered so that the question is unambiguous:
the flop has three distinct ranks, the hero holds no pocket pair, and the hero does not already
have a straight or better. Under those filters no single turn card can make a full house or
quads, so "straight or flush or better" means exactly "completes a straight or a flush".
Outs are **raw** outs: they are not discounted for cards that also improve the opponent. The
explanation names the draw(s) and the double-counting rule for combo draws
(flush outs + straight outs − cards that do both).

## Grading

- **percent**: the user types percentage points (`25`, `25.0`, `25%`) or a fraction (`1/4`,
  interpreted as `100 · 1/4`). Correct iff `|input − exact| ≤ tolerance + 1e-9`. Exactly on the
  tolerance edge counts as correct. Blank or non-numeric input is "invalid", not wrong — the page
  asks again and the timer keeps running.
- **integer**: must parse to an integer equal to the exact answer (`12`, `12.0` accepted; `12.5`
  rejected as wrong).
- **choice**: the chosen option id must equal the answer id.
- A result records: correct, the exact value, the error (percent types), elapsed ms,
  and `fast = correct && elapsed ≤ target`.

## Timers, streaks and stats

- Timer starts when a question renders, stops on a valid submission, shows seconds with one
  decimal, and changes colour once the speed target passes. It never auto-submits.
- Streak: consecutive correct answers in this session; best streak persists.
- Stats per type (persisted): attempts, correct, fast, and the last 20 correct response times
  (the page shows the median). Stats are practice records, not a skill rating.

## Difficulty ramp

Three levels per type, chosen automatically unless the user pins one.

- Level 1 — round numbers: pots 12, 24, 36, 48, 60 or 120 bb with bets at exactly ¼, ⅓, ½, ⅔, ¾
  or 1× pot (so every bet is a whole number); outs 4, 8 or 9 (flop with two cards to come, or
  turn with one); outs-count spots with 8–9 outs (a plain flush draw or open-ender); combos on a
  flop, pair or any-suits questions; call-or-fold equity 8–20 pts from the price.
- Level 2 — realistic sizes: pots 6–60 bb in 0.5 bb steps, bets 25–150% of pot rounded to
  0.5 bb; outs 2–15 with one or two cards; outs-count spots with 4–11 outs; combos on a flop or
  turn, adding suited/offsuit splits; call-or-fold margin 5–12 pts.
- Level 3 — awkward sizes: pots 3–150 bb, bets 20–250% of pot (overbets), 0.5 bb steps; outs
  2–21; outs-count spots with 12+ outs (combo draws); combos with the hero's hole cards removed
  too, sets on the board and inclusion–exclusion; call-or-fold margin 3–7 pts.

Auto ramp per type: promote after 5 consecutive correct answers at the current level with at
least 3 of them fast; demote after 2 misses in a row. Levels are 1..3, clamped. Only fresh
questions move the ramp; review questions keep the level they were first asked at and do not
move it.

## Spaced repetition (Leitner boxes)

A review item is `{ id, type, seed, level, box, dueAt, lapses }` where `id = type:level:seed`.
Time is measured in **answered questions** (`tick`), not days: drill sessions are short and a
question-count clock is deterministic to test.

- A miss (wrong, or correct but slower than 2× target) puts the question in box 1 (new item, or
  back to box 1 with `lapses + 1`).
- Box gaps (questions until due): box 1 → 3, box 2 → 8, box 3 → 20, box 4 → 50.
- Correct and not slow on review: box + 1; leaving box 4 graduates the item (removed).
- Wrong on review: back to box 1.
- Next question: if a due item matches the chosen drill type (any type in mixed mode), serve
  the earliest-due one (ties: lowest box, then id); otherwise generate a fresh question. The
  question just answered is never served twice in a row.
- "Review" mode serves only **due** items. When nothing is due it says how many are saved and
  when the next is due, instead of serving items early (otherwise an item could be promoted
  through all four boxes by answering it back to back).
- Queue cap 200 items; beyond that the highest-box, latest-due items are dropped first.

Storage: one `localStorage` key `poker-face:drills:v1` holding `{ version, tick, review,
stats, progress, bestStreak }` (the session streak is not persisted). Every read and write is wrapped in try/catch; a corrupt or missing
value, or a throwing `localStorage`, yields a fresh in-memory state and the page still works.
The loader validates shape and drops malformed items.

## Explanations

Each question carries `explanation: { formula, plugged, result, shortcut, shortcutValue?,
note? }`, e.g. pot-odds with `P = 100, B = 50`:

- formula: `required equity = call ÷ (pot before call + call)`
- plugged: `50 ÷ (150 + 50) = 50 ÷ 200`
- result: `25.0%`
- shortcut: `bet ½ pot → you risk 1 to win 3 → 1 ÷ (1 + 3) = 25%` (bet fraction `f`:
  `f ÷ (1 + 2f)`; memorise ¼ → 16.7, ⅓ → 20, ½ → 25, ⅔ → 28.6, ¾ → 30, pot → 33.3, 2× → 40).

For outs-equity the shortcut is the rule of 2 / 4 and is labelled **approximate**, with its
value and its error for this question; the note gives the correction for big draws (rule of 4
minus `(X − 8)` when `X > 8`, also approximate).

## Deterministic generation

`mulberry32(seed)` (already in `src/lib/poker/equity.ts`) drives every generator. A generator
is `generate(seed, level) → Question`; the same inputs always yield the same prompt, numbers and
answer. Card-based generators deal from `makeDeck()` with the repo's `shuffle(deck, rng)`.
The session (`session.ts`) derives each fresh seed from `(sessionSeed, questionsDrawn)`; the UI
seeds it from the clock, or from `?seed=` so a session is reproducible (`?drill=pot-odds&level=2&seed=42`).
The e2e spec uses this to replay the exact questions the page shows.

## Pluggable question sources (future "solver-backed decisions")

The built-in generators implement:

```ts
interface DrillSource {
  readonly type: DrillType;          // registry key
  readonly label: string;
  readonly answerKind: "percent" | "integer" | "choice";
  readonly speedTargetMs: (q: Question) => number;
  generate(seed: number, level: Level): Question;
}
```

A later `solver-decision` source will read the bridge spot library (a static JSON index under
`public/solver-data/<library>/`, produced by the postflop-solver bridge) and ask "which action
does the equilibrium strategy take most often here, and roughly how often?" It will implement an
async variant — `load(): Promise<boolean>` (false when the library is absent → the type is
hidden) and `generate(seed, level)` choosing a spot by `seed mod spotCount` — so the scheduler,
grader (choice + percent with a wider tolerance, labelled as a solved-model frequency, not "the
right play") and review queue are unchanged. Superseded by "Solver-backed decisions" below, which
grades by EV loss rather than by guessing a frequency.

## Solver-backed decisions (`solver`, 2026-09-25)

North-star tie-in: the math drills make pot odds, MDF and bluff share instant; this drill asks
for a decision in a real solved spot and shows the same numbers for the price in front of you,
then grades the action by what it costs in the solve.

**Data.** The B4 bridge library (`public/solver-data/bridge-v1/`, see
tasks/postflop-solver-bridge-spec.md "B4 spot library"): 12 BTN vs BB single-raised flops,
100bb, postflop-solver (AGPL-3.0) behind the audited bridge, the lean tree, hand-written
approximate ranges. Slices: every flop decision, turn decisions for 8 turn cards, river
decisions for 2 boards, on unraised lines. Chunk numbers are quantized: reach relative to the
node's largest reach in 1e-4, strategy per mille, EV in 0.1 chip, equity per mille.

**Question.** Seeded by `(seed, level)` via `questionRng("solver", seed, level)`:
1. spot uniform over the manifest's spots;
2. a chunk: a street by the level's mix (level 1 flop; 2 flop 40% / turn 60%; 3 "all streets": flop 25% /
   turn 40% / river 35%), then a uniform chunk of that street; if the chunk has no eligible
   node, draw again (up to 6 attempts; then the flop chunk, which always has one);
3. a node uniform among the chunk's eligible nodes;
4. a hand for the acting player with probability proportional to its reach at the node.

Eligibility thresholds:
- node: line frequency ≥ **2%**, where line frequency = (share of BB's range that reaches the
  node) × (share of BTN's), each share = Σ absolute reach ÷ Σ input weight of combos not
  blocked by the board. Conditional on the runout, card removal between the players ignored.
  This drops off-path lines (thin OOP leads, rare raises): 59 flop, 842 turn and 382 river
  nodes qualify of 96 / 1,920 / 2,016 (~388k spot + node + hand questions); 39 of 204 chunks
  (all river chunks on flop lines that start with a BB lead) have none;
- hand: reach ≥ **1%** of the node's largest reach (100 reach units; so never a zero or
  omitted hand), an EV for every action, and at least one action graded wrong (a hand for
  which every action is fine has nothing to grade);
- nodes are drawn uniformly, not by frequency, because frequency weighting makes the flop
  root most questions; the frequency floor already removes rare lines.

Shown: board, pot, stacks behind, the action so far street by street, the hero's hand, and
the legal actions with chip sizes (bet in bb and % of pot, raise-to amount, call amount,
all-in marked). Two optional toggles before answering: **the price** (facing a bet: the
equity needed to call `C ÷ (pot incl. bet + C)` and MDF `P ÷ (P + B)` with `P` the pot before
the bet and `B` = the call; not facing a bet: the same two numbers for each bet you could
make, i.e. what the opponent needs and the bluff share of a polar bet) and **the opponent's
range composition** (reach-weighted, hero's cards removed: straight or better; two pair /
trips / set; one pair; no pair with a flush draw or 8-out straight draw; no pair, no big draw.
Categories count the board). Keys `1`–`9` pick an action.

**Grading.** Per action for this hand, from the stored integers:
`loss = EV(best) − EV(action)` in chips, as % of the pot at the node (pot includes any bet not
yet called). Quantization noise floor: stored EVs round to 0.1 chip, so two EVs within one
unit (≤ 0.1 chip = `1 / EV_SCALE`) are ties (loss 0). Bands:

| band | rule | counts as |
| --- | --- | --- |
| best | loss ≤ 0.3% pot (the library's own exploitability gate) | correct |
| solver mix | loss > 0.3% but the solver plays the action ≥ 20% with this hand | correct |
| close | 0.3% < loss ≤ 2% | miss |
| mistake | 2% < loss ≤ 8% | miss |
| big mistake | loss > 8% | miss |

A mixed action (≥ 20%) is never graded wrong. The "best" action shown is the highest stored
EV (ties: the one the solver plays most). Speed target 20 s. Misses and slow answers enter
the review queue like every drill.

**Explanation.** A table of the solver's frequency, from-now EV (bb) and EV loss for every
action; the price math with the numbers plugged in; the hand's all-in equity against the
opponent's reach at the node (saved per hand in the chunk), compared with the price when
facing a bet; the range composition; and the provenance line: "postflop-solver (AGPL) via
the audited bridge; 12 BTN vs BB flops; ranges are hand-written approximations; not exact or
universal GTO."

**Loading.** `src/lib/drills/solver/` is imported with `import()` only when a solver question
is needed, so the drills page's initial JS does not grow. It uses the library loader
(`loadLibraryManifest`, `loadLibraryRanges`, `loadLibraryChunk`): every file is checked
against its manifest byte count and sha256 and schema-validated; nothing is substituted.
Loaded files are memoised per source (a failed load is not cached, so Retry refetches); spot
and chunk files are fetched `force-cache` first (hash-verified, so a stale copy is refused and
refetched from the network), which keeps answered spots working offline. Errors show "Couldn't
load the solver spot" with Retry; a review item whose data is gone offers "Remove it and continue".

**Session and review.** `advance` returns `pending: { type: "solver", seed, level, key? }` with
`question: null`; the page builds it asynchronously and calls `resolvePending`, which starts
the timer (a stale result, after a mode change, is ignored). Mixed mode stays the synchronous
math drills; Review serves solver items too. Review items for solver questions carry
`key = spotId|path|combo` and id `solver:<key>`; the question is rebuilt from the key
(`fromKey`), not re-sampled, so review is exact even if sampling changes. Storage validates
the key's shape and drops malformed items. URL: `?drill=solver&level=2&seed=42`.

**Tests.** `test/drills-solver.test.ts`: weighted pick exactness and zero weights; seeded
hand picks follow reach at a high-variance node (and a uniform pick fails the test);
determinism by seed; every sampled node/hand re-checked from the raw chunk JSON (frequency ≥
2%, reach ≥ 1%); explanation numbers (pot, call, pot odds, MDF, EV loss, frequencies, equity)
recomputed from raw chunk integers; band edges, the mixed guard and the quantization tie;
review-key round trips and refused keys; corrupted, truncated, 404 and offline loads fail and
a retry succeeds, loaded chunks keep working offline; session pending/resolve and review by
key through storage. `e2e/drills-solver.spec.ts`: keyboard answer and explanation, toggles,
320/390 px without horizontal overflow, load failure → Retry recovers.

**Files.** `src/lib/drills/solver/` (`build.ts` thresholds/sampling/grading/question,
`source.ts` async loading, `tree.ts` path replay and labels, `composition.ts` range groups),
`src/app/drills/SolverPanels.tsx`.

## Tests (`test/drills*.test.ts`)

- Every generator's answer is checked by an independent computation: pot odds / MDF / bluff
  share by formula and by an EV-indifference identity (fast-check properties); outs-equity by
  enumerating all 1- or 2-card run-outs over an explicit unseen-card list; outs-count by
  running the repo's hand evaluator (`rankCards`) over every unseen turn card; combos by
  enumerating every remaining two-card hand from `makeDeck()`.
- Session replay (same seed → same questions), mixed-mode coverage, invalid input not advancing
  the clock, a missed question returning after the box-1 gap.
- Seeded determinism, level ranges, grading edges (exactly at ±tolerance, just outside,
  fractions, `%`, invalid input), scheduler box moves, due ordering, graduation, cap, and
  storage robustness (missing, corrupt, throwing storage).

## Files

- `src/lib/drills/` — `rng.ts`, `types.ts`, `format.ts`, `generators.ts`, `grade.ts`,
  `scheduler.ts`, `storage.ts`, `session.ts`, `index.ts`.
- `src/app/drills/` — `page.tsx` (server, metadata), `Drills.tsx` (client), `drills.module.css`.
- `test/drills-*.test.ts`, `e2e/drills.spec.ts`.
