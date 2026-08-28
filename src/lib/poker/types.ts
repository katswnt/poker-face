// Shared poker domain types. Kept UI-free so the logic modules and tests can import
// them without pulling in React.

export interface CardObj { rank: string; suit: string; }

export interface HandResult { rank: number; name: string; kickers: number[]; cards?: CardObj[]; }

export interface Draw {
  type: string; suit?: string; outs: number; holeCards?: CardObj[]; highCard?: number;
  isNut?: boolean; dirty?: boolean; desc: string; drawType?: string; completionRanks?: number[];
}

export interface HoldingResult {
  hand: HandResult; draws: Draw[]; pairSource: string | null; realStrength: string; details: string;
}

export interface BoardAnalysis {
  vals: number[]; suits: string[]; pairs: number[]; trips: number[]; isMonotone: boolean;
  twoTone: boolean; flushSuit: string | null; flushCount: number; isRainbow: boolean;
  connected: boolean; straightDanger: boolean; highCard: number; lowCard: number; maxRun: number;
  cardsToCome: number; madeFlushPossible: boolean; flushDrawPossible: boolean;
}

export interface Decision {
  action: string; amount?: number; equity?: number; dialogue: string; reasoning: string;
  thoughts: string[]; math: string[];
}

export interface CallQuoteLayer {
  amount: number;
  contributors: number[];
  eligibleOpponents: number[];
}

// The engine's single source of truth for the price of continuing. `contestablePot`
// includes the caller's chips after the call and excludes any unmatched excess the
// caller cannot win.
export interface CallQuote {
  callCost: number;
  allIn: boolean;
  contestablePot: number;
  requiredEquity: number;
  layers: CallQuoteLayer[];
}

export interface AppliedAction {
  requested: Decision;
  decision: Decision;
  chipsAdded: number;
  targetBet: number;
  allIn: boolean;
  fullRaise: boolean;
}

export interface LegalActions {
  fold: boolean;
  check: boolean;
  call: boolean;
  bet: boolean;
  raise: boolean;
}

export interface RankedResult { idx: number; folded: boolean; hand: HandResult | null; }
export interface PotAward { idx: number; amount: number; }
export interface PotLayer {
  amount: number;
  contributors: number[];
  eligible: number[];
  winners: number[];
  awards: PotAward[];
}

export interface PlayerInfo { name: string; pos: string; posShort: string; }

export type TableStyle = "gto" | "loose" | "wild";

// One entry in the step-through feed. Plain data (no React) so the betting engine and its
// tests can produce and inspect Stages directly.
export interface Stage {
  type: string; street?: string; title?: string; board: CardObj[]; pot: number; folded: boolean[];
  description?: string; note?: string; playerIdx?: number; bets?: number[]; decision?: Decision;
  aiDecision?: Decision; // Trainer's recommendation — stored on hero stages for comparison
  currentBet?: number; results?: Array<{ idx: number; folded: boolean; hand: HandResult | null }>; winner?: number; foldWin?: boolean;
  stacks?: number[]; payouts?: number[]; chop?: boolean;
  rankedResults?: RankedResult[]; pots?: PotLayer[];
  holeCards?: CardObj[];
  heroActionId?: number; minRaiseTo?: number; canRaise?: boolean;
  appliedAction?: AppliedAction; legalActions?: LegalActions;
  contributions?: number[]; callQuote?: CallQuote;
}
