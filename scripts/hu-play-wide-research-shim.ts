// Bundled ONLY by profile-hu-play-wide-browser's private loopback harness. Production
// imports are untouched. The complete W2 reservation, export caps and memory watchdog stay.
import { createWideResearchParser, WIDE_RESEARCH_LIMITS } from "./hu-play-wide-measurement";
export { admitBrowserSolve, parseLiveEstimate } from "../src/lib/solver/bridge/live/admission";
declare const __P1_STUDY_ALLOWED_JSON__: readonly string[];
export const parseLiveSpot = createWideResearchParser(__P1_STUDY_ALLOWED_JSON__);
export const LIVE_LIMITS = WIDE_RESEARCH_LIMITS;
