import { FLOP_WIDE_REQUEST } from "../flop/fixtures";
import type { FlopRequest } from "../flop/rules";

export interface FlopPreset {
  request: FlopRequest;
  title: string;
  texture: "Dry" | "Two-tone" | "Paired" | "Connected" | "Monotone";
  description: string;
  provenance: string;
}
const teaching = "Handcrafted teaching ranges, not solved or recommended preflop ranges. Player 0 acts first; player 1 acts second on every street.";
export const FLOP_PRESETS: readonly FlopPreset[] = [
  { request: { id: "flop-two-tone", board: ["Ks", "8s", "4d"], rangeText: ["AsQs:0.5 KdKh", "QsJs 9h9d:2"],
    committedPerPlayer: 50, stackBehind: [75, 75], betSizes: [25, 25, 25] }, title: "Draws on a king-high flop", texture: "Two-tone",
    description: "A flush draw and a strong made hand face a draw and a pocket pair.", provenance: teaching },
  { request: { id: "flop-dry", board: ["As", "7d", "2c"], rangeText: ["AhAd AcKd QsJs:0.5", "7c7h KsQs 5h4h"],
    committedPerPlayer: 50, stackBehind: [100, 100], betSizes: [25, 50, 100] }, title: "A dry ace-high flop", texture: "Dry",
    description: "Strong made hands and weaker hands see how later cards change their options.", provenance: teaching },
  { request: { id: "flop-paired", board: ["Qh", "Qc", "6d"], rangeText: ["AsAd KhKs 6c6h:0.5", "QdJh AdKd 8s7s"],
    committedPerPlayer: 50, stackBehind: [30, 75], betSizes: [20, 25, 25] }, title: "Paired board, unequal stacks", texture: "Paired",
    description: "One player starts with only 30 chips behind; a short call can return excess chips.", provenance: teaching },
  { request: { id: "flop-connected", board: ["Jh", "Th", "8c"], rangeText: ["Qs9s AhKh JdJs", "9d7d QcKd Ts9c:0.5"],
    committedPerPlayer: 50, stackBehind: [150, 150], betSizes: [50, 50, 50] }, title: "A connected, draw-heavy flop", texture: "Connected",
    description: "Straight and flush possibilities change across both remaining cards.", provenance: teaching },
  { request: { id: "flop-monotone", board: ["9h", "6h", "2h"], rangeText: ["AhKd KhQh 9c9d", "JhTh 8h7c 2c2d:0.5"],
    committedPerPlayer: 50, stackBehind: [50, 90], betSizes: [25, 25, 25] }, title: "Three hearts on the flop", texture: "Monotone",
    description: "Made flushes, one-heart draws and sets meet with unequal remaining stacks.", provenance: teaching },
  { request: FLOP_WIDE_REQUEST, title: "64 hands each: wider range example", texture: "Dry",
    description: "The accepted 3,755-deal capacity example, with all three streets solved together.",
    provenance: "Synthetic deterministic weighted ranges chosen to test capacity, not realistic or recommended preflop play. Player 0 acts first; player 1 acts second on every street." },
];
export const FLOP_LIBRARY_RUN = Object.freeze({ iterations: 100000, algorithm: "cfr-plus" as const, averagingDelay: 20 });
export const FLOP_LIBRARY_VERSION = 1;
