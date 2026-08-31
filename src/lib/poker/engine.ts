// One betting round — shared by preflop and postflop.
//
// This used to exist twice: an inline loop for preflop (with blinds pre-posted and a
// raise counter) and a near-identical `runBettingRound` for postflop. Two copies of the
// same chip-accounting logic is exactly how subtle money bugs creep in, so it's unified
// here. Decision-making is INJECTED (`decide`) rather than imported, which keeps this
// module pure and lets the tests drive it with scripted actions.
import { BB } from "./cards";
import type { AppliedAction, CallQuote, CardObj, Decision, LegalActions, PlayerInfo, Stage } from "./types";

export interface DecideArgs {
  pi: number; pot: number; currentBet: number; playerBet: number;
  stack: number; numActive: number; raiseCount: number;
  minRaiseTo: number; canRaise: boolean; legalActions: LegalActions; callQuote: CallQuote;
}

export interface LegalActionState {
  currentBet: number;
  playerBet: number;
  stack: number;
  raiseRightsOpen: boolean;
  opponentCanRespond: boolean;
}

export function legalActionsForState({
  currentBet,
  playerBet,
  stack,
  raiseRightsOpen,
  opponentCanRespond,
}: LegalActionState): LegalActions {
  const toCall = Math.max(0, currentBet - playerBet);
  const maxCommit = stack + playerBet;
  const canIncrease = raiseRightsOpen && opponentCanRespond && maxCommit > currentBet;
  return {
    fold: toCall > 0,
    check: toCall === 0,
    call: toCall > 0,
    bet: currentBet === 0 && canIncrease,
    raise: currentBet > 0 && canIncrease,
  };
}

export interface BettingParams {
  order: number[];              // seats to act, in order
  hands: CardObj[][];           // hole cards per seat (for stage snapshots)
  board: CardObj[];
  street: string;
  players: PlayerInfo[];        // for the safety-cap diagnostic only
  pot: number;
  contributions: number[];      // total chips each seat has put into this hand
  folded: boolean[];
  stacks: number[];
  bets: number[];               // chips already in front per seat this street (blinds preflop)
  currentBet: number;           // highest bet to match (BB preflop, 0 postflop)
  raiseCount: number;           // raises so far this street (preflop feeds numRaisesAhead)
  countRaises: boolean;         // whether a new bet/raise increments raiseCount
  minimumBet?: number;          // smallest full opening bet (defaults to one BB)
  lastFullRaiseSize?: number;   // previous full raise increment (defaults to minimumBet)
  heroIdx: number | null;
  heroChoices: Decision[];      // hero's recorded choices, consumed by index
  heroActionStart: number;      // index into heroChoices where this round begins
  decide: (a: DecideArgs) => Decision;
}

export interface BettingResult {
  stages: Stage[]; pot: number; folded: boolean[]; stacks: number[];
  bets: number[]; currentBet: number; heroActionsConsumed: number; raiseCount: number;
  lastFullRaiseSize: number; contributions: number[];
}

export interface BlindPostingResult {
  stacks: number[];
  bets: number[];
  pot: number;
  currentBet: number;
  smallBlindPosted: number;
  bigBlindPosted: number;
  contributions: number[];
}

export interface CallQuoteState {
  playerIdx: number;
  currentBet: number;
  playerBet: number;
  stack: number;
  contributions: number[];
  folded: boolean[];
}

function contestableLayers(
  playerIdx: number,
  contributions: number[],
  folded: boolean[],
): Pick<CallQuote, "contestablePot" | "layers"> {
  const callerCap = contributions[playerIdx] ?? 0;
  const capped = contributions.map(amount => Math.min(Math.max(0, amount), callerCap));
  const levels = [...new Set(capped.filter(amount => amount > 0))].sort((a, b) => a - b);
  const layers: CallQuote["layers"] = [];
  let previous = 0;
  for (const level of levels) {
    const contributors = contributions.map((amount, seat) => amount >= level ? seat : -1).filter(seat => seat >= 0);
    const amount = (level - previous) * contributors.length;
    previous = level;
    // Chips above every opponent's contribution are uncalled and come back to the
    // player. They are not part of a pot and must not inflate the displayed share.
    if (amount <= 0 || (contributors.length === 1 && contributors[0] === playerIdx)) continue;
    layers.push({
      amount,
      contributors,
      eligibleOpponents: contributors.filter(seat => seat !== playerIdx && !folded[seat]),
    });
  }
  return {
    contestablePot: layers.reduce((total, layer) => total + layer.amount, 0),
    layers,
  };
}

export function quoteCall({
  playerIdx,
  currentBet,
  playerBet,
  stack,
  contributions,
  folded,
}: CallQuoteState): CallQuote {
  const callCost = Math.min(Math.max(0, currentBet - playerBet), Math.max(0, stack));
  const after = [...contributions];
  after[playerIdx] = (after[playerIdx] ?? 0) + callCost;
  const { contestablePot, layers } = contestableLayers(playerIdx, after, folded);
  return {
    callCost,
    allIn: callCost > 0 && callCost === stack,
    contestablePot,
    requiredEquity: callCost === 0 || contestablePot === 0 ? 0 : callCost / contestablePot,
    layers,
  };
}

export function quoteCurrentPots(
  playerIdx: number,
  contributions: number[],
  folded: boolean[],
): CallQuote {
  const { contestablePot, layers } = contestableLayers(playerIdx, contributions, folded);
  return {
    callCost: 0,
    allIn: false,
    contestablePot,
    requiredEquity: 0,
    layers,
  };
}

export function postBlinds(
  startingStacks: number[],
  smallBlindSeat: number,
  bigBlindSeat: number,
  smallBlind: number,
  bigBlind: number,
): BlindPostingResult {
  const stacks = [...startingStacks];
  const bets = new Array(startingStacks.length).fill(0);
  const smallBlindPosted = Math.min(Math.max(stacks[smallBlindSeat] ?? 0, 0), smallBlind);
  stacks[smallBlindSeat] -= smallBlindPosted;
  bets[smallBlindSeat] = smallBlindPosted;
  const bigBlindPosted = Math.min(Math.max(stacks[bigBlindSeat] ?? 0, 0), bigBlind);
  stacks[bigBlindSeat] -= bigBlindPosted;
  bets[bigBlindSeat] = bigBlindPosted;
  return {
    stacks,
    bets,
    pot: smallBlindPosted + bigBlindPosted,
    currentBet: bigBlind,
    smallBlindPosted,
    bigBlindPosted,
    contributions: [...bets],
  };
}

export function runBettingRound(params: BettingParams): BettingResult {
  const { order, hands, board, street, players, heroIdx, heroChoices, heroActionStart, decide, countRaises } = params;
  const stages: Stage[] = [];
  const f = [...params.folded];
  const s = [...params.stacks];
  const bets = [...params.bets];
  const contributions = [...params.contributions];
  let p = params.pot;
  let currentBet = params.currentBet;
  let raiseCount = params.raiseCount;
  const minimumBet = params.minimumBet ?? BB;
  let lastFullRaiseSize = params.lastFullRaiseSize ?? minimumBet;
  // The wager level each seat faced when it last acted. Comparing this baseline with the
  // current price correctly handles multiple short all-ins that cumulatively make a full
  // raise; a single "acted since full raise" flag cannot represent that rule.
  const lastActedAtBet: Array<number | null> = new Array(s.length).fill(null);

  const needsAction = new Array(s.length).fill(false);
  const seatsWithChips = order.filter(i => !f[i] && s[i] > 0);
  if (seatsWithChips.length >= 2) {
    seatsWithChips.forEach(i => { needsAction[i] = true; });
  } else if (seatsWithChips.length === 1) {
    const onlySeat = seatsWithChips[0];
    // A sole live stack has no dry side pot to bet, but may still owe an outstanding
    // all-in wager from the current round.
    if (bets[onlySeat] < currentBet) needsAction[onlySeat] = true;
  }
  let safety = 0, orderIdx = 0;
  let heroCount = heroActionStart;

  while (needsAction.some(Boolean) && safety < 40) {
    if (safety === 39) console.error("[runBettingRound] safety cap hit — betting loop truncated", { street, seats: order.map(i => players[i]?.posShort), bets, currentBet });
    safety++;
    const pi = order[orderIdx % order.length];
    orderIdx++;
    if (!needsAction[pi] || f[pi]) { needsAction[pi] = false; continue; }
    if (s[pi] <= 0) { needsAction[pi] = false; continue; }   // already all-in
    if (f.filter(x => !x).length <= 1) break;                // everyone else folded

    const isHero = heroIdx !== null && pi === heroIdx;
    const lastActed = lastActedAtBet[pi];
    const raiseRightsOpen = lastActed === null || currentBet - lastActed >= lastFullRaiseSize;
    const opponentCanRespond = order.some(j => j !== pi && !f[j] && s[j] > 0);
    const legalActions = legalActionsForState({
      currentBet,
      playerBet: bets[pi],
      stack: s[pi],
      raiseRightsOpen,
      opponentCanRespond,
    });
    const canRaise = legalActions.bet || legalActions.raise;
    const minRaiseTo = currentBet < minimumBet ? minimumBet : currentBet + lastFullRaiseSize;
    const callQuote = quoteCall({ playerIdx: pi, currentBet, playerBet: bets[pi], stack: s[pi], contributions, folded: f });
    const aiDec = decide({ pi, pot: p, currentBet, playerBet: bets[pi], stack: s[pi], numActive: f.filter(x => !x).length, raiseCount, minRaiseTo, canRaise, legalActions, callQuote });
    const heroActionId = isHero ? heroCount : undefined;
    const requested = isHero && heroChoices[heroCount] ? heroChoices[heroCount] : aiDec;
    if (isHero) heroCount++;
    needsAction[pi] = false;

    const preBets = [...bets];
    const preCurrentBet = currentBet;
    const prePot = p;
    const preStacks = [...s];
    const preContributions = [...contributions];
    let actualAction: "fold" | "check" | "call" | "bet" | "raise" = "check";
    let fullRaise = false;

    const call = () => {
      const cost = callQuote.callCost;
      p += cost; s[pi] -= cost; bets[pi] += cost; contributions[pi] += cost;
      actualAction = cost > 0 ? "call" : "check";
    };

    if (requested.action === "fold" && legalActions.fold) {
      f[pi] = true;
      actualAction = "fold";
    } else if (requested.action === "call" || requested.action === "check") {
      call();
    } else if (requested.action === "bet" || requested.action === "raise") {
      const desired = Math.max(0, Math.round(requested.amount != null ? requested.amount : currentBet * 2));
      const maxCommit = s[pi] + bets[pi];
      const newBet = Math.min(desired, maxCommit);
      const isAllInTarget = newBet === maxCommit;
      const isOpeningBet = currentBet === 0;
      const isCompletingShortOpen = currentBet > 0 && currentBet < minimumBet && newBet >= minimumBet;
      const raiseSize = newBet - currentBet;
      const isFullRaise = isOpeningBet ? newBet >= minimumBet : isCompletingShortOpen || raiseSize >= lastFullRaiseSize;
      const aggressiveActionIsLegal = isOpeningBet ? legalActions.bet : legalActions.raise;
      const canApplyRaise = aggressiveActionIsLegal && newBet > currentBet && (isFullRaise || isAllInTarget);

      if (canApplyRaise) {
        const additional = newBet - bets[pi];
        p += additional; s[pi] -= additional; bets[pi] = newBet; contributions[pi] += additional; currentBet = newBet;
        actualAction = isOpeningBet ? "bet" : "raise";
        fullRaise = isFullRaise;
        if (isFullRaise) {
          lastFullRaiseSize = isOpeningBet || isCompletingShortOpen ? newBet : raiseSize;
        }
        order.forEach(j => {
          if (j !== pi && !f[j] && s[j] > 0 && bets[j] < currentBet) needsAction[j] = true;
        });
        if (countRaises) raiseCount++;
      } else {
        // Invalid sizing or closed raise rights: apply the legal passive action instead.
        call();
      }
    } else {
      call();
    }

    lastActedAtBet[pi] = bets[pi];

    const chipsAdded = preStacks[pi] - s[pi];
    const allIn = chipsAdded > 0 && s[pi] === 0;
    const decision = normalizeDecision(requested, actualAction, bets[pi], chipsAdded, allIn, players[pi]?.name ?? `Seat ${pi + 1}`);
    const appliedAction: AppliedAction = { requested, decision, chipsAdded, targetBet: bets[pi], allIn, fullRaise };
    stages.push({
      type: "action", street, playerIdx: pi, board: [...board], pot: prePot,
      bets: preBets, folded: [...f], decision, aiDecision: isHero ? aiDec : undefined,
      currentBet: preCurrentBet, stacks: preStacks, holeCards: hands[pi], heroActionId,
      minRaiseTo, canRaise, legalActions, appliedAction, contributions: preContributions, callQuote,
    });
  }

  return { stages, pot: p, folded: f, stacks: s, bets, currentBet, heroActionsConsumed: heroCount - heroActionStart, raiseCount, lastFullRaiseSize, contributions };
}

function normalizeDecision(
  requested: Decision,
  action: "fold" | "check" | "call" | "bet" | "raise",
  targetBet: number,
  chipsAdded: number,
  allIn: boolean,
  playerName: string,
): Decision {
  const aggressive = action === "bet" || action === "raise";
  const requestedAmount = requested.amount == null ? undefined : Math.round(requested.amount);
  const changed = requested.action !== action || (aggressive && requestedAmount !== targetBet) || allIn;
  if (!changed) return { ...requested, amount: aggressive ? targetBet : undefined };

  const amount = aggressive ? targetBet : undefined;
  const allInText = allIn ? " all-in" : "";
  const dialogue = action === "fold" ? `${playerName} folds.`
    : action === "check" ? `${playerName} checks.`
    : action === "call" ? `${playerName} calls ${chipsAdded}${allInText}.`
    : action === "bet" ? `${playerName} bets${allInText} to ${targetBet}.`
    : `${playerName} raises${allInText} to ${targetBet}.`;
  const reasoning = requested.action === action
    ? `${action.charAt(0).toUpperCase() + action.slice(1)}${allInText}${aggressive ? ` to ${targetBet}` : ""}.`
    : `Requested ${requested.action}; applied the legal ${action}${allInText}${action === "call" ? ` for ${chipsAdded}` : ""}.`;
  return { ...requested, action, amount, dialogue, reasoning };
}
