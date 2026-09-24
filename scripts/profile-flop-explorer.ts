import { FLOP_PRESETS } from "../src/lib/solver/postflop/flop-library/fixtures";
import { readFlopLibrarySource } from "../src/lib/solver/postflop/flop-library/source-node";
import { deriveFlopFront } from "../src/lib/solver/postflop/flop-library/derive";
const start = performance.now(), source = readFlopLibrarySource(FLOP_PRESETS[FLOP_PRESETS.length - 1]);
const derived = deriveFlopFront(source.game, source.policy, n => { if (n % 250 === 0) console.error(JSON.stringify({ completedDeals: n,
  totalDeals: source.game.ranges.compatibleDeals, elapsedMs: performance.now() - start, rssBytes: process.memoryUsage().rss })); });
if (Math.abs(derived.rootValue0 - source.grade.value[0]) > 1e-10 * 125) throw new Error("Streamed explanation disagrees with independent source value");
console.log(JSON.stringify({ rootValue0: derived.rootValue0, gradedValue0: source.grade.value[0], workingBytes: derived.workingBytes,
  frontNodes: derived.frontNodes, elapsedMs: performance.now() - start, maximumRssBytes: process.resourceUsage().maxRSS * 1024 }));
