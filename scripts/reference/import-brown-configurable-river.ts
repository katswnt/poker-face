import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gradeStrategy } from "../../src/lib/solver/toy/best-response";
import {
  canonicalSolverJson,
  serializeBehavioralStrategy,
  type SerializedBehavioralStrategy,
} from "../../src/lib/solver/toy/artifact";
import {
  buildGameTreeIndex,
  validateStrategy,
  type BehavioralStrategy,
} from "../../src/lib/solver/toy/game";
import { parseRiverCombo, riverComboKey } from "../../src/lib/solver/river/cards";
import { configurableRiverV2DemoGame } from "../../src/lib/solver/river/configurable/fixture";
import type { ConfigurableRiverAction } from "../../src/lib/solver/river/configurable/game";

interface BrownProfileEntry {
  readonly actions: readonly string[];
  readonly strategy: readonly (readonly number[])[];
}

interface BrownPlayer {
  readonly hands: readonly string[];
  readonly profile: Readonly<Record<string, BrownProfileEntry>>;
}

interface BrownStrategyFile {
  readonly players: readonly [BrownPlayer, BrownPlayer];
}

interface BrownRunResult {
  readonly source: "noambrown/poker_solver";
  readonly commit: string;
  readonly license: "MIT";
  readonly game: "river_nlth";
  readonly algorithm: string;
  readonly iterations: number;
  readonly constantSumBestResponseValue: readonly [number, number];
  readonly exploitability: number;
  readonly strategySha256: string;
  readonly notes: readonly string[];
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index < 0 || !value) throw new Error(`Missing ${name}`);
  return value;
}

function brownHistory(history: string): string {
  const histories: Readonly<Record<string, string>> = {
    start: "root",
    check: "c",
    "bet-to-50": "b50",
    "bet-to-100": "b100",
    "check-bet-to-50": "c/b50",
    "check-bet-to-100": "c/b100",
    "bet-to-50-raise-to-100": "b50/r50",
    "check-bet-to-50-raise-to-100": "c/b50/r50",
  };
  const mapped = histories[history];
  if (!mapped) throw new Error(`No Brown history mapping for ${history}`);
  return mapped;
}

function brownAction(action: ConfigurableRiverAction): string {
  switch (action) {
    case "check":
    case "call": return "c";
    case "fold": return "f";
    case "bet-to-50": return "b50";
    case "bet-to-100": return "b100";
    case "raise-to-100": return "r50";
    default: throw new Error(`No Brown action mapping for ${action}`);
  }
}

function mapBrownStrategy(source: BrownStrategyFile): BehavioralStrategy<ConfigurableRiverAction> {
  const game = configurableRiverV2DemoGame;
  const index = buildGameTreeIndex(game);
  const rows = source.players.map(player => new Map(
    player.hands.map((hand, row) => [riverComboKey(parseRiverCombo(hand)), row]),
  ));
  const handRows: readonly [ReadonlyMap<string, number>, ReadonlyMap<string, number>] = [
    rows[0],
    rows[1],
  ];
  const strategy = new Map(index.informationSets.map(definition => {
    const match = definition.key.match(/:p([01]):hand=([^:]+):.*:history=(.+)$/);
    if (!match) throw new Error(`Could not parse configurable river information set ${definition.key}`);
    const player = Number(match[1]) as 0 | 1;
    const hand = match[2];
    const sourceKey = brownHistory(match[3]);
    const row = handRows[player].get(hand);
    const sourceEntry = source.players[player].profile[sourceKey];
    if (row === undefined || !sourceEntry) {
      throw new Error(`Brown strategy lacks player ${player}, hand ${hand}, history ${sourceKey}`);
    }
    const probabilities = definition.actions.map(action => {
      const token = brownAction(action);
      const actionIndex = sourceEntry.actions.indexOf(token);
      const probability = sourceEntry.strategy[row]?.[actionIndex];
      if (actionIndex < 0 || probability === undefined) {
        throw new Error(`Brown strategy lacks ${token} for player ${player} at ${sourceKey}`);
      }
      return probability;
    });
    return [definition.key, { actions: [...definition.actions], probabilities }] as const;
  }));
  validateStrategy(index, strategy);
  return strategy;
}

const strategyPath = argument("--strategy");
const resultPath = argument("--result");
const outputPath = process.argv.includes("--out")
  ? argument("--out")
  : join(process.cwd(), "test/fixtures/solver/configurable-river-brown-6a104428.json");
const strategyBytes = readFileSync(strategyPath);
const source = JSON.parse(strategyBytes.toString("utf8")) as BrownStrategyFile;
const run = JSON.parse(readFileSync(resultPath, "utf8")) as BrownRunResult;
const rawHash = createHash("sha256").update(strategyBytes).digest("hex");
if (rawHash !== run.strategySha256) throw new Error("Brown strategy bytes do not match its recorded hash");
if (run.commit !== "6a10442877ffc8fd28af93e16e279b9bbdd97b2a") {
  throw new Error(`Unexpected Brown commit ${run.commit}`);
}

const mapped = mapBrownStrategy(source);
const grade = gradeStrategy(configurableRiverV2DemoGame, mapped);
const externalBestResponseNet = run.constantSumBestResponseValue.map(value => value - 50) as [number, number];
const maximumBestResponseDifference = Math.max(
  Math.abs(externalBestResponseNet[0] - grade.bestResponses[0].value),
  Math.abs(externalBestResponseNet[1] - grade.bestResponses[1].value),
);
const exploitabilityDifference = Math.abs(run.exploitability - grade.exploitability);
if (maximumBestResponseDifference > 1e-8 || exploitabilityDifference > 1e-8) {
  throw new Error(
    `Mapped Brown grade disagrees with its referee: BR delta ${maximumBestResponseDifference}, ` +
    `exploitability delta ${exploitabilityDifference}`,
  );
}

const fixture = {
  schemaVersion: 2,
  source: run.source,
  repository: "https://github.com/noambrown/poker_solver",
  commit: run.commit,
  license: run.license,
  game: run.game,
  algorithm: run.algorithm,
  iterations: run.iterations,
  sourceStrategySha256: run.strategySha256,
  mappedStrategy: serializeBehavioralStrategy(mapped) as SerializedBehavioralStrategy<ConfigurableRiverAction>,
  value: grade.value,
  bestResponseValue: [grade.bestResponses[0].value, grade.bestResponses[1].value],
  gains: grade.gains,
  nashGap: grade.nashGap,
  exploitability: grade.exploitability,
  exploitabilityConvention: "half-nash-gap",
  exploitabilityUnits: "net-chips-per-hand",
  comparison: {
    exactSharedTree: true,
    maximumBestResponseDifference,
    exploitabilityDifference,
  },
  provenance: {
    adapter: "scripts/reference/run-brown-river.py + scripts/reference/import-brown-configurable-river.ts",
    config: "test/fixtures/solver/configurable-river-brown-config.json",
    command:
      "python3 scripts/reference/run-brown-river.py --solver-dir <PINNED_CHECKOUT> " +
      "--config test/fixtures/solver/configurable-river-brown-config.json " +
      "--strategy-out <TEMP_STRATEGY> --result-out <TEMP_RESULT> --iterations 25600",
    utilityTranslation: "subtract 50 prior chips from each player's constant-sum payoff",
    maxRaisesTranslation: "reference value 2 counts the opening bet plus one later raise",
    showdownPath: "reference naive exact enumeration",
    notes: run.notes,
  },
};

writeFileSync(outputPath, `${canonicalSolverJson(fixture, true)}\n`, "utf8");
console.log(`Wrote ${outputPath}`);
console.log(`Mapped player 0 value: ${grade.value[0].toFixed(9)} chips`);
console.log(`Mapped exploitability: ${grade.exploitability.toFixed(9)} chips`);
