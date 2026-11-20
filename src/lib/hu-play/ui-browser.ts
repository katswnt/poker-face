/** W2-only production factory. No private teaching input crosses this module. */
import type { WasmEnvironment } from "../solver/bridge/wasm-admission";
import { BrowserPublicSolver } from "./sources/browser";
import { loadPlayHand, type PlayHandFactory } from "./ui-controller";

export function browserPlayFactory(assetBase: string, environment: WasmEnvironment): PlayHandFactory {
  return async (seed, humanSeat, signal, progress) => {
    const runners = new Set<BrowserPublicSolver>();
    const dispose = () => { for (const runner of runners) runner.dispose(); runners.clear(); };
    try {
      const bundle = await loadPlayHand(seed, humanSeat, async (spot, abort) => {
        const profile = spot.tree.mode === "turn-subgame-v1" ? "play-turn-v1"
          : spot.tree.mode === "river-subgame-v1" ? "play-river-v1" : "play-v1";
        const street = spot.board.river ? "river" : "turn";
        const runner = new BrowserPublicSolver({ assetBase, environment, profile, decisionValues: true, onEvent(event) {
          if (event.type === "progress") progress({ stage: event.stage, street, pot: spot.startingPot,
            iterations: event.status?.iterations ?? null, measuredAtIteration: event.status?.measuredAtIteration ?? null,
            exploitability: event.status?.exploitability ?? null });
        } });
        runners.add(runner);
        try { return await runner.solve(spot, abort); }
        finally { runner.dispose(); runners.delete(runner); }
      }, signal);
      return { ...bundle, dispose };
    } catch (error) { dispose(); throw error; }
  };
}
