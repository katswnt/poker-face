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
}

export interface Decision {
  action: string; amount?: number; equity?: number; dialogue: string; reasoning: string;
  thoughts: string[]; math: string[];
}

export interface PlayerInfo { name: string; pos: string; posShort: string; }

export type TableStyle = "gto" | "loose" | "wild";

// One entry in the step-through feed. Plain data (no React) so the betting engine and its
// tests can produce and inspect Stages directly.
export interface Stage {
  type: string; street?: string; title?: string; board: CardObj[]; pot: number; folded: boolean[];
  description?: string; note?: string; playerIdx?: number; bets?: number[]; decision?: Decision;
  aiDecision?: Decision; // AI's recommendation — stored on hero stages for comparison
  currentBet?: number; results?: Array<{ idx: number; folded: boolean; hand: HandResult | null }>; winner?: number; foldWin?: boolean;
  stacks?: number[]; payouts?: number[]; chop?: boolean;
  rankedResults?: Array<{ idx: number; folded: boolean; hand: HandResult | null }>;
  holeCards?: CardObj[];
}
