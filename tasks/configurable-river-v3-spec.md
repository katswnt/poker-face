# Configurable heads-up river solver v3 — locked specification

## Purpose

Version 3 finishes the current exact river experiment by allowing a richer but still finite betting
tree. It adds more opening sizes and one additional re-raise without pretending to model every
possible no-limit wager.

Versions 1 and 2, their artifacts, and their public entry points remain unchanged. Version 3 is a
new isolated library path and is not connected to the four-player trainer.

## Evidence used to choose the boundary

The factorized engine was profiled under Node `v24.10.0` on `arm64`. Timings are local observations,
not universal promises.

| Profile | Deals | Public states | Equivalent repeated states | CFR+ ms/iteration | Grade time | Grade workspace |
|---|---:|---:|---:|---:|---:|---:|
| Small | 750 | 21 | 15,751 | 0.53 | 2.67 ms | 506,568 bytes |
| More private deals | 5,052 | 21 | 106,093 | 3.40 | 6.89 ms | 3,401,192 bytes |
| Richer tree near old ceiling | 4,060 | 57 | 231,421 | 7.22 | 14.85 ms | 7,419,496 bytes |
| Exploratory CPU boundary | 10,240 | 87 | 890,881 | 28.03 | 64.40 ms | 28,540,956 bytes |

The exploratory case compiled in about 52 ms and used 259,479 bytes of structural typed arrays.
This shows that one million equivalent states is a practical local ceiling for a deliberate solve,
although hundreds or thousands of iterations can still take seconds or minutes. Runtime, rather
than stored game structure, is now the main constraint.

## Fixed game

- Heads-up only.
- River only; all five community cards are known.
- Explicit weighted ranges for both players.
- Exact blocker removal and exact showdown evaluation. No Monte Carlo sampling.
- Player 0 is out of position and acts first.
- Equal chips are already committed before the river betting round.
- Whole-chip pot, stack, bet, and raise amounts.
- A caller never pays more than the chips they have left.
- Unmatched chips are returned before the contestable pot is awarded.
- Utility is net chip change from the beginning of the hand. Chips committed before the current
  decision are not charged twice in action comparisons.

## Richer finite betting tree

The request supplies:

- one to five exact opening **bet-to** amounts;
- one to five exact **raise-to** amounts; and
- a raise limit of zero, one, or two raises after the opening bet.

The accepted v3 demonstration uses two raises after an opening bet. In ordinary poker language,
that permits a bet, a raise, and one re-raise before the remaining player must call or fold.

An amount in the menu is only legal when:

- it is above the amount already committed on this river;
- it does not exceed the acting player's remaining river stack;
- a raise is at least as large as the previous full raise; or it is the acting player's short
  all-in; and
- the opponent still has chips that could answer the wager.

A short all-in remains legal even when it is smaller than a full raise. It does not create an
opportunity to raise into a player who is already all-in. Checks, folds, calls, and the end of the
round follow the existing audited river rules.

This is a discrete abstraction. If 60 chips is not in the request, the solver does not silently
pretend a 60-chip wager is available.

## Public limits

Version 3 fails before solving if it exceeds any of these limits:

- 128 expanded range combinations per player;
- 15,000 compatible private-hand pairs;
- 1,000,000 states in the equivalent repeated tree;
- five opening bet sizes;
- five raise-to sizes; or
- two raises after the opening bet.

These limits describe admission, not speed. A solve near the ceiling is expected to be deliberate,
not instant or suitable for every browser interaction.

## Architecture

1. A readable v3 game owns action legality, state transitions, and chip settlement.
2. The factorized compiler accepts a narrow shared river-game contract. It stores the public tree
   once and remains compatible with unchanged v2 games.
3. Ordinary CFR remains the exact differential oracle on bounded fixtures.
4. Alternating CFR+ remains a separately named approximation with delayed linear averaging.
5. The independent factorized scorekeeper evaluates the saved strategy and chooses one response
   per information set after combining all hidden opponent hands.
6. An independent money oracle replays every terminal in the locked v3 fixture.

No v3 result replaces a committed v1 or v2 artifact in this milestone.

## Required outputs

For every solve, return:

- the normalized scenario and exact preflight counts;
- current and saved-average action frequencies;
- cumulative regrets and explicit traversal counts;
- expected chip value for both players;
- both legal information-set best responses;
- each player's gain from deviating;
- Nash gap; and
- exploitability, defined as half the Nash gap because this game is heads-up and zero-sum.

Callers may also request the existing structured teaching facts: action EVs, value added from the
current decision, distance from the best action, immediate responses, fold probability, showdown
outcomes, equity, and the blocker-aware opponent range. Generating facts for every decision still
walks the repeated readable tree, so v3 permits this bulk export only below 100,000 equivalent
states. Larger solves return the strategy and grade; a later product layer should request individual
decision explanations on demand instead of allocating every explanation at once.

Never describe the approximate saved strategy as exact GTO.

## Acceptance gates

- A v3 game configured with one raise produces the same deals, public actions, information sets,
  terminal utilities, CFR output, and grade as the equivalent v2 game.
- Every terminal in the locked two-raise fixture agrees with an independently written money replay
  and slow showdown evaluator.
- Full raises, short all-ins, raise caps, calls, folds, returned chips, and “cannot raise into an
  all-in player” cases have direct tests.
- No information-set key contains the opponent's private cards.
- Factorized ordinary CFR matches readable ordinary CFR within `1e-10` on a bounded two-raise game.
- Factorized values and best responses match the readable scorekeeper within `1e-10` across fixed
  and generated mixed strategies.
- A deliberately cheating hidden-state response is strictly better on a regression fixture; the
  real scorekeeper does not receive that advantage.
- CFR+ produces finite non-negative regrets, deterministic output, and an independently measured
  exploitability below `0.25` chip on the locked fixture.
- The one-million-state, 15,000-deal, five-size, and two-raise boundaries reject excess work.
- All older artifacts reproduce byte for byte.
- Full tests, type checking, lint, the v3 audit, and the production build pass.

## Stop conditions

Do not ship or describe v3 as successful if:

- v2 reduction changes any accepted result;
- the public tree depends on hidden cards;
- a short all-in incorrectly reopens raising;
- an unmatched wager is counted as winnings;
- factorized and readable solvers disagree beyond the tolerance;
- the scorekeeper chooses separately by hidden opponent hand;
- resource limits are checked only after building the oversized tree; or
- the evidence would require calling an approximate frequency exact GTO.

## Allowed portfolio claim after acceptance

> Poker Face's third river experiment solves exact blocker-compatible heads-up ranges over a
> user-declared finite tree with up to five opening sizes, five raise targets, and two raises. It
> reuses a factorized public tree, preserves earlier solver results, and is differentially checked
> against readable rules and an independent information-set scorekeeper.

Do not shorten this to “complete no-limit hold'em solver.”

## Changelog

**2026-09-24 — uncallable overbets collapse (rules version unchanged).** Any bet or raise
target above the opponent's remaining stack is replaced by a single bet-to-their-stack
action, since every such target has the same payoff once the excess is returned. This
removes payoff-identical duplicate actions. v3 already refused raises against an all-in
player. The committed v3 artifact reproduces byte for byte, so the v3 rules version is not
bumped; affected scenarios build smaller trees. The river exchange benchmark suite, whose
trees did change, moved to suite version 2 (see the
[exchange spec](river-strategy-exchange-spec.md#changelog)).
