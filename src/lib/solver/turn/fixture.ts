import { createTurnGame, type TurnRequest } from "./game";

export const TURN_DEMO_REQUEST: TurnRequest = {
  id: "heads-up-turn-v1",
  board: ["Ks", "8s", "4d", "2c"],
  rangeText: ["AsQs:0.5 KdKh", "QsJs 9h9d:2"],
  committedPerPlayer: 50,
  stackBehind: [150, 150],
  betSizes: [50, 100],
};
export const turnDemoGame = createTurnGame(TURN_DEMO_REQUEST);
