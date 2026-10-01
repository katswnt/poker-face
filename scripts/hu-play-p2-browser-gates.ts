import assert from "node:assert/strict";
export interface P2GateRow {
  seed: number; browser: string; passed: boolean; exactNativeParity: boolean;
  workers: number; terminated: number; isolated: boolean; elapsedMs: number;
  observedPeakLinearMemoryBytes: number | null;
}
export function checkP2BrowserRows(rows: readonly P2GateRow[], names: readonly string[], measured: boolean) {
  assert.ok(names.length && new Set(names).size === names.length);
  assert.equal(rows.length, names.length * 200);
  return names.map(browser => {
    const selected = rows.filter(r => r.browser === browser);
    assert.deepEqual(selected.map(r => r.seed).sort((a, b) => a - b), Array.from({ length: 200 }, (_, i) => i));
    for (const r of selected) {
      assert.ok(r.passed && r.exactNativeParity && !r.isolated && [1, 2].includes(r.workers) && r.workers === r.terminated,
        `Browser/parity/lifecycle failed at ${browser}/${r.seed}`);
      assert.ok(Number.isFinite(r.elapsedMs) && r.elapsedMs >= 0 && r.elapsedMs <= 120000);
      if (measured) assert.ok(r.observedPeakLinearMemoryBytes !== null && r.observedPeakLinearMemoryBytes > 0
        && r.observedPeakLinearMemoryBytes <= 192 * 1024 ** 2, "Memory observation exceeds unknown-device limit or is missing");
    }
    const times = selected.map(r => r.elapsedMs).sort((a, b) => a - b);
    const summary = { browser, cases: 200, p50Ms: (times[99] + times[100]) / 2,
      p95Ms: times[189], maxMs: times[199], chromiumP95BudgetMs: 2000,
      observedPeakLinearMemoryBytes: measured ? Math.max(...selected.map(r => r.observedPeakLinearMemoryBytes!)) : null };
    if (browser === "chromium") assert.ok(summary.p95Ms <= 2000, "Unchanged P1 river p95 budget failed");
    return summary;
  });
}
