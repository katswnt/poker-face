// Shared drivers for the heads-up play tests (not a test file itself).
import type { BridgeAction, BridgeBoard, BridgeRange } from "../src/lib/solver/bridge/contract";
import { LEAN_SRP_TREE, SRP_EFFECTIVE_STACK, SRP_STARTING_POT, leanSrpSpot } from "../src/lib/solver/bridge/fixtures";
import { advance, applyHumanAction, handLog, startHand, type HeadsUpHandState, type HuRanges } from "../src/lib/hu-play/hand";
import { sizedActionBounds } from "../src/lib/hu-play/public-state";
import { rangeFromBridge } from "../src/lib/hu-play/reach";
import { dealFromSeed } from "../src/lib/hu-play/rng";
import { createStubSource, type SpotCapture } from "../src/lib/hu-play/stub-source";
import type { HeadsUpPublicState, HuHandConfig, HuHandLogV1, PrivateDeal } from "../src/lib/hu-play/types";

export const TEST_FLOPS: readonly BridgeBoard["flop"][] = [["Ks", "7h", "2d"], ["Ah", "Td", "9d"], ["6c", "6h", "3s"]];
const rangeCache = new Map<string, readonly [BridgeRange, BridgeRange]>();

export function flopRanges(flop: BridgeBoard["flop"]): readonly [BridgeRange, BridgeRange] {
  const key = flop.join("");
  if (!rangeCache.has(key)) rangeCache.set(key, leanSrpSpot(`hu-test-${key.toLowerCase()}`, flop).ranges);
  return rangeCache.get(key)!;
}

export function initialRanges(flop: BridgeBoard["flop"], aiSeat: 0 | 1): HuRanges {
  const ranges = flopRanges(flop);
  return { ai: rangeFromBridge(ranges[aiSeat]), human: rangeFromBridge(ranges[1 - aiSeat]) };
}

export function testConfig(handSeed: number, aiSeat: 0 | 1, flopIndex: number): HuHandConfig {
  return { handSeed, aiSeat, startingPot: SRP_STARTING_POT, startingStack: SRP_EFFECTIVE_STACK, minimumBet: 100,
    flop: TEST_FLOPS[flopIndex % TEST_FLOPS.length] };
}

/** A legal action from two uniform numbers; sizes skew small so hands reach later streets. */
export function actionFromChoice(state: HeadsUpPublicState, r1: number, r2: number): BridgeAction {
  const actor = state.toAct!;
  const facing = Math.max(...state.streetPut) > state.streetPut[actor];
  const bounds = sizedActionBounds(state);
  const options: (BridgeAction | "sized")[] = facing ? [{ type: "fold" }, { type: "call" }, { type: "call" }] : [{ type: "check" }, { type: "check" }];
  if (bounds) options.push("sized");
  const pick = options[Math.min(options.length - 1, Math.floor(r1 * options.length))];
  if (pick !== "sized") return pick;
  const to = bounds!.min + Math.floor(r2 ** 3 * (bounds!.max - bounds!.min + 1));
  return { type: bounds!.type, to: Math.min(bounds!.max, to) };
}

export interface PlayedHand {
  readonly state: HeadsUpHandState;
  readonly log: HuHandLogV1;
  readonly spots: SpotCapture[];
  readonly requests: string[];
  /** handLog snapshots each time the human was to act (hand not over yet). */
  readonly midHandLogs: HuHandLogV1[];
}

export function playHand(config: HuHandConfig, choices: readonly (readonly [number, number])[], deal?: PrivateDeal,
  scriptedHuman?: readonly BridgeAction[]): PlayedHand {
  const spots: SpotCapture[] = [], requests: string[] = [], midHandLogs: HuHandLogV1[] = [];
  const source = createStubSource({
    tree: LEAN_SRP_TREE, onSpot: capture => spots.push(capture),
    onRequest: request => requests.push(JSON.stringify(request)),
  });
  const ranges = initialRanges(config.flop, config.aiSeat);
  const actualDeal = deal ?? dealFromSeed(config.handSeed, config.flop, flopRanges(config.flop), config.aiSeat);
  let state = advance(startHand(config, actualDeal, ranges), source);
  let k = 0;
  while (!state.result) {
    midHandLogs.push(handLog(state));
    const action = scriptedHuman ? scriptedHuman[k] : (() => {
      const [r1, r2] = choices.length ? choices[k % choices.length] : [0.9, 0];
      return actionFromChoice(state.public, r1, r2);
    })();
    if (!action) throw new Error("scripted human actions ran out");
    state = applyHumanAction(state, action, source);
    k += 1;
  }
  return { state, log: handLog(state), spots, requests, midHandLogs };
}
