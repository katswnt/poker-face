# Leduc solver lab — product-readiness audit

**Reviewed:** 2026-09-14

**Scope:** the two-player Leduc toy game in `leduc-v1`, not ordinary hold'em

**Decision:** the math, poker rules, and teaching data are ready for a small separate lab.
The lab must keep the limits below visible. It must not replace the current hold'em trainer.

## The plain answer

The solver is close enough to perfect play for a teaching demo, and we can measure how
far away it is. A perfect response could improve player 0's result by about `0.0054`
chip per hand or player 1's result by about `0.0051` chip per hand. We report the larger
number instead of saying “perfect.”

The rules match the version of Leduc we wrote down. The complete game has 9,451 states,
and our code walks every one. A separate open-source solver produces a player-0 value
within `0.00027` chip of ours.

The saved result now contains the evidence a teacher needs at all 288 situations a player
can recognize:

- which actions are legal and how often the saved strategy uses them;
- the average chip result of choosing each action;
- how much each action trails the best measured action;
- the opponent's possible ranks after accounting for exposed cards and earlier actions;
- how often the player folds later, the opponent folds, or the hand reaches a win, split,
  or loss at showdown;
- how often an opponent folds immediately to a bet or raise;
- whether the situation is so unlikely under the saved strategy that advice should be
  withheld.

These are calculated facts. Explanatory sentences belong in a separate teaching layer so
editing the copy cannot change the math.

## Review by perspective

### Expert CTO

**Pass, with a narrow launch.** The solver, scorekeeper, generated result, and teaching
copy have separate jobs. The generated file records its algorithm, iteration count,
quality measurements, pinned comparison, game-tree fingerprint, and payload hash. A
release check solves the game again and rejects stale bytes.

Launch `/solver/lab` as an explicitly experimental, two-player toy-poker lesson. Do not
send its answers into the four-player hold'em trainer. That boundary matters more than a
flashier feature.

### Expert poker player

**Pass for Leduc; not a hold'em chart.** The deck has two jacks, two queens, and two kings.
Each player antes one, receives one private card, and sees one public card after the first
betting round. A public-card pair beats an unpaired hand. Bets cost one chip before the
public card and two after it. Each round allows one bet and one raise.

The page must say those rules before giving advice. Position here only means “acts first”
or “acts second” in a two-player fixed-limit game. It does not mean button, small blind,
or big blind in ordinary hold'em.

### Expert math professor

**Pass, if the page keeps three numbers distinct.**

1. **Whole-hand result** includes the ante already paid.
2. **Result from now** leaves already committed chips in the past and measures the
   expected chip change from the current decision onward.
3. **Difference from the best measured action** is the cleanest number for comparing two
   choices because the already-paid amount cancels out.

The opponent-rank percentages are conditional probabilities. In plain language: start
with every physical deal that is still possible, give more weight to deals that better
explain the actions already seen, and then combine duplicate physical cards into the
three visible ranks.

The action values assume both players use the saved strategy after the current choice.
They do not assume the learner finds a new perfect plan after taking one different action.
That sentence belongs beside the values, not hidden in methodology notes.

### Expert poker teacher

**Pass for four introductory ideas.** These examples come directly from the committed
teaching data. Rounded numbers are for explanation; the generated file keeps full
precision.

| Idea | Example | What the numbers teach |
|---|---|---|
| Value bet | You hold K and the board is K after bet–call. | Betting is used about 93% of the time. If the hand reaches showdown after betting, it wins 100% of the time. The opponent continues immediately about 36% of the time, so worse hands sometimes put in more chips. |
| Bluff | You hold Q on a J board after check–bet–call. | A bet makes the opponent fold immediately about 40% of the time. If the hand reaches showdown after that bet, Q has essentially no share of the pot. The bet works through folds, not card strength. |
| Bluff-catch | You hold K on a J board and face a two-chip bet into six. | Calling needs 25% of the final eight-chip pot. The saved range gives the hand about 24.9% showdown equity, so this is a genuine boundary: folding is ahead by about 0.0065 chip in this approximate solution. The page must say “close,” not present the 74% call frequency as exact law. |
| Mix | You open the first round with Q. | The saved strategy checks about 46% and bets about 54%. Their measured values differ by about 0.0012 chip. The defensible lesson is that both choices are very close here; the exact percentages are approximate. |

The lab should teach one of these ideas at a time. It should first name the recommendation,
then show the chip difference, then let the learner open the range and outcome details.

### Expert product person

**Pass for a deliberately small first page.** The first screen should answer one question:
“Why can two different actions both make sense?” It should not open with 288 situations,
a solver settings panel, or the acronym CFR.

Required hierarchy:

1. A permanent label: **Toy poker · two players · fixed bets**.
2. A short rule card with the six-card deck and one public card.
3. One curated decision, starting with the queen opening mix.
4. Two action bars with percentages and the chip difference.
5. One plain sentence: “These choices are almost tied, so this strategy uses both.”
6. Optional details for opponent ranks, ways the hand can end, and method.
7. A reliability note: “A perfect response can gain at most about 0.0054 chip per hand
   against this saved strategy.”

Do not use a “GTO” badge. Do not call the higher-frequency action the only correct action.
Do not suggest these percentages transfer to a normal hold'em table.

### Expert software engineer

**Pass.** The teaching values are rebuilt from the saved strategy rather than copied into
handwritten examples. Tests check that:

- all 288 information sets have a matching teaching record;
- action frequencies and opponent-rank probabilities add to 100%;
- the five possible endings after an action add to 100%;
- a public and private card of the same rank correctly block that rank from the opponent;
- physical copies never appear in learner-facing rank data;
- choosing fold changes zero additional chips from that decision forward;
- impossible paths return `null` rather than invented values;
- the artifact matches the exact current game-tree fingerprint and regenerates byte for
  byte.

The main remaining software risk is presentation: a label can still misstate a correct
number. UI tests should assert meaning, not only text presence—for example, “minimum needed”
must use `call cost / final pot` only where calling ends the betting.

## What the first UI is allowed to claim

- “This saved strategy uses both actions.”
- “These actions are about X chip apart under the saved strategy.”
- “Given the cards and actions seen, the opponent's possible ranks are…”
- “After choosing this action and then following the saved strategy, the hand ends this
  way…”
- “A perfect response can improve by at most about 0.0054 chip per hand.”

## What it must not claim

- that the saved frequencies are the one exact equilibrium;
- that an action with a tiny measured edge is always correct;
- that Leduc advice applies directly to multiway no-limit hold'em;
- that showdown equity alone decides an early-round action;
- that the solver knows the opponent's hidden card;
- that an off-path situation has a reliable recommendation.

## Release decision

The mathematical result, rule audit, hidden-information boundary, stale-result check, and
teaching inputs pass. A separate solver-lab UI may now be mocked against these facts. The
first UI review must still verify mobile reading order, keyboard use, color contrast, and
plain-language accuracy before production.
