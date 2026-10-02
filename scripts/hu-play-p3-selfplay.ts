import { advanceAsync, preparationRequest } from "../src/lib/hu-play/async-hand";
import type { HeadsUpHandState } from "../src/lib/hu-play/hand";
import { applyPlayHumanActionAsync, type PlayDecisionSource } from "../src/lib/hu-play/play-hand";
import { decisionDraw, fnv1a, sampleAction } from "../src/lib/hu-play/rng";
import type { PreparedPolicySource } from "../src/lib/hu-play/sources/policy";

/** Same seeded self-play draws as P1, through P3's actual prospective-action boundary. */
export async function playP3BotHand(initial: HeadsUpHandState, source: PreparedPolicySource & PlayDecisionSource,
  signal?: AbortSignal): Promise<HeadsUpHandState> {
  let outcome = await advanceAsync(initial, source, signal);
  for (let guard = 0; guard < 200; guard++) {
    if (outcome.status === "complete") return outcome.state;
    if (outcome.status !== "human") throw new Error(`P3 bot hand ${initial.config.handSeed} ${outcome.status}: ${outcome.reason}`);
    const state = outcome.state, policy = source.policy(preparationRequest(state));
    const draw = decisionDraw(fnv1a(`hu-probe-human|${state.config.handSeed}`), state.humanActions.length, state.public.path);
    const { action } = sampleAction(policy.distribution(state.deal.humanHand), draw);
    outcome = await applyPlayHumanActionAsync(state, action, source, signal);
  }
  throw new Error("P3 bot hand exceeded the action bound");
}
