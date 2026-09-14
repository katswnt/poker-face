import type { LeducSolveArtifact } from "./leduc-artifact";
import type {
  LeducActionFact,
  LeducDecisionFacts,
  LeducOpponentRankWeight,
} from "./leduc-explain";
import type { LeducAction, LeducRank } from "./leduc";

export type LeducLessonId = "mix" | "value" | "bluff" | "bluff-catch";

export interface LeducLessonPrice {
  readonly callCost: number;
  readonly finalPot: number;
  readonly minimumShare: number;
  readonly estimatedShare: number;
  readonly cushion: number;
}

export interface LeducLabLesson {
  readonly id: LeducLessonId;
  readonly label: string;
  readonly title: string;
  readonly question: string;
  readonly answer: string;
  readonly teachingPoints: readonly string[];
  readonly featuredAction: LeducAction;
  readonly situation: {
    readonly privateRank: LeducRank;
    readonly boardRank: LeducRank | null;
    readonly actor: string;
    readonly history: string;
    readonly pot: number;
    readonly toCall: number;
  };
  readonly opponentRanks: readonly LeducOpponentRankWeight[];
  readonly actions: readonly LeducActionFact[];
  readonly price: LeducLessonPrice | null;
}

export interface LeducLabData {
  readonly lessons: readonly LeducLabLesson[];
  readonly quality: {
    readonly maximumBestResponseGain: number;
    readonly nashGap: number;
    readonly exploitability: number;
    readonly units: "net-chips-per-hand";
  };
  readonly provenance: {
    readonly iterations: number;
    readonly schemaVersion: number;
    readonly rulesFingerprint: string;
    readonly payloadHash: string;
  };
}

type TeachingSource = Pick<
  LeducSolveArtifact,
  | "decisions"
  | "gains"
  | "nashGap"
  | "exploitability"
  | "exploitabilityUnits"
  | "iterations"
  | "schemaVersion"
  | "rulesFingerprint"
  | "payloadHash"
>;

const LESSON_INFORMATION_SETS: Readonly<Record<LeducLessonId, string>> = {
  mix: "leduc-v1:p0:card=Q:board=-:r0=start:r1=start",
  value: "leduc-v1:p0:card=K:board=K:r0=bet-call:r1=start",
  bluff: "leduc-v1:p0:card=Q:board=J:r0=check-bet-call:r1=start",
  "bluff-catch": "leduc-v1:p1:card=K:board=J:r0=check-bet-call:r1=bet",
};

function requireDecision(
  decisions: readonly LeducDecisionFacts[],
  lesson: LeducLessonId,
): LeducDecisionFacts {
  const informationSet = LESSON_INFORMATION_SETS[lesson];
  const decision = decisions.find(candidate => candidate.informationSet === informationSet);
  if (!decision) throw new Error(`Missing ${lesson} teaching decision ${informationSet}`);
  if (decision.offPath) throw new Error(`${lesson} teaching decision is off path`);
  return decision;
}

function requireAction(decision: LeducDecisionFacts, action: LeducAction): LeducActionFact {
  const fact = decision.actions.find(candidate => candidate.action === action);
  if (!fact || fact.expectedValue === null || fact.differenceFromBest === null) {
    throw new Error(`Missing reached ${action} action at ${decision.informationSet}`);
  }
  return fact;
}

function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function chips(value: number, digits = 4): string {
  return `${value.toFixed(digits)} chip${Math.abs(value) === 1 ? "" : "s"}`;
}

function situation(
  decision: LeducDecisionFacts,
  actor: string,
  history: string,
): LeducLabLesson["situation"] {
  return {
    privateRank: decision.privateRank,
    boardRank: decision.boardRank,
    actor,
    history,
    pot: decision.pot,
    toCall: decision.toCall,
  };
}

function buildMixLesson(decision: LeducDecisionFacts): LeducLabLesson {
  const check = requireAction(decision, "check");
  const bet = requireAction(decision, "bet");
  return {
    id: "mix",
    label: "Mixing",
    title: "The middle card can use two plans",
    question: "Why not always bet the queen?",
    answer: "Checking and betting finish almost even, so this strategy keeps both choices available.",
    teachingPoints: [
      "Before anyone acts, the opponent has a jack 40% of the time, a queen 20%, and a king 40%.",
      `Across every possible public card and later choice, the two plans are only ${chips(bet.differenceFromBest!)} apart.`,
      `The saved strategy checks ${percent(check.frequency)} of the time and bets ${percent(bet.frequency)}. These percentages are approximate, but the near-tie is the useful lesson.`,
    ],
    featuredAction: "check",
    situation: situation(decision, "You act first", "No betting yet"),
    opponentRanks: decision.opponentRanks,
    actions: decision.actions,
    price: null,
  };
}

function buildValueLesson(decision: LeducDecisionFacts): LeducLabLesson {
  const bet = requireAction(decision, "bet");
  const immediateFold = bet.immediateOpponentFoldProbability;
  if (immediateFold === null || bet.showdownEquity === null) {
    throw new Error("Value lesson is missing fold or showdown evidence");
  }
  return {
    id: "value",
    label: "Value bet",
    title: "A strong hand gives worse hands a price",
    question: "Why bet when you already have the best possible hand?",
    answer: "Because a worse hand may continue and add more chips to a pot you expect to win.",
    teachingPoints: [
      "Your king and the public king account for both kings in the deck. The opponent can only hold a jack or queen.",
      `After your bet, the opponent continues immediately ${percent(1 - immediateFold)} of the time.`,
      `Whenever this line reaches showdown, your pair wins ${percent(bet.showdownEquity)} of the pot on average. That is the evidence for calling this a value bet.`,
    ],
    featuredAction: "bet",
    situation: situation(decision, "You act first after the public card", "You bet; opponent called"),
    opponentRanks: decision.opponentRanks,
    actions: decision.actions,
    price: null,
  };
}

function buildBluffLesson(decision: LeducDecisionFacts): LeducLabLesson {
  const check = requireAction(decision, "check");
  const bet = requireAction(decision, "bet");
  const immediateFold = bet.immediateOpponentFoldProbability;
  if (immediateFold === null || bet.showdownEquity === null) {
    throw new Error("Bluff lesson is missing fold or showdown evidence");
  }
  return {
    id: "bluff",
    label: "Bluffing",
    title: "A weak hand can win by making better hands fold",
    question: "How can betting help when your cards are almost never best?",
    answer: "The bet can win before showdown. Its value comes from folds, not from card strength.",
    teachingPoints: [
      `The opponent folds immediately ${percent(immediateFold)} of the time after this bet.`,
      `When the hand does reach showdown after betting, your share is about ${percent(bet.showdownEquity, 2)}.`,
      `Betting leads checking by only ${chips(check.differenceFromBest!)} here. It is a close result in this saved strategy, not a universal rule.`,
    ],
    featuredAction: "bet",
    situation: situation(decision, "You act first after the public card", "You checked, then called a bet"),
    opponentRanks: decision.opponentRanks,
    actions: decision.actions,
    price: null,
  };
}

function buildBluffCatchLesson(decision: LeducDecisionFacts): LeducLabLesson {
  const call = requireAction(decision, "call");
  if (call.showdownEquity === null || decision.toCall <= 0) {
    throw new Error("Bluff-catch lesson is missing its terminal call price");
  }
  const finalPot = decision.pot + decision.toCall;
  const minimumShare = decision.toCall / finalPot;
  return {
    id: "bluff-catch",
    label: "Bluff-catching",
    title: "The price decides a close call",
    question: "Why consider calling when a paired jack still beats you?",
    answer: "Your king beats queen-high bluffs. The call is worthwhile only if those bluffs appear often enough for the price.",
    teachingPoints: [
      `Calling ${decision.toCall} chips makes a ${finalPot}-chip final pot, so you need ${percent(minimumShare, 1)} of it to break even.`,
      `The opponent's actions make a jack about ${percent(decision.opponentRanks[0].probability ?? 0, 1)} likely and a queen about ${percent(decision.opponentRanks[1].probability ?? 0, 1)} likely. Your king beats the queen and loses to the paired jack.`,
      `The estimate is ${percent(call.showdownEquity, 1)}—only ${percent(Math.abs(call.showdownEquity - minimumShare), 1)} away. Folding is ahead by ${chips(call.differenceFromBest!)} in this approximate solution, so the honest label is “close.”`,
    ],
    featuredAction: "call",
    situation: situation(decision, "You act second", "You checked; opponent bet"),
    opponentRanks: decision.opponentRanks,
    actions: decision.actions,
    price: {
      callCost: decision.toCall,
      finalPot,
      minimumShare,
      estimatedShare: call.showdownEquity,
      cushion: call.showdownEquity - minimumShare,
    },
  };
}

/** Turn audited numerical facts into the small, plain-language first lesson set. */
export function buildLeducLabData(source: TeachingSource): LeducLabData {
  if (source.exploitabilityUnits !== "net-chips-per-hand") {
    throw new Error(`Unexpected Leduc value units ${source.exploitabilityUnits}`);
  }
  const mix = requireDecision(source.decisions, "mix");
  const value = requireDecision(source.decisions, "value");
  const bluff = requireDecision(source.decisions, "bluff");
  const bluffCatch = requireDecision(source.decisions, "bluff-catch");

  return {
    lessons: [
      buildMixLesson(mix),
      buildValueLesson(value),
      buildBluffLesson(bluff),
      buildBluffCatchLesson(bluffCatch),
    ],
    quality: {
      maximumBestResponseGain: Math.max(...source.gains),
      nashGap: source.nashGap,
      exploitability: source.exploitability,
      units: source.exploitabilityUnits,
    },
    provenance: {
      iterations: source.iterations,
      schemaVersion: source.schemaVersion,
      rulesFingerprint: source.rulesFingerprint,
      payloadHash: source.payloadHash,
    },
  };
}
