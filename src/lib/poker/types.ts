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
