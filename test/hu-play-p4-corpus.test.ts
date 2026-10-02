import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { loadPlayCatalog } from "../src/lib/hu-play/sources/library-data";
import { actionToken, illegalActionReason } from "../src/lib/hu-play/public-state";
import { preparationKey } from "../src/lib/hu-play/sources/policy";

const fetcher: typeof fetch = async input => {
  assert.match(String(input), /^\/solver-data\/[a-zA-Z0-9/_.-]+$/);
  assert.ok(!String(input).includes("..")); return new Response(readFileSync(`public${input}`));
};
test("P4 prospective corpus freezes 200 distinct public-parent/action pairs across every flop and family", async () => {
  assert.ok(existsSync("scripts/hu-play-p4-corpus.ts"), "Freeze flop corpus before measuring continuations");
  const { buildFlopCorpus } = await import("../scripts/hu-play-p4-corpus");
  const catalog = await loadPlayCatalog(undefined, fetcher), cases = await buildFlopCorpus(catalog, fetcher);
  assert.equal(cases.length, 200);
  assert.equal(new Set(cases.map(c => preparationKey(c.request) + actionToken(c.actual))).size, 200);
  assert.equal(new Set(cases.map(c => c.librarySpotId)).size, 12);
  assert.equal(new Set(cases.map(c => c.request.aiSeat)).size, 2);
  for (const family of ["root", "check", "bet", "raise"]) {
    assert.equal(cases.filter(c => c.family === family).length, 50);
    assert.equal(new Set(cases.filter(c => c.family === family).map(c => c.librarySpotId)).size, 12);
  }
  for (const category of ["minimum", "all-in", "near-all-in", "interior"]) {
    assert.equal(cases.filter(c => c.category === category).length, category === "interior" ? 80 : 40);
  }
  for (const c of cases) {
    assert.equal(illegalActionReason(c.request.publicState, c.actual), null);
    assert.ok(!c.savedMenu.some(a => actionToken(a) === actionToken(c.actual)));
    assert.equal(c.request.publicState.toAct, 1 - c.request.aiSeat);
    assert.equal(c.request.publicState.board.turn, null); assert.equal(c.request.publicState.board.river, null);
  }
  assert.deepEqual(await buildFlopCorpus(catalog, fetcher), cases);
});
