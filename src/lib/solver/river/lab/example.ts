import artifactData from "../configurable-v3/artifacts/configurable-river-v3.json";
import { deserializeConfigurableRiverV3Strategy, type ConfigurableRiverV3Artifact } from "../configurable-v3/artifact";
import { configurableRiverV3DemoGame } from "../configurable-v3/fixture";
import { parseRiverLabInput, riverLabPreflight } from "./input";
import { EXAMPLE_INPUT, type RiverLabResult } from "./model";
import { createRiverLabContext, inspectRiverLabDecision, riverLabDecisionMenu } from "./teaching";

export function riverLabExample() {
  const artifact = artifactData as unknown as ConfigurableRiverV3Artifact;
  const context = createRiverLabContext(configurableRiverV3DemoGame,
    deserializeConfigurableRiverV3Strategy(artifact.strategy));
  // A real decision facing a price, with a useful mix of calls and folds to inspect.
  const initial = context.decisions.find(decision => !decision.offPath && decision.player === 1
    && decision.privateCards.join("") === "JhJd" && decision.history.join() === "bet-to-50")
    ?? context.decisions.find(decision => !decision.offPath && decision.history.length === 1)!;
  const request = { ...parseRiverLabInput(EXAMPLE_INPUT).request, id: configurableRiverV3DemoGame.id };
  const result: RiverLabResult = {
    source: "example", request, preflight: riverLabPreflight(EXAMPLE_INPUT).preflight,
    quality: { iteration: artifact.iterations, value: artifact.value, gains: artifact.gains,
      exploitability: artifact.exploitability },
    elapsedMs: null, decisions: riverLabDecisionMenu(context.decisions),
    initialDecision: inspectRiverLabDecision(context, initial.informationSet),
    provenance: { rulesHash: artifact.rulesFingerprint, payloadHash: artifact.payloadHash },
  };
  return { context, result };
}
