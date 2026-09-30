import type { ExtensiveFormGame, SolverPlayer } from "../src/lib/solver/toy/game";
import { buildGameTreeIndex, uniformStrategy } from "../src/lib/solver/toy/game";

export type CoinState = { phase: "deal" | "sell-or-play" | "guess" | "end"; coin?: string; payoff?: number };
export function coinFixture(ai: SolverPlayer = 0, tailPlay = .5) {
  const opponent = (1 - ai) as SolverPlayer;
  const game: ExtensiveFormGame<CoinState, string, string> = {
    id: `resolving-coin-${ai}`, initialState: () => ({ phase: "deal" }),
    node(s) {
      if (s.phase === "deal") return { kind: "chance", outcomes: ["H", "T"].map(outcome => ({ outcome, probability: .5 })) };
      if (s.phase === "end") return { kind: "terminal", utility: ai === 0 ? [-s.payoff!, s.payoff!] : [s.payoff!, -s.payoff!] };
      return { kind: "player", player: s.phase === "guess" ? ai : opponent,
        actions: s.phase === "guess" ? ["H", "T", "forfeit"] : ["sell", "play"] };
    },
    nextChance: (_, coin) => ({ phase: "sell-or-play", coin }),
    nextAction(s, a) {
      if (s.phase === "sell-or-play") return a === "play" ? { ...s, phase: "guess" }
        : { ...s, phase: "end", payoff: s.coin === "H" ? .5 : -.5 };
      return { ...s, phase: "end", payoff: a === s.coin ? -1 : 1 };
    },
    informationSet: s => s.phase === "guess" ? "ai-guess" : `opponent-${s.coin}`,
  };
  const blueprint = new Map(uniformStrategy(buildGameTreeIndex(game)));
  blueprint.set("ai-guess", { actions: ["H", "T", "forfeit"], probabilities: [.5, .25, .25] });
  blueprint.set("opponent-H", { actions: ["sell", "play"], probabilities: [.25, .75] });
  blueprint.set("opponent-T", { actions: ["sell", "play"], probabilities: [1 - tailPlay, tailPlay] });
  return { game, blueprint, ai, cut: (s: CoinState) => s.phase === "guess", opponentKey: (s: CoinState) => s.coin! };
}

/** Three compatible private deals; the missing B/X pair models card removal. */
export function correlatedFixture(enterA = .25) {
  type State = { phase: "deal" | "enter" | "model" | "guess" | "end"; deal?: number; payoff?: number };
  const pairs = [["A", "X"], ["A", "Y"], ["B", "Y"]] as const;
  const game: ExtensiveFormGame<State, string, number> = {
    id: "correlated-referee", initialState: () => ({ phase: "deal" }),
    node(s) {
      if (s.phase === "deal") return { kind: "chance", outcomes: [.2, .3, .5].map((probability, outcome) => ({ outcome, probability })) };
      if (s.phase === "end") return { kind: "terminal", utility: [-s.payoff!, s.payoff!] };
      return { kind: "player", player: s.phase === "model" ? 1 : 0,
        actions: s.phase === "guess" ? ["L", "R"] : ["stop", "go"] };
    },
    nextChance: (_, deal) => ({ phase: "enter", deal }),
    nextAction(s, a) {
      if (a === "stop") return { ...s, phase: "end", payoff: 0 };
      if (s.phase === "enter") return { ...s, phase: "model" };
      if (s.phase === "model") return { ...s, phase: "guess" };
      return { ...s, phase: "end", payoff: (a === "L" ? 1 : -1) * (pairs[s.deal!][1] === "X" ? 1 : -1) };
    },
    informationSet: s => `${s.phase}/${pairs[s.deal!][s.phase === "model" ? 1 : 0]}`,
  };
  const blueprint = new Map(uniformStrategy(buildGameTreeIndex(game)));
  blueprint.set("enter/A", { actions: ["stop", "go"], probabilities: [1 - enterA, enterA] });
  blueprint.set("enter/B", { actions: ["stop", "go"], probabilities: [.2, .8] });
  blueprint.set("model/X", { actions: ["stop", "go"], probabilities: [1, 0] });
  blueprint.set("model/Y", { actions: ["stop", "go"], probabilities: [.9, .1] });
  return { game, blueprint, ai: 0 as const, cut: (s: State) => s.phase === "guess", opponentKey: (s: State) => pairs[s.deal!][1] };
}
