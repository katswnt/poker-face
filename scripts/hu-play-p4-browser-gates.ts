import assert from "node:assert/strict";

export interface P4GateRow {
  seed: number; browser: string; passed: boolean; exactNativeParity: boolean;
  workers: number; terminated: number; isolated: boolean; elapsedMs: number;
  responseElapsedMs: number | null; observedPeakLinearMemoryBytes: number | null;
  attempts: readonly { street: "turn" | "river"; elapsedMs: number }[];
}
function statistics(values: number[]) {
  assert.ok(values.length); const times = [...values].sort((a, b) => a - b), n = times.length;
  return { count: n, p50Ms: (times[Math.floor((n - 1) / 2)] + times[Math.floor(n / 2)]) / 2,
    p95Ms: times[Math.ceil(.95 * n) - 1], maxMs: times[n - 1] };
}
export function checkP4BrowserRows(rows: readonly P4GateRow[], names: readonly string[], measured: boolean) {
  assert.ok(names.length && new Set(names).size === names.length);
  assert.equal(rows.length, names.length * 200, "All 200 frozen cases required for each browser");
  return names.map(browser => {
    const selected = rows.filter(r => r.browser === browser);
    assert.deepEqual(selected.map(r => r.seed).sort((a, b) => a - b), Array.from({ length: 200 }, (_, i) => i));
    for (const r of selected) {
      assert.ok(r.passed && r.exactNativeParity && !r.isolated && Number.isSafeInteger(r.workers)
        && r.workers >= 0 && (r.attempts.length ? r.workers > 0 : r.workers === 0) && r.workers === r.terminated, `Browser/parity/lifecycle failed at ${browser}/${r.seed}`);
      assert.ok(Number.isFinite(r.elapsedMs) && r.elapsedMs > 0 && r.responseElapsedMs !== null
        && Number.isFinite(r.responseElapsedMs) && r.responseElapsedMs > 0 && r.responseElapsedMs <= r.elapsedMs);
      for (const attempt of r.attempts) assert.ok(["turn", "river"].includes(attempt.street)
        && Number.isFinite(attempt.elapsedMs) && attempt.elapsedMs >= 0);
      if (measured && r.attempts.length) assert.ok(r.observedPeakLinearMemoryBytes !== null && r.observedPeakLinearMemoryBytes > 0
        && r.observedPeakLinearMemoryBytes <= 192 * 1024 ** 2, "Missing memory observation or exceeded unknown-device bound");
    }
    const riverTimes = selected.flatMap(r => r.attempts.filter(a => a.street === "river").map(a => a.elapsedMs));
    assert.ok(riverTimes.length >= 20, "At least 20 actual river observations required");
    const turnTimes = selected.flatMap(r => r.attempts.filter(a => a.street === "turn").map(a => a.elapsedMs));
    assert.ok(turnTimes.length >= 20, "At least 20 actual turn observations required");
    const flop = statistics(selected.map(r => r.responseElapsedMs!)), turn = statistics(turnTimes), river = statistics(riverTimes);
    if (browser === "chromium") {
      assert.ok(turn.p95Ms <= 10000, "Unchanged P1 turn p95 budget failed");
      assert.ok(river.p95Ms <= 2000, "Unchanged P1 river p95 budget failed");
    }
    return { browser, cases: 200, noSolveCases: selected.filter(r => !r.attempts.length).length, flop, turn, river, turnBudgetMs: 10000, riverBudgetMs: 2000,
      observedPeakLinearMemoryBytes: measured ? Math.max(...selected.map(r => r.observedPeakLinearMemoryBytes!)) : null };
  });
}
